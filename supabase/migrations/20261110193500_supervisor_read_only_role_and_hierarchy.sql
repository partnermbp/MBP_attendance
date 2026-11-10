-- Supervisor is a read-only, admin-visibility role. All write paths remain Admin-only.
alter type public.app_role add value if not exists 'supervisor';

create or replace function public.crm_role_rank(p_role text)
returns integer language sql immutable set search_path to ''
as $function$
 select case pg_catalog.lower(pg_catalog.replace(coalesce(p_role,''),' ','_'))
   when 'supervisor' then 5 when 'team_leader' then 4 when 'senior' then 3
   when 'middle' then 2 when 'junior' then 1 else 0 end;
$function$;

create or replace function public.is_active_supervisor()
returns boolean language sql stable security definer set search_path to 'public'
as $function$
 select public.is_auth_mfa_current() and exists(
   select 1 from public.profiles p where p.id=auth.uid() and p.active=true and lower(p.role::text)='supervisor'
 );
$function$;
revoke all on function public.is_active_supervisor() from public,anon;
grant execute on function public.is_active_supervisor() to authenticated;

create or replace function public.is_admin_or_supervisor()
returns boolean language sql stable security definer set search_path to 'public'
as $function$
 select public.is_active_admin() or public.is_active_supervisor();
$function$;
revoke all on function public.is_admin_or_supervisor() from public,anon;
grant execute on function public.is_admin_or_supervisor() to authenticated;

create or replace function public.is_hierarchy_manager(target_profile uuid default auth.uid())
returns boolean language sql stable security definer set search_path to 'public'
as $function$
 select public.is_auth_mfa_current() and exists (
   select 1 from public.profiles p where p.id=target_profile and p.active=true
   and lower(replace(p.role::text,'_',' ')) in ('supervisor','junior','middle','senior','team leader')
 );
$function$;

create or replace function public.get_supervisor_profiles()
returns table(id uuid,email text,full_name text,role text,active boolean,admin_panel_name text)
language sql stable security definer set search_path to 'public'
as $function$
 select p.id,p.email,p.full_name,p.role::text,p.active,p.admin_panel_name
 from public.profiles p
 where public.is_active_supervisor()
 order by p.full_name,p.email;
$function$;
revoke all on function public.get_supervisor_profiles() from public,anon;
grant execute on function public.get_supervisor_profiles() to authenticated;

create or replace function public.get_admin_attendance_with_gps()
returns setof public.attendance language plpgsql security definer set search_path to ''
as $function$
begin
 if not public.is_admin_or_supervisor() then
   raise exception 'Administrator or Supervisor access required' using errcode='42501';
 end if;
 return query select a.* from public.attendance a order by a.check_in desc limit 1000;
end;
$function$;

-- Only Admin may create invitations; the invitation role is still verified on redemption.
create or replace function public.create_manager_invitation(invited_role text, invitee_admin_panel_name text, invitee_corporate_email text)
returns text language plpgsql security definer set search_path to 'public'
as $function$
declare
 raw_token text := encode(extensions.gen_random_bytes(32),'hex');
 normalized_role text := lower(trim(replace(invited_role,'_',' ')));
 inviter_role text;
 normalized_email text := lower(trim(invitee_corporate_email));
 normalized_name text := trim(invitee_admin_panel_name);
begin
 select lower(replace(role::text,'_',' ')) into inviter_role
 from public.profiles where id=auth.uid() and active=true;
 if inviter_role is null or inviter_role <> 'admin' then
   raise exception 'Only Admin can create invitations' using errcode='42501';
 end if;
 if normalized_name is null or length(normalized_name)<2 or length(normalized_name)>120 then raise exception 'Enter a valid Admin Panel Name'; end if;
 if normalized_email is null or length(normalized_email)>254 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter a valid corporate email'; end if;
 if split_part(normalized_email,'@',2) not in ('mostbet.partners','infradim.com','starson.cloud','double.global')
   and normalized_email not in ('partnermbp@gmail.com','vladimirlenin458@gmail.com','gameon892@gmail.com') then
   raise exception 'This corporate email domain is not approved for the CRM.';
 end if;
 if exists(select 1 from auth.users u where lower(u.email)=normalized_email and u.email_confirmed_at is not null)
 or exists(select 1 from public.profiles p left join auth.users u on u.id=p.id
   where lower(coalesce(p.admin_panel_name,''))=lower(normalized_name)
   or (lower(coalesce(p.full_name,''))=lower(normalized_name) and u.email_confirmed_at is not null)) then
   raise exception 'A registered CRM account already exists with this email or Admin Panel Name. No invitation was created. Ask Admin to review the existing account.';
 end if;
 if normalized_role not in ('supervisor','team leader','senior','middle','junior','telemarketing') then raise exception 'Unsupported invitation role'; end if;
 update public.manager_invitations set expires_at=least(expires_at,now())
 where redeemed_at is null and (lower(coalesce(corporate_email,''))=normalized_email or lower(coalesce(admin_panel_name,''))=lower(normalized_name));
 insert into public.manager_invitations(token_hash,invited_by,invited_role,admin_panel_name,corporate_email,expires_at)
 values(encode(extensions.digest(raw_token,'sha256'),'hex'),auth.uid(),
   case normalized_role when 'team leader' then 'team_leader' else normalized_role end,
   normalized_name,normalized_email,now()+interval '24 hours');
 return raw_token;
