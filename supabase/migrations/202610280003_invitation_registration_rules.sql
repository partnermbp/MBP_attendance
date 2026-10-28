-- Restrict invitation creation to the requested management chain.
-- Telemarketing is a separate role and may only be invited by an active Admin.
create or replace function public.create_manager_invitation(invited_role text default 'junior')
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  raw_token text := encode(extensions.gen_random_bytes(32), 'hex');
  normalized_role text := lower(trim(replace(invited_role, '_', ' ')));
  inviter_role text;
begin
  select lower(replace(role::text, '_', ' ')) into inviter_role
    from public.profiles where id = auth.uid() and active = true;

  if inviter_role is null then
    raise exception 'An active CRM profile is required' using errcode = '42501';
  end if;

  if normalized_role = 'telemarketing' then
    if not public.is_active_admin() then
      raise exception 'Only Admin can invite Telemarketing staff' using errcode = '42501';
    end if;
  elsif normalized_role in ('junior', 'middle', 'senior', 'team leader') then
    if inviter_role not in ('team leader', 'senior', 'middle') then
      raise exception 'Only Team Leader, Senior, or Middle can invite into the management hierarchy' using errcode = '42501';
    end if;

    if (inviter_role = 'middle' and normalized_role <> 'junior')
       or (inviter_role = 'senior' and normalized_role not in ('middle', 'junior'))
       or (inviter_role = 'team leader' and normalized_role not in ('senior', 'middle', 'junior')) then
      raise exception 'You cannot invite someone into a role equal to or above your own' using errcode = '42501';
    end if;
  else
    raise exception 'Unsupported invitation role';
  end if;

  insert into public.manager_invitations(token_hash, invited_by, invited_role)
  values (
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    auth.uid(),
    case normalized_role when 'team leader' then 'team_leader' else normalized_role end
  );
  return raw_token;
end;
$$;

grant execute on function public.create_manager_invitation(text) to authenticated;

-- A registration identity may only be linked to one CRM profile.
-- Telegram identity is populated by the trusted Telegram-auth function after OTP validation.
alter table public.profiles add column if not exists telegram_user_id bigint;
create unique index if not exists profiles_telegram_user_id_unique
  on public.profiles(telegram_user_id)
  where telegram_user_id is not null;

-- Do not allow an invitation to overwrite the role or manager of an existing account.
create or replace function public.redeem_manager_invitation(invitation_token text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  inv public.manager_invitations%rowtype;
  current_role text;
begin
  if auth.uid() is null then
    raise exception 'Register or sign in before redeeming an invitation' using errcode = '42501';
  end if;

  select * into inv
  from public.manager_invitations
  where token_hash = encode(extensions.digest(invitation_token, 'sha256'), 'hex')
    and redeemed_at is null and expires_at > now()
  for update;

  if not found then
    raise exception 'Invitation is invalid, expired, or already used';
  end if;
  if inv.invited_by = auth.uid() then raise exception 'You cannot redeem your own invitation'; end if;

  select lower(replace(role::text, '_', ' ')) into current_role
  from public.profiles where id = auth.uid() and active = true;

  if current_role is null then raise exception 'Active CRM profile not found'; end if;
  if current_role = 'admin' then raise exception 'Admin accounts cannot redeem employee invitations'; end if;
  if current_role not in ('employee') then
    raise exception 'This account is already registered. Role changes must be requested through your manager and approved by Admin.';
  end if;

  update public.profiles
    set role = inv.invited_role::public.app_role
    where id = auth.uid() and active = true and lower(role::text) = 'employee';
  if not found then raise exception 'Invitation cannot change an existing account role'; end if;

  if inv.invited_role <> 'telemarketing' then
    insert into public.manager_employee_assignments(manager_id, employee_id, created_by)
    values (inv.invited_by, auth.uid(), inv.invited_by)
    on conflict (manager_id, employee_id) do nothing;
  end if;

  update public.manager_invitations set redeemed_by = auth.uid(), redeemed_at = now()
  where id = inv.id;
end;
$$;

grant execute on function public.redeem_manager_invitation(text) to authenticated;
