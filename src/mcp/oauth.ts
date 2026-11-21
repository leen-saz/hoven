// OAuth 2.1 with PKCE for Hoven's MCP server (docs/PRD.md §3.10), so Claude (or any MCP client) connects as Leen:
//  - discovery: /.well-known/oauth-protected-resource and /.well-known/oauth-authorization-server
//  - dynamic client registration: POST /oauth/register (public clients, no secret)
//  - /oauth/authorize: Leen signs in to Hoven, sees who is asking and picks the scope (read or read_write, the default)
//  - /oauth/token: authorization_code with an S256 code_verifier, and refresh_token (rotated on every use)
// Only the company owner can approve a connection. Codes and tokens are stored as SHA-256 hashes (036_mcp.sql); the
// clear values exist only in the answer to the client. Revoking a connection is one click on the connectors page.
import { sb, verify, readCookie, SESSION, env, isOwner, loadProfile, sessionFor, sameOrigin, audit, json, type AuthEnv, type Cfg, type Session } from '../lib/auth';
import type { Scope } from './core';

export const SCOPES: Scope[] = ['read', 'read_write'];
const ACCESS_S = 3600, REFRESH_S = 30 * 86400, CODE_S = 600;
type Row = Record<string, unknown>;
const rows = <T = Row>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);

export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-expose-headers': 'www-authenticate, mcp-session-id' };
const cjson = (status: number, body: unknown, extra: Record<string, string> = {}) => json(status, body, { ...CORS, ...extra });
const oerr = (status: number, error: string, description: string) => cjson(status, { error, error_description: description });

