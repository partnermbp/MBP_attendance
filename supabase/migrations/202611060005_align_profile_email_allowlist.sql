-- Keep the profiles table email constraint aligned with the exact invitation
-- allowlist. Gmail remains restricted to these three explicitly approved
-- addresses; no general Gmail domain access is introduced.

alter table public.profiles
  drop constraint if exists profile_allowed_domain;

alter table public.profiles
  add constraint profile_allowed_domain
  check (
    lower(email) ~ '^[^@]+@(mostbet[.]partners|infradim[.]com|starson[.]cloud|double[.]global)$'
    or lower(email) in (
      'partnermbp@gmail.com',
      'vladimirlenin458@gmail.com',
      'gameon892@gmail.com'
    )
  );
