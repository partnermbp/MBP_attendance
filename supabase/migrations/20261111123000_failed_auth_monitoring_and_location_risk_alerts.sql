alter table public.crm_security_events drop constraint if exists crm_security_events_event_type_check;
alter table public.crm_security_events add constraint crm_security_events_event_type_check check(event_type in ('login_success','logout','failed_password','failed_email_otp','failed_telegram_otp','device_registered','device_ip_changed','session_revoked','attendance_correction_submitted','attendance_correction_applied','role_changed','account_deactivated','invitation_accepted','telegram_identity_changed','security_alert_reviewed','security_alert_triggered'));
create table if not exists public.crm_auth_failure_buckets(bucket_hash text primary key,normalized_email_hash text not null,ip_address inet,attempts integer not null default 0,window_started_at timestamptz not null default now(),last_attempt_at timestamptz not null default now(),alert_sent_at timestamptz);
alter table public.crm_auth_failure_buckets enable row level security;
revoke all on public.crm_auth_failure_buckets from public,anon,authenticated;
create or replace function public.record_crm_failed_password(p_bucket_hash text,p_email_hash text,p_ip_address text default null)
returns table(attempt_count integer,should_notify boolean,matched_profile_id uuid) language plpgsql security definer set search_path=''
as $function$
declare v_attempts integer; v_notify boolean; v_profile uuid; v_ip inet;
begin
 if length(coalesce(p_bucket_hash,''))<32 or length(coalesce(p_email_hash,''))<32 then raise exception 'Invalid audit fingerprint' using errcode='22023'; end if;
 if p_ip_address ~ '^[0-9a-fA-F:.]+$' then begin v_ip:=p_ip_address::inet; exception when others then v_ip:=null; end; end if;
 insert into public.crm_auth_failure_buckets(bucket_hash,normalized_email_hash,ip_address,attempts,window_started_at,last_attempt_at) values(p_bucket_hash,p_email_hash,v_ip,1,now(),now())
 on conflict(bucket_hash) do update set attempts=case when public.crm_auth_failure_buckets.window_started_at<now()-interval '15 minutes' then 1 else public.crm_auth_failure_buckets.attempts+1 end,
 window_started_at=case when public.crm_auth_failure_buckets.window_started_at<now()-interval '15 minutes' then now() else public.crm_auth_failure_buckets.window_started_at end,
 last_attempt_at=now(),ip_address=coalesce(excluded.ip_address,public.crm_auth_failure_buckets.ip_address)
 returning attempts,(attempts>=5 and (alert_sent_at is null or alert_sent_at<now()-interval '1 hour')) into v_attempts,v_notify;
 select p.id into v_profile from public.profiles p where encode(sha256(convert_to(lower(trim(p.email)),'UTF8')),'hex')=p_email_hash and p.active=true limit 1;
 insert into public.crm_security_events(profile_id,event_type,outcome,ip_address,ip_source,details) values(v_profile,'failed_password','failure',v_ip,case when v_ip is null then null else 'supabase_gateway_forwarded_for' end,jsonb_build_object('attempt_count',v_attempts,'email_fingerprint',p_email_hash,'bucket_window_minutes',15));
 if v_notify then
 update public.crm_auth_failure_buckets set alert_sent_at=now() where bucket_hash=p_bucket_hash;
 insert into public.crm_security_events(profile_id,event_type,outcome,ip_address,ip_source,details) values(v_profile,'security_alert_triggered','info',v_ip,case when v_ip is null then null else 'supabase_gateway_forwarded_for' end,jsonb_build_object('category','repeated_failed_password','attempt_count',v_attempts,'email_fingerprint',p_email_hash));
 end if;
 return query select v_attempts,coalesce(v_notify,false),v_profile;
end;$function$;
revoke all on function public.record_crm_failed_password(text,text,text) from public,anon,authenticated;
grant execute on function public.record_crm_failed_password(text,text,text) to service_role;

