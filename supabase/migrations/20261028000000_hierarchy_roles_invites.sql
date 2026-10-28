-- CRM hierarchy, role labels, and manager invitation links.
-- Roles remain text so existing installations can migrate without enum rewrites.
alter table public.profiles
  alter column role set default 'Junior';

update public.profiles
set role = case lower(role)
  when 'admin' then 'admin'
  when 'junior' then 'Junior'
  when 'middle' then 'Middle'
  when 'senior' then 'Senior'
  when 'team leader' then 'Team Leader'
  when 'team_leader' then 'Team Leader'
  when 'telemarketing' then 'Telemarketing'
  when 'manager' then 'Middle'
  else 'Junior'
end
where role is not null;

create table if not exists public.manager_invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  manager_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  redeemed_by uuid references public.profiles(id) on delete set null,
  redeemed_at timestamptz
);
create index if not exists manager_invites_manager_id_idx on public.manager_invites(manager_id);
create index if not exists manager_invites_token_idx on public.manager_invites(token);

alter table public.manager_invites enable row level security;

drop policy if exists "Users can view their own invites" on public.manager_invites;
create policy "Users can view their own invites"
on public.manager_invites for select to authenticated
using (
  manager_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role) = 'admin')
);

drop policy if exists "Eligible managers can create own invites" on public.manager_invites;
create policy "Eligible managers can create own invites"
on public.manager_invites for insert to authenticated
with check (
  manager_id = auth.uid()
  and created_by = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active = true
      and lower(p.role) in ('middle','senior','team leader','team_leader')
  )
);

drop policy if exists "Admins can manage profile roles" on public.profiles;
create policy "Admins can manage profile roles"
on public.profiles for update to authenticated
using (exists (select 1 from public.profiles me where me.id = auth.uid() and lower(me.role) = 'admin'))
with check (exists (select 1 from public.profiles me where me.id = auth.uid() and lower(me.role) = 'admin'));
