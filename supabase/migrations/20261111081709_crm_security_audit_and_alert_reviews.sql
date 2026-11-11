-- Append-only CRM security history and administrator review workflow.
create table if not exists public.crm_security_events (
  id bigint generated always as identity primary key,
  profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('login_success','logout','failed_email_otp','failed_telegram_otp','device_registered','device_ip_changed','session_revoked','attendance_correction_submitted','attendance_correction_applied','role_changed','account_deactivated','invitation_accepted','telegram_identity_changed','security_alert_reviewed')),
  outcome text not null default 'info' check (outcome in ('success','failure','blocked','info')),
  login_method text, app_platform text, app_version text, os_name text, browser_name text,
  ip_address inet, ip_source text, user_agent text,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists crm_security_events_profile_time_idx on public.crm_security_events(profile_id,occurred_at desc);
create index if not exists crm_security_events_type_time_idx on public.crm_security_events(event_type,occurred_at desc);
alter table public.crm_security_events enable row level security;
revoke all on public.crm_security_events from anon,authenticated;
grant select on public.crm_security_events to authenticated;
drop policy if exists crm_security_events_admin_read on public.crm_security_events;
create policy crm_security_events_admin_read on public.crm_security_events for select to authenticated using(public.is_active_admin());
drop policy if exists crm_security_events_own_read on public.crm_security_events;
create policy crm_security_events_own_read on public.crm_security_events for select to authenticated using(profile_id=(select auth.uid()) and not exists(select 1 from public.profiles p where p.id=(select auth.uid()) and lower(p.role::text)='supervisor'));

create table if not exists public.security_alert_reviews (
 alert_key text primary key,
 status text not null default 'in_review' check(status in ('in_review','false_positive','confirmed','resolved')),
 review_note text not null default '',
 reviewed_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.security_alert_reviews enable row level security;
revoke all on public.security_alert_reviews from anon,authenticated;
grant select,insert,update on public.security_alert_reviews to authenticated;
drop policy if exists security_alert_reviews_admin_select on public.security_alert_reviews;
create policy security_alert_reviews_admin_select on public.security_alert_reviews for select to authenticated using(public.is_active_admin());
drop policy if exists security_alert_reviews_admin_insert on public.security_alert_reviews;
create policy security_alert_reviews_admin_insert on public.security_alert_reviews for insert to authenticated with check(public.is_active_admin() and reviewed_by=(select auth.uid()));
drop policy if exists security_alert_reviews_admin_update on public.security_alert_reviews;
create policy security_alert_reviews_admin_update on public.security_alert_reviews for update to authenticated using(public.is_active_admin()) with check(public.is_active_admin() and reviewed_by=(select auth.uid()));

create or replace function public.record_crm_security_event(p_event_type text,p_outcome text default 'info',p_login_method text default null,p_app_platform text default null,p_app_version text default null,p_os_name text default null,p_browser_name text default null,p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path=''
as $function$
declare v_user uuid:=auth.uid(); v_headers jsonb:=nullif(current_setting('request.headers',true),'')::jsonb; v_forwarded text; v_ip inet;
begin
 if v_user is null or not exists(select 1 from public.profiles p where p.id=v_user and p.active=true) then raise exception 'Active authenticated profile required' using errcode='42501'; end if;
 if p_event_type not in ('login_success','logout','device_registered','device_ip_changed') then raise exception 'Unsupported client security event' using errcode='22023'; end if;
 if p_outcome not in ('success','failure','blocked','info') then raise exception 'Invalid security event outcome' using errcode='22023'; end if;
 v_forwarded:=split_part(coalesce(v_headers->>'x-forwarded-for',v_headers->>'x-real-ip',''),',',1);
 if v_forwarded ~ '^[0-9a-fA-F:.]+$' then begin v_ip:=v_forwarded::inet; exception when others then v_ip:=null; end; end if;
 insert into public.crm_security_events(profile_id,event_type,outcome,login_method,app_platform,app_version,os_name,browser_name,ip_address,ip_source,user_agent,details)
 values(v_user,p_event_type,p_outcome,p_login_method,p_app_platform,p_app_version,p_os_name,p_browser_name,v_ip,case when v_ip is null then null else 'supabase_gateway_forwarded_for' end,left(coalesce(v_headers->>'user-agent',''),1000),case when jsonb_typeof(p_details)='object' then p_details else '{}'::jsonb end);
end;
$function$;
revoke all on function public.record_crm_security_event(text,text,text,text,text,text,text,jsonb) from public,anon;
grant execute on function public.record_crm_security_event(text,text,text,text,text,text,text,jsonb) to authenticated;

create or replace function public.admin_review_security_alert(p_alert_key text,p_status text,p_review_note text default '')
returns void language plpgsql security definer set search_path=''
as $function$
begin
 if not public.is_active_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_status not in ('in_review','false_positive','confirmed','resolved') then raise exception 'Invalid review status' using errcode='22023'; end if;
 if nullif(trim(p_alert_key),'') is null then raise exception 'Alert key is required' using errcode='22023'; end if;
 insert into public.security_alert_reviews(alert_key,status,review_note,reviewed_by,updated_at) values(p_alert_key,p_status,left(coalesce(p_review_note,''),2000),auth.uid(),now())
 on conflict(alert_key) do update set status=excluded.status,review_note=excluded.review_note,reviewed_by=excluded.reviewed_by,updated_at=now();
 insert into public.crm_security_events(profile_id,event_type,outcome,details) values(auth.uid(),'security_alert_reviewed','success',jsonb_build_object('alert_key',p_alert_key,'status',p_status));
end;
$function$;
revoke all on function public.admin_review_security_alert(text,text,text) from public,anon;
grant execute on function public.admin_review_security_alert(text,text,text) to authenticated;

-- Supervisors must not read authentication or suspicious-activity logs.
drop policy if exists crm_login_events_admin_supervisor_read on public.crm_login_events;
drop policy if exists crm_login_events_admin_read on public.crm_login_events;
create policy crm_login_events_admin_read on public.crm_login_events for select to authenticated using(public.is_active_admin());
drop policy if exists suspicious_activities_admin_supervisor_read on public.suspicious_activities;
drop policy if exists suspicious_activities_admin_read on public.suspicious_activities;
create policy suspicious_activities_admin_read on public.suspicious_activities for select to authenticated using(public.is_active_admin());
