-- Risk-only security monitoring: compact observations, threshold alerts,
-- short retention, and no routine successful-login/device event stream.

create table if not exists public.device_ip_observations(
 user_id uuid not null references auth.users(id) on delete cascade,
 ip_address inet not null, ip_source text,
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 observation_count integer not null default 1,
 primary key(user_id,ip_address)
);
create index if not exists device_ip_observations_ip_last_seen_idx on public.device_ip_observations(ip_address,last_seen_at desc);
alter table public.device_ip_observations enable row level security;
revoke all on public.device_ip_observations from public,anon,authenticated;
grant select,insert,update,delete on public.device_ip_observations to service_role;
insert into public.device_ip_observations(user_id,ip_address,ip_source,first_seen_at,last_seen_at,observation_count)
select user_id,ip_address,max(ip_source),min(started_at),max(last_seen_at),count(*)::integer
from public.device_security_sessions
where ip_address is not null and last_seen_at>now()-interval '30 days'
group by user_id,ip_address
on conflict(user_id,ip_address) do update set
 first_seen_at=least(public.device_ip_observations.first_seen_at,excluded.first_seen_at),
 last_seen_at=greatest(public.device_ip_observations.last_seen_at,excluded.last_seen_at),
 observation_count=greatest(public.device_ip_observations.observation_count,excluded.observation_count),
 ip_source=excluded.ip_source;
alter table public.device_security_sessions add column if not exists ip_change_window_started_at timestamptz;
alter table public.device_security_sessions add column if not exists ip_change_count_1h integer not null default 0;

create or replace function public.start_device_security_session(p_metadata jsonb)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare v_user uuid:=auth.uid(); v_id uuid; v_headers jsonb:=nullif(current_setting('request.headers',true),'')::jsonb; v_forwarded text; v_ip inet;
begin
 if v_user is null or not exists(select 1 from public.profiles p where p.id=v_user and p.active=true) then raise exception 'Active authenticated profile required' using errcode='42501'; end if;
 v_forwarded:=split_part(coalesce(v_headers->>'x-forwarded-for',v_headers->>'x-real-ip',''),',',1);
 if v_forwarded ~ '^[0-9a-fA-F:.]+$' then begin v_ip:=v_forwarded::inet; exception when others then v_ip:=null; end; end if;
 insert into public.device_security_sessions(user_id,app_platform,app_runtime,app_version,os_name,os_version,device_model,browser_name,user_agent,language,timezone,screen_width,screen_height,ip_address,ip_source,app_instance_id)
 values(v_user,coalesce(p_metadata->>'app_platform','web'),coalesce(p_metadata->>'app_runtime','browser'),nullif(p_metadata->>'app_version',''),nullif(p_metadata->>'os_name',''),nullif(p_metadata->>'os_version',''),nullif(p_metadata->>'device_model',''),nullif(p_metadata->>'browser_name',''),nullif(p_metadata->>'user_agent',''),nullif(p_metadata->>'language',''),nullif(p_metadata->>'timezone',''),nullif(p_metadata->>'screen_width','')::integer,nullif(p_metadata->>'screen_height','')::integer,v_ip,case when v_ip is null then null else 'supabase_gateway_forwarded_for' end,nullif(p_metadata->>'app_instance_id','')) returning id into v_id;
 if v_ip is not null then insert into public.device_ip_observations(user_id,ip_address,ip_source) values(v_user,v_ip,'supabase_gateway_forwarded_for') on conflict(user_id,ip_address) do update set last_seen_at=now(),observation_count=public.device_ip_observations.observation_count+1,ip_source=excluded.ip_source; end if;
 delete from public.device_security_sessions where last_seen_at<now()-interval '30 days';
 delete from public.device_ip_observations where last_seen_at<now()-interval '30 days';
 delete from public.device_network_events where recorded_at<now()-interval '30 days';
 delete from public.device_location_points where recorded_at<now()-interval '30 days';
 delete from public.crm_auth_failure_buckets where last_attempt_at<now()-interval '30 days';
 return v_id;
end;$function$;

