// /api/dream/*: «احلم» (docs/PRD.md §3.2). Projects, the thinking chat (ChatGPT through OpenRouter, Leen 2026-11-19), and
// the campaign parts, each versioned: draft writes a new version, approve locks one. Publishing to the platforms comes with
// the ad-write layer (milestone 5); nothing here touches an ad platform.
// Tables missing (033_dream.sql not run yet): every route says so to the owner and the page shows it.
import { sb, json, readJson, handle, requireUser, audit, atLeast, missingSchema, notApplied, notEnabled, type AuthEnv, type Cfg, type Session } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { generate, pick, type LlmEnv } from '../../lib/llm';
import { usageCtx } from '../../lib/usage';
import { knowledgeFor, rulesFor } from '../knowledge/knowledge';
import { summarize, cleanGoals, type Goals } from '../buyer/engine';
import { numbers, today } from '../buyer/learn';
import { PARTS, TEXT_PARTS, PART_AR, isPart, staleAfter, latest, missing, parseJson, cleanPart, cleanPlatforms, cleanTitle, cleanIdea, type Part, type PartRow } from './dream';
import { chatSystem, partPrompt, type Context } from './prompt';

type Env = AuthEnv & LlmEnv & { OPENAI_API_KEY?: string; GEMINI_API_KEY?: string };
type Row = Record<string, unknown>;
const rows = <T = Row>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);
const SETUP = 'migration 033_dream.sql';
const fail = (user: Session, r: { ok: boolean; status: number; data: unknown }, what: string) =>
  json(missingSchema(r) ? 503 : 500, { error: missingSchema(r) ? notApplied(user, SETUP) : what });
const idOf = (x: unknown) => { const n = parseInt(String(x ?? ''), 10); return n > 0 ? n : 0; };

// The project, only if it belongs to the user's company
async function project(cfg: Cfg, user: Session, id: number) {
  if (!id) return null;
  const r = await sb(cfg, scoped(`/rest/v1/dream_projects?id=eq.${id}&select=*`, user.co), { admin: true });
  return r.ok ? rows(r.data)[0] ?? null : null;
}
async function messages(cfg: Cfg, co: string, id: number) {
  const r = await sb(cfg, scoped(`/rest/v1/dream_messages?project_id=eq.${id}&select=id,role,content,created_at&order=id.asc&limit=200`, co), { admin: true });
  return rows<{ id: number; role: string; content: string }>(r.data);
}
async function parts(cfg: Cfg, co: string, id: number) {
  const r = await sb(cfg, scoped(`/rest/v1/dream_parts?project_id=eq.${id}&select=id,kind,version,content,status,instruction,approved_by,approved_at,created_at&order=kind.asc,version.desc&limit=300`, co), { admin: true });
  return rows<PartRow>(r.data);
}

// What the model reads: 30 complete days of the store's numbers, Leen's goals, approved buyer lessons, the knowledge
async function context(cfg: Cfg, user: Session, platforms: Context['platforms']): Promise<Context> {
  const [data, g, l, knowledge] = await Promise.all([
    numbers(cfg, user.co, 31),
    sb(cfg, scoped('/rest/v1/buyer_settings?select=goals', user.co), { admin: true }),
    sb(cfg, scoped('/rest/v1/lessons?select=lesson&module=eq.buyer&active=eq.true&status=eq.approved&order=created_at.desc&limit=20', user.co), { admin: true }),
    knowledgeFor(cfg, user.co, 'dream'),
  ]);
  const goals: Goals = g.ok ? cleanGoals(rows(g.data)[0]?.['goals']) : {};
  return { summary: data.ok ? summarize(data.ads, data.metrics, data.sales, today(), 30) : null, goals, lessons: rows<{ lesson: string }>(l.data).map(x => x.lesson), knowledge, platforms };
}

const touch = (cfg: Cfg, id: number, patch: Row = {}) =>
  sb(cfg, `/rest/v1/dream_projects?id=eq.${id}`, { method: 'PATCH', admin: true, body: { ...patch, updated_at: new Date().toISOString() } });

export const state = { GET: handle(async (request, e: Env) => {
  const { user } = await requireUser(request, e, 'dream');
  const p = pick(e, 'dream');
  return json(200, {
    chat: p ? { ok: true, engine: p.provider, model: p.model } : { ok: false, why: notEnabled(user, 'محادثة احلم', 'OPENROUTER_API_KEY') },
    voice: !!e.GEMINI_API_KEY, parts: PARTS, textParts: TEXT_PARTS, names: PART_AR,
  });
}) };

