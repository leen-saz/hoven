// «تلقائي» (docs/PRD.md §6.3, Leen 2026-11-20): per agent, switched on by Leen only, the agent may change campaigns
// without her click. The caps are enforced here, inside Hoven's MCP server, not by the agent:
//  - a budget rises at most max_raise_pct a day (never above the fixed 20%), and never above max_daily_sar a campaign;
//  - the agent's raises in a Riyadh day add up to at most max_total_daily_sar;
//  - only managed campaigns (the tools check), never with the kill switch on (the tools check);
//  - a campaign is switched on only when its daily budget is within max_daily_sar.
// Without caps set, «تلقائي» may only pause and lower budgets. One switch («أطفئ التلقائي») sets every agent back to
// «بموافقتي» at once. Every automatic change is in ad_changes (source auto), audit_log and an event.
import { sb, type Cfg } from '../lib/auth';
import { scoped } from '../lib/tenant';
import { MAX_DAILY_RAISE } from '../lib/ads-write/guard';
import { rows, type Ctx } from './core';

export const AGENTS = ['buyer', 'dream', 'social'] as const;
export type AutoAgent = typeof AGENTS[number];
export interface Caps { max_raise_pct: number; max_daily_sar: number | null; max_total_daily_sar: number | null }
export interface Mode { agent: AutoAgent; mode: 'approve' | 'auto'; caps: Caps; updated_by?: string | null; updated_at?: string | null }

const num = (x: unknown, max: number): number | null => { const v = Number(x); return Number.isFinite(v) && v > 0 ? Math.min(Math.round(v * 100) / 100, max) : null; };
export function cleanCaps(x: unknown): Caps {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  return { max_raise_pct: num(o['max_raise_pct'], MAX_DAILY_RAISE * 100) ?? MAX_DAILY_RAISE * 100, max_daily_sar: num(o['max_daily_sar'], 100_000), max_total_daily_sar: num(o['max_total_daily_sar'], 1_000_000) };
}
export const isAgent = (a: unknown): a is AutoAgent => typeof a === 'string' && (AGENTS as readonly string[]).includes(a);

/** Every agent's mode; a missing row (or table) is «بموافقتي». */
export async function modes(cfg: Cfg, co: string): Promise<Mode[]> {
  const r = await sb(cfg, scoped('/rest/v1/agent_modes?select=agent,mode,caps,updated_by,updated_at', co), { admin: true });
  const got = new Map(rows<Mode>(r.ok ? r.data : []).map(m => [m.agent, m]));
  return AGENTS.map(agent => { const m = got.get(agent); return { agent, mode: m?.mode === 'auto' ? 'auto' : 'approve', caps: cleanCaps(m?.caps), updated_by: m?.updated_by ?? null, updated_at: m?.updated_at ?? null }; });
}
export async function modeOf(cfg: Cfg, co: string, agent: string): Promise<Mode | null> {
  if (!isAgent(agent)) return null;
  return (await modes(cfg, co)).find(m => m.agent === agent) ?? null;
}

export type AutoAction = { action: 'pause' } | { action: 'activate'; daily: number | null } | { action: 'create_paused' }
  | { action: 'set_budget'; before: number; startOfDay: number; next: number; raisedToday: number };

/** null = this automatic change is within the caps; else why not (a sentence Leen can act on). Pure. */
export function autoRefusal(m: Mode | null, a: AutoAction): string | null {
  if (!m || m.mode !== 'auto') return 'الوكيل على «بموافقتي»: التغيير يحتاج ضغطتك';
  const c = m.caps;
  if (a.action === 'pause' || a.action === 'create_paused') return null;
  if (a.action === 'activate') {
    if (c.max_daily_sar == null) return 'التشغيل التلقائي يحتاج سقف ميزانية يومية للحملة';
    return a.daily != null && a.daily <= c.max_daily_sar + 0.005 ? null : `ميزانية الحملة فوق سقف التلقائي (${c.max_daily_sar} ر.س)`;
  }
  if (a.next <= a.before + 0.005) return null;   // lowering (or keeping) a budget is always within the caps
  if (c.max_daily_sar == null) return 'الرفع التلقائي يحتاج سقف ميزانية يومية للحملة';
  if (a.next > c.max_daily_sar + 0.005) return `الميزانية الجديدة فوق سقف التلقائي (${c.max_daily_sar} ر.س)`;
  if (a.next > a.startOfDay * (1 + c.max_raise_pct / 100) + 0.005) return `الرفع التلقائي أكثر من ${c.max_raise_pct}٪ في اليوم`;
  if (c.max_total_daily_sar != null && a.raisedToday + (a.next - a.before) > c.max_total_daily_sar + 0.005) return `مجموع الرفع التلقائي اليوم يتعدى ${c.max_total_daily_sar} ر.س`;
  return null;
}

/** What the agent raised today (Riyadh day), from its own automatic changes. */
export async function raisedToday(ctx: Ctx, now = Date.now()): Promise<number> {
  const riyadh = new Date(now + 3 * 3600e3).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${riyadh}T00:00:00Z`) - 3 * 3600e3).toISOString();
  const r = await sb(ctx.cfg, scoped(`/rest/v1/ad_changes?source=eq.auto&action=eq.set_budget&ok=eq.true&at=gte.${from}&select=before,after`, ctx.co), { admin: true });
  return rows<{ before?: { daily?: number }; after?: { daily?: number } }>(r.data)
    .reduce((t, x) => t + Math.max(0, Number(x.after?.daily ?? 0) - Number(x.before?.daily ?? 0)), 0);
}

/** Leen's switch: one agent's mode and caps, or («أطفئ التلقائي») every agent back to «بموافقتي». */
export async function setMode(cfg: Cfg, co: string, by: string, agent: AutoAgent, mode: 'approve' | 'auto', caps: Caps): Promise<boolean> {
  const r = await sb(cfg, '/rest/v1/agent_modes?on_conflict=company_id,agent', { method: 'POST', admin: true, headers: { Prefer: 'resolution=merge-duplicates' },
    body: { company_id: co, agent, mode, caps, updated_by: by, updated_at: new Date().toISOString() } });
  return r.ok;
}
export async function allOff(cfg: Cfg, co: string, by: string): Promise<boolean> {
  const r = await sb(cfg, scoped('/rest/v1/agent_modes?mode=eq.auto', co), { method: 'PATCH', admin: true, body: { mode: 'approve', updated_by: by, updated_at: new Date().toISOString() } });
  return r.ok;
}
