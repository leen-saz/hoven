// HOV-6 pack (27 Oct 2026): the eight template types of hoven-studio as design templates, plus the dialect guide.
// Everything here is "for review": nothing in it is a final design until Leen approves it. Price, offer and
// testimonial text are always variables that come from approved facts, never from memory.
import { varsOf, type Template, type Field } from './library';

type Labels = Record<string, [string, string]>;
const SIZES = 'المقاسات: 1080×1080 · 1080×1350 · 1080×1920 (في 9:16 هوامش 210 بكسل فوق وتحت). للمراجعة، مو للنشر لين تعتمدها لين.';
const H = (name: string, description: string, body: string, labels: Labels): Template => ({
  name: `هوڤن · ${name}`, kind: 'design', category: 'HOV-6', description: `${description} ${SIZES}`, body, lang: 'ar', favorite: false,
  fields: varsOf(body).map((key): Field => ({ key, label: labels[key]?.[0] ?? key, hint: labels[key]?.[1] ?? '' })),
});

export const HOV6: Template[] = [
  H('بوست منتج', 'اسم ومقاس وخامة من مرجع سلة مؤرخ وصورة معتمدة.', '{{title}}\n{{sub}}\n{{detail}}',
    { title: ['اسم المنتج', ''], sub: ['الخامة والنوع', 'من سلة'], detail: ['المقاس', 'من سلة'] }),
  H('بطاقة سعر / عرض', 'السعر الحالي شامل الضريبة، والسابق المثبت لو فيه خصم. السعر التاريخي ما يدخل.', '{{title}}\n{{sub}}\n{{price}}',
    { title: ['اسم المنتج', ''], sub: ['تفاصيل العرض', 'المعتمدة'], price: ['السعر', 'الحالي شامل الضريبة، مع تاريخ البدء والانتهاء'] }),
  H('ستوري', 'تفصيل واحد من بيانات المنتج.', '{{title}}\n{{sub}}\n{{cta}}',
    { title: ['اسم المنتج', ''], sub: ['تفصيل واحد', 'مثبت من بيانات المنتج'], cta: ['الدعوة', 'وجهة معتمدة'] }),
  H('إعلان', 'بريف Media Buyer، وحقيقة منتج مثبتة، وبدون وعد أداء.', '{{title}}\n{{sub}}\n{{cta}}',
    { title: ['عنوان البريف', 'المعتمد'], sub: ['ميزة واحدة', 'مثبتة'], cta: ['الدعوة', 'وجهة معتمدة'] }),
  H('قبل / بعد', 'صورتان حقيقيتان لنفس الغرفة بنفس الزاوية والإضاءة. بدون أثر صحي مختلق.', '{{title}}\n{{sub}}',
    { title: ['وش تغيّر في الغرفة', ''], sub: ['وصف الصورتين', 'حقيقيتين'] }),
  H('شهادة عميل', 'النص الحرفي مع رابط التقييم وتاريخه وإذن الاستخدام. بدون نجوم أو أسماء مختلقة.', '{{quote}}\n{{who}}',
    { quote: ['نص الشهادة', 'حرفي بعد التحقق والإذن'], who: ['اسم العميل وتاريخ التقييم', ''] }),
  H('مقدمة مقطع', 'لوحة ثابتة جاهزة للتركيب، مو فيديو.', '{{series}}\n{{episode}}',
    { series: ['اسم السلسلة', ''], episode: ['عنوان الحلقة', ''] }),
  H('خاتمة مقطع', 'لوحة ثابتة جاهزة للتركيب، مو فيديو.', '{{line}}\n{{site}}',
    { line: ['السطر الختامي', ''], site: ['الموقع', 'hoven.sa'] }),
];

// The dialect guide as a draft document (not a final rule until approved). The week's research notes and the live
// batch example are left out: they carry dates and links of their own.
export const VOICE_DOC = {
  title: 'دليل لهجة هوڤن (مسودة للمراجعة)',
  kind: 'copy' as const,
  source: 'hov6',
  body: `النبرة
سعودية بسيطة ودافية، قليلة الكلام، تحترم العميل. الفخامة في الصورة والمساحة والوضوح. نخاطب الجمهور بصيغ عامة؛ المؤنث حين يطلبه البريف.

المفردات
نستخدم: سريرك، غرفتك، مفرشك، يناسبك، خذ وقتك، خلّها على ذوقك. لا نحشر «وش» و«مرّة» في كل نص ولا نقلّد لهجة منطقة كاملة.
عنوان واحد، ومعلومة واحدة، وطلب واحد إن احتاجت القطعة. الكابشن جملة أو جملتان عادة؛ الإيموجي اختياري، والهاشتاقات ذات صلة فقط.

ما نمنعه
لا «أفضل نوم مضمون»، لا علاج ألم أو أرق، لا «الأكثر مبيعا» بلا فترة ومصدر، لا خصم أو سعر أو مخزون من الذاكرة. لا تخويف، لا عيب على بيت العميل، لا شهادة مختلقة، ولا استخدام غموض وطني لجذب التفاعل.

أمثلة تحريرية من إعداد الاستوديو، وليست بوستات ناجحة موثقة
- قبل: ارتقِ بتجربة نومك الفاخرة. بعد: لباد سرير من هوڤن.
- قبل: اغتنمي الخصم الخرافي قبل النفاد. بعد: اسم المنتج والسعر المعتمد ومدة العرض فقط.
- قبل: وداعا لآلام الظهر. بعد: احذف الادعاء الطبي؛ اعرض المقاس والخامة المثبتين.`,
};
