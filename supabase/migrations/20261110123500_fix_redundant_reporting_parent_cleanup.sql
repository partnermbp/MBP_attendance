-- Remove an employee's direct assignment to an ancestor manager when
-- the employee is also assigned to a descendant manager in that same branch.
with recursive manager_paths(target_employee_id, ancestor_id, descendant_id, visited) as (
  select a.employee_id, a.manager_id, a.manager_id, array[a.manager_id]
  from public.manager_employee_assignments a
  union all
  select mp.target_employee_id, mp.ancestor_id, child.employee_id, mp.visited || child.employee_id
  from manager_paths mp
  join public.manager_employee_assignments child on child.manager_id = mp.descendant_id
  where not child.employee_id = any(mp.visited)
),
redundant_parent_links as (
  select older.manager_id, older.employee_id
  from public.manager_employee_assignments older
  where exists (
    select 1
    from public.manager_employee_assignments newer
    join manager_paths path
      on path.target_employee_id = older.employee_id
     and path.ancestor_id = older.manager_id
     and path.descendant_id = newer.manager_id
    where newer.employee_id = older.employee_id
      and newer.manager_id <> older.manager_id
  )
)
delete from public.manager_employee_assignments a
using redundant_parent_links r
where a.manager_id = r.manager_id
  and a.employee_id = r.employee_id;
