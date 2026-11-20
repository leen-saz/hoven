-- 033_dream: «احلم» (docs/PRD.md §3.2). مشروع لكل فكرة حملة، ومحادثته، وأجزاؤه بنسخ.
-- «عدّل» يكتب نسخة جديدة من الجزء (القديمة تبقى)، و«اعتمد» يقفل نسخة. النسخة الجديدة تعلّم الأجزاء المعتمدة اللي مبنية عليها بـ stale.
-- كل صف تابع لشركة، والقراءة والكتابة من الـ Worker بمفتاح الخدمة فقط (RLS مفعّل، بدون صلاحيات لـ anon و authenticated).
-- يشتغل مرتين بأمان. شغّله في Supabase ← SQL Editor بعد 032_buyer_learning.sql.
create table if not exists public.dream_projects (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  title text not null default '',
  idea text not null default '',
  platforms text[] not null default '{}',
  status text not null default 'chatting' check (status in ('chatting', 'drafting', 'approved', 'publishing', 'published', 'failed')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dream_projects_company_idx on public.dream_projects (company_id, updated_at desc);

create table if not exists public.dream_messages (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  project_id bigint not null references public.dream_projects (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  model text,
  created_at timestamptz not null default now()
);
create index if not exists dream_messages_project_idx on public.dream_messages (project_id, id);

create table if not exists public.dream_parts (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  project_id bigint not null references public.dream_projects (id) on delete cascade,
  kind text not null check (kind in ('strategy', 'audience', 'budget', 'copy', 'design', 'motion', 'voiceover')),
  version int not null,
  content jsonb not null default '{}',
  asset_keys text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'approved', 'stale')),
  instruction text,
  model text,
  created_by text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, kind, version)
);
create index if not exists dream_parts_project_idx on public.dream_parts (project_id, kind, version desc);

alter table public.dream_projects enable row level security;
alter table public.dream_messages enable row level security;
alter table public.dream_parts enable row level security;
revoke all on public.dream_projects from anon, authenticated;
revoke all on public.dream_messages from anon, authenticated;
revoke all on public.dream_parts from anon, authenticated;
