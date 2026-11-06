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
  it('matches a company word as a whole word, with the Arabic prefixes joined to it', () => {
    const extra = companyRules(['سر']);
    const hit = (t: string) => check(t, extra).filter(h => h.rule.startsWith('company_')).map(h => h.match);
    // never inside another word
    expect(hit('توصيل سريع للبيت')).toEqual([]);
    expect(hit('سرير طبي وأسرة')).toEqual([]);
    expect(hit('السرير جاهز')).toEqual([]);
    // on its own, at the edges and next to punctuation
    expect(hit('سر')).toEqual(['سر']);
    expect(hit('هذا سر الجمال')).toEqual(['سر']);
    expect(hit('اعرف السر!')).toEqual(['سر']);
    expect(hit('«سر»، وبس')).toEqual(['سر']);
    expect(hit('سر.')).toEqual(['سر']);
    // joined prefixes (و ف ب ل ك ال): the word is still there, and the hit starts at it
    expect(hit('بالسر نقولك')).toEqual(['سر']);
    expect(hit('والسر في الخلطة')).toEqual(['سر']);
    expect(hit('فالسر بسيط')).toEqual(['سر']);
    // a suffix makes another word: not matched (see companyRules)
    expect(hit('سرها بسيط')).toEqual([]);
  });
  it('keeps the position of a prefixed hit on the phrase itself', () => {
    const [h] = check('عرض بالأرخص اليوم', companyRules(['الأرخص'])).filter(x => x.rule.startsWith('company_'));
    expect(h).toMatchObject({ match: 'الأرخص' });
    expect('عرض بالأرخص اليوم'.slice(h!.start, h!.end)).toBe('الأرخص');
  });
  it('matches Latin words whole too', () => {
    const extra = companyRules(['best']);
    expect(check('the best care', extra).some(h => h.rule.startsWith('company_'))).toBe(true);
    expect(check('bestseller', extra).some(h => h.rule.startsWith('company_'))).toBe(false);
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
