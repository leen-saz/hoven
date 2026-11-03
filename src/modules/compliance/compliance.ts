// Compliance (الامتثال): the one list of Saudi e-commerce and consumer-protection rules for every tab (social, campaigns, content, design,
// voice, journeys, copy). A notice only: it never blocks (Leen's rule). Each hit names the exact phrase and where it
// sits in the text, the rule, its source, and what to write instead. The company adds its own forbidden words in المعرفة.

export type Level = 'critical' | 'warn' | 'info';
export interface Source { name: string; ref: string; url?: string }
export interface Rule { id: string; level: Level; title: string; why: string; fix: string; safe?: string; source: Source[]; re: RegExp[] }
export interface Hit { rule: string; level: Level; title: string; why: string; fix: string; safe?: string; match: string; start: number; end: number; source: Source[] }

// Sources for a Saudi online store (Hoven): e-commerce law, consumer protection, the commercial-discount rules, platform policies.
const ECOM: Source = { name: 'نظام التجارة الإلكترونية', ref: 'الإفصاح عن السعر الإجمالي والشروط، ومنع الإعلان المضلل', url: 'https://mc.gov.sa' };
const DISC: Source = { name: 'لائحة التخفيضات التجارية (وزارة التجارة)', ref: 'السعر قبل وبعد الخصم، ومدة العرض، وترخيص التخفيض' };
const CONS: Source = { name: 'حماية المستهلك (وزارة التجارة)', ref: 'كل ادعاء عن المنتج لازم يكون صحيح ويقدر المتجر يثبته' };
const META: Source = { name: 'سياسة ميتا للإعلانات', ref: 'منع الادعاءات المضللة والتسعير غير الواضح', url: 'https://transparency.meta.com/policies/ad-standards/' };
const COMPANY: Source = { name: 'معرفة الشركة', ref: 'الكلمات الممنوعة في تاب المعرفة' };

// Arabic spelling varies: patterns and text are compared with diacritics and tatweel removed, أ/إ/آ = ا, ى = ي, ة = ه.
// One character in = one character out (except the removed ones), so positions map back to the original text.
const MARKS = /[ً-ْٰـ]/;
const fold = (c: string) => (c === 'أ' || c === 'إ' || c === 'آ' ? 'ا' : c === 'ى' ? 'ي' : c === 'ة' ? 'ه' : c === '٪' ? '%' : c);
export function normalize(text: string): { t: string; at: number[] } {
  let t = '';
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (MARKS.test(c)) continue;
    t += fold(c).toLowerCase();
    at.push(i);
  }
  at.push(text.length);
  return { t, at };
}
const R = (src: string, flags = 'i') => new RegExp([...src].map(fold).join(''), flags);
// Arabic has no \b: a word starts after a non-letter
const W = '(?:^|[^\\p{L}])';

