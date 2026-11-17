-- 031_buyer: الميديا باير. أهداف لين لكل منصة وقواعدها بالعربي، صف واحد لكل شركة.
-- الدروس تستخدم جدول lessons الموجود (module = 'buyer')، والنتائج بعد ٣ و٧ أيام جدول outcomes الموجود.
-- الاقتراحات تنحفظ في suggestions (لوحة القرارات) ولا تتنفّذ إلا بموافقة.
-- يشتغل مرتين بأمان. شغّله في Supabase ← SQL Editor بعد 000-030.
create table if not exists public.buyer_settings (
  company_id uuid primary key references public.companies (id),
  goals jsonb not null default '{}',
  rules jsonb not null default '[]',
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.buyer_settings enable row level security;
revoke all on public.buyer_settings from anon, authenticated;

-- قراءة الاقتراحات اللي طلعت من الميديا باير وحسابات النتائج
create index if not exists suggestions_source_decided_idx on public.suggestions (source, decided_at desc);
