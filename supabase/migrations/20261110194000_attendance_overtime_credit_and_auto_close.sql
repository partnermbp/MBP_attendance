create or replace function public.check_out_attendance(
  p_attendance_id uuid, p_latitude double precision, p_longitude double precision
)
returns void language plpgsql security definer set search_path to ''
as $function$
declare
  v_user_id uuid;
  v_session public.attendance%rowtype;
  v_now timestamptz := pg_catalog.now();
  v_end timestamptz;
  v_elapsed integer;
  v_credited integer;
  v_is_stale boolean;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.is_auth_mfa_current() then raise exception 'Complete login verification first' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id=v_user_id and p.active=true and p.role::text in ('junior','middle','senior','team_leader','telemarketing')) then
    raise exception 'Active employee profile required';
  end if;
  if p_latitude is null or p_longitude is null or p_latitude < -90 or p_latitude > 90 or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Valid GPS coordinates are required';
  end if;
  select * into v_session from public.attendance where id=p_attendance_id and employee_id=v_user_id and check_out is null for update;
  if not found then raise exception 'No active attendance record found for this user'; end if;
  v_is_stale := v_session.work_date is not null and v_session.work_timezone is not null
    and v_session.work_date < (v_now at time zone v_session.work_timezone)::date;
  if v_is_stale then
    v_end := v_session.check_in + interval '9 hours';
    v_credited := 480;
  else
    v_end := v_now;
    v_elapsed := greatest(0, floor(extract(epoch from (v_end-v_session.check_in))/60)::integer);
    if v_elapsed >= 540 then v_credited := 480 + least(120,v_elapsed-540);
    else v_credited := greatest(0,v_elapsed-case when v_elapsed>=300 then 60 else 0 end);
    end if;
  end if;
  update public.attendance set check_out=v_end,
    check_out_lat=case when v_is_stale then null else p_latitude end,
    check_out_lng=case when v_is_stale then null else p_longitude end,
    credited_work_minutes=v_credited, auto_closed=v_is_stale
  where id=v_session.id;
end;
$function$;

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

create or replace function public.close_previous_open_attendance_before_insert()
returns trigger language plpgsql security definer set search_path to ''
as $function$
declare v_previous record; v_elapsed integer; v_credit integer;
begin
  for v_previous in select a.id,a.check_in from public.attendance a
    where a.employee_id=new.employee_id and a.check_out is null for update
  loop
    v_elapsed:=greatest(0,floor(extract(epoch from (least(new.check_in,v_previous.check_in+interval '9 hours')-v_previous.check_in))/60)::integer);
    if v_elapsed>=540 then v_credit:=480;
    else v_credit:=greatest(0,v_elapsed-case when v_elapsed>=300 then 60 else 0 end); end if;
    update public.attendance set check_out=least(new.check_in,v_previous.check_in+interval '9 hours'),
      credited_work_minutes=v_credit,auto_closed=true,check_out_lat=null,check_out_lng=null
    where id=v_previous.id and check_out is null;
  end loop;
  return new;
end;
$function$;
drop trigger if exists attendance_close_previous_open_before_insert on public.attendance;
create trigger attendance_close_previous_open_before_insert before insert on public.attendance
for each row execute function public.close_previous_open_attendance_before_insert();

create extension if not exists pg_cron with schema pg_catalog;
do $schedule$
begin
  if exists(select 1 from cron.job where jobname='attendance-auto-close-stale-sessions') then
    perform cron.unschedule(jobid) from cron.job where jobname='attendance-auto-close-stale-sessions';
  end if;
  perform cron.schedule('attendance-auto-close-stale-sessions','* * * * *','select public.auto_close_stale_attendance();');
end;
$schedule$;
