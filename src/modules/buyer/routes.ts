// /api/buyer/*: the media buyer. Reads the ad numbers (ad_metrics: purchases in `leads`), Salla's daily sales, the owner's
// goals and rules, the knowledge module and approved lessons; proposes. Nothing here touches an ad platform: a proposal
// is an open row on the decision board (suggestions), and only an approval there moves it on.
// Tables missing (031_buyer.sql not run yet): the page still works with default rules and no saved goals.
import { sb, json, readJson, handle, requireUser, audit, atLeast, missingSchema, notApplied, notEnabled, env, type AuthEnv, type Cfg, type Session } from '../../lib/auth';
import { scoped, HOVEN_COMPANY } from '../../lib/tenant';
import { knowledgeFor } from '../knowledge/knowledge';
import { generate, pick, type LlmEnv } from '../../lib/llm';
import { usageCtx } from '../../lib/usage';
import { readAll } from '../../lib/paging';
import { summarize, recommend, outcome, cleanGoals, cleanRules, addDays, famOf, type AdRow, type MetricRow, type SaleRow, type Goals, type Kind, type Result } from './engine';
import { DEFAULT_RULES, PROPOSE, systemFor, toSuggestion, fromChat, splitProposals, type PastRec } from './prompt';

type Env = AuthEnv & LlmEnv & { BUYER_API_TOKEN?: string };
type Row = Record<string, unknown>;
const rows = <T = Row>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);
const today = () => new Date().toISOString().slice(0, 10);

interface Settings { goals: Goals; rules: string[]; saved: boolean; missing: boolean }
async function settings(cfg: Cfg, co: string): Promise<Settings> {
  const r = await sb(cfg, scoped('/rest/v1/buyer_settings?select=goals,rules', co), { admin: true });
  if (!r.ok) return { goals: {}, rules: DEFAULT_RULES, saved: false, missing: missingSchema(r) };
  const s = rows(r.data)[0];
  const rules = cleanRules(s?.rules);
  return { goals: cleanGoals(s?.goals), rules: rules.length ? rules : DEFAULT_RULES, saved: !!s, missing: false };
}

// 14 complete days of ads and metrics (this week and the one before) plus Salla's days; 7 more for the outcome window
async function numbers(cfg: Cfg, co: string, back = 21) {
  const since = addDays(today(), -back);
  const [a, m, s] = await Promise.all([
    readAll<AdRow>(cfg, scoped('/rest/v1/ads?select=ad_key,campaign,live', co), 'ad_key.asc', 10),
    readAll<MetricRow>(cfg, `/rest/v1/ad_metrics?select=ad_key,day,spend,impressions,clicks,leads,ads!inner(company_id)&ads.company_id=eq.${co}&day=gte.${since}`, 'ad_key.asc,day.asc', 40),
    sb(cfg, scoped(`/rest/v1/salla_orders_daily?select=day,net_sales_sar,orders&day=gte.${since}&limit=100`, co), { admin: true }),
  ]);
  return { ads: a.rows, metrics: m.rows, sales: rows<SaleRow>(s.data), ok: a.ok && m.ok };
}

async function loadLessons(cfg: Cfg, co: string) {
  const r = await sb(cfg, scoped('/rest/v1/lessons?select=id,lesson,status,source,created_at&module=eq.buyer&active=eq.true&status=in.(new,reviewed,approved)&order=created_at.desc&limit=100', co), { admin: true });
  return r.ok ? rows<{ id: number; lesson: string; status: string; source: string | null; created_at: string }>(r.data) : [];
}

// Learning loop: the buyer's proposals that were decided, with how the campaign did 3 and 7 days after the decision,
// compared with the 7 days before it. Written to `outcomes` once each window is complete (so it is measured once).
async function past(cfg: Cfg, data: Awaited<ReturnType<typeof numbers>>): Promise<PastRec[]> {
  const r = await sb(cfg, "/rest/v1/suggestions?select=id,platform,kind,campaign,status,decided_at,params,outcomes(day,vs_expect)&params->>from=eq.buyer&status=neq.open&order=decided_at.desc&limit=30", { admin: true });
  if (!r.ok) return [];
  const byCamp = new Map(data.ads.map(a => [a.ad_key, (a.campaign || '').trim()]));
  const window = (camp: string, fam: string, from: string, to: string) => {
    let spend = 0, purchases = 0, impr = 0, clicks = 0;
    for (const m of data.metrics) {
      if (m.day < from || m.day > to || famOf(m.ad_key) !== fam || byCamp.get(m.ad_key) !== camp) continue;
      spend += Number(m.spend) || 0; purchases += Number(m.leads) || 0; impr += Number(m.impressions) || 0; clicks += Number(m.clicks) || 0;
    }
    return { spend, purchases, cpa: purchases ? spend / purchases : null, ctr: impr ? (100 * clicks) / impr : null };
  };
  const out: PastRec[] = [];
  for (const s of rows(r.data)) {
    const done = new Map(rows<{ day: number; vs_expect: { result?: Result } | null }>(s.outcomes).map(o => [o.day, o.vs_expect?.result ?? null]));
    const rec: PastRec = { kind: String(s.kind), campaign: (s.campaign as string) || null, platform: String(s.platform), status: String(s.status), d3: done.get(3) ?? null, d7: done.get(7) ?? null };
    const at = typeof s.decided_at === 'string' ? s.decided_at.slice(0, 10) : null;
    if (at && ['approved', 'executed', 'modified'].includes(rec.status) && rec.campaign) {
      const before = window(rec.campaign, rec.platform, addDays(at, -7), addDays(at, -1));
      for (const d of [3, 7] as const) {
        if (done.has(d) || addDays(at, d) >= today()) continue;
        const after = window(rec.campaign, rec.platform, at, addDays(at, d - 1));
        const result = outcome(rec.kind as Kind, before, after);
        const w = await sb(cfg, '/rest/v1/outcomes', { method: 'POST', admin: true, headers: { Prefer: 'resolution=ignore-duplicates' },
          body: { suggestion_id: s.id, day: d, metrics: { before, after }, vs_expect: { result } } });
        if (w.ok) { if (d === 3) rec.d3 = result; else rec.d7 = result; }
      }
    }
    out.push(rec);
  }
  return out;
}

