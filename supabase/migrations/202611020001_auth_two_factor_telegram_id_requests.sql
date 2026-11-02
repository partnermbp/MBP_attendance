-- Require password-authenticated sessions before Telegram login codes can be issued,
-- and add an audited, Admin-reviewed workflow for changing a registered Telegram ID.

create table if not exists public.telegram_login_codes (
  id bigint generated always as identity primary key,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.telegram_login_codes enable row level security;
revoke all on public.telegram_login_codes from anon, authenticated;
grant all on public.telegram_login_codes to service_role;
create index if not exists telegram_login_codes_email_created_idx
  on public.telegram_login_codes(email, created_at desc);

create table if not exists public.telegram_id_change_attempts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 4),
  blocked_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.telegram_id_change_attempts enable row level security;
revoke all on public.telegram_id_change_attempts from anon, authenticated;

create table if not exists public.telegram_id_request_restrictions (
  telegram_user_id bigint primary key,
  restricted_by uuid references public.profiles(id) on delete set null,
  restricted_at timestamptz not null default now(),
  reason text not null default 'Further Telegram ID change requests restricted by Admin'
);
alter table public.telegram_id_request_restrictions enable row level security;
revoke all on public.telegram_id_request_restrictions from anon, authenticated;

create table if not exists public.telegram_id_change_requests (
  id bigint generated always as identity primary key,
  requester_profile_id uuid references public.profiles(id) on delete set null,
  requester_name text,
  requester_email text,
  old_telegram_user_id bigint not null,
  new_telegram_user_id bigint not null,
  comment text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'restricted')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  admin_note text,
  created_at timestamptz not null default now(),
  constraint telegram_id_change_request_different_ids check (old_telegram_user_id <> new_telegram_user_id),
  constraint telegram_id_change_request_positive_ids check (old_telegram_user_id > 0 and new_telegram_user_id > 0)
);
alter table public.telegram_id_change_requests enable row level security;
revoke all on public.telegram_id_change_requests from anon, authenticated;
grant select on public.telegram_id_change_requests to authenticated;

drop policy if exists telegram_id_change_requests_admin_read on public.telegram_id_change_requests;
create policy telegram_id_change_requests_admin_read
  on public.telegram_id_change_requests for select to authenticated
  using (public.is_active_admin());

create index if not exists telegram_id_change_requests_status_created_idx
  on public.telegram_id_change_requests(status, created_at desc);
create index if not exists telegram_id_change_requests_requester_idx
  on public.telegram_id_change_requests(requester_profile_id, created_at desc);

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
  v_failed_attempts smallint;
  v_blocked_at timestamptz;
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

  insert into public.telegram_id_change_attempts(profile_id)
  values (v_user_id)
  on conflict (profile_id) do nothing;

  select a.failed_attempts, a.blocked_at
    into v_failed_attempts, v_blocked_at
  from public.telegram_id_change_attempts a
  where a.profile_id = v_user_id
  for update;

  if v_blocked_at is not null or v_failed_attempts >= 4 then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'contact_manager', true, 'attempts', 4,
      'message', 'You have used all four attempts. Please contact your manager to change your Telegram ID.'
    );
  end if;

  if p_old_telegram_user_id is null or p_old_telegram_user_id <> v_current_telegram_id then
    update public.telegram_id_change_attempts
    set failed_attempts = least(failed_attempts + 1, 4),
        blocked_at = case when failed_attempts + 1 >= 4 then pg_catalog.now() else blocked_at end,
        updated_at = pg_catalog.now()
    where profile_id = v_user_id
    returning failed_attempts into v_failed_attempts;

    if v_failed_attempts >= 4 then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'contact_manager', true, 'attempts', 4,
        'message', 'That was the fourth incorrect attempt. Please contact your manager to change your Telegram ID.'
      );
    end if;

    return pg_catalog.jsonb_build_object(
      'ok', false, 'contact_manager', false, 'attempts', v_failed_attempts,
      'attempts_remaining', 4 - v_failed_attempts,
      'message', 'The previously registered Telegram ID does not match. Check the ID and try again.'
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

  update public.telegram_id_change_attempts
  set failed_attempts = 0, updated_at = pg_catalog.now()
  where profile_id = v_user_id;

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

create or replace function public.review_telegram_id_change_request(
  p_request_id bigint,
  p_action text,
  p_admin_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.telegram_id_change_requests%rowtype;
begin
  if not public.is_active_admin() then
    raise exception 'Only an active Admin can review Telegram ID change requests' using errcode = '42501';
  end if;

  if p_action not in ('approve', 'reject', 'restrict') then
    raise exception 'Choose approve, reject, or restrict';
  end if;

  select * into v_request
  from public.telegram_id_change_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'pending' then raise exception 'This request has already been reviewed'; end if;

  if p_action = 'approve' then
    if v_request.requester_profile_id is null then
      raise exception 'The requesting CRM account no longer exists';
    end if;
    if exists (
      select 1 from public.profiles p
      where p.telegram_user_id = v_request.new_telegram_user_id
        and p.id <> v_request.requester_profile_id
    ) then
      raise exception 'The requested Telegram ID is now linked to another CRM account';
    end if;

    update public.profiles
    set telegram_user_id = v_request.new_telegram_user_id,
        telegram_verified_at = pg_catalog.now()
    where id = v_request.requester_profile_id and active = true;
    if not found then raise exception 'The requesting CRM account is inactive'; end if;

    update public.telegram_id_change_requests
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = pg_catalog.now(),
        admin_note = nullif(pg_catalog.btrim(coalesce(p_admin_note, '')), '')
    where id = p_request_id;

    return pg_catalog.jsonb_build_object('ok', true, 'message', 'Request approved. The registered Telegram ID has been updated.');
  elsif p_action = 'reject' then
    update public.telegram_id_change_requests
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = pg_catalog.now(),
        admin_note = nullif(pg_catalog.btrim(coalesce(p_admin_note, '')), '')
    where id = p_request_id;

    return pg_catalog.jsonb_build_object('ok', true, 'message', 'Request rejected.');
  else
    insert into public.telegram_id_request_restrictions(telegram_user_id, restricted_by, reason)
    values (
      v_request.old_telegram_user_id, auth.uid(),
      'Further Telegram ID change requests restricted by Admin for request #' || p_request_id::text
    )
    on conflict (telegram_user_id) do update
      set restricted_by = excluded.restricted_by,
          restricted_at = pg_catalog.now(),
          reason = excluded.reason;

    update public.telegram_id_change_requests
    set status = 'restricted', reviewed_by = auth.uid(), reviewed_at = pg_catalog.now(),
        admin_note = nullif(pg_catalog.btrim(coalesce(p_admin_note, '')), '')
    where id = p_request_id;

    return pg_catalog.jsonb_build_object('ok', true, 'message', 'Further requests from this previously registered Telegram ID are now restricted.');
  end if;
end;
$$;

revoke all on function public.review_telegram_id_change_request(bigint, text, text) from public, anon;
grant execute on function public.review_telegram_id_change_request(bigint, text, text) to authenticated;