create or replace function public.admin_location_risk_alerts()
returns table(alert_key text,severity text,category text,title text,description text,evidence jsonb,first_seen timestamptz,last_seen timestamptz,affected_accounts integer)
language sql security definer set search_path=''
as $function$
with points as(
 select p.user_id,p.latitude,p.longitude,p.accuracy_m,p.recorded_at,
 lag(p.latitude) over(partition by p.user_id order by p.recorded_at) prev_lat,
 lag(p.longitude) over(partition by p.user_id order by p.recorded_at) prev_lng,
 lag(p.recorded_at) over(partition by p.user_id order by p.recorded_at) prev_time
 from public.device_location_points p join public.profiles pr on pr.id=p.user_id and pr.active=true
 where p.recorded_at>now()-interval '30 days' and p.accuracy_m is not null and p.accuracy_m<=200
), travel as(
 select user_id,prev_time,recorded_at,6371*2*asin(sqrt(least(1,power(sin(radians(latitude-prev_lat)/2),2)+cos(radians(prev_lat))*cos(radians(latitude))*power(sin(radians(longitude-prev_lng)/2),2)))) distance_km
 from points where prev_time is not null and recorded_at-prev_time between interval '2 minutes' and interval '12 hours'
), impossible as(
 select t.user_id,min(t.prev_time) first_seen,max(t.recorded_at) last_seen,max(t.distance_km/(extract(epoch from(t.recorded_at-t.prev_time))/3600.0)) max_speed
 from travel t where t.distance_km/(extract(epoch from(t.recorded_at-t.prev_time))/3600.0)>500 group by t.user_id
), colocated as(
 select a.user_id u1,b.user_id u2,min(a.recorded_at) first_seen,max(a.recorded_at) last_seen,count(*) matches
 from public.device_location_points a join public.device_location_points b on a.user_id<b.user_id
 and a.recorded_at>now()-interval '7 days' and b.recorded_at between a.recorded_at-interval '10 minutes' and a.recorded_at+interval '10 minutes'
 and a.accuracy_m<=100 and b.accuracy_m<=100
 and 6371000*2*asin(sqrt(least(1,power(sin(radians(a.latitude-b.latitude)/2),2)+cos(radians(b.latitude))*cos(radians(a.latitude))*power(sin(radians(a.longitude-b.longitude)/2),2))))<=100
 group by a.user_id,b.user_id having count(*)>=3
), alerts as(
 select ('impossible-travel:'||user_id::text) as alert_key,'high'::text as severity,'impossible_travel'::text as category,'Implausible travel between consented location points'::text as title,
 'Two consented, high-accuracy shift location points imply travel above 500 km/h. GPS error, stale fixes or device anomalies can cause false positives; review before action.'::text as description,
 jsonb_build_object('user_id',user_id,'max_implied_speed_kmh',round(max_speed::numeric,1)) as evidence,first_seen,last_seen,1::integer as affected_accounts from impossible
 union all
 select ('repeated-location:'||u1::text||':'||u2::text),'medium'::text,'repeated_location'::text,'Two employee accounts repeatedly shared a location'::text,
 'Two accounts recorded three or more high-accuracy points within 100 metres and ten minutes of each other during consented shift tracking. Shared workplaces and GPS limitations can explain this.'::text,
 jsonb_build_object('user_ids',jsonb_build_array(u1,u2),'matching_points',matches,'radius_metres',100),first_seen,last_seen,2::integer from colocated
)
select alert_key,severity,category,title,description,evidence,first_seen,last_seen,affected_accounts from alerts where public.is_active_admin()
order by case alerts.severity when 'high' then 1 when 'medium' then 2 else 3 end,alerts.last_seen desc;
$function$;
revoke all on function public.admin_location_risk_alerts() from public,anon;
grant execute on function public.admin_location_risk_alerts() to authenticated;