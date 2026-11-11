create or replace function public.audit_profile_security_changes()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_actor uuid:=auth.uid(); v_sessions integer:=0;
begin
 if old.role is distinct from new.role then
  insert into public.crm_security_events(profile_id,event_type,outcome,details)
  values(coalesce(v_actor,new.id),'role_changed','success',jsonb_build_object('target_profile_id',new.id,'old_role',old.role::text,'new_role',new.role::text));
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