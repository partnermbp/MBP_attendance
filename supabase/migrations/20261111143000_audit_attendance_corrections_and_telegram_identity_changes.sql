alter table public.crm_security_events drop constraint if exists crm_security_events_event_type_check;
alter table public.crm_security_events add constraint crm_security_events_event_type_check
 check(event_type in ('login_success','logout','failed_password','failed_email_otp','failed_telegram_otp','device_registered','device_ip_changed','session_revoked','attendance_correction_submitted','attendance_correction_reviewed','attendance_correction_applied','role_changed','account_deactivated','invitation_accepted','telegram_identity_changed','security_alert_reviewed','security_alert_triggered'));

create or replace function public.audit_profile_security_changes()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_actor uuid:=auth.uid(); v_sessions integer:=0;
begin
 if old.role is distinct from new.role then
  insert into public.crm_security_events(profile_id,event_type,outcome,details)
  values(coalesce(v_actor,new.id),'role_changed','success',jsonb_build_object('target_profile_id',new.id,'old_role',old.role::text,'new_role',new.role::text));
 end if;
 if old.telegram_user_id is distinct from new.telegram_user_id then
  insert into public.crm_security_events(profile_id,event_type,outcome,details)
  values(coalesce(v_actor,new.id),'telegram_identity_changed','success',jsonb_build_object('target_profile_id',new.id,'previous_telegram_user_id',old.telegram_user_id,'new_telegram_user_id',new.telegram_user_id));
 end if;
 if old.active is distinct from new.active and new.active=false then
  delete from public.crm_login_sessions where user_id=new.id;
  update public.device_security_sessions set ended_at=coalesce(ended_at,now()),location_tracking_enabled=false
   where user_id=new.id and ended_at is null;
  get diagnostics v_sessions=row_count;
  insert into public.crm_security_events(profile_id,event_type,outcome,details)
  values(coalesce(v_actor,new.id),'account_deactivated','success',jsonb_build_object('target_profile_id',new.id));
  insert into public.crm_security_events(profile_id,event_type,outcome,details)
  values(coalesce(v_actor,new.id),'session_revoked','success',jsonb_build_object('target_profile_id',new.id,'active_device_sessions_ended',v_sessions,'reason','account_deactivated'));
 end if;
 return new;
end;
$function$;
revoke all on function public.audit_profile_security_changes() from public,anon,authenticated;

create or replace function public.audit_attendance_correction_security_event()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
 if tg_op='INSERT' then
  insert into public.crm_security_events(profile_id,event_type,outcome,details)
  values(new.employee_id,'attendance_correction_submitted','info',jsonb_build_object('request_id',new.id,'attendance_id',new.attendance_id,'work_date',new.work_date));
 else
  if old.status is distinct from new.status then
   insert into public.crm_security_events(profile_id,event_type,outcome,details)
   values(coalesce(new.reviewed_by,new.employee_id),'attendance_correction_reviewed','info',
    jsonb_build_object('request_id',new.id,'employee_id',new.employee_id,'status',new.status,'reviewed_at',new.reviewed_at));
  end if;
  if old.applied_at is null and new.applied_at is not null then
   insert into public.crm_security_events(profile_id,event_type,outcome,details)
   values(coalesce(new.applied_by,new.employee_id),'attendance_correction_applied','success',
    jsonb_build_object('request_id',new.id,'employee_id',new.employee_id,'attendance_id',new.attendance_id,'applied_by',new.applied_by,'applied_at',new.applied_at));
  end if;
 end if;
 return new;
end;
$function$;
revoke all on function public.audit_attendance_correction_security_event() from public,anon,authenticated;
drop trigger if exists attendance_correction_security_audit on public.attendance_correction_requests;
create trigger attendance_correction_security_audit after insert or update of status,applied_at on public.attendance_correction_requests
for each row execute function public.audit_attendance_correction_security_event();