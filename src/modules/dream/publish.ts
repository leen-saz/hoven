// «انشر» (docs/PRD.md §3.2, §3.4, §6.3): an approved Dream campaign → a PAUSED campaign on each chosen platform, then
// «شغّل» per platform. Meta today; the other platforms answer «قريباً» until their writer exists.
// Every call: Leen only (the owner), the kill switch off (pausing always allowed), an Idempotency-Key per click, the
// budget within her plan or typed by her, a row per object in ad_changes and a line in audit_log. The campaign a launch
// creates joins the managed list, so the media buyer may propose on it later and nothing else is touched.
// The platform calls go through Hoven's MCP server (src/mcp, docs/PRD.md §3.10); the checks here only shape the answer.
import { sb, json, readJson, handle, requireUser, audit, isOwner, missingSchema, notApplied, type AuthEnv, type Cfg, type Session } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { checkWrite, checkBudget } from '../../lib/ads-write/guard';
import { claim, finish, KEY_RE } from '../../lib/ads-write/idempotency';
import { metaConfig, ages, genders, type Done, type Plan, type Fetch } from '../../mcp/adapters/meta';
import { callTool, ctxFor, vault, killOn } from '../../mcp/core';
import '../../mcp/tools/ads';
import { cleanGoals, type Fam } from '../buyer/engine';
import { latest, missing, type PartRow } from './dream';

type Env = AuthEnv & { FILES?: R2Bucket };
type Row = Record<string, unknown>;
const rows = <T = Row>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);
const SETUP = 'migration 034_ad_writes.sql';
export const WRITERS: Fam[] = ['meta'];   // platforms whose writer exists
const now = () => new Date().toISOString();
const LINK = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i;

// Run once per Idempotency-Key: a repeat returns the stored answer, a key still running answers 409
async function once(cfg: Cfg, user: Session, key: unknown, scope: string, request: unknown, run: () => Promise<{ status: number; body: Row }>): Promise<Response> {
  if (typeof key !== 'string' || !KEY_RE.test(key)) return json(400, { error: 'الطلب ناقص مفتاح، حدّث الصفحة وجرّب' });
  const c = await claim(cfg, user.co, key, scope, request);
  if (c.state === 'unavailable') return json(503, { error: notApplied(user, SETUP) });
  if (c.state === 'running') return json(409, { error: 'نفس الطلب شغّال الحين، انتظر شوي' });
  if (c.state === 'conflict') return json(409, { error: 'المفتاح مستخدم لطلب ثاني، حدّث الصفحة' });
  if (c.state === 'done') return json(c.status, c.response as Row);
  const out = await run();
  await finish(cfg, user.co, key, out.status, out.body);
  return json(out.status, out.body);
}

// The Meta plan from the approved parts: one ad set on the Meta audience, one ad per approved design
export function metaPlan(title: string, parts: Partial<Record<string, PartRow>>, daily: number, link: string): Plan {
  const seg = ((parts['audience']?.content['segments'] as Row[] | undefined) || []).find(s => s['platform'] === 'meta') || {};
  const imgs = ((parts['design']?.content['images'] as Row[] | undefined) || []).filter(i => !i['platform'] || i['platform'] === 'meta');
  return {
    name: `${title || 'حملة'} · احلم`.slice(0, 180), daily, link,
    targeting: { ...ages(String(seg['age'] || '')), genders: genders(String(seg['gender'] || '')) },
    ads: imgs.map(i => ({ headline: String(i['headline'] || ''), body: String(i['body'] || ''), cta: String(i['cta'] || ''), image_key: String(i['key']) })),
  };
}

