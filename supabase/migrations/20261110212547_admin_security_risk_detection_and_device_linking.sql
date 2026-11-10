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
