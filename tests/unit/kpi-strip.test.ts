// The KPI strip (public/assets/app.css .kpis) must fit beside the sidebar at any width: the fixed 4 columns cut the
// numbers between 900 and 1100px (PR #36). Checked in a browser at 360-1920px; this guards the rules that make it fit.
import { describe, expect, it } from 'vitest';
import css from '../../public/assets/app.css?raw';
const rule = (sel: string) => css.match(new RegExp(`(?:^|\\n|\\})${sel.replace(/[.*]/g, '\\$&')}\\{([^}]*)\\}`))?.[1] ?? '';

describe('KPI strip', () => {
  it('lets the grid choose how many columns fit', () => {
    expect(rule('.kpis')).toMatch(/repeat\(auto-fit,minmax\(min\(100%,\d+px\),1fr\)\)/);
    expect(css).not.toMatch(/\.kpis\{[^}]*repeat\(4,/);
  });
  it('lets a number shrink and wrap instead of overflowing its column', () => {
    expect(rule('.kpi')).toContain('min-width:0');
    expect(rule('.kpi .v')).toMatch(/clamp\(/);
    expect(rule('.kpi .v')).toContain('overflow-wrap:anywhere');
  });
  it('never pulls the strip wider than the narrowest page padding (16px on phones)', () => {
    const m = rule('.kpis').match(/margin:\S+ -(\d+)px/);
    expect(Number(m?.[1])).toBeLessThanOrEqual(16);
  });
});
