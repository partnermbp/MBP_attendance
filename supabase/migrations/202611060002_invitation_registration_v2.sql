-- Invitation registration v2: require verified Telegram AND corporate email
-- before creating an Auth user. Account/profile/role/assignment activation occurs
-- inside the auth.users trigger transaction, so incomplete registrations get no access.

create table if not exists public.manager_invitation_email_verifications (
  id bigint generated always as identity primary key,
  invitation_id bigint not null unique references public.manager_invitations(id) on delete cascade,
  email text not null,
  otp_hash text,
  otp_expires_at timestamptz,
  otp_sent_at timestamptz,
  attempts integer not null default 0,
  verified_at timestamptz,
  email_ticket_hash text unique,
  email_ticket_expires_at timestamptz,
  ticket_used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.manager_invitation_email_verifications enable row level security;
revoke all on public.manager_invitation_email_verifications from anon, authenticated, public;
create index if not exists manager_invitation_email_verifications_expiry_idx
  on public.manager_invitation_email_verifications(email_ticket_expires_at);

create or replace function public.handle_invited_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  invite public.manager_invitations%rowtype;
  telegram_verification public.manager_invitation_telegram_verifications%rowtype;
  email_verification public.manager_invitation_email_verifications%rowtype;
  invitation_token text;
  registration_ticket text;
  email_registration_ticket text;
  normalized_email text;
begin
  normalized_email := pg_catalog.lower(pg_catalog.trim(new.email));
  invitation_token := new.raw_user_meta_data ->> 'invitation_token';
  registration_ticket := new.raw_user_meta_data ->> 'registration_ticket';
  email_registration_ticket := new.raw_user_meta_data ->> 'email_registration_ticket';

  if new.email is null or new.email_confirmed_at is null then
    raise exception 'Corporate email verification is required before account creation';
  end if;

  if (
    normalized_email !~ '^[^@]+@(mostbet[.]partners|infradim[.]com|starson[.]cloud|double[.]global)$'
    and normalized_email not in ('partnermbp@gmail.com','vladimirlenin458@gmail.com','gameon892@gmail.com')
  ) then
    raise exception 'Email address is not permitted';
  end if;

  if invitation_token is null or registration_ticket is null or email_registration_ticket is null then
    raise exception 'A valid invitation and both verified identity factors are required';
  end if;

  select i.* into invite
  from public.manager_invitations i
  where i.token_hash = pg_catalog.encode(extensions.digest(invitation_token, 'sha256'), 'hex')
    and pg_catalog.lower(i.corporate_email) = normalized_email
    and i.redeemed_at is null
    and i.expires_at > pg_catalog.now()
  for update;

  if not found then
    raise exception 'Invitation is invalid, expired, or already used';
  end if;

  select v.* into telegram_verification
  from public.manager_invitation_telegram_verifications v
  where v.invitation_id = invite.id
    and v.ticket_hash = pg_catalog.encode(extensions.digest(registration_ticket, 'sha256'), 'hex')
    and v.verified_at is not null
    and v.ticket_used_at is null
    and v.ticket_expires_at > pg_catalog.now()
    and v.telegram_user_id is not null
  for update;

  if not found then
    raise exception 'Telegram verification is missing, expired, or already used';
  end if;

  select e.* into email_verification
  from public.manager_invitation_email_verifications e
  where e.invitation_id = invite.id
    and pg_catalog.lower(e.email) = normalized_email
    and e.email_ticket_hash = pg_catalog.encode(extensions.digest(email_registration_ticket, 'sha256'), 'hex')
    and e.verified_at is not null
    and e.ticket_used_at is null
    and e.email_ticket_expires_at > pg_catalog.now()
  for update;

  if not found then
    raise exception 'Corporate email verification is missing, expired, or already used';
  end if;

  if exists (
    select 1 from public.profiles p
    where p.telegram_user_id = telegram_verification.telegram_user_id
  ) then
    raise exception 'This Telegram account is already linked to another CRM account';
  end if;

  insert into public.profiles (
    id, email, role, admin_panel_name, full_name,
    telegram_user_id, telegram_verified_at
  ) values (
    new.id,
    normalized_email,
    invite.invited_role::public.app_role,
    invite.admin_panel_name,
    coalesce(new.raw_user_meta_data ->> 'full_name', invite.admin_panel_name),
    telegram_verification.telegram_user_id,
    telegram_verification.verified_at
  );

  if invite.invited_role <> 'telemarketing' then
    insert into public.manager_employee_assignments(manager_id, employee_id, created_by)
    values (invite.invited_by, new.id, invite.invited_by)
    on conflict (manager_id, employee_id) do nothing;
  end if;

  update public.manager_invitation_telegram_verifications
  set ticket_used_at = pg_catalog.now()
  where id = telegram_verification.id;

  update public.manager_invitation_email_verifications
  set ticket_used_at = pg_catalog.now()
  where id = email_verification.id;

  update public.manager_invitations
  set redeemed_by = new.id, redeemed_at = pg_catalog.now()
  where id = invite.id;

  return new;
end;
$function$;

-- Remove the old redeem RPCs from the public registration path. The trigger now
-- redeems atomically during account creation, after both identity factors pass.
revoke all on function public.redeem_manager_invitation(text, text) from public, anon, authenticated;
