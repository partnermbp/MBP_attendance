-- Bind each invitation to the inviter-entered MBP Admin Panel identity and a verified Telegram account.
create extension if not exists pgcrypto with schema extensions;

alter table public.manager_invitations
  add column if not exists admin_panel_name text,
  add column if not exists corporate_email text;

alter table public.profiles
  add column if not exists admin_panel_name text,
  add column if not exists telegram_user_id bigint,
  add column if not exists telegram_verified_at timestamptz;

create unique index if not exists profiles_telegram_user_id_unique
  on public.profiles(telegram_user_id) where telegram_user_id is not null;

create table if not exists public.manager_invitation_telegram_verifications (
  id bigint generated always as identity primary key,
  invitation_id bigint not null references public.manager_invitations(id) on delete cascade,
  challenge_hash text not null unique,
  otp_hash text,
  otp_expires_at timestamptz,
  otp_sent_at timestamptz,
  attempts integer not null default 0,
  telegram_user_id bigint,
  telegram_username text,
  verified_at timestamptz,
  ticket_hash text unique,
  ticket_expires_at timestamptz,
  ticket_used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.manager_invitation_telegram_verifications enable row level security;
revoke all on public.manager_invitation_telegram_verifications from anon, authenticated;

drop function if exists public.create_manager_invitation(text);
create or replace function public.create_manager_invitation(
  invited_role text,
  invitee_admin_panel_name text,
  invitee_corporate_email text
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  raw_token text := encode(extensions.gen_random_bytes(32), 'hex');
  normalized_role text := lower(trim(replace(invited_role, '_', ' ')));
  inviter_role text;
  normalized_email text := lower(trim(invitee_corporate_email));
  normalized_name text := trim(invitee_admin_panel_name);
begin
  select lower(replace(role::text, '_', ' ')) into inviter_role
  from public.profiles where id = auth.uid() and active = true;

  if inviter_role is null then raise exception 'An active CRM profile is required' using errcode = '42501'; end if;
  if normalized_name is null or length(normalized_name) < 2 or length(normalized_name) > 120 then
    raise exception 'Enter a valid Admin Panel Name';
  end if;
  if normalized_email is null or length(normalized_email) > 254 or
     normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid corporate email';
  end if;
  if split_part(normalized_email, '@', 2) not in ('mostbet.partners','infradim.com','starson.cloud','double.global')
     and normalized_email <> 'partnermbp@gmail.com' then
    raise exception 'This corporate email domain is not approved for the CRM.';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = normalized_email) then
    raise exception 'An account already exists for this corporate email. Ask Admin to review it instead of creating another invitation.';
  end if;
  if exists (select 1 from public.profiles p where lower(p.admin_panel_name) = lower(normalized_name)) then
    raise exception 'This Admin Panel Name is already assigned to a CRM profile. Ask Admin to review it.';
  end if;
  if exists (select 1 from public.manager_invitations i where lower(i.corporate_email) = normalized_email and i.redeemed_at is null and i.expires_at > now()) then
    raise exception 'An active invitation already exists for this corporate email.';
  end if;

  if normalized_role = 'telemarketing' then
    if not public.is_active_admin() then raise exception 'Only Admin can invite Telemarketing staff' using errcode = '42501'; end if;
  elsif normalized_role in ('junior','middle','senior','team leader') then
    if inviter_role not in ('team leader','senior','middle') then
      raise exception 'Only Team Leader, Senior, or Middle can invite into the management hierarchy' using errcode = '42501';
    end if;
    if (inviter_role = 'middle' and normalized_role <> 'junior')
      or (inviter_role = 'senior' and normalized_role not in ('middle','junior'))
      or (inviter_role = 'team leader' and normalized_role not in ('senior','middle','junior')) then
      raise exception 'You cannot invite someone into a role equal to or above your own' using errcode = '42501';
    end if;
  else
    raise exception 'Unsupported invitation role';
  end if;

  insert into public.manager_invitations(token_hash, invited_by, invited_role, admin_panel_name, corporate_email)
  values (encode(extensions.digest(raw_token, 'sha256'), 'hex'), auth.uid(),
    case normalized_role when 'team leader' then 'team_leader' else normalized_role end,
    normalized_name, normalized_email);
  return raw_token;
end;
$$;
grant execute on function public.create_manager_invitation(text,text,text) to authenticated;

create or replace function public.get_manager_invitation_details(invitation_token text)
returns table(admin_panel_name text, corporate_email text, invited_role text, expires_at timestamptz, valid boolean)
language sql security definer set search_path = public
as $$
  select i.admin_panel_name, i.corporate_email, i.invited_role, i.expires_at,
    (i.redeemed_at is null and i.expires_at > now())
  from public.manager_invitations i
  where i.token_hash = encode(extensions.digest(invitation_token, 'sha256'), 'hex')
  limit 1;
$$;
grant execute on function public.get_manager_invitation_details(text) to anon, authenticated;

-- Remove the old ticket-less RPC: leaving it callable would bypass Telegram verification.
drop function if exists public.redeem_manager_invitation(text);

-- Redeem only after OTP verification. Existing accounts can never use an invite to change role.
create or replace function public.redeem_manager_invitation(invitation_token text, registration_ticket text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  inv public.manager_invitations%rowtype;
  verification public.manager_invitation_telegram_verifications%rowtype;
  current_role text;
  current_email text;
begin
  if auth.uid() is null then raise exception 'Complete account registration or sign in first' using errcode = '42501'; end if;
  select * into inv from public.manager_invitations
  where token_hash = encode(extensions.digest(invitation_token, 'sha256'), 'hex')
    and redeemed_at is null and expires_at > now() for update;
  if not found then raise exception 'Invitation is invalid, expired, or already used'; end if;
  if inv.invited_by = auth.uid() then raise exception 'You cannot redeem your own invitation'; end if;

  select lower(replace(p.role::text, '_', ' ')), lower(u.email)
    into current_role, current_email
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = auth.uid() and p.active = true;

  if current_role is null then raise exception 'Active CRM profile not found'; end if;
  if current_role <> 'employee' then
    raise exception 'This account is already registered. Role changes require a separate Admin approval.';
  end if;
  if current_email <> lower(inv.corporate_email) then raise exception 'This account email does not match the invitation'; end if;

  select * into verification
  from public.manager_invitation_telegram_verifications v
  where v.invitation_id = inv.id
    and v.ticket_hash = encode(extensions.digest(registration_ticket, 'sha256'), 'hex')
    and v.verified_at is not null and v.ticket_used_at is null
    and v.ticket_expires_at > now()
  for update;
  if not found then raise exception 'Telegram verification is missing, expired, or already used'; end if;

  if exists(select 1 from public.profiles p where p.telegram_user_id = verification.telegram_user_id and p.id <> auth.uid()) then
    raise exception 'This Telegram account is already linked to another CRM account';
  end if;

  update public.profiles
  set role = inv.invited_role::public.app_role,
      admin_panel_name = inv.admin_panel_name,
      telegram_user_id = verification.telegram_user_id,
      telegram_verified_at = verification.verified_at
  where id = auth.uid() and active = true and lower(role::text) = 'employee';
  if not found then raise exception 'Invitation cannot change an existing account role'; end if;

  if inv.invited_role <> 'telemarketing' then
    insert into public.manager_employee_assignments(manager_id, employee_id, created_by)
    values (inv.invited_by, auth.uid(), inv.invited_by) on conflict (manager_id, employee_id) do nothing;
  end if;

  update public.manager_invitation_telegram_verifications set ticket_used_at = now() where id = verification.id;
  update public.manager_invitations set redeemed_by = auth.uid(), redeemed_at = now() where id = inv.id;
end;
$$;
grant execute on function public.redeem_manager_invitation(text,text) to authenticated;
