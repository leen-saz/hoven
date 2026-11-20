// Writes to ad platforms (docs/PRD.md §3.4, §6.3): the guard, idempotency, the Meta writer, and Dream's «انشر»/«شغّل».
// Synthetic data; Supabase and Graph stubbed. Nothing here reaches a real platform.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { api } from '../../src/api/index';
import { HOVEN_COMPANY } from '../../src/lib/tenant';
import { checkWrite, checkBudget, minor } from '../../src/lib/ads-write/guard';
import { bodies, createPaused, setStatus, metaConfig, ages, genders, ctaOf, type MetaConfig, type Plan } from '../../src/lib/ads-write/meta';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('guard', () => {
  const s = { kill: false, owner: true, managed: true };
  it('only Leen writes; the kill switch stops everything but a pause', () => {
    expect(checkWrite('create_paused', { ...s, owner: false })).toContain('لين');
    expect(checkWrite('activate', { ...s, kill: true })).toContain('الطوارئ');
    expect(checkWrite('pause', { ...s, kill: true })).toBeNull();
    expect(checkWrite('pause', { ...s, kill: true, owner: false })).not.toBeNull();
  });
  it('changes only on managed campaigns; creating (paused) is how a campaign becomes managed', () => {
    expect(checkWrite('activate', { ...s, managed: false })).toContain('المُدارة');
    expect(checkWrite('set_budget', { ...s, managed: false })).toContain('المُدارة');
    expect(checkWrite('create_paused', { ...s, managed: false })).toBeNull();
  });
  it('a new budget is within the plan or typed by Leen; a change never rises more than 20% a day', () => {
    expect(checkBudget({ planned: 300, next: 300 })).toBeNull();
    expect(checkBudget({ planned: 300, next: 301 })).toContain('خطتك');
    expect(checkBudget({ planned: 300, typed: 450, next: 450 })).toBeNull();
    expect(checkBudget({ next: 200 })).toContain('اكتبها');
    expect(checkBudget({ typed: 200, next: 200 })).toBeNull();
    expect(checkBudget({ startOfDay: 100, next: 120 })).toBeNull();
    expect(checkBudget({ startOfDay: 100, next: 121 })).toContain('20٪');
    expect(checkBudget({ typed: 1e6, next: 1e6 })).not.toBeNull();
    expect(checkBudget({ typed: 0, next: 0 })).not.toBeNull();
  });
  it('SAR to halalas', () => { expect(minor(300.5)).toBe(30050); });
});

