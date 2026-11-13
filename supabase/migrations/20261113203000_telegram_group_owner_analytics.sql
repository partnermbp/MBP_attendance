alter table public.telegram_groups add column if not exists admins_synced_at timestamptz;
create table if not exists public.telegram_group_admins (
 telegram_chat_id bigint not null references public.telegram_groups(telegram_chat_id) on delete cascade,
 telegram_user_id bigint not null, is_creator boolean not null default false,
 telegram_status text not null check(telegram_status in ('creator','administrator')),
 synced_at timestamptz not null default now(), primary key(telegram_chat_id,telegram_user_id));
create index if not exists telegram_group_admins_user_idx on public.telegram_group_admins(telegram_user_id,telegram_chat_id);
alter table public.telegram_group_admins enable row level security;
revoke all on public.telegram_group_admins from public,anon,authenticated;
grant all on public.telegram_group_admins to service_role;

create or replace function public.sync_telegram_group_admins(p_chat_id bigint,p_admins jsonb)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if p_chat_id is null or jsonb_typeof(coalesce(p_admins,'[]'::jsonb))<>'array' then raise exception 'Invalid Telegram administrator payload'; end if;
 delete from public.telegram_group_admins where telegram_chat_id=p_chat_id;
 insert into public.telegram_group_admins(telegram_chat_id,telegram_user_id,is_creator,telegram_status,synced_at)
 select p_chat_id,(e->'user'->>'id')::bigint,e->>'status'='creator',e->>'status',now()
 from jsonb_array_elements(p_admins) e
 where e->>'status' in ('creator','administrator') and coalesce(e->'user'->>'is_bot','false')<>'true' and nullif(e->'user'->>'id','') is not null
 on conflict(telegram_chat_id,telegram_user_id) do update set is_creator=excluded.is_creator,telegram_status=excluded.telegram_status,synced_at=now();
 update public.telegram_groups set admins_synced_at=now() where telegram_chat_id=p_chat_id;
