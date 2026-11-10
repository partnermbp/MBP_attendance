create table if not exists public.device_network_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.device_security_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  previous_ip inet,
  current_ip inet not null,
  source text not null default 'supabase_gateway_forwarded_for',
  recorded_at timestamptz not null default now()
);
create index if not exists device_network_events_session_time_idx
  on public.device_network_events(session_id,recorded_at desc);
alter table public.device_network_events enable row level security;
revoke all on public.device_network_events from anon,authenticated;
grant select on public.device_network_events to authenticated;
drop policy if exists device_network_events_admin_read on public.device_network_events;
create policy device_network_events_admin_read on public.device_network_events
for select to authenticated using (public.is_active_admin());

create or replace function public.start_device_security_session(p_metadata jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_headers jsonb := nullif(current_setting('request.headers',true),'')::jsonb;
  v_forwarded text;
  v_ip inet;
begin
  if v_user is null or not exists(select 1 from public.profiles p where p.id=v_user and p.active=true) then
    raise exception 'Active authenticated profile required' using errcode='42501';
  end if;
  v_forwarded := split_part(coalesce(v_headers->>'x-forwarded-for',v_headers->>'x-real-ip',''),',',1);
  if v_forwarded ~ '^[0-9a-fA-F:.]+$' then
    begin v_ip := v_forwarded::inet; exception when others then v_ip := null; end;
  end if;
  insert into public.device_security_sessions(
    user_id,app_platform,app_runtime,app_version,os_name,os_version,device_model,
    browser_name,user_agent,language,timezone,screen_width,screen_height,ip_address,ip_source
  ) values (
    v_user,
    coalesce(p_metadata->>'app_platform','web'),
    coalesce(p_metadata->>'app_runtime','browser'),
    nullif(p_metadata->>'app_version',''),
    nullif(p_metadata->>'os_name',''),
    nullif(p_metadata->>'os_version',''),
    nullif(p_metadata->>'device_model',''),
    nullif(p_metadata->>'browser_name',''),
    nullif(p_metadata->>'user_agent',''),
    nullif(p_metadata->>'language',''),
    nullif(p_metadata->>'timezone',''),
    nullif(p_metadata->>'screen_width','')::integer,
    nullif(p_metadata->>'screen_height','')::integer,
    v_ip,
    case when v_ip is null then null else 'supabase_gateway_forwarded_for' end
  ) returning id into v_id;
  if v_ip is not null then
    insert into public.device_network_events(session_id,user_id,current_ip)
    values(v_id,v_user,v_ip);
  end if;
  return v_id;
end;
$function$;

create or replace function public.heartbeat_device_security_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_old_ip inet;
  v_forwarded text;
  v_ip inet;
  v_headers jsonb := nullif(current_setting('request.headers',true),'')::jsonb;
begin
  v_forwarded := split_part(coalesce(v_headers->>'x-forwarded-for',v_headers->>'x-real-ip',''),',',1);
  if v_forwarded ~ '^[0-9a-fA-F:.]+$' then
    begin v_ip := v_forwarded::inet; exception when others then v_ip := null; end;
  end if;
  select ip_address into v_old_ip
  from public.device_security_sessions
  where id=p_session_id and user_id=v_user and ended_at is null
  for update;
  if not found then raise exception 'Active device session not found' using errcode='42501'; end if;
  update public.device_security_sessions
  set last_seen_at=now(),
      ip_address=coalesce(v_ip,ip_address),
      ip_source=case when v_ip is null then ip_source else 'supabase_gateway_forwarded_for' end
  where id=p_session_id and user_id=v_user and ended_at is null;
  if v_ip is not null and v_ip is distinct from v_old_ip then
    insert into public.device_network_events(session_id,user_id,previous_ip,current_ip)
    values(p_session_id,v_user,v_old_ip,v_ip);
  end if;
end;
$function$;

revoke all on function public.start_device_security_session(jsonb) from public,anon;
revoke all on function public.heartbeat_device_security_session(uuid) from public,anon;
grant execute on function public.start_device_security_session(jsonb) to authenticated;
grant execute on function public.heartbeat_device_security_session(uuid) to authenticated;
