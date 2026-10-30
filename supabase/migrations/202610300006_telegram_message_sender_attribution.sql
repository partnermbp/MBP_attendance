-- Preserve the CRM employee who requested each outgoing Human Telegram message.
alter table public.telegram_inbox_messages
  add column if not exists sent_by_profile_id uuid references public.profiles(id) on delete set null;

create index if not exists telegram_inbox_messages_sender_profile_idx
  on public.telegram_inbox_messages(sent_by_profile_id)
  where sent_by_profile_id is not null;

notify pgrst, 'reload schema';