// GET: the company's projects, newest first. POST { idea, title?, platforms? }: a new project with the idea as first message.
export const projects = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'dream');
    const r = await sb(cfg, scoped('/rest/v1/dream_projects?select=id,title,status,platforms,updated_at&order=updated_at.desc&limit=50', user.co), { admin: true });
    if (!r.ok) return missingSchema(r) ? json(200, { projects: [], setup: notApplied(user, SETUP) }) : json(500, { error: 'ما قدرت أقرأ المشاريع' });
    return json(200, { projects: rows(r.data) });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'dream', { write: true });
    const body = await readJson(request);
    const idea = cleanIdea(body.idea);
    if (!idea) return json(400, { error: 'اكتب فكرة الحملة' });
    const title = cleanTitle(body.title) || idea.split(/\n|[.!؟?]/)[0]!.slice(0, 60);
    const r = await sb(cfg, '/rest/v1/dream_projects', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
      body: { company_id: user.co, title, idea, platforms: cleanPlatforms(body.platforms), created_by: user.email } });
    const p = rows(r.data)[0];
    if (!r.ok || !p) return fail(user, r, 'ما انحفظ المشروع');
    await audit(cfg, user, 'dream_project_new', { target: { id: p['id'] } });
    return json(200, { project: p });
  }),
};

// GET ?id=: the project with its chat and parts (every version; the page shows the newest and the history)
export const item = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'dream');
  const p = await project(cfg, user, idOf(new URL(request.url).searchParams.get('id')));
  if (!p) return json(404, { error: 'المشروع مو موجود' });
  const [m, ps] = await Promise.all([messages(cfg, user.co, Number(p['id'])), parts(cfg, user.co, Number(p['id']))]);
  return json(200, { project: p, messages: m, parts: ps, missing: missing(ps), canEdit: atLeast(user, 'dream', 'edit', cfg), canApprove: atLeast(user, 'dream', 'approve', cfg) });
}) };

// POST { id, message, platforms? }: one turn of the thinking chat, both sides stored
export const chat = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'dream', { write: true });
  const body = await readJson(request, 20000);
  const p = await project(cfg, user, idOf(body.id));
  if (!p) return json(404, { error: 'المشروع مو موجود' });
  const text = cleanIdea(body.message);
  if (!text) return json(400, { error: 'اكتب رسالتك' });
  if (!pick(e, 'dream')) return json(503, { error: notEnabled(user, 'محادثة احلم', 'OPENROUTER_API_KEY') });
  const platforms = body.platforms === undefined ? cleanPlatforms(p['platforms']) : cleanPlatforms(body.platforms);
  const id = Number(p['id']);
  const u = await sb(cfg, '/rest/v1/dream_messages', { method: 'POST', admin: true, body: { company_id: user.co, project_id: id, role: 'user', content: text } });
  if (!u.ok) return fail(user, u, 'ما انحفظت الرسالة');
  const history = (await messages(cfg, user.co, id)).slice(-20).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.slice(0, 4000) }));
  if (!history.length || history[0]!.content !== String(p['idea']).slice(0, 4000)) history.unshift({ role: 'user', content: String(p['idea']).slice(0, 4000) });
  const ctx = await context(cfg, user, platforms);
  let out;
  try { out = await generate(e, 'dream', { messages: [{ role: 'system', content: chatSystem(ctx) }, ...history], max_tokens: 1200 }, fetch, usageCtx(cfg, user, 'dream')); }
  catch (err) { return json(502, { error: (err as Error).message === 'cap_reached' ? 'خلص سقف الشهر لاحلم' : 'ما رد النموذج، جرّب بعد شوي' }); }
  await sb(cfg, '/rest/v1/dream_messages', { method: 'POST', admin: true, body: { company_id: user.co, project_id: id, role: 'assistant', content: out.response.slice(0, 20000), model: out.model } });
  await touch(cfg, id, body.platforms === undefined ? {} : { platforms });
  return json(200, { reply: out.response, model: out.model });
}) };

