-- Allow only an active, same-session Telegram MFA challenge to perform
-- the username lookup required by the login recovery form.
create or replace function public.is_auth_mfa_or_pending_telegram_lookup()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when auth.uid() is null
      or nullif(auth.jwt() ->> 'session_id', '') is null
    then false
    else
      public.is_auth_mfa_current()
      or exists (
        select 1
        from public.crm_login_challenges c
        where c.user_id = auth.uid()
          and c.session_id = (auth.jwt() ->> 'session_id')::uuid
          and c.stage = 'telegram'
          and c.expires_at > pg_catalog.now()
      )
  end;
$function$;

revoke all on function public.is_auth_mfa_or_pending_telegram_lookup() from public, anon;
grant execute on function public.is_auth_mfa_or_pending_telegram_lookup() to authenticated;

drop policy if exists "Signed-in users can request Telegram username lookup"
  on public.telegram_inbox_search_requests;
create policy "Signed-in users can request Telegram username lookup"
  on public.telegram_inbox_search_requests
  for insert
  to authenticated
  with check (
    requested_by = auth.uid()
    and public.is_auth_mfa_or_pending_telegram_lookup()
  );

drop policy if exists "Staff can read own Telegram username lookup requests"
  on public.telegram_inbox_search_requests;
create policy "Staff can read own Telegram username lookup requests"
  on public.telegram_inbox_search_requests
  for select
  to authenticated
  using (
    requested_by = auth.uid()
    and public.is_auth_mfa_or_pending_telegram_lookup()
  );
