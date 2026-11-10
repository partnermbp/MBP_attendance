drop function if exists public.get_admin_attendance_with_gps();

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
  if not public.is_admin_or_supervisor() then
    raise exception 'Administrator or Supervisor access required' using errcode='42501';
  end if;
  return query
    select a.*
    from public.attendance a
    order by a.check_in desc, a.id
    limit greatest(1, least(coalesce(p_limit,1000),1000))
    offset greatest(coalesce(p_offset,0),0);
end;
$function$;

revoke all on function public.get_admin_attendance_with_gps(integer,integer) from public, anon;
grant execute on function public.get_admin_attendance_with_gps(integer,integer) to authenticated;
