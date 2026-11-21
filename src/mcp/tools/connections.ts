// Connection tools of Hoven's MCP server: which platforms are connected (names only, never a value), their health, and
// for a write the permissions each connection lacks (docs/PRD.md §3.10: Leen reconnects each account with write scopes).
import { sb } from '../../lib/auth';
import { PLATFORMS } from '../../lib/connectors';
import { permissions, META_WRITE_SCOPES } from '../adapters/meta';
import { register, vault, rows } from '../core';

// The write permissions each platform needs (docs/PRD.md §3.10). Meta is read from the token itself; the others are
// listed for the reconnect step until their adapter can ask the platform.
export const WRITE_SCOPES: Record<string, readonly string[]> = {
  meta: META_WRITE_SCOPES,
  tiktok: ['Ads Management', 'Audience Management', 'Creative Management', 'video.publish'],
  snap: ['snapchat-marketing-api'],
  google_ads: ['https://www.googleapis.com/auth/adwords'],
  x: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
};

register(
  {
    name: 'connections.list', title: 'الحسابات المربوطة', write: false,
    description: 'Which platforms are connected (setting names present, never their values) and each connection\'s health (ok, failing, down).',
    input: { type: 'object', properties: {} },
    run: async ctx => {
      const v = await vault(ctx.cfg, ctx.co);
      const h = await sb(ctx.cfg, `/rest/v1/connection_health?company_id=eq.${ctx.co}&select=platform,health,failing_since,checked_at`, { admin: true });
      const health = new Map(rows<{ platform: string }>(h.data).map(x => [x.platform, x]));
      return { platforms: PLATFORMS.map(p => {
        const need = p.fields.filter(f => !f.optional).map(f => f.env);
        const have = need.filter(k => (v[k] || '').trim());
        return { id: p.id, name: p.name, started: have.length > 0, connected: need.length > 0 && have.length === need.length, missing: need.filter(k => !have.includes(k)), health: health.get(p.id) ?? null };
      }).filter(p => p.started).map(p => ({ id: p.id, name: p.name, connected: p.connected, missing: p.missing, health: p.health })) };
    },
  },
  {
    name: 'connections.permissions', title: 'صلاحيات الكتابة الناقصة', write: false,
    description: 'For each platform: the write permissions Hoven needs, and which the stored connection lacks (Meta checked against the token; others listed).',
    input: { type: 'object', properties: {} },
    run: async ctx => {
      const v = await vault(ctx.cfg, ctx.co);
      const out: Record<string, { needed: readonly string[]; missing: string[] | null; checked: boolean; error?: string }> = {};
      for (const [p, needed] of Object.entries(WRITE_SCOPES)) out[p] = { needed, missing: null, checked: false };
      if (v['META_ACCESS_TOKEN']) {
        try { const got = await permissions(v['META_ACCESS_TOKEN'], ctx.f); out['meta'] = { needed: META_WRITE_SCOPES, missing: got.missing, checked: true }; }
        catch (err) { out['meta'] = { needed: META_WRITE_SCOPES, missing: null, checked: false, error: String((err as Error).message).slice(0, 200) }; }
      }
      return { permissions: out };
    },
  },
);
