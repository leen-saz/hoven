// Health of the connected accounts (docs/PRD.md §3.6), checked every hour apart from the data pull: a light read with the
// stored key. One failure = «متعثر» (failing); still failing an hour later = «منفصل» (down). Any success = ok again, so a
// passing glitch never shows as a disconnect. Codes only are stored; no token, no platform message.
// Meta (ads key) and the Facebook page today; the other platforms join as their keys move to the vault.
import { sb, type Cfg } from './auth';
import { HOVEN_COMPANY } from './tenant';

export const GRACE_MS = 3600e3;
export type Health = 'ok' | 'failing' | 'down';
export interface State { health: Health; failing_since: string | null; code: string | null }

/** The next state from the previous one and this check. */
export function nextHealth(prev: State | null, ok: boolean, code: string | null, now = Date.now()): State {
  if (ok) return { health: 'ok', failing_since: null, code: null };
  const since = prev?.failing_since ?? new Date(now).toISOString();
  return { health: now - Date.parse(since) >= GRACE_MS ? 'down' : 'failing', failing_since: since, code };
}

const GRAPH = 'https://graph.facebook.com/v23.0/';
type Check = (v: Record<string, string>, f: typeof fetch) => Promise<{ ok: boolean; code: string | null } | null>;
// null = not connected (nothing to check)
const meta: Check = async (v, f) => {
  if (!v['META_ACCESS_TOKEN']) return null;
  const r = await f(`${GRAPH}me?fields=id&access_token=${encodeURIComponent(v['META_ACCESS_TOKEN'])}`).catch(() => null);
  if (!r) return { ok: false, code: 'network' };
  return r.ok ? { ok: true, code: null } : { ok: false, code: r.status === 401 || r.status === 400 ? 'token' : `http_${r.status}` };
};
const pages: Check = async (v, f) => {
  if (!v['META_PAGE_ACCESS_TOKEN'] || !v['META_PAGE_ID']) return null;
  const r = await f(`${GRAPH}${encodeURIComponent(v['META_PAGE_ID'])}?fields=id&access_token=${encodeURIComponent(v['META_PAGE_ACCESS_TOKEN'])}`).catch(() => null);
  if (!r) return { ok: false, code: 'network' };
  return r.ok ? { ok: true, code: null } : { ok: false, code: r.status === 401 || r.status === 400 ? 'token' : `http_${r.status}` };
};
export const CHECKS: Record<string, Check> = { meta, meta_pages: pages };

/** One round for Hoven's vault (per-company vault names come with ADR-0006). Returns the states written. */
export async function runAccountHealth(cfg: Cfg, f: typeof fetch = fetch, now = Date.now()): Promise<Record<string, State>> {
  const v = await sb<{ name: string; value: string }[]>(cfg, '/rest/v1/rpc/connector_env', { method: 'POST', admin: true, body: {} });
  const vault = Object.fromEntries((v.ok && Array.isArray(v.data) ? v.data : []).map(x => [x.name, x.value]));
  const prevR = await sb<(State & { platform: string })[]>(cfg, `/rest/v1/connection_health?company_id=eq.${HOVEN_COMPANY}&select=platform,health,failing_since,code`, { admin: true });
  if (!prevR.ok) return {};   // 035 not run yet: nothing to write to
  const prev = new Map((Array.isArray(prevR.data) ? prevR.data : []).map(x => [x.platform, x]));
  const out: Record<string, State> = {};
  for (const [platform, check] of Object.entries(CHECKS)) {
    const got = await check(vault, f);
    if (!got) continue;
    const st = nextHealth(prev.get(platform) ?? null, got.ok, got.code, now);
    out[platform] = st;
    await sb(cfg, '/rest/v1/connection_health?on_conflict=company_id,platform', { method: 'POST', admin: true, headers: { Prefer: 'resolution=merge-duplicates' },
      body: { company_id: HOVEN_COMPANY, platform, ...st, checked_at: new Date(now).toISOString() } });
  }
  console.log(`account health: ${Object.entries(out).map(([k, s]) => `${k}=${s.health}`).join(' ') || 'nothing connected'}`);
  return out;
}
