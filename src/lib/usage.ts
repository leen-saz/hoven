// Usage metering and monthly quotas per company. A unit with no quota row is unlimited. Everything here fails open:
// when migration 024 is not applied or Supabase hiccups, the feature being metered keeps working.
import { sb, json, type Cfg } from './auth';
import { scoped } from './tenant';

export const UNITS = { text: 'نصوص بالذكاء الاصطناعي', voice_sec: 'ثواني صوت', image: 'صور' } as const;
export type Unit = keyof typeof UNITS;
export const isUnit = (u: unknown): u is Unit => typeof u === 'string' && u in UNITS;
type Who = { co: string };

// Months and days follow Riyadh time (UTC+3), like the log range
export const dayOf = (now = Date.now()): string => new Date(now + 3 * 3600e3).toISOString().slice(0, 10);
export const monthStart = (now = Date.now()): string => dayOf(now).slice(0, 8) + '01';

type Row = { module: string; unit: string; qty: number };
const rows = <T>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);

export async function used(cfg: Cfg, co: string, now = Date.now()): Promise<Row[]> {
  const r = await sb<Row[]>(cfg, scoped(`/rest/v1/usage_daily?select=module,unit,qty&day=gte.${monthStart(now)}&limit=5000`, co), { admin: true });
  return rows<Row>(r.data).map(x => ({ ...x, qty: Number(x.qty) || 0 }));
}
export async function limits(cfg: Cfg, co: string): Promise<Partial<Record<Unit, number>>> {
  const r = await sb<{ unit: string; monthly_limit: number }[]>(cfg, scoped('/rest/v1/usage_quotas?select=unit,monthly_limit', co), { admin: true });
  return Object.fromEntries(rows<{ unit: string; monthly_limit: number }>(r.data).filter(x => isUnit(x.unit)).map(x => [x.unit, Number(x.monthly_limit)]));
}

// Refuses (429) when this use would pass the unit's monthly quota; null = go ahead
export async function guard(cfg: Cfg, user: Who, unit: Unit, qty = 1): Promise<Response | null> {
  try {
    const lim = (await limits(cfg, user.co))[unit];
    if (lim === undefined) return null;
    const total = (await used(cfg, user.co)).filter(x => x.unit === unit).reduce((a, x) => a + x.qty, 0);
    return total + qty > lim ? json(429, { error: `وصلت حد الاستخدام الشهري (${UNITS[unit]}: ${total} من ${lim}). تواصل مع مالكة الحساب.` }) : null;
  } catch { return null; }
}

export async function meter(cfg: Cfg, user: Who, module: string, unit: Unit, qty = 1): Promise<void> {
  if (!(qty > 0)) return;
  await sb(cfg, '/rest/v1/rpc/usage_add', { method: 'POST', admin: true, body: { p_company: user.co, p_day: dayOf(), p_module: module, p_unit: unit, p_qty: Math.ceil(qty) } }).catch(() => {});
}

export async function summary(cfg: Cfg, co: string) {
  const [u, l] = await Promise.all([used(cfg, co), limits(cfg, co)]);
  return {
    month: monthStart(),
    units: (Object.keys(UNITS) as Unit[]).map(unit => {
      const mine = u.filter(x => x.unit === unit);
      return { unit, label: UNITS[unit], used: mine.reduce((a, x) => a + x.qty, 0), limit: l[unit] ?? null, byModule: Object.fromEntries(mine.map(x => [x.module, x.qty])) };
    }),
  };
}

// { text: 500, voice_sec: null } -> known units only; null or '' removes the quota
export function cleanQuotas(body: Record<string, unknown>): { set: Record<string, number>; clear: Unit[] } | { error: string } {
  const set: Record<string, number> = {}, clear: Unit[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (!isUnit(k)) continue;
    if (v === null || v === '') { clear.push(k); continue; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100_000_000) return { error: `رقم غير صحيح: ${UNITS[k]}` };
    set[k] = n;
  }
  return { set, clear };
}