end;
$function$;

-- Supervisor is the top hierarchy role and may have Team Leaders directly below.
create or replace function public.assign_employee_to_manager(p_manager_id uuid,p_employee_id uuid)
returns void language plpgsql security definer set search_path to ''
as $function$
declare actor_role text; manager_role text; employee_role text; target_root uuid; existing_root uuid;
begin
 if auth.uid() is null then raise exception 'Sign in is required'; end if;
 select lower(replace(role::text,'_',' ')) into actor_role from public.profiles where id=auth.uid() and active=true;
 if actor_role <> 'admin' then raise exception 'Only Admin can change reporting assignments' using errcode='42501'; end if;
 if p_manager_id=p_employee_id then raise exception 'A profile cannot report to itself'; end if;
 select lower(replace(role::text,'_',' ')) into manager_role from public.profiles where id=p_manager_id and active=true;
 select lower(replace(role::text,'_',' ')) into employee_role from public.profiles where id=p_employee_id and active=true;
 if manager_role is null or employee_role is null then raise exception 'Both profiles must be active'; end if;
 if public.crm_role_rank(manager_role)=0 or public.crm_role_rank(employee_role)=0 or public.crm_role_rank(manager_role)<=public.crm_role_rank(employee_role) then raise exception 'Invalid role order for reporting assignment'; end if;
 with recursive ancestors(id,manager_id,role_text,visited) as (
   select p.id,a.manager_id,lower(replace(p.role::text,'_',' ')),array[p.id]
   from public.profiles p left join public.manager_employee_assignments a on a.employee_id=p.id where p.id=p_manager_id
   union all
   select parent.id,a.manager_id,lower(replace(parent.role::text,'_',' ')),x.visited||parent.id
   from ancestors x join public.manager_employee_assignments a on a.employee_id=x.id
   join public.profiles parent on parent.id=a.manager_id and parent.active=true
   where not parent.id=any(x.visited)
 )
 select id into target_root from ancestors
 where role_text in ('supervisor','team leader')
 order by case role_text when 'supervisor' then 2 else 1 end desc,cardinality(visited) desc limit 1;
 if manager_role in ('supervisor','team leader') then target_root:=p_manager_id; end if;
 if target_root is null then raise exception 'The selected manager is not connected to a top-level Supervisor or Team Leader'; end if;
 with recursive parent_chain(employee_id,manager_id,role_text,visited) as (
   select a.employee_id,a.manager_id,lower(replace(parent.role::text,'_',' ')),array[a.employee_id,a.manager_id]
   from public.manager_employee_assignments a join public.profiles parent on parent.id=a.manager_id and parent.active=true where a.employee_id=p_employee_id
   union all
   select c.employee_id,a.manager_id,lower(replace(parent.role::text,'_',' ')),c.visited||a.manager_id
   from parent_chain c join public.manager_employee_assignments a on a.employee_id=c.manager_id
   join public.profiles parent on parent.id=a.manager_id and parent.active=true where not a.manager_id=any(c.visited)
 )
 select id into existing_root from (
   select manager_id as id,role_text,cardinality(visited) as depth from parent_chain
 ) roots where role_text in ('supervisor','team leader')
 order by case role_text when 'supervisor' then 2 else 1 end desc,depth desc limit 1;
 if existing_root is not null and existing_root<>target_root then raise exception 'Employee belongs to a different top-level reporting tree; cross-team reassignment requires a separate Admin change'; end if;
 if exists(with recursive descendants(id,visited) as (
   select p_employee_id,array[p_employee_id]
   union all select a.employee_id,d.visited||a.employee_id from descendants d
   join public.manager_employee_assignments a on a.manager_id=d.id where not a.employee_id=any(d.visited)
 ) select 1 from descendants where id=p_manager_id) then raise exception 'Assignment would create a reporting cycle'; end if;
 delete from public.manager_employee_assignments a using public.profiles old_parent
 where a.employee_id=p_employee_id and old_parent.id=a.manager_id and (
   old_parent.id=target_root or exists(
    with recursive old_ancestors(id,manager_id,role_text,visited) as (
      select old_parent.id,parent_link.manager_id,lower(replace(old_parent.role::text,'_',' ')),array[old_parent.id]
      from public.manager_employee_assignments parent_link where parent_link.employee_id=old_parent.id
      union all select parent.id,link.manager_id,lower(replace(parent.role::text,'_',' ')),x.visited||parent.id
      from old_ancestors x join public.manager_employee_assignments link on link.employee_id=x.id
      join public.profiles parent on parent.id=link.manager_id where not parent.id=any(x.visited)
    ) select 1 from old_ancestors where id=target_root
   )
 );
 insert into public.manager_employee_assignments(manager_id,employee_id,created_by)
 values(p_manager_id,p_employee_id,auth.uid()) on conflict(manager_id,employee_id) do nothing;
