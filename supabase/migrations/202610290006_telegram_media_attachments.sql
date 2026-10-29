alter table public.telegram_inbox_messages
  add column if not exists media_path text,
  add column if not exists media_name text,
  add column if not exists media_mime_type text,
  add column if not exists media_size bigint;

alter table public.telegram_inbox_outbox
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime_type text,
  add column if not exists attachment_size bigint;

insert into storage.buckets (id, name, public, file_size_limit)
values ('telegram-inbox-media', 'telegram-inbox-media', false, 20971520)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit;