end $$;
revoke all on function public.sync_telegram_group_admins(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.sync_telegram_group_admins(bigint,jsonb) to service_role;

create or replace function public.can_access_telegram_analytics_group(p_chat_id bigint)
returns boolean language sql stable security definer set search_path=''
as $$
 select auth.uid() is not null and public.is_auth_mfa_current() and (
  public.is_active_admin() or public.is_active_supervisor()
  or exists(select 1 from public.telegram_group_admins ga join public.profiles p on p.telegram_user_id=ga.telegram_user_id
    where ga.telegram_chat_id=p_chat_id and p.id=auth.uid() and p.active=true)
 );
$$;
revoke all on function public.can_access_telegram_analytics_group(bigint) from public,anon;
grant execute on function public.can_access_telegram_analytics_group(bigint) to authenticated;

create or replace function public.get_telegram_group_analytics_options()
returns table(team_leader_id uuid,team_leader_name text,owner_profile_id uuid,owner_name text,telegram_chat_id bigint,group_title text)
language sql stable security definer set search_path=''
as $$
 with recursive visible_tree(id) as (
  select auth.uid() where auth.uid() is not null
  union
  select a.employee_id from public.manager_employee_assignments a join visible_tree v on v.id=a.manager_id
   join public.profiles c on c.id=a.employee_id and c.active=true
 ),
 tls as (
  select p.id,coalesce(nullif(p.admin_panel_name,''),nullif(p.full_name,''),p.email,p.id::text) nm
  from public.profiles p where p.active and lower(replace(p.role::text,'_',' '))='team leader'
   and (public.is_active_admin() or (public.is_active_supervisor() and exists(select 1 from visible_tree v where v.id=p.id)))
 ),
 team(team_leader_id,profile_id,path) as (
  select t.id,t.id,array[t.id]::uuid[] from tls t
  union all
  select t.team_leader_id,a.employee_id,t.path||a.employee_id from team t
   join public.manager_employee_assignments a on a.manager_id=t.profile_id
   join public.profiles c on c.id=a.employee_id and c.active=true where not a.employee_id=any(t.path)
 )
 select t.id,t.nm,o.id,coalesce(nullif(o.admin_panel_name,''),nullif(o.full_name,''),o.email,o.id::text),g.telegram_chat_id,g.title
 from tls t join team tr on tr.team_leader_id=t.id join public.profiles o on o.id=tr.profile_id and o.active
 join public.telegram_group_admins ga on ga.telegram_user_id=o.telegram_user_id
 join public.telegram_groups g on g.telegram_chat_id=ga.telegram_chat_id and g.enabled
 where public.is_active_admin() or public.is_active_supervisor()
 union all
 select case when lower(replace(me.role::text,'_',' '))='team leader' then me.id end,
  case when lower(replace(me.role::text,'_',' '))='team leader' then coalesce(nullif(me.admin_panel_name,''),nullif(me.full_name,''),me.email,me.id::text) end,
  me.id,coalesce(nullif(me.admin_panel_name,''),nullif(me.full_name,''),me.email,me.id::text),g.telegram_chat_id,g.title
 from public.profiles me join public.telegram_group_admins ga on ga.telegram_user_id=me.telegram_user_id
 join public.telegram_groups g on g.telegram_chat_id=ga.telegram_chat_id and g.enabled
 where auth.uid()=me.id and me.active and lower(replace(me.role::text,'_',' ')) in ('team leader','senior','middle','junior')
 and not (public.is_active_admin() or public.is_active_supervisor())
 order by 2,4,6;
$$;
revoke all on function public.get_telegram_group_analytics_options() from public,anon;
grant execute on function public.get_telegram_group_analytics_options() to authenticated;

drop policy if exists "Admins and Supervisors read telegram groups" on public.telegram_groups;
drop policy if exists "Assigned managers read relevant telegram groups" on public.telegram_groups;
create policy "Telegram analytics group owners read owned groups" on public.telegram_groups for select to authenticated using(public.can_access_telegram_analytics_group(telegram_chat_id));
drop policy if exists "Authorized staff read telegram messages" on public.telegram_messages;
create policy "Telegram analytics group owners read messages" on public.telegram_messages for select to authenticated using(public.can_access_telegram_analytics_group(telegram_chat_id));
drop policy if exists "Authorized staff read telegram response metrics" on public.telegram_response_metrics;
create policy "Telegram analytics group owners read response metrics" on public.telegram_response_metrics for select to authenticated using(public.can_access_telegram_analytics_group(telegram_chat_id));
drop policy if exists "Authorized staff read Telegram message reactions" on public.telegram_message_reactions;
drop policy if exists "Authorized staff read telegram message reactions" on public.telegram_message_reactions;
create policy "Telegram analytics group owners read reactions" on public.telegram_message_reactions for select to authenticated using(public.can_access_telegram_analytics_group(telegram_chat_id));
drop policy if exists "Authorized staff read Telegram reaction counts" on public.telegram_message_reaction_counts;
create policy "Telegram analytics group owners read reaction counts" on public.telegram_message_reaction_counts for select to authenticated using(public.can_access_telegram_analytics_group(telegram_chat_id));

create or replace function public.get_telegram_group_user_activity(p_chat_id bigint,p_days integer default 7)
returns table(telegram_user_id bigint,display_name text,username text,message_count bigint,last_message_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
declare v_days integer:=greatest(1,least(coalesce(p_days,7),30));
begin
 if not public.can_access_telegram_analytics_group(p_chat_id) then raise exception 'You do not have access to this Telegram group.' using errcode='42501'; end if;
 return query select m.telegram_user_id,(array_agg(m.display_name order by m.message_date desc,m.telegram_message_id desc))[1],
 (array_agg(m.username order by m.message_date desc,m.telegram_message_id desc))[1],count(*)::bigint,max(m.message_date)
 from public.telegram_messages m where m.telegram_chat_id=p_chat_id and m.telegram_user_id is not null
 and m.message_date>=now()-make_interval(days=>v_days) and m.is_deleted=false group by m.telegram_user_id
 order by count(*) desc,max(m.message_date) desc;
end $$;

create or replace function public.get_telegram_group_daily_user_activity(p_chat_id bigint,p_days integer default 7,p_timezone text default 'UTC')
returns table(telegram_user_id bigint,display_name text,username text,activity_date date,message_count bigint)
language plpgsql stable security definer set search_path=''
as $$
declare v_days integer:=greatest(1,least(coalesce(p_days,7),30)); v_timezone text:=coalesce(nullif(p_timezone,''),'UTC');
begin
 if not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=v_timezone) then v_timezone:='UTC'; end if;
 if not public.can_access_telegram_analytics_group(p_chat_id) then raise exception 'You do not have access to this Telegram group.' using errcode='42501'; end if;
 return query select m.telegram_user_id,(array_agg(m.display_name order by m.message_date desc,m.telegram_message_id desc))[1],
 (array_agg(m.username order by m.message_date desc,m.telegram_message_id desc))[1],(m.message_date at time zone v_timezone)::date,count(*)::bigint
 from public.telegram_messages m where m.telegram_chat_id=p_chat_id and m.telegram_user_id is not null and not m.is_deleted
 and (m.message_date at time zone v_timezone)::date between ((now() at time zone v_timezone)::date-(v_days-1)) and (now() at time zone v_timezone)::date
 group by m.telegram_user_id,(m.message_date at time zone v_timezone)::date order by (m.message_date at time zone v_timezone)::date,count(*) desc;
end $$;

create or replace function public.get_telegram_group_response_summary(p_chat_id bigint,p_days integer default 7)
returns table(telegram_user_id bigint,display_name text,username text,reply_count bigint,avg_reply_seconds numeric,reaction_count bigint,avg_reaction_seconds numeric)
language plpgsql stable security definer set search_path=''
as $$
declare v_days integer:=greatest(1,least(coalesce(p_days,7),30));
begin
 if not public.can_access_telegram_analytics_group(p_chat_id) then raise exception 'You do not have access to this Telegram group.' using errcode='42501'; end if;
 return query
 with replies as (
  select r.telegram_user_id,count(*)::bigint reply_count,avg(extract(epoch from(r.message_date-q.message_date)))::numeric avg_reply_seconds
  from public.telegram_messages r join public.telegram_messages q on q.telegram_chat_id=r.telegram_chat_id and q.telegram_message_id=r.reply_to_message_id
  where r.telegram_chat_id=p_chat_id and r.telegram_user_id is not null and r.reply_to_message_id is not null
   and r.message_date>=now()-make_interval(days=>v_days) and r.message_date>=q.message_date
   and r.telegram_user_id is distinct from q.telegram_user_id and not r.is_deleted group by r.telegram_user_id
 ), reactions as (
  select e.telegram_user_id,count(*)::bigint reaction_count,avg(e.response_seconds)::numeric avg_reaction_seconds
  from public.telegram_message_reaction_events e where e.telegram_chat_id=p_chat_id and e.telegram_user_id is not null
   and e.action='added' and e.reacted_at>=now()-make_interval(days=>v_days) group by e.telegram_user_id
 ), people as (select telegram_user_id from replies union select telegram_user_id from reactions)
 select p.telegram_user_id,m.display_name,m.username,coalesce(r.reply_count,0)::bigint,r.avg_reply_seconds,
  coalesce(x.reaction_count,0)::bigint,x.avg_reaction_seconds
 from people p left join public.telegram_group_members m on m.telegram_chat_id=p_chat_id and m.telegram_user_id=p.telegram_user_id
 left join replies r on r.telegram_user_id=p.telegram_user_id left join reactions x on x.telegram_user_id=p.telegram_user_id
 order by coalesce(r.reply_count,0)+coalesce(x.reaction_count,0) desc,p.telegram_user_id;
end $$;
revoke all on function public.get_telegram_group_user_activity(bigint,integer) from public,anon;
grant execute on function public.get_telegram_group_user_activity(bigint,integer) to authenticated;
revoke all on function public.get_telegram_group_daily_user_activity(bigint,integer,text) from public,anon;
grant execute on function public.get_telegram_group_daily_user_activity(bigint,integer,text) to authenticated;
revoke all on function public.get_telegram_group_response_summary(bigint,integer) from public,anon;
grant execute on function public.get_telegram_group_response_summary(bigint,integer) to authenticated;
