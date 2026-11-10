create or replace function public.auto_close_stale_attendance()
returns integer language plpgsql security definer set search_path to ''
as $function$
declare v_closed integer;
begin
  with stale as (
    select a.id,a.check_in,
      greatest(0,floor(extract(epoch from (least(a.check_in+interval '9 hours',pg_catalog.now())-a.check_in))/60)::integer) as elapsed_minutes
    from public.attendance a
    where a.check_out is null and a.work_date is not null and a.work_timezone is not null
      and (a.work_date < (pg_catalog.now() at time zone a.work_timezone)::date
        or exists (select 1 from public.shifts s where s.employee_id=a.employee_id and s.starts_at>a.check_in and s.starts_at<=pg_catalog.now()))
    for update of a skip locked
  )
  update public.attendance a
  set check_out=least(stale.check_in+interval '9 hours',pg_catalog.now()),
      credited_work_minutes=case when stale.elapsed_minutes>=540 then 480
        else greatest(0,stale.elapsed_minutes-case when stale.elapsed_minutes>=300 then 60 else 0 end) end,
      auto_closed=true,check_out_lat=null,check_out_lng=null
  from stale where a.id=stale.id and a.check_out is null;
  get diagnostics v_closed=row_count;
  return v_closed;
end;
$function$;
revoke all on function public.auto_close_stale_attendance() from public,anon,authenticated;
revoke all on function public.close_previous_open_attendance_before_insert() from public,anon,authenticated;
