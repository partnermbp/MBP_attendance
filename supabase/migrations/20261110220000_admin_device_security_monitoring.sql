create table if not exists public.device_security_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  app_platform text not null check (app_platform in ('web','android','windows','ios','macos')),
  app_runtime text not null check (app_runtime in ('browser','capacitor','electron')),
  app_version text,
  os_name text,
  os_version text,
  device_model text,
  browser_name text,
  user_agent text,
  language text,
  timezone text,
  screen_width integer,
  screen_height integer,
  ip_address inet,
  ip_source text,
  location_consent_at timestamptz,
  location_tracking_enabled boolean not null default false,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists device_security_sessions_user_last_seen_idx
  on public.device_security_sessions(user_id,last_seen_at desc);
create index if not exists device_security_sessions_platform_idx
  on public.device_security_sessions(app_platform,last_seen_at desc);

create table if not exists public.device_location_points (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.device_security_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  accuracy_m double precision,
  altitude_m double precision,
  heading_deg double precision,
  speed_mps double precision,
  recorded_at timestamptz not null default now(),
  source text not null default 'browser' check(source in ('browser','capacitor','electron'))
);
create index if not exists device_location_points_session_time_idx
  on public.device_location_points(session_id,recorded_at);
create index if not exists device_location_points_user_time_idx
  on public.device_location_points(user_id,recorded_at desc);

alter table public.device_security_sessions enable row level security;
alter table public.device_location_points enable row level security;
revoke all on public.device_security_sessions, public.device_location_points from anon, authenticated;
grant insert, update on public.device_security_sessions to authenticated;
grant insert on public.device_location_points to authenticated;
grant select on public.device_security_sessions, public.device_location_points to authenticated;

drop policy if exists device_sessions_owner_insert on public.device_security_sessions;
create policy device_sessions_owner_insert on public.device_security_sessions
for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists device_sessions_owner_update on public.device_security_sessions;
create policy device_sessions_owner_update on public.device_security_sessions
for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists device_sessions_admin_read on public.device_security_sessions;
create policy device_sessions_admin_read on public.device_security_sessions
for select to authenticated using (public.is_active_admin());
drop policy if exists device_locations_owner_insert on public.device_location_points;
create policy device_locations_owner_insert on public.device_location_points
for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.device_security_sessions s
    where s.id = session_id and s.user_id = (select auth.uid())
      and s.location_tracking_enabled = true and s.ended_at is null
  )
);
drop policy if exists device_locations_admin_read on public.device_location_points;
create policy device_locations_admin_read on public.device_location_points
for select to authenticated using (public.is_active_admin());

create or replace function public.start_device_security_session(p_metadata jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null or not exists(select 1 from public.profiles p where p.id=v_user and p.active=true) then
    raise exception 'Active authenticated profile required' using errcode='42501';
  end if;
  insert into public.device_security_sessions(
    user_id,app_platform,app_runtime,app_version,os_name,os_version,device_model,
    browser_name,user_agent,language,timezone,screen_width,screen_height
  ) values (
    v_user,
    coalesce(p_metadata->>'app_platform','web'),
    coalesce(p_metadata->>'app_runtime','browser'),
    nullif(p_metadata->>'app_version',''),
    nullif(p_metadata->>'os_name',''),
    nullif(p_metadata->>'os_version',''),
    nullif(p_metadata->>'device_model',''),
    nullif(p_metadata->>'browser_name',''),
    nullif(p_metadata->>'user_agent',''),
    nullif(p_metadata->>'language',''),
    nullif(p_metadata->>'timezone',''),
    nullif(p_metadata->>'screen_width','')::integer,
    nullif(p_metadata->>'screen_height','')::integer
  ) returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.record_device_location(
  p_session_id uuid,p_latitude double precision,p_longitude double precision,
  p_accuracy_m double precision default null,p_altitude_m double precision default null,
  p_heading_deg double precision default null,p_speed_mps double precision default null,
  p_source text default 'browser'
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists(
    select 1 from public.device_security_sessions s
    where s.id=p_session_id and s.user_id=v_user and s.ended_at is null
      and s.location_tracking_enabled=true
  ) then raise exception 'Location tracking is not enabled for this session' using errcode='42501'; end if;
  if not exists(select 1 from public.attendance a where a.employee_id=v_user and a.check_out is null) then
    raise exception 'Location can only be recorded during an active attendance session' using errcode='42501';
  end if;
  insert into public.device_location_points(session_id,user_id,latitude,longitude,accuracy_m,altitude_m,heading_deg,speed_mps,source)
  values(p_session_id,v_user,p_latitude,p_longitude,p_accuracy_m,p_altitude_m,p_heading_deg,p_speed_mps,
    case when p_source in ('browser','capacitor','electron') then p_source else 'browser' end);
end;
$function$;

create or replace function public.set_device_location_consent(p_session_id uuid,p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare v_user uuid := auth.uid();
begin
  update public.device_security_sessions
  set location_tracking_enabled=p_enabled,
      location_consent_at=case when p_enabled then now() else location_consent_at end
  where id=p_session_id and user_id=v_user and ended_at is null;
  if not found then raise exception 'Device session not found' using errcode='42501'; end if;
end;
$function$;

create or replace function public.end_device_security_session(p_session_id uuid)
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.device_security_sessions set ended_at=now(),last_seen_at=now(),location_tracking_enabled=false
  where id=p_session_id and user_id=auth.uid() and ended_at is null;
$function$;

revoke all on function public.start_device_security_session(jsonb) from public,anon;
revoke all on function public.record_device_location(uuid,double precision,double precision,double precision,double precision,double precision,double precision,text) from public,anon;
revoke all on function public.set_device_location_consent(uuid,boolean) from public,anon;
revoke all on function public.end_device_security_session(uuid) from public,anon;
grant execute on function public.start_device_security_session(jsonb) to authenticated;
grant execute on function public.record_device_location(uuid,double precision,double precision,double precision,double precision,double precision,double precision,text) to authenticated;
grant execute on function public.set_device_location_consent(uuid,boolean) to authenticated;
grant execute on function public.end_device_security_session(uuid) to authenticated;

create or replace function public.admin_device_security_overview()
returns table (
  session_id uuid,user_id uuid,full_name text,email text,role text,app_platform text,
  app_runtime text,app_version text,os_name text,os_version text,device_model text,
  browser_name text,ip_address inet,ip_source text,timezone text,started_at timestamptz,
  last_seen_at timestamptz,ended_at timestamptz,location_tracking_enabled boolean,
  location_consent_at timestamptz,location_points bigint
)
language sql
security definer
set search_path = ''
as $function$
  select s.id,s.user_id,p.full_name,p.email,p.role,s.app_platform,s.app_runtime,s.app_version,
    s.os_name,s.os_version,s.device_model,s.browser_name,s.ip_address,s.ip_source,s.timezone,
    s.started_at,s.last_seen_at,s.ended_at,s.location_tracking_enabled,s.location_consent_at,
    (select count(*) from public.device_location_points l where l.session_id=s.id)
  from public.device_security_sessions s
  join public.profiles p on p.id=s.user_id
  where public.is_active_admin()
  order by s.last_seen_at desc
  limit 2000;
$function$;
revoke all on function public.admin_device_security_overview() from public,anon;
grant execute on function public.admin_device_security_overview() to authenticated;
