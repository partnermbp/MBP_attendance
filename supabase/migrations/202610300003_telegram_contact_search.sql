alter table public.telegram_inbox_chats
  add column if not exists is_contact_only boolean not null default false;

create index if not exists telegram_inbox_chats_contact_only_idx
  on public.telegram_inbox_chats (is_contact_only, title);
