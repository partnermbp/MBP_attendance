-- Let Junior-role accounts view any team members explicitly assigned to them,
-- while keeping invitation creation restricted to Middle, Senior, Team Leader, and Admin.
-- This does not grant GPS map access or assignment-management privileges.

create or replace function public.get_my_team_hierarchy()
returns table(id uuid, email text, full_name text, role text, active boolean, manager_id uuid, depth integer)
language sql stable security definer
set search_path = public
as $$
  with recursive team as (
    select a.employee_id as id, a.manager_id, 1 as depth, array[auth.uid(), a.employee_id]::uuid[] as path
    from public.manager_employee_assignments a
    where a.manager_id = auth.uid()
    union all
    select a.employee_id, a.manager_id, t.depth + 1, t.path || a.employee_id
    from public.manager_employee_assignments a
    join team t on a.manager_id = t.id
    where t.depth < 12 and not a.employee_id = any(t.path)
  )
  select p.id, p.email, p.full_name, p.role::text, p.active, team.manager_id, team.depth
  from team join public.profiles p on p.id = team.id
  where exists (
    select 1 from public.profiles me
    where me.id = auth.uid() and me.active = true
      and (
        lower(me.role::text) = 'admin'
        or public.is_hierarchy_manager(me.id)
        or lower(me.role::text) = 'junior'
      )
  )
  order by team.depth, p.full_name;
$$;

create or replace function public.is_assigned_manager(target_employee uuid)
returns boolean language sql stable security definer
set search_path = public
as $$
  with recursive team(id, path, depth) as (
    select a.employee_id, array[auth.uid(), a.employee_id]::uuid[], 1
    from public.manager_employee_assignments a where a.manager_id = auth.uid()
    union all
    select a.employee_id, t.path || a.employee_id, t.depth + 1
    from public.manager_employee_assignments a
    join team t on a.manager_id = t.id
    where t.depth < 12 and not a.employee_id = any(t.path)
  )
  select exists (
    select 1 from team t join public.profiles me on me.id = auth.uid()
    where t.id = target_employee and me.active = true
      and (
        lower(me.role::text) = 'admin'
        or public.is_hierarchy_manager(me.id)
        or lower(me.role::text) = 'junior'
      )
  );
$$;

grant execute on function public.get_my_team_hierarchy() to authenticated;
