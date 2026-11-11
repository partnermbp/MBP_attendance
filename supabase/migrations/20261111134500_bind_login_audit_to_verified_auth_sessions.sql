alter table public.crm_login_events add column if not exists session_id uuid;
create unique index if not exists crm_login_events_session_unique on public.crm_login_events(session_id) where session_id is not null;

create or replace function public.record_crm_login(p_login_method text)
returns void language plpgsql security definer set search_path=''
as $function$
declare
 v_profile_id uuid:=auth.uid();
 v_session_id uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
 if v_profile_id is null or v_session_id is null then raise exception 'Authenticated approved session is required' using errcode='42501'; end if;
 if p_login_method not in ('password_2fa','telegram_otp','invitation_registration') then raise exception 'Invalid CRM login method' using errcode='22023'; end if;
 if not exists(select 1 from public.profiles p where p.id=v_profile_id and p.active=true) then raise exception 'An active CRM profile is required' using errcode='42501'; end if;
 if not exists(select 1 from public.crm_login_sessions s where s.session_id=v_session_id and s.user_id=v_profile_id and s.expires_at>now()) then
  raise exception 'This session has not completed CRM login verification' using errcode='42501';
 end if;
 insert into public.crm_login_events(profile_id,login_method,session_id)
 values(v_profile_id,p_login_method,v_session_id)
 on conflict(session_id) where session_id is not null do nothing;
end;
$function$;
revoke all on function public.record_crm_login(text) from public,anon;
grant execute on function public.record_crm_login(text) to authenticated;

create or replace function public.audit_crm_login_event()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
 insert into public.crm_security_events(profile_id,event_type,outcome,login_method,ip_address,ip_source,details,occurred_at)
 values(new.profile_id,'login_success','success',new.login_method,
   nullif(split_part(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-forwarded-for',''),',',1),'')::inet,
   'supabase_gateway_forwarded_for',jsonb_build_object('source','record_crm_login','session_id',new.session_id),new.logged_at);
 return new;
exception when others then
 insert into public.crm_security_events(profile_id,event_type,outcome,login_method,details,occurred_at)
 values(new.profile_id,'login_success','success',new.login_method,jsonb_build_object('source','record_crm_login','session_id',new.session_id,'ip_capture','unavailable'),new.logged_at);
 return new;
end;
$function$;