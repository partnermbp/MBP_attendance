-- Keep role changes and invitation-created assignments consistent with the reporting tree.
-- Team Leader (4) > Senior (3) > Middle (2) > Junior (1). Telemarketing is separate.

create or replace function public.crm_role_rank(p_role text)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select case pg_catalog.lower(pg_catalog.replace(coalesce(p_role, ''), ' ', '_'))
    when 'team_leader' then 4
    when 'senior' then 3
    when 'middle' then 2
    when 'junior' then 1
    else 0
  end;
$function$;

revoke all on function public.crm_role_rank(text) from public, anon, authenticated;

-- Remove legacy links that were made invalid by role changes before this guard existed.
delete from public.manager_employee_assignments a
using public.profiles manager, public.profiles employee
where manager.id = a.manager_id
  and employee.id = a.employee_id
  and (public.crm_role_rank(manager.role::text) = 0
       or public.crm_role_rank(employee.role::text) = 0
       or public.crm_role_rank(manager.role::text) <= public.crm_role_rank(employee.role::text));

create or replace function public.enforce_profile_role_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  next_rank integer;
begin
  if new.role::text is not distinct from old.role::text then
    return new;
  end if;

  next_rank := public.crm_role_rank(new.role::text);

  if exists (
    select 1
    from public.manager_employee_assignments a
    join public.profiles parent on parent.id = a.manager_id
    where a.employee_id = new.id
      and lower(parent.role::text) <> 'admin'
      and (next_rank = 0 or public.crm_role_rank(parent.role::text) <= next_rank)
  ) then
    raise exception 'Role change would violate reporting hierarchy: this employee must remain below the assigned manager';
  end if;

  if exists (
    select 1
    from public.manager_employee_assignments a
    join public.profiles child on child.id = a.employee_id
    where a.manager_id = new.id
      and (next_rank = 0 or next_rank <= public.crm_role_rank(child.role::text))
  ) then
    raise exception 'Role change would violate reporting hierarchy: existing reports must remain below this manager';
  end if;

  return new;
end;
$function$;

drop trigger if exists enforce_profile_role_hierarchy on public.profiles;
create trigger enforce_profile_role_hierarchy
before update of role on public.profiles
for each row execute function public.enforce_profile_role_hierarchy();
revoke all on function public.enforce_profile_role_hierarchy() from public, anon, authenticated;

-- Invited staff are automatically linked to their inviter only when the inviter
-- is a manager in the reporting hierarchy. Admin invitations create top-level accounts.
-- The Auth users BEFORE INSERT trigger can run before email_confirmed_at is populated,
-- even when the trusted admin createUser call uses email_confirm: true.
-- The invitation email OTP ticket is independently validated below and is the
-- authoritative proof of email verification for this registration flow.
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
  normalized_email := pg_catalog.lower(pg_catalog.btrim(new.email::text));
  invitation_token := new.raw_user_meta_data ->> 'invitation_token';
  registration_ticket := new.raw_user_meta_data ->> 'registration_ticket';
  email_registration_ticket := new.raw_user_meta_data ->> 'email_registration_ticket';

  if new.email is null then
    raise exception 'A verified invitation email address is required';
  end if;
  if (normalized_email !~ '^[^@]+@(mostbet[.]partners|infradim[.]com|starson[.]cloud|double[.]global)$'
      and normalized_email not in ('partnermbp@gmail.com','vladimirlenin458@gmail.com','gameon892@gmail.com')) then
    raise exception 'Email address is not permitted';
  end if;
  if invitation_token is null or registration_ticket is null or email_registration_ticket is null then
    raise exception 'A valid invitation and both verified identity factors are required';
  end if;

  select i.* into invite from public.manager_invitations i
  where i.token_hash = pg_catalog.encode(extensions.digest(invitation_token, 'sha256'), 'hex')
    and pg_catalog.lower(i.corporate_email) = normalized_email
    and i.redeemed_at is null and i.expires_at > pg_catalog.now()
  for update;
  if not found then raise exception 'Invitation is invalid, expired, or already used'; end if;

  select v.* into telegram_verification from public.manager_invitation_telegram_verifications v
  where v.invitation_id = invite.id
    and v.ticket_hash = pg_catalog.encode(extensions.digest(registration_ticket, 'sha256'), 'hex')
    and v.verified_at is not null and v.ticket_used_at is null
    and v.ticket_expires_at > pg_catalog.now() and v.telegram_user_id is not null
  for update;
  if not found then raise exception 'Telegram verification is missing, expired, or already used'; end if;

  select e.* into email_verification from public.manager_invitation_email_verifications e
  where e.invitation_id = invite.id and pg_catalog.lower(e.email) = normalized_email
    and e.email_ticket_hash = pg_catalog.encode(extensions.digest(email_registration_ticket, 'sha256'), 'hex')
    and e.verified_at is not null and e.ticket_used_at is null
    and e.email_ticket_expires_at > pg_catalog.now()
  for update;
  if not found then raise exception 'Corporate email verification is missing, expired, or already used'; end if;

  if exists (select 1 from public.profiles p where p.telegram_user_id = telegram_verification.telegram_user_id) then
    raise exception 'This Telegram account is already linked to another CRM account';
  end if;

  insert into public.profiles (id,email,role,admin_panel_name,full_name,telegram_user_id,telegram_verified_at)
  values (new.id,normalized_email,invite.invited_role::public.app_role,invite.admin_panel_name,
    coalesce(new.raw_user_meta_data ->> 'full_name',invite.admin_panel_name),
    telegram_verification.telegram_user_id,telegram_verification.verified_at);

  if invite.invited_role <> 'telemarketing'
     and not exists (
       select 1 from public.profiles inviter
       where inviter.id = invite.invited_by and lower(inviter.role::text) = 'admin'
     ) then
    insert into public.manager_employee_assignments(manager_id,employee_id,created_by)
    values (invite.invited_by,new.id,invite.invited_by) on conflict (manager_id,employee_id) do nothing;
  end if;

  update public.manager_invitation_telegram_verifications set ticket_used_at=pg_catalog.now() where id=telegram_verification.id;
  update public.manager_invitation_email_verifications set ticket_used_at=pg_catalog.now() where id=email_verification.id;
  update public.manager_invitations set redeemed_by=new.id,redeemed_at=pg_catalog.now() where id=invite.id;

  insert into public.invitation_registration_access_grants(user_id,expires_at)
  values(new.id,pg_catalog.now()+interval '10 minutes')
  on conflict(user_id) do update set expires_at=excluded.expires_at,consumed_at=null;
  return new;
