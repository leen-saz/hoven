-- 035_social_more: التواصل الاجتماعي (docs/PRD.md §3.5 و §3.6).
-- overrides: نص خاص لكل منصة (المنصة بدون نص خاص تنشر النص المشترك).
-- social_slots: خانات نشر ثابتة في الأسبوع بتوقيت الرياض، و«الخانة الجاية» تعبي وقت النشر.
-- connection_health: فحص كل ساعة للحسابات المربوطة. فشل واحد = «متعثر»، وبعد ساعة فشل متواصل = «منفصل».
-- يشتغل مرتين بأمان. شغّله في Supabase ← SQL Editor بعد 034_ad_writes.sql.
alter table public.social_posts add column if not exists overrides jsonb not null default '{}';

create table if not exists public.social_slots (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  weekday smallint not null check (weekday between 0 and 6),
  at time not null,
  created_by text,
  unique (company_id, weekday, at)
);

create table if not exists public.connection_health (
  company_id uuid not null references public.companies (id),
  platform text not null,
  health text not null check (health in ('ok', 'failing', 'down')),
  code text,
  checked_at timestamptz not null default now(),
  failing_since timestamptz,
  primary key (company_id, platform)
);

alter table public.social_slots enable row level security;
alter table public.connection_health enable row level security;
revoke all on public.social_slots from anon, authenticated;
revoke all on public.connection_health from anon, authenticated;
