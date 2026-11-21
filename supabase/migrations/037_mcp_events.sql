-- 037_mcp_events: الأحداث الصادرة من MCP هوفن (docs/PRD.md §3.10): منشور انشر أو فشل، حساب انفصل أو رجع، تغيير سواه وضع «تلقائي».
-- تظهر كعدّاد في القائمة وفي صفحة الربط، و Claude يقراها بأداة events.list. أسماء وأرقام فقط، بدون توكن ولا رسالة منصة.
-- يشتغل مرتين بأمان. شغّله بعد 036_mcp.sql.
create table if not exists public.mcp_events (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  kind text not null,
  tool text,
  agent text,
  data jsonb not null default '{}',
  seen boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists mcp_events_company_at_idx on public.mcp_events (company_id, at desc);
create index if not exists mcp_events_unseen_idx on public.mcp_events (company_id) where not seen;

alter table public.mcp_events enable row level security;
revoke all on public.mcp_events from anon, authenticated;
