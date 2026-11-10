-- Atomically move an employee within the same top-level Team Leader tree.
-- A manager can have only one direct reporting parent per employee.
create or replace function public.assign_employee_to_manager(
  p_manager_id uuid,
  p_employee_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_role text;
  manager_role text;
  employee_role text;
  target_root uuid;
  existing_root uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required';
  end if;

  select lower(replace(role::text, '_', ' '))
    into actor_role
  from public.profiles
  where id = auth.uid() and active = true;

  if actor_role <> 'admin' then
    raise exception 'Only Admin can change reporting assignments';
  end if;

  if p_manager_id = p_employee_id then
    raise exception 'A profile cannot report to itself';
  end if;

  select lower(replace(role::text, '_', ' '))
    into manager_role
  from public.profiles
  where id = p_manager_id and active = true;

  select lower(replace(role::text, '_', ' '))
    into employee_role
  from public.profiles
  where id = p_employee_id and active = true;

  if manager_role is null or employee_role is null then
    raise exception 'Both profiles must be active';
  end if;

  if public.crm_role_rank(manager_role) = 0
     or public.crm_role_rank(employee_role) = 0
     or public.crm_role_rank(manager_role) <= public.crm_role_rank(employee_role) then
    raise exception 'Invalid role order for reporting assignment';
  end if;

  -- Resolve the selected manager's top-level Team Leader.
  with recursive ancestors(id, manager_id, role_text, visited) as (
    select p.id, a.manager_id, lower(replace(p.role::text, '_', ' ')), array[p.id]
    from public.profiles p
    left join public.manager_employee_assignments a on a.employee_id = p.id
    where p.id = p_manager_id
    union all
    select parent.id, a.manager_id, lower(replace(parent.role::text, '_', ' ')), x.visited || parent.id
    from ancestors x
    join public.manager_employee_assignments a on a.employee_id = x.id
    join public.profiles parent on parent.id = a.manager_id and parent.active = true
    where not parent.id = any(x.visited)
  )
  select id into target_root
  from ancestors
  where role_text = 'team leader'
  order by cardinality(visited) desc
  limit 1;

  if manager_role = 'team leader' then
    target_root := p_manager_id;
  end if;

  if target_root is null then
    raise exception 'The selected manager is not connected to a top-level Team Leader';
  end if;

  -- Find the Team Leader roots of all existing parent links for this employee.
  with recursive parent_chain(employee_id, manager_id, role_text, visited) as (
    select a.employee_id, a.manager_id, lower(replace(parent.role::text, '_', ' ')), array[a.employee_id, a.manager_id]
    from public.manager_employee_assignments a
    join public.profiles parent on parent.id = a.manager_id and parent.active = true
    where a.employee_id = p_employee_id
    union all
    select c.employee_id, a.manager_id, lower(replace(parent.role::text, '_', ' ')), c.visited || a.manager_id
    from parent_chain c
    join public.manager_employee_assignments a on a.employee_id = c.manager_id
    join public.profiles parent on parent.id = a.manager_id and parent.active = true
    where not a.manager_id = any(c.visited)
  )
  select id into existing_root
  from (
    select manager_id as id, role_text, cardinality(visited) as depth
    from parent_chain
  ) roots
  where role_text = 'team leader'
  order by depth desc
  limit 1;

  if existing_root is not null and existing_root <> target_root then
    raise exception 'Employee belongs to a different top-level Team Leader tree; cross-team reassignment requires a separate Admin change';
  end if;

  -- Prevent moving a manager below one of their own descendants.
  if exists (
    with recursive descendants(id, visited) as (
      select p_employee_id, array[p_employee_id]
      union all
      select a.employee_id, d.visited || a.employee_id
      from descendants d
      join public.manager_employee_assignments a on a.manager_id = d.id
      where not a.employee_id = any(d.visited)
    )
    select 1 from descendants where id = p_manager_id
  ) then
    raise exception 'Assignment would create a reporting cycle';
  end if;

  -- Remove all previous parent links in this same Team Leader tree,
  -- then add the requested direct reporting relationship in one transaction.
  delete from public.manager_employee_assignments a
  using public.profiles old_parent
  where a.employee_id = p_employee_id
    and old_parent.id = a.manager_id
    and (
      old_parent.id = target_root
      or exists (
        with recursive old_ancestors(id, manager_id, role_text, visited) as (
          select old_parent.id, parent_link.manager_id,
                 lower(replace(old_parent.role::text, '_', ' ')),
                 array[old_parent.id]
          from public.manager_employee_assignments parent_link
          where parent_link.employee_id = old_parent.id
          union all
          select parent.id, link.manager_id,
                 lower(replace(parent.role::text, '_', ' ')),
                 x.visited || parent.id
          from old_ancestors x
          join public.manager_employee_assignments link on link.employee_id = x.id
          join public.profiles parent on parent.id = link.manager_id
          where not parent.id = any(x.visited)
        )
        select 1 from old_ancestors
        where role_text = 'team leader' and id = target_root
      )
    );

  insert into public.manager_employee_assignments(manager_id, employee_id, created_by)
  values (p_manager_id, p_employee_id, auth.uid())
  on conflict (manager_id, employee_id) do nothing;
end;
$function$;

revoke all on function public.assign_employee_to_manager(uuid, uuid) from public, anon;
grant execute on function public.assign_employee_to_manager(uuid, uuid) to authenticated;
