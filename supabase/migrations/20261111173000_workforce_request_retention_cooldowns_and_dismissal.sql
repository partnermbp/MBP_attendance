-- Retain active workforce requests, hide completed items after 48 hours,
-- allow authorized manual dismissal, and enforce progressive server cooldowns.
alter table public.workforce_leave_requests add column if not exists completed_at timestamptz, add column if not exists archived_at timestamptz, add column if not exists archived_by uuid references public.profiles(id);
alter table public.attendance_correction_requests add column if not exists completed_at timestamptz, add column if not exists archived_at timestamptz, add column if not exists archived_by uuid references public.profiles(id);
alter table public.manager_followups add column if not exists archived_at timestamptz, add column if not exists archived_by uuid references public.profiles(id);

create or replace function public.mark_workforce_request_completed()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.status is distinct from old.status and new.status in ('approved','rejected','cancelled') then new.completed_at:=coalesce(new.completed_at,now());
 elsif new.status in ('pending','pending_team_leader','pending_admin') then new.completed_at:=null; end if;
 return new;
end; $$;
drop trigger if exists mark_leave_request_completed on public.workforce_leave_requests;
create trigger mark_leave_request_completed before update of status on public.workforce_leave_requests for each row execute function public.mark_workforce_request_completed();
drop trigger if exists mark_correction_request_completed on public.attendance_correction_requests;
create trigger mark_correction_request_completed before update of status on public.attendance_correction_requests for each row execute function public.mark_workforce_request_completed();
update public.workforce_leave_requests set completed_at=coalesce(reviewed_at,team_leader_reviewed_at,created_at) where status in ('approved','rejected','cancelled') and completed_at is null;
update public.attendance_correction_requests set completed_at=coalesce(reviewed_at,team_leader_reviewed_at,created_at) where status in ('approved','rejected','cancelled') and completed_at is null;

drop policy if exists workforce_leave_select on public.workforce_leave_requests;
create policy workforce_leave_select on public.workforce_leave_requests for select to authenticated using (archived_at is null and (completed_at is null or completed_at>now()-interval '48 hours') and (employee_id=(select auth.uid()) or (team_leader_reviewer_id=(select auth.uid()) and status='pending_team_leader') or ((public.is_active_admin() or public.is_active_supervisor()) and (status='pending_admin' or status='approved' or (status='rejected' and reviewed_by is not null)))));
drop policy if exists attendance_correction_select on public.attendance_correction_requests;
create policy attendance_correction_select on public.attendance_correction_requests for select to authenticated using (archived_at is null and (completed_at is null or completed_at>now()-interval '48 hours') and (employee_id=(select auth.uid()) or (team_leader_reviewer_id=(select auth.uid()) and status='pending_team_leader') or ((public.is_active_admin() or public.is_active_supervisor()) and (status='pending_admin' or status='approved' or (status='rejected' and reviewed_by is not null)))));

create table if not exists public.workforce_request_rate_limits(user_id uuid not null references public.profiles(id) on delete cascade,request_kind text not null check(request_kind in ('leave','correction','followup')),violation_count integer not null default 0,next_allowed_at timestamptz not null default now(),last_attempt_at timestamptz not null default now(),primary key(user_id,request_kind));
alter table public.workforce_request_rate_limits enable row level security;
revoke all on public.workforce_request_rate_limits from public,anon,authenticated;

create or replace function public.create_workforce_request(request_kind text,payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); throttle public.workforce_request_rate_limits%rowtype; wait_seconds integer; new_id uuid;
begin
 if actor is null or not public.is_auth_mfa_current() then raise exception 'A current authenticated session is required'; end if;
 if request_kind not in ('leave','correction','followup') then raise exception 'Invalid request type'; end if;
 insert into public.workforce_request_rate_limits(user_id,request_kind,next_allowed_at,last_attempt_at) values(actor,request_kind,now(),now()) on conflict(user_id,request_kind) do nothing;
 select * into throttle from public.workforce_request_rate_limits where user_id=actor and request_kind=create_workforce_request.request_kind for update;
 if now()<throttle.next_allowed_at then
  wait_seconds:=greatest(1,ceil(extract(epoch from(throttle.next_allowed_at-now())))::integer);
  update public.workforce_request_rate_limits set violation_count=least(violation_count+1,4),next_allowed_at=now()+(case least(violation_count+1,4) when 1 then interval '5 minutes' when 2 then interval '15 minutes' when 3 then interval '30 minutes' else interval '60 minutes' end),last_attempt_at=now() where user_id=actor and request_kind=create_workforce_request.request_kind;
  raise exception 'Too many requests. Please wait % seconds before trying again. Repeated attempts increase the cooldown.',wait_seconds;
 end if;
 update public.workforce_request_rate_limits set next_allowed_at=now()+interval '2 minutes',violation_count=case when last_attempt_at<now()-interval '24 hours' then 0 else violation_count end,last_attempt_at=now() where user_id=actor and request_kind=create_workforce_request.request_kind;
 if request_kind='leave' then
  insert into public.workforce_leave_requests(employee_id,leave_type,start_date,end_date,reason) values(actor,coalesce(payload->>'leave_type','Annual leave'),(payload->>'start_date')::date,(payload->>'end_date')::date,nullif(payload->>'reason','')) returning id into new_id;
 elsif request_kind='correction' then
  insert into public.attendance_correction_requests(employee_id,attendance_id,work_date,requested_check_in,requested_check_out,reason) values(actor,nullif(payload->>'attendance_id','')::uuid,(payload->>'work_date')::date,nullif(payload->>'requested_check_in','')::timestamptz,nullif(payload->>'requested_check_out','')::timestamptz,coalesce(payload->>'reason','')) returning id into new_id;
 else
  if (payload->>'employee_id')::uuid=actor then raise exception 'A follow-up must be created for a subordinate, not yourself'; end if;
  if not public.is_my_reporting_line((payload->>'employee_id')::uuid) then raise exception 'You can create follow-ups only for your subordinates'; end if;
  if coalesce(nullif(payload->>'assigned_to','')::uuid,actor)<>actor and not public.is_my_reporting_line((payload->>'assigned_to')::uuid) then raise exception 'Assigned manager must be in your reporting line'; end if;
  insert into public.manager_followups(employee_id,assigned_to,created_by,title,notes,due_date,priority) values((payload->>'employee_id')::uuid,coalesce(nullif(payload->>'assigned_to','')::uuid,actor),actor,coalesce(payload->>'title',''),nullif(payload->>'notes',''),nullif(payload->>'due_date','')::date,coalesce(payload->>'priority','normal')) returning id into new_id;
 end if;
 return jsonb_build_object('success',true,'id',new_id,'next_allowed_at',now()+interval '2 minutes');
