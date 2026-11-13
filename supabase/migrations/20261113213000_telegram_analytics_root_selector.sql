create or replace function public.get_telegram_group_analytics_options()
returns table(
 team_leader_id uuid,
 team_leader_name text,
 owner_profile_id uuid,
 owner_name text,
 telegram_chat_id bigint,
 group_title text
)
language sql stable security definer set search_path=''
as $$
 with recursive visible_tree(id) as (
  select auth.uid() where auth.uid() is not null
  union
  select a.employee_id
  from public.manager_employee_assignments a
  join visible_tree v on v.id=a.manager_id
  join public.profiles child on child.id=a.employee_id and child.active=true
 ),
 roots as (
  select p.id root_id,
   coalesce(nullif(p.admin_panel_name,''),nullif(p.full_name,''),p.email,p.id::text) root_name
  from public.profiles p
  where p.active and (
   (public.is_active_admin() and lower(replace(p.role::text,'_',' ')) in ('team leader','admin','supervisor'))
   or
   (public.is_active_supervisor() and (
      p.id=auth.uid()
      or (lower(replace(p.role::text,'_',' '))='team leader' and exists(select 1 from visible_tree v where v.id=p.id))
   ))
  )
 ),
 team(root_id,profile_id,path) as (
  select r.root_id,r.root_id,array[r.root_id]::uuid[] from roots r
  union all
  select t.root_id,a.employee_id,t.path||a.employee_id
  from team t
  join public.manager_employee_assignments a on a.manager_id=t.profile_id
  join public.profiles child on child.id=a.employee_id and child.active=true
  where not a.employee_id=any(t.path)
 ),
 manager_rows as (
  select r.root_id,r.root_name,o.id owner_profile_id,
   coalesce(nullif(o.admin_panel_name,''),nullif(o.full_name,''),o.email,o.id::text) owner_name,
   g.telegram_chat_id,g.title group_title
  from roots r
  join team t on t.root_id=r.root_id
  join public.profiles o on o.id=t.profile_id and o.active=true
  left join public.telegram_group_admins ga on ga.telegram_user_id=o.telegram_user_id
  left join public.telegram_groups g on g.telegram_chat_id=ga.telegram_chat_id and g.enabled=true
 ),
 own_manager_rows as (
  select
   case when lower(replace(me.role::text,'_',' '))='team leader' then me.id else null end,
   case when lower(replace(me.role::text,'_',' '))='team leader'
     then coalesce(nullif(me.admin_panel_name,''),nullif(me.full_name,''),me.email,me.id::text) else null end,
   me.id,
   coalesce(nullif(me.admin_panel_name,''),nullif(me.full_name,''),me.email,me.id::text),
   g.telegram_chat_id,g.title
  from public.profiles me
  left join public.telegram_group_admins ga on ga.telegram_user_id=me.telegram_user_id
  left join public.telegram_groups g on g.telegram_chat_id=ga.telegram_chat_id and g.enabled=true
  where auth.uid()=me.id and me.active
   and lower(replace(me.role::text,'_',' ')) in ('team leader','senior','middle','junior')
   and not (public.is_active_admin() or public.is_active_supervisor())
 )
 select * from manager_rows
 union all
 select * from own_manager_rows
 order by 2,4,6;
$$;
revoke all on function public.get_telegram_group_analytics_options() from public,anon;
grant execute on function public.get_telegram_group_analytics_options() to authenticated;

create or replace function public.can_access_telegram_analytics_group(p_chat_id bigint)
returns boolean language sql stable security definer set search_path=''
as $$
 with recursive visible_tree(id) as (
  select auth.uid() where auth.uid() is not null
  union
  select a.employee_id
  from public.manager_employee_assignments a
  join visible_tree v on v.id=a.manager_id
  join public.profiles child on child.id=a.employee_id and child.active=true
 )
 select auth.uid() is not null and public.is_auth_mfa_current() and (
  public.is_active_admin()
  or (public.is_active_supervisor() and exists(
    select 1
    from public.telegram_group_admins ga
    join public.profiles owner_profile
      on owner_profile.telegram_user_id=ga.telegram_user_id and owner_profile.active=true
    join visible_tree v on v.id=owner_profile.id
    where ga.telegram_chat_id=p_chat_id
  ))
  or exists(
    select 1
    from public.telegram_group_admins ga
    join public.profiles owner_profile
      on owner_profile.telegram_user_id=ga.telegram_user_id and owner_profile.active=true
    where ga.telegram_chat_id=p_chat_id
      and owner_profile.id=auth.uid()
      and lower(replace(owner_profile.role::text,'_',' ')) in ('team leader','senior','middle','junior')
  )
 );
$$;
revoke all on function public.can_access_telegram_analytics_group(bigint) from public,anon;
grant execute on function public.can_access_telegram_analytics_group(bigint) to authenticated;