end;
$function$;

create or replace function public.get_my_team_hierarchy()
returns table(id uuid,email text,full_name text,role text,active boolean,manager_id uuid,depth integer)
language sql stable security definer set search_path to 'public'
as $function$
 with recursive team as (
   select a.employee_id as id,a.manager_id,1 as depth,array[auth.uid(),a.employee_id]::uuid[] as path
   from public.manager_employee_assignments a where a.manager_id=auth.uid()
   union all
   select a.employee_id,a.manager_id,t.depth+1,t.path||a.employee_id
   from public.manager_employee_assignments a join team t on a.manager_id=t.id
   where t.depth<12 and not a.employee_id=any(t.path)
 )
 select p.id,p.email,p.full_name,p.role::text,p.active,team.manager_id,team.depth
 from team join public.profiles p on p.id=team.id
 where public.is_auth_mfa_current() and exists(
   select 1 from public.profiles me where me.id=auth.uid() and me.active=true
   and (lower(me.role::text) in ('admin','supervisor') or public.is_hierarchy_manager(me.id))
 )
 order by team.depth,p.full_name;
$function$;

-- Preserve Telegram IDs as Admin-only even though Supervisors can read the broader profile view.
drop policy if exists "Admins and Supervisors read profiles" on public.profiles;
create policy "Admins read profiles" on public.profiles for select to authenticated
using (public.is_active_admin() or (id=auth.uid() and active=true));

-- Admin-only writes and safe profile RPCs keep the Supervisor role read-only.
drop policy if exists "Managers read own assignments" on public.manager_employee_assignments;
create policy "Managers and Supervisors read assignments" on public.manager_employee_assignments
for select to authenticated using (
 is_auth_mfa_current() and (public.is_admin_or_supervisor() or manager_id=auth.uid() or employee_id=auth.uid())
);

drop policy if exists "Admins read assignments" on public.manager_assignments;
create policy "Admins and Supervisors read assignments" on public.manager_assignments
for select to authenticated using (public.is_admin_or_supervisor() and is_auth_mfa_current());

drop policy if exists "Read own attendance or admin attendance" on public.attendance;
create policy "Read own attendance or admin supervisor attendance" on public.attendance for select to authenticated
using (is_auth_mfa_current() and (public.is_admin_or_supervisor() or (employee_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active=true))));

drop policy if exists "Read own shifts or admin shifts" on public.shifts;
create policy "Read own shifts or admin supervisor shifts" on public.shifts for select to authenticated
using (is_auth_mfa_current() and (public.is_admin_or_supervisor() or employee_id=auth.uid()));

