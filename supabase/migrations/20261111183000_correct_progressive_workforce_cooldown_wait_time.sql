create or replace function public.create_workforce_request(request_kind text,payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); throttle public.workforce_request_rate_limits%rowtype; wait_seconds integer; new_id uuid; admin_override boolean;
begin
 if actor is null or not public.is_auth_mfa_current() then raise exception 'A current authenticated session is required'; end if;
 if request_kind not in ('leave','correction','followup') then raise exception 'Invalid request type'; end if;
 insert into public.workforce_request_rate_limits(user_id,request_kind,next_allowed_at,last_attempt_at) values(actor,request_kind,now(),now()) on conflict(user_id,request_kind) do nothing;
 select * into throttle from public.workforce_request_rate_limits where user_id=actor and request_kind=create_workforce_request.request_kind for update;
 if now()<throttle.next_allowed_at then
  wait_seconds:=case least(throttle.violation_count+1,4) when 1 then 300 when 2 then 900 when 3 then 1800 else 3600 end;
  update public.workforce_request_rate_limits set violation_count=least(violation_count+1,4),next_allowed_at=now()+make_interval(secs=>wait_seconds),last_attempt_at=now() where user_id=actor and request_kind=create_workforce_request.request_kind;
  return jsonb_build_object('success',false,'retry_after_seconds',wait_seconds,'message',format('Too many requests. Please wait %s minutes before trying again. Repeated attempts increase the cooldown.',ceil(wait_seconds/60.0)::integer));
 end if;
 update public.workforce_request_rate_limits set next_allowed_at=now()+interval '2 minutes',violation_count=case when last_attempt_at<now()-interval '24 hours' then 0 else violation_count end,last_attempt_at=now() where user_id=actor and request_kind=create_workforce_request.request_kind;
 if request_kind='leave' then
  insert into public.workforce_leave_requests(employee_id,leave_type,start_date,end_date,reason) values(actor,coalesce(payload->>'leave_type','Annual leave'),(payload->>'start_date')::date,(payload->>'end_date')::date,nullif(payload->>'reason','')) returning id into new_id;
 elsif request_kind='correction' then
  insert into public.attendance_correction_requests(employee_id,attendance_id,work_date,requested_check_in,requested_check_out,reason) values(actor,nullif(payload->>'attendance_id','')::uuid,(payload->>'work_date')::date,nullif(payload->>'requested_check_in','')::timestamptz,nullif(payload->>'requested_check_out','')::timestamptz,coalesce(payload->>'reason','')) returning id into new_id;
 else
  if (payload->>'employee_id')::uuid=actor then raise exception 'A follow-up must be created for a subordinate, not yourself'; end if;
  admin_override:=public.is_active_admin();
  if not admin_override and not public.is_my_reporting_line((payload->>'employee_id')::uuid) then raise exception 'You can create follow-ups only for your subordinates'; end if;
  if coalesce(nullif(payload->>'assigned_to','')::uuid,actor)<>actor and not admin_override and not public.is_my_reporting_line((payload->>'assigned_to')::uuid) then raise exception 'Assigned manager must be in your reporting line'; end if;
  insert into public.manager_followups(employee_id,assigned_to,created_by,title,notes,due_date,priority) values((payload->>'employee_id')::uuid,coalesce(nullif(payload->>'assigned_to','')::uuid,actor),actor,coalesce(payload->>'title',''),nullif(payload->>'notes',''),nullif(payload->>'due_date','')::date,coalesce(payload->>'priority','normal')) returning id into new_id;
 end if;
 return jsonb_build_object('success',true,'id',new_id,'next_allowed_at',now()+interval '2 minutes');
end; $$;
revoke all on function public.create_workforce_request(text,jsonb) from public,anon;
grant execute on function public.create_workforce_request(text,jsonb) to authenticated;