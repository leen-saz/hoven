// The media buyer's learning loop (docs/PRD.md §3.3). Each proposal Leen approved is measured 3 and 7 days after the
// decision against the 7 days before it, and written once to `outcomes`. When the 7-day result lands, a lesson is written
// (module buyer, status new, source outcome) for Leen to approve; approved lessons go into the next prompt (prompt.ts).
// Runs on a schedule (src/app.ts, the 4-hourly cron) so learning does not wait for someone to open the page; the page
// still runs it on load, and the unique (suggestion_id, day) keeps every window measured once.
import { sb, type Cfg } from '../../lib/auth';
import { scoped, HOVEN_COMPANY } from '../../lib/tenant';
import { readAll } from '../../lib/paging';
import { outcome, addDays, famOf, FAM_AR, type AdRow, type MetricRow, type SaleRow, type Kind, type Result, type Fam } from './engine';
import { KIND_AR, type PastRec } from './prompt';

type Row = Record<string, unknown>;
const rows = <T = Row>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);
export const today = () => new Date().toISOString().slice(0, 10);

export interface Data { ads: AdRow[]; metrics: MetricRow[]; sales: SaleRow[]; ok: boolean }
export interface Window { spend: number; purchases: number; cpa: number | null; ctr: number | null }

// 14 complete days of ads and metrics (this week and the one before) plus Salla's days; 7 more for the outcome window
export async function numbers(cfg: Cfg, co: string, back = 21, day = today()): Promise<Data> {
  const since = addDays(day, -back);
  const [a, m, s] = await Promise.all([
    readAll<AdRow>(cfg, scoped('/rest/v1/ads?select=ad_key,campaign,live', co), 'ad_key.asc', 10),
    readAll<MetricRow>(cfg, `/rest/v1/ad_metrics?select=ad_key,day,spend,impressions,clicks,leads,ads!inner(company_id)&ads.company_id=eq.${co}&day=gte.${since}`, 'ad_key.asc,day.asc', 40),
    sb(cfg, scoped(`/rest/v1/salla_orders_daily?select=day,net_sales_sar,orders&day=gte.${since}&limit=100`, co), { admin: true }),
  ]);
  return { ads: a.rows, metrics: m.rows, sales: rows<SaleRow>(s.data), ok: a.ok && m.ok };
}

// One campaign's totals over [from, to] (purchases are `leads` in ad_metrics)
export function window(data: Data, camp: string, fam: string, from: string, to: string): Window {
  const byCamp = new Map(data.ads.map(a => [a.ad_key, (a.campaign || '').trim()]));
  let spend = 0, purchases = 0, impr = 0, clicks = 0;
  for (const m of data.metrics) {
    if (m.day < from || m.day > to || famOf(m.ad_key) !== fam || byCamp.get(m.ad_key) !== camp) continue;
    spend += Number(m.spend) || 0; purchases += Number(m.leads) || 0; impr += Number(m.impressions) || 0; clicks += Number(m.clicks) || 0;
  }
  return { spend, purchases, cpa: purchases ? spend / purchases : null, ctr: impr ? (100 * clicks) / impr : null };
}

const RESULT_AR: Record<Result, string> = { worked: 'نجح', no_change: 'ما غيّر شي', worse: 'خرّب', unclear: 'ما ينحكم عليه' };
const n2 = (x: number | null) => (x == null ? '—' : String(Math.round(x * 100) / 100));

/** The lesson written when a proposal's 7-day result is in: what was done, on what, and what the numbers did. */
export function lessonText(kind: string, campaign: string, platform: string, before: Window, after: Window, result: Result): string {
  const what = KIND_AR[kind as Kind] || kind, where = FAM_AR[platform as Fam] || platform;
  return `${what} على «${campaign}» (${where}): ${RESULT_AR[result]} بعد ٧ أيام. `
    + `تكلفة الطلب ${n2(before.cpa)} ← ${n2(after.cpa)}، الطلبات ${n2(before.purchases)} ← ${n2(after.purchases)}، `
    + `نسبة النقر ${n2(before.ctr)}٪ ← ${n2(after.ctr)}٪ (الأسبوع قبل القرار مقابل الأسبوع بعده).`;
}