export const RULES: Rule[] = [
  { id: 'discount', level: 'critical', title: 'خصم بدون السعر قبل الخصم أو مدة العرض',
    why: 'التخفيض لازم يوضح السعر قبل وبعد ومدة العرض، والخصم الوهمي مخالفة.',
    fix: 'اكتب: "كان 299 ر.س، الحين 199 ر.س، لين نهاية الشهر".', safe: 'كان 299 ر.س، الحين 199 ر.س لين نهاية الشهر',
    source: [DISC, ECOM], re: [R('(خصم|تخفيض|تخفيضات|عرض خاص|تنزيلات|\\d+\\s?%\\s?off|discount|sale\\b)')] },
  { id: 'price', level: 'info', title: 'سعر بدون توضيح الإجمالي',
    why: 'السعر المعلن لازم يكون الإجمالي شامل الضريبة، أو يوضح إن الشحن عليه.',
    fix: 'اكتب "شامل الضريبة" أو وضّح رسوم الشحن.', safe: '199 ر.س شامل الضريبة',
    source: [ECOM], re: [R('\\d+\\s?(ر\\.?س|ريال|sar)')] },
  { id: 'free', level: 'warn', title: '"مجاني" بدون شروط',
    why: 'كلمة مجاني لازم تكون صحيحة أو الشرط مكتوب جنبها.',
    fix: 'اكتب الشرط: "شحن مجاني للطلبات فوق 200 ر.س".', safe: 'شحن مجاني للطلبات فوق 200 ر.س',
    source: [ECOM, META], re: [R(`${W}(مجان[يا]|ببلاش|free\\b)`, 'iu')] },
  { id: 'guarantee', level: 'warn', title: 'ضمان بدون مدة أو شروط',
    why: 'الضمان لازم تكون مدته وشروطه واضحة ومكتوبة في المتجر.',
    fix: 'اكتب المدة والشروط: "ضمان سنة ضد عيوب الصناعة".', safe: 'ضمان سنة ضد عيوب الصناعة',
    source: [CONS], re: [R('مضمون[هة]?|نضمن لك|ضمان|guarantee[ds]?')] },
  { id: 'superlative', level: 'warn', title: 'تفضيل مطلق بدون دليل',
    why: '"الأفضل" و"الأرخص" و"رقم 1" تحتاج دليل موثق، وإلا تعتبر تضليل للمستهلك.',
    fix: 'اكتب ميزة محددة تقدر تثبتها: "قطن 100% بكثافة 400 خيط".', safe: 'قطن 100% بكثافة 400 خيط',
    source: [CONS, META],
    re: [R(`${W}(الافضل|الارخص|الوحيد|الاقوى|الاجود)`, 'iu'), R(`(الاول|رقم\\s?(1|١|واحد)) (في|ب)|${W}#\\s?1|لا مثيل|ما له مثيل|\\bbest\\b|cheapest|number one`, 'iu')] },
  { id: 'original', level: 'warn', title: '"أصلي" أو "وكيل" بدون إثبات',
    why: 'ادعاء الأصالة أو الوكالة لازم يكون صحيح ويقدر المتجر يثبته.',
    fix: 'اذكر المصدر أو الوكالة إذا موجودة، أو احذف الادعاء.', source: [CONS],
    re: [R('اصلي 100|وكيل (معتمد|حصري)|original 100')] },
  { id: 'material', level: 'info', title: 'ادعاء عن الخامة',
    why: 'نسبة القطن أو الحرير أو الكثافة لازم تطابق بطاقة المنتج.',
    fix: 'تأكد إن الرقم نفسه مكتوب في صفحة المنتج.', source: [CONS],
    re: [R('(قطن|حرير|كتان|ساتان)\\s?(100|١٠٠)|\\d+\\s?(خيط|thread)')] },
  { id: 'scarcity', level: 'info', title: 'استعجال أو ندرة',
    why: '"آخر قطعة" أو "الكمية محدودة" لازم تكون صحيحة وقت الإعلان.',
    fix: 'استخدمها بس إذا المخزون فعلاً قليل.', source: [CONS],
    re: [R('اخر (قطع[هة]|حب[هة])|الكمي[هة] محدود[هة]|ينتهي اليوم|limited stock|last (one|piece)')] },
  { id: 'returns', level: 'info', title: 'وعد بالاسترجاع',
    why: 'أي وعد بالاسترجاع أو الاستبدال لازم يطابق سياسة المتجر المكتوبة.',
    fix: 'اكتب نفس مدة الاسترجاع اللي في المتجر.', source: [ECOM], re: [R('استرجاع|استبدال|return|refund|money[- ]back')] },
];

const RANK: Record<Level, number> = { critical: 0, warn: 1, info: 2 };
const TERMS = R('(لين|حتى|ينتهي|لاول|لفتر[هة]|لمد[هة]|until|ends)');
const TOTAL = R('(شامل|يشمل|الاجمالي|اجمالي|بدون رسوم|مع الضريب[هة])');

