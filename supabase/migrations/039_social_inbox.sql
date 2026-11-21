-- 039_social_inbox: ردود قروك على التواصل الاجتماعي (قرار لين 2026-11-21): تعليقات ورسائل خاصة من فيسبوك وانستقرام.
-- قروك (عبر OpenRouter) يصنّف كل رسالة ويكتب رد، ولين تعتمده قبل ما ينرسل («بموافقتي»). الشكاوى والاسترجاع والسلبي
-- تتحوّل لها بدون رد. حماية البيانات (PDPL): الرسائل الخاصة تنمسح بعد ٩٠ يوم، ونحفظ اسم المرسل ونصه بس.
-- يشتغل مرتين بأمان. شغّله بعد 038_agent_modes.sql.
create table if not exists public.social_inbox (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  platform text not null check (platform in ('facebook', 'instagram')),
  kind text not null check (kind in ('comment', 'dm')),
  external_id text not null,
  thread_id text not null,
  author_id text,
  author text,
  text text not null,
  post_text text,
  at timestamptz not null,
  category text check (category in ('question', 'complaint', 'refund', 'negative', 'spam', 'other')),
  status text not null default 'new' check (status in ('new', 'drafted', 'escalated', 'sent', 'ignored', 'failed', 'expired')),
  draft text,
  reply_id text,
  error text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, platform, external_id)
);
create index if not exists social_inbox_company_status_idx on public.social_inbox (company_id, status, at desc);

alter table public.social_inbox enable row level security;
revoke all on public.social_inbox from anon, authenticated;