describe('Meta writer', () => {
  const cfg: MetaConfig = { token: 'TOKEN', account: '123', page: 'PAGE', pixel: 'PIX' };
  const plan: Plan = { name: 'رمضان · احلم', daily: 300, link: 'https://hoven.example/p', targeting: { ...ages('25-44'), genders: genders('نساء') },
    ads: [{ headline: 'مفارش رمضان', body: 'نومة أحلى', cta: 'اطلب الحين', image_key: 'k1' }, { headline: 'ثاني', body: 'ن', image_key: 'k2' }] };

  it('the campaign is created paused; ad set and ads under it; purchases on the pixel; budget in halalas', () => {
    const b = bodies(cfg, plan);
    expect(b.campaign).toMatchObject({ objective: 'OUTCOME_SALES', status: 'PAUSED' });
    expect(b.adset('C')).toMatchObject({ campaign_id: 'C', daily_budget: 30000, optimization_goal: 'OFFSITE_CONVERSIONS', promoted_object: { pixel_id: 'PIX', custom_event_type: 'PURCHASE' },
      targeting: { geo_locations: { countries: ['SA'] }, age_min: 25, age_max: 44, genders: [2] } });
    expect(b.creative(plan.ads[0]!, 'H').object_story_spec.link_data).toMatchObject({ link: plan.link, image_hash: 'H', name: 'مفارش رمضان', call_to_action: { type: 'SHOP_NOW' } });
  });
  it('reads ages and genders from the audience text, within what Meta allows', () => {
    expect(ages('15-80')).toEqual({ ageMin: 18, ageMax: 65 });
    expect(ages('الكل')).toEqual({});
    expect(genders('الكل')).toEqual([]);
    expect(ctaOf('اعرف أكثر')).toBe('LEARN_MORE');
  });

  function graph(failAt?: string) {
    const calls: { path: string; body: string }[] = [];
    let n = 0;
    const f = (async (u: string, init?: RequestInit) => {
      const path = String(u).replace('https://graph.facebook.com/v23.0/', '').split('?')[0]!;
      const body = init?.body instanceof URLSearchParams ? init.body.toString() : init?.body instanceof FormData ? '[form]' : '';
      calls.push({ path, body });
      if (failAt && path.endsWith(failAt)) return new Response(JSON.stringify({ error: { message: 'Invalid parameter', error_user_msg: 'الرابط غير صحيح' } }), { status: 400 });
      if (path.endsWith('/adimages')) return new Response(JSON.stringify({ images: { 'k.jpg': { hash: `H${++n}` } } }));
      if (!init?.method || init.method === 'GET') return new Response(JSON.stringify({ status: 'ACTIVE', effective_status: 'ACTIVE' }));
      return new Response(JSON.stringify({ id: `${path.split('/').pop()}-${++n}` }));
    }) as unknown as typeof fetch;
    return { f, calls };
  }
  const file = async () => ({ bytes: new Uint8Array([1, 2, 3]).buffer, type: 'image/jpeg' });

  it('creates campaign, ad set, then image → creative → ad per design; the token is in the body, never the URL', async () => {
    const { f, calls } = graph();
    const saves: unknown[] = [];
    const d = await createPaused(cfg, plan, {}, file, async x => { saves.push(structuredClone(x)); }, f);
    expect(calls.map(c => c.path)).toEqual(['act_123/campaigns', 'act_123/adsets', 'act_123/adimages', 'act_123/adcreatives', 'act_123/ads', 'act_123/adimages', 'act_123/adcreatives', 'act_123/ads']);
    expect(calls.every(c => !c.path.includes('TOKEN'))).toBe(true);
    expect(Object.keys(d.ads!)).toEqual(['k1', 'k2']);
    expect(saves.length).toBe(8);   // progress saved after every object
  });
  it('a retry resumes from what exists: no second campaign', async () => {
    const first = graph('/adcreatives');
    let saved = {};
    await expect(createPaused(cfg, plan, {}, file, async x => { saved = structuredClone(x); }, first.f)).rejects.toThrow('الرابط غير صحيح');
    const again = graph();
    await createPaused(cfg, plan, saved, file, async () => {}, again.f);
    expect(again.calls.some(c => c.path.endsWith('/campaigns') || c.path.endsWith('/adsets'))).toBe(false);
    expect(again.calls.filter(c => c.path.endsWith('/adimages'))).toHaveLength(1);   // k1's picture was already uploaded
  });
  it('switching on reads the status back from Meta', async () => {
    const { f, calls } = graph();
    expect(await setStatus(cfg, 'C9', 'ACTIVE', f)).toEqual({ status: 'ACTIVE', effective: 'ACTIVE' });
    expect(calls[0]).toMatchObject({ path: 'C9' });
    expect(calls[0]!.body).toContain('status=ACTIVE');
  });
  it('names what is missing in the connections', () => {
    expect(metaConfig({ META_ACCESS_TOKEN: 't', META_AD_ACCOUNT_ID: '1' }).missing).toEqual(['META_PAGE_ID', 'META_PIXEL_ID']);
    expect(metaConfig({ META_ACCESS_TOKEN: 't', META_AD_ACCOUNT_ID: 'act_1', META_PAGE_ID: 'p', META_PIXEL_ID: 'x' }).cfg?.account).toBe('act_1');
  });
});

