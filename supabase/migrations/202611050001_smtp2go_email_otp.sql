-- SMTP2GO-backed corporate email OTP fields.
-- The login challenge remains bound to the original password-authenticated session.
alter table public.crm_login_challenges
  add column if not exists email_otp_hash text,
  add column if not exists email_otp_expires_at timestamptz,
  add column if not exists email_otp_sent_at timestamptz;

create index if not exists crm_login_challenges_email_otp_expiry_idx
  on public.crm_login_challenges(email_otp_expires_at)
  where email_otp_expires_at is not null;
