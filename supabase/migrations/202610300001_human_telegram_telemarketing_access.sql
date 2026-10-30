-- Admin-controlled access for the private human Telegram inbox.
create table if not exists public.telegram_human_access (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now()
);

alter table public.telegram_human_access enable row level security;

drop policy if exists "Admins manage Human Telegram access" on public.telegram_human_access;
create policy "Admins manage Human Telegram access"
  on public.telegram_human_access for all to authenticated
  using (public.is_active_admin())
  with check (
    public.is_active_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = telegram_human_access.profile_id
        and p.active = true
        and lower(replace(p.role::text, '_', ' ')) = 'telemarketing'
    )
  );

drop policy if exists "Telemarketing managers read own Human Telegram access" on public.telegram_human_access;
create policy "Telemarketing managers read own Human Telegram access"
  on public.telegram_human_access for select to authenticated
  using (
    profile_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.active = true
        and lower(replace(p.role::text, '_', ' ')) = 'telemarketing'
    )
  );

create or replace function public.can_access_human_telegram()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_admin()
    or exists (
      select 1
      from public.profiles p
      join public.telegram_human_access a on a.profile_id = p.id
      where p.id = auth.uid()
        and p.active = true
        and lower(replace(p.role::text, '_', ' ')) = 'telemarketing'
    );
$$;

revoke all on function public.can_access_human_telegram() from public;
grant execute on function public.can_access_human_telegram() to authenticated;

-- Revoke stored permission immediately if an account is disabled or its role changes.
create or replace function public.revoke_ineligible_human_telegram_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.active is distinct from true
     or lower(replace(new.role::text, '_', ' ')) <> 'telemarketing' then
    delete from public.telegram_human_access where profile_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists revoke_ineligible_human_telegram_access on public.profiles;
create trigger revoke_ineligible_human_telegram_access
after update of role, active on public.profiles
for each row execute function public.revoke_ineligible_human_telegram_access();

-- Gate every client-facing inbox table, including reply queue writes.
drop policy if exists "Telegram inbox chats visible to authorized staff" on public.telegram_inbox_chats;
create policy "Telegram inbox chats visible to authorized staff"
  on public.telegram_inbox_chats for select to authenticated
  using (
    public.can_access_human_telegram()
    and (
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
    )
  );

drop policy if exists "Telegram inbox messages visible to authorized staff" on public.telegram_inbox_messages;
create policy "Telegram inbox messages visible to authorized staff"
  on public.telegram_inbox_messages for select to authenticated
  using (
    public.can_access_human_telegram()
    and (
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
    )
  );

drop policy if exists "Staff can read authorized inbox assignments" on public.telegram_inbox_chat_assignments;
create policy "Staff can read authorized inbox assignments"
  on public.telegram_inbox_chat_assignments for select to authenticated
  using (
    public.can_access_human_telegram()
    and (
      public.is_active_admin()
      or profile_id = auth.uid()
      or exists (
        select 1 from public.manager_employee_assignments m
        where m.manager_id = auth.uid() and m.employee_id = telegram_inbox_chat_assignments.profile_id
      )
    )
  );

drop policy if exists "Staff enqueue authorized inbox replies" on public.telegram_inbox_outbox;
create policy "Staff enqueue authorized inbox replies"
  on public.telegram_inbox_outbox for insert to authenticated
  with check (
    public.can_access_human_telegram()
    and requested_by = auth.uid()
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
    public.can_access_human_telegram()
    and (
      public.is_active_admin()
      or requested_by = auth.uid()
      or exists (
        select 1 from public.manager_employee_assignments m
        join public.telegram_inbox_chat_assignments a on a.profile_id = m.employee_id
        where m.manager_id = auth.uid() and a.chat_id = telegram_inbox_outbox.chat_id
      )
    )
  );
