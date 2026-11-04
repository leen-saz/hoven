-- 025_totp: two-step sign-in (TOTP, RFC 6238) on profiles (docs/prd-davinci.md, phase E).
-- totp_secret is AES-GCM sealed by the Worker (key from SESSION_SECRET), never plain. Recovery codes are stored as hashes.
-- totp_last_step blocks replaying a code; 5 wrong codes lock the second step for 15 minutes.
alter table public.profiles
  add column if not exists totp_secret text,
  add column if not exists totp_enabled boolean not null default false,
  add column if not exists totp_recovery text[] not null default '{}',
  add column if not exists totp_last_step bigint not null default 0,
  add column if not exists totp_fails int not null default 0,
  add column if not exists totp_locked_until timestamptz;
