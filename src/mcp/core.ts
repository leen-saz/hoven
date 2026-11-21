// Hoven's MCP server (docs/PRD.md §3.10): the one execution layer for every platform action. Hoven's own modules call
// the tools in process (callTool), Claude calls the same tools over Streamable HTTP (server.ts) with an OAuth token
// (oauth.ts). One request shape, one answer shape, the same guards whoever calls.
//  - Scope: a `read` caller cannot run a write tool. Hoven's agents are `read_write` (Leen, 2026-11-20).
//  - Money: a tool that can spend takes an idempotency key; the same key within 24 hours returns the first answer.
//  - Company: every tool reads and writes inside the caller's company only.
//  - Audit: every write call leaves a line in audit_log (and its platform change in ad_changes).
import { sb, audit, type Cfg } from '../lib/auth';
import { HOVEN_COMPANY, scoped } from '../lib/tenant';
import { claim, finish, KEY_RE } from '../lib/ads-write/idempotency';

export type Scope = 'read' | 'read_write';
// Who is calling: Hoven's agents in process, Claude over MCP, a scheduled job, or Leen's own click in a page
export type Agent = 'dream' | 'buyer' | 'social' | 'claude' | 'cron' | 'manual';
export type Fetch = typeof fetch;

export interface McpEnv { FILES?: R2Bucket }
export interface Ctx {
  cfg: Cfg;
  co: string;
  by: string;          // email of the person behind the call (Leen for her clicks and her Claude connection)
  uid?: string;
  owner: boolean;      // the person is the company's owner (the approver)
  scope: Scope;
  agent: Agent;
  env: McpEnv;
  f: Fetch;
  /** In-process callers only: progress of a long write, saved as it happens so a retry resumes */
  onProgress?: (state: unknown) => Promise<void>;
}

export class ToolError extends Error {
  constructor(public status: number, message: string, public data?: Record<string, unknown>) { super(message); }
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  write: boolean;
  money?: boolean;      // can spend: needs an idempotency key
  input: Record<string, unknown>;   // JSON Schema of the arguments
  run: (ctx: Ctx, input: Record<string, unknown>) => Promise<unknown>;
}

export type Answer = { ok: true; data: unknown } | { ok: false; status: number; error: string; data?: Record<string, unknown> };

const REGISTRY = new Map<string, Tool>();
export function register(...tools: Tool[]): void { for (const t of tools) REGISTRY.set(t.name, t); }
export const tools = (): Tool[] => [...REGISTRY.values()];
export const tool = (name: string): Tool | undefined => REGISTRY.get(name);

/** Run one tool with the guards every caller gets. Never throws: the answer says what happened. */
export async function callTool(ctx: Ctx, name: string, input: Record<string, unknown> = {}, opts: { key?: string | undefined } = {}): Promise<Answer> {
  const t = REGISTRY.get(name);
  if (!t) return { ok: false, status: 404, error: `ما فيه أداة باسم ${name}` };
  if (t.write && ctx.scope !== 'read_write') return { ok: false, status: 403, error: 'هالربط قراءة بس: الكتابة تحتاج صلاحية read_write' };
  const run = async (): Promise<Answer> => {
    try { return { ok: true, data: await t.run(ctx, input) }; } catch (err) {
      if (err instanceof ToolError) return { ok: false, status: err.status, error: err.message, ...(err.data ? { data: err.data } : {}) };
      return { ok: false, status: 502, error: String((err as Error).message || 'صار خطأ').slice(0, 400) };
    }
  };
  let out: Answer;
  if (t.money) {
    const key = opts.key;
    if (typeof key !== 'string' || !KEY_RE.test(key)) return { ok: false, status: 400, error: 'هالأداة تصرف فلوس: أرسل idempotency_key (16 إلى 80 حرف من a-z و 0-9 و _ و -)' };
    const c = await claim(ctx.cfg, ctx.co, key, `mcp:${name}`, input);
    if (c.state === 'unavailable') return { ok: false, status: 503, error: 'جدول عدم التكرار مو جاهز (migration 034_ad_writes.sql)' };
    if (c.state === 'running') return { ok: false, status: 409, error: 'نفس الطلب شغّال الحين' };
    if (c.state === 'conflict') return { ok: false, status: 409, error: 'المفتاح مستخدم لطلب ثاني' };
    if (c.state === 'done') return c.response as Answer;
    out = await run();
    await finish(ctx.cfg, ctx.co, key, out.ok ? 200 : out.status, out);
  } else out = await run();
  if (t.write) await audit(ctx.cfg, { ...(ctx.uid ? { uid: ctx.uid } : {}), email: ctx.by, co: ctx.co }, 'mcp_call', { target: { tool: name, agent: ctx.agent, ok: out.ok, ...(out.ok ? {} : { error: out.error }) } });
  return out;
}

// ---- State the tools share
type Row = Record<string, unknown>;
export const rows = <T = Row>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);

/** The connection values from the vault (names → values), server side only. */
export async function vault(cfg: Cfg, co: string): Promise<Record<string, string>> {
  if (co !== HOVEN_COMPANY) return {};   // per-company vault names come with ADR-0006's next step
  const v = await sb<{ name: string; value: string }[]>(cfg, '/rest/v1/rpc/connector_env', { method: 'POST', admin: true, body: {} });
  return Object.fromEntries((v.ok && Array.isArray(v.data) ? v.data : []).map(x => [x.name, x.value]));
}
/** The kill switch; unreadable counts as on (never spend without knowing). */
export async function killOn(cfg: Cfg): Promise<boolean> {
  const r = await sb(cfg, '/rest/v1/control_settings?platform=eq.global&select=guardrails', { admin: true });
  if (!r.ok) return true;
  return !!(rows<{ guardrails?: { kill?: boolean } }>(r.data)[0]?.guardrails?.kill);
}
/** buyer_settings for the company: goals and the managed list. */
export async function buyerSettings(cfg: Cfg, co: string): Promise<Row> {
  const r = await sb(cfg, scoped('/rest/v1/buyer_settings?select=goals,managed', co), { admin: true });
  return rows(r.data)[0] || {};
}
/** One platform change, with the state before and after (ad_changes). */
export const change = (ctx: Ctx, x: Row) => sb(ctx.cfg, '/rest/v1/ad_changes', { method: 'POST', admin: true,
  body: { company_id: ctx.co, source: ctx.agent === 'dream' || ctx.agent === 'buyer' ? ctx.agent : ctx.agent === 'claude' ? 'claude' : 'manual', by: ctx.by, ...x } });

/** The first change today (Riyadh day) to a target: its `before` is where the day started. */
export async function startOfDay(ctx: Ctx, platform: string, target: string, now = Date.now()): Promise<Row | null> {
  const riyadh = new Date(now + 3 * 3600e3).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${riyadh}T00:00:00Z`) - 3 * 3600e3).toISOString();
  const r = await sb(ctx.cfg, scoped(`/rest/v1/ad_changes?platform=eq.${encodeURIComponent(platform)}&target_id=eq.${encodeURIComponent(target)}&action=eq.set_budget&ok=eq.true&at=gte.${from}&select=before&order=at.asc&limit=1`, ctx.co), { admin: true });
  return rows(r.data)[0] || null;
}

/** The context for a call from inside Hoven: a person's click in a page, through one of Hoven's agents. */
export function ctxFor(cfg: Cfg, user: { co: string; email: string; uid: string; role: string }, env: McpEnv, agent: Agent, f: Fetch = fetch, owner = false): Ctx {
  return { cfg, co: user.co, by: user.email, uid: user.uid, owner, scope: 'read_write', agent, env, f };
}
