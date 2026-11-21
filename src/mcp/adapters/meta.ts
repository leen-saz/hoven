// The Meta adapter of Hoven's MCP server (src/mcp, docs/PRD.md §3.10): the only code that talks to the Graph API for ads.
// Meta Marketing API writes (Graph v23.0) for «انشر» in Dream (docs/PRD.md §3.4, §6.3). The campaign is created PAUSED;
// its ad sets and ads are created active under it, so nothing delivers until Leen switches the campaign on (one click,
// one call), and pausing it again stops everything (the reversal).
// Resumable: every object created is written to `done` as it happens; a retry skips what exists and goes on from there,
// so a failure halfway never makes a second campaign. The token never leaves the server and never reaches a log.
import { minor } from '../../lib/ads-write/guard';

export const GRAPH = 'https://graph.facebook.com/v23.0/';

export interface MetaConfig { token: string; account: string; page: string; pixel: string }
export interface AdText { headline: string; body: string; cta?: string; image_key: string }
export interface Plan {
  name: string; daily: number; link: string; startTime?: string;
  targeting: { ageMin?: number; ageMax?: number; genders?: number[] };
  ads: AdText[];
}
// What exists so far on Meta for this launch (stored in dream_launches.external)
export interface Done { campaign_id?: string; adset_id?: string; images?: Record<string, string>; creatives?: Record<string, string>; ads?: Record<string, string> }
export type Fetch = typeof fetch;
export type GetFile = (key: string) => Promise<{ bytes: ArrayBuffer; type: string } | null>;

const act = (id: string) => (id.startsWith('act_') ? id : `act_${id}`);
export const CTA: Record<string, string> = { 'اطلب الحين': 'SHOP_NOW', 'تسوّق': 'SHOP_NOW', 'تسوق الحين': 'SHOP_NOW', 'اكتشف': 'LEARN_MORE', 'اعرف أكثر': 'LEARN_MORE' };
export const ctaOf = (t = '') => CTA[t.trim()] || 'SHOP_NOW';

/** Age range from Dream's audience text ("25-44"); Meta allows 18 to 65. */
export function ages(s: string): { ageMin?: number; ageMax?: number } {
  const m = /(\d{2})\s*[-–]\s*(\d{2})/.exec(s || '');
  if (!m) return {};
  const a = Math.max(18, Math.min(65, Number(m[1]))), b = Math.max(a, Math.min(65, Number(m[2])));
  return { ageMin: a, ageMax: b };
}
/** Meta genders: 1 men, 2 women; empty = everyone. */
export const genders = (s: string): number[] => (/نساء|نسائي|women|female/i.test(s || '') ? [2] : /رجال|رجالي|men|male/i.test(s || '') ? [1] : []);

/** The request bodies, in order (pure: tested without a network). */
export function bodies(cfg: MetaConfig, plan: Plan) {
  const targeting: Record<string, unknown> = { geo_locations: { countries: ['SA'] }, targeting_automation: { advantage_audience: 0 } };
  if (plan.targeting.ageMin) targeting['age_min'] = plan.targeting.ageMin;
  if (plan.targeting.ageMax) targeting['age_max'] = plan.targeting.ageMax;
  if (plan.targeting.genders?.length) targeting['genders'] = plan.targeting.genders;
  return {
    campaign: { name: plan.name, objective: 'OUTCOME_SALES', status: 'PAUSED', special_ad_categories: [], is_adset_budget_sharing_enabled: false },
    adset: (campaignId: string) => ({
      name: `${plan.name} · مجموعة`, campaign_id: campaignId, daily_budget: minor(plan.daily), billing_event: 'IMPRESSIONS',
      optimization_goal: 'OFFSITE_CONVERSIONS', bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      promoted_object: { pixel_id: cfg.pixel, custom_event_type: 'PURCHASE' }, targeting, status: 'ACTIVE',
      ...(plan.startTime ? { start_time: plan.startTime } : {}),
    }),
    creative: (ad: AdText, hash: string) => ({
      name: `${plan.name} · ${ad.headline}`.slice(0, 200),
      object_story_spec: { page_id: cfg.page, link_data: { message: ad.body, name: ad.headline, link: plan.link, image_hash: hash, call_to_action: { type: ctaOf(ad.cta), value: { link: plan.link } } } },
    }),
    ad: (ad: AdText, adsetId: string, creativeId: string) => ({ name: `${plan.name} · ${ad.headline}`.slice(0, 200), adset_id: adsetId, creative: { creative_id: creativeId }, status: 'ACTIVE' }),
  };
}

