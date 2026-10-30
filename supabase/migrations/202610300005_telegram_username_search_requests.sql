-- Queue explicit Telegram username lookups for the linked human account.
create table if not exists public.telegram_inbox_search_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles(id) on delete cascade,
  query text not null check (length(btrim(query)) between 1 and 32),
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  result_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists telegram_inbox_search_requests_pending_idx
  on public.telegram_inbox_search_requests(status, created_at)
  where status = 'pending';

alter table public.telegram_inbox_search_requests enable row level security;

drop policy if exists "Authorized staff can request Telegram username lookup"
  on public.telegram_inbox_search_requests;
create policy "Signed-in users can request Telegram username lookup"
  on public.telegram_inbox_search_requests for insert to authenticated
  with check (requested_by = auth.uid());

drop policy if exists "Staff can read own Telegram username lookup requests"
  on public.telegram_inbox_search_requests;
create policy "Staff can read own Telegram username lookup requests"
  on public.telegram_inbox_search_requests for select to authenticated
  using (requested_by = auth.uid());