async function context(cfg: Cfg, user: Session) {
  const [st, data, ls, know] = await Promise.all([settings(cfg, user.co), numbers(cfg, user.co), loadLessons(cfg, user.co), knowledgeFor(cfg, user.co, 'buyer')]);
  const summary = summarize(data.ads, data.metrics, data.sales, today());
  const recs = recommend(summary, st.goals);
  return { st, data, ls, know, summary, recs };
}

export const state = { GET: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'buyer');
  const c = await context(cfg, user);
  const p = pick(e, 'buyer');
  return json(200, {
    summary: c.summary, recs: c.recs, goals: c.st.goals, rules: c.st.rules, customRules: c.st.saved, lessons: c.ls,
    past: await past(cfg, c.data), dataOk: c.data.ok,
    chat: p ? { ok: true, model: p.model, engine: p.provider } : { ok: false, why: notEnabled(user, 'محادثة الميديا باير', 'OPENROUTER_API_KEY') },
    setup: c.st.missing ? notApplied(user, 'migration 031_buyer.sql') : null,
    canEdit: atLeast(user, 'buyer', 'edit', cfg), canApprove: atLeast(user, 'buyer', 'approve', cfg), board: user.co === HOVEN_COMPANY,
  });
}) };

async function saveSettings(cfg: Cfg, user: Session, patch: Row): Promise<Response | null> {
  const r = await sb(cfg, '/rest/v1/buyer_settings?on_conflict=company_id', { method: 'POST', admin: true, headers: { Prefer: 'resolution=merge-duplicates' },
    body: { company_id: user.co, ...patch, updated_by: user.email, updated_at: new Date().toISOString() } });
  if (!r.ok) return json(missingSchema(r) ? 503 : 500, { error: missingSchema(r) ? notApplied(user, 'migration 031_buyer.sql') : 'ما انحفظ' });
  return null;
}

export const goals = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'buyer', { write: true });
  const g = cleanGoals((await readJson(request)).goals);
  const fail = await saveSettings(cfg, user, { goals: g });
  if (fail) return fail;
  await audit(cfg, user, 'buyer_goals', { after: g });
  return json(200, { ok: true, goals: g });
}) };

export const rules = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'buyer', { write: true });
  const body = await readJson(request);
  const list = body.reset ? [] : cleanRules(body.rules);
  const fail = await saveSettings(cfg, user, { rules: list });
  if (fail) return fail;
  await audit(cfg, user, 'buyer_rules', { after: list });
  return json(200, { ok: true, rules: list.length ? list : DEFAULT_RULES, customRules: list.length > 0 });
}) };

// Equal-time compare for the owner's API token
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };

