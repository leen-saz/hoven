// Compliance rules for a Saudi online store: risky retail ad wording is caught with the matching words; clean copy passes.
import { describe, expect, it } from 'vitest';
import { check, scan } from './compliance';

describe('compliance', () => {
  it('flags a discount without the old price and dates as critical', () => {
    const ids = (t: string) => check(t).map(h => h.rule);
    expect(ids('خصم 30% على المفارش')).toContain('fake_discount');
    expect(check('تخفيضات على كل شي')[0]?.level).toBe('critical');
    expect(ids('كان 299 ر.س والحين 199 لين نهاية الشهر، خصم 30%')).not.toContain('fake_discount');
  });

  it('warns on free, guarantees, superlatives and originality claims', () => {
    const ids = check('الأفضل والأرخص، شحن مجاني، ضمان، أصلي 100%').map(h => h.rule);
    expect(ids).toEqual(expect.arrayContaining(['free', 'guarantee', 'superlative', 'original']));
  });

  it('notes scarcity and returns wording', () => {
    const ids = check('آخر قطعة! واسترجاع خلال 7 أيام').map(h => h.rule);
    expect(ids).toEqual(expect.arrayContaining(['scarcity', 'returns']));
  });

  it('passes clean copy and returns the matched words', () => {
    expect(check('مفارش قطن بكثافة 400 خيط، توصيل لكل مدن المملكة')).toEqual([]);
    expect(check('شحن مجاني')[0]?.match).toBe('مجاني');
  });

  it('scans stored ads once per copy, worst first, and skips ads without text', () => {
    const r = scan([
      { ad_key: 'm1', platform: 'meta', name: 'A', live: true, text: 'شحن مجاني' },
      { ad_key: 'm2', platform: 'meta', name: 'B', live: true, text: 'شحن مجاني' },
      { ad_key: 's1', platform: 'snapchat', name: 'C', live: false, text: 'خصم 50%' },
      { ad_key: 't1', platform: 'tiktok', name: 'D', live: true, text: '' },
    ]);
    expect(r.checked).toBe(3);
    expect(r.ads.map(a => a.ad_key)).toEqual(['s1', 'm1']);
    expect(r.summary).toMatchObject({ critical: 1, warn: 1 });
  });
});
