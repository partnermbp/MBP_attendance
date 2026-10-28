-- Fix automatic Telegram linking during invitation registration.
-- The auth trigger must create a temporary employee profile so the protected
-- redemption RPC can apply the invited role and the already-verified Telegram ID.
-- Redemption also safely recovers accounts created by the previous trigger:
-- an existing role is accepted only when it already equals this invite's role,
-- and an existing Telegram link must match the identity verified for this invite.

create or replace function public.handle_invited_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  invite public.manager_invitations%rowtype;
  invitation_token text;
  registration_ticket text;
begin
  invitation_token := new.raw_user_meta_data ->> 'invitation_token';
  registration_ticket := new.raw_user_meta_data ->> 'registration_ticket';

  if new.email is null
     or (
       pg_catalog.lower(new.email) !~ '^[^@]+@(mostbet[.]partners|infradim[.]com|starson[.]cloud|double[.]global)$'
       and pg_catalog.lower(new.email) <> 'partnermbp@gmail.com'
     ) then
    raise exception 'Email address is not permitted';
  end if;

  if invitation_token is null or registration_ticket is null then
    raise exception 'A valid administrator invitation and verified Telegram account are required';
  end if;

  select i.*
    into invite
  from public.manager_invitations as i
  join public.manager_invitation_telegram_verifications as v
    on v.invitation_id = i.id
  where i.token_hash = pg_catalog.encode(extensions.digest(invitation_token, 'sha256'), 'hex')
    and pg_catalog.lower(i.corporate_email) = pg_catalog.lower(new.email)
    and i.redeemed_at is null
    and i.expires_at > pg_catalog.now()
    and v.ticket_hash = pg_catalog.encode(extensions.digest(registration_ticket, 'sha256'), 'hex')
    and v.verified_at is not null
    and v.ticket_used_at is null
    and v.ticket_expires_at > pg_catalog.now()
  for update of i, v;

  if not found then
    raise exception 'A valid administrator invitation and verified Telegram account are required';
  end if;

  -- Temporary role: redeem_manager_invitation applies the final role and link.
  insert into public.profiles (id, email, role, admin_panel_name, full_name)
  values (
    new.id,
    pg_catalog.lower(new.email),
    'employee'::public.app_role,
    invite.admin_panel_name,
    coalesce(new.raw_user_meta_data ->> 'full_name', invite.admin_panel_name)
  );

  return new;
end;
$function$;

create or replace function public.redeem_manager_invitation(invitation_token text, registration_ticket text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.manager_invitations%rowtype;
  verification public.manager_invitation_telegram_verifications%rowtype;
  current_role text;
  current_email text;
  current_telegram_user_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Complete account registration or sign in first' using errcode = '42501';
  end if;

  select * into inv
  from public.manager_invitations
  where token_hash = encode(extensions.digest(invitation_token, 'sha256'), 'hex')
    and redeemed_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'Invitation is invalid, expired, or already used';
  end if;

  if inv.invited_by = auth.uid() then
    raise exception 'You cannot redeem your own invitation';
  end if;

  select lower(replace(p.role::text, '_', ' ')), lower(u.email), p.telegram_user_id
    into current_role, current_email, current_telegram_user_id
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = auth.uid() and p.active = true;

  if current_role is null then
    raise exception 'Active CRM profile not found';
  end if;

  if current_email <> lower(inv.corporate_email) then
    raise exception 'This account email does not match the invitation';
  end if;

  -- New registrations have the temporary employee role. Recovery is allowed
  -- only when the profile already has exactly the role assigned by this invite.
  if current_role <> 'employee'
     and current_role <> lower(replace(inv.invited_role, '_', ' ')) then
    raise exception 'This account is already registered. Role changes require a separate Admin approval.';
  end if;

  select * into verification
  from public.manager_invitation_telegram_verifications v
  where v.invitation_id = inv.id
    and v.ticket_hash = encode(extensions.digest(registration_ticket, 'sha256'), 'hex')
    and v.verified_at is not null
    and v.ticket_used_at is null
    and v.ticket_expires_at > now()
  for update;

  if not found then
    raise exception 'Telegram verification is missing, expired, or already used';
  end if;

  if current_telegram_user_id is not null
     and current_telegram_user_id <> verification.telegram_user_id then
    raise exception 'This account is already linked to a different Telegram account';
  end if;

  if exists (
    select 1 from public.profiles p
    where p.telegram_user_id = verification.telegram_user_id
      and p.id <> auth.uid()
  ) then
    raise exception 'This Telegram account is already linked to another CRM account';
  end if;

  update public.profiles
  set role = inv.invited_role::public.app_role,
      admin_panel_name = inv.admin_panel_name,
      telegram_user_id = verification.telegram_user_id,
      telegram_verified_at = verification.verified_at
  where id = auth.uid()
    and active = true
    and (
      lower(role::text) = 'employee'
      or lower(role::text) = lower(inv.invited_role)
    );

  if not found then
    raise exception 'Invitation cannot change an existing account role';
  end if;

  if inv.invited_role <> 'telemarketing' then
    insert into public.manager_employee_assignments(manager_id, employee_id, created_by)
    values (inv.invited_by, auth.uid(), inv.invited_by)
    on conflict (manager_id, employee_id) do nothing;
  end if;

  update public.manager_invitation_telegram_verifications
  set ticket_used_at = now()
  where id = verification.id;

  update public.manager_invitations
  set redeemed_by = auth.uid(), redeemed_at = now()
  where id = inv.id;
end;
$$;

revoke all on function public.redeem_manager_invitation(text, text) from public, anon;
grant execute on function public.redeem_manager_invitation(text, text) to authenticated;
