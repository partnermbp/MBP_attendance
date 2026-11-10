alter table public.device_security_sessions add column if not exists app_instance_id text;
create index if not exists device_security_sessions_instance_idx
  on public.device_security_sessions(app_instance_id,last_seen_at desc)
  where app_instance_id is not null;

create or replace function public.start_device_security_session(p_metadata jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := auth.uid(); v_id uuid;
  v_headers jsonb := nullif(current_setting('request.headers',true),'')::jsonb;
  v_forwarded text; v_ip inet;
begin
  if v_user is null or not exists(select 1 from public.profiles p where p.id=v_user and p.active=true) then
    raise exception 'Active authenticated profile required' using errcode='42501';
  end if;
  v_forwarded := split_part(coalesce(v_headers->>'x-forwarded-for',v_headers->>'x-real-ip',''),',',1);
  if v_forwarded ~ '^[0-9a-fA-F:.]+$' then
    begin v_ip := v_forwarded::inet; exception when others then v_ip := null; end;
  end if;
  insert into public.device_security_sessions(user_id,app_platform,app_runtime,app_version,os_name,os_version,device_model,browser_name,user_agent,language,timezone,screen_width,screen_height,ip_address,ip_source,app_instance_id)
  values(v_user,coalesce(p_metadata->>'app_platform','web'),coalesce(p_metadata->>'app_runtime','browser'),
    nullif(p_metadata->>'app_version',''),nullif(p_metadata->>'os_name',''),nullif(p_metadata->>'os_version',''),
    nullif(p_metadata->>'device_model',''),nullif(p_metadata->>'browser_name',''),nullif(p_metadata->>'user_agent',''),
    nullif(p_metadata->>'language',''),nullif(p_metadata->>'timezone',''),nullif(p_metadata->>'screen_width','')::integer,
    nullif(p_metadata->>'screen_height','')::integer,v_ip,
    case when v_ip is null then null else 'supabase_gateway_forwarded_for' end,nullif(p_metadata->>'app_instance_id',''))
  returning id into v_id;
  if v_ip is not null then
    insert into public.device_network_events(session_id,user_id,current_ip) values(v_id,v_user,v_ip);
  end if;
  return v_id;
end;
$function$;

create or replace function public.admin_security_risk_alerts()
returns table (alert_key text,severity text,category text,title text,description text,evidence jsonb,first_seen timestamptz,last_seen timestamptz,affected_accounts integer)
language sql security definer set search_path = ''
as $function$
with recent as (
 select s.*,p.full_name,p.email from public.device_security_sessions s join public.profiles p on p.id=s.user_id
 where s.last_seen_at>=now()-interval '30 days' and p.active=true
), shared_ips as (
 select ip_address,count(distinct user_id)::integer account_count,count(*)::integer session_count,min(started_at) first_seen,max(last_seen_at) last_seen,
 jsonb_agg(distinct jsonb_build_object('user_id',user_id,'name',coalesce(full_name,email),'platform',app_platform,'last_seen',last_seen_at)) accounts
 from recent where ip_address is not null group by ip_address having count(distinct user_id)>=2
), shared_devices as (
 select app_instance_id,count(distinct user_id)::integer account_count,count(*)::integer session_count,min(started_at) first_seen,max(last_seen_at) last_seen,
 jsonb_agg(distinct jsonb_build_object('user_id',user_id,'name',coalesce(full_name,email),'platform',app_platform,'last_seen',last_seen_at)) accounts
 from recent where app_instance_id is not null group by app_instance_id having count(distinct user_id)>=2
), many_devices as (
 select user_id,count(distinct app_instance_id)::integer device_count,min(started_at) first_seen,max(last_seen_at) last_seen,
 jsonb_agg(distinct jsonb_build_object('platform',app_platform,'device',coalesce(device_model,os_name),'last_seen',last_seen_at)) devices
 from recent where app_instance_id is not null group by user_id having count(distinct app_instance_id)>=5
), ip_churn as (
 select user_id,count(distinct ip_address)::integer ip_count,min(started_at) first_seen,max(last_seen_at) last_seen,
 jsonb_agg(distinct ip_address::text) ips from recent where ip_address is not null group by user_id having count(distinct ip_address)>=8
), alerts as (
 select 'shared-ip:'||ip_address::text alert_key,case when account_count>=4 then 'high' else 'medium' end severity,'shared_ip'::text category,
 'Multiple accounts observed on the same IP'::text title,
 'Several employee accounts used the same server-observed IP in 30 days. This is a review signal, not proof of shared physical location or fraud; VPNs, carrier NAT and network gateways can cause matches.'::text description,
 jsonb_build_object('ip',ip_address::text,'session_count',session_count,'accounts',accounts,'ip_source','Supabase gateway forwarded header') evidence,first_seen,last_seen,account_count affected_accounts
 from shared_ips
 union all
 select 'shared-device:'||app_instance_id,'high','shared_device','Multiple accounts used the same app installation',
 'The same persistent app-installation identifier has been seen with multiple employee accounts. This is a strong device-sharing signal; browser storage resets, private browsing and reinstallations affect detection.',
 jsonb_build_object('app_instance_id',app_instance_id,'session_count',session_count,'accounts',accounts),first_seen,last_seen,account_count from shared_devices
 union all
 select 'device-count:'||user_id::text,'low','many_devices','One account used many app installations',
 'This account appeared on five or more distinct app installations in 30 days. Could reflect normal device changes; review if unexpected.',
 jsonb_build_object('user_id',user_id,'device_count',device_count,'devices',devices),first_seen,last_seen,1 from many_devices
 union all
 select 'ip-churn:'||user_id::text,'low','ip_churn','Frequent network IP changes',
 'This account was observed from eight or more IP addresses in 30 days. Mobile networks, VPNs and changing ISPs can explain this pattern.',
 jsonb_build_object('user_id',user_id,'ip_count',ip_count,'ips',ips),first_seen,last_seen,1 from ip_churn
)
select * from alerts where public.is_active_admin()
order by case alerts.severity when 'high' then 1 when 'medium' then 2 else 3 end,alerts.last_seen desc;
$function$;
revoke all on function public.admin_security_risk_alerts() from public,anon;
grant execute on function public.admin_security_risk_alerts() to authenticated;