// POST { id, kind, instruction? }: a new version of one text part, written from the chat and the approved parts it builds on.
// Approved parts built on this one become stale (they need a look before «انشر»).
export const draft = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'dream', { write: true });
  const body = await readJson(request, 20000);
  const p = await project(cfg, user, idOf(body.id));
  if (!p) return json(404, { error: 'المشروع مو موجود' });
  const kind = body.kind;
  if (!isPart(kind)) return json(400, { error: 'جزء غير معروف' });
  if (!TEXT_PARTS.includes(kind)) return json(400, { error: `${PART_AR[kind]} يجي في التحديث الجاي` });
  if (!pick(e, 'dream')) return json(503, { error: notEnabled(user, 'احلم', 'OPENROUTER_API_KEY') });
  const id = Number(p['id']), instruction = String(body.instruction || '').trim().slice(0, 1000);
  const [m, ps, rules] = await Promise.all([messages(cfg, user.co, id), parts(cfg, user.co, id), rulesFor(cfg, user.co)]);
  const l = latest(ps);
  const approved: Partial<Record<Part, unknown>> = {};
  for (const k of TEXT_PARTS) if (k !== kind && l[k]?.status === 'approved') approved[k] = l[k]!.content;
  if (instruction && l[kind]) approved[kind] = l[kind]!.content;   // «عدّل» rewrites the current version
  const ctx = await context(cfg, user, cleanPlatforms(p['platforms']));
  const conversation = [`لين: ${p['idea']}`, ...m.slice(-20).map(x => `${x.role === 'assistant' ? 'أنت' : 'لين'}: ${x.content.slice(0, 2000)}`)].join('\n');
  let out;
  try { out = await generate(e, 'dream', { messages: [{ role: 'user', content: partPrompt(kind, ctx, conversation, approved, instruction) }], max_tokens: 2500 }, fetch, usageCtx(cfg, user, 'dream')); }
  catch (err) { return json(502, { error: (err as Error).message === 'cap_reached' ? 'خلص سقف الشهر لاحلم' : 'ما رد النموذج، جرّب بعد شوي' }); }
  const raw = parseJson(out.response);
  const content = raw && cleanPart(kind, raw, { goals: ctx.goals, platforms: ctx.platforms, rules });
  if (!content) return json(502, { error: `ما طلع ${PART_AR[kind]} بشكل سليم، جرّب مرة ثانية` });
  const version = (l[kind]?.version ?? 0) + 1;
  const w = await sb(cfg, '/rest/v1/dream_parts', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: { company_id: user.co, project_id: id, kind, version, content, status: 'draft', instruction: instruction || null, model: out.model, created_by: user.email } });
  const row = rows(w.data)[0];
  if (!w.ok || !row) return w.status === 409 ? json(409, { error: 'انكتبت نسخة ثانية بنفس الوقت، حدّث الصفحة' }) : fail(user, w, 'ما انحفظ الجزء');
  const down = staleAfter(kind);
  if (down.length) await sb(cfg, scoped(`/rest/v1/dream_parts?project_id=eq.${id}&status=eq.approved&kind=in.(${down.join(',')})`, user.co), { method: 'PATCH', admin: true, body: { status: 'stale' } });
  await touch(cfg, id, { status: 'drafting' });
  await audit(cfg, user, 'dream_part_draft', { target: { id: row['id'], project: id, kind, version } });
  return json(200, { part: row, stale: down });
}) };

// POST { id: part id }: approve that version (the newest one only). When every text part is approved the project is ready.
export const approve = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'dream', { write: true, approve: true });
  const pid = idOf((await readJson(request)).id);
  const r = await sb(cfg, scoped(`/rest/v1/dream_parts?id=eq.${pid}&select=id,project_id,kind,version`, user.co), { admin: true });
  const part = rows<{ id: number; project_id: number; kind: Part; version: number }>(r.data)[0];
  const p = part && await project(cfg, user, part.project_id);
  if (!part || !p) return json(404, { error: 'الجزء مو موجود' });
  const ps = await parts(cfg, user.co, part.project_id);
  if (latest(ps)[part.kind]?.id !== part.id) return json(409, { error: 'فيه نسخة أحدث من هالجزء، اعتمد الأحدث' });
  const w = await sb(cfg, scoped(`/rest/v1/dream_parts?id=eq.${part.id}`, user.co), { method: 'PATCH', admin: true, body: { status: 'approved', approved_by: user.email, approved_at: new Date().toISOString() } });
  if (!w.ok) return fail(user, w, 'ما انعتمد');
  const left = missing(ps.map(x => (x.id === part.id ? { ...x, status: 'approved' as const } : x)));
  await touch(cfg, part.project_id, { status: left.length ? 'drafting' : 'approved' });
  await audit(cfg, user, 'dream_part_approve', { target: { id: part.id, project: part.project_id, kind: part.kind, version: part.version } });
  return json(200, { ok: true, missing: left });
}) };