end; $$;
revoke all on function public.create_workforce_request(text,jsonb) from public,anon;
grant execute on function public.create_workforce_request(text,jsonb) to authenticated;

alter table public.manager_followups add column if not exists completed_at timestamptz;
create or replace function public.mark_manager_followup_completed() returns trigger language plpgsql set search_path=public as $$
begin if new.status='resolved' and old.status is distinct from new.status then new.completed_at:=coalesce(new.completed_at,now()); elsif new.status<>'resolved' then new.completed_at:=null; end if; return new; end; $$;
drop trigger if exists mark_manager_followup_completed on public.manager_followups;
create trigger mark_manager_followup_completed before update of status on public.manager_followups for each row execute function public.mark_manager_followup_completed();
update public.manager_followups set completed_at=coalesce(updated_at,created_at) where status='resolved' and completed_at is null;
drop policy if exists manager_followups_select on public.manager_followups;
create policy manager_followups_select on public.manager_followups for select to authenticated using (archived_at is null and (completed_at is null or completed_at>now()-interval '48 hours') and ((created_by=(select auth.uid())) or (assigned_to=(select auth.uid())) or (employee_id=(select auth.uid())) or public.is_my_reporting_line(employee_id)));

create or replace function public.dismiss_workforce_request(request_kind text,request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target_table text; req record; actor uuid:=auth.uid();
begin
 if actor is null or not public.is_auth_mfa_current() then raise exception 'A current authenticated session is required'; end if;
 if request_kind='leave' then target_table:='workforce_leave_requests';
 elsif request_kind='correction' then target_table:='attendance_correction_requests';
 elsif request_kind='followup' then
  select id,created_by,assigned_to,status into req from public.manager_followups where id=request_id for update;
  if req.id is null then raise exception 'Request not found'; end if;
  if req.status<>'resolved' then raise exception 'Active follow-ups cannot be removed'; end if;
  if not(req.created_by=actor or req.assigned_to=actor or public.is_active_admin() or public.is_active_supervisor()) then raise exception 'You cannot remove this follow-up'; end if;
  update public.manager_followups set archived_at=now(),archived_by=actor where id=request_id;
  return jsonb_build_object('success',true,'removed',true);
 else raise exception 'Invalid request type'; end if;
 execute format('select id,employee_id,status,team_leader_reviewer_id,reviewed_by from public.%I where id=$1 for update',target_table) into req using request_id;
 if req.id is null then raise exception 'Request not found'; end if;
 if req.status not in('approved','rejected','cancelled') then raise exception 'Active requests cannot be removed'; end if;
 if not(req.employee_id=actor or req.team_leader_reviewer_id=actor or req.reviewed_by=actor or public.is_active_admin() or public.is_active_supervisor()) then raise exception 'You cannot remove this request from the panel'; end if;
 execute format('update public.%I set archived_at=now(),archived_by=$1 where id=$2',target_table) using actor,request_id;
 return jsonb_build_object('success',true,'removed',true);
end; $$;
revoke all on function public.dismiss_workforce_request(text,uuid) from public,anon;
grant execute on function public.dismiss_workforce_request(text,uuid) to authenticated;

drop policy if exists workforce_leave_insert on public.workforce_leave_requests;
drop policy if exists attendance_correction_insert on public.attendance_correction_requests;
drop policy if exists manager_followups_insert on public.manager_followups;
revoke insert on public.workforce_leave_requests from authenticated;
revoke insert on public.attendance_correction_requests from authenticated;
revoke insert on public.manager_followups from authenticated;
