// Usage: Riyadh-time months, quota cleaning, guard and meter (fail-open), the admin route, and the wiring in a metered route.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { dayOf, monthStart, cleanQuotas, guard, meter, summary } from '../../src/lib/usage';
import { usage } from '../../src/api/routes/admin';
import { ROUTES } from '../../src/modules/routes';

afterEach(() => { vi.unstubAllGlobals(); });
const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(E);
const owner: A.Profile = { id: '11111111-1111-1111-1111-111111111111', email: 'leen@example.com', active: true };
const who = { co: '00000000-0000-0000-0000-000000000001' };
const cookie = async () => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(owner, cfg), cfg.secret))}`;
const req = async (path: string, init: RequestInit = {}) => new Request('https://hoven.example' + path, { ...init, headers: { cookie: await cookie(), origin: 'https://hoven.example', 'sec-fetch-site': 'same-origin' } });
type Call = { url: string; init: RequestInit };
const stub = (tables: Record<string, unknown>, calls: Call[] = []) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
  calls.push({ url, init });
  if (url.includes('/profiles?id=eq.')) return new Response(JSON.stringify([owner]));
  const t = Object.keys(tables).find(k => url.includes(k));
  return new Response(JSON.stringify(t ? tables[t] : []), { status: 200 });
}));

describe('time', () => {
  it('months and days follow Riyadh time (UTC+3)', () => {
    const t = Date.UTC(2026, 9, 31, 22, 30);          // 31 Oct 22:30 UTC = 1 Nov 01:30 in Riyadh
    expect(dayOf(t)).toBe('2026-11-01');
    expect(monthStart(t)).toBe('2026-11-01');
  });
});

describe('quotas', () => {
  it('known units only; empty or null clears; bad numbers refuse', () => {
    expect(cleanQuotas({ text: 500, voice_sec: null, hack: 1, image: '' })).toEqual({ set: { text: 500 }, clear: ['voice_sec', 'image'] });
    expect(cleanQuotas({ text: -1 })).toEqual({ error: 'رقم غير صحيح: نصوص بالذكاء الاصطناعي' });
    expect(cleanQuotas({ text: 1.5 })).toMatchObject({ error: expect.any(String) });
  });
  it('guard: no quota = go ahead; over the quota = 429; under = go ahead', async () => {
    stub({});
    expect(await guard(cfg, who, 'text')).toBeNull();
    stub({ usage_quotas: [{ unit: 'text', monthly_limit: 10 }], usage_daily: [{ module: 'copy', unit: 'text', qty: 9 }, { module: 'design', unit: 'voice_sec', qty: 999 }] });
    expect(await guard(cfg, who, 'text', 1)).toBeNull();
    const r = await guard(cfg, who, 'text', 2);
    expect(r?.status).toBe(429);
    expect(((await r!.json()) as { error: string }).error).toContain('9 من 10');
  });
  it('fails open when Supabase is down or the tables are missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await guard(cfg, who, 'text')).toBeNull();
    await expect(meter(cfg, who, 'copy', 'text')).resolves.toBeUndefined();
  });
  it('meter bumps through usage_add with the Riyadh day and whole numbers', async () => {
    const calls: Call[] = []; stub({}, calls);
    await meter(cfg, who, 'voice', 'voice_sec', 4.2);
    const c = calls.find(x => x.url.includes('/rpc/usage_add'))!;
    expect(JSON.parse(String(c.init.body))).toMatchObject({ p_company: who.co, p_module: 'voice', p_unit: 'voice_sec', p_qty: 5 });
    calls.length = 0; await meter(cfg, who, 'copy', 'text', 0);
    expect(calls.length).toBe(0);
  });
  it('summary adds the modules up per unit', async () => {
    stub({ usage_quotas: [{ unit: 'text', monthly_limit: 100 }], usage_daily: [{ module: 'copy', unit: 'text', qty: 3 }, { module: 'social', unit: 'text', qty: 2 }] });
    const s = await summary(cfg, who.co);
    expect(s.units.find(u => u.unit === 'text')).toMatchObject({ used: 5, limit: 100, byModule: { copy: 3, social: 2 } });
    expect(s.units.find(u => u.unit === 'image')).toMatchObject({ used: 0, limit: null });
  });
});

describe('routes', () => {
  it('the owner reads usage and sets/clears quotas; the change is audited', async () => {
    const calls: Call[] = []; stub({}, calls);
    const g = await usage.GET!(await req('/api/admin/usage'), E);
    expect(g.status).toBe(200);
    const p = await usage.PATCH!(await req('/api/admin/usage', { method: 'PATCH', body: JSON.stringify({ text: 50, voice_sec: null }) }), E);
    expect(p.status).toBe(200);
    expect(calls.some(c => c.url.includes('usage_quotas?on_conflict=company_id,unit') && c.init.method === 'POST')).toBe(true);
    expect(calls.some(c => c.url.includes('usage_quotas?') && c.url.includes('unit=eq.voice_sec') && c.init.method === 'DELETE')).toBe(true);
    expect(calls.some(c => c.url.includes('audit_log'))).toBe(true);
  });
  it('a metered route refuses with 429 once the quota is used up', async () => {
    stub({ usage_quotas: [{ unit: 'text', monthly_limit: 1 }], usage_daily: [{ module: 'copy', unit: 'text', qty: 1 }] });
    const llm = { ...E, XAI_API_KEY: 'k' };
    const r = await ROUTES.social.suggest.POST!(await req('/api/social/suggest', { method: 'POST', body: JSON.stringify({ brief: 'فكرة', platforms: ['x'] }) }), llm);
    expect(r.status).toBe(429);
  });
});
