// Idempotency for anything that spends money (docs/PRD.md §3.4): the page sends an Idempotency-Key with each click; the
// same key within 24 hours returns the first answer instead of calling the platform again. A key still running answers 409.
// Table: idempotency_keys (034_ad_writes.sql). Old keys are deleted on the next claim after 24 hours.
import { sb, type Cfg } from '../auth';

export const KEY_RE = /^[A-Za-z0-9_-]{16,80}$/;
const HOURS = 24;

async function hash(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export type Claim =
  | { state: 'new' }
  | { state: 'done'; status: number; response: unknown }
  | { state: 'running' }
  | { state: 'conflict' }       // same key, different request
  | { state: 'unavailable' };   // the table is missing or the store failed: the caller refuses (never spends without the guard)

/** Claim `key` for this request. Only 'new' lets the caller go on. */
export async function claim(cfg: Cfg, co: string, key: string, scope: string, request: unknown, now = Date.now()): Promise<Claim> {
  const h = await hash(JSON.stringify(request));
  // Housekeeping: keys older than a day free their slot
  await sb(cfg, `/rest/v1/idempotency_keys?created_at=lt.${new Date(now - HOURS * 3600e3).toISOString()}`, { method: 'DELETE', admin: true }).catch(() => null);
  const w = await sb(cfg, '/rest/v1/idempotency_keys', { method: 'POST', admin: true, headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: { key, company_id: co, scope, request_hash: h } });
  if (!w.ok) return { state: 'unavailable' };
  if (Array.isArray(w.data) && w.data.length) return { state: 'new' };
  const r = await sb(cfg, `/rest/v1/idempotency_keys?key=eq.${encodeURIComponent(key)}&company_id=eq.${co}&select=scope,request_hash,status,response`, { admin: true });
  const row = (r.ok && Array.isArray(r.data) ? r.data[0] : null) as { scope: string; request_hash: string; status: number | null; response: unknown } | null;
  if (!row) return { state: 'unavailable' };
  if (row.scope !== scope || row.request_hash !== h) return { state: 'conflict' };
  return row.status == null ? { state: 'running' } : { state: 'done', status: row.status, response: row.response };
}

/** Store the answer for `key`, so a repeat gets the same one. */
export async function finish(cfg: Cfg, co: string, key: string, status: number, response: unknown): Promise<void> {
  await sb(cfg, `/rest/v1/idempotency_keys?key=eq.${encodeURIComponent(key)}&company_id=eq.${co}`, { method: 'PATCH', admin: true, body: { status, response } });
}
