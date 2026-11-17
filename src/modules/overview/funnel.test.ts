// The journey's shape and numbers on made-up numbers: a band whose height follows the volume and whose waist narrows on
// a step under target, the journey labels in English, and the platform filter. The rules themselves: judge.test.ts.
import { describe, expect, it } from 'vitest';
import { points, shape, stageX } from './funnel';
import { journey, outcome, type Outcome } from './analytics';
import { addDays, type Dash } from './numbers';

// A healthy period: CTR 1.5%, 3% of clicks become a lead or chat, 10% of ad-linked leads close, 50 SAR a lead
const base: Outcome = {
  spend: 15000, impr: 200000, clicks: 3000, leads: 70, conv: 20, crm: true, crmLinked: true, crmLeads: 60, booked: 6, value: 9000,
  closings: 8, paid: 12000, cpm: 75, cpc: 5, ctr: 1.5, cpl: 50, clickToResult: 3, closeRate: 10, roas: 0.6, mer: 0.8, cac: 1875, closingsAll: 8, bookedAll: 6, closingsUnattributed: 2,
  closeRateAll: 8.9,
};
const as = (o: Partial<Outcome>): Outcome => ({ ...base, ...o });

<<<<<<< well
describe('overview: closings not tied to an ad are marked', () => {
  it('shows the unattributed count beside the ad-linked one, in both languages, and not when there are none', () => {
    const ar = journey(as({ closingsAll: 45, bookedAll: 0, booked: 0, closings: 45, closingsUnattributed: 45 }), 'ar').stages[3]!.sub.find(x => x.key === 'closingsUnattributed');
    expect([ar?.label, ar?.now]).toEqual(['إقفالات غير منسوبة لإعلان', 45]);
    expect(journey(as({ closingsUnattributed: 3 }), 'en').stages[3]!.sub.find(x => x.key === 'closingsUnattributed')?.label).toBe('Closings not tied to an ad');
    expect(journey(as({ closingsUnattributed: 0 }), 'ar').stages[3]!.sub.some(x => x.key === 'closingsUnattributed')).toBe(false);
=======
describe('overview: funnel rules', () => {
  it('all steps as usual: «لا توجد مشكلة واضحة», no step singled out', () => {
    const v = verdict(steps(base, base, usual));
    expect(v).toMatchObject({ level: 'ok', step: null, title: 'لا توجد مشكلة واضحة' });
  });

  it("small gaps are not a problem: Leen's 1.71% vs a usual 1.84% and 6.78% vs 6.90% stay fine", () => {
    const now = as({ ctr: 1.71, clickToResult: 6.78 }), before = as({ ctr: 1.95, clickToResult: 7.4 });
    const list = steps(now, before, { click: 1.84, lead: 6.9, cpl: 50 });
    expect(list.filter(s => s.key === 'click' || s.key === 'lead').map(s => s.level)).toEqual(['ok', 'ok']);
    expect(verdict(list)).toMatchObject({ level: 'ok', title: 'لا توجد مشكلة واضحة' });
  });

  it('weak only when weaker than every reference: 20% under both is watch, close to one of them is fine', () => {
    expect(steps(as({ ctr: 1.2 }), as({ ctr: 1.5 }), usual).find(s => s.key === 'click')!.level).toBe('watch');
    expect(steps(as({ ctr: 1.2 }), as({ ctr: 1.25 }), usual).find(s => s.key === 'click')!.level).toBe('ok');
    expect(steps(as({ ctr: 1.0 }), as({ ctr: 1.5 }), usual).find(s => s.key === 'click')!.level).toBe('bad');
  });

  it('a low click rate points at the creative and the first line', () => {
    const v = verdict(steps(as({ ctr: 0.9 }), base, usual));
    expect(v).toMatchObject({ step: 'click', level: 'bad', where: 'من الظهور للنقرة' });
    expect(v.todo).toContain('أول سطر');
  });

  it('clicks that stop becoming leads point at the form, the page and the WhatsApp entry', () => {
    const v = verdict(steps(as({ clickToResult: 2 }), base, usual));
    expect(v).toMatchObject({ step: 'lead', where: 'من النقرة للطلب' });   // Hoven counts orders (ADR-0007)
    expect(v.why).toContain('النموذج');
    expect(v.why).toContain('الواتساب');
  });

  it('leads that stop closing point at follow-up speed and lead quality', () => {
    const v = verdict(steps(as({ closeRate: 5 }), base, usual));
    expect(v).toMatchObject({ step: 'sale', level: 'bad' });
    expect(v.why).toContain('المتابعة');
  });

  it('a rising cost per lead points at audience and creative fatigue (lower is better)', () => {
    const list = steps(as({ cpl: 80 }), base, usual);
    expect(list.find(s => s.key === 'cpl')!.score).toBeCloseTo(50 / 80);
    // Hoven counts orders only (ADR-0007)
    expect(verdict(list)).toMatchObject({ step: 'cpl', where: 'تكلفة الطلب' });
  });

  it('no CRM, too few leads tied to ads, or paid closings with none tied to an ad: «غير مربوط», never the bottleneck', () => {
    for (const o of [as({ crmLinked: false, crm: false, crmLeads: 0 }), as({ crmLeads: 10 }), as({ booked: 0, closeRate: 0, closings: 45, closingsAll: 45, bookedAll: 0 })]) {
      const list = steps(o, base, usual);
      const sale = list.find(s => s.key === 'sale')!;
      expect(sale).toMatchObject({ unattributed: true, now: null, score: null });
      expect(sale.line).toMatch(/^غير مربوط/);
      const v = verdict(list);
      expect(v.step).not.toBe('sale');
      expect(v.unlinked?.todo).toContain('صفحة الربط');
    }
  });

  it("Leen's case: 45 paid closings, none tied to an ad, a valid earlier rate: no 0% and no −100% bottleneck", () => {
    const now = as({ booked: 0, closeRate: 0, closings: 45, closingsAll: 45, bookedAll: 0 });
    const list = steps(now, base, usual), sale = list.find(s => s.key === 'sale')!;
    expect(sale.prev).toBeNull();
    expect(sale.line).toContain('45 إقفالة');
    expect(sale.line).toContain('مو صفر');
    expect(sale.line).not.toMatch(/0\.00%|100%/);
    expect(verdict(list)).toMatchObject({ level: 'ok', title: 'لا توجد مشكلة واضحة' });
  });

  it('a step under its floor is the bottleneck before one that is only weaker than usual, even with a higher score', () => {
    // click→lead 1.43% (floor 1.5, 17% under the earlier 1.72: score 0.83, bad); cost per lead +23% (score 0.82, watch)
    const v = verdict(steps(as({ clickToResult: 1.43, cpl: 81.5 }), as({ clickToResult: 1.72, cpl: 66.5 }), { click: null, lead: null, cpl: null }));
    expect(v).toMatchObject({ step: 'lead', level: 'bad' });
  });

  it('below the floor is weak even when the history was as bad', () => {
    const low = as({ ctr: FLOORS.click / 2 });
    const st = steps(low, low, { ...usual, click: FLOORS.click / 2 }).find(s => s.key === 'click')!;
    expect(st.level).toBe('bad');
    expect(st.line).toContain('تحت الحد المقبول');
  });

  it('with no valid comparison it judges on the usual level and the floor only', () => {
    const st = steps(as({ ctr: 1.2 }), null, usual).find(s => s.key === 'click')!;
    expect(st.prev).toBeNull();
    expect(st.score).toBeCloseTo(1.2 / 1.5);
    expect(st.level).toBe('watch');
    expect(st.line).not.toContain('الفترة اللي قبلها');
  });

  it('every line and verdict addresses the reader in the masculine', () => {
    const all = [as({ ctr: 0.5 }), as({ clickToResult: 1 }), as({ closeRate: 1 }), as({ cpl: 200 }), as({ crmLinked: false }), as({ booked: 0, closings: 9, closingsAll: 9, bookedAll: 0 })]
      .flatMap(o => { const l = steps(o, base, usual); const v = verdict(l); return [v.why, v.todo, v.unlinked?.why ?? '', v.unlinked?.todo ?? '', ...l.map(s => s.line)]; }).join(' ');
    expect(all).not.toMatch(/تسوين|شيكي|جربي|غيري|وسعي|قصري|تأكدي/);
  });
});

describe('overview: who owns the problem', () => {
  it('each step names its department; the verdict names the weakest one', () => {
    const owner = (o: Partial<Outcome>, b: Partial<Outcome> = base) => verdict(steps(as(o), as(b), { ...usual, cpm: 75 }));
    expect(owner({ ctr: 0.5 })).toMatchObject({ step: 'click', owner: 'الإنتاج / الكريتيف' });
    expect(owner({ clickToResult: 1 })).toMatchObject({ step: 'lead', owner: 'الإنتاج + صفحة الهبوط / النموذج' });
    expect(owner({ closeRate: 1 })).toMatchObject({ step: 'sale', owner: 'المبيعات' });
    expect(owner({ cpl: 200 })).toMatchObject({ step: 'cpl', owner: 'المشتري الإعلامي' });
    expect(owner({ cpm: 150 })).toMatchObject({ step: 'cpm', owner: 'المشتري الإعلامي' });
    expect(verdict(steps(base, base, { ...usual, cpm: 75 }))).toMatchObject({ owner: null, title: 'لا توجد مشكلة واضحة' });
  });
  it('not tied to ads: the CRM / operations owns it, as a note, never the bottleneck', () => {
    const list = steps(as({ booked: 0, closings: 45, closingsAll: 45, bookedAll: 0 }), base, usual);
    expect(list.find(s => s.key === 'sale')).toMatchObject({ owner: 'نظام العملاء / العمليات', unattributed: true });
    expect(verdict(list).unlinked?.owner).toBe('نظام العملاء / العمليات');
  });
  it('a platform filter changes the owner when its weak step differs', () => {
    const to = '2026-10-30', ads = { a: { name: 'a', campaign: 'c', platform: 'facebook', goal: 'lead' }, b: { name: 'b', campaign: 'c', platform: 'snap', goal: 'lead' } };
    // facebook: plenty of clicks, almost no leads; snap: very few clicks for its impressions
    const rows: unknown[][] = [['a', to, 100, 10000, 300, 1, 0], ['b', to, 100, 10000, 20, 2, 0]];
    const D = { ads, rows } as unknown as Dash;
    const v = (p: string) => verdict(steps(outcome(D, to, to, 'lead', p), null, { click: null, lead: null, cpl: null }));
    expect(v('facebook')).toMatchObject({ step: 'lead', owner: 'الإنتاج + صفحة الهبوط / النموذج' });
    expect(v('snap')).toMatchObject({ step: 'click', owner: 'الإنتاج / الكريتيف' });
  });
  it('owners in English too', () => {
    expect(verdict(steps(as({ closeRate: 1 }), base, usual, 'en'), 'en').owner).toBe('Sales');
>>>>>>> hoven
  });
});

describe('overview: funnel in English', () => {
  const arabic = /[\u0600-\u06FF]/;
  it('the journey labels and «غير مربوط» in English', () => {
    const j = journey(as({ booked: 0, closings: 45, closingsAll: 45, bookedAll: 0 }), 'en');
    expect(j.stages.map(s => s.n)).toEqual(['Awareness', 'Interest', 'Conversion', 'Sale']);
    const all = j.stages.flatMap(s => [s.n, s.hint, s.main.label, ...s.sub.map(x => x.label + (x.missing ?? '')), s.rate ? s.rate.label + (s.rate.missing ?? '') : '']).join(' ');
    expect(all).not.toMatch(arabic);
    // The lead-to-closing link is CRM-wide (judged); only the ads' own share is «غير مربوط»
    expect(j.stages[3]!.rate!.missing).toBeUndefined();
    expect(j.stages[3]!.sub.find(x => x.label === 'Closings from ads')!.missing).toBe('Not linked');
    expect(journey(as({ crmLinked: false }), 'en').noCrm).not.toMatch(arabic);
  });
  it('the band reads left to right in English: stage 1 on the left', () => {
    expect(stageX(0, 4, 960, false)).toBeLessThan(stageX(3, 4, 960, false));
    const p = points(shape([1000, 100, 10, 1], [1, 1, 1], 190, 28), 960, false);
    expect(p[0]!.h).toBe(190);
    expect(p.every((q, i) => i === 0 || q.x > p[i - 1]!.x)).toBe(true);
  });
});

describe('overview: the journey numbers per platform', () => {
  const to = '2026-10-30';
  const ads = { a: { name: 'a', campaign: 'c', platform: 'facebook', goal: 'lead' }, b: { name: 'b', campaign: 'c', platform: 'snap', goal: 'lead' } };
  // 20 days: facebook at 1% CTR, snap at 3%; one tiny day that must not count; one day outside the 30
  const rows: unknown[][] = [];
  for (let i = 0; i < 20; i++) {
    const day = addDays(to, -i);
    rows.push(['a', day, 100, 1000, 10, 2, 0], ['b', day, 100, 1000, 30, 1, 0]);
  }
  rows.push(['a', addDays(to, -25), 1, 50, 40, 0, 0], ['a', addDays(to, -40), 100, 1000, 900, 0, 0]);
  const D = { ads, rows } as unknown as Dash;

  it('the platform filter: only that platform, closings from the ad-linked CRM rows', () => {
    const C = { ...D, crm: { rows: [['a', to, to, true, 500], ['b', to, to, true, 700]], paid_all: [[to, to, 500, 'x'], [to, to, 700, 'y'], [to, to, 900, 'z']] } } as unknown as Dash;
    const all = outcome(C, addDays(to, -6), to), fb = outcome(C, addDays(to, -6), to, 'lead', 'facebook');
    expect(all).toMatchObject({ crm: true, closings: 3, impr: 14000 });
    expect(fb).toMatchObject({ crm: false, crmLinked: true, closings: 1, paid: 500, booked: 1, value: 500, impr: 7000, clicks: 70 });
  });
  it('the sale link is CRM-wide when the CRM has its paid list, even when no closing is tied to an ad', () => {
    const leads = Array.from({ length: 40 }, () => ['a', to, '', false, 0]);
    const C = { ...D, crm: { rows: leads, paid_all: [[to, to, 900, 'manual'], [to, to, 900, 'manual']] } } as unknown as Dash;
    const all = outcome(C, addDays(to, -6), to), fb = outcome(C, addDays(to, -6), to, 'lead', 'facebook');
    expect(all.closeRateAll).toBeCloseTo((100 * 2) / 21);   // 2 closings ÷ 21 results (14 facebook + 7 snap)
    expect(journey(all).stages[3]!.rate!.key).toBe('closeRateAll');
    expect(journey(all).stages[3]!.rate!.missing).toBeUndefined();
    // A platform: the CRM can't split its closings, so the link falls back to the ad-linked rate, «غير مربوط» here
    expect(fb.closeRateAll).toBeNull();
    expect(journey(fb).stages[3]!.rate!.missing).toBe('غير مربوط');
  });
});

describe('overview: the band', () => {
  it('height shrinks with the numbers (eased scale); the sale stage stays visible; no data = the thinnest', () => {
    const s = shape([2000000, 30000, 600, 12], [1, 1, 1], 190, 28);
    expect(s.heights[0]).toBe(190);
    expect(s.heights.every((h, i) => i === 0 || h < s.heights[i - 1]!)).toBe(true);
    expect(s.heights[1]).toBeLessThan(190 * 0.6);   // 66x fewer clicks than impressions must look much smaller
    expect(s.heights[3]).toBeGreaterThan(28);
    expect(shape([100, 10, 1, null], [1, 1, 1], 190, 28).heights[3]).toBe(28);
  });
  it('every link narrows into a neck; a weak step pinches it further', () => {
    const ok = shape([1000, 100, 10, 1], [1, 1, 1], 190, 28), weak = shape([1000, 100, 10, 1], [1, 0.5, 1], 190, 28);
    expect(weak.waists[1]).toBeLessThan(ok.waists[1]!);
    expect(weak.waists[1]).toBeCloseTo(ok.waists[1]! * 0.5);
    ok.waists.forEach((w, i) => expect(w).toBeLessThan(Math.min(ok.heights[i]!, ok.heights[i + 1]!)));
    expect(shape([1000, 100, 10, 1], [1, 0, 1], 190, 28).waists[1]).toBeGreaterThan(0);
  });
  it('reads right to left: stage 1 on the right, the points run left to right across the full width', () => {
    expect(stageX(0, 4, 960)).toBeGreaterThan(stageX(3, 4, 960));
    const p = points(shape([1000, 100, 10, 1], [1, 1, 1], 190, 28), 960);
    expect(p[0]!.x).toBe(0);
    expect(p[p.length - 1]!.x).toBe(960);
    expect(p.every((q, i) => i === 0 || q.x > p[i - 1]!.x)).toBe(true);
    expect(p[p.length - 1]!.h).toBe(190);          // the right end is the impressions
  });
});