// POST { id, key, link, budgets: { meta: 300 } }: create the paused campaigns
export const publish = { POST: handle(async (request, e: Env, f: Fetch = fetch) => {
  const { cfg, user } = await requireUser(request, e, 'dream', { write: true });
  const body = await readJson(request);
  return once(cfg, user, body.key, `dream_publish:${body.id}`, { id: body.id, link: body.link, budgets: body.budgets }, async () => {
    const stop = checkWrite('create_paused', { kill: await killOn(cfg), owner: isOwner(user, cfg), managed: true });
    if (stop) return { status: 403, body: { error: stop } };
    const id = parseInt(String(body.id), 10) || 0;
    const p = rows((await sb(cfg, scoped(`/rest/v1/dream_projects?id=eq.${id}&select=*`, user.co), { admin: true })).data)[0];
    if (!p) return { status: 404, body: { error: 'المشروع مو موجود' } };
    const ps = rows<PartRow>((await sb(cfg, scoped(`/rest/v1/dream_parts?project_id=eq.${id}&select=id,kind,version,status,content&order=version.desc&limit=300`, user.co), { admin: true })).data);
    const left = missing(ps);
    if (left.length) return { status: 400, body: { error: 'اعتمد كل الأجزاء أول', missing: left } };
    const link = String(body.link || '').trim();
    if (!LINK.test(link)) return { status: 400, body: { error: 'اكتب رابط المتجر أو صفحة المنتج (يبدأ بـ https://)' } };
    const l = latest(ps);
    const platforms = (Array.isArray(p['platforms']) ? p['platforms'] : []) as Fam[];
    const split = ((l.budget?.content['split'] as { platform: Fam; daily: number }[] | undefined) || []);
    const gs = await sb(cfg, scoped('/rest/v1/buyer_settings?select=goals,managed', user.co), { admin: true });
    const st = rows(gs.data)[0] || {};
    const goals = cleanGoals(st['goals']);
    const typed = (body.budgets && typeof body.budgets === 'object' ? body.budgets : {}) as Record<string, unknown>;
    const env = await vault(cfg, user.co);
    const out: Row[] = [];
    for (const platform of platforms) {
      if (!WRITERS.includes(platform)) { out.push({ platform, status: 'soon', error: 'النشر التلقائي لهالمنصة يجي لاحقاً' }); continue; }
      const t = Number(typed[platform]), next = Number.isFinite(t) && t > 0 ? t : split.find(s => s.platform === platform)?.daily ?? 0;
      const bad = checkBudget({ planned: goals[platform]?.dailyBudget ?? null, typed: Number.isFinite(t) && t > 0 ? t : null, next });
      if (bad) { out.push({ platform, status: 'refused', error: bad }); continue; }
      const mc = metaConfig(env);
      if (!mc.cfg) { out.push({ platform, status: 'refused', error: `ناقص في صفحة الربط: ${mc.missing.join('، ')}` }); continue; }
      const plan = metaPlan(String(p['title'] || ''), l, next, link);
      if (!plan.ads.length) { out.push({ platform, status: 'refused', error: 'ما فيه تصميم معتمد لميتا' }); continue; }
      // The launch row: reused on a retry (its external ids let the writer resume instead of creating again)
      const ex = rows<{ id: number; status: string; external: Done }>((await sb(cfg, scoped(`/rest/v1/dream_launches?project_id=eq.${id}&platform=eq.${platform}&select=id,status,external`, user.co), { admin: true })).data)[0];
      if (ex && ['created', 'active', 'paused'].includes(ex.status)) { out.push({ platform, status: ex.status, launch: ex.id, campaign_id: ex.external?.campaign_id, already: true }); continue; }
      let launch = ex?.id;
      if (!launch) {
        const w = await sb(cfg, '/rest/v1/dream_launches', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
          body: { company_id: user.co, project_id: id, platform, status: 'pending', daily_sar: next, link, created_by: user.email } });
        if (!w.ok) return { status: missingSchema(w) ? 503 : 500, body: { error: missingSchema(w) ? notApplied(user, SETUP) : 'ما انحفظ النشر' } };
        launch = Number(rows(w.data)[0]?.['id']);
      }
      const save = async (d: unknown) => { await sb(cfg, `/rest/v1/dream_launches?id=eq.${launch}`, { method: 'PATCH', admin: true, body: { external: d, updated_at: now() } }); };
      // Through Hoven's MCP server: the tool re-checks the guards, writes ad_changes and adds the campaign to the managed list
      const ctx = { ...ctxFor(cfg, user, e, 'dream', f, isOwner(user, cfg)), onProgress: save };
      const a = await callTool(ctx, 'ads.create_campaign', { platform, plan, done: ex?.external || {}, launch_id: launch, ...(Number.isFinite(t) && t > 0 ? { typed_daily: t } : {}) },
        { key: `${String(body.key).slice(0, 70)}_${platform}` });
      if (a.ok) {
        const d = (a.data as { done: Done }).done;
        await sb(cfg, `/rest/v1/dream_launches?id=eq.${launch}`, { method: 'PATCH', admin: true, body: { status: 'created', external: d, error: null, receipt: { at: now(), ads: Object.keys(d.ads || {}).length }, updated_at: now() } });
        out.push({ platform, status: 'created', launch, campaign_id: d.campaign_id, ads: Object.keys(d.ads || {}).length });
      } else {
        await sb(cfg, `/rest/v1/dream_launches?id=eq.${launch}`, { method: 'PATCH', admin: true, body: { status: 'failed', error: a.error, ...(a.data?.['done'] ? { external: a.data['done'] } : {}), updated_at: now() } });
        out.push({ platform, status: a.status === 403 ? 'refused' : 'failed', launch, error: a.error });
      }
    }
    const created = out.some(o => o['status'] === 'created');
    if (created) await sb(cfg, `/rest/v1/dream_projects?id=eq.${id}`, { method: 'PATCH', admin: true, body: { status: 'published', updated_at: now() } });
    await audit(cfg, user, 'dream_publish', { target: { project: id, launches: out.map(o => ({ platform: o['platform'], status: o['status'], campaign_id: o['campaign_id'] })) } });
    return { status: 200, body: { launches: out } };
  });
}) };

