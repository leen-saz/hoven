// The media buyer's learning loop (src/modules/buyer/learn.ts) and managed campaigns (engine.ts, routes.ts).
// A decided proposal is measured 3 and 7 days on, written once; the 7-day result becomes a lesson waiting for Leen.
// Budget proposals go to the board only for campaigns she marked managed. Synthetic data, fetch stubbed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { api } from '../../src/api/index';
import { measure, lessonText, window, type Data } from '../../src/modules/buyer/learn';
import { cleanManaged, isManaged, addDays } from '../../src/modules/buyer/engine';

const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.test' };
const cfg = A.env(E);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Decided 2026-11-08: the week before at 100/day for 1 purchase/day (CPA 100), the week after 100/day for 2 (CPA 50)
const DECIDED = '2026-11-08';
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));
const data: Data = {
  ok: true, sales: [],
  ads: [{ ad_key: 'm1', campaign: 'شتاء', live: true }],
  metrics: [...days(addDays(DECIDED, -7), 7).map(day => ({ ad_key: 'm1', day, spend: 100, leads: 1, impressions: 1000, clicks: 20 })),
    ...days(DECIDED, 7).map(day => ({ ad_key: 'm1', day, spend: 100, leads: 2, impressions: 1000, clicks: 30 }))],
};
const suggestion = (outcomes: { day: number }[] = []) => ({ id: 41, platform: 'meta', kind: 'budget_down', campaign: 'شتاء', status: 'approved', decided_at: `${DECIDED}T10:00:00Z`, params: { from: 'buyer' }, outcomes });

function store(existing: { day: number }[], duplicate = false) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
    const url = String(u), method = init?.method ?? 'GET';
    if (url.includes('/suggestions') && method === 'GET') return new Response(JSON.stringify([suggestion(existing)]), { status: 200 });
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body));
      posts.push({ url, body });
      return new Response(url.includes('/outcomes') && duplicate ? '[]' : JSON.stringify([{ id: 1, ...body }]), { status: 201 });
    }
    return new Response('[]', { status: 200 });
  });
  return posts;
}

describe('learning loop', () => {
  it('a campaign window sums spend and purchases of its ads only', () => {
    expect(window(data, 'شتاء', 'meta', addDays(DECIDED, -7), addDays(DECIDED, -1))).toMatchObject({ spend: 700, purchases: 7, cpa: 100 });
    expect(window(data, 'شتاء', 'snap', DECIDED, addDays(DECIDED, 6)).spend).toBe(0);
  });
  it('writes the 3- and 7-day results once both windows are complete, and a lesson from the 7-day one', async () => {
    const posts = store([]);
    const r = await measure(cfg, data, '2026-11-20');
    expect(r.written).toBe(2);
    expect(r.lessons).toBe(1);
    expect(posts.filter(p => p.url.includes('/outcomes')).map(p => p.body['day'])).toEqual([3, 7]);
    const lesson = posts.find(p => p.url.includes('/lessons'))!.body;
    expect(lesson).toMatchObject({ module: 'buyer', status: 'new', source: 'outcome' });
    expect(String(lesson['lesson'])).toContain('نجح');
    expect(r.past[0]).toMatchObject({ d3: 'worked', d7: 'worked' });
  });
  it('waits for a window that is not complete yet', async () => {
    const posts = store([]);
    const r = await measure(cfg, data, addDays(DECIDED, 5));   // 3 days done, 7 not
    expect(r.written).toBe(1);
    expect(posts.some(p => p.url.includes('/lessons'))).toBe(false);
  });
  it('never measures a window twice and writes no second lesson when another run got there first', async () => {
    let posts = store([{ day: 3 }, { day: 7 }]);   // both windows already in outcomes
    expect((await measure(cfg, data, '2026-11-20')).written).toBe(0);
    expect(posts).toHaveLength(0);
    posts = store([], true);   // a parallel run already wrote both rows: the insert comes back empty
    const r = await measure(cfg, data, '2026-11-20');
    expect(r.written).toBe(0);
    expect(posts.some(p => p.url.includes('/lessons'))).toBe(false);
  });
  it('the lesson says what was done, where, and what the numbers did', () => {
    const t = lessonText('budget_up', 'شتاء', 'meta', { spend: 700, purchases: 7, cpa: 100, ctr: 2 }, { spend: 900, purchases: 12, cpa: 75, ctr: 2.5 }, 'worked');
    expect(t).toContain('رفع الميزانية'); expect(t).toContain('«شتاء»'); expect(t).toContain('ميتا');
    expect(t).toContain('100 ← 75'); expect(t).toContain('7 ← 12');
  });
});

