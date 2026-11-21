-- 036_mcp: خادم MCP الخاص بهوفن (docs/PRD.md §3.10، قرار لين 2026-11-20): الربط مع Claude وأي تطبيق MCP عبر OAuth 2.1 + PKCE.
-- mcp_clients: التطبيقات اللي سجّلت نفسها (تسجيل تلقائي، بدون سر).
-- mcp_codes: رمز الموافقة لمرة وحدة، ١٠ دقايق، محفوظ كـ hash.
-- mcp_tokens: توكنات الدخول (ساعة) والتجديد (٣٠ يوم)، محفوظة كـ hash، وتنفصل من صفحة الربط.
-- ad_changes.source: تضاف claude (كتابة من محادثة Claude) و auto (وضع «تلقائي»).
-- يشتغل مرتين بأمان. شغّله بعد 035_social_more.sql.
create table if not exists public.mcp_clients (
  client_id text primary key,
  company_id uuid references public.companies (id),
  name text not null,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

create table if not exists public.mcp_codes (
  code_hash text primary key,
  company_id uuid not null references public.companies (id),
  client_id text not null references public.mcp_clients (client_id) on delete cascade,
  user_id uuid not null,
  email text not null,
  scope text not null check (scope in ('read', 'read_write')),
  challenge text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.mcp_tokens (
  token_hash text primary key,
  company_id uuid not null references public.companies (id),
  client_id text not null references public.mcp_clients (client_id) on delete cascade,
  user_id uuid not null,
  email text not null,
  scope text not null check (scope in ('read', 'read_write')),
  kind text not null check (kind in ('access', 'refresh')),
  expires_at timestamptz not null,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists mcp_tokens_company_idx on public.mcp_tokens (company_id, client_id, revoked);

alter table public.ad_changes drop constraint if exists ad_changes_source_check;
alter table public.ad_changes add constraint ad_changes_source_check check (source in ('dream', 'buyer', 'manual', 'claude', 'auto'));

alter table public.mcp_clients enable row level security;
alter table public.mcp_codes enable row level security;
alter table public.mcp_tokens enable row level security;
revoke all on public.mcp_clients from anon, authenticated;
revoke all on public.mcp_codes from anon, authenticated;
revoke all on public.mcp_tokens from anon, authenticated;
