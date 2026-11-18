// The media buyer's numbers and rules: purchases come from ad_metrics.leads, ROAS from Salla net sales ÷ ad spend,
// recommendations respect the owner's goals and minimum evidence, and proposals reach the board as open, unexecuted rows.
import { describe, expect, it } from 'vitest';
import { summarize, recommend, outcome, cleanGoals, cleanRules, famOf, addDays, type AdRow, type MetricRow, type SaleRow } from '../../src/modules/buyer/engine';
import { systemFor, toSuggestion, fromChat, DEFAULT_RULES } from '../../src/modules/buyer/prompt';

const TODAY = '2026-11-17';
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));
const now = days('2026-11-10', 7), prev = days('2026-11-03', 7);
const ads: AdRow[] = [
  { ad_key: 'm1', campaign: 'شتاء', live: true },
  { ad_key: 'm2', campaign: 'شتاء', live: true },
  { ad_key: 's9', campaign: 'سناب عروض', live: true },
  { ad_key: 'g5', campaign: 'بحث', live: false },
];
const row = (ad_key: string, day: string, spend: number, leads: number, impressions = 1000, clicks = 20): MetricRow => ({ ad_key, day, spend, leads, impressions, clicks });

describe('summarize', () => {
  it('splits the last 7 complete days from the 7 before, per platform and campaign', () => {
    const m = [...now.map(d => row('m1', d, 100, 1)), ...now.map(d => row('m2', d, 50, 0)), ...prev.map(d => row('m1', d, 80, 1)), row('m1', TODAY, 999, 9)];
    const s = summarize(ads, m, [], TODAY);
    expect(s.from).toBe('2026-11-10'); expect(s.to).toBe('2026-11-16'); expect(s.prevFrom).toBe('2026-11-03');
    expect(s.platforms.meta.now.spend).toBe(1050); // today's partial day left out
    expect(s.platforms.meta.now.purchases).toBe(7);
    expect(s.platforms.meta.now.cpa).toBe(150);
    expect(s.platforms.meta.prev.spend).toBe(560);
    expect(s.campaigns).toHaveLength(1);
    expect(s.campaigns[0]).toMatchObject({ fam: 'meta', campaign: 'شتاء', live: true });
  });
  it('blended ROAS = Salla net sales ÷ all ad spend', () => {
    const sales: SaleRow[] = [...now.map(day => ({ day, net_sales_sar: '700', orders: 3 })), ...prev.map(day => ({ day, net_sales_sar: 100, orders: 1 }))];
    const s = summarize(ads, [...now.map(d => row('m1', d, 100, 1)), ...prev.map(d => row('s9', d, 100, 0))], sales, TODAY);
    expect(s.store.sales).toBe(4900); expect(s.store.orders).toBe(21);
    expect(s.store.roas).toBe(7); expect(s.store.prevRoas).toBe(1);
  });
  it('no spend: ROAS and CPA are empty, not zero or infinite', () => {
    const s = summarize(ads, [], [{ day: '2026-11-12', net_sales_sar: 500, orders: 2 }], TODAY);
    expect(s.store.roas).toBeNull(); expect(s.platforms.meta.now.cpa).toBeNull();
  });
  it('maps ad keys to platforms by their first letter', () => {
    expect(famOf('m123')).toBe('meta'); expect(famOf('s1')).toBe('snap'); expect(famOf('t1')).toBe('tiktok'); expect(famOf('g1')).toBe('google'); expect(famOf('x1')).toBeNull();
  });
});

describe('recommend', () => {
  const sum = (m: MetricRow[]) => summarize(ads, m, [], TODAY);
  it('pauses a live campaign past the stop line with no purchase', () => {
    const r = recommend(sum(now.map(d => row('s9', d, 60, 0))), { snap: { stopSpend: 300 } });
    expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ kind: 'pause', fam: 'snap', campaign: 'سناب عروض' });
  });
  it('cuts the budget when cost per purchase is 30% over target, by the owner\'s max step', () => {
    const r = recommend(sum(now.map(d => row('m1', d, 200, 1))), { meta: { targetCpa: 100, maxStepPct: 15 } });
    expect(r[0]).toMatchObject({ kind: 'budget_down', pct: 15 });
  });
  it('scales when cost per purchase is 20% under target', () => {
    const r = recommend(sum(now.map(d => row('m1', d, 70, 1))), { meta: { targetCpa: 100 } });
    expect(r[0]).toMatchObject({ kind: 'budget_up', pct: 20 });
  });
  it('waits for 3 purchases before judging cost per purchase', () => {
    const m = [row('m1', now[0]!, 900, 2)];
    expect(recommend(sum(m), { meta: { targetCpa: 100 } })).toEqual([]);
  });
  it('asks for a new creative when CTR falls 30%', () => {
    const m = [...now.map(d => row('m1', d, 10, 0, 1000, 5)), ...prev.map(d => row('m1', d, 10, 0, 1000, 20))];
    expect(recommend(sum(m), {})[0]).toMatchObject({ kind: 'refresh_creative' });
  });
  it('skips paused campaigns and alerts when blended ROAS is under target', () => {
    const s = summarize(ads, now.map(d => row('g5', d, 1000, 0)), now.map(day => ({ day, net_sales_sar: 1000, orders: 1 })), TODAY);
    const r = recommend(s, { google: { stopSpend: 10, targetRoas: 2 } });
    expect(r.map(x => x.kind)).toEqual(['roas_alert']);
  });
});