// Lessons. POST adds one (edit level; a lesson from someone who cannot approve waits as `new`). The owner can also add
// from outside with `Authorization: Bearer <BUYER_API_TOKEN>` (Hoven's company, saved as approved). PATCH approves or
// ignores (approve level); the tab's lessons list also shows on /api/lessons/list?module=buyer.
export const lessons = {
  POST: handle(async (request, e: Env) => {
    const auth = request.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    let cfg: Cfg, who: { email: string; co: string; approver: boolean; user?: Session };
    if (token) {
      if (!e.BUYER_API_TOKEN || e.BUYER_API_TOKEN.length < 24 || !same(token, e.BUYER_API_TOKEN)) return json(401, { error: 'مفتاح غير صحيح' });
      try { cfg = env(e); } catch { return json(503, { error: 'الإعداد غير مكتمل' }); }
      who = { email: cfg.owner || 'owner-api', co: HOVEN_COMPANY, approver: true };
    } else {
      const r = await requireUser(request, e, 'buyer', { write: true });
      cfg = r.cfg; who = { email: r.user.email, co: r.user.co, approver: atLeast(r.user, 'buyer', 'approve', r.cfg), user: r.user };
    }
    const body = await readJson(request);
    const lesson = String(body.lesson || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 1000);
    if (!lesson) return json(400, { error: 'اكتب الدرس' });
    const status = who.approver ? 'approved' : 'new';
    const r = await sb(cfg, '/rest/v1/lessons', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
      body: { company_id: who.co, module: 'buyer', kind: 'lesson', lesson, evidence: body.evidence && typeof body.evidence === 'object' ? body.evidence : {}, confidence: 1,
        source: token ? 'api' : body.from === 'chat' ? 'chat' : 'manual', status, ...(who.approver ? { decided_by: who.email, decided_at: new Date().toISOString() } : {}) } });
    if (!r.ok) return json(missingSchema(r) ? 503 : 500, { error: missingSchema(r) ? notApplied(who.user ?? null, 'migration 018_lessons_by_tab.sql') : 'ما انحفظ الدرس' });
    const saved = rows(r.data)[0];
    await audit(cfg, who.user ?? { email: who.email, co: who.co }, 'buyer_lesson_add', { target: { id: saved?.id, status } });
    return json(200, { ok: true, lesson: saved });
  }),
  DELETE: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'buyer', { write: true, approve: true });
    const id = parseInt(String((await readJson(request)).id), 10);
    if (!id) return json(400, { error: 'طلب غير صحيح' });
    const r = await sb(cfg, scoped(`/rest/v1/lessons?id=eq.${id}&module=eq.buyer`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { active: false } });
    if (!r.ok || !rows(r.data).length) return json(404, { error: 'غير موجود' });
    await audit(cfg, user, 'buyer_lesson_off', { target: { id } });
    return json(200, { ok: true });
  }),
};

export const chat = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'buyer', { write: true });
  const body = await readJson(request, 60000);
  const history = (Array.isArray(body.messages) ? body.messages : []).slice(-16)
    .map(m => ({ role: (m as Row).role === 'assistant' ? 'assistant' : 'user', content: String((m as Row).content || '').slice(0, 4000) }))
    .filter(m => m.content);
  if (!history.length || history[history.length - 1]!.role !== 'user') return json(400, { error: 'اكتب سؤالك' });
  if (!pick(e, 'buyer')) return json(503, { error: notEnabled(user, 'محادثة الميديا باير', 'OPENROUTER_API_KEY') });
  const c = await context(cfg, user);
  const system = systemFor({ summary: c.summary, goals: c.st.goals, rules: c.st.rules, lessons: c.ls.filter(l => l.status === 'approved').map(l => l.lesson), knowledge: c.know, recs: c.recs, past: await past(cfg, c.data) }) + '\n\n' + PROPOSE;
  let out;
  try { out = await generate(e, 'buyer', { messages: [{ role: 'system', content: system }, ...history], max_tokens: 1800 }, fetch, usageCtx(cfg, user, 'buyer')); }
  catch (err) { return json(502, { error: (err as Error).message === 'cap_reached' ? 'خلص سقف الشهر للميديا باير' : 'ما رد النموذج، جرّب بعد شوي' }); }
  const { text, proposals } = splitProposals(out.response);
  return json(200, { reply: text, proposals, model: out.model });
}) };

// Send proposals to the decision board: the rule recommendations by key, or one written in the chat. Open rows only.
export const send = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'buyer', { write: true, well: true });
  const body = await readJson(request);
  let list;
  if (body.proposal && typeof body.proposal === 'object') {
    const p = fromChat(body.proposal as Row);
    if (!p) return json(400, { error: 'الاقتراح ناقص' });
    list = [{ rec: p, source: 'claude' as const }];
  } else {
    const keys = new Set((Array.isArray(body.keys) ? body.keys : []).map(String));
    const c = await context(cfg, user);
    list = c.recs.filter(r => keys.has(r.key)).map(rec => ({ rec, source: 'rule' as const }));
  }
  const sent: number[] = [], already: string[] = [];
  for (const { rec, source } of list) {
    const s = toSuggestion(rec, user.email, source);
    if (!s) continue;
    const r = await sb(cfg, '/rest/v1/suggestions', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: s });
    const row = r.ok ? rows(r.data)[0] : undefined;
    if (row) { sent.push(Number(row.id)); await audit(cfg, user, 'buyer_proposed', { target: { id: row.id, platform: s.platform, kind: s.kind, campaign: s.campaign, source } }); }
    else if (r.status === 409) already.push(rec.key);
    else return json(500, { error: 'ما انرسل للوحة القرارات' });
  }
  if (!sent.length && !already.length) return json(400, { error: 'ما فيه شي ينرسل' });
  return json(200, { ok: true, sent, already });
}) };
