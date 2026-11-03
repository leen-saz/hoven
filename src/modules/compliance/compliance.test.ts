// Compliance for Hoven (a Saudi online home-goods store): e-commerce and consumer-protection rules, notices only.
import { describe, expect, it } from 'vitest';
import { check, companyRules, normalize, notice, scan } from './compliance';

const ids = (t: string) => check(t).map(h => h.rule);

describe('store rules', () => {
  it('flags discounts without terms, free without conditions, guarantees and superlatives', () => {
    expect(ids('خصم 30% على المفارش')).toContain('discount');
    expect(ids('شحن مجاني')).toContain('free');
    expect(ids('ضمان على كل المنتجات')).toContain('guarantee');
    expect(ids('الأفضل والأرخص في المملكة')).toContain('superlative');
    expect(ids('أصلي 100% من الوكيل')).toContain('original');
  });

  it('lowers a discount with dates to a note', () => {
    const h = check('خصم 30% لين نهاية الشهر').find(x => x.rule === 'discount');
    expect(h?.level).toBe('info');
  });

  it('notes material claims, scarcity and returns', () => {
    expect(ids('قطن 100% بكثافة 400 خيط')).toContain('material');
    expect(ids('آخر قطعة!')).toContain('scarcity');
    expect(ids('استرجاع خلال 7 أيام')).toContain('returns');
  });

  it('passes clean copy', () => {
    expect(check('مفارش ناعمة بألوان هادية، توصل لين بيتك')).toEqual([]);
  });
});

describe('precision', () => {
  it('folds spelling and keeps positions on the original text', () => {
    expect(normalize('الأفضل').t).toBe('الافضل');
    const t = 'عندنا الأفضل';
    const h = check(t).find(x => x.rule === 'superlative')!;
    expect(t.slice(h.start, h.end)).toBe(h.match);
  });

  it('worst first; every hit has a fix and a line of text with its source', () => {
    const hits = check('شحن مجاني والأفضل، خصم 20%');
    expect(hits.length).toBeGreaterThan(1);
    for (const h of hits) { expect(h.fix).toBeTruthy(); expect(notice(h)).toContain('المصدر'); }
  });

  it('adds the company forbidden words from Knowledge', () => {
    expect(check('عرض حصري', companyRules(['حصري'])).map(h => h.rule)).toContain('company_1');
  });
});

describe('scan', () => {
  it('scans stored ads once per copy, worst first, and skips ads without text', () => {
    const r = scan([
      { ad_key: 'm1', platform: 'meta', name: 'A', live: true, text: 'استرجاع سهل' },
      { ad_key: 'm2', platform: 'meta', name: 'B', live: true, text: 'استرجاع سهل' },
      { ad_key: 's1', platform: 'snapchat', name: 'C', live: false, text: 'الأرخص في السوق' },
      { ad_key: 't1', platform: 'tiktok', name: 'D', live: true, text: '' },
    ]);
    expect(r.checked).toBe(3);
    expect(r.ads.map(a => a.ad_key)).toEqual(['s1', 'm1']);
    expect(r.summary).toMatchObject({ warn: 1, info: 1 });
  });
});
