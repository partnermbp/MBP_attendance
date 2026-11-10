create or replace function public.prevent_overlapping_leave_requests()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status in ('pending','approved') and exists (
    select 1 from public.workforce_leave_requests other
    where other.employee_id = new.employee_id
      and other.id is distinct from new.id
      and other.status in ('pending','approved')
      and daterange(other.start_date, other.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'This leave request overlaps another pending or approved request';
  end if;
  return new;
end;
$$;
drop trigger if exists workforce_leave_no_overlap on public.workforce_leave_requests;
create trigger workforce_leave_no_overlap
before insert or update of employee_id,start_date,end_date,status
on public.workforce_leave_requests
for each row execute function public.prevent_overlapping_leave_requests();