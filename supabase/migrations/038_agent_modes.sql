-- 038_agent_modes: وضع «تلقائي» لكل وكيل (docs/PRD.md §6.3، قرار لين 2026-11-20).
-- mode: approve («بموافقتي»، الافتراضي) أو auto («تلقائي»). لين بس تغيّره، وزر واحد يرجّع الكل «بموافقتي».
-- caps: حدود يفرضها خادم MCP على التغييرات التلقائية:
--   max_raise_pct: أقصى رفع للميزانية في اليوم (ما يتعدى ٢٠)، max_daily_sar: سقف الميزانية اليومية لحملة وحدة،
--   max_total_daily_sar: سقف مجموع الميزانيات اليومية اللي يرفعها الوكيل في اليوم.
-- يشتغل مرتين بأمان. شغّله بعد 037_mcp_events.sql.
create table if not exists public.agent_modes (
  company_id uuid not null references public.companies (id),
  agent text not null check (agent in ('buyer', 'dream', 'social')),
  mode text not null default 'approve' check (mode in ('approve', 'auto')),
  caps jsonb not null default '{}',
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (company_id, agent)
);

alter table public.agent_modes enable row level security;
revoke all on public.agent_modes from anon, authenticated;