// Meta's own error, without the token (the URL carries none: the token goes in the form body)
async function call(f: Fetch, token: string, path: string, body: Record<string, unknown> | FormData, method = 'POST'): Promise<Record<string, unknown>> {
  let init: RequestInit;
  if (body instanceof FormData) { body.append('access_token', token); init = { method, body }; }
  else {
    const form = new URLSearchParams({ access_token: token });
    for (const [k, v] of Object.entries(body)) form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
    init = { method, body: form };
  }
  const r = await f(GRAPH + path, init);
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || j['error']) {
    const e = (j['error'] || {}) as { message?: string; error_user_msg?: string; code?: number; error_subcode?: number };
    throw Object.assign(new Error(String(e.error_user_msg || e.message || `Meta ${r.status}`).slice(0, 400)), { code: e.code, subcode: e.error_subcode, status: r.status });
  }
  return j;
}

/**
 * Create the campaign (paused), its ad set and one ad per approved design. `save` stores progress after every object, so
 * a retry resumes. Returns what exists on Meta at the end.
 */
export async function createPaused(cfg: MetaConfig, plan: Plan, done: Done, getFile: GetFile, save: (d: Done) => Promise<void>, f: Fetch = fetch): Promise<Done> {
  const b = bodies(cfg, plan), a = act(cfg.account);
  const d: Done = { images: {}, creatives: {}, ads: {}, ...done };
  if (!d.campaign_id) { d.campaign_id = String((await call(f, cfg.token, `${a}/campaigns`, b.campaign))['id']); await save(d); }
  if (!d.adset_id) { d.adset_id = String((await call(f, cfg.token, `${a}/adsets`, b.adset(d.campaign_id)))['id']); await save(d); }
  for (const ad of plan.ads) {
    const k = ad.image_key;
    if (!d.images![k]) {
      const file = await getFile(k);
      if (!file) throw new Error('صورة التصميم ما انلقت');
      const form = new FormData();
      form.append('filename', new Blob([file.bytes], { type: file.type }), k.split('/').pop() || 'design.jpg');
      const j = await call(f, cfg.token, `${a}/adimages`, form);
      const images = (j['images'] || {}) as Record<string, { hash?: string }>;
      const hash = Object.values(images)[0]?.hash;
      if (!hash) throw new Error('Meta ما رجع رقم الصورة');
      d.images![k] = hash; await save(d);
    }
    if (!d.creatives![k]) { d.creatives![k] = String((await call(f, cfg.token, `${a}/adcreatives`, b.creative(ad, d.images![k]!)))['id']); await save(d); }
    if (!d.ads![k]) { d.ads![k] = String((await call(f, cfg.token, `${a}/ads`, b.ad(ad, d.adset_id, d.creatives![k]!)))['id']); await save(d); }
  }
  return d;
}

/** Switch the campaign on or off, then read back what Meta says it is. */
export async function setStatus(cfg: MetaConfig, campaignId: string, status: 'ACTIVE' | 'PAUSED', f: Fetch = fetch): Promise<{ status: string; effective: string }> {
  await call(f, cfg.token, campaignId, { status });
  const r = await f(`${GRAPH}${campaignId}?fields=status,effective_status&access_token=${encodeURIComponent(cfg.token)}`);
  const j = (await r.json().catch(() => ({}))) as { status?: string; effective_status?: string };
  return { status: j.status || status, effective: j.effective_status || '' };
}

/** The settings from the vault (connector_env), or which are missing. */
export function metaConfig(v: Record<string, string>): { cfg?: MetaConfig; missing: string[] } {
  const need = { token: 'META_ACCESS_TOKEN', account: 'META_AD_ACCOUNT_ID', page: 'META_PAGE_ID', pixel: 'META_PIXEL_ID' } as const;
  const missing = Object.values(need).filter(k => !(v[k] || '').trim());
  if (missing.length) return { missing };
  return { cfg: { token: v[need.token]!.trim(), account: v[need.account]!.trim(), page: v[need.page]!.trim(), pixel: v[need.pixel]!.trim() }, missing: [] };
}

