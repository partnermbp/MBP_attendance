create or replace function public.admin_concurrent_session_alerts()
returns table(alert_key text,severity text,category text,title text,description text,evidence jsonb,first_seen timestamptz,last_seen timestamptz,affected_accounts integer)
language sql security definer set search_path=''
as $function$
with simultaneous as(
 select s.user_id,count(*)::integer session_count,count(distinct s.app_instance_id)::integer installation_count,
 min(s.started_at) first_seen,max(s.last_seen_at) last_seen,
 jsonb_agg(jsonb_build_object('session_id',s.id,'platform',s.app_platform,'runtime',s.app_runtime,'app_instance_id',s.app_instance_id,'last_seen',s.last_seen_at)) sessions
 from public.device_security_sessions s
 join public.profiles p on p.id=s.user_id and p.active=true
 where s.ended_at is null and s.last_seen_at>now()-interval '3 minutes' and s.app_instance_id is not null
 group by s.user_id having count(distinct s.app_instance_id)>=2
)
select ('concurrent-installations:'||user_id::text),'high'::text,'concurrent_sessions'::text,
 'One account is active on multiple app installations'::text,
 'The same account sent recent heartbeats from two or more distinct app installations within the same three-minute window. This can indicate credential sharing or an authorized multi-device user; review before action.'::text,
 jsonb_build_object('user_id',user_id,'active_sessions',session_count,'distinct_installations',installation_count,'sessions',sessions),
 first_seen,last_seen,1::integer
from simultaneous where public.is_active_admin()
order by last_seen desc;
$function$;
revoke all on function public.admin_concurrent_session_alerts() from public,anon;
grant execute on function public.admin_concurrent_session_alerts() to authenticated;

create or replace function public.audit_device_security_changes()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
 if tg_op='INSERT' then
  if new.app_instance_id is null or not exists(
    select 1 from public.device_security_sessions s
    where s.user_id=new.user_id and s.app_instance_id=new.app_instance_id and s.id<>new.id
  ) then
   insert into public.crm_security_events(profile_id,event_type,outcome,app_platform,app_version,os_name,browser_name,ip_address,ip_source,details)
   values(new.user_id,'device_registered','success',new.app_platform,new.app_version,new.os_name,new.browser_name,new.ip_address,new.ip_source,
     jsonb_build_object('session_id',new.id,'app_runtime',new.app_runtime,'app_instance_id',new.app_instance_id));
  end if;
 elsif old.ip_address is distinct from new.ip_address and new.ip_address is not null then
  insert into public.crm_security_events(profile_id,event_type,outcome,app_platform,ip_address,ip_source,details)
  values(new.user_id,'device_ip_changed','info',new.app_platform,new.ip_address,new.ip_source,
    jsonb_build_object('session_id',new.id,'previous_ip',old.ip_address,'current_ip',new.ip_address));
 end if;
 return new;
end;
$function$;
revoke all on function public.audit_device_security_changes() from public,anon,authenticated;