-- Per-user email MFA verification, anchored to each Auth user's registration timestamp.
-- All state is service-role only; clients cannot mark themselves verified or inspect challenges.
create table if not exists public.crm_email_mfa_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  verified_week bigint not null,
  verified_at timestamptz not null default now()
);

create table if not exists public.crm_login_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  ticket_hash text not null unique,
  stage text not null check (stage in ('email', 'telegram')),
  week_index bigint not null,
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 5),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists crm_login_challenges_user_created_idx
  on public.crm_login_challenges(user_id, created_at desc);
create index if not exists crm_login_challenges_expiry_idx
  on public.crm_login_challenges(expires_at);

alter table public.crm_email_mfa_status enable row level security;
alter table public.crm_login_challenges enable row level security;

revoke all on public.crm_email_mfa_status from anon, authenticated;
revoke all on public.crm_login_challenges from anon, authenticated;
grant all on public.crm_email_mfa_status to service_role;
grant all on public.crm_login_challenges to service_role;
