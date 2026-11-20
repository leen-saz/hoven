# خطة التنفيذ (من `docs/PRD.md`)

**الحالة:** قيد التنفيذ منذ 2026-11-19 بطلب لين («اكتب بلان التطبيق ولا توقف إلا مطبقها»).

## طريقة العمل
- كل مرحلة في فرع و PR مستقل. الفروع **متراكبة**: كل فرع يبدأ من فرع المرحلة السابقة، وقاعدة كل PR هي الفرع الذي قبله، فيُدمج بالترتيب.
- لا دمج ولا نشر إلا بكلمة لين («ادمج»، «انشر»). إذا قالت «ادمج» تُدمج الطلبات بالترتيب من الأقدم.
- قبل كل push: `npm run lint`، و `npm run typecheck`، و `npm run test:unit`، و `npm run build`.
- كل migration جديدة تعمل مرتين بأمان (`if not exists`)، والصفحات تعمل قبل تشغيلها وتعرض تنبيه `notApplied` للمالكة.
- كل مفتاح ناقص يظهر برسالة `notEnabled`، ولا يتعطل شيء آخر.
- المسارات بنمط المستودع: `/api/<group>/<action>`، والمعرّفات في الـ query أو الـ body (`src/api/index.ts`).

## المراحل

| # | الفرع | الملفات الأساسية | الاختبارات | ما تحتاجه لين |
|---|---|---|---|---|
| 0 | `impl/m0-cleanup` | `public/assets/app.css` (شريط الأرقام)، `package.json`/`package-lock.json` (astro, hono) | `tests/unit/kpi-strip.test.ts`، و `npm audit` بلا متوسط | `031_buyer.sql`، `OPENROUTER_API_KEY` |
| 1 | `impl/m1-ui` | `src/styles/tokens.css` (جديد)، `app.css` و `ui.css` يقرآن منه، وضع داكن، `public/assets/sidebar.js` (الترتيب والأسماء والعدّادات)، `src/api/routes/nav.ts`، `public/assets/palette.js` (⌘K)، `public/assets/toast.js` | `sidebar.test.ts` (الترتيب)، `nav-counts.test.ts`، `tokens.test.ts` | لا شيء |
| 2 | `impl/m2-buyer-learning` | `supabase/migrations/032_buyer_learning.sql`، `src/modules/buyer/learn.ts` (قياس مجدول + درس من النتيجة)، cron في `src/app.ts`، `routes.ts` (`managed`, `learned`)، الواجهة | `buyer-learn.test.ts` | تشغيل `032` |
| 3 | `impl/m3-dream-chat` | `033_dream.sql`، `src/modules/dream/{dream,prompt,routes}.ts`، `TAB_DEFAULT.dream` في `src/lib/llm.ts`، `src/modules/dream/Page.astro`، `public/modules/dream/client.js` | `dream.test.ts` | تشغيل `033` |
| 4 | `impl/m4-dream-media` | `src/modules/dream/media.ts` (الصور عبر OpenRouter، خطة الموشن من `design/motion.ts`، الصوت عبر Gemini TTS) | `dream-media.test.ts` | `GEMINI_API_KEY` |
| 5-6 | `impl/m5-ad-writes` | `034_ad_writes.sql`، `src/lib/ads-write/{guard,idempotency,meta}.ts`، `dream` `publish`/`activate` | `ads-write.test.ts` (عدم التكرار، الحدود، زر الطوارئ، mock لـ Graph) | توكن Meta بصلاحية `ads_management` |
| 7-8 | `impl/m7-social` | `035_social_more.sql`، `overrides` و `slots` في السوشال، عرض تقويم، صحة الحسابات بمهلة ساعة، زر «حوّلها لفكرة» في الرصد | توسيع `social.test.ts`، `health-grace.test.ts` | تشغيل `035` |
| 9 | لاحقاً | نقل باقي `app.css` إلى Tailwind | | قرار جعل المستودع خاصاً |

ملاحظة: أرقام الـ migrations هنا هي المعتمدة، وتختلف عن أرقام الـ PRD (§3) لأنها تتبع ترتيب التنفيذ.

## التقدم
| # | PR | الحالة |
|---|---|---|
| 0 | #39 | جاهز، ينتظر «ادمج» |
| 1 | #40 | جاهز، ينتظر «ادمج» (يرجّع اختبارات smoke خضراء، فيرجع نشر staging يشتغل) |
| 2 | #41 | جاهز، ينتظر «ادمج»، ثم تشغيل `031` و `032` |
| 3 | (هذا الفرع) | جاهز، ينتظر «ادمج»، ثم تشغيل `033` |
