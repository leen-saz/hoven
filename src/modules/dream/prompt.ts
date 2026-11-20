// What ChatGPT reads in «احلم»: the store's numbers and lessons, Leen's goals, the knowledge, then the conversation.
// The chat asks and suggests; each part is then written as one JSON object (dream.ts cleans it).
import { FAM_AR, type Fam, type Goals, type Summary } from '../buyer/engine';
import { PART_AR, type Part } from './dream';

export interface Context { summary: Summary | null; goals: Goals; lessons: string[]; knowledge: string; platforms: Fam[] }

const n = (x: number | null | undefined) => (x == null ? '—' : String(Math.round(x * 100) / 100));

function facts(c: Context): string {
  const out: string[] = [];
  const s = c.summary;
  if (s) {
    out.push(`## أرقام المتجر (آخر ٣٠ يوم كاملة ${s.from} إلى ${s.to})`,
      `- مبيعات سلة ${n(s.store.sales)} ر.س، طلبات ${n(s.store.orders)}، صرف الإعلانات ${n(s.store.spend)} ر.س، العائد ${n(s.store.roas)}×`);
    for (const x of s.campaigns.slice(0, 12)) out.push(`- [${FAM_AR[x.fam]}] ${x.campaign}: صرف ${n(x.now.spend)}، طلبات ${n(x.now.purchases)}، تكلفة الطلب ${n(x.now.cpa)}، نسبة النقر ${n(x.now.ctr)}٪`);
  }
  const g = Object.entries(c.goals).map(([f, v]) => `- ${FAM_AR[f as Fam]}: تكلفة طلب مستهدفة ${n(v.targetCpa)}، عائد مستهدف ${n(v.targetRoas)}×، ميزانية يومية ${n(v.dailyBudget)} ر.س`);
  if (g.length) out.push('## أهداف لين لكل منصة', ...g);
  if (c.lessons.length) out.push('## دروس معتمدة من الإعلانات (التزم فيها)', ...c.lessons.slice(0, 20).map(l => `- ${l}`));
  if (c.knowledge) out.push(c.knowledge);
  return out.join('\n');
}

export function chatSystem(c: Context): string {
  return [
    'أنت شريك تفكير لحملات متجر هوفن (مفارش ومنسوجات منزلية، السعودية) في صفحة «احلم». تكلم بلهجة سعودية بيضاء، مختصر ودافئ.',
    'لين تكتب فكرة حملة، وأنت تساعدها تنضجها: اسأل سؤال أو سؤالين بالكثير في كل رد (الهدف، المنتج، الفترة، الميزانية التقريبية، المنصات)، واقترح زوايا مبنية على أرقام المتجر ودروسه.',
    'لا تكتب الاستراتيجية ولا النصوص كاملة في المحادثة: لما تكون الفكرة واضحة قل لها تضغط «جهّز الحملة»، وتطلع الأجزاء كل واحد لحاله.',
    'النتيجة اللي نحكم فيها = طلبات الشراء في سلة. لا تعد بأرقام ما تقدر تضمنها، ولا تقترح ادعاءات ممنوعة (الأرخص، الأفضل بدون دليل، خصم وهمي).',
    c.platforms.length ? `المنصات المختارة: ${c.platforms.map(f => FAM_AR[f]).join('، ')}.` : '',
    facts(c),
  ].filter(Boolean).join('\n\n');
}

// One JSON shape per text part. Keys in English (the code reads them), values in Saudi Arabic.
const SHAPES: Partial<Record<Part, string>> = {
  strategy: '{"goal":"هدف الحملة بجملة","message":"الرسالة الأساسية","offer":"العرض إن وجد","kpi":"المؤشر اللي نحكم فيه","phases":[{"name":"اسم المرحلة","days":7,"focus":"وش نسوي فيها"}]}',
  audience: '{"segments":[{"platform":"meta|snap|tiktok|google","name":"اسم الشريحة","age":"25-44","gender":"الكل|نساء|رجال","regions":["الرياض"],"interests":["ديكور المنزل"],"notes":"ليش هالشريحة"}]}',
  budget: '{"days":14,"split":[{"platform":"meta|snap|tiktok|google","daily":300}],"learning":"كم يوم تعلّم تحتاج المنصات وكيف نوزع"}',
  copy: '{"items":[{"platform":"meta|snap|tiktok|google","format":"صورة مربعة|ستوري|فيديو|بحث","headline":"عنوان قصير","body":"النص","cta":"اطلب الحين"}]}',
};

export function partPrompt(kind: Part, c: Context, conversation: string, approved: Partial<Record<Part, unknown>>, instruction = ''): string {
  const before = Object.entries(approved).map(([k, v]) => `## ${PART_AR[k as Part]} (معتمد)\n${JSON.stringify(v)}`).join('\n\n');
  return [
    `اكتب جزء «${PART_AR[kind]}» لحملة هوفن من المحادثة اللي تحت.`,
    c.platforms.length ? `المنصات: ${c.platforms.join(', ')} فقط.` : 'اختر المنصات المناسبة من: meta, snap, tiktok, google.',
    kind === 'budget' ? 'الميزانية بالريال السعودي. لا تتعدى الميزانية اليومية في أهداف لين لكل منصة إن وجدت.' : '',
    kind === 'copy' ? 'نصوص بلهجة سعودية بيضاء، جمل قصيرة، فائدة قبل الميزة، ودعوة واضحة. بدون ادعاءات ممنوعة. نص لكل منصة وصيغة.' : '',
    instruction ? `تعديل لين على النسخة السابقة: ${instruction}` : '',
    `رد بكائن JSON واحد فقط بهالشكل بالضبط، بدون أي نص قبله أو بعده:\n${SHAPES[kind]}`,
    before,
    `## المحادثة\n${conversation}`,
    facts(c),
  ].filter(Boolean).join('\n\n');
}
