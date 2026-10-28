-- Replace the legacy auth.users trigger validator with the current invitation
-- model. The old function looked in public.invitations (legacy table/columns),
-- so valid manager_invitations were rejected during Supabase Auth signup.
--
-- Keep the auth.users trigger in place: it creates the initial CRM profile.
-- Signup is accepted only when both the hashed manager invitation and the
-- verified, unused Telegram registration ticket match this exact email.
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

  insert into public.profiles (id, email, role, admin_panel_name, full_name)
  values (
    new.id,
    pg_catalog.lower(new.email),
    invite.invited_role::public.app_role,
    invite.admin_panel_name,
    coalesce(new.raw_user_meta_data ->> 'full_name', invite.admin_panel_name)
  );

  return new;
end;
$function$;
