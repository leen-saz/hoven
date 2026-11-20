// «احلم» (src/modules/dream): parts and their versions, the guardrails on what a model writes, and the API that keeps every
// project inside its company, writes a new version per draft, marks what depends on it, and approves only the newest.
// Synthetic data; fetch stubbed (Supabase and the model).
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { api } from '../../src/api/index';
import { staleAfter, latest, missing, parseJson, cleanPart, cleanPlatforms, TEXT_PARTS, type PartRow } from '../../src/modules/dream/dream';
import { chatSystem, partPrompt } from '../../src/modules/dream/prompt';
import { HOVEN_COMPANY } from '../../src/lib/tenant';

describe('parts', () => {
  it('a new strategy makes everything built on it need a look', () => {
    expect(staleAfter('strategy').sort()).toEqual(['audience', 'budget', 'copy', 'design', 'motion', 'voiceover']);
    expect(staleAfter('copy').sort()).toEqual(['design', 'motion', 'voiceover']);
    expect(staleAfter('budget')).toEqual([]);
  });
  it('the newest version counts, and publishing needs every text part approved', () => {
    const rows: PartRow[] = [
      { id: 1, kind: 'strategy', version: 1, status: 'approved', content: {} },
      { id: 2, kind: 'strategy', version: 2, status: 'draft', content: {} },
      { id: 3, kind: 'audience', version: 1, status: 'approved', content: {} },
    ];
    expect(latest(rows).strategy?.id).toBe(2);
    expect(missing(rows)).toEqual(['strategy', 'budget', 'copy']);
    expect(missing(TEXT_PARTS.map((k, i) => ({ id: i, kind: k, version: 1, status: 'approved' as const, content: {} })))).toEqual([]);
  });
  it('reads the JSON object out of a model answer, fences and chatter included', () => {
    expect(parseJson('هذا الجواب:\n```json\n{"goal":"مبيعات"}\n```')).toEqual({ goal: 'مبيعات' });
    expect(parseJson('ما فيه JSON')).toBeNull();
    expect(parseJson('[1,2]')).toBeNull();
  });
});

describe('guardrails on what the model writes', () => {
  const ctx = { goals: { meta: { dailyBudget: 300 } }, platforms: cleanPlatforms(['meta', 'snap']) };
  it('caps a platform budget at Leen\'s planned daily budget and says so', () => {
    const b = cleanPart('budget', { days: 10, split: [{ platform: 'meta', daily: 500 }, { platform: 'snap', daily: 100 }, { platform: 'google', daily: 900 }] }, ctx)!;
    expect(b['split']).toEqual([{ platform: 'meta', daily: 300 }, { platform: 'snap', daily: 100 }]);   // google is not chosen: dropped
    expect(b['daily']).toBe(400); expect(b['total']).toBe(4000);
    expect((b['notes'] as string[])[0]).toContain('300');
    expect(b['needsOwner']).toEqual(['snap']);   // no goal for Snap: Leen types it before publishing
  });
  it('copy carries the compliance notices of each text', () => {
    const c = cleanPart('copy', { items: [{ platform: 'meta', headline: 'الأرخص في السعودية', body: 'مفارش', cta: 'اطلب' }] }, ctx)!;
    const items = c['items'] as { notices: unknown[] }[];
    expect(items).toHaveLength(1);
    expect(items[0]!.notices.length).toBeGreaterThan(0);
  });
  it('drops what is empty or for an unknown platform', () => {
    expect(cleanPart('audience', { segments: [{ platform: 'x', name: 'أ' }, { platform: 'meta' }] }, ctx)).toBeNull();
    expect(cleanPart('strategy', { phases: [] }, ctx)).toBeNull();
    expect(cleanPart('budget', { split: [{ platform: 'meta', daily: -5 }] }, ctx)).toBeNull();
  });
  it('the prompts carry goals, approved parts, the conversation and the JSON shape', () => {
    const c = { summary: null, goals: { meta: { dailyBudget: 300 } }, lessons: ['الستوري يجيب طلبات أرخص'], knowledge: '', platforms: ctx.platforms };
    expect(chatSystem(c)).toContain('الستوري يجيب طلبات أرخص');
    const p = partPrompt('budget', c, 'لين: مفارش رمضان', { strategy: { goal: 'مبيعات رمضان' } }, 'خفف الصرف');
    for (const s of ['مبيعات رمضان', 'مفارش رمضان', 'خفف الصرف', '"split"', '300']) expect(p).toContain(s);
  });
});

// ---- API
const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.test', OPENROUTER_API_KEY: 'k' };
const cfg = A.env(E);
const owner: A.Profile = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test', role: 'owner', active: true };
const editor = { id: '22222222-2222-4222-8222-222222222222', email: 'e@example.test', role: 'member', dashboards: ['dream'], access: { dream: 'edit' }, active: true } as A.Profile;
const cookie = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
const call = async (path: string, who: A.Profile, body?: unknown) => api.request('https://hoven.example' + path,
  { method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body) } : {}), headers: { cookie: await cookie(who), origin: 'https://hoven.example', 'content-type': 'application/json' } }, E);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const PROJECT = { id: 7, company_id: HOVEN_COMPANY, title: 'رمضان', idea: 'مفارش رمضان', platforms: ['meta'], status: 'drafting' };
