create or replace function public.admin_auth_failure_alerts()
returns table(alert_key text,severity text,category text,title text,description text,evidence jsonb,first_seen timestamptz,last_seen timestamptz,affected_accounts integer)
language sql security definer set search_path=''
as $function$
with failed_password as(
 select e.profile_id,e.ip_address,count(*)::integer attempts,min(e.occurred_at) first_seen,max(e.occurred_at) last_seen
 from public.crm_security_events e
 where e.event_type='failed_password' and e.outcome='failure' and e.occurred_at>now()-interval '30 days' and e.profile_id is not null
 group by e.profile_id,e.ip_address having count(*)>=5
), failed_otp as(
 select e.profile_id,e.event_type,count(*)::integer attempts,min(e.occurred_at) first_seen,max(e.occurred_at) last_seen
 from public.crm_security_events e
 where e.event_type in ('failed_email_otp','failed_telegram_otp') and e.outcome='failure' and e.occurred_at>now()-interval '30 days'
 group by e.profile_id,e.event_type having count(*)>=5
), alerts as(
 select ('failed-password:'||profile_id::text||':'||coalesce(ip_address::text,'unknown')) alert_key,
 case when attempts>=10 then 'high' else 'medium' end severity,'failed_password'::text category,
 'Repeated failed password sign-in reports'::text title,
 'At least five failed sign-in attempts were reported by the CRM client for this account/network in 30 days. These events are client-reported and cannot independently prove that Supabase Auth rejected a password; review alongside Auth logs and gateway evidence.'::text description,
 jsonb_build_object('profile_id',profile_id,'observed_ip',ip_address,'reported_attempts',attempts,'source','client_reported') evidence,first_seen,last_seen,1::integer affected_accounts from failed_password
 union all
 select ('failed-otp:'||profile_id::text||':'||event_type),case when attempts>=10 then 'high' else 'medium' end,
 event_type,'Repeated failed verification codes'::text,
 'At least five incorrect one-time verification codes were submitted for this account or its invitation. Review the associated audit events and challenge state.'::text,
 jsonb_build_object('profile_id',profile_id,'verification_type',event_type,'failed_attempts',attempts),first_seen,last_seen,1::integer from failed_otp
)
select alert_key,severity,category,title,description,evidence,first_seen,last_seen,affected_accounts from alerts
where public.is_active_admin()
order by case severity when 'high' then 1 when 'medium' then 2 else 3 end,last_seen desc;
$function$;
revoke all on function public.admin_auth_failure_alerts() from public,anon;
grant execute on function public.admin_auth_failure_alerts() to authenticated;