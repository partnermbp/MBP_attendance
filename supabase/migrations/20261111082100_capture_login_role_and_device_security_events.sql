create or replace function public.audit_crm_login_event()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
 insert into public.crm_security_events(profile_id,event_type,outcome,login_method,ip_address,ip_source,details,occurred_at)
 values(new.profile_id,'login_success','success',new.login_method,
   nullif(split_part(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-forwarded-for',''),',',1),'')::inet,
   'supabase_gateway_forwarded_for',jsonb_build_object('source','record_crm_login'),new.logged_at);
 return new;
exception when others then
 -- Login auditing must not block successful authentication if a gateway header is malformed.
 insert into public.crm_security_events(profile_id,event_type,outcome,login_method,details,occurred_at)
 values(new.profile_id,'login_success','success',new.login_method,jsonb_build_object('source','record_crm_login','ip_capture','unavailable'),new.logged_at);
 return new;
end;
$function$;
drop trigger if exists crm_login_security_audit on public.crm_login_events;
create trigger crm_login_security_audit after insert on public.crm_login_events
for each row execute function public.audit_crm_login_event();

create or replace function public.audit_profile_security_changes()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_actor uuid:=auth.uid();
begin
 if old.role is distinct from new.role then
  insert into public.crm_security_events(profile_id,event_type,outcome,details)
  values(coalesce(v_actor,new.id),'role_changed','success',jsonb_build_object('target_profile_id',new.id,'old_role',old.role::text,'new_role',new.role::text));
 end if;
 if old.active is distinct from new.active and new.active=false then
  insert into public.crm_security_events(profile_id,event_type,outcome,details)
  values(coalesce(v_actor,new.id),'account_deactivated','success',jsonb_build_object('target_profile_id',new.id));
 end if;
 return new;
end;
$function$;
drop trigger if exists profiles_security_audit on public.profiles;
create trigger profiles_security_audit after update of role,active on public.profiles
for each row execute function public.audit_profile_security_changes();

create or replace function public.audit_device_security_changes()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
 if tg_op='INSERT' then
  insert into public.crm_security_events(profile_id,event_type,outcome,app_platform,app_version,os_name,browser_name,ip_address,ip_source,details)
  values(new.user_id,'device_registered','success',new.app_platform,new.app_version,new.os_name,new.browser_name,new.ip_address,new.ip_source,
    jsonb_build_object('session_id',new.id,'app_runtime',new.app_runtime));
 elsif old.ip_address is distinct from new.ip_address and new.ip_address is not null then
  insert into public.crm_security_events(profile_id,event_type,outcome,app_platform,ip_address,ip_source,details)
  values(new.user_id,'device_ip_changed','info',new.app_platform,new.ip_address,new.ip_source,
    jsonb_build_object('session_id',new.id,'previous_ip',old.ip_address,'current_ip',new.ip_address));
 end if;
 return new;
end;
$function$;
drop trigger if exists device_security_events_audit on public.device_security_sessions;
create trigger device_security_events_audit after insert or update of ip_address on public.device_security_sessions
for each row execute function public.audit_device_security_changes();

revoke all on function public.audit_crm_login_event() from public,anon,authenticated;
revoke all on function public.audit_profile_security_changes() from public,anon,authenticated;
revoke all on function public.audit_device_security_changes() from public,anon,authenticated;