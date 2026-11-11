drop policy if exists crm_login_events_admin_supervisor_read on public.crm_login_events;
drop policy if exists crm_login_events_admin_read on public.crm_login_events;
create policy crm_login_events_admin_read on public.crm_login_events for select to authenticated using(public.is_active_admin());
drop policy if exists suspicious_activities_admin_supervisor_read on public.suspicious_activities;
drop policy if exists suspicious_activities_admin_read on public.suspicious_activities;
create policy suspicious_activities_admin_read on public.suspicious_activities for select to authenticated using(public.is_active_admin());