-- 034_ad_writes: الكتابة على منصات الإعلانات بحماية (docs/PRD.md §3.4 و §6.3، اعتمدتها لين 2026-11-19).
-- idempotency_keys: نفس الضغطة بنفس المفتاح خلال ٢٤ ساعة ترجع نفس الجواب وما تنادي المنصة مرة ثانية.
-- ad_changes: كل كتابة على منصة (قبل، بعد، مين، متى، ليش)، مع audit_log.
-- dream_launches: نشر حملة من «احلم» على منصة: وش انشأ عليها (أرقام الحملة والمجموعة والإعلانات)، عشان الإعادة تكمل وما تكرر.
-- يشتغل مرتين بأمان. شغّله في Supabase ← SQL Editor بعد 033_dream.sql.
create table if not exists public.idempotency_keys (
  key text not null,
  company_id uuid not null references public.companies (id),
  scope text not null,
  request_hash text not null,
  status int,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (company_id, key)
);
create index if not exists idempotency_keys_created_idx on public.idempotency_keys (created_at);

create table if not exists public.ad_changes (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  platform text not null,
  level text not null check (level in ('campaign', 'adset', 'ad', 'creative', 'image')),
  target_id text,
  action text not null,
  before jsonb,
  after jsonb,
  source text not null check (source in ('dream', 'buyer', 'manual')),
  launch_id bigint,
  suggestion_id bigint,
  by text not null,
  at timestamptz not null default now(),
  ok boolean not null default true,
  error text
);
create index if not exists ad_changes_company_at_idx on public.ad_changes (company_id, at desc);
create index if not exists ad_changes_target_idx on public.ad_changes (platform, target_id, at desc);

create table if not exists public.dream_launches (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  project_id bigint not null references public.dream_projects (id) on delete cascade,
  platform text not null,
  status text not null default 'pending' check (status in ('pending', 'created', 'failed', 'active', 'paused')),
  daily_sar numeric,
  link text,
  external jsonb not null default '{}',
  receipt jsonb,
  error text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, platform)
);

alter table public.idempotency_keys enable row level security;
alter table public.ad_changes enable row level security;
alter table public.dream_launches enable row level security;
revoke all on public.idempotency_keys from anon, authenticated;
revoke all on public.ad_changes from anon, authenticated;
revoke all on public.dream_launches from anon, authenticated;