create or replace function public.heartbeat_device_security_session(p_session_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $function$
declare v_user uuid:=auth.uid(); v_old_ip inet; v_forwarded text; v_ip inet; v_headers jsonb:=nullif(current_setting('request.headers',true),'')::jsonb; v_changed boolean:=false;
begin
 v_forwarded:=split_part(coalesce(v_headers->>'x-forwarded-for',v_headers->>'x-real-ip',''),',',1);
 if v_forwarded ~ '^[0-9a-fA-F:.]+$' then begin v_ip:=v_forwarded::inet; exception when others then v_ip:=null; end; end if;
 select ip_address into v_old_ip from public.device_security_sessions where id=p_session_id and user_id=v_user and ended_at is null for update;
 if not found then raise exception 'Active device session not found' using errcode='42501'; end if;
 update public.device_security_sessions set last_seen_at=now(),ip_address=coalesce(v_ip,ip_address),ip_source=case when v_ip is null then ip_source else 'supabase_gateway_forwarded_for' end,
 ip_change_count_1h=case when v_ip is not null and v_ip is distinct from v_old_ip then case when ip_change_window_started_at is null or ip_change_window_started_at<now()-interval '1 hour' then 1 else ip_change_count_1h+1 end else ip_change_count_1h end,
 ip_change_window_started_at=case when v_ip is not null and v_ip is distinct from v_old_ip and (ip_change_window_started_at is null or ip_change_window_started_at<now()-interval '1 hour') then now() else ip_change_window_started_at end
 where id=p_session_id and user_id=v_user and ended_at is null;
 if v_ip is not null then insert into public.device_ip_observations(user_id,ip_address,ip_source) values(v_user,v_ip,'supabase_gateway_forwarded_for') on conflict(user_id,ip_address) do update set last_seen_at=now(),observation_count=public.device_ip_observations.observation_count+1,ip_source=excluded.ip_source; end if;
 v_changed:=v_ip is not null and v_ip is distinct from v_old_ip;
 delete from public.device_security_sessions where last_seen_at<now()-interval '30 days';
 delete from public.device_ip_observations where last_seen_at<now()-interval '30 days';
 delete from public.device_network_events where recorded_at<now()-interval '30 days';
 delete from public.device_location_points where recorded_at<now()-interval '30 days';
 return v_changed;
end;$function$;

create or replace function public.record_device_location(p_session_id uuid,p_latitude double precision,p_longitude double precision,p_accuracy_m double precision default null,p_altitude_m double precision default null,p_heading_deg double precision default null,p_speed_mps double precision default null,p_source text default 'browser')
returns void language plpgsql security definer set search_path=''
as $function$
declare v_user uuid:=auth.uid(); v_last public.device_location_points%rowtype; v_distance_m double precision;
begin
 if v_user is null or not exists(select 1 from public.device_security_sessions s where s.id=p_session_id and s.user_id=v_user and s.ended_at is null and s.location_tracking_enabled=true) then raise exception 'Location tracking is not enabled for this session' using errcode='42501'; end if;
 if not exists(select 1 from public.attendance a where a.employee_id=v_user and a.check_out is null) then raise exception 'Location can only be recorded during an active attendance session' using errcode='42501'; end if;
 if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'Invalid location coordinates'; end if;
 select * into v_last from public.device_location_points where user_id=v_user order by recorded_at desc limit 1;
 if found then
  v_distance_m:=6371000*2*asin(sqrt(least(1,power(sin(radians(p_latitude-v_last.latitude)/2),2)+cos(radians(v_last.latitude))*cos(radians(p_latitude))*power(sin(radians(p_longitude-v_last.longitude)/2),2))));
  if now()-v_last.recorded_at<interval '10 minutes' and v_distance_m<250 then return; end if;
 end if;
 insert into public.device_location_points(session_id,user_id,latitude,longitude,accuracy_m,altitude_m,heading_deg,speed_mps,source) values(p_session_id,v_user,p_latitude,p_longitude,p_accuracy_m,p_altitude_m,p_heading_deg,p_speed_mps,case when p_source in ('browser','capacitor','electron') then p_source else 'browser' end);
end;$function$;

create or replace function public.admin_security_risk_alerts()
returns table(alert_key text,severity text,category text,title text,description text,evidence jsonb,first_seen timestamptz,last_seen timestamptz,affected_accounts integer)
language sql security definer set search_path=''
as $function$
with recent as (
 select s.*,p.full_name,p.email from public.device_security_sessions s join public.profiles p on p.id=s.user_id where s.last_seen_at>=now()-interval '30 days' and p.active=true
), shared_ips as (
 select ip_address,count(distinct user_id)::integer account_count,sum(observation_count)::integer observations,min(first_seen_at) first_seen,max(last_seen_at) last_seen,
 jsonb_agg(jsonb_build_object('user_id',user_id,'first_seen',first_seen_at,'last_seen',last_seen_at,'observations',observation_count)) accounts
 from public.device_ip_observations where last_seen_at>=now()-interval '30 days' group by ip_address having count(distinct user_id)>=2
), shared_devices as (
 select app_instance_id,count(distinct user_id)::integer account_count,count(*)::integer session_count,min(started_at) first_seen,max(last_seen_at) last_seen,jsonb_agg(distinct jsonb_build_object('user_id',user_id,'name',coalesce(full_name,email),'platform',app_platform,'last_seen',last_seen_at)) accounts
 from recent where app_instance_id is not null group by app_instance_id having count(distinct user_id)>=2
), many_devices as (
 select user_id,count(distinct app_instance_id)::integer device_count,min(started_at) first_seen,max(last_seen_at) last_seen from recent where app_instance_id is not null group by user_id having count(distinct app_instance_id)>=5
), ip_churn as (
 select user_id,count(*)::integer ip_count,min(first_seen_at) first_seen,max(last_seen_at) last_seen,jsonb_agg(ip_address::text) ips from public.device_ip_observations where last_seen_at>=now()-interval '30 days' group by user_id having count(*)>=8
), rapid_ip as (
 select user_id,max(ip_change_count_1h)::integer change_count,min(coalesce(ip_change_window_started_at,last_seen_at)) first_seen,max(last_seen_at) last_seen from recent where ip_change_count_1h>=3 and ip_change_window_started_at>=now()-interval '1 hour' group by user_id
), alerts as (
 select 'shared-ip:'||ip_address::text as alert_key,'medium'::text as severity,'shared_ip'::text as category,'Multiple accounts observed on the same IP'::text as title,
 'Several employee accounts used the same server-observed IP in 30 days. This is a review signal, not proof of shared physical location or fraud; VPNs, carrier NAT and network gateways can cause matches.'::text as description,
 jsonb_build_object('ip',ip_address::text,'observations',observations,'accounts',accounts,'ip_source','Supabase gateway forwarded header') as evidence,first_seen,last_seen,account_count as affected_accounts from shared_ips
 union all
 select 'shared-device:'||app_instance_id,'high','shared_device','Multiple accounts used the same app installation','The same persistent app-installation identifier has been seen with multiple employee accounts. This can indicate account sharing; browser storage resets, private browsing and reinstallations affect detection.',jsonb_build_object('app_instance_id',app_instance_id,'session_count',session_count,'accounts',accounts),first_seen,last_seen,account_count from shared_devices
 union all
 select 'device-count:'||user_id::text,'low','many_devices','One account used many app installations','This account appeared on five or more distinct app installations in 30 days. Review if unexpected.',jsonb_build_object('user_id',user_id,'device_count',device_count),first_seen,last_seen,1 from many_devices
 union all
 select 'ip-churn:'||user_id::text,'low','ip_churn','Frequent network IP changes','This account was observed from eight or more distinct IP addresses in 30 days. Mobile networks, VPNs and changing ISPs can explain this pattern.',jsonb_build_object('user_id',user_id,'ip_count',ip_count,'ips',ips),first_seen,last_seen,1 from ip_churn
 union all
 select 'rapid-ip:'||user_id::text,'medium','rapid_ip_change','Repeated IP changes within one hour','An active app session changed its server-observed IP at least three times in one hour. VPNs, proxies and carrier routing can cause this; review before action.',jsonb_build_object('user_id',user_id,'changes_in_window',change_count),first_seen,last_seen,1 from rapid_ip
)
select alerts.alert_key,alerts.severity,alerts.category,alerts.title,alerts.description,alerts.evidence,alerts.first_seen,alerts.last_seen,alerts.affected_accounts from alerts where public.is_active_admin() order by case alerts.severity when 'high' then 1 when 'medium' then 2 else 3 end,alerts.last_seen desc;
$function$;
revoke all on function public.admin_security_risk_alerts() from public,anon;
grant execute on function public.admin_security_risk_alerts() to authenticated;

create or replace function public.record_crm_failed_password(p_bucket_hash text,p_email_hash text,p_ip_address text default null)
returns table(attempt_count integer,should_notify boolean,matched_profile_id uuid) language plpgsql security definer set search_path=''
as $function$
declare v_attempts integer; v_notify boolean; v_profile uuid; v_ip inet;
begin
 if length(coalesce(p_bucket_hash,''))<32 or length(coalesce(p_email_hash,''))<32 then raise exception 'Invalid audit fingerprint' using errcode='22023'; end if;
 if p_ip_address ~ '^[0-9a-fA-F:.]+$' then begin v_ip:=p_ip_address::inet; exception when others then v_ip:=null; end; end if;
 insert into public.crm_auth_failure_buckets(bucket_hash,normalized_email_hash,ip_address,attempts,window_started_at,last_attempt_at) values(p_bucket_hash,p_email_hash,v_ip,1,now(),now())
 on conflict(bucket_hash) do update set attempts=case when public.crm_auth_failure_buckets.window_started_at<now()-interval '15 minutes' then 1 else public.crm_auth_failure_buckets.attempts+1 end,window_started_at=case when public.crm_auth_failure_buckets.window_started_at<now()-interval '15 minutes' then now() else public.crm_auth_failure_buckets.window_started_at end,last_attempt_at=now(),ip_address=coalesce(excluded.ip_address,public.crm_auth_failure_buckets.ip_address)
 returning attempts,(attempts>=5 and (alert_sent_at is null or alert_sent_at<now()-interval '1 hour')) into v_attempts,v_notify;
 select p.id into v_profile from public.profiles p where encode(sha256(convert_to(lower(trim(p.email)),'UTF8')),'hex')=p_email_hash and p.active=true limit 1;
 if v_notify then
  update public.crm_auth_failure_buckets set alert_sent_at=now() where bucket_hash=p_bucket_hash;
  insert into public.crm_security_events(profile_id,event_type,outcome,ip_address,ip_source,details) values(v_profile,'security_alert_triggered','info',v_ip,case when v_ip is null then null else 'supabase_gateway_forwarded_for' end,jsonb_build_object('category','repeated_failed_password','attempt_count',v_attempts,'window_minutes',15));
 end if;
 return query select v_attempts,coalesce(v_notify,false),v_profile;
end;$function$;
revoke all on function public.record_crm_failed_password(text,text,text) from public,anon,authenticated;
grant execute on function public.record_crm_failed_password(text,text,text) to service_role;

create or replace function public.admin_auth_failure_alerts()
returns table(alert_key text,severity text,category text,title text,description text,evidence jsonb,first_seen timestamptz,last_seen timestamptz,affected_accounts integer)
language sql security definer set search_path=''
as $function$
select ('auth-risk:'||e.id::text) as alert_key,(case when coalesce((e.details->>'attempt_count')::integer,0)>=10 then 'high' else 'medium' end)::text as severity,
 coalesce(e.details->>'category','authentication_risk') as category,'Repeated authentication verification failures'::text as title,
 'The CRM recorded a threshold-level burst of failed authentication attempts. Review the account and network evidence; a failed-attempt signal is not proof of compromise.'::text as description,
 jsonb_build_object('profile_id',e.profile_id,'ip_address',e.ip_address,'details',e.details) as evidence,e.occurred_at as first_seen,e.occurred_at as last_seen,1::integer as affected_accounts
from public.crm_security_events e where e.event_type='security_alert_triggered' and e.occurred_at>now()-interval '30 days' and e.details->>'category' in ('repeated_failed_password','failed_email_otp','failed_telegram_otp','invitation_email_otp','invitation_telegram_otp') and public.is_active_admin()
order by e.occurred_at desc limit 200;
$function$;
revoke all on function public.admin_auth_failure_alerts() from public,anon;
grant execute on function public.admin_auth_failure_alerts() to authenticated;

create or replace function public.record_crm_login(p_login_method text)
returns void language plpgsql security definer set search_path=''
as $function$
declare v_profile_id uuid:=auth.uid(); v_session_id uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
 if v_profile_id is null or v_session_id is null then raise exception 'Authenticated approved session is required' using errcode='42501'; end if;
 if p_login_method not in ('password_2fa','telegram_otp','invitation_registration') then raise exception 'Invalid CRM login method' using errcode='22023'; end if;
 if not exists(select 1 from public.profiles p where p.id=v_profile_id and p.active=true) then raise exception 'An active CRM profile is required' using errcode='42501'; end if;
 if not exists(select 1 from public.crm_login_sessions s where s.session_id=v_session_id and s.user_id=v_profile_id and s.expires_at>now()) then raise exception 'This session has not completed CRM login verification' using errcode='42501'; end if;
end;$function$;
revoke all on function public.record_crm_login(text) from public,anon;
grant execute on function public.record_crm_login(text) to authenticated;
drop trigger if exists crm_login_security_audit on public.crm_login_events;
drop trigger if exists device_security_events_audit on public.device_security_sessions;
delete from public.crm_security_events where event_type in ('login_success','logout','device_registered','device_ip_changed','invitation_accepted','attendance_correction_submitted','attendance_correction_reviewed','attendance_correction_applied');
truncate table public.crm_login_events;
truncate table public.device_network_events;
