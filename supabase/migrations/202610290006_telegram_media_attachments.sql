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

-- The bucket is private; only authenticated CRM users may access stored media.
drop policy if exists "Authenticated staff can read Telegram inbox media" on storage.objects;
create policy "Authenticated staff can read Telegram inbox media"
  on storage.objects for select to authenticated
  using (bucket_id = 'telegram-inbox-media');

drop policy if exists "Authenticated staff can upload Telegram inbox media" on storage.objects;
create policy "Authenticated staff can upload Telegram inbox media"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'telegram-inbox-media');

drop policy if exists "Authenticated staff can update Telegram inbox media" on storage.objects;
create policy "Authenticated staff can update Telegram inbox media"
  on storage.objects for update to authenticated
  using (bucket_id = 'telegram-inbox-media')
  with check (bucket_id = 'telegram-inbox-media');
