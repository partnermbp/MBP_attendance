create or replace function public.set_device_location_consent(p_session_id uuid,p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_enabled and not exists(
    select 1 from public.attendance a
    where a.employee_id=v_user and a.check_out is null
  ) then
    raise exception 'Location sharing can only be enabled during an active attendance shift' using errcode='42501';
  end if;
  update public.device_security_sessions
  set location_tracking_enabled=p_enabled,
      location_consent_at=case when p_enabled then now() else location_consent_at end
  where id=p_session_id and user_id=v_user and ended_at is null;
  if not found then raise exception 'Device session not found' using errcode='42501'; end if;
end;
$function$;
revoke all on function public.set_device_location_consent(uuid,boolean) from public,anon;
grant execute on function public.set_device_location_consent(uuid,boolean) to authenticated;