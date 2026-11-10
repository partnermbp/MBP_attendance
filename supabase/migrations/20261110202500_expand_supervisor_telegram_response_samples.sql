drop function if exists public.get_supervisor_telegram_metrics();

create function public.get_supervisor_telegram_metrics()
returns table(
  profile_id uuid,
  asked_count bigint,
  reply_count bigint,
  average_response_seconds numeric,
  response_samples jsonb,
  question_samples jsonb
)
language sql stable security definer set search_path to 'public'
as $function$
  select p.id,
    count(m.*) filter (where m.question_user_id=p.telegram_user_id)::bigint as asked_count,
    count(m.*) filter (where m.first_reply_user_id=p.telegram_user_id and m.response_seconds is not null)::bigint as reply_count,
    avg(m.response_seconds) filter (where m.first_reply_user_id=p.telegram_user_id and m.response_seconds is not null) as average_response_seconds,
    coalesce(
      jsonb_agg(jsonb_build_object('response_seconds',m.response_seconds,'calculated_at',m.calculated_at) order by m.calculated_at)
        filter (where m.first_reply_user_id=p.telegram_user_id and m.response_seconds is not null),
      '[]'::jsonb
    ) as response_samples,
    coalesce(
      jsonb_agg(jsonb_build_object('calculated_at',m.calculated_at,'answered',m.first_reply_user_id is not null) order by m.calculated_at)
        filter (where m.question_user_id=p.telegram_user_id),
      '[]'::jsonb
    ) as question_samples
  from public.profiles p
  left join public.telegram_response_metrics m
    on m.question_user_id=p.telegram_user_id or m.first_reply_user_id=p.telegram_user_id
  where public.is_active_supervisor()
    and p.telegram_user_id is not null and p.telegram_verified_at is not null
  group by p.id,p.telegram_user_id;
$function$;

revoke all on function public.get_supervisor_telegram_metrics() from public,anon;
grant execute on function public.get_supervisor_telegram_metrics() to authenticated;
