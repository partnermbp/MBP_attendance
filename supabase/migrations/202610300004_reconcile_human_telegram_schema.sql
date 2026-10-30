-- Repair / reconcile Human Telegram schema on the connected Supabase project.
alter table public.telegram_inbox_chats
  add column if not exists chat_type text not null default 'private';
alter table public.telegram_inbox_chats
  add column if not exists is_contact_only boolean not null default false;
alter table public.telegram_inbox_chats
  add column if not exists phone_number text;

create table if not exists public.telegram_inbox_chat_members (
  chat_id bigint not null references public.telegram_inbox_chats(chat_id) on delete cascade,
  telegram_user_id bigint not null,
  username text,
  display_name text,
  is_bot boolean not null default false,
  is_self boolean not null default false,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  primary key (chat_id, telegram_user_id)
);

create index if not exists telegram_inbox_chat_members_active_idx
  on public.telegram_inbox_chat_members(chat_id, is_active, display_name);
create index if not exists telegram_inbox_chats_contact_only_idx
  on public.telegram_inbox_chats(is_contact_only, title);

alter table public.telegram_inbox_chat_members enable row level security;
drop policy if exists "Authorized Human Telegram users read group participants" on public.telegram_inbox_chat_members;
create policy "Authorized Human Telegram users read group participants"
  on public.telegram_inbox_chat_members for select to authenticated
  using (
    public.can_access_human_telegram()
    and (
      public.is_active_admin()
      or exists (
        select 1 from public.telegram_inbox_chat_assignments a
        where a.chat_id = telegram_inbox_chat_members.chat_id and a.profile_id = auth.uid()
      )
      or exists (
        select 1 from public.telegram_inbox_chat_assignments a
        join public.manager_employee_assignments m on m.employee_id = a.profile_id
        where a.chat_id = telegram_inbox_chat_members.chat_id and m.manager_id = auth.uid()
      )
    )
  );

notify pgrst, 'reload schema';
