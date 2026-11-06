-- Expose the Telegram handler captured during invitation verification in manager hierarchy.
alter table public.profiles add column if not exists telegram_username text;

create or replace function public.get_my_team_hierarchy_with_telegram()
returns table(
  id uuid, email text, full_name text, role text, active boolean,
  manager_id uuid, depth integer, telegram_user_id bigint,
  telegram_username text, telegram_verified_at timestamptz
)
language sql stable security definer
set search_path = public
as $$
  with recursive team as (
    select a.employee_id as id, a.manager_id, 1 as depth,
      array[auth.uid(), a.employee_id]::uuid[] as path
    from public.manager_employee_assignments a where a.manager_id = auth.uid()
    union all
    select a.employee_id, a.manager_id, t.depth + 1, t.path || a.employee_id
    from public.manager_employee_assignments a join team t on a.manager_id = t.id
    where t.depth < 12 and not a.employee_id = any(t.path)
  )
  select p.id, p.email, p.full_name, p.role::text, p.active,
    team.manager_id, team.depth, p.telegram_user_id, p.telegram_username, p.telegram_verified_at
  from team join public.profiles p on p.id = team.id
  where exists (
    select 1 from public.profiles me where me.id = auth.uid() and me.active = true
      and (lower(me.role::text) = 'admin' or public.is_hierarchy_manager(me.id))
  )
  order by team.depth, p.full_name;
$$;
revoke all on function public.get_my_team_hierarchy_with_telegram() from public, anon;
grant execute on function public.get_my_team_hierarchy_with_telegram() to authenticated;
