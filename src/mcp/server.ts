// The MCP endpoint (Streamable HTTP, JSON answers): POST /mcp with JSON-RPC 2.0. Every call carries an OAuth Bearer
// token (oauth.ts); without one the answer is 401 with the resource metadata, so a client can start the sign-in.
// Methods: initialize, ping, tools/list, tools/call (and notifications, answered 202). No server-sent stream: every
// tool answers in one response. A tool that spends takes `idempotency_key` among its arguments.
import { env, type AuthEnv } from '../lib/auth';
import { bearer, CORS } from './oauth';
import { callTool, tools, type Ctx, type McpEnv } from './core';
import './tools/ads';
import './tools/connections';
import './tools/social';
import './tools/events';

export const PROTOCOL = '2025-06-18';
const KNOWN = ['2025-06-18', '2025-03-26', '2024-11-05'];
type Msg = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const out = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...(body === null ? {} : { 'content-type': 'application/json' }), 'cache-control': 'no-store', ...CORS, ...extra } });
const err = (id: Msg['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** The tool list as MCP describes it: name, title, description, input schema and hints. */
export function listed() {
  return tools().map(t => ({
    name: t.name, title: t.title, description: t.description + (t.money ? ' Requires idempotency_key (16-80 chars of A-Za-z0-9_-); the same key within 24 h returns the first answer.' : ''),
    inputSchema: t.money ? { ...t.input, properties: { ...(t.input['properties'] as object || {}), idempotency_key: { type: 'string' } }, required: [...((t.input['required'] as string[]) || []), 'idempotency_key'] } : t.input,
    annotations: { readOnlyHint: !t.write, destructiveHint: !!t.write, idempotentHint: !!t.money, openWorldHint: true },
  }));
}

async function one(m: Msg, ctx: Ctx): Promise<unknown | null> {
  const isNote = m.id === undefined;
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return isNote ? null : err(m.id, -32600, 'Invalid Request');
  if (isNote) return null;   // notifications/initialized and friends: nothing to answer
  const p = m.params || {};
  switch (m.method) {
    case 'initialize': {
      const asked = String(p['protocolVersion'] || '');
      return { jsonrpc: '2.0', id: m.id, result: { protocolVersion: KNOWN.includes(asked) ? asked : PROTOCOL, capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'hoven', title: 'Hoven', version: '1.0.0' },
        instructions: 'أدوات هوفن على منصات الإعلانات والحسابات المربوطة. الكتابة بنفس حدود هوفن: الحملات الجديدة موقوفة، الميزانية ما ترتفع أكثر من ٢٠٪ في اليوم، التعديل على الحملات المُدارة بس، وزر الطوارئ يوقف الكل.' } };
    }
    case 'ping': return { jsonrpc: '2.0', id: m.id, result: {} };
    case 'tools/list': return { jsonrpc: '2.0', id: m.id, result: { tools: listed() } };
    case 'tools/call': {
      const name = String(p['name'] || '');
      const args = (p['arguments'] && typeof p['arguments'] === 'object' ? p['arguments'] : {}) as Record<string, unknown>;
      const { idempotency_key: key, ...input } = args;
      if (!tools().some(t => t.name === name)) return err(m.id, -32602, `Unknown tool: ${name}`);
      const a = await callTool(ctx, name, input, typeof key === 'string' ? { key } : {});
      const payload = a.ok ? a.data : { error: a.error, status: a.status, ...(a.data ? { data: a.data } : {}) };
      return { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload, isError: !a.ok } };
    }
    default: return err(m.id, -32601, `Method not found: ${m.method}`);
  }
}

export async function mcp(request: Request, e: AuthEnv & McpEnv): Promise<Response> {
  if (request.method === 'OPTIONS') return out(204, null);
  // No server-initiated stream and no sessions to end
  if (request.method !== 'POST') return out(405, null, { allow: 'POST, OPTIONS' });
  const origin = new URL(request.url).origin;
  // A browser page from another site must not drive the server (DNS rebinding): no Origin, or this one, or claude.ai
  const o = request.headers.get('origin');
  if (o && o !== origin && !/^https:\/\/([a-z0-9-]+\.)*claude\.ai$/.test(o)) return out(403, err(null, -32000, 'Origin not allowed'));
  let cfg;
  try { cfg = env(e); } catch { return out(503, err(null, -32000, 'Not configured')); }
  const who = await bearer(request, cfg);
  if (!who) return out(401, err(null, -32001, 'Sign in to Hoven'), { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="read_write"` });
  let msg: unknown;
  try { const t = await request.text(); if (t.length > 200_000) return out(413, err(null, -32600, 'Too large')); msg = JSON.parse(t); }
  catch { return out(400, err(null, -32700, 'Parse error')); }
  const ctx: Ctx = { cfg, co: who.user.co, by: who.user.email, uid: who.user.uid, owner: true, scope: who.scope, agent: 'claude', env: e, f: fetch };
  if (Array.isArray(msg)) {
    if (!msg.length) return out(400, err(null, -32600, 'Empty batch'));
    const res = (await Promise.all(msg.slice(0, 20).map(x => one(x as Msg, ctx)))).filter(x => x !== null);
    return res.length ? out(200, res) : out(202, null);
  }
  const r = await one(msg as Msg, ctx);
  return r === null ? out(202, null) : out(200, r);
}
