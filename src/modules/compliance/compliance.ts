// Compliance (الامتثال) for Hoven, a Saudi online home-goods store: checks ad copy against the e-commerce and
// consumer-protection rules (Ministry of Commerce, e-commerce law, Saudi Advertising Code principles) and the
// platforms' ad policies. A notice only: it never blocks publishing. Rules are plain data, easy to extend.

export type Level = 'critical' | 'warn' | 'info';
export interface Rule { id: string; level: Level; title: string; why: string; fix: string; re: RegExp }
export interface Hit { rule: string; level: Level; title: string; why: string; fix: string; match: string }

// Arabic letters vary (ة/ه, أ/ا, ى/ي): patterns allow both where it matters.
export const RULES: Rule[] = [
  { id: 'fake_discount', level: 'critical', title: 'خصم بدون السعر قبل الخصم',
    why: 'نظام التجارة الإلكترونية يطلب السعر قبل وبعد الخصم ومدة العرض، والخصم الوهمي مخالفة.',
    fix: 'اكتب "كان 299 ر.س، الحين 199 ر.س، لين نهاية الشهر".', re: /(خصم|تخفيض|تخفيضات|عرض خاص|\d+\s?%\s?off|discount|sale)/i },
  { id: 'free', level: 'warn', title: '"مجاني" بدون شروط',
    why: 'كلمة مجاني لازم تكون مجانية فعلاً أو الشرط واضح جنبها (مثل حد أدنى للطلب).',
    fix: 'اكتب الشرط: "شحن مجاني للطلبات فوق 200 ر.س".', re: /(مجان[يا]|ببلاش|free\b)/i },
  { id: 'guarantee', level: 'warn', title: 'ضمان بدون تفاصيل',
    why: 'الضمان لازم تكون مدته وشروطه واضحة ومكتوبة في المتجر.',
    fix: 'اكتب المدة والشروط: "ضمان سنة ضد عيوب الصناعة".', re: /(مضمون[هة]?|ضمان|guarantee[ds]?)/i },
  { id: 'superlative', level: 'warn', title: 'تفضيل مطلق بدون دليل',
    why: 'عبارات مثل "الأفضل" أو "الأرخص" أو "رقم 1" تحتاج دليل موثق، وإلا تعتبر تضليل للمستهلك.',
    fix: 'اكتب ميزة محددة: "قطن 100% بكثافة 400 خيط".', re: /(الأفضل|الأرخص|الأول في|رقم\s?(1|١|واحد)|أقوى|\bbest\b|cheapest|#\s?1\b|number one)/i },
  { id: 'original', level: 'warn', title: '"أصلي" أو "ماركة" بدون إثبات',
    why: 'ادعاء الأصالة أو الوكالة لازم يكون صحيح ويقدر المتجر يثبته.',
    fix: 'اذكر المصدر أو الوكالة إذا موجودة، أو احذف الادعاء.', re: /(أصلي 100|اصلي 100|وكيل معتمد|original 100)/i },
  { id: 'scarcity', level: 'info', title: 'استعجال أو ندرة',
    why: '"آخر قطعة" أو "الكمية محدودة" لازم تكون صحيحة وقت الإعلان.',
    fix: 'استخدمها بس إذا المخزون فعلاً قليل.', re: /(آخر (قطع[هة]|حب[هة])|الكمي[هة] محدود[هة]|ينتهي اليوم|limited stock|last (one|piece))/i },
  { id: 'returns', level: 'info', title: 'سياسة الاسترجاع',
    why: 'نظام حماية المستهلك يعطي حق الاسترجاع، وأي وعد بالاسترجاع لازم يطابق سياسة المتجر.',
    fix: 'اكتب نفس مدة الاسترجاع اللي في المتجر.', re: /(استرجاع|استبدال|return|refund|money[- ]back)/i },
];

const SHOUT = /[!؟?]{3,}/;

export function check(text: string): Hit[] {
  // Diacritics and tatweel do not change the meaning: "علاجاً نهائياً" reads as "علاجا نهائيا"
  const t = String(text || '').slice(0, 5000).replace(/[\u064B-\u0652\u0640]/g, '');
  const out: Hit[] = [];
  for (const r of RULES) {
    if (r.id === 'fake_discount' && /(كان|بدل|السعر الأصلي|قبل الخصم|was)/i.test(t) && /(لين|حتى|ينتهي|لفترة|until|ends)/i.test(t)) continue; // price and dates already given
    const m = t.match(r.re);
    if (m) out.push({ rule: r.id, level: r.level, title: r.title, why: r.why, fix: r.fix, match: m[0] });
  }
  if (SHOUT.test(t)) out.push({ rule: 'shout', level: 'info', title: 'علامات تعجب كثيرة', why: 'المنصات تقلل وصول النصوص المبالغ فيها.', fix: 'علامة وحدة تكفي.', match: (t.match(SHOUT) || [''])[0] });
  const rank: Record<Level, number> = { critical: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

export interface AdText { ad_key: string; platform: string; name?: string | null; live?: boolean | null; text?: string | null }
export function scan(ads: AdText[]): { ads: (AdText & { hits: Hit[]; worst: Level | null })[]; summary: Record<string, number>; checked: number } {
  const seen = new Set<string>();
  const out: (AdText & { hits: Hit[]; worst: Level | null })[] = [];
  let checked = 0;
  for (const a of ads) {
    const text = `${a.name || ''}\n${a.text || ''}`.trim();
    if (!a.text) continue;
    checked++;
    const key = `${a.platform}|${(a.text || '').trim()}`; // the same copy on many ads is reported once
    if (seen.has(key)) continue;
    seen.add(key);
    const hits = check(text);
    if (hits.length) out.push({ ...a, hits, worst: hits[0]?.level ?? null });
  }
  const rank: Record<string, number> = { critical: 0, warn: 1, info: 2 };
  out.sort((x, y) => (rank[x.worst || 'info'] ?? 3) - (rank[y.worst || 'info'] ?? 3) || Number(!!y.live) - Number(!!x.live));
  const summary = { critical: 0, warn: 0, info: 0 } as Record<string, number>;
  for (const a of out) summary[a.worst || 'info'] = (summary[a.worst || 'info'] || 0) + 1;
  return { ads: out, summary, checked };
}
