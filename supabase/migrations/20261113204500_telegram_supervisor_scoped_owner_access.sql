create or replace function public.can_access_telegram_analytics_group(p_chat_id bigint)
returns boolean language sql stable security definer set search_path=''
as $$
 with recursive visible_tree(id) as (
  select auth.uid() where auth.uid() is not null
  union
  select a.employee_id from public.manager_employee_assignments a join visible_tree v on v.id=a.manager_id
   join public.profiles child on child.id=a.employee_id and child.active=true
 ),
 team_leaders(id) as (
  select p.id from public.profiles p join visible_tree v on v.id=p.id
  where p.active and lower(replace(p.role::text,'_',' '))='team leader'
 ),
 team_owner_ids(id,path) as (
  select t.id,array[t.id]::uuid[] from team_leaders t
  union all
  select a.employee_id,x.path||a.employee_id from team_owner_ids x
   join public.manager_employee_assignments a on a.manager_id=x.id
   join public.profiles child on child.id=a.employee_id and child.active=true
  where not a.employee_id=any(x.path)
 )
 select auth.uid() is not null and public.is_auth_mfa_current() and (
  public.is_active_admin()
  or (public.is_active_supervisor() and exists(
    select 1 from public.telegram_group_admins ga
    join public.profiles owner_profile on owner_profile.telegram_user_id=ga.telegram_user_id and owner_profile.active=true
    join team_owner_ids team_owner on team_owner.id=owner_profile.id
    where ga.telegram_chat_id=p_chat_id
  ))
  or exists(
    select 1 from public.telegram_group_admins ga
    join public.profiles owner_profile on owner_profile.telegram_user_id=ga.telegram_user_id and owner_profile.active=true
    where ga.telegram_chat_id=p_chat_id and owner_profile.id=auth.uid()
  )
 );
$$;
revoke all on function public.can_access_telegram_analytics_group(bigint) from public,anon;
grant execute on function public.can_access_telegram_analytics_group(bigint) to authenticated;