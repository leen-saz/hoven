// /api/nav/counts: the numbers next to the sidebar entries. Each count only for a page the user may open; capped. Synthetic data.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { api } from '../../src/api/index';
import { need } from '../../src/lib/gate';

const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.test' };
const cfg = A.env(E);
const owner: A.Profile = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test', role: 'owner', active: true };
const member: A.Profile = { id: '22222222-2222-4222-8222-222222222222', email: 'm@example.test', role: 'member', dashboards: ['creative'], active: true };
const cookie = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
const call = async (who: A.Profile) => api.request('https://hoven.example/api/nav/counts', { headers: { cookie: await cookie(who) } }, E);
const ids = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: i + 1 })));

afterEach(() => { vi.unstubAllGlobals(); });

function world(who: A.Profile, suggestions: number, posts: number) {
  const seen: string[] = [];
  vi.stubGlobal('fetch', async (u: string) => {
    const url = String(u); seen.push(url);
    if (url.includes('/profiles')) return new Response(JSON.stringify([who]), { status: 200 });
    if (url.includes('/suggestions')) return new Response(ids(suggestions), { status: 200 });
    if (url.includes('/social_posts')) return new Response(ids(posts), { status: 200 });
    return new Response('[]', { status: 200 });
  });
  return seen;
}

describe('nav counts', () => {
  it('is open to any signed-in user; the route itself decides what to count', () => {
    expect(need('/api/nav/counts', '')).toBe('any');
  });
  it('counts open decisions and posts waiting for approval for the owner', async () => {
    const seen = world(owner, 3, 2);
    const r = await call(owner);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ control: 3, social: 2 });
    expect(seen.find(u => u.includes('/suggestions'))).toContain('status=eq.open');
    const posts = seen.find(u => u.includes('/social_posts'))!;
    expect(posts).toContain('approved_at=is.null');
    expect(posts).toContain('company_id=eq.');
  });
  it('counts nothing a member may not open', async () => {
    const seen = world(member, 3, 2);
    expect(await (await call(member)).json()).toEqual({});
    expect(seen.some(u => u.includes('/suggestions') || u.includes('/social_posts'))).toBe(false);
  });
  it('caps at 100 (shown as 99+)', async () => {
    world(owner, 100, 0);
    expect((await (await call(owner)).json() as Record<string, number>)['control']).toBe(100);
  });
  it('a store that fails leaves that count out', async () => {
    vi.stubGlobal('fetch', async (u: string) => String(u).includes('/profiles') ? new Response(JSON.stringify([owner]), { status: 200 }) : new Response('{}', { status: 500 }));
    expect(await (await call(owner)).json()).toEqual({});
  });
});
