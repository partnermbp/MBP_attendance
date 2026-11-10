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
