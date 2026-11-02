-- Return exact Telegram username resolutions to the requesting CRM user and
-- retain the supplied usernames on Admin-reviewed Telegram ID change requests.

alter table public.telegram_inbox_search_requests
  add column if not exists resolved_telegram_user_id bigint,
  add column if not exists resolved_username text,
  add column if not exists purpose text not null default 'inbox';

alter table public.telegram_id_change_requests
  add column if not exists old_telegram_username text,
  add column if not exists new_telegram_username text;

-- Remove the previous numeric-only RPC. All current clients use the expanded
-- signature below, which validates any supplied @username against a recent
-- Telegram-worker resolution belonging to the same authenticated user.
drop function if exists public.submit_telegram_id_change_request(bigint, bigint, text);

create or replace function public.submit_telegram_id_change_request(
  p_old_telegram_user_id bigint,
  p_new_telegram_user_id bigint,
  p_comment text,
  p_old_telegram_username text default null,
  p_new_telegram_username text default null,
  p_old_lookup_request_id uuid default null,
  p_new_lookup_request_id uuid default null
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
  v_lookup public.telegram_inbox_search_requests%rowtype;
  v_old_username text := nullif(pg_catalog.lower(pg_catalog.btrim(p_old_telegram_username)), '');
  v_new_username text := nullif(pg_catalog.lower(pg_catalog.btrim(p_new_telegram_username)), '');
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

  if (v_old_username is null and p_old_lookup_request_id is not null)
     or (v_old_username is not null and p_old_lookup_request_id is null) then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'The previously registered Telegram handler could not be verified. Please check it and try again.');
  end if;
  if v_old_username is not null then
    if v_old_username !~ '^[a-z][a-z0-9_]{4,31}$' then
      return pg_catalog.jsonb_build_object('ok', false, 'message', 'Enter a valid previously registered Telegram handler.');
    end if;
    select r.* into v_lookup
    from public.telegram_inbox_search_requests r
    where r.id = p_old_lookup_request_id
      and r.requested_by = v_user_id
      and r.status = 'completed'
      and r.completed_at >= pg_catalog.now() - interval '10 minutes';
    if not found
       or v_lookup.resolved_telegram_user_id is distinct from p_old_telegram_user_id
       or pg_catalog.lower(coalesce(v_lookup.resolved_username, '')) <> v_old_username then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'contact_manager', true,
        'message', 'The previously registered Telegram handler could not be verified against your account. Please contact your manager personally to confirm it.'
      );
    end if;
  end if;

  if (v_new_username is null and p_new_lookup_request_id is not null)
     or (v_new_username is not null and p_new_lookup_request_id is null) then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'The new Telegram handler could not be verified. Please check it and try again.');
  end if;
  if v_new_username is not null then
    if v_new_username !~ '^[a-z][a-z0-9_]{4,31}$' then
      return pg_catalog.jsonb_build_object('ok', false, 'message', 'Enter a valid new Telegram handler.');
    end if;
    select r.* into v_lookup
    from public.telegram_inbox_search_requests r
    where r.id = p_new_lookup_request_id
      and r.requested_by = v_user_id
      and r.status = 'completed'
      and r.completed_at >= pg_catalog.now() - interval '10 minutes';
    if not found
       or v_lookup.resolved_telegram_user_id is distinct from p_new_telegram_user_id
       or pg_catalog.lower(coalesce(v_lookup.resolved_username, '')) <> v_new_username then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'message', 'That Telegram handler does not exist or could not be verified. Please check it and try again.'
      );
    end if;
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
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'Enter a valid new Telegram ID or handler.');
  end if;
  if p_new_telegram_user_id = v_current_telegram_id then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'The new Telegram account must be different from the registered account.');
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_comment, ''))) < 5
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_comment, ''))) > 1000 then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'Add a comment of 5 to 1000 characters explaining the change.');
  end if;
  if exists (
    select 1 from public.profiles p
    where p.telegram_user_id = p_new_telegram_user_id and p.id <> v_user_id
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'This Telegram account is already linked to another CRM account.');
  end if;
  if exists (
    select 1 from public.telegram_id_change_requests r
    where r.requester_profile_id = v_user_id and r.status = 'pending'
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'You already have a Telegram ID change request awaiting Admin review.');
  end if;

  insert into public.telegram_id_change_requests(
    requester_profile_id, requester_name, requester_email,
    old_telegram_user_id, new_telegram_user_id, old_telegram_username,
    new_telegram_username, comment
  )
  values (
    v_user_id, v_name, v_email,
    v_current_telegram_id, p_new_telegram_user_id, v_old_username,
    v_new_username, pg_catalog.btrim(p_comment)
  )
  returning id into v_request_id;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'request_id', v_request_id,
    'message', 'Your Telegram ID change request has been sent to Admin for review.'
  );
end;
$$;

revoke all on function public.submit_telegram_id_change_request(bigint, bigint, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.submit_telegram_id_change_request(bigint, bigint, text, text, text, uuid, uuid) to authenticated;
