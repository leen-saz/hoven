// The media buyer's numbers and rules (pure, no I/O). Hoven's ad results are store purchases (pipeline/fetch_data.py:
// Meta omni_purchase, Google PURCHASE conversions, Snap conversion_purchases), and Salla gives the store's real sales per
// day. So per platform and campaign: spend, purchases, cost per purchase (CPA), CTR; for the store: Salla net sales and
// the blended ROAS (sales ÷ all ad spend). Recommendations are proposals only: they go to the decision board for approval.

export type Fam = 'meta' | 'snap' | 'tiktok' | 'google';
export const FAMS: Fam[] = ['meta', 'snap', 'tiktok', 'google'];
export const FAM_AR: Record<Fam, string> = { meta: 'ميتا', snap: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل' };
const FAM_OF: Record<string, Fam> = { m: 'meta', s: 'snap', t: 'tiktok', g: 'google' };
export const famOf = (adKey: string): Fam | null => FAM_OF[adKey[0] ?? ''] ?? null;

export interface AdRow { ad_key: string; campaign?: string | null; live?: boolean | null }
export interface MetricRow { ad_key: string; day: string; spend: number | string; impressions: number | string; clicks: number | string; leads: number | string }
export interface SaleRow { day: string; net_sales_sar: number | string; orders: number | string }

// Leen's goals per platform (all optional): target cost per purchase, target ROAS, planned daily budget, stop line
// (spend with no purchase after which a campaign should stop), max budget step per change in percent.
export interface Goal { targetCpa?: number; targetRoas?: number; dailyBudget?: number; stopSpend?: number; maxStepPct?: number }
export type Goals = Partial<Record<Fam, Goal>>;

export interface Totals { spend: number; purchases: number; impr: number; clicks: number; cpa: number | null; ctr: number | null }
export interface CampaignStat { fam: Fam; campaign: string; now: Totals; prev: Totals; live: boolean }
export interface Summary {
  from: string; to: string; prevFrom: string; prevTo: string;
  platforms: Record<Fam, { now: Totals; prev: Totals }>;
  campaigns: CampaignStat[];
  store: { sales: number; orders: number; prevSales: number; spend: number; roas: number | null; prevRoas: number | null };
}

export type Kind = 'pause' | 'budget_down' | 'budget_up' | 'refresh_creative' | 'roas_alert';
export interface Rec {
  key: string; fam: Fam | 'store'; campaign: string | null; kind: Kind; pct?: number;
  why: string; measure: string; evidence: Record<string, number | null>;
}

const n = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const r2 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100);
export const addDays = (day: string, k: number) => new Date(Date.parse(day + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10);
const empty = (): Totals => ({ spend: 0, purchases: 0, impr: 0, clicks: 0, cpa: null, ctr: null });
const close = (t: Totals): Totals => ({ ...t, spend: r2(t.spend) ?? 0, cpa: r2(ratio(t.spend, t.purchases)), ctr: r2(t.impr ? (100 * t.clicks) / t.impr : null) });

// The last `days` complete days before `today` (today is partial), and the same length just before
export function summarize(ads: AdRow[], metrics: MetricRow[], sales: SaleRow[], today: string, days = 7): Summary {
  const to = addDays(today, -1), from = addDays(to, -(days - 1)), prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(days - 1));
  const byKey = new Map(ads.map(a => [a.ad_key, a]));
  const plat = Object.fromEntries(FAMS.map(f => [f, { now: empty(), prev: empty() }])) as Summary['platforms'];
  const camp = new Map<string, CampaignStat>();
  for (const m of metrics) {
    const fam = famOf(m.ad_key); if (!fam) continue;
    const w = m.day >= from && m.day <= to ? 'now' : m.day >= prevFrom && m.day <= prevTo ? 'prev' : null; if (!w) continue;
    const ad = byKey.get(m.ad_key), name = (ad?.campaign || '').trim() || '—', k = `${fam}|${name}`;
    const c = camp.get(k) ?? { fam, campaign: name, now: empty(), prev: empty(), live: false };
    if (ad?.live) c.live = true;
    for (const t of [plat[fam][w], c[w]]) { t.spend += n(m.spend); t.purchases += n(m.leads); t.impr += n(m.impressions); t.clicks += n(m.clicks); }
    camp.set(k, c);
  }
  for (const f of FAMS) { plat[f].now = close(plat[f].now); plat[f].prev = close(plat[f].prev); }
  const campaigns = [...camp.values()].map(c => ({ ...c, now: close(c.now), prev: close(c.prev) })).sort((a, b) => b.now.spend - a.now.spend);
  let s = 0, o = 0, ps = 0;
  for (const x of sales) { if (x.day >= from && x.day <= to) { s += n(x.net_sales_sar); o += n(x.orders); } else if (x.day >= prevFrom && x.day <= prevTo) ps += n(x.net_sales_sar); }
  const spend = FAMS.reduce((t, f) => t + plat[f].now.spend, 0), prevSpend = FAMS.reduce((t, f) => t + plat[f].prev.spend, 0);
  return { from, to, prevFrom, prevTo, platforms: plat, campaigns,
    store: { sales: r2(s) ?? 0, orders: o, prevSales: r2(ps) ?? 0, spend: r2(spend) ?? 0, roas: r2(ratio(s, spend)), prevRoas: r2(ratio(ps, prevSpend)) } };
}

