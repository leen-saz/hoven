-- 032_buyer_learning: الحملات المُدارة للميديا باير (docs/PRD.md §3.3 و §6.3).
-- الميديا باير يقترح تغيير الميزانية بس على الحملات اللي لين تحددها هنا، وهي نفسها الحملات الوحيدة اللي أي كتابة لاحقة تقدر تلمسها.
-- القائمة الفاضية = كل الحملات (لين تحدد). الدروس من النتائج تنكتب في lessons (source = 'outcome') والنتائج في outcomes.
-- يشتغل مرتين بأمان. شغّله في Supabase ← SQL Editor بعد 031_buyer.sql.
alter table public.buyer_settings add column if not exists managed jsonb not null default '[]';

-- الدروس اللي تنتظر قرار لين لكل تاب (العدّاد وتبويب «وش تعلّمت»)
create index if not exists lessons_module_status_idx on public.lessons (company_id, module, status) where active;