// ---- Reads and budget changes (MCP tools ads.get_campaign, ads.list_campaigns, ads.set_budget)
async function get(f: Fetch, token: string, path: string, fields: string): Promise<Record<string, unknown>> {
  const sep = path.includes('?') ? '&' : '?';
  const r = await f(`${GRAPH}${path}${sep}fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`);
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || j['error']) {
    const e = (j['error'] || {}) as { message?: string; error_user_msg?: string; code?: number };
    throw Object.assign(new Error(String(e.error_user_msg || e.message || `Meta ${r.status}`).slice(0, 400)), { code: e.code, status: r.status });
  }
  return j;
}

export interface Campaign { id: string; name: string; status: string; effective: string; daily: number | null; level: 'campaign' | 'adset' | null; budget_id: string | null }
const sar = (x: unknown) => (x == null || x === '' ? null : Math.round(Number(x)) / 100);

/**
 * One campaign with where its daily budget lives: on the campaign (CBO) or, with a single ad set, on that ad set.
 * Several ad sets with their own budgets: no single budget to change (daily null).
 */
export async function getCampaign(cfg: MetaConfig, id: string, f: Fetch = fetch): Promise<Campaign> {
  const c = await get(f, cfg.token, id, 'id,name,status,effective_status,daily_budget');
  const base = { id: String(c['id']), name: String(c['name'] || ''), status: String(c['status'] || ''), effective: String(c['effective_status'] || '') };
  if (c['daily_budget'] != null) return { ...base, daily: sar(c['daily_budget']), level: 'campaign', budget_id: base.id };
  const s = await get(f, cfg.token, `${id}/adsets?limit=3`, 'id,daily_budget');
  const sets = (Array.isArray(s['data']) ? s['data'] : []) as { id: string; daily_budget?: string }[];
  if (sets.length === 1 && sets[0]!.daily_budget != null) return { ...base, daily: sar(sets[0]!.daily_budget), level: 'adset', budget_id: String(sets[0]!.id) };
  return { ...base, daily: null, level: null, budget_id: null };
}

/** The account's campaigns (name, status, campaign budget), newest first, at most 100. */
export async function listCampaigns(cfg: MetaConfig, f: Fetch = fetch): Promise<{ id: string; name: string; status: string; effective: string; daily: number | null }[]> {
  const j = await get(f, cfg.token, `${act(cfg.account)}/campaigns?limit=100`, 'id,name,status,effective_status,daily_budget');
  return ((Array.isArray(j['data']) ? j['data'] : []) as Record<string, unknown>[]).map(c => ({
    id: String(c['id']), name: String(c['name'] || ''), status: String(c['status'] || ''), effective: String(c['effective_status'] || ''), daily: sar(c['daily_budget']),
  }));
}

/** Set the daily budget where it lives (campaign or its single ad set), then read it back. */
export async function setBudget(cfg: MetaConfig, c: Campaign, daily: number, f: Fetch = fetch): Promise<{ daily: number | null }> {
  if (!c.budget_id) throw new Error('هالحملة ميزانيتها موزعة على أكثر من مجموعة: غيّرها من مدير الإعلانات');
  await call(f, cfg.token, c.budget_id, { daily_budget: String(minor(daily)) });
  const j = await get(f, cfg.token, c.budget_id, 'daily_budget');
  return { daily: sar(j['daily_budget']) };
}

// What Hoven's MCP needs from a Meta connection to write (docs/PRD.md §3.10). Checked against what Meta says the token holds.
export const META_WRITE_SCOPES = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement',
  'pages_manage_posts', 'pages_manage_engagement', 'pages_messaging', 'instagram_basic', 'instagram_content_publish',
  'instagram_manage_comments', 'instagram_manage_messages'] as const;

/** The permissions the token holds (granted only) and the write permissions it lacks. */
export async function permissions(token: string, f: Fetch = fetch): Promise<{ granted: string[]; missing: string[] }> {
  const j = await get(f, token, 'me/permissions', 'permission,status');
  const granted = ((Array.isArray(j['data']) ? j['data'] : []) as { permission?: string; status?: string }[])
    .filter(p => p.status === 'granted' && p.permission).map(p => String(p.permission));
  return { granted, missing: META_WRITE_SCOPES.filter(s => !granted.includes(s)) };
}