describe('managed campaigns', () => {
  it('keeps known platforms and named campaigns, once each', () => {
    expect(cleanManaged([{ platform: 'meta', campaign: ' شتاء ' }, { platform: 'meta', campaign: 'شتاء' }, { platform: 'x', campaign: 'a' }, { platform: 'snap' }, 'junk']))
      .toEqual([{ platform: 'meta', campaign: 'شتاء' }]);
  });
  it('none marked means every campaign; once marked, only those', () => {
    expect(isManaged([], { fam: 'meta', campaign: 'أي' })).toBe(true);
    const list = cleanManaged([{ platform: 'meta', campaign: 'شتاء' }]);
    expect(isManaged(list, { fam: 'meta', campaign: 'شتاء' })).toBe(true);
    expect(isManaged(list, { fam: 'snap', campaign: 'شتاء' })).toBe(false);
  });
});

describe('managed campaigns on the API', () => {
  const owner: A.Profile = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test', role: 'owner', active: true };
  const editor: A.Profile = { id: '22222222-2222-4222-8222-222222222222', email: 'e@example.test', role: 'member', dashboards: ['buyer'], access: { buyer: 'edit' }, active: true } as A.Profile;
  const cookie = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
  const post = async (path: string, who: A.Profile, body: unknown) =>
    api.request('https://hoven.example' + path, { method: 'POST', body: JSON.stringify(body), headers: { cookie: await cookie(who), origin: 'https://hoven.example', 'content-type': 'application/json' } }, E);
  const world = (who: A.Profile, managed: unknown[]) => {
    const writes: string[] = [];
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      const url = String(u), method = init?.method ?? 'GET';
      if (url.includes('/profiles')) return new Response(JSON.stringify([who]), { status: 200 });
      if (url.includes('/buyer_settings') && method === 'GET') return new Response(JSON.stringify([{ goals: {}, rules: [], managed }]), { status: 200 });
      if (method === 'POST') { writes.push(url); return new Response(JSON.stringify([{ id: 9 }]), { status: 201 }); }
      return new Response('[]', { status: 200 });
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    return writes;
  };
  const proposal = { platform: 'meta', kind: 'budget_up', campaign: 'صيف', pct: 20, why: 'تكلفة الطلب تحت الهدف' };

  it('only an approver sets the managed list', async () => {
    world(editor, []);
    expect((await post('/api/buyer/managed', editor, { managed: [{ platform: 'meta', campaign: 'شتاء' }] })).status).toBe(403);
    const writes = world(owner, []);
    const r = await post('/api/buyer/managed', owner, { managed: [{ platform: 'meta', campaign: 'شتاء' }] });
    expect(r.status).toBe(200);
    expect(writes.some(u => u.includes('/buyer_settings'))).toBe(true);
  });
  it('a budget proposal on an unmanaged campaign is not sent to the board', async () => {
    const writes = world(owner, [{ platform: 'meta', campaign: 'شتاء' }]);
    const r = await post('/api/buyer/send', owner, { proposal });
    expect(r.status).toBe(400);
    expect((await r.json() as { error: string }).error).toContain('المُدارة');
    expect(writes.some(u => u.includes('/suggestions'))).toBe(false);
  });
  it('the same proposal goes to the board when the campaign is managed, or when none is marked yet', async () => {
    for (const managed of [[{ platform: 'meta', campaign: 'صيف' }], []]) {
      const writes = world(owner, managed);
      expect((await post('/api/buyer/send', owner, { proposal })).status).toBe(200);
      expect(writes.some(u => u.includes('/suggestions'))).toBe(true);
    }
  });
});
