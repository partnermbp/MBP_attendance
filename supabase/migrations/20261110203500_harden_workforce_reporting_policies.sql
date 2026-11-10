-- Restrict workforce review access to the caller's actual reporting tree.
-- Keep employee-created requests self-only and constrain updates to review fields.
create or replace function public.is_my_reporting_line(target_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive descendants(id) as (
    select a.employee_id from public.manager_employee_assignments a where a.manager_id = auth.uid()
    union
    select a.employee_id from public.manager_employee_assignments a join descendants d on a.manager_id = d.id
  )
  select public.is_auth_mfa_current()
    and exists (select 1 from public.profiles me where me.id = auth.uid() and me.active = true)
    and (public.is_active_admin() or public.is_active_supervisor()
      or exists (select 1 from descendants d where d.id = target_profile));
$$;
revoke all on function public.is_my_reporting_line(uuid) from public, anon;
grant execute on function public.is_my_reporting_line(uuid) to authenticated;

drop policy if exists workforce_leave_select on public.workforce_leave_requests;
create policy workforce_leave_select on public.workforce_leave_requests for select to authenticated
using (employee_id = (select auth.uid()) or public.is_my_reporting_line(employee_id));
drop policy if exists workforce_leave_review on public.workforce_leave_requests;
create policy workforce_leave_review on public.workforce_leave_requests for update to authenticated
using (public.is_my_reporting_line(employee_id))
with check (public.is_my_reporting_line(employee_id));

drop policy if exists attendance_correction_select on public.attendance_correction_requests;
create policy attendance_correction_select on public.attendance_correction_requests for select to authenticated
using (employee_id = (select auth.uid()) or public.is_my_reporting_line(employee_id));
drop policy if exists attendance_correction_review on public.attendance_correction_requests;
create policy attendance_correction_review on public.attendance_correction_requests for update to authenticated
using (public.is_my_reporting_line(employee_id))
with check (public.is_my_reporting_line(employee_id));

drop policy if exists manager_followups_select on public.manager_followups;
create policy manager_followups_select on public.manager_followups for select to authenticated
using (created_by = (select auth.uid()) or assigned_to = (select auth.uid()) or employee_id = (select auth.uid()) or public.is_my_reporting_line(employee_id));
drop policy if exists manager_followups_insert on public.manager_followups;
create policy manager_followups_insert on public.manager_followups for insert to authenticated
with check (created_by = (select auth.uid()) and public.is_my_reporting_line(employee_id)
  and (assigned_to = (select auth.uid()) or public.is_my_reporting_line(assigned_to)));
drop policy if exists manager_followups_update on public.manager_followups;
create policy manager_followups_update on public.manager_followups for update to authenticated
using (assigned_to = (select auth.uid()) or created_by = (select auth.uid()) or public.is_active_admin() or public.is_active_supervisor())
with check (assigned_to = (select auth.uid()) or created_by = (select auth.uid()) or public.is_active_admin() or public.is_active_supervisor());

revoke update on public.workforce_leave_requests from authenticated;
grant update(status, reviewed_by, reviewed_at, review_note) on public.workforce_leave_requests to authenticated;
revoke update on public.attendance_correction_requests from authenticated;
grant update(status, reviewed_by, reviewed_at, review_note) on public.attendance_correction_requests to authenticated;
revoke update on public.manager_followups from authenticated;
grant update(status, resolution_note, updated_at) on public.manager_followups to authenticated;
