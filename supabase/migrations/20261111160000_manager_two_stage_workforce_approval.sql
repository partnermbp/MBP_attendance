-- Manager-originated leave and attendance correction requests require
-- approval from the top Team Leader in the employee's reporting branch,
-- followed by final Admin/Supervisor review.
alter table public.workforce_leave_requests
  add column if not exists team_leader_reviewer_id uuid references public.profiles(id),
  add column if not exists team_leader_reviewed_by uuid references public.profiles(id),
  add column if not exists team_leader_reviewed_at timestamptz,
  add column if not exists team_leader_review_note text;
alter table public.attendance_correction_requests
  add column if not exists team_leader_reviewer_id uuid references public.profiles(id),
  add column if not exists team_leader_reviewed_by uuid references public.profiles(id),
  add column if not exists team_leader_reviewed_at timestamptz,
  add column if not exists team_leader_review_note text;

alter table public.workforce_leave_requests drop constraint if exists workforce_leave_requests_status_check;
alter table public.workforce_leave_requests add constraint workforce_leave_requests_status_check
check (status = any (array['pending','pending_team_leader','pending_admin','approved','rejected','cancelled']::text[]));
alter table public.attendance_correction_requests drop constraint if exists attendance_correction_requests_status_check;
alter table public.attendance_correction_requests add constraint attendance_correction_requests_status_check
check (status = any (array['pending','pending_team_leader','pending_admin','approved','rejected','cancelled']::text[]));