drop policy if exists "crm_login_events_admin_read" on public.crm_login_events;
create policy "crm_login_events_admin_supervisor_read" on public.crm_login_events for select to authenticated using (public.is_admin_or_supervisor());
drop policy if exists "suspicious_activities_admin_read" on public.suspicious_activities;
create policy "suspicious_activities_admin_supervisor_read" on public.suspicious_activities for select to authenticated using (public.is_admin_or_supervisor());
drop policy if exists "Admins read manager invitations" on public.manager_invitations;
create policy "Admins and Supervisors read manager invitations" on public.manager_invitations for select to authenticated using (public.is_admin_or_supervisor());
drop policy if exists "Admins read invitations" on public.invitations;
create policy "Admins and Supervisors read invitations" on public.invitations for select to authenticated using (public.is_admin_or_supervisor());
drop policy if exists "Admins read telegram audit" on public.telegram_admin_audit;
create policy "Admins and Supervisors read telegram audit" on public.telegram_admin_audit for select to authenticated using (public.is_admin_or_supervisor());
drop policy if exists "telegram_id_change_requests_admin_read" on public.telegram_id_change_requests;
create policy "telegram_id_change_requests_admin_supervisor_read" on public.telegram_id_change_requests for select to authenticated using (public.is_admin_or_supervisor());

drop policy if exists "Authorized staff read telegram members" on public.telegram_group_members;
create policy "Authorized staff read telegram members" on public.telegram_group_members for select to authenticated
using ((is_active_admin() or (profile_id is not null and is_assigned_manager(profile_id))) and is_auth_mfa_current());

drop policy if exists "Admins read telegram groups" on public.telegram_groups;
create policy "Admins and Supervisors read telegram groups" on public.telegram_groups for select to authenticated using (public.is_admin_or_supervisor() and is_auth_mfa_current());
drop policy if exists "Assigned managers read relevant telegram groups" on public.telegram_groups;
create policy "Assigned managers read relevant telegram groups" on public.telegram_groups for select to authenticated
using ((public.is_admin_or_supervisor() or exists(select 1 from public.telegram_group_members gm where gm.telegram_chat_id=telegram_groups.telegram_chat_id and gm.profile_id is not null and is_assigned_manager(gm.profile_id))) and is_auth_mfa_current());

drop policy if exists "Authorized staff read telegram message reactions" on public.telegram_message_reactions;
create policy "Authorized staff read telegram message reactions" on public.telegram_message_reactions for select to authenticated
using ((public.is_admin_or_supervisor() or exists(select 1 from public.telegram_group_members gm where gm.telegram_chat_id=telegram_message_reactions.telegram_chat_id and gm.profile_id is not null and is_assigned_manager(gm.profile_id))) and is_auth_mfa_current());
drop policy if exists "Authorized staff read Telegram reaction counts" on public.telegram_message_reaction_counts;
create policy "Authorized staff read Telegram reaction counts" on public.telegram_message_reaction_counts for select to authenticated
using ((public.is_admin_or_supervisor() or exists(select 1 from public.telegram_group_members gm where gm.telegram_chat_id=telegram_message_reaction_counts.telegram_chat_id and gm.profile_id is not null and is_assigned_manager(gm.profile_id))) and is_auth_mfa_current());
drop policy if exists "Authorized staff read telegram messages" on public.telegram_messages;
create policy "Authorized staff read telegram messages" on public.telegram_messages for select to authenticated
using ((public.is_admin_or_supervisor() or exists(select 1 from public.telegram_group_members gm where gm.telegram_chat_id=telegram_messages.telegram_chat_id and gm.profile_id is not null and is_assigned_manager(gm.profile_id))) and is_auth_mfa_current());
drop policy if exists "Authorized staff read telegram reactions" on public.telegram_reactions;
create policy "Authorized staff read telegram reactions" on public.telegram_reactions for select to authenticated
using ((public.is_admin_or_supervisor() or exists(select 1 from public.telegram_group_members gm where gm.telegram_chat_id=telegram_reactions.telegram_chat_id and gm.profile_id is not null and is_assigned_manager(gm.profile_id))) and is_auth_mfa_current());
drop policy if exists "Authorized staff read telegram response metrics" on public.telegram_response_metrics;
create policy "Authorized staff read telegram response metrics" on public.telegram_response_metrics for select to authenticated
using ((public.is_admin_or_supervisor() or exists(select 1 from public.telegram_group_members gm where gm.telegram_chat_id=telegram_response_metrics.telegram_chat_id and gm.profile_id is not null and is_assigned_manager(gm.profile_id))) and is_auth_mfa_current());

