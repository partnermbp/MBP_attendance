-- Remove the four-attempt lockout from Telegram ID change requests.
-- The old-ID field now has an inline reminder to contact the manager if the ID is unknown.
create or replace function public.submit_telegram_id_change_request(
  p_old_telegram_user_id bigint,
  p_new_telegram_user_id bigint,
  p_comment text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_telegram_id bigint;
  v_request_id bigint;
  v_name text;
  v_email text;
begin
  if v_user_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'Sign in with your work account first.');
  end if;

  select p.telegram_user_id, p.full_name, p.email
    into v_current_telegram_id, v_name, v_email
  from public.profiles p
  where p.id = v_user_id and p.active = true
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'An active CRM account is required.');
  end if;
  if v_current_telegram_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'Your account does not have a registered Telegram ID. Contact your manager.');
  end if;

  if p_old_telegram_user_id is null or p_old_telegram_user_id <> v_current_telegram_id then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'contact_manager', true,
      'message', 'The previously registered Telegram ID does not match. Please contact your manager personally to confirm your old Telegram ID.'
    );
  end if;

  if exists (
    select 1 from public.telegram_id_request_restrictions r
    where r.telegram_user_id = v_current_telegram_id
  ) then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'restricted', true,
      'message', 'Further Telegram ID change requests from this Telegram account are restricted. Please contact your manager.'
    );
  end if;

  if p_new_telegram_user_id is null or p_new_telegram_user_id <= 0 then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'Enter a valid new Telegram ID.');
  end if;
  if p_new_telegram_user_id = v_current_telegram_id then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'The new Telegram ID must be different from the registered ID.');
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_comment, ''))) < 5
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_comment, ''))) > 1000 then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'Add a comment of 5 to 1000 characters explaining the change.');
  end if;
  if exists (
    select 1 from public.profiles p
    where p.telegram_user_id = p_new_telegram_user_id and p.id <> v_user_id
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'This Telegram ID is already linked to another CRM account.');
  end if;
  if exists (
    select 1 from public.telegram_id_change_requests r
    where r.requester_profile_id = v_user_id and r.status = 'pending'
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'You already have a Telegram ID change request awaiting Admin review.');
  end if;

  insert into public.telegram_id_change_requests(
    requester_profile_id, requester_name, requester_email,
    old_telegram_user_id, new_telegram_user_id, comment
  )
  values (
    v_user_id, v_name, v_email,
    v_current_telegram_id, p_new_telegram_user_id, pg_catalog.btrim(p_comment)
  )
  returning id into v_request_id;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'request_id', v_request_id,
    'message', 'Your Telegram ID change request has been sent to Admin for review.'
  );
end;
$$;

revoke all on function public.submit_telegram_id_change_request(bigint, bigint, text) from public, anon;
grant execute on function public.submit_telegram_id_change_request(bigint, bigint, text) to authenticated;
