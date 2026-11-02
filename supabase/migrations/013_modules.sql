-- 013 (Well 011_modules): every tab is a module; a company locks the ones it does not need. Hoven keeps all of them.
alter table public.companies add column if not exists disabled_modules text[] not null default '{}';