export function random(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** base64url(SHA-256(verifier)): the S256 code challenge. */
export async function challengeOf(verifier: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** A redirect URI a client may register: https, or http on the loopback (desktop clients). No fragments. */
export function okRedirect(u: unknown): boolean {
  try {
    const x = new URL(String(u));
    if (x.hash) return false;
    return x.protocol === 'https:' || (x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname));
  } catch { return false; }
}
export const cleanScope = (s: unknown): Scope => (String(s || '').split(/\s+/).includes('read_write') || !s ? 'read_write' : 'read');

export function protectedResource(origin: string) {
  return { resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: SCOPES, bearer_methods_supported: ['header'], resource_name: 'Hoven' };
}
export function authServer(origin: string) {
  return {
    issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`, revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: SCOPES,
  };
}

async function body(request: Request): Promise<Record<string, string>> {
  const t = await request.text();
  if (t.length > 20000) throw new Error('too large');
  if ((request.headers.get('content-type') || '').includes('application/json')) {
    const j = (t ? JSON.parse(t) : {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, Array.isArray(v) ? JSON.stringify(v) : String(v ?? '')]));
  }
  return Object.fromEntries(new URLSearchParams(t));
}
function cfgOr(e: AuthEnv): Cfg | null { try { return env(e); } catch { return null; } }

// ---- Registration
export async function register(request: Request, e: AuthEnv): Promise<Response> {
  const cfg = cfgOr(e);
  if (!cfg) return oerr(503, 'server_error', 'not configured');
  let j: Record<string, unknown>;
  try { j = JSON.parse(await request.text()) as Record<string, unknown>; } catch { return oerr(400, 'invalid_client_metadata', 'JSON body expected'); }
  const uris = Array.isArray(j['redirect_uris']) ? (j['redirect_uris'] as unknown[]).map(String).slice(0, 10) : [];
  if (!uris.length || !uris.every(okRedirect)) return oerr(400, 'invalid_redirect_uri', 'redirect_uris must be https (or http on localhost)');
  const name = String(j['client_name'] || 'MCP client').replace(/[\u0000-\u001f<>]/g, '').slice(0, 80);
  const client_id = `hoven_${random(18)}`;
  const w = await sb(cfg, '/rest/v1/mcp_clients', { method: 'POST', admin: true, body: { client_id, name, redirect_uris: uris } });
  if (!w.ok) return oerr(503, 'server_error', 'migration 036_mcp.sql is not applied');
  return cjson(201, { client_id, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris: uris,
    token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
}

// ---- Authorization (Leen's consent)
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
function page(status: number, inner: string, formTo?: string): Response {
  const csp = `default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'${formTo ? ` ${formTo}` : ''}`;
  return new Response(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ربط Hoven</title><link rel="stylesheet" href="/assets/app.css"></head><body><main class="content" style="max-width:560px;margin:40px auto;padding:0 16px">${inner}</main></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': csp } });
}
async function owner(request: Request, cfg: Cfg): Promise<Session | null> {
  const s = await verify(readCookie(request, SESSION), cfg.secret);
  if (!s) return null;
  const p = await loadProfile(cfg, s.uid);
  if (!p || p.active === false) return null;
  return sessionFor(p, cfg);
}
interface Ask { client_id: string; redirect_uri: string; code_challenge: string; state: string; scope: Scope; resource: string }
async function readAsk(cfg: Cfg, q: Record<string, string>): Promise<{ ask?: Ask; client?: Row; error?: string; redirectable?: boolean }> {
  const c = rows((await sb(cfg, `/rest/v1/mcp_clients?client_id=eq.${encodeURIComponent(q['client_id'] || '')}&select=client_id,name,redirect_uris`, { admin: true })).data)[0];
  if (!c) return { error: 'الجهة اللي تطلب الربط مو مسجلة' };
  const uris = (c['redirect_uris'] as string[]) || [];
  if (!uris.includes(q['redirect_uri'] || '')) return { error: 'رابط الرجوع مو نفس المسجل' };
  if (q['response_type'] !== 'code') return { error: 'unsupported_response_type', redirectable: true, client: c };
  if (q['code_challenge_method'] !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(q['code_challenge'] || '')) return { error: 'invalid_request', redirectable: true, client: c };
  return { client: c, ask: { client_id: String(c['client_id']), redirect_uri: q['redirect_uri']!, code_challenge: q['code_challenge']!, state: q['state'] || '', scope: cleanScope(q['scope']), resource: q['resource'] || '' } };
}
const back = (ask: Pick<Ask, 'redirect_uri' | 'state'>, p: Record<string, string>) => {
  const u = new URL(ask.redirect_uri);
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
  if (ask.state) u.searchParams.set('state', ask.state);
  return u.toString();
};

export async function authorize(request: Request, e: AuthEnv): Promise<Response> {
  const cfg = cfgOr(e);
  if (!cfg) return page(503, '<p>الإعداد غير مكتمل.</p>');
  const url = new URL(request.url);
  const q = request.method === 'POST' ? await body(request) : Object.fromEntries(url.searchParams);
  const user = await owner(request, cfg);
  if (!user) {
    if (request.method === 'POST') return page(401, '<p>انتهت الجلسة. ارجع للتطبيق وابدأ الربط من جديد.</p>');
    const login = new URL('/login/', url.origin);
    login.searchParams.set('next', url.pathname + url.search);
    return new Response(null, { status: 302, headers: { location: login.toString(), 'cache-control': 'no-store' } });
  }
  if (!isOwner(user, cfg)) return page(403, '<p>ربط Hoven مع تطبيق خارجي للمالكة بس.</p>');
  const got = await readAsk(cfg, q);
  if (!got.ask) {
    if (got.redirectable && got.client) return Response.redirect(back({ redirect_uri: q['redirect_uri']!, state: q['state'] || '' }, { error: got.error! }), 302);
    return page(400, `<p>${esc(got.error || 'طلب ربط مو صحيح')}</p>`);
  }
  const ask = got.ask, name = esc(String(got.client!['name'] || ''));
  const to = new URL(ask.redirect_uri).origin;
  if (request.method === 'GET') {
    const hidden = Object.entries({ client_id: ask.client_id, redirect_uri: ask.redirect_uri, code_challenge: ask.code_challenge, code_challenge_method: 'S256', state: ask.state, response_type: 'code', resource: ask.resource })
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('');
    return page(200, `<section class="card pad" style="display:grid;gap:14px"><h1 style="margin:0;font-size:22px">«${name}» يبي يربط مع Hoven</h1>
<p style="margin:0">بيقدر يستخدم أدوات Hoven باسمك (${esc(user.email)}): يقرا الحملات والحسابات المربوطة${ask.scope === 'read_write' ? '، ويكتب عليها بنفس حدود هوفن: الحملات الجديدة موقوفة، و٢٠٪ بالكثير في اليوم، والحملات المُدارة بس، وزر الطوارئ' : ''}.</p>
<form method="post" action="/oauth/authorize" style="display:grid;gap:12px">${hidden}
<fieldset style="border:0;padding:0;margin:0;display:grid;gap:8px"><legend class="muted">الصلاحية</legend>
<label><input type="radio" name="scope" value="read_write"${ask.scope === 'read_write' ? ' checked' : ''}> قراءة وكتابة</label>
<label><input type="radio" name="scope" value="read"${ask.scope === 'read' ? ' checked' : ''}> قراءة بس</label></fieldset>
<p class="muted" style="margin:0">تقدر تفصل الربط أي وقت من صفحة الربط.</p>
<div style="display:flex;gap:8px"><button class="btn primary" type="submit" name="decision" value="allow">اسمح</button><button class="btn secondary" type="submit" name="decision" value="deny">لا</button></div></form></section>`, to);
  }
  // POST: the consent form
  if (!sameOrigin(request)) return page(403, '<p>طلب مرفوض.</p>');
  if (q['decision'] !== 'allow') return Response.redirect(back(ask, { error: 'access_denied' }), 302);
  const code = random(32);
  const w = await sb(cfg, '/rest/v1/mcp_codes', { method: 'POST', admin: true, body: {
    code_hash: await sha256(code), company_id: user.co, client_id: ask.client_id, user_id: user.uid, email: user.email, scope: ask.scope,
    challenge: ask.code_challenge, redirect_uri: ask.redirect_uri, expires_at: new Date(Date.now() + CODE_S * 1000).toISOString() } });
  if (!w.ok) return page(503, '<p>جدول الربط مو جاهز (migration 036_mcp.sql).</p>');
  await audit(cfg, user, 'mcp_connect', { target: { client: ask.client_id, name: got.client!['name'], scope: ask.scope } });
  return Response.redirect(back(ask, { code }), 302);
}

// ---- Tokens
async function issue(cfg: Cfg, g: { company_id: string; client_id: string; user_id: string; email: string; scope: Scope }) {
  const access = random(32), refresh = random(32), now = Date.now();
  const w = await sb(cfg, '/rest/v1/mcp_tokens', { method: 'POST', admin: true, body: [
    { token_hash: await sha256(access), kind: 'access', ...g, expires_at: new Date(now + ACCESS_S * 1000).toISOString() },
    { token_hash: await sha256(refresh), kind: 'refresh', ...g, expires_at: new Date(now + REFRESH_S * 1000).toISOString() },
  ] });
  if (!w.ok) return oerr(503, 'server_error', 'token store unavailable');
  return cjson(200, { access_token: access, token_type: 'Bearer', expires_in: ACCESS_S, refresh_token: refresh, scope: g.scope }, { pragma: 'no-cache' });
}

export async function token(request: Request, e: AuthEnv): Promise<Response> {
  const cfg = cfgOr(e);
  if (!cfg) return oerr(503, 'server_error', 'not configured');
  let b: Record<string, string>;
  try { b = await body(request); } catch { return oerr(400, 'invalid_request', 'bad body'); }
  if (b['grant_type'] === 'authorization_code') {
    const h = await sha256(b['code'] || '');
    // Used once: the update only matches an unused, unexpired code, so two exchanges cannot both win
    const r = await sb(cfg, `/rest/v1/mcp_codes?code_hash=eq.${h}&used=eq.false&expires_at=gt.${new Date().toISOString()}`, { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { used: true } });
    const c = rows<{ company_id: string; client_id: string; user_id: string; email: string; scope: Scope; challenge: string; redirect_uri: string }>(r.data)[0];
    if (!c) return oerr(400, 'invalid_grant', 'code unknown, used or expired');
    if (c.client_id !== b['client_id'] || c.redirect_uri !== b['redirect_uri']) return oerr(400, 'invalid_grant', 'client or redirect_uri mismatch');
    if (!b['code_verifier'] || (await challengeOf(b['code_verifier'])) !== c.challenge) return oerr(400, 'invalid_grant', 'PKCE verification failed');
    return issue(cfg, { company_id: c.company_id, client_id: c.client_id, user_id: c.user_id, email: c.email, scope: c.scope });
  }
  if (b['grant_type'] === 'refresh_token') {
    const h = await sha256(b['refresh_token'] || '');
    const r = await sb(cfg, `/rest/v1/mcp_tokens?token_hash=eq.${h}&kind=eq.refresh&revoked=eq.false&expires_at=gt.${new Date().toISOString()}`, { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { revoked: true } });
    const t = rows<{ company_id: string; client_id: string; user_id: string; email: string; scope: Scope }>(r.data)[0];
    if (!t || (b['client_id'] && b['client_id'] !== t.client_id)) return oerr(400, 'invalid_grant', 'refresh token unknown, used or expired');
    // A narrower scope may be asked for, never a wider one
    const scope: Scope = b['scope'] && t.scope === 'read_write' ? cleanScope(b['scope']) : t.scope;
    return issue(cfg, { company_id: t.company_id, client_id: t.client_id, user_id: t.user_id, email: t.email, scope });
  }
  return oerr(400, 'unsupported_grant_type', 'authorization_code or refresh_token');
}

export async function revoke(request: Request, e: AuthEnv): Promise<Response> {
  const cfg = cfgOr(e);
  if (!cfg) return oerr(503, 'server_error', 'not configured');
  const b = await body(request).catch(() => ({} as Record<string, string>));
  if (b['token']) await sb(cfg, `/rest/v1/mcp_tokens?token_hash=eq.${await sha256(b['token'])}`, { method: 'PATCH', admin: true, body: { revoked: true } });
  return cjson(200, {});
}

/** The caller behind a Bearer token, or null. The person must still be an active owner of the company. */
export async function bearer(request: Request, cfg: Cfg): Promise<{ user: Session; scope: Scope; client: string } | null> {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(request.headers.get('authorization') || '');
  if (!m) return null;
  const r = await sb(cfg, `/rest/v1/mcp_tokens?token_hash=eq.${await sha256(m[1]!)}&kind=eq.access&revoked=eq.false&expires_at=gt.${new Date().toISOString()}&select=company_id,user_id,scope,client_id`, { admin: true });
  const t = rows<{ company_id: string; user_id: string; scope: Scope; client_id: string }>(r.data)[0];
  if (!t) return null;
  const p = await loadProfile(cfg, t.user_id);
  if (!p || p.active === false) return null;
  const user = sessionFor(p, cfg);
  if (user.co !== t.company_id || !isOwner(user, cfg)) return null;
  return { user, scope: t.scope === 'read_write' ? 'read_write' : 'read', client: t.client_id };
}
