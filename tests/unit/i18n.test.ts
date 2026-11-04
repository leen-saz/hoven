// English: the Hoven additions translate, never shadow an older translation, and carry no Arabic.
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('location', { search: '?lang=en', href: 'https://x/?lang=en', pathname: '/' });
vi.stubGlobal('localStorage', { getItem: () => 'en', setItem() {} });
vi.stubGlobal('sessionStorage', { getItem: () => null, setItem() {}, removeItem() {} });
vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 });
vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
vi.stubGlobal('document', { documentElement: {}, readyState: 'complete', title: '', body: { nodeType: 1, querySelectorAll: () => [] }, addEventListener() {}, createTreeWalker: () => ({ nextNode: () => null }) });

const { t } = await import('../../public/assets/i18n.js');
const { EXTRA } = await import('../../public/assets/i18n-hoven.js') as { EXTRA: Record<string, string> };

describe('english additions', () => {
  it('the new pages and messages translate', () => {
    expect(t('المكتبة')).toBe('Library');
    expect(t('احفظ الحدود')).toBe('Save limits');
    expect(t('كود التحقق')).toBe('Verification code');
    expect(t('الكود غلط')).toBe('Wrong code');
    expect(t('  حمّل PNG  ')).toBe('  Download PNG  ');                // surrounding spaces stay
    expect(t('الأحد')).toBe('Sunday');
    expect(t('ديسمبر')).toBe('December');
  });
  it('nothing in the dictionary is left in Arabic, and keys are real strings', () => {
    expect(Object.keys(EXTRA).length).toBeGreaterThan(600);
    for (const [k, v] of Object.entries(EXTRA)) {
      expect(v, k).not.toMatch(/[؀-ۿ]/);
      expect(v.trim(), k).not.toBe('');
      expect(k, k).not.toMatch(/\\["']/);                              // escaped quotes from the source would never match
    }
  });
  it('an existing translation wins over the additions', () => {
    expect(t('حسابي')).toBe('My account');
  });
  it('Arabic stays Arabic when there is no entry', () => {
    expect(t('نص ما له ترجمة أبداً')).toBe('نص ما له ترجمة أبداً');
  });
});
