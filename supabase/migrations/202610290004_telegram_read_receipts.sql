-- Add Telegram's per-dialog outgoing read watermark for tick indicators.
alter table public.telegram_inbox_chats
  add column if not exists read_outbox_max_id bigint not null default 0;
