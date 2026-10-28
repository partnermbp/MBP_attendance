-- The legacy handle_invited_user trigger checks public.invitations,
-- but current registrations use public.manager_invitations plus a verified
-- Telegram registration ticket. Remove only auth.users triggers that invoke
-- that obsolete validator; keep the function itself for audit/rollback.
DO $$
DECLARE
  legacy_trigger record;
BEGIN
  FOR legacy_trigger IN
    SELECT t.tgname
    FROM pg_catalog.pg_trigger AS t
    WHERE t.tgrelid = 'auth.users'::regclass
      AND NOT t.tgisinternal
      AND t.tgfoid = 'public.handle_invited_user()'::regprocedure
  LOOP
    EXECUTE format('DROP TRIGGER %I ON auth.users', legacy_trigger.tgname);
  END LOOP;
END;
$$;