function world(who: A.Profile, opts: { parts?: PartRow[]; project?: unknown; model?: string; missing?: boolean } = {}) {
  const seen: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
    const url = String(u), method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    seen.push({ url, method, ...(body ? { body } : {}) });
    if (url.includes('openrouter.ai')) return new Response(JSON.stringify({ choices: [{ message: { content: opts.model ?? '{"goal":"مبيعات رمضان","message":"نومة أحلى","kpi":"الطلبات"}' } }] }), { status: 200 });
    if (url.includes('/profiles')) return new Response(JSON.stringify([who]), { status: 200 });
    if (opts.missing && url.includes('/dream_')) return new Response(JSON.stringify({ code: '42P01', message: 'relation "dream_projects" does not exist' }), { status: 404 });
    if (url.includes('/dream_projects') && method === 'GET') return new Response(JSON.stringify(opts.project === undefined ? [PROJECT] : opts.project ? [opts.project] : []), { status: 200 });
    if (url.includes('/dream_parts') && method === 'GET') {
      const id = url.match(/id=eq\.(\d+)/)?.[1];
      const all = opts.parts ?? [];
      return new Response(JSON.stringify(url.includes('?id=eq.') ? all.filter(p => String(p.id) === id).map(p => ({ ...p, project_id: 7 })) : all), { status: 200 });
    }
    if (method === 'POST') return new Response(JSON.stringify([{ id: 99, ...body }]), { status: 201 });
    return new Response('[]', { status: 200 });
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  return seen;
}

describe('dream API', () => {
  it('a new project is the company\'s own, from the session', async () => {
    const seen = world(editor);
    const r = await call('/api/dream/projects', editor, { idea: 'مفارش رمضان للعرسان', platforms: ['meta', 'bogus'], company_id: 'someone-else' });
    expect(r.status).toBe(200);
    const w = seen.find(s => s.url.includes('/dream_projects') && s.method === 'POST')!.body!;
    expect(w['company_id']).toBe(HOVEN_COMPANY);
    expect(w['platforms']).toEqual(['meta']);
  });
  it('another company\'s project is not found', async () => {
    world(owner, { project: null });
    expect((await call('/api/dream/item?id=7', owner)).status).toBe(404);
  });
  it('a draft writes the next version and marks the approved parts built on it', async () => {
    const parts: PartRow[] = [{ id: 1, kind: 'strategy', version: 1, status: 'approved', content: { goal: 'قديم' } }, { id: 2, kind: 'audience', version: 1, status: 'approved', content: {} }];
    const seen = world(editor, { parts });
    const r = await call('/api/dream/draft', editor, { id: 7, kind: 'strategy', instruction: 'ركز على العرسان' });
    expect(r.status, await r.clone().text()).toBe(200);
    const w = seen.find(s => s.url.includes('/dream_parts') && s.method === 'POST')!.body!;
    expect(w).toMatchObject({ kind: 'strategy', version: 2, status: 'draft', instruction: 'ركز على العرسان' });
    const stale = seen.find(s => s.url.includes('/dream_parts') && s.method === 'PATCH')!;
    expect(stale.url).toContain('status=eq.approved');
    expect(stale.url).toContain('audience');
    expect(stale.body).toEqual({ status: 'stale' });
  });
  it('an answer that is not a usable part is refused, not stored', async () => {
    const seen = world(editor, { model: 'آسف ما أقدر' });
    const r = await call('/api/dream/draft', editor, { id: 7, kind: 'strategy' });
    expect(r.status).toBe(502);
    expect(seen.some(s => s.url.includes('/dream_parts') && s.method === 'POST')).toBe(false);
  });
  it('media parts wait for the next milestone', async () => {
    world(editor);
    expect((await call('/api/dream/draft', editor, { id: 7, kind: 'design' })).status).toBe(400);
  });
  it('approving needs the approve level, and only the newest version', async () => {
    const parts: PartRow[] = [{ id: 1, kind: 'strategy', version: 1, status: 'draft', content: {} }, { id: 2, kind: 'strategy', version: 2, status: 'draft', content: {} }];
    world(editor, { parts });
    expect((await call('/api/dream/approve', editor, { id: 2 })).status).toBe(403);
    world(owner, { parts });
    expect((await call('/api/dream/approve', owner, { id: 1 })).status).toBe(409);
    const seen = world(owner, { parts });
    const r = await call('/api/dream/approve', owner, { id: 2 });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ missing: ['audience', 'budget', 'copy'] });
    expect(seen.find(s => s.url.includes('/dream_parts?id=eq.2') && s.method === 'PATCH')!.body).toMatchObject({ status: 'approved', approved_by: 'owner@example.test' });
  });
  it('before 033_dream.sql the list says what to run instead of failing', async () => {
    world(owner, { missing: true });
    const r = await call('/api/dream/projects', owner);
    expect(r.status).toBe(200);
    expect(JSON.stringify(await r.json())).toContain('033_dream.sql');
  });
});