describe('outcome', () => {
  const b = { cpa: 100, ctr: 1, purchases: 5, spend: 500 };
  it('judges each kind on its own measure', () => {
    expect(outcome('budget_down', b, { ...b, cpa: 80 })).toBe('worked');
    expect(outcome('budget_down', b, { ...b, cpa: 130 })).toBe('worse');
    expect(outcome('budget_up', b, { ...b, purchases: 8, cpa: 105 })).toBe('worked');
    expect(outcome('pause', b, { ...b, spend: 20 })).toBe('worked');
    expect(outcome('refresh_creative', b, { ...b, ctr: 1.5 })).toBe('worked');
    expect(outcome('budget_up', { ...b, cpa: null }, b)).toBe('unclear');
  });
});

describe('owner input', () => {
  it('keeps only sane numbers per known platform', () => {
    expect(cleanGoals({ meta: { targetCpa: '120', targetRoas: -1, maxStepPct: 90, junk: 1 }, x: { targetCpa: 5 } })).toEqual({ meta: { targetCpa: 120 } });
    expect(cleanGoals('nope')).toEqual({});
  });
  it('rules: one per line, trimmed, capped', () => {
    expect(cleanRules(' أ \n\n ب ')).toEqual(['أ', 'ب']);
    expect(cleanRules(Array(60).fill('x'))).toHaveLength(40);
  });
});

describe('to the decision board', () => {
  const s = summarize(ads, now.map(d => row('m1', d, 200, 1)), [], TODAY);
  const rec = recommend(s, { meta: { targetCpa: 100 } })[0]!;
  it('files an open proposal, never an executed one', () => {
    const x = toSuggestion(rec, 'o@x')!;
    expect(x).toMatchObject({ platform: 'meta', level: 'campaign', kind: 'budget_down', status: 'open', source: 'rule', target_id: 'buyer:شتاء' });
    expect(x.measure_plan).toContain('٣');
  });
  it('store-level alerts do not go to the board', () => {
    expect(toSuggestion({ ...rec, fam: 'store' }, 'o@x')).toBeNull();
  });
  it('a chat proposal needs a known platform, a kind it may propose, a campaign and a reason', () => {
    expect(fromChat({ platform: 'meta', kind: 'budget_up', campaign: 'شتاء', why: 'رخيص', pct: 90 })).toMatchObject({ pct: 50 });
    expect(fromChat({ platform: 'meta', kind: 'delete', campaign: 'شتاء', why: 'x' })).toBeNull();
    expect(fromChat({ platform: 'x', kind: 'pause', campaign: 'شتاء', why: 'x' })).toBeNull();
    expect(fromChat({ platform: 'meta', kind: 'pause', campaign: '', why: 'x' })).toBeNull();
  });
  it('the system prompt carries numbers, goals, rules, lessons and past outcomes', () => {
    const p = systemFor({ summary: s, goals: { meta: { targetCpa: 100 } }, rules: DEFAULT_RULES, lessons: ['سناب ما يجيب طلبات في الصيف'], knowledge: 'معرفة', recs: [rec], past: [{ kind: 'pause', campaign: 'قديمة', platform: 'meta', status: 'executed', d3: 'worked', d7: null }] });
    for (const t of ['1400', 'تكلفة طلب 100', DEFAULT_RULES[0]!, 'سناب ما يجيب', 'قديمة', 'نجح', 'معرفة', 'تقترح بس']) expect(p).toContain(t);
  });
});

describe('chat proposals', () => {
  it('splits the PROPOSALS line off the reply and keeps only valid ones', async () => {
    const { splitProposals } = await import('../../src/modules/buyer/prompt');
    const r = splitProposals('نزّل الميزانية.\nPROPOSALS: [{"platform":"meta","campaign":"شتاء","kind":"budget_down","pct":15,"why":"غالية"},{"platform":"meta","kind":"delete","campaign":"x","why":"y"}]');
    expect(r.text).toBe('نزّل الميزانية.');
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ kind: 'budget_down', pct: 15, campaign: 'شتاء' });
    expect(splitProposals('بدون اقتراح').proposals).toEqual([]);
    expect(splitProposals('x PROPOSALS: not json').text).toBe('x PROPOSALS: not json');
  });
});
