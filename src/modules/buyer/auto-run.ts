// The media buyer in «تلقائي» (docs/PRD.md §6.3): a proposal on a managed campaign is carried out at once through Hoven's
// MCP server instead of waiting on the decision board. The caps live in the tools (src/mcp/auto.ts); this only turns a
// proposal into a tool call and records it as a decided suggestion, so the learning loop measures it at 3 and 7 days.
// Meta today; a proposal the tools cannot carry out (another platform, a creative refresh) goes to the board as before.
import { sb, type Cfg } from '../../lib/auth';
import { callTool, ctxFor, type McpEnv } from '../../mcp/core';
import { sha256 } from '../../mcp/oauth';
import '../../mcp/tools/ads';
import type { Rec } from './engine';

type Row = Record<string, unknown>;
export const AUTO_KINDS = ['pause', 'budget_up', 'budget_down'] as const;
export const canAuto = (r: Rec): boolean => r.fam === 'meta' && (AUTO_KINDS as readonly string[]).includes(r.kind) && !!r.campaign;

export interface AutoResult { key: string; ok: boolean; error?: string; suggestion?: number; before?: number | null; after?: number | null }

/** Carry out one proposal as the buyer agent. `s` is the suggestion row it becomes (toSuggestion). */
export async function runAuto(cfg: Cfg, user: { co: string; email: string; uid: string; role: string }, env: McpEnv, r: Rec, s: Row, f: typeof fetch = fetch): Promise<AutoResult> {
  const ctx = ctxFor(cfg, user, env, 'buyer', f, false);   // never as Leen: the agent's own mode and caps decide
  const list = await callTool(ctx, 'ads.list_campaigns', { platform: 'meta' });
  if (!list.ok) return { key: r.key, ok: false, error: list.error };
  const camp = ((list.data as { campaigns: Row[] }).campaigns || []).find(c => c['name'] === r.campaign);
  if (!camp) return { key: r.key, ok: false, error: 'ما لقيت الحملة في ميتا' };
  // One key per proposal per Riyadh day: a second send the same day returns the first answer
  const day = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const key = `auto_${(await sha256(`${r.key}|${day}`)).slice(0, 40)}`;
  let a;
  if (r.kind === 'pause') a = await callTool(ctx, 'ads.set_status', { platform: 'meta', campaign_id: String(camp['id']), status: 'PAUSED' }, { key });
  else {
    const daily = Number(camp['daily']);
    if (!Number.isFinite(daily) || daily <= 0) return { key: r.key, ok: false, error: 'الحملة ما لها ميزانية يومية وحدة' };
    const pct = Math.min(Math.max(Number(r.pct) || 0, 0), 20) / 100;
    const next = Math.round(daily * (r.kind === 'budget_up' ? 1 + pct : 1 - pct) * 100) / 100;
    a = await callTool(ctx, 'ads.set_budget', { platform: 'meta', campaign_id: String(camp['id']), daily: next, why: String(r.why || '').slice(0, 300) }, { key });
  }
  if (!a.ok) return { key: r.key, ok: false, error: a.error };
  // A decided suggestion: the learning loop (learn.ts) measures it like one Leen approved
  const now = new Date().toISOString();
  const w = await sb(cfg, '/rest/v1/suggestions', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: { ...s, status: 'executed', decided_by: 'auto', decided_at: now, result: { auto: true, ...(a.data as Row) }, params: { ...(s['params'] as Row || {}), auto: true } } });
  const sid = Array.isArray(w.data) ? Number((w.data[0] as Row | undefined)?.['id']) || undefined : undefined;
  const d = a.data as { before?: number; daily?: number };
  return { key: r.key, ok: true, ...(sid ? { suggestion: sid } : {}), before: d.before ?? null, after: d.daily ?? null };
}
