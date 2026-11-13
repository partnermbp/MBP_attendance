-- Allow Telemarketing profiles to report directly to Team Leaders only.
-- They remain non-manager direct contacts and never become reporting-line managers.

create or replace function public.crm_role_rank(p_role text)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select case pg_catalog.lower(pg_catalog.replace(coalesce(p_role,''),' ','_'))
    when 'supervisor' then 5
    when 'team_leader' then 4
    when 'senior' then 3
    when 'middle' then 2
    when 'junior' then 1
    when 'telemarketing' then 1
    else 0
  end;
$function$;

create or replace function public.enforce_manager_employee_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_role text;
  employee_role text;
  manager_rank integer;
  employee_rank integer;
begin
  select lower(replace(p.role::text, ' ', '_')) into manager_role
  from public.profiles p where p.id = new.manager_id and p.active = true;

  select lower(replace(p.role::text, ' ', '_')) into employee_role
  from public.profiles p where p.id = new.employee_id and p.active = true;

  if manager_role is null or employee_role is null then
    raise exception 'Both profiles must be active';
  end if;

  if employee_role = 'telemarketing' then
    if manager_role <> 'team_leader' then
      raise exception 'Telemarketing contacts can be assigned directly under a Team Leader only';
    end if;
    return new;
  end if;

  manager_rank := public.crm_role_rank(manager_role);
  employee_rank := public.crm_role_rank(employee_role);

  if manager_rank = 0 or employee_rank = 0 then
    raise exception 'Only active hierarchy roles can be connected';
  end if;
  if manager_rank <= employee_rank then
    raise exception 'Invalid hierarchy: a manager can only have employees below their own role';
  end if;
  return new;
end;
$$;

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
    raise exception 'Only Admin can change reporting assignments' using errcode = '42501';
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

  if employee_role = 'telemarketing' then
    if manager_role <> 'team leader' then
      raise exception 'Telemarketing contacts can be assigned directly under a Team Leader only';
    end if;
  elsif public.crm_role_rank(manager_role) = 0
     or public.crm_role_rank(employee_role) = 0
     or public.crm_role_rank(manager_role) <= public.crm_role_rank(employee_role) then
    raise exception 'Invalid role order for reporting assignment';
  end if;

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
  where role_text in ('team leader', 'supervisor')
  order by case role_text when 'supervisor' then 2 else 1 end desc, cardinality(visited) desc
  limit 1;

  if manager_role in ('team leader', 'supervisor') then
    target_root := p_manager_id;
  end if;

  if target_root is null then
    raise exception 'The selected manager is not connected to a top-level Supervisor or Team Leader';
  end if;

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
  where role_text in ('team leader', 'supervisor')
  order by case role_text when 'supervisor' then 2 else 1 end desc, depth desc
  limit 1;

  if existing_root is not null and existing_root <> target_root then
    raise exception 'Employee belongs to a different top-level reporting tree; cross-team reassignment requires a separate Admin change';
  end if;

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
        select 1 from old_ancestors where id = target_root
      )
    );

  insert into public.manager_employee_assignments(manager_id, employee_id, created_by)
  values (p_manager_id, p_employee_id, auth.uid())
  on conflict (manager_id, employee_id) do nothing;
end;
$function$;

revoke all on function public.assign_employee_to_manager(uuid, uuid) from public, anon;
grant execute on function public.assign_employee_to_manager(uuid, uuid) to authenticated;
