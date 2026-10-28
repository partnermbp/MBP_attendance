-- Harden invitation replacement, 24-hour expiry, and admin-only suspicious activity auditing.

create table if not exists public.suspicious_activities (
  id bigint generated always as identity primary key,
  event_type text not null,
  inviter_id uuid references public.profiles(id) on delete set null,
  inviter_name text,
  invitee_admin_panel_name text,
  invitee_email text,
  telegram_user_id bigint,
  telegram_username text,
  details text not null default '',
  created_at timestamptz not null default now()
);

alter table public.suspicious_activities enable row level security;
revoke all on public.suspicious_activities from anon, authenticated;
grant select on public.suspicious_activities to authenticated;
drop policy if exists suspicious_activities_admin_read on public.suspicious_activities;
create policy suspicious_activities_admin_read
  on public.suspicious_activities for select to authenticated
  using (public.is_active_admin());

create index if not exists suspicious_activities_created_at_idx
  on public.suspicious_activities(created_at desc);
create index if not exists suspicious_activities_telegram_user_id_idx
  on public.suspicious_activities(telegram_user_id);

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
     normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid corporate email';
  end if;
  if split_part(normalized_email, '@', 2) not in ('infradim.com','starson.cloud','double.global')
     and normalized_email <> 'partnermbp@gmail.com' then
    raise exception 'This corporate email domain is not approved for the CRM.';
  end if;

  -- Existing registered identities are never replaced with an invitation.
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

  -- An unfinished invitation for this email or name is superseded by the new one.
  -- Marking it expired invalidates the old token and its pending verification.
  update public.manager_invitations
  set expires_at = now()
  where redeemed_at is null
    and expires_at > now()
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
