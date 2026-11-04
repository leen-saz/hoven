-- 023_library: Davinci-style templates + saved documents (docs/prd-davinci.md, phase A).
-- Templates carry {{variables}}; documents are what the team saved from any tab. Archive, never hard delete.
create table if not exists public.library_templates (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  kind text not null default 'copy',
  category text not null default '',
  name text not null,
  description text not null default '',
  body text not null,
  fields jsonb not null default '[]',
  lang text not null default 'ar',
  favorite boolean not null default false,
  source text not null default '',
  archived_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists library_templates_company_idx on public.library_templates (company_id, kind, updated_at desc);
create unique index if not exists library_templates_source_uq on public.library_templates (company_id, source, name) where source <> '';

create table if not exists public.library_folders (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  name text not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists library_folders_company_idx on public.library_folders (company_id, name);

create table if not exists public.library_documents (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  folder_id bigint references public.library_folders (id) on delete set null,
  template_id bigint references public.library_templates (id) on delete set null,
  title text not null,
  kind text not null default 'copy',
  body text not null default '',
  status text not null default 'draft',
  source text not null default '',
  archived_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists library_documents_company_idx on public.library_documents (company_id, updated_at desc);

alter table public.library_templates enable row level security;
alter table public.library_folders enable row level security;
alter table public.library_documents enable row level security;
revoke all on public.library_templates, public.library_folders, public.library_documents from anon, authenticated;
