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
