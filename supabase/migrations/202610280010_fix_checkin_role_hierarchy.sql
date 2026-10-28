-- The original check-in RPC only allowed the legacy 'employee' role.
-- The current CRM assigns hierarchy roles, so allow active non-admin workforce
-- roles while preserving authentication, GPS, timezone, and server-side timestamps.
create or replace function public.check_in_with_timezone(
  p_latitude double precision,
  p_longitude double precision,
  p_timezone text
)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_work_date date;
  v_result public.attendance;
begin
  v_user_id := (select auth.uid());

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
      and p.active = true
      and p.role::text in ('junior', 'middle', 'senior', 'team_leader', 'telemarketing')
  ) then
    raise exception 'Active employee profile required';
  end if;

  if p_latitude is null or p_longitude is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Valid GPS coordinates are required';
  end if;

  if p_timezone is null or not exists (
    select 1
    from pg_catalog.pg_timezone_names tz
    where tz.name = p_timezone
  ) then
    raise exception 'Valid IANA timezone required';
  end if;

  v_work_date := (pg_catalog.now() at time zone p_timezone)::date;

  insert into public.attendance (
    employee_id,
    check_in,
    check_in_lat,
    check_in_lng,
    work_date,
    work_timezone
  )
  values (
    v_user_id,
    pg_catalog.now(),
    p_latitude,
    p_longitude,
    v_work_date,
    p_timezone
  )
  returning * into v_result;

  return v_result;
end;
$function$;

revoke all on function public.check_in_with_timezone(double precision, double precision, text) from public, anon;
grant execute on function public.check_in_with_timezone(double precision, double precision, text) to authenticated;
