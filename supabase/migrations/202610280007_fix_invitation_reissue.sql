-- Correct invitation allowlist and reliably supersede every unfinished invitation
-- for the same email or Admin Panel Name, including invitations that have expired.

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

  if inviter_role is null then
    raise exception 'An active CRM profile is required' using errcode = '42501';
  end if;
  if normalized_name is null or length(normalized_name) < 2 or length(normalized_name) > 120 then
    raise exception 'Enter a valid Admin Panel Name';
  end if;
  if normalized_email is null or length(normalized_email) > 254 or
     normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then
    raise exception 'Enter a valid corporate email';
  end if;

  -- Keep SQL validation aligned with the frontend approved-email list.
  if split_part(normalized_email, '@', 2) not in ('mostbet.partners','infradim.com','starson.cloud','double.global')
     and normalized_email <> 'partnermbp@gmail.com' then
    raise exception 'This corporate email domain is not approved for the CRM.';
  end if;

  -- Never create a new invitation for an identity that already has a registered account.
  if exists (select 1 from auth.users u where lower(u.email) = normalized_email)
     or exists (
       select 1 from public.profiles p
       where lower(coalesce(p.admin_panel_name, '')) = lower(normalized_name)
          or lower(coalesce(p.full_name, '')) = lower(normalized_name)
     ) then
    raise exception 'A registered CRM account already exists with this email or Admin Panel Name. No invitation was created. Ask Admin to review the existing account.';
  end if;

  -- Admin may invite any role. Other managers can invite only roles below them.
  if normalized_role = 'telemarketing' then
    if inviter_role <> 'admin' then
      raise exception 'Only Admin can invite Telemarketing staff' using errcode = '42501';
    end if;
  elsif normalized_role in ('junior','middle','senior','team leader') then
    if inviter_role <> 'admin' and inviter_role not in ('team leader','senior','middle') then
      raise exception 'Only Admin, Team Leader, Senior, or Middle can invite into the management hierarchy' using errcode = '42501';
    end if;
    if inviter_role = 'middle' and normalized_role <> 'junior' then
      raise exception 'Middle can invite Junior only' using errcode = '42501';
    end if;
    if inviter_role = 'senior' and normalized_role not in ('middle','junior') then
      raise exception 'Senior can invite Middle or Junior only' using errcode = '42501';
    end if;
    if inviter_role = 'team leader' and normalized_role not in ('senior','middle','junior') then
      raise exception 'Team Leader can invite Senior, Middle, or Junior only' using errcode = '42501';
    end if;
  else
    raise exception 'Unsupported invitation role';
  end if;

  -- Expire every unredeemed matching invitation, not just those whose expiry
  -- timestamp is still in the future. This invalidates old links before reissue.
  update public.manager_invitations
  set expires_at = least(expires_at, now())
  where redeemed_at is null
    and (
      lower(coalesce(corporate_email, '')) = normalized_email
      or lower(coalesce(admin_panel_name, '')) = lower(normalized_name)
    );

  insert into public.manager_invitations(
    token_hash, invited_by, invited_role, admin_panel_name, corporate_email, expires_at
  )
  values (
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    auth.uid(),
    case normalized_role when 'team leader' then 'team_leader' else normalized_role end,
    normalized_name,
    normalized_email,
    now() + interval '24 hours'
  );

  return raw_token;
end;
$$;

revoke all on function public.create_manager_invitation(text,text,text) from public, anon;
grant execute on function public.create_manager_invitation(text,text,text) to authenticated;
