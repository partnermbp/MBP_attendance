-- Align attendance row-level security with the new multi-level manager hierarchy.
-- Admins can view all attendance; employees can view their own rows while active;
-- Middle/Senior/Team Leader accounts can view assigned descendants through is_assigned_manager().
drop policy if exists "Read permitted attendance" on public.attendance;

create policy "Read permitted attendance"
  on public.attendance
  for select
  to authenticated
  using (
    public.is_active_admin()
    or (
      employee_id = auth.uid()
      and exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.active = true
      )
    )
    or public.is_assigned_manager(employee_id)
  );
