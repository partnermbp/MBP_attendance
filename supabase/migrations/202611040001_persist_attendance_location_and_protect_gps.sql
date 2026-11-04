-- Persist coarse attendance location labels and keep precise GPS coordinates Admin-only.
alter table public.attendance
  add column if not exists check_in_region text,
  add column if not exists check_in_country text,
  add column if not exists check_out_region text,
  add column if not exists check_out_country text;

-- Authenticated users may read ordinary attendance fields and coarse location labels,
-- but must not SELECT precise GPS columns directly.
revoke select on table public.attendance from anon, authenticated;
grant select (
  id,
  employee_id,
  check_in,
  check_out,
  work_date,
  work_timezone,
  check_in_region,
  check_in_country,
  check_out_region,
  check_out_country
) on table public.attendance to authenticated;

-- Admin-only read path for exact coordinates. This function is the only client-facing
-- route that returns latitude/longitude, and it verifies the caller's active admin role.
create or replace function public.get_admin_attendance_with_gps()
returns setof public.attendance
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.is_active_admin() then
    raise exception 'Active administrator access required'
      using errcode = '42501';
  end if;

  return query
    select a.*
    from public.attendance a
    order by a.check_in desc
    limit 1000;
end;
$function$;

revoke all on function public.get_admin_attendance_with_gps() from public, anon;
grant execute on function public.get_admin_attendance_with_gps() to authenticated;

-- Do not return the attendance row from check-in: it contains exact GPS coordinates.
-- The caller only needs success/error, not the inserted row.
drop function if exists public.check_in_with_timezone(double precision, double precision, text);
create function public.check_in_with_timezone(
  p_latitude double precision,
  p_longitude double precision,
  p_timezone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_work_date date;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then raise exception 'Authentication required'; end if;

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
  insert into public.attendance (
    employee_id, check_in, check_in_lat, check_in_lng, work_date, work_timezone
  ) values (
    v_user_id, pg_catalog.now(), p_latitude, p_longitude, v_work_date, p_timezone
  );
end;
$function$;

revoke all on function public.check_in_with_timezone(double precision, double precision, text) from public, anon;
grant execute on function public.check_in_with_timezone(double precision, double precision, text) to authenticated;

-- Likewise, check-out records the caller's GPS but returns no attendance row.
drop function if exists public.check_out_attendance(uuid, double precision, double precision);
create function public.check_out_attendance(
  p_attendance_id uuid,
  p_latitude double precision,
  p_longitude double precision
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then raise exception 'Authentication required'; end if;

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
  set check_out = pg_catalog.now(),
      check_out_lat = p_latitude,
      check_out_lng = p_longitude
  where id = p_attendance_id
    and employee_id = v_user_id
    and check_out is null;

  if not found then
    raise exception 'No active attendance record found for this user';
  end if;
end;
$function$;

revoke all on function public.check_out_attendance(uuid, double precision, double precision) from public, anon;
grant execute on function public.check_out_attendance(uuid, double precision, double precision) to authenticated;
