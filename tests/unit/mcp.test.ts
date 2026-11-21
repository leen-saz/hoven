// Hoven's MCP server (src/mcp, docs/PRD.md §3.10): OAuth 2.1 + PKCE, the JSON-RPC endpoint, scopes, idempotency, the
// budget rules inside the tools, and the rule that no module calls a platform API outside the adapters.
// Supabase and Graph are stubbed with a small in-memory store; nothing reaches a real service.
/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { HOVEN_COMPANY } from '../../src/lib/tenant';
import { mcp } from '../../src/mcp/index';
import { challengeOf, okRedirect, cleanScope } from '../../src/mcp/oauth';
import { callTool, type Ctx } from '../../src/mcp/core';
import { listed } from '../../src/mcp/server';
import '../../src/mcp/tools/ads';
import '../../src/mcp/tools/connections';

const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.test' };
const cfg = A.env(E);
const ORIGIN = 'https://hoven.example';
const owner = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test', role: 'owner', active: true, company_id: HOVEN_COMPANY } as A.Profile & Row;
const member = { id: '22222222-2222-4222-8222-222222222222', email: 'm@example.test', role: 'member', dashboards: ['connectors'], active: true, company_id: HOVEN_COMPANY } as A.Profile & Row;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type Row = Record<string, unknown>;
// A tiny PostgREST: eq/gt filters, POST (one or many rows), PATCH with return=representation
function store(seed: Record<string, Row[]> = {}, opts: { graph?: (url: string, init?: RequestInit) => Response | null } = {}) {
  const db: Record<string, Row[]> = { mcp_clients: [], mcp_codes: [], mcp_tokens: [], profiles: [owner, member], audit_log: [], ad_changes: [], idempotency_keys: [], ...seed };
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const match = (r: Row, q: URLSearchParams) => [...q].every(([k, v]) => {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) return true;
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    const x = r[k];
    if (op === 'eq') return String(x) === decodeURIComponent(val);
    if (op === 'gt') return String(x) > val;
    if (op === 'gte') return String(x) >= val;
    if (op === 'lt') return String(x) < val;
    return true;
  });
  vi.stubGlobal('fetch', async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u), method = init?.method ?? 'GET';
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    if (!url.startsWith('https://sb.example')) return opts.graph?.(url, init) ?? new Response('{}', { status: 404 });
    const p = new URL(url);
    if (p.pathname.startsWith('/rest/v1/rpc/connector_env')) return new Response(JSON.stringify(db['vault'] || []), { status: 200 });
    const table = p.pathname.replace('/rest/v1/', '');
    const t = (db[table] ||= []);
    if (method === 'GET') {
      let out = t.filter(r => match(r, p.searchParams));
      if (table === 'mcp_tokens') out = out.map(r => ({ ...r, client: db['mcp_clients']!.find(c => c['client_id'] === r['client_id']) ?? null }));
      return new Response(JSON.stringify(out), { status: 200 });
    }
    if (method === 'POST') {
      const add = ((Array.isArray(body) ? body : [body]) as Row[]).map(a => ({ ...(table === 'mcp_codes' ? { used: false } : table === 'mcp_tokens' ? { revoked: false } : {}), ...a }));
      if (table === 'idempotency_keys' && add.some(a => t.some(r => r['key'] === (a as Row)['key']))) return new Response('[]', { status: 201 });
      t.push(...add);
      return new Response(JSON.stringify(add), { status: 201 });
    }
    if (method === 'PATCH') {
      const hit = t.filter(r => match(r, p.searchParams));
      for (const r of hit) Object.assign(r, body);
      return new Response(JSON.stringify(hit), { status: 200 });
    }
    if (method === 'DELETE') return new Response('[]', { status: 200 });
    return new Response('[]', { status: 200 });
  });
  return { db, calls };
}
const cookie = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
const req = (path: string, init: RequestInit = {}) => mcp.request(ORIGIN + path, init, E);

async function connect(scope = 'read_write') {
  const reg = await req('/oauth/register', { method: 'POST', body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }), headers: { 'content-type': 'application/json' } });
  expect(reg.status).toBe(201);
  const { client_id } = await reg.json() as { client_id: string };
  const verifier = 'v'.repeat(64);
  const q = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: await challengeOf(verifier), code_challenge_method: 'S256', state: 'st', scope });
  const allow = await req('/oauth/authorize', { method: 'POST', body: new URLSearchParams({ ...Object.fromEntries(q), scope, decision: 'allow' }).toString(),
    headers: { cookie: await cookie(owner), origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' } });
  expect(allow.status).toBe(302);
  const back = new URL(allow.headers.get('location')!);
  expect(back.searchParams.get('state')).toBe('st');
  const code = back.searchParams.get('code')!;
  return { client_id, verifier, code, q };
}
const exchange = (x: { client_id: string; verifier: string; code: string }, verifier = x.verifier) => req('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', code: x.code, client_id: x.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_verifier: verifier }).toString() });
const rpc = (token: string | null, body: unknown) => req('/mcp', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });

