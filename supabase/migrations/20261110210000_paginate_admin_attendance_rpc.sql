create or replace function public.get_admin_attendance_with_gps(
  p_limit integer default 1000,
  p_offset integer default 0
)
returns setof public.attendance
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.is_active_admin() then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  return query
    select a.* from public.attendance a
    order by a.check_in desc,a.id
    limit greatest(1,least(coalesce(p_limit,1000),1000))
    offset greatest(coalesce(p_offset,0),0);
end;
$function$;
revoke all on function public.get_admin_attendance_with_gps(integer,integer) from public, anon;
grant execute on function public.get_admin_attendance_with_gps(integer,integer) to authenticated;

create or replace function public.get_supervisor_attendance(
  p_limit integer default 1000,
  p_offset integer default 0
)
returns table (
  id uuid, employee_id uuid, check_in timestamptz, check_out timestamptz,
  check_in_lat double precision, check_in_lng double precision,
  check_out_lat double precision, check_out_lng double precision,
  created_at timestamptz, work_date date, work_timezone text,
  check_in_region text, check_in_country text, check_out_region text, check_out_country text,
  credited_work_minutes integer, auto_closed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.is_active_supervisor() then
    raise exception 'Supervisor access required' using errcode='42501';
  end if;
  return query
    select a.id,a.employee_id,a.check_in,a.check_out,
      null::double precision,null::double precision,null::double precision,null::double precision,
      a.created_at,a.work_date,a.work_timezone,a.check_in_region,a.check_in_country,
      a.check_out_region,a.check_out_country,a.credited_work_minutes,a.auto_closed
    from public.attendance a
    order by a.check_in desc,a.id
    limit greatest(1,least(coalesce(p_limit,1000),1000))
    offset greatest(coalesce(p_offset,0),0);
end;
$function$;
revoke all on function public.get_supervisor_attendance(integer,integer) from public, anon;
grant execute on function public.get_supervisor_attendance(integer,integer) to authenticated;
