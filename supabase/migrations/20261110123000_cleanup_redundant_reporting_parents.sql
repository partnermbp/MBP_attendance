-- Repair legacy duplicate reporting links where a more specific manager
-- already exists below another assigned parent in the same reporting tree.
with recursive manager_paths(employee_id, ancestor_id, descendant_id, visited) as (
  select a.employee_id, a.manager_id, a.employee_id, array[a.manager_id, a.employee_id]
  from public.manager_employee_assignments a
  union all
  select p.employee_id, p.manager_id, mp.descendant_id, mp.visited || p.manager_id
  from manager_paths mp
  join public.manager_employee_assignments p on p.employee_id = mp.ancestor_id
  where not p.manager_id = any(mp.visited)
),
redundant_parent_links as (
  select older.manager_id, older.employee_id
  from public.manager_employee_assignments older
  where exists (
    select 1
    from public.manager_employee_assignments newer
    join manager_paths path
      on path.employee_id = older.employee_id
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