const DECIDED = ['approved', 'executed', 'modified'];

/**
 * The buyer's proposals that were decided, with how each campaign did 3 and 7 days after the decision. Writes each
 * completed window to `outcomes` once, and a lesson when the 7-day window is written. Hoven only: suggestions carry no
 * company (docs/review-2026-11.md R-01), so the board is Hoven's alone.
 */
export async function measure(cfg: Cfg, data: Data, day = today()): Promise<{ past: PastRec[]; written: number; lessons: number }> {
  const r = await sb(cfg, '/rest/v1/suggestions?select=id,platform,kind,campaign,status,decided_at,params,outcomes(day,vs_expect)&params->>from=eq.buyer&status=neq.open&order=decided_at.desc&limit=30', { admin: true });
  if (!r.ok) return { past: [], written: 0, lessons: 0 };
  const out: PastRec[] = [];
  let written = 0, lessons = 0;
  for (const s of rows(r.data)) {
    const done = new Map(rows<{ day: number; vs_expect: { result?: Result } | null }>(s['outcomes']).map(o => [o.day, o.vs_expect?.result ?? null]));
    const rec: PastRec = { kind: String(s['kind']), campaign: (s['campaign'] as string) || null, platform: String(s['platform']), status: String(s['status']), d3: done.get(3) ?? null, d7: done.get(7) ?? null };
    const at = typeof s['decided_at'] === 'string' ? s['decided_at'].slice(0, 10) : null;
    if (at && DECIDED.includes(rec.status) && rec.campaign) {
      const before = window(data, rec.campaign, rec.platform, addDays(at, -7), addDays(at, -1));
      for (const d of [3, 7] as const) {
        if (done.has(d) || addDays(at, d) >= day) continue;
        const after = window(data, rec.campaign, rec.platform, at, addDays(at, d - 1));
        const result = outcome(rec.kind as Kind, before, after);
        // return=representation: a row back means this run wrote it (a duplicate comes back empty), so the lesson is written once
        const w = await sb(cfg, '/rest/v1/outcomes', { method: 'POST', admin: true, headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
          body: { suggestion_id: s['id'], day: d, metrics: { before, after }, vs_expect: { result } } });
        if (!w.ok) continue;
        if (d === 3) rec.d3 = result; else rec.d7 = result;
        if (!rows(w.data).length) continue;
        written++;
        if (d === 7 && result !== 'unclear') {
          const l = await sb(cfg, '/rest/v1/lessons', { method: 'POST', admin: true,
            body: { company_id: HOVEN_COMPANY, module: 'buyer', kind: 'lesson', lesson: lessonText(rec.kind, rec.campaign, rec.platform, before, after, result),
              evidence: { suggestion_id: s['id'], before, after, result }, confidence: result === 'worked' || result === 'worse' ? 0.7 : 0.4, source: 'outcome', status: 'new' } });
          if (l.ok) lessons++;
        }
      }
    }
    out.push(rec);
  }
  return { past: out, written, lessons };
}

/** Scheduled run (the 4-hourly cron): Hoven's numbers, then measure. Logs counts only, never figures. */
export async function runBuyerLearning(cfg: Cfg, day = today()): Promise<{ written: number; lessons: number }> {
  const data = await numbers(cfg, HOVEN_COMPANY, 21, day);
  if (!data.ok) { console.error('buyer learning: numbers not read'); return { written: 0, lessons: 0 }; }
  const { written, lessons } = await measure(cfg, data, day);
  console.log(`buyer learning: ${written} outcomes, ${lessons} lessons`);
  return { written, lessons };
}