// ---- «انشر» and «شغّل» through the API
const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.test' };
const cfgA = A.env(E);
const owner: A.Profile = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test', role: 'owner', active: true };
const editor = { id: '22222222-2222-4222-8222-222222222222', email: 'e@example.test', role: 'member', dashboards: ['dream'], access: { dream: 'approve' }, active: true } as A.Profile;
const cookie = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfgA), cfgA.secret))}`;
const KEY = `motion/${HOVEN_COMPANY}/${'a'.repeat(32)}.jpg`;
const ok = (kind: string, content: unknown) => ({ id: kind.length, kind, version: 1, status: 'approved', content });
const PARTS = [ok('strategy', { goal: 'م' }), ok('audience', { segments: [{ platform: 'meta', name: 'عرسان', age: '25-40', gender: 'الكل' }] }),
  ok('budget', { split: [{ platform: 'meta', daily: 300 }], daily: 300, days: 14, total: 4200 }), ok('copy', { items: [] }),
  ok('design', { images: [{ key: KEY, platform: 'meta', headline: 'مفارش رمضان', body: 'نومة أحلى', cta: 'اطلب الحين' }] })];
const VAULT = [{ name: 'META_ACCESS_TOKEN', value: 'TOKEN' }, { name: 'META_AD_ACCOUNT_ID', value: '123' }, { name: 'META_PAGE_ID', value: 'PAGE' }, { name: 'META_PIXEL_ID', value: 'PIX' }];

function world(who: A.Profile, o: { kill?: boolean; goals?: unknown; parts?: unknown[]; keyRow?: unknown; launch?: unknown } = {}) {
  const seen: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
    const url = String(u), method = init?.method ?? 'GET';
    let body: Record<string, unknown> | undefined;
    try { body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined; } catch { /* form */ }
    seen.push({ url, method, ...(body ? { body } : {}) });
    const j = (x: unknown, s = 200) => new Response(JSON.stringify(x), { status: s });
    if (url.startsWith('https://graph.facebook.com/')) {
      if (url.includes('/adimages')) return j({ images: { a: { hash: 'H1' } } });
      if (method === 'GET') return j({ status: 'PAUSED', effective_status: 'PAUSED' });
      return j({ id: `id-${seen.length}` });
    }
    if (url.includes('/profiles')) return j([who]);
    if (url.includes('/idempotency_keys') && method === 'POST') return o.keyRow ? j([], 201) : j([{ key: 'k' }], 201);
    if (url.includes('/idempotency_keys') && method === 'GET') return j([o.keyRow]);
    if (url.includes('/control_settings')) return j([{ guardrails: { kill: !!o.kill } }]);
    if (url.includes('/dream_projects') && method === 'GET') return j([{ id: 7, company_id: HOVEN_COMPANY, title: 'رمضان', platforms: ['meta', 'snap'] }]);
    if (url.includes('/dream_parts')) return j(o.parts ?? PARTS);
    if (url.includes('/buyer_settings') && method === 'GET') return j([{ goals: o.goals ?? { meta: { dailyBudget: 300 } }, managed: [] }]);
    if (url.includes('/rpc/connector_env')) return j(VAULT);
    if (url.includes('/dream_launches') && method === 'GET') return j(o.launch ? [o.launch] : []);
    if (method === 'POST') return j([{ id: 55 }], 201);
    return j([]);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  return seen;
}
const FILES = { get: async () => ({ arrayBuffer: async () => new Uint8Array([1]).buffer, httpMetadata: { contentType: 'image/jpeg' } }) };
const post = async (path: string, who: A.Profile, body: unknown) => api.request('https://hoven.example' + path,
  { method: 'POST', body: JSON.stringify(body), headers: { cookie: await cookie(who), origin: 'https://hoven.example', 'content-type': 'application/json' } }, { ...E, FILES });
const K = 'key-0123456789abcdef';
const graphCalls = (seen: { url: string }[]) => seen.filter(s => s.url.startsWith('https://graph.facebook.com/'));

describe('«انشر»', () => {
  it('creates a paused Meta campaign, records every write, adds it to the managed list; Snap says «later»', async () => {
    const seen = world(owner);
    const r = await post('/api/dream/publish', owner, { id: 7, key: K, link: 'https://hoven.example/p' });
    expect(r.status, await r.clone().text()).toBe(200);
    const { launches } = await r.json() as { launches: { platform: string; status: string }[] };
    expect(launches).toEqual([expect.objectContaining({ platform: 'meta', status: 'created' }), expect.objectContaining({ platform: 'snap', status: 'soon' })]);
    const camp = graphCalls(seen).find(s => s.url.endsWith('/campaigns'))!;
    expect(camp).toBeTruthy();
    expect(seen.find(s => s.url.includes('/ad_changes'))!.body).toMatchObject({ platform: 'meta', action: 'create_paused', source: 'dream', by: 'owner@example.test' });
    expect(seen.find(s => s.url.includes('/buyer_settings') && s.method === 'POST')!.body!['managed']).toEqual([{ platform: 'meta', campaign: 'رمضان · احلم' }]);
    expect(seen.some(s => s.url.includes('/idempotency_keys') && s.method === 'PATCH')).toBe(true);
  });
  it('only Leen publishes, and never with the kill switch on', async () => {
    let seen = world(editor);
    expect((await post('/api/dream/publish', editor, { id: 7, key: K, link: 'https://hoven.example/p' })).status).toBe(403);
    expect(graphCalls(seen)).toHaveLength(0);
    seen = world(owner, { kill: true });
    const r = await post('/api/dream/publish', owner, { id: 7, key: K, link: 'https://hoven.example/p' });
    expect(r.status).toBe(403);
    expect((await r.json() as { error: string }).error).toContain('الطوارئ');
    expect(graphCalls(seen)).toHaveLength(0);
  });
  it('a budget above the plan is refused unless Leen typed it', async () => {
    let seen = world(owner, { goals: { meta: { dailyBudget: 200 } } });
    let r = await post('/api/dream/publish', owner, { id: 7, key: K, link: 'https://hoven.example/p' });
    expect((await r.json() as { launches: { status: string }[] }).launches[0]).toMatchObject({ status: 'refused' });
    expect(graphCalls(seen)).toHaveLength(0);
    seen = world(owner, { goals: { meta: { dailyBudget: 200 } } });
    r = await post('/api/dream/publish', owner, { id: 7, key: 'key-typed-0123456789', link: 'https://hoven.example/p', budgets: { meta: 300 } });
    expect((await r.json() as { launches: { status: string }[] }).launches[0]).toMatchObject({ status: 'created' });
  });
  it('the same key returns the first answer without calling Meta again', async () => {
    const seen = world(owner, { keyRow: { scope: 'dream_publish:7', request_hash: await sha({ id: 7, link: 'https://hoven.example/p' }), status: 200, response: { launches: [{ platform: 'meta', status: 'created' }] } } });
    const r = await post('/api/dream/publish', owner, { id: 7, key: K, link: 'https://hoven.example/p' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ launches: [{ platform: 'meta', status: 'created' }] });
    expect(graphCalls(seen)).toHaveLength(0);
  });
  it('without a key, with unapproved parts or a bad link: refused before any platform call', async () => {
    let seen = world(owner);
    expect((await post('/api/dream/publish', owner, { id: 7, link: 'https://hoven.example/p' })).status).toBe(400);
    seen = world(owner, { parts: PARTS.slice(0, 4) });
    expect((await post('/api/dream/publish', owner, { id: 7, key: K, link: 'https://hoven.example/p' })).status).toBe(400);
    seen = world(owner);
    expect((await post('/api/dream/publish', owner, { id: 7, key: K, link: 'http://insecure.example' })).status).toBe(400);
    expect(graphCalls(seen)).toHaveLength(0);
  });
  it('a platform already created is not created again', async () => {
    const seen = world(owner, { launch: { id: 3, status: 'created', external: { campaign_id: 'C1' } } });
    const r = await post('/api/dream/publish', owner, { id: 7, key: K, link: 'https://hoven.example/p' });
    expect((await r.json() as { launches: unknown[] }).launches[0]).toMatchObject({ status: 'created', already: true, campaign_id: 'C1' });
    expect(graphCalls(seen)).toHaveLength(0);
  });
});

describe('«شغّل» and pause', () => {
  const launch = { id: 3, platform: 'meta', status: 'created', external: { campaign_id: 'C1' }, project_id: 7 };
  it('switches the campaign on and reads it back; pausing works even with the kill switch on', async () => {
    let seen = world(owner, { launch });
    let r = await post('/api/dream/activate', owner, { launch: 3, on: true, key: K });
    expect(r.status, await r.clone().text()).toBe(200);
    expect(graphCalls(seen)[0]!.url).toContain('C1');
    seen = world(owner, { launch: { ...launch, status: 'active' }, kill: true });
    expect((await post('/api/dream/activate', owner, { launch: 3, on: true, key: 'key-on-again-0123456' })).status).toBe(403);
    r = await post('/api/dream/activate', owner, { launch: 3, on: false, key: 'key-pause-0123456789' });
    expect(r.status).toBe(200);
    expect(seen.some(s => s.url.includes('/ad_changes') && s.body?.['action'] === 'pause')).toBe(true);
  });
});

async function sha(x: unknown) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ ...(x as object), budgets: undefined })));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
