// Source sheet gate for attention content (trends), ported from HOV-6 check-source.py. It rejects a missing, stale,
// repeated or unsafe reference. It checks the sheet, not the post: a person still verifies the original post, its
// content and its date before production.
// Today in Riyadh time (UTC+3)
const dayOf = (now = Date.now()): string => new Date(now + 3 * 3600e3).toISOString().slice(0, 10);

export const SAFE = 'آمن تجاريا';
export interface Check { ok: boolean; decision: 'pass' | 'needs_approval' | 'reject'; errors: string[]; note: string }

const NOTE = 'الحقول مكتملة؛ يلزم تحقق بشري من أصل المنشور والمحتوى والتاريخ قبل الإنتاج. فحص الرابط النصي لا يثبت المصدر.';
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const isoDay = (v: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(v + 'T00:00:00Z');
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v ? null : t / 864e5;
};
const norm = (u: string): string => u.trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

export function checkSource(input: unknown, today = dayOf()): Check {
  const p = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const t = (p.trend && typeof p.trend === 'object' ? p.trend : {}) as Record<string, unknown>;
  const errors: string[] = [];
  for (const [k, label] of [['referenceUrl', 'رابط المرجع'], ['takenSpecifically', 'وش أخذنا تحديداً'], ['hovenConnection', 'الربط بهوڤن'], ['classification', 'التصنيف']] as const)
    if (!text(p[k])) errors.push(`حقل فاضي: ${label}`);
  if (!Array.isArray(p.previousBatchReferences)) errors.push('حقول ناقصة: مراجع الدفعات السابقة');
  for (const [k, label] of [['name', 'اسم الترند'], ['startedAt', 'بداية الترند'], ['referenceDate', 'تاريخ المرجع']] as const)
    if (!text(t[k])) errors.push(`بيانات الترند ناقصة: ${label}`);

  const start = isoDay(text(t.startedAt)), ref = isoDay(text(t.referenceDate)), now = isoDay(today)!;
  if (text(t.startedAt) && start === null) errors.push('بداية الترند: التاريخ بصيغة YYYY-MM-DD');
  if (text(t.referenceDate) && ref === null) errors.push('تاريخ المرجع: التاريخ بصيغة YYYY-MM-DD');
  if (start !== null && ref !== null && start > ref) errors.push('بداية الترند بعد تاريخ المرجع');
  if (ref !== null && (now - ref < 0 || now - ref > 14)) errors.push('المرجع خارج 14 يوم');

  const url = text(p.referenceUrl);
  let direct = false;
  try { const u = new URL(url); direct = u.protocol === 'https:' && !!u.hostname; } catch { /* not a link */ }
  if (url && !direct) errors.push('ليس رابطاً مباشراً صالحاً (https)');
  if (direct && Array.isArray(p.previousBatchReferences) && p.previousBatchReferences.some(r => typeof r === 'string' && norm(r) === norm(url))) errors.push('المرجع مكرر من دفعة سابقة');

  const cls = text(p.classification);
  if (cls && cls !== SAFE) errors.push(cls.startsWith('حساس') ? 'حساس: ما يمر بدون موافقة لين على النص والتصميم' : cls.startsWith('ممنوع') || cls.includes('لا نقترب') ? 'ممنوع: ما نقترب من الموضوع' : 'التصنيف لازم يكون «آمن تجاريا» للإنتاج العادي');
  const decision = !errors.length ? 'pass' : cls.startsWith('حساس') && errors.length === 1 ? 'needs_approval' : 'reject';
  return { ok: !errors.length, decision, errors, note: errors.length ? 'رفض. الرفض نتيجة مكتملة، ما نستكمل الورقة بعد الإنتاج.' : NOTE };
}
