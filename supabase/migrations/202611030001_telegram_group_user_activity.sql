-- Per-participant message activity for a selected Telegram group.
-- Results are restricted to Admins and managers assigned to the selected group.

create or replace function public.get_telegram_group_user_activity(
  p_chat_id bigint,
  p_days integer default 7
)
returns table (
  telegram_user_id bigint,
  display_name text,
  username text,
  message_count bigint,
  last_message_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 7), 30));
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;

  if p_chat_id is null or not (
    public.is_active_admin()
    or exists (
      select 1
      from public.telegram_group_members gm
      where gm.telegram_chat_id = p_chat_id
        and gm.profile_id is not null
        and public.is_assigned_manager(gm.profile_id)
    )
  ) then
    raise exception 'You do not have access to this Telegram group.' using errcode = '42501';
  end if;

  return query
  select
    m.telegram_user_id,
    (array_agg(m.display_name order by m.message_date desc, m.telegram_message_id desc))[1] as display_name,
    (array_agg(m.username order by m.message_date desc, m.telegram_message_id desc))[1] as username,
    count(*)::bigint as message_count,
    max(m.message_date) as last_message_at
  from public.telegram_messages m
  where m.telegram_chat_id = p_chat_id
    and m.telegram_user_id is not null
    and m.message_date >= pg_catalog.now() - pg_catalog.make_interval(days => v_days)
    and m.is_deleted = false
  group by m.telegram_user_id
  order by count(*) desc, max(m.message_date) desc;
end;
$$;

revoke all on function public.get_telegram_group_user_activity(bigint, integer) from public, anon;
grant execute on function public.get_telegram_group_user_activity(bigint, integer) to authenticated;
