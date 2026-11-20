// Command palette (public/assets/palette.js): the places it offers are exactly the sidebar's open entries, plus actions
// that only appear when their page is open to the user.
import { describe, expect, it, vi } from 'vitest';
import { MODULES } from '../../src/modules/registry';

vi.stubGlobal('navigator', { platform: 'Linux', userAgent: 'test' });
vi.stubGlobal('document', { documentElement: { lang: 'ar' }, addEventListener() {}, querySelector() { return null; } });
vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
vi.stubGlobal('location', { search: '', pathname: '/', href: 'https://hoven.example/' });
vi.stubGlobal('window', { addEventListener() {} });
const { entries, GO } = await import('../../public/assets/palette.js');

const me = (role: string, dashboards: string[] = []) => ({ role, email: 'o@x', dashboards, modules: MODULES.map(m => ({ ...m, ok: role === 'owner' || dashboards.includes(m.key), locked: false })) });

describe('command palette', () => {
  it('offers the owner every place in the menu and the actions', () => {
    const texts = entries(me('owner'), 'ar').map(x => String(x.text));
    for (const t of ['احلم', 'التحليلات', 'الميديا باير', 'لوحة القرارات', 'التواصل الاجتماعي', 'الرصد', 'المعرفة', 'فكرة حملة جديدة', 'منشور جديد']) expect(texts).toContain(t);
  });
  it('hides a place and its action from a member who may not open it', () => {
    const texts = entries(me('member', ['buyer']), 'ar').map(x => String(x.text));
    expect(texts).toContain('الميديا باير');
    expect(texts).not.toContain('منشور جديد');
    expect(texts).not.toContain('فكرة حملة جديدة');
  });
  it('has a shortcut for each main place', () => {
    expect(GO).toMatchObject({ d: '/dream/', a: '/overview/', b: '/buyer/', s: '/social/' });
  });
});