// Minimum evidence before acting on a campaign (a few purchases, enough spend): the platforms' learning needs volume
export const MIN = { purchasesToJudge: 3, ctrDropPct: 30, ctrMinImpr: 2000, scaleHeadroom: 0.8, cutOver: 1.3, defaultStepPct: 20 } as const;

export function recommend(s: Summary, goals: Goals): Rec[] {
  const out: Rec[] = [];
  const sar = (x: number | null) => (x == null ? '—' : `${Math.round(x).toLocaleString('en-US')} ر.س`);
  for (const c of s.campaigns) {
    if (!c.live) continue;
    const g = goals[c.fam] ?? {}, step = Math.min(g.maxStepPct ?? MIN.defaultStepPct, 50), base = `${c.fam}|${c.campaign}`;
    const ev = { spend: c.now.spend, purchases: c.now.purchases, cpa: c.now.cpa, targetCpa: g.targetCpa ?? null, ctr: c.now.ctr, prevCtr: c.prev.ctr };
    if (g.stopSpend && c.now.purchases === 0 && c.now.spend >= g.stopSpend) {
      out.push({ key: `${base}|pause`, fam: c.fam, campaign: c.campaign, kind: 'pause', evidence: ev,
        why: `صرفت ${sar(c.now.spend)} آخر ${daysOf(s)} أيام بدون ولا طلب، وحد الإيقاف ${sar(g.stopSpend)}`, measure: 'يوقف الصرف بدون طلبات' });
      continue;
    }
    if (g.targetCpa && c.now.cpa != null && c.now.purchases >= MIN.purchasesToJudge) {
      if (c.now.cpa > g.targetCpa * MIN.cutOver) {
        out.push({ key: `${base}|budget_down`, fam: c.fam, campaign: c.campaign, kind: 'budget_down', pct: step, evidence: ev,
          why: `تكلفة الطلب ${sar(c.now.cpa)}، أعلى من هدفك ${sar(g.targetCpa)} بأكثر من ٣٠٪`, measure: `تنزل تكلفة الطلب تحت ${sar(g.targetCpa)} خلال ٧ أيام` });
        continue;
      }
      if (c.now.cpa <= g.targetCpa * MIN.scaleHeadroom) {
        out.push({ key: `${base}|budget_up`, fam: c.fam, campaign: c.campaign, kind: 'budget_up', pct: step, evidence: ev,
          why: `تكلفة الطلب ${sar(c.now.cpa)}، أقل من هدفك ${sar(g.targetCpa)} بـ٢٠٪ أو أكثر، مع ${c.now.purchases} طلبات`, measure: `تزيد الطلبات وتكلفة الطلب تبقى تحت ${sar(g.targetCpa)}` });
        continue;
      }
    }
    if (c.prev.ctr && c.now.ctr != null && c.now.impr >= MIN.ctrMinImpr && c.now.ctr < c.prev.ctr * (1 - MIN.ctrDropPct / 100)) {
      out.push({ key: `${base}|refresh_creative`, fam: c.fam, campaign: c.campaign, kind: 'refresh_creative', evidence: ev,
        why: `نسبة النقر نزلت من ${c.prev.ctr}٪ إلى ${c.now.ctr}٪: الجمهور مل من الإعلان`, measure: 'ترجع نسبة النقر لمستواها السابق' });
    }
  }
  const t = Math.min(...FAMS.map(f => goals[f]?.targetRoas ?? Infinity));
  if (Number.isFinite(t) && s.store.roas != null && s.store.roas < t) {
    out.push({ key: 'store|roas_alert', fam: 'store', campaign: null, kind: 'roas_alert', evidence: { roas: s.store.roas, targetRoas: t, sales: s.store.sales, spend: s.store.spend },
      why: `العائد من مبيعات سلة ${s.store.roas}× أقل من هدفك ${t}×`, measure: `يرجع العائد فوق ${t}×` });
  }
  return out;
}
const daysOf = (s: Summary) => Math.round((Date.parse(s.to) - Date.parse(s.from)) / 864e5) + 1;