// Company words (المعرفة → ممنوع): one phrase per line or between commas
export function companyRules(phrases: string[]): Rule[] {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...new Set(phrases.map(p => normalize(p.trim()).t).filter(p => p.length >= 2 && p.length <= 60))].map((p, i) => ({
    id: `company_${i + 1}`, level: 'critical' as const, title: 'كلمة ممنوعة عند الشركة', why: 'مكتوبة في الممنوع في تاب المعرفة.',
    fix: 'احذفها أو بدّلها بصياغة معتمدة.', source: [COMPANY], re: [new RegExp(esc(p), 'i')],
  }));
}

export function check(text: string, extra: Rule[] = []): Hit[] {
  const raw = String(text || '').slice(0, 20000);
  const { t, at } = normalize(raw);
  const out: Hit[] = [];
  for (const r of [...RULES, ...extra]) {
    if (r.id === 'price' && TOTAL.test(t)) continue;
    let m: RegExpExecArray | null = null;
    for (const re of r.re) { m = re.exec(t); if (m) break; }
    if (!m) continue;
    // Patterns that open with a "not a letter" guard: the phrase itself starts after it
    const lead = m[0].length - m[0].replace(/^[^\p{L}\d#]+/u, '').length;
    const s = m.index + lead, e = m.index + m[0].length;
    const start = at[s] ?? 0, end = at[e] ?? raw.length;
    const level: Level = r.id === 'discount' && TERMS.test(t) ? 'info' : r.level;
    out.push({ rule: r.id, level, title: r.title, why: r.why, fix: r.fix, ...(r.safe ? { safe: r.safe } : {}), match: raw.slice(start, end), start, end, source: r.source });
  }
  return out.sort((a, b) => RANK[a.level] - RANK[b.level] || a.start - b.start);
}

// One line per hit, for places that show plain text notices (social, journeys)
export const notice = (h: Hit): string =>
  `امتثال${h.level === 'critical' ? ' (مخالفة)' : h.level === 'warn' ? ' (انتبه)' : ''}: ${h.title} «${h.match}». ${h.fix} المصدر: ${h.source.map(s => `${s.name}، ${s.ref}`).join(' / ')}.`;
export const worst = (hits: Hit[]): Level | null => hits[0]?.level ?? null;

export interface AdText { ad_key: string; platform: string; name?: string | null; live?: boolean | null; text?: string | null }
export function scan(ads: AdText[], extra: Rule[] = []): { ads: (AdText & { hits: Hit[]; worst: Level | null })[]; summary: Record<string, number>; checked: number } {
  const seen = new Set<string>();
  const out: (AdText & { hits: Hit[]; worst: Level | null })[] = [];
  let checked = 0;
  for (const a of ads) {
    if (!a.text) continue;
    checked++;
    const key = `${a.platform}|${a.text.trim()}`; // the same copy on many ads is reported once
    if (seen.has(key)) continue;
    seen.add(key);
    const hits = check(a.text, extra);
    if (hits.length) out.push({ ...a, hits, worst: worst(hits) });
  }
  out.sort((x, y) => (RANK[x.worst || 'info'] ?? 3) - (RANK[y.worst || 'info'] ?? 3) || Number(!!y.live) - Number(!!x.live));
  const summary = { critical: 0, warn: 0, info: 0 } as Record<string, number>;
  for (const a of out) summary[a.worst || 'info'] = (summary[a.worst || 'info'] || 0) + 1;
  return { ads: out, summary, checked };
}

// The AI rewrite: what it is told to fix. The caller checks the answer again before showing it.
export function rewritePrompt(text: string, hits: Hit[]): string {
  return `أعد كتابة هذا النص الإعلاني لمتجر سعودي للمفارش والمنسوجات المنزلية بحيث يلتزم بنظام التجارة الإلكترونية وحماية المستهلك، وبنفس المعنى والطول تقريباً واللهجة.
صلّح هذي الملاحظات بالضبط:
${hits.map(h => `- «${h.match}»: ${h.title}. ${h.fix}`).join('\n')}
ممنوع: خصم بدون السعر قبل وبعد ومدته، "مجاني" بدون شرط، الأفضل/الأرخص/رقم 1 بدون دليل، أي سعر بدون الإجمالي.
رد بالنص الجديد بس، بدون شرح.

النص:
${text}`;
}
