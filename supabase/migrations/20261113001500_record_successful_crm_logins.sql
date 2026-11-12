-- Record successful CRM sign-ins only after the existing MFA/session approval check.
-- Idempotency is enforced by the existing partial unique index on session_id.
create or replace function public.record_crm_login(p_login_method text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile_id uuid := auth.uid();
  v_session_id uuid := nullif(auth.jwt()->>'session_id','')::uuid;
begin
  if v_profile_id is null or v_session_id is null then
    raise exception 'Authenticated approved session is required' using errcode='42501';
  end if;

  if p_login_method not in ('password_2fa','telegram_otp','invitation_registration') then
    raise exception 'Invalid CRM login method' using errcode='22023';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = v_profile_id and p.active = true
  ) then
    raise exception 'An active CRM profile is required' using errcode='42501';
  end if;

  if not exists (
    select 1 from public.crm_login_sessions s
    where s.session_id = v_session_id
      and s.user_id = v_profile_id
      and s.expires_at > now()
  ) then
    raise exception 'This session has not completed CRM login verification' using errcode='42501';
  end if;

  insert into public.crm_login_events(profile_id, login_method, session_id)
  values (v_profile_id, p_login_method, v_session_id)
  on conflict (session_id) where session_id is not null do nothing;
end;
$function$;

revoke all on function public.record_crm_login(text) from public, anon;
grant execute on function public.record_crm_login(text) to authenticated;
