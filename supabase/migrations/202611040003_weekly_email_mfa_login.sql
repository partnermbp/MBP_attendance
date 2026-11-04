-- Weekly corporate-email MFA and per-login session approval.
-- Registration-relative 7-day windows; every authenticated RLS policy is gated
-- by a session_id that is approved only after the required factors are complete.

create table if not exists public.crm_email_mfa_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  verified_week bigint not null,
  verified_at timestamptz not null default now()
);

create table if not exists public.crm_login_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  ticket_hash text not null unique,
  stage text not null check (stage in ('email', 'telegram', 'complete')),
  week_index bigint not null,
  session_id uuid,
  telegram_otp_hash text,
  telegram_otp_expires_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 5),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.crm_login_challenges
  add column if not exists session_id uuid,
  add column if not exists telegram_otp_hash text,
  add column if not exists telegram_otp_expires_at timestamptz;

create table if not exists public.crm_login_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  verified_week bigint not null,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists crm_login_challenges_user_created_idx
  on public.crm_login_challenges(user_id, created_at desc);
create index if not exists crm_login_challenges_expiry_idx
  on public.crm_login_challenges(expires_at);
create index if not exists crm_login_sessions_user_idx
  on public.crm_login_sessions(user_id, expires_at desc);

alter table public.crm_email_mfa_status enable row level security;
alter table public.crm_login_challenges enable row level security;
alter table public.crm_login_sessions enable row level security;

revoke all on public.crm_email_mfa_status from anon, authenticated;
revoke all on public.crm_login_challenges from anon, authenticated;
revoke all on public.crm_login_sessions from anon, authenticated;
grant all on public.crm_email_mfa_status to service_role;
grant all on public.crm_login_challenges to service_role;
grant all on public.crm_login_sessions to service_role;

create or replace function public.is_auth_mfa_current()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select case
    when auth.uid() is null or nullif(auth.jwt() ->> 'session_id', '') is null then false
    else exists (
      select 1
      from public.crm_login_sessions s
      join auth.users u on u.id = s.user_id
      where s.session_id = (auth.jwt() ->> 'session_id')::uuid
        and s.user_id = auth.uid()
        and s.expires_at > now()
        and s.verified_week = floor(extract(epoch from (now() - u.created_at)) / 604800)::bigint
    )
  end;
$$;
revoke all on function public.is_auth_mfa_current() from public, anon;
grant execute on function public.is_auth_mfa_current() to authenticated, service_role;

-- Add MFA as an AND condition to every existing permissive/restrictive policy
-- that grants authenticated (or public) access to application/storage rows.
do $$
declare
  p record;
  using_expr text;
  check_expr text;
  target_schema text;
begin
  for p in
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and tablename not in ('crm_email_mfa_status', 'crm_login_challenges', 'crm_login_sessions')
      and ('authenticated' = any(roles) or 'public' = any(roles))
  loop
    using_expr := coalesce(p.qual, 'true');
    check_expr := coalesce(p.with_check, 'true');
    if p.cmd = 'SELECT' then
      execute format('alter policy %I on %I.%I using ((%s) and public.is_auth_mfa_current())',
        p.policyname, p.schemaname, p.tablename, using_expr);
    elsif p.cmd = 'INSERT' then
      execute format('alter policy %I on %I.%I with check ((%s) and public.is_auth_mfa_current())',
        p.policyname, p.schemaname, p.tablename, check_expr);
    elsif p.cmd = 'UPDATE' then
      execute format('alter policy %I on %I.%I using ((%s) and public.is_auth_mfa_current()) with check ((%s) and public.is_auth_mfa_current())',
        p.policyname, p.schemaname, p.tablename, using_expr, check_expr);
    elsif p.cmd = 'DELETE' then
      execute format('alter policy %I on %I.%I using ((%s) and public.is_auth_mfa_current())',
        p.policyname, p.schemaname, p.tablename, using_expr);
    elsif p.cmd = 'ALL' then
      execute format('alter policy %I on %I.%I using ((%s) and public.is_auth_mfa_current()) with check ((%s) and public.is_auth_mfa_current())',
        p.policyname, p.schemaname, p.tablename, using_expr, check_expr);
    end if;
  end loop;
end;
$$;

-- Privileged helper functions must also reject password-only sessions.
create or replace function public.is_active_admin()
returns boolean language sql stable security definer
set search_path = public
as $$
  select public.is_auth_mfa_current() and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active = true and lower(p.role::text) = 'admin'
  );
$$;

create or replace function public.is_hierarchy_manager(target_profile uuid default auth.uid())
returns boolean language sql stable security definer
set search_path = public
as $$
  select public.is_auth_mfa_current() and exists (
    select 1 from public.profiles p
    where p.id = target_profile and p.active = true
      and lower(replace(p.role::text, '_', ' ')) in ('middle','senior','team leader')
  );
$$;

-- The attendance RPCs are SECURITY DEFINER and therefore need their own MFA gate.
create or replace function public.check_in_with_timezone(
  p_latitude double precision,
  p_longitude double precision,
  p_timezone text
)
returns void language plpgsql security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_work_date date;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.is_auth_mfa_current() then raise exception 'Complete login verification first' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_user_id and p.active = true
      and p.role::text in ('junior', 'middle', 'senior', 'team_leader', 'telemarketing')
  ) then raise exception 'Active employee profile required'; end if;
  if p_latitude is null or p_longitude is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Valid GPS coordinates are required';
  end if;
  if p_timezone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_timezone
  ) then raise exception 'Valid IANA timezone required'; end if;
  v_work_date := (pg_catalog.now() at time zone p_timezone)::date;
  insert into public.attendance (employee_id, check_in, check_in_lat, check_in_lng, work_date, work_timezone)
  values (v_user_id, pg_catalog.now(), p_latitude, p_longitude, v_work_date, p_timezone);
end;
$function$;

create or replace function public.check_out_attendance(
  p_attendance_id uuid,
  p_latitude double precision,
  p_longitude double precision
)
returns void language plpgsql security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.is_auth_mfa_current() then raise exception 'Complete login verification first' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_user_id and p.active = true
      and p.role::text in ('junior', 'middle', 'senior', 'team_leader', 'telemarketing')
  ) then raise exception 'Active employee profile required'; end if;
  if p_latitude is null or p_longitude is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Valid GPS coordinates are required';
  end if;
  update public.attendance
  set check_out = pg_catalog.now(), check_out_lat = p_latitude, check_out_lng = p_longitude
  where id = p_attendance_id and employee_id = v_user_id and check_out is null;
  if not found then raise exception 'No active attendance record found for this user'; end if;
end;
$function$;

revoke all on function public.check_in_with_timezone(double precision, double precision, text) from public, anon;
grant execute on function public.check_in_with_timezone(double precision, double precision, text) to authenticated;
revoke all on function public.check_out_attendance(uuid, double precision, double precision) from public, anon;
grant execute on function public.check_out_attendance(uuid, double precision, double precision) to authenticated;