// Learning loop: how a recommendation turned out, comparing the campaign's window when it was made with a later one
export type Result = 'worked' | 'no_change' | 'worse' | 'unclear';
export function outcome(kind: Kind, before: { cpa: number | null; ctr: number | null; purchases: number; spend: number }, after: { cpa: number | null; ctr: number | null; purchases: number; spend: number }): Result {
  if (kind === 'pause') return after.spend < before.spend * 0.2 ? 'worked' : 'no_change';
  if (kind === 'refresh_creative') { if (before.ctr == null || after.ctr == null) return 'unclear'; return after.ctr > before.ctr * 1.1 ? 'worked' : after.ctr < before.ctr * 0.9 ? 'worse' : 'no_change'; }
  if (before.cpa == null || after.cpa == null) return 'unclear';
  if (kind === 'budget_down') return after.cpa < before.cpa * 0.9 ? 'worked' : after.cpa > before.cpa * 1.1 ? 'worse' : 'no_change';
  if (kind === 'budget_up') return after.purchases > before.purchases && after.cpa <= before.cpa * 1.15 ? 'worked' : after.cpa > before.cpa * 1.3 ? 'worse' : 'no_change';
  return 'unclear';
}

// Goals as typed by the owner: numbers only, within sane bounds; anything else is dropped
export function cleanGoals(x: unknown): Goals {
  const out: Goals = {};
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, Record<string, unknown>>;
  const num = (v: unknown, max: number) => { const k = Number(v); return Number.isFinite(k) && k > 0 && k <= max ? k : undefined; };
  for (const f of FAMS) {
    const g = o[f] || {};
    const c: Record<keyof Goal, number | undefined> = { targetCpa: num(g.targetCpa, 1e6), targetRoas: num(g.targetRoas, 100), dailyBudget: num(g.dailyBudget, 1e7), stopSpend: num(g.stopSpend, 1e7), maxStepPct: num(g.maxStepPct, 50) };
    const kept = Object.fromEntries(Object.entries(c).filter(([, v]) => v != null)) as Goal;
    if (Object.keys(kept).length) out[f] = kept;
  }
  return out;
}

// Rules in Arabic, one per line, as the owner writes them; trimmed and capped
export const cleanRules = (x: unknown): string[] => (Array.isArray(x) ? x : String(x ?? '').split('\n')).map(r => String(r).trim().slice(0, 300)).filter(Boolean).slice(0, 40);