drop policy if exists "Read permitted locations" on public.location_points;
create policy "Read permitted locations" on public.location_points for select to authenticated using (
 is_auth_mfa_current() and (
   public.is_admin_or_supervisor()
   or (employee_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active=true))
   or exists(select 1 from public.manager_assignments ma join public.profiles m on m.id=ma.manager_id
     where ma.manager_id=auth.uid() and ma.employee_id=location_points.employee_id
     and ma.can_view_location=true and m.role='manager'::public.app_role and m.active=true)
 )
);

drop policy if exists "Admins read manager permissions" on public.manager_employee_permissions;
drop policy if exists "Users read own manager permissions" on public.manager_employee_permissions;
create policy "Admins and Supervisors read manager permissions" on public.manager_employee_permissions
for select to authenticated using (public.is_admin_or_supervisor() or manager_id=auth.uid() or employee_id=auth.uid());

-- Supervisors can never submit attendance or close a session, even via direct REST/RPC calls.
drop policy if exists "Employees create own attendance with GPS" on public.attendance;
create policy "Employees create own attendance with GPS" on public.attendance for insert to authenticated
with check (
 employee_id=(select auth.uid()) and check_in_lat is not null and check_in_lng is not null
 and check_in_lat between -90 and 90 and check_in_lng between -180 and 180
 and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true
   and lower(replace(p.role::text,'_',' ')) in ('junior','middle','senior','team leader','telemarketing'))
 and is_auth_mfa_current()
);

drop policy if exists "Employees close own attendance" on public.attendance;
create policy "Employees close own attendance" on public.attendance for update to authenticated
using (
 employee_id=(select auth.uid()) and check_out is null and is_auth_mfa_current()
 and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true
   and lower(replace(p.role::text,'_',' ')) in ('junior','middle','senior','team leader','telemarketing'))
)
with check (
 employee_id=(select auth.uid()) and check_out is not null and is_auth_mfa_current()
 and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true
   and lower(replace(p.role::text,'_',' ')) in ('junior','middle','senior','team leader','telemarketing'))
);

drop policy if exists "Employees submit locations during own shift" on public.location_points;
create policy "Employees submit locations during own shift" on public.location_points for insert to authenticated
with check (
 employee_id=(select auth.uid())
 and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active=true
   and lower(replace(p.role::text,'_',' ')) in ('junior','middle','senior','team leader','telemarketing'))
 and exists(select 1 from public.shifts s where s.employee_id=(select auth.uid()) and s.starts_at<=now() and s.ends_at>now())
 and is_auth_mfa_current()
);

-- Expose supervisor-level Telegram response statistics without exposing Telegram user IDs.
create or replace function public.get_supervisor_telegram_metrics()
returns table(profile_id uuid, asked_count bigint, reply_count bigint, average_response_seconds numeric)
language sql stable security definer set search_path to 'public'
as $function$
  select p.id,
    count(m.*) filter (where m.question_user_id=p.telegram_user_id)::bigint as asked_count,
    count(m.*) filter (where m.first_reply_user_id=p.telegram_user_id and m.response_seconds is not null)::bigint as reply_count,
    avg(m.response_seconds) filter (where m.first_reply_user_id=p.telegram_user_id and m.response_seconds is not null) as average_response_seconds
  from public.profiles p
  left join public.telegram_response_metrics m
    on m.question_user_id=p.telegram_user_id or m.first_reply_user_id=p.telegram_user_id
  where public.is_active_supervisor()
    and p.telegram_user_id is not null and p.telegram_verified_at is not null
  group by p.id,p.telegram_user_id;
$function$;
revoke all on function public.get_supervisor_telegram_metrics() from public,anon;
grant execute on function public.get_supervisor_telegram_metrics() to authenticated;

-- Telegram account-change requests and audit rows contain raw Telegram identifiers; keep them Admin-only.
drop policy if exists "Admins and Supervisors read telegram audit" on public.telegram_admin_audit;
create policy "Admins read telegram audit" on public.telegram_admin_audit for select to authenticated
using (is_active_admin() and is_auth_mfa_current());
drop policy if exists "telegram_id_change_requests_admin_supervisor_read" on public.telegram_id_change_requests;
create policy "telegram_id_change_requests_admin_read" on public.telegram_id_change_requests for select to authenticated
using (is_active_admin() and is_auth_mfa_current());
