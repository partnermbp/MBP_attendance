create or replace function public.is_hierarchy_manager(target_profile uuid default auth.uid())
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.is_auth_mfa_current() and exists (
    select 1 from public.profiles p
    where p.id=target_profile and p.active=true
      and lower(replace(p.role::text,'_',' ')) in ('junior','middle','senior','team leader')
  );
$function$;
alter table public.attendance add column if not exists credited_work_minutes integer, add column if not exists auto_closed boolean not null default false;
alter table public.attendance add constraint attendance_credited_work_minutes_nonnegative check (credited_work_minutes is null or credited_work_minutes >= 0);
