-- Make Telegram ID change requests reliably visible to Admin and enforce
-- at most one pending request per employee, including concurrent submissions.

create or replace function public.get_telegram_id_change_requests()
returns table (
  id bigint,
  requester_profile_id uuid,
  requester_name text,
  requester_email text,
  old_telegram_user_id bigint,
  new_telegram_user_id bigint,
  old_telegram_username text,
  new_telegram_username text,
  comment text,
  status text,
  created_at timestamptz,
  reviewed_at timestamptz,
  admin_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    r.requester_profile_id,
    r.requester_name,
    r.requester_email,
    r.old_telegram_user_id,
    r.new_telegram_user_id,
    r.old_telegram_username,
    r.new_telegram_username,
    r.comment,
    r.status,
    r.created_at,
    r.reviewed_at,
    r.admin_note
  from public.telegram_id_change_requests r
  where public.is_active_admin()
  order by r.created_at desc
  limit 500;
$$;

revoke all on function public.get_telegram_id_change_requests() from public, anon;
grant execute on function public.get_telegram_id_change_requests() to authenticated;

-- Serialize changes by requester profile and prevent a second pending row.
create or replace function public.enforce_one_pending_telegram_id_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' and new.requester_profile_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.requester_profile_id::text, 0)
    );

    if exists (
      select 1
      from public.telegram_id_change_requests r
      where r.requester_profile_id = new.requester_profile_id
        and r.status = 'pending'
        and r.id is distinct from new.id
    ) then
      raise exception 'You already have a Telegram ID change request awaiting Admin review.'
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists telegram_id_change_requests_one_pending
  on public.telegram_id_change_requests;
create trigger telegram_id_change_requests_one_pending
before insert or update of requester_profile_id, status
on public.telegram_id_change_requests
for each row
execute function public.enforce_one_pending_telegram_id_request();

-- Add a declarative uniqueness guard when historical rows permit it.
-- The trigger above still enforces the rule if older duplicate pending rows exist.
do $$
begin
  if not exists (
    select 1
    from public.telegram_id_change_requests
    where status = 'pending'
    group by requester_profile_id
    having count(*) > 1
  ) then
    create unique index if not exists telegram_id_change_requests_one_pending_per_user_idx
      on public.telegram_id_change_requests(requester_profile_id)
      where status = 'pending' and requester_profile_id is not null;
  end if;
end;
$$;
