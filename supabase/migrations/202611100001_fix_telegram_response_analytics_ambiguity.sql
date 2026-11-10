-- Fix the PL/pgSQL output-column ambiguity in Telegram response analytics.
create or replace function public.get_telegram_group_response_summary(
  p_chat_id bigint,
  p_days integer default 7
)
returns table (
  telegram_user_id bigint,
  display_name text,
  username text,
  reply_count bigint,
  avg_reply_seconds numeric,
  reaction_count bigint,
  avg_reaction_seconds numeric
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
      select 1 from public.telegram_group_members gm
      where gm.telegram_chat_id = p_chat_id
        and gm.profile_id is not null
        and public.is_assigned_manager(gm.profile_id)
    )
  ) then
    raise exception 'You do not have access to this Telegram group.' using errcode = '42501';
  end if;

  return query
  with reply_stats as (
    select
      reply.telegram_user_id,
      count(*)::bigint as reply_count,
      avg(extract(epoch from (reply.message_date - question.message_date)))::numeric as avg_reply_seconds
    from public.telegram_messages reply
    join public.telegram_messages question
      on question.telegram_chat_id = reply.telegram_chat_id
     and question.telegram_message_id = reply.reply_to_message_id
    where reply.telegram_chat_id = p_chat_id
      and reply.telegram_user_id is not null
      and reply.reply_to_message_id is not null
      and reply.message_date >= pg_catalog.now() - pg_catalog.make_interval(days => v_days)
      and reply.message_date >= question.message_date
      and reply.telegram_user_id is distinct from question.telegram_user_id
      and reply.is_deleted = false
    group by reply.telegram_user_id
  ),
  reaction_stats as (
    select
      event.telegram_user_id,
      count(*)::bigint as reaction_count,
      avg(event.response_seconds)::numeric as avg_reaction_seconds
    from public.telegram_message_reaction_events event
    where event.telegram_chat_id = p_chat_id
      and event.telegram_user_id is not null
      and event.action = 'added'
      and event.reacted_at >= pg_catalog.now() - pg_catalog.make_interval(days => v_days)
    group by event.telegram_user_id
  ),
  people as (
    select reply_stats.telegram_user_id from reply_stats
    union
    select reaction_stats.telegram_user_id from reaction_stats
  )
  select
    people.telegram_user_id,
    member.display_name,
    member.username,
    coalesce(reply_stats.reply_count, 0)::bigint,
    reply_stats.avg_reply_seconds,
    coalesce(reaction_stats.reaction_count, 0)::bigint,
    reaction_stats.avg_reaction_seconds
  from people
  left join public.telegram_group_members member
    on member.telegram_chat_id = p_chat_id
   and member.telegram_user_id = people.telegram_user_id
  left join reply_stats on reply_stats.telegram_user_id = people.telegram_user_id
  left join reaction_stats on reaction_stats.telegram_user_id = people.telegram_user_id
  order by coalesce(reply_stats.reply_count, 0) + coalesce(reaction_stats.reaction_count, 0) desc,
           people.telegram_user_id;
end;
$$;


revoke all on function public.get_telegram_group_response_summary(bigint, integer) from public, anon;
grant execute on function public.get_telegram_group_response_summary(bigint, integer) to authenticated;