create or replace function public.get_top_team_leader(target_profile uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  with recursive ancestors(id, depth, path) as (
    select a.manager_id, 1, array[target_profile, a.manager_id]
    from public.manager_employee_assignments a where a.employee_id = target_profile
    union all
    select a.manager_id, x.depth + 1, x.path || a.manager_id
    from ancestors x join public.manager_employee_assignments a on a.employee_id = x.id
    where not a.manager_id = any(x.path) and x.depth < 20
  )
  select p.id from ancestors x join public.profiles p on p.id = x.id and p.active = true
  where lower(replace(p.role::text, ' ', '_')) = 'team_leader'
  order by x.depth desc limit 1;
$$;
revoke all on function public.get_top_team_leader(uuid) from public, anon;
revoke all on function public.get_top_team_leader(uuid) from public, anon, authenticated;

create or replace function public.route_workforce_request_to_team_leader()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.team_leader_reviewer_id := public.get_top_team_leader(new.employee_id);
  new.team_leader_reviewed_by := null;
  new.team_leader_reviewed_at := null;
  new.team_leader_review_note := null;
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.status := case when new.team_leader_reviewer_id is null then 'pending_admin' else 'pending_team_leader' end;
  return new;
end;
$$;
revoke all on function public.route_workforce_request_to_team_leader() from public, anon, authenticated;
drop trigger if exists route_leave_request_to_team_leader on public.workforce_leave_requests;
create trigger route_leave_request_to_team_leader before insert on public.workforce_leave_requests
for each row execute function public.route_workforce_request_to_team_leader();
drop trigger if exists route_correction_request_to_team_leader on public.attendance_correction_requests;
create trigger route_correction_request_to_team_leader before insert on public.attendance_correction_requests
for each row execute function public.route_workforce_request_to_team_leader();

drop policy if exists workforce_leave_select on public.workforce_leave_requests;
create policy workforce_leave_select on public.workforce_leave_requests for select to authenticated
using (employee_id = (select auth.uid())
  or (team_leader_reviewer_id = (select auth.uid()) and status = 'pending_team_leader')
  or ((public.is_active_admin() or public.is_active_supervisor())
    and (status = 'pending_admin' or status = 'approved' or (status = 'rejected' and reviewed_by is not null))));
drop policy if exists attendance_correction_select on public.attendance_correction_requests;
create policy attendance_correction_select on public.attendance_correction_requests for select to authenticated
using (employee_id = (select auth.uid())
  or (team_leader_reviewer_id = (select auth.uid()) and status = 'pending_team_leader')
  or ((public.is_active_admin() or public.is_active_supervisor())
    and (status = 'pending_admin' or status = 'approved' or (status = 'rejected' and reviewed_by is not null))));

drop policy if exists workforce_leave_review on public.workforce_leave_requests;
drop policy if exists attendance_correction_review on public.attendance_correction_requests;
drop policy if exists workforce_leave_insert on public.workforce_leave_requests;
create policy workforce_leave_insert on public.workforce_leave_requests for insert to authenticated
with check (employee_id = (select auth.uid()) and status in ('pending','pending_team_leader','pending_admin') and reviewed_by is null and reviewed_at is null);
drop policy if exists attendance_correction_insert on public.attendance_correction_requests;
create policy attendance_correction_insert on public.attendance_correction_requests for insert to authenticated
with check (employee_id = (select auth.uid()) and status in ('pending','pending_team_leader','pending_admin') and reviewed_by is null and reviewed_at is null);

revoke update on public.workforce_leave_requests from authenticated;
revoke update(status, reviewed_by, reviewed_at, review_note) on public.workforce_leave_requests from authenticated;
revoke update on public.attendance_correction_requests from authenticated;
revoke update(status, reviewed_by, reviewed_at, review_note) on public.attendance_correction_requests from authenticated;

create or replace function public.review_workforce_request(request_kind text, request_id uuid, decision text, note text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  target_table text;
  req record;
  actor uuid := auth.uid();
  actor_role text;
begin
  if actor is null or not public.is_auth_mfa_current() then raise exception 'A current authenticated session is required'; end if;
  if request_kind = 'leave' then target_table := 'workforce_leave_requests';
  elsif request_kind = 'correction' then target_table := 'attendance_correction_requests';
  else raise exception 'Invalid workforce request type'; end if;
  select lower(replace(role::text, ' ', '_')) into actor_role from public.profiles where id = actor and active = true;
  if actor_role is null then raise exception 'Active profile required'; end if;
  execute format('select id, employee_id, status, team_leader_reviewer_id from public.%I where id = $1 for update', target_table) into req using request_id;
  if req.id is null then raise exception 'Request not found or not visible'; end if;
  if req.status = 'pending_team_leader' then
    if req.team_leader_reviewer_id is distinct from actor or actor_role <> 'team_leader' then
      raise exception 'Only the assigned top-level team leader can review this request';
    end if;
    if decision = 'approved' then
      execute format('update public.%I set status = $1, team_leader_reviewed_by = $2, team_leader_reviewed_at = now(), team_leader_review_note = $3 where id = $4', target_table)
      using 'pending_admin', actor, note, request_id;
    elsif decision = 'rejected' then
      execute format('update public.%I set status = $1, team_leader_reviewed_by = $2, team_leader_reviewed_at = now(), team_leader_review_note = $3 where id = $4', target_table)
      using 'rejected', actor, note, request_id;
    else raise exception 'Invalid decision'; end if;
  elsif req.status = 'pending_admin' then
    if not (public.is_active_admin() or public.is_active_supervisor()) then raise exception 'Only Admin or Supervisor can perform the final review'; end if;
    if decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
    execute format('update public.%I set status = $1, reviewed_by = $2, reviewed_at = now(), review_note = $3 where id = $4', target_table)
    using decision, actor, note, request_id;
  else raise exception 'This request is no longer awaiting review'; end if;
  return jsonb_build_object('success', true, 'status', case when req.status = 'pending_team_leader' and decision = 'approved' then 'pending_admin' else decision end);
end;
$$;
revoke all on function public.review_workforce_request(text,uuid,text,text) from public, anon;
grant execute on function public.review_workforce_request(text,uuid,text,text) to authenticated;

create or replace function public.cancel_workforce_request(request_kind text, request_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare target_table text; req record;
begin
  if auth.uid() is null or not public.is_auth_mfa_current() then raise exception 'A current authenticated session is required'; end if;
  if request_kind = 'leave' then target_table := 'workforce_leave_requests';
  elsif request_kind = 'correction' then target_table := 'attendance_correction_requests';
  else raise exception 'Invalid workforce request type'; end if;
  execute format('select id, employee_id, status from public.%I where id = $1 for update', target_table) into req using request_id;
  if req.id is null or req.employee_id <> auth.uid() then raise exception 'You can only cancel your own request'; end if;
  if req.status not in ('pending','pending_team_leader','pending_admin') then raise exception 'This request can no longer be cancelled'; end if;
  execute format('update public.%I set status = $1 where id = $2', target_table) using 'cancelled', request_id;
  return jsonb_build_object('success', true, 'status', 'cancelled');
end;
$$;
revoke all on function public.cancel_workforce_request(text,uuid) from public, anon;
grant execute on function public.cancel_workforce_request(text,uuid) to authenticated;

drop policy if exists manager_followups_insert on public.manager_followups;
create policy manager_followups_insert on public.manager_followups for insert to authenticated
with check (created_by = (select auth.uid()) and employee_id <> (select auth.uid())
  and public.is_my_reporting_line(employee_id)
  and (assigned_to = (select auth.uid()) or public.is_my_reporting_line(assigned_to)));

-- Reconcile pending records created before this workflow was introduced.
update public.workforce_leave_requests
set team_leader_reviewer_id = public.get_top_team_leader(employee_id),
    status = case when public.get_top_team_leader(employee_id) is null then 'pending_admin' else 'pending_team_leader' end
where status in ('pending','pending_team_leader','pending_admin')
  and team_leader_reviewed_at is null and reviewed_at is null;
update public.attendance_correction_requests
set team_leader_reviewer_id = public.get_top_team_leader(employee_id),
    status = case when public.get_top_team_leader(employee_id) is null then 'pending_admin' else 'pending_team_leader' end
where status in ('pending','pending_team_leader','pending_admin')
  and team_leader_reviewed_at is null and reviewed_at is null;
