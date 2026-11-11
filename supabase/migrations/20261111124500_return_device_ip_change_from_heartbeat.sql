drop function if exists public.heartbeat_device_security_session(uuid);
create function public.heartbeat_device_security_session(p_session_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $function$
declare
 v_user uuid:=auth.uid(); v_old_ip inet; v_forwarded text; v_ip inet;
 v_headers jsonb:=nullif(current_setting('request.headers',true),'')::jsonb;
 v_changed boolean:=false;
begin
 v_forwarded:=split_part(coalesce(v_headers->>'x-forwarded-for',v_headers->>'x-real-ip',''),',',1);
 if v_forwarded ~ '^[0-9a-fA-F:.]+$' then begin v_ip:=v_forwarded::inet; exception when others then v_ip:=null; end; end if;
 select ip_address into v_old_ip from public.device_security_sessions
 where id=p_session_id and user_id=v_user and ended_at is null for update;
 if not found then raise exception 'Active device session not found' using errcode='42501'; end if;
 update public.device_security_sessions set last_seen_at=now(),ip_address=coalesce(v_ip,ip_address),
 ip_source=case when v_ip is null then ip_source else 'supabase_gateway_forwarded_for' end
 where id=p_session_id and user_id=v_user and ended_at is null;
 if v_ip is not null and v_ip is distinct from v_old_ip then
  insert into public.device_network_events(session_id,user_id,previous_ip,current_ip)
  values(p_session_id,v_user,v_old_ip,v_ip);
  v_changed:=true;
 end if;
 return v_changed;
end;
$function$;
revoke all on function public.heartbeat_device_security_session(uuid) from public,anon;
grant execute on function public.heartbeat_device_security_session(uuid) to authenticated;