end;
$function$;

-- The older redemption RPC is retained for compatibility; admin-created invitations
-- must remain top-level and must not create an admin-to-employee reporting edge.
create or replace function public.redeem_manager_invitation(invitation_token text, registration_ticket text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
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

  select * into inv from public.manager_invitations
  where token_hash = encode(extensions.digest(invitation_token, 'sha256'), 'hex')
    and redeemed_at is null and expires_at > now()
  for update;
  if not found then raise exception 'Invitation is invalid, expired, or already used'; end if;
  if inv.invited_by = auth.uid() then raise exception 'You cannot redeem your own invitation'; end if;

  select lower(replace(p.role::text, '_', ' ')), lower(u.email), p.telegram_user_id
    into current_role, current_email, current_telegram_user_id
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = auth.uid() and p.active = true;
  if current_role is null then raise exception 'Active CRM profile not found'; end if;
  if current_email <> lower(inv.corporate_email) then raise exception 'This account email does not match the invitation'; end if;
  if current_role <> 'employee' and current_role <> lower(replace(inv.invited_role, '_', ' ')) then
    raise exception 'This account is already registered. Role changes require a separate Admin approval.';
  end if;

  select * into verification from public.manager_invitation_telegram_verifications v
  where v.invitation_id = inv.id
    and v.ticket_hash = encode(extensions.digest(registration_ticket, 'sha256'), 'hex')
    and v.verified_at is not null and v.ticket_used_at is null and v.ticket_expires_at > now()
  for update;
  if not found then raise exception 'Telegram verification is missing, expired, or already used'; end if;
  if current_telegram_user_id is not null and current_telegram_user_id <> verification.telegram_user_id then
    raise exception 'This account is already linked to a different Telegram account';
  end if;
  if exists (select 1 from public.profiles p where p.telegram_user_id = verification.telegram_user_id and p.id <> auth.uid()) then
    raise exception 'This Telegram account is already linked to another CRM account';
  end if;

  update public.profiles
  set role = inv.invited_role::public.app_role,
      admin_panel_name = inv.admin_panel_name,
      telegram_user_id = verification.telegram_user_id,
      telegram_verified_at = verification.verified_at
  where id = auth.uid() and active = true
    and (lower(role::text) = 'employee' or lower(role::text) = lower(inv.invited_role));
  if not found then raise exception 'Invitation cannot change an existing account role'; end if;

  if inv.invited_role <> 'telemarketing'
     and exists (select 1 from public.profiles inviter where inviter.id = inv.invited_by and lower(inviter.role::text) <> 'admin') then
    insert into public.manager_employee_assignments(manager_id, employee_id, created_by)
    values (inv.invited_by, auth.uid(), inv.invited_by)
    on conflict (manager_id, employee_id) do nothing;
  end if;

  update public.manager_invitation_telegram_verifications set ticket_used_at = now() where id = verification.id;
  update public.manager_invitations set redeemed_by = auth.uid(), redeemed_at = now() where id = inv.id;
end;
$function$;
