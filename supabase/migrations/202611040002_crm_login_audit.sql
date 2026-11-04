-- Record every completed CRM sign-in against the authenticated profile ID.
-- The caller cannot choose another user's ID; auth.uid() is the only identity source.
create table if not exists public.crm_login_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  login_method text not null check (login_method in ('password_2fa', 'telegram_otp', 'invitation_registration')),
  logged_at timestamptz not null default now()
);

create index if not exists crm_login_events_profile_logged_at_idx
  on public.crm_login_events(profile_id, logged_at desc);

alter table public.crm_login_events enable row level security;
revoke all on public.crm_login_events from anon, authenticated;
grant select on public.crm_login_events to authenticated;

drop policy if exists crm_login_events_admin_read on public.crm_login_events;
create policy crm_login_events_admin_read
  on public.crm_login_events for select to authenticated
  using (public.is_active_admin());

create or replace function public.record_crm_login(p_login_method text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := auth.uid();
begin
  if v_profile_id is null then
    raise exception 'Sign in is required to record a CRM login' using errcode = '42501';
  end if;

  if p_login_method not in ('password_2fa', 'telegram_otp', 'invitation_registration') then
    raise exception 'Invalid CRM login method';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = v_profile_id and p.active = true
  ) then
    raise exception 'An active CRM profile is required' using errcode = '42501';
  end if;

  insert into public.crm_login_events(profile_id, login_method)
  values (v_profile_id, p_login_method);
end;
$$;

revoke all on function public.record_crm_login(text) from public, anon;
grant execute on function public.record_crm_login(text) to authenticated;