// POST { launch, on: true|false, key }: switch a created campaign on, or pause it again
export const activate = { POST: handle(async (request, e: Env, f: Fetch = fetch) => {
  const { cfg, user } = await requireUser(request, e, 'dream', { write: true });
  const body = await readJson(request);
  const on = body.on === true;
  return once(cfg, user, body.key, `dream_activate:${body.launch}:${on}`, { launch: body.launch, on }, async () => {
    const lid = parseInt(String(body.launch), 10) || 0;
    const l = rows<{ id: number; platform: Fam; status: string; external: Done; project_id: number }>((await sb(cfg, scoped(`/rest/v1/dream_launches?id=eq.${lid}&select=id,platform,status,external,project_id`, user.co), { admin: true })).data)[0];
    if (!l?.external?.campaign_id || !['created', 'active', 'paused'].includes(l.status)) return { status: 404, body: { error: 'ما فيه حملة منشأة لهالنشر' } };
    // Through Hoven's MCP server: the guards (kill switch, managed campaign, the approver) and ad_changes live in the tool
    const a = await callTool(ctxFor(cfg, user, e, 'dream', f, isOwner(user, cfg)), 'ads.set_status',
      { platform: l.platform, campaign_id: l.external.campaign_id, status: on ? 'ACTIVE' : 'PAUSED', launch_id: l.id }, { key: `${String(body.key).slice(0, 70)}_${on ? 'on' : 'off'}` });
    if (!a.ok) return { status: a.status, body: { error: a.error } };
    const got = a.data as { status: string; effective: string };
    const status = on ? 'active' : 'paused';
    await sb(cfg, `/rest/v1/dream_launches?id=eq.${l.id}`, { method: 'PATCH', admin: true, body: { status, receipt: { at: now(), status: got.status, effective: got.effective }, updated_at: now() } });
    await audit(cfg, user, on ? 'dream_activate' : 'dream_pause', { target: { launch: l.id, platform: l.platform, campaign_id: l.external.campaign_id } });
    return { status: 200, body: { ok: true, status, meta: { status: got.status, effective: got.effective } } };
  });
}) };

// GET ?id=: this project's launches (status, campaign id, error) for the page
export const launches = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'dream');
  const id = parseInt(new URL(request.url).searchParams.get('id') || '', 10) || 0;
  const r = await sb(cfg, scoped(`/rest/v1/dream_launches?project_id=eq.${id}&select=id,platform,status,daily_sar,link,external,error,updated_at`, user.co), { admin: true });
  if (!r.ok) return json(200, { launches: [], setup: missingSchema(r) ? notApplied(user, SETUP) : null });
  return json(200, { launches: rows(r.data).map(x => ({ ...x, campaign_id: (x['external'] as Done | null)?.campaign_id ?? null, external: undefined })), writers: WRITERS, owner: isOwner(user, cfg) });
}) };
