alter table public.attendance_correction_requests
  add column if not exists applied_by uuid references public.profiles(id),
  add column if not exists applied_at timestamptz,
  add column if not exists original_check_in timestamptz,
  add column if not exists original_check_out timestamptz;

create or replace function public.apply_attendance_correction(request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.attendance_correction_requests%rowtype;
  old_in timestamptz;
  old_out timestamptz;
begin
  if auth.uid() is null or not public.is_active_admin() then
    raise exception 'Only an active admin can apply an approved attendance correction';
  end if;
  select * into req from public.attendance_correction_requests where id = request_id for update;
  if not found then raise exception 'Correction request not found'; end if;
  if req.status <> 'approved' then raise exception 'Only approved requests can be applied'; end if;
  if req.applied_at is not null then raise exception 'This correction has already been applied'; end if;
  if req.attendance_id is null then raise exception 'This request is not linked to an attendance session'; end if;
  select check_in, check_out into old_in, old_out
    from public.attendance where id = req.attendance_id and employee_id = req.employee_id for update;
  if not found then raise exception 'Linked attendance session was not found for this employee'; end if;
  update public.attendance
    set check_in = coalesce(req.requested_check_in, old_in),
        check_out = coalesce(req.requested_check_out, old_out)
    where id = req.attendance_id;
  update public.attendance_correction_requests
    set original_check_in = old_in, original_check_out = old_out,
        applied_by = auth.uid(), applied_at = now()
    where id = req.id;
  return jsonb_build_object('success', true, 'attendance_id', req.attendance_id, 'applied_at', now());
end;
$$;
revoke all on function public.apply_attendance_correction(uuid) from public, anon;
grant execute on function public.apply_attendance_correction(uuid) to authenticated;