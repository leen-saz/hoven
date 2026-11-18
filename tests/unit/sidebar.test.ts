// The sidebar shows each place once: no two entries share a label or open the same view.
// The performance summary and the creatives open the Overview pages only when Overview is on, else the dashboard.
import { describe, expect, it } from 'vitest';
import { sections } from '../../public/assets/sidebar.js';
import { MODULES } from '../../src/modules/registry';

type Item = { href: string; text: string; key: string; state: string };
const L = (ar: string) => ar;
const me = (over: { off?: string[]; role?: string } = {}) => ({
  role: over.role ?? 'owner', email: 'o@x', dashboards: [] as string[],
  modules: MODULES.map(m => ({ ...m, ok: true, locked: (over.off ?? []).includes(m.key) })),
});
const SAME: Record<string, string> = { '/overview/': '/', '/overview/creative/': '/?view=creative' };
const items = (m:ReturnType<typeof me>) => (sections(m, L) as { items: Item[] }[]).flatMap(s => s.items);

describe('sidebar', () => {
  for (const [name, m] of [['Overview on', me()], ['Overview off', me({ off: ['overview'] })]] as const) {
    it(`has no repeated label or view (${name})`, () => {
      const list = items(m);
      const dup = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
      expect(dup(list.map(i => i.text))).toEqual([]);
      expect(dup(list.map(i => i.href))).toEqual([]);
      // The Overview pages and the dashboard's are the same views at different links
      const view = (h: string) => SAME[h] ?? h;
      expect(dup(list.map(i => view(i.href)))).toEqual([]);
    });
  }
  it('opens the Overview page when Overview is on, the dashboard when it is off', () => {
    const on = items(me()), off = items(me({ off: ['overview'] }));
    expect(on.find(i => i.text === 'التحليلات')?.href).toBe('/overview/');
    expect(off.find(i => i.text === 'التحليلات')?.href).toBe('/');
  });
  it("is Hoven's simple menu, in Leen's order: Dream, Analytics, Media buyer, then the rest", () => {
    const list = items(me()).map(i => i.text);
    expect(list.slice(0, 3)).toEqual(['احلم', 'التحليلات', 'الميديا باير']);
    expect(list).toEqual(expect.arrayContaining(['السوشال', 'الرصد', 'المعرفة', 'الربط']));
    for (const gone of ['التصميم', 'الصوت', 'المايسترو', 'التتبع', 'الامتثال', 'المحتوى و SEO']) expect(list).not.toContain(gone);
  });
});