describe('OAuth 2.1 + PKCE', () => {
  it('publishes its metadata', async () => {
    store();
    const pr = await (await req('/.well-known/oauth-protected-resource')).json() as Row;
    expect(pr).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
    const as = await (await req('/.well-known/oauth-authorization-server')).json() as Row;
    expect(as).toMatchObject({ code_challenge_methods_supported: ['S256'], token_endpoint: `${ORIGIN}/oauth/token`, registration_endpoint: `${ORIGIN}/oauth/register` });
  });
  it('registers https and loopback redirects only', () => {
    expect(okRedirect('https://claude.ai/cb')).toBe(true);
    expect(okRedirect('http://localhost:3000/cb')).toBe(true);
    expect(okRedirect('http://evil.example/cb')).toBe(false);
    expect(okRedirect('javascript:alert(1)')).toBe(false);
    expect(cleanScope('read')).toBe('read');
    expect(cleanScope('')).toBe('read_write');
  });
  it('the consent page needs Leen signed in; a member is refused', async () => {
    store();
    const { q } = await connect();
    const anon = await req(`/oauth/authorize?${q}`);
    expect(anon.status).toBe(302);
    expect(anon.headers.get('location')).toContain('/login/');
    const m = await req(`/oauth/authorize?${q}`, { headers: { cookie: await cookie(member) } });
    expect(m.status).toBe(403);
    const o = await req(`/oauth/authorize?${q}`, { headers: { cookie: await cookie(owner) } });
    expect(o.status).toBe(200);
    const page = await o.text();
    expect(page).toContain('Claude');
    expect(o.headers.get('content-security-policy')).toContain('form-action \'self\' https://claude.ai');
  });
  it('a code is exchanged once, with the right verifier; codes and tokens are stored as hashes', async () => {
    const { db } = store();
    const x = await connect();
    expect((await exchange(x, 'w'.repeat(64))).status).toBe(400);
    // the failed try spent the code (single use), so connect again
    const y = await connect();
    const ok = await exchange(y);
    expect(ok.status, await ok.clone().text()).toBe(200);
    const t = await ok.json() as { access_token: string; refresh_token: string; scope: string };
    expect(t.scope).toBe('read_write');
    expect((await exchange(y)).status).toBe(400);
    const stored = JSON.stringify(db['mcp_tokens']) + JSON.stringify(db['mcp_codes']);
    expect(stored).not.toContain(t.access_token);
    expect(stored).not.toContain(y.code);
  });
  it('a refresh token rotates: the old one stops working', async () => {
    store();
    const t = await (await exchange(await connect())).json() as { refresh_token: string };
    const ref = (rt: string) => req('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt }).toString() });
    expect((await ref(t.refresh_token)).status).toBe(200);
    expect((await ref(t.refresh_token)).status).toBe(400);
  });
});

describe('the MCP endpoint', () => {
  it('without a token: 401 pointing at the resource metadata', async () => {
    store();
    const r = await rpc(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource');
  });
  it('initialize, tools/list and notifications', async () => {
    store();
    const { access_token } = await (await exchange(await connect())).json() as { access_token: string };
    const init = await (await rpc(access_token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json() as { result: Row };
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'hoven' } });
    expect((await rpc(access_token, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    const list = await (await rpc(access_token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json() as { result: { tools: { name: string; inputSchema: { required?: string[] } }[] } };
    const names = list.result.tools.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['ads.list_campaigns', 'ads.create_campaign', 'ads.set_status', 'ads.set_budget', 'connections.permissions']));
    expect(list.result.tools.find(t => t.name === 'ads.set_budget')!.inputSchema.required).toContain('idempotency_key');
  });
  it('a read-only connection cannot write; a money tool needs a key', async () => {
    store();
    const ro = await (await exchange(await connect('read'))).json() as { access_token: string };
    const w = await (await rpc(ro.access_token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ads.set_status', arguments: { platform: 'meta', campaign_id: '123', status: 'PAUSED', idempotency_key: 'k'.repeat(20) } } })).json() as { result: { isError: boolean; structuredContent: { status: number } } };
    expect(w.result.isError).toBe(true);
    expect(w.result.structuredContent.status).toBe(403);
    const rw = await (await exchange(await connect())).json() as { access_token: string };
    const nk = await (await rpc(rw.access_token, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ads.set_status', arguments: { platform: 'meta', campaign_id: '123', status: 'PAUSED' } } })).json() as { result: { isError: boolean; structuredContent: { error: string } } };
    expect(nk.result.isError).toBe(true);
    expect(nk.result.structuredContent.error).toContain('idempotency_key');
  });
  it('a revoked connection is refused at once', async () => {
    const { db } = store();
    const { access_token } = await (await exchange(await connect())).json() as { access_token: string };
    for (const t of db['mcp_tokens']!) t['revoked'] = true;
    expect((await rpc(access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
  });
  it('a browser page from another site cannot drive it', async () => {
    store();
    const r = await req('/mcp', { method: 'POST', body: '{}', headers: { origin: 'https://evil.example' } });
    expect(r.status).toBe(403);
  });
});

describe('tools keep the rules whoever calls', () => {
  const VAULT = [{ name: 'META_ACCESS_TOKEN', value: 'T' }, { name: 'META_AD_ACCOUNT_ID', value: '1' }, { name: 'META_PAGE_ID', value: 'P' }, { name: 'META_PIXEL_ID', value: 'X' }];
  const ctx = (over: Partial<Ctx> = {}): Ctx => ({ cfg, co: HOVEN_COMPANY, by: 'owner@example.test', owner: true, scope: 'read_write', agent: 'claude', env: {}, f: fetch, ...over });
  // Campaign 555 «شتاء» at 100 SAR/day on the campaign
  const graph = (writes: string[]) => (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { writes.push(url); return new Response('{"success":true}', { status: 200 }); }
    if (url.includes('/555?') && url.includes('fields=daily_budget&')) return new Response(JSON.stringify({ daily_budget: '12000' }), { status: 200 });
    if (url.includes('/555?')) return new Response(JSON.stringify({ id: '555', name: 'شتاء', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '10000' }), { status: 200 });
    if (url.includes('me/permissions')) return new Response(JSON.stringify({ data: [{ permission: 'ads_management', status: 'granted' }, { permission: 'pages_manage_posts', status: 'declined' }] }), { status: 200 });
    return null;
  };
  const seed = (managed: Row[]) => ({ vault: VAULT, buyer_settings: [{ company_id: HOVEN_COMPANY, goals: {}, managed }], control_settings: [{ platform: 'global', guardrails: { kill: false } }] });

  it('a budget rises at most 20% a day, only on a managed campaign, and is recorded before and after', async () => {
    const writes: string[] = [];
    const { db } = store(seed([{ platform: 'meta', campaign: 'شتاء' }]), { graph: graph(writes) });
    const up = await callTool(ctx(), 'ads.set_budget', { platform: 'meta', campaign_id: '555', daily: 130 }, { key: 'a'.repeat(20) });
    expect(up.ok).toBe(false);
    expect(writes).toHaveLength(0);
    const ok = await callTool(ctx(), 'ads.set_budget', { platform: 'meta', campaign_id: '555', daily: 120, why: 'تكلفة الطلب تحت الهدف' }, { key: 'b'.repeat(20) });
    expect(ok).toMatchObject({ ok: true, data: { before: 100, daily: 120 } });
    expect(writes).toHaveLength(1);
    expect(db['ad_changes']!.find(c => c['ok'] !== false)).toMatchObject({ action: 'set_budget', before: { daily: 100 }, source: 'claude' });
    // the same key again: the stored answer, no second write
    expect(await callTool(ctx(), 'ads.set_budget', { platform: 'meta', campaign_id: '555', daily: 120, why: 'تكلفة الطلب تحت الهدف' }, { key: 'b'.repeat(20) })).toMatchObject({ ok: true });
  });
  it('an unmanaged campaign is not changed, and nobody but the approver writes', async () => {
    const writes: string[] = [];
    store(seed([{ platform: 'meta', campaign: 'صيف' }]), { graph: graph(writes) });
    const r = await callTool(ctx(), 'ads.set_budget', { platform: 'meta', campaign_id: '555', daily: 110 }, { key: 'c'.repeat(20) });
    expect(r).toMatchObject({ ok: false, status: 403 });
    store(seed([{ platform: 'meta', campaign: 'شتاء' }]), { graph: graph(writes) });
    expect(await callTool(ctx({ owner: false, agent: 'buyer' }), 'ads.set_budget', { platform: 'meta', campaign_id: '555', daily: 110 }, { key: 'd'.repeat(20) })).toMatchObject({ ok: false, status: 403 });
    expect(writes).toHaveLength(0);
  });
  it('the missing write permissions come from the token itself', async () => {
    store(seed([]), { graph: graph([]) });
    const r = await callTool(ctx({ scope: 'read' }), 'connections.permissions');
    const meta = (r as { data: { permissions: Record<string, { checked: boolean; missing: string[] }> } }).data.permissions['meta']!;
    expect(meta.checked).toBe(true);
    expect(meta.missing).toContain('pages_manage_posts');
    expect(meta.missing).not.toContain('ads_management');
  });
  it('every tool is listed with a schema', () => {
    for (const t of listed()) expect(t.inputSchema).toMatchObject({ type: 'object' });
  });
});

describe('one MCP for every platform action', () => {
  // Platform API hosts may appear only in the adapters (docs/PRD.md §3.10), apart from connection setup.
  const src = import.meta.glob('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const HOSTS = /https:\/\/(graph\.facebook\.com|graph\.instagram\.com|adsapi\.snapchat\.com|business-api\.tiktok\.com\/open_api|googleads\.googleapis\.com|api\.(?:twitter|x)\.com\/2)/;
  const ALLOWED = [
    /\/src\/mcp\/adapters\//,
    /\.test\.ts$/, /graph-mock\.ts$/,
    // connection setup (OAuth and the key check on save): the token vault side, not a platform action
    /\/src\/lib\/connectors\.ts$/, /\/src\/lib\/mcp-oauth\.ts$/,
  ];
  it('no other module calls a platform API', () => {
    const bad = Object.entries(src).filter(([f, s]) => HOSTS.test(s) && !ALLOWED.some(a => a.test(f))).map(([f]) => f);
    expect(bad).toEqual([]);
  });
});

describe('milestone 11: social, health, events and jobs through the MCP server', () => {
  const ctx = (over: Partial<Ctx> = {}): Ctx => ({ cfg, co: HOVEN_COMPANY, by: 'owner@example.test', owner: true, scope: 'read_write', agent: 'claude', env: {}, f: fetch, ...over });
  const post = (o: Row = {}) => ({ id: 9, company_id: HOVEN_COMPANY, platforms: ['facebook'], body: 'hi', media: [], publish_at: '2026-11-01T10:00:00Z', mode: 'manual', status: 'scheduled', results: {}, company: null, ...o });

  it('social.publish leaves an unapproved post alone, and posts an approved due one once', async () => {
    const graph: string[] = [];
    const { db } = store({ social_posts: [post()], vault: [{ name: 'META_PAGE_ACCESS_TOKEN', value: 't' }, { name: 'META_PAGE_ID', value: 'p' }] },
      { graph: url => { graph.push(url); return new Response(JSON.stringify({ id: 'g1' }), { status: 200 }); } });
    expect(await callTool(ctx(), 'social.publish', { post_id: 9 })).toMatchObject({ ok: false, status: 409 });
    expect(graph).toHaveLength(0);
    db['social_posts']![0]!['approved_at'] = '2026-11-01T09:00:00Z';
    expect(await callTool(ctx(), 'social.publish', { post_id: 9 })).toMatchObject({ ok: true, data: { status: 'published' } });
    expect(graph).toHaveLength(1);
    expect(db['mcp_events']!.at(-1)).toMatchObject({ kind: 'social.published', tool: 'social.publish' });
    // published: a second call does nothing
    expect(await callTool(ctx(), 'social.publish', { post_id: 9 })).toMatchObject({ ok: false });
    expect(graph).toHaveLength(1);
  });
  it('jobs.get and events.list read state in one shape', async () => {
    store({ social_posts: [post({ status: 'published' })], mcp_events: [{ id: 1, company_id: HOVEN_COMPANY, kind: 'account.down', seen: false, at: '2026-11-01T10:00:00Z' }] });
    expect(await callTool(ctx({ scope: 'read' }), 'jobs.get', { kind: 'social_post', id: 9 })).toMatchObject({ ok: true, data: { status: 'published', done: true } });
    expect(await callTool(ctx({ scope: 'read' }), 'events.list', { unseen: true })).toMatchObject({ ok: true, data: { events: [{ kind: 'account.down' }] } });
  });
  it('an account that goes down raises an event once', async () => {
    const { runAccountHealth } = await import('../../src/lib/account-health');
    const { db } = store({ vault: [{ name: 'META_ACCESS_TOKEN', value: 't' }], connection_health: [{ company_id: HOVEN_COMPANY, platform: 'meta', health: 'failing', failing_since: '2026-11-01T08:00:00Z', code: 'token' }] });
    const dead = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await runAccountHealth(cfg, dead, Date.parse('2026-11-01T10:00:00Z'));
    expect(db['mcp_events']!.filter(e => e['kind'] === 'account.down')).toHaveLength(1);
  });
});
