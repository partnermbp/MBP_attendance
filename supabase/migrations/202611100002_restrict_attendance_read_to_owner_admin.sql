-- Attendance GPS and location metadata are restricted to the employee concerned and Admin.
-- Managers use the authenticated manager-team-attendance Edge Function, which returns
-- attendance times only and never selects GPS coordinates or derived location labels.

drop policy if exists "Read permitted attendance" on public.attendance;
drop policy if exists "Read own attendance or admin attendance" on public.attendance;

create policy "Read own attendance or admin attendance"
on public.attendance
for select
to authenticated
using (
  is_auth_mfa_current()
  and (
    is_active_admin()
    or (
      employee_id = auth.uid()
      and exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.active = true
      )
    )
  )
);