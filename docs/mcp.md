# MCP هوفن

خادم MCP خاص بهوفن داخل هذا المستودع (`src/mcp/`)، وهو طبقة التنفيذ الوحيدة على المنصات (`docs/PRD.md` §3.10). وكلاء هوفن يستدعونه داخلياً (`callTool`)، و Claude يستدعيه من برا بنفس الأدوات ونفس الحدود.

## الربط مع Claude
1. صفحة الربط ← «MCP هوفن» ← انسخ الرابط (`https://<هوفن>/mcp`).
2. في Claude: Settings ← Connectors ← Add custom connector ← الصق الرابط.
3. يفتح لك هوفن: سجّل دخولك (المالكة بس)، واختر «قراءة وكتابة» أو «قراءة بس»، واضغط «اسمح».
4. الفصل: صفحة الربط ← «التطبيقات المربوطة» ← «افصل». يوقف كل توكنات التطبيق فوراً.

## التقنية
- Streamable HTTP على `POST /mcp` (JSON-RPC 2.0، رد JSON بدون stream). البروتوكول `2025-06-18`.
- OAuth 2.1 + PKCE (S256): `/.well-known/oauth-protected-resource`، و`/.well-known/oauth-authorization-server`، و`/oauth/register` (تسجيل تلقائي)، و`/oauth/authorize`، و`/oauth/token`، و`/oauth/revoke`.
- توكن الدخول ساعة، والتجديد ٣٠ يوم ويتبدّل مع كل استخدام. كلها محفوظة كـ SHA-256 (`036_mcp.sql`).
- النطاقات: `read` و`read_write`. أداة الكتابة ترفض نطاق `read`.
- أي أداة تصرف فلوس تحتاج `idempotency_key`: نفس المفتاح خلال ٢٤ ساعة يرجع نفس الجواب.

## الأدوات
| الأداة | كتابة | تصرف |
|---|---|---|
| `ads.list_campaigns` | لا | لا |
| `ads.get_campaign` | لا | لا |
| `ads.create_campaign` (موقوفة دائماً) | نعم | نعم |
| `ads.set_status` | نعم | نعم |
| `ads.set_budget` (٢٠٪ في اليوم بالكثير) | نعم | نعم |
| `connections.list` | لا | لا |
| `connections.permissions` | لا | لا |
| `social.publish` (منشور معتمد وحان وقته) | نعم | لا |
| `social.get_post` | لا | لا |
| `inbox.sync` (يسحب التعليقات والرسائل وقروك يكتب الردود، ما يرسل شي) | نعم | لا |
| `inbox.list` | لا | لا |
| `inbox.reply` (بموافقة لين أو المعتمد، والرسالة الخاصة خلال ٢٤ ساعة) | نعم | لا |
| `inbox.ignore` | نعم | لا |
| `events.list` | لا | لا |
| `jobs.get` | لا | لا |

الحدود داخل الأدوات نفسها: موافقة المالكة، والحملات الجديدة موقوفة، والحملات المُدارة بس، وزر الطوارئ. كل كتابة تنكتب في `ad_changes` (قبل وبعد) وفي `audit_log`.

## إضافة منصة
Adapter جديد في `src/mcp/adapters/<platform>.ts`، وأدواته في `src/mcp/tools/`. اختبار `tests/unit/mcp.test.ts` يمنع أي عنوان API لمنصة خارج مجلد الـ adapters.

## ردود قروك على التواصل الاجتماعي
- كل ربع ساعة (`inbox.sync`): تعليقات آخر ١٠ منشورات في فيسبوك وانستقرام، وآخر الرسائل الخاصة (Messenger و Instagram Direct).
- قروك عبر OpenRouter (`TAB_DEFAULT.social = x-ai/grok-4.7`، ويتغيّر بـ `OPENROUTER_MODEL_SOCIAL`) يصنّف ويكتب رد من «المعرفة».
- الشكاوى والاسترجاع والسلبي: بدون رد، وتطلع لين «يحتاجك» مع حدث. الدعاية: تتجاهل.
- ما ينرسل شي إلا بـ «أرسل» من لين أو المعتمد (تبويب التواصل الاجتماعي ← «الردود»).
- الرسائل الخاصة تنمسح بعد ٩٠ يوم (PDPL). ميتا تسمح بالرد على رسالة خاصة خلال ٢٤ ساعة بس.
- صلاحيات ميتا المطلوبة: `pages_read_engagement`، و`pages_manage_engagement`، و`pages_messaging`، و`instagram_manage_comments`، و`instagram_manage_messages`.
