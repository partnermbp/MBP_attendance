create or replace function public.get_admin_attendance_with_gps()
returns setof public.attendance language plpgsql security definer set search_path to ''
as $function$
begin
 if not public.is_admin_or_supervisor() then
   raise exception 'Administrator or Supervisor access required' using errcode='42501';
 end if;
 return query select a.* from public.attendance a order by a.check_in desc limit 10000;
end;
$function$;
