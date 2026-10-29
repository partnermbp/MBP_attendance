-- Temporary human-account Telegram inbox storage for the scheduled GitHub Actions worker.
-- Apply this migration in the Supabase SQL Editor before enabling the workflow.
-- The worker uses the Supabase service-role key, which bypasses RLS. Never put that key
-- in Vite variables or browser code.

create table if not exists public.telegram_inbox_chats (
  chat_id bigint primary key,
  title text not null,
  username text,
  last_message_id bigint not null default 0,
  last_message_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_inbox_messages (
  chat_id bigint not null references public.telegram_inbox_chats(chat_id) on delete cascade,
  message_id bigint not null,
  sender_id bigint,
  outgoing boolean not null default false,
  message_text text not null,
  sent_at timestamptz not null,
  reply_to_message_id bigint,
  created_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);

create index if not exists telegram_inbox_messages_chat_sent_idx
  on public.telegram_inbox_messages(chat_id, sent_at desc);

create table if not exists public.telegram_inbox_chat_assignments (
  chat_id bigint not null references public.telegram_inbox_chats(chat_id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (chat_id, profile_id)
);

create index if not exists telegram_inbox_chat_assignments_profile_idx
  on public.telegram_inbox_chat_assignments(profile_id, chat_id);

create table if not exists public.telegram_inbox_outbox (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null references public.telegram_inbox_chats(chat_id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  message_text text not null check (length(btrim(message_text)) between 1 and 12000),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed')),
  telegram_message_id bigint,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists telegram_inbox_outbox_pending_idx
  on public.telegram_inbox_outbox(status, created_at)
  where status = 'pending';

alter table public.telegram_inbox_chats enable row level security;
alter table public.telegram_inbox_messages enable row level security;
alter table public.telegram_inbox_chat_assignments enable row level security;
alter table public.telegram_inbox_outbox enable row level security;

-- Admins can inspect every chat. Employees can access explicitly assigned chats.
-- Managers can access chats assigned to their direct reports through the existing
-- manager_employee_assignments hierarchy. This migration does not alter that hierarchy.
drop policy if exists "Telegram inbox chats visible to authorized staff" on public.telegram_inbox_chats;
create policy "Telegram inbox chats visible to authorized staff"
  on public.telegram_inbox_chats for select to authenticated
  using (
    public.is_active_admin()
    or exists (
      select 1 from public.telegram_inbox_chat_assignments a
      where a.chat_id = telegram_inbox_chats.chat_id and a.profile_id = auth.uid()
    )
    or exists (
      select 1
      from public.telegram_inbox_chat_assignments a
      join public.manager_employee_assignments m on m.employee_id = a.profile_id
      where a.chat_id = telegram_inbox_chats.chat_id and m.manager_id = auth.uid()
    )
  );

drop policy if exists "Telegram inbox messages visible to authorized staff" on public.telegram_inbox_messages;
create policy "Telegram inbox messages visible to authorized staff"
  on public.telegram_inbox_messages for select to authenticated
  using (
    public.is_active_admin()
    or exists (
      select 1 from public.telegram_inbox_chat_assignments a
      where a.chat_id = telegram_inbox_messages.chat_id and a.profile_id = auth.uid()
    )
    or exists (
      select 1
      from public.telegram_inbox_chat_assignments a
      join public.manager_employee_assignments m on m.employee_id = a.profile_id
      where a.chat_id = telegram_inbox_messages.chat_id and m.manager_id = auth.uid()
    )
  );

drop policy if exists "Staff can read authorized inbox assignments" on public.telegram_inbox_chat_assignments;
create policy "Staff can read authorized inbox assignments"
  on public.telegram_inbox_chat_assignments for select to authenticated
  using (
    public.is_active_admin()
    or profile_id = auth.uid()
    or exists (
      select 1 from public.manager_employee_assignments m
      where m.manager_id = auth.uid() and m.employee_id = telegram_inbox_chat_assignments.profile_id
    )
  );

drop policy if exists "Admins manage inbox assignments" on public.telegram_inbox_chat_assignments;
create policy "Admins manage inbox assignments"
  on public.telegram_inbox_chat_assignments for all to authenticated
  using (public.is_active_admin())
  with check (public.is_active_admin());

-- The client can enqueue replies only for chats it is allowed to access.
-- The scheduled worker reads and updates these rows using service-role credentials.
drop policy if exists "Staff enqueue authorized inbox replies" on public.telegram_inbox_outbox;
create policy "Staff enqueue authorized inbox replies"
  on public.telegram_inbox_outbox for insert to authenticated
  with check (
    requested_by = auth.uid()
    and (
      public.is_active_admin()
      or exists (
        select 1 from public.telegram_inbox_chat_assignments a
        where a.chat_id = telegram_inbox_outbox.chat_id and a.profile_id = auth.uid()
      )
      or exists (
        select 1
        from public.telegram_inbox_chat_assignments a
        join public.manager_employee_assignments m on m.employee_id = a.profile_id
        where a.chat_id = telegram_inbox_outbox.chat_id and m.manager_id = auth.uid()
      )
    )
  );

drop policy if exists "Staff read own authorized outbox" on public.telegram_inbox_outbox;
create policy "Staff read own authorized outbox"
  on public.telegram_inbox_outbox for select to authenticated
  using (
    public.is_active_admin()
    or requested_by = auth.uid()
    or exists (
      select 1 from public.manager_employee_assignments m
      join public.telegram_inbox_chat_assignments a on a.profile_id = m.employee_id
      where m.manager_id = auth.uid() and a.chat_id = telegram_inbox_outbox.chat_id
    )
  );

-- Deliberately no client-side UPDATE or DELETE policy on messages/chats/outbox.
-- The service role is the only actor that updates sync state or delivery status.
