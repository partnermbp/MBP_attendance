-- Enforce the reporting hierarchy for Admin-created manager assignments.
-- Team Leader > Senior > Middle > Junior. Telemarketing is a separate track.
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

  manager_rank := case manager_role
    when 'team_leader' then 4
    when 'senior' then 3
    when 'middle' then 2
    when 'junior' then 1
    else 0
  end;
  employee_rank := case employee_role
    when 'team_leader' then 4
    when 'senior' then 3
    when 'middle' then 2
    when 'junior' then 1
    else 0
  end;

  if manager_rank = 0 or employee_rank = 0 then
    raise exception 'Only active hierarchy roles can be connected; Telemarketing is a separate track';
  end if;
  if manager_rank <= employee_rank then
    raise exception 'Invalid hierarchy: a manager can only have employees below their own role';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_manager_employee_hierarchy on public.manager_employee_assignments;
create trigger enforce_manager_employee_hierarchy
before insert or update of manager_id, employee_id on public.manager_employee_assignments
for each row execute function public.enforce_manager_employee_hierarchy();
