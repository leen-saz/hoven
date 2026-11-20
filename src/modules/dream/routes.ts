// /api/dream/*: «احلم» (docs/PRD.md §3.2). Projects, the thinking chat (ChatGPT through OpenRouter, Leen 2026-11-19), and
// the campaign parts, each versioned: draft writes a new version, approve locks one. Publishing to the platforms comes with
// the ad-write layer (milestone 5); nothing here touches an ad platform.
// Tables missing (033_dream.sql not run yet): every route says so to the owner and the page shows it.
import { sb, json, readJson, handle, requireUser, audit, atLeast, missingSchema, notApplied, notEnabled, type AuthEnv, type Cfg, type Session } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { generate, pick, canDraw, drawImage, type LlmEnv } from '../../lib/llm';
import { guard, meter } from '../../lib/quotas';
import { brandFor } from '../knowledge/brand';
import { cleanSpec, parseSpec, specPrompt, editPrompt, templateSpec, checkUpload, fileKey, type Spec } from '../design/motion';
import { ttsBody, ttsInput, TTS_MODEL } from '../voice/voice';
import { usageCtx } from '../../lib/usage';
import { knowledgeFor, rulesFor } from '../knowledge/knowledge';
import { summarize, cleanGoals, type Goals } from '../buyer/engine';
import { numbers, today } from '../buyer/learn';
import { PARTS, TEXT_PARTS, DRAFTED, REQUIRED, MAX_DESIGNS, PART_AR, isPart, staleAfter, latest, missing, parseJson, cleanPart, cleanPlatforms, cleanTitle, cleanIdea, designPrompt, cleanDesign, ownFile, type Part, type PartRow } from './dream';
import { chatSystem, partPrompt, type Context } from './prompt';

type Env = AuthEnv & LlmEnv & { OPENAI_API_KEY?: string; GEMINI_API_KEY?: string; GEMINI_TTS_MODEL?: string; FILES?: R2Bucket };
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
    voice: !!e.GEMINI_API_KEY, draw: canDraw(e), files: !!e.FILES, parts: PARTS, textParts: TEXT_PARTS, drafted: DRAFTED, required: REQUIRED, names: PART_AR,
    why: { draw: canDraw(e) ? '' : notEnabled(user, 'رسم التصاميم', 'OPENROUTER_API_KEY'), voice: e.GEMINI_API_KEY ? '' : notEnabled(user, 'الفويس أوفر', 'GEMINI_API_KEY') },
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

// A new version of a part: stored, the approved parts built on it marked stale, the project touched, the log written
async function saveVersion(cfg: Cfg, user: Session, id: number, kind: Part, prev: number, content: Row, extra: Row = {}) {
  const version = prev + 1;
  const w = await sb(cfg, '/rest/v1/dream_parts', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: { company_id: user.co, project_id: id, kind, version, content, status: 'draft', created_by: user.email, ...extra } });
  const row = rows(w.data)[0];
  if (!w.ok || !row) return { error: w.status === 409 ? json(409, { error: 'انكتبت نسخة ثانية بنفس الوقت، حدّث الصفحة' }) : fail(user, w, 'ما انحفظ الجزء') };
  const down = staleAfter(kind);
  if (down.length) await sb(cfg, scoped(`/rest/v1/dream_parts?project_id=eq.${id}&status=eq.approved&kind=in.(${down.join(',')})`, user.co), { method: 'PATCH', admin: true, body: { status: 'stale' } });
  await touch(cfg, id, { status: 'drafting' });
  await audit(cfg, user, 'dream_part_draft', { target: { id: row['id'], project: id, kind, version } });
  return { row, down };
}

// Motion: a scene plan over the approved design and voice-over (the same plan the design tab's motion uses, browser-animated)
async function motionContent(e: Env, cfg: Cfg, user: Session, l: Partial<Record<Part, PartRow>>, instruction: string): Promise<{ content?: Row; model?: string; error?: string }> {
  const design = l.design?.status === 'approved' ? (l.design.content['images'] as { key: string; headline?: string }[] | undefined)?.[0] : undefined;
  const voice = l.voiceover?.content as { script?: string; seconds?: number; audio_key?: string | null } | undefined;
  if (!design) return { error: 'اعتمد التصاميم أول: الموشن يتحرك فوق التصميم المعتمد' };
  if (!voice?.script) return { error: 'اكتب الفويس أوفر أول: الموشن يمشي على وقته' };
  const seconds = Math.max(3, Math.min(90, Number(voice.seconds) || 15)), ratio: Spec['ratio'] = '9:16';
  const colors = (await brandFor(cfg, user.co)).colors;
  const current = l.motion?.content['spec'] as Spec | undefined;
  const messages = instruction && current ? editPrompt(current, instruction) : specPrompt({ headline: design.headline || '', script: voice.script, seconds, ratio, colors });
  let spec: Spec | null = null, model = 'templates';
  try {
    const out = await generate(e, 'dream', { messages, max_tokens: 1500 }, fetch, usageCtx(cfg, user, 'dream'));
    spec = cleanSpec(parseSpec(out.response), seconds, ratio, colors); model = out.model;
  } catch (err) { if ((err as Error).message === 'cap_reached') return { error: 'خلص سقف الشهر لاحلم' }; }
  spec ||= templateSpec({ headline: design.headline || '', script: voice.script, seconds, ratio, colors });
  if (!spec) return { error: 'ما طلعت خطة الموشن، جرّب مرة ثانية' };
  return { content: { spec, design_key: design.key, voice_key: voice.audio_key ?? null }, model };
}

// POST { id, kind, instruction? }: a new version of one text part, written from the chat and the approved parts it builds on.
// Approved parts built on this one become stale (they need a look before «انشر»).
export const draft = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'dream', { write: true });
  const body = await readJson(request, 20000);
  const p = await project(cfg, user, idOf(body.id));
  if (!p) return json(404, { error: 'المشروع مو موجود' });
  const kind = body.kind;
  if (!isPart(kind)) return json(400, { error: 'جزء غير معروف' });
  if (!DRAFTED.includes(kind)) return json(400, { error: `${PART_AR[kind]} يتولّد من «ارسم التصاميم»` });
  if (!pick(e, 'dream')) return json(503, { error: notEnabled(user, 'احلم', 'OPENROUTER_API_KEY') });
  const id = Number(p['id']), instruction = String(body.instruction || '').trim().slice(0, 1000);
  const [m, ps, rules] = await Promise.all([messages(cfg, user.co, id), parts(cfg, user.co, id), rulesFor(cfg, user.co)]);
  const l = latest(ps);
  if (kind === 'motion') {
    const m2 = await motionContent(e, cfg, user, l, instruction);
    if (!m2.content) return json(400, { error: m2.error });
    const saved = await saveVersion(cfg, user, id, kind, l[kind]?.version ?? 0, m2.content, { instruction: instruction || null, model: m2.model });
    return saved.error ?? json(200, { part: saved.row, stale: saved.down });
  }
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
  const saved = await saveVersion(cfg, user, id, kind, l[kind]?.version ?? 0, content, { instruction: instruction || null, model: out.model });
  return saved.error ?? json(200, { part: saved.row, stale: saved.down });
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

// ---- Media (milestone 4). Heavy bytes stay in the browser (the free Workers plan allows 10 ms of CPU): the picture comes back
// as a data: URL, the page uploads it to R2 (/api/dream/file), then names the uploaded files as a new design version (/api/dream/media).

// POST { id, index }: one picture for the approved ad text at `index` (PAID per image). Never written into the picture: the page lays the words on top.
export const draw = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'dream', { write: true });
  const body = await readJson(request);
  const p = await project(cfg, user, idOf(body.id));
  if (!p) return json(404, { error: 'المشروع مو موجود' });
  if (!canDraw(e)) return json(503, { error: notEnabled(user, 'رسم التصاميم', 'OPENROUTER_API_KEY') });
  const l = latest(await parts(cfg, user.co, Number(p['id'])));
  if (l.copy?.status !== 'approved') return json(400, { error: 'اعتمد النصوص أول: كل تصميم مبني على نص معتمد' });
  const items = (l.copy.content['items'] as Row[] | undefined) || [];
  const index = Math.max(0, Math.min(MAX_DESIGNS - 1, Number(body.index) || 0));
  const item = items[index];
  if (!item) return json(400, { error: 'ما فيه نص بهالرقم' });
  const over = await guard(cfg, user, 'image', 1); if (over) return over;
  const colors = (await brandFor(cfg, user.co)).colors;
  const image = await drawImage(e, designPrompt((l.strategy?.content || {}) as Row, item as { headline?: string }, colors), fetch, undefined, /ستوري|story|فيديو/i.test(String(item['format'] || '')) ? '1024x1536' : '1536x1024');
  if (!image) return json(502, { error: 'ما انرسم التصميم، جرّب بعد شوي' });
  await meter(cfg, user, 'dream', 'image', 1);
  return json(200, { image, item: { platform: item['platform'], format: item['format'], headline: item['headline'], body: item['body'], cta: item['cta'] }, index, of: Math.min(items.length, MAX_DESIGNS) });
}) };

// GET ?key=: one of this company's Dream files. POST ?kind=design|voice (raw body): stores it, returns its key.
export const file = {
  GET: handle(async (request, e: Env) => {
    const { user } = await requireUser(request, e, 'dream');
    const key = new URL(request.url).searchParams.get('key');
    if (!ownFile(user.co, key) || !e.FILES) return json(404, { error: 'الملف غير موجود' });
    const obj = await e.FILES.get(key);
    if (!obj) return json(404, { error: 'الملف غير موجود' });
    return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'application/octet-stream', 'cache-control': 'private, max-age=3600',
      'content-security-policy': "default-src 'none'; sandbox", 'x-content-type-options': 'nosniff' } });
  }),
  POST: handle(async (request, e: Env) => {
    const { user } = await requireUser(request, e, 'dream', { write: true });
    if (!e.FILES) return json(503, { error: 'رفع الملفات مو مفعّل في هالبيئة' });
    const kind = new URL(request.url).searchParams.get('kind') || '';
    const type = (request.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase();
    const pre = checkUpload(kind, type, Number(request.headers.get('content-length') || 1));
    if (pre.error) return json(pre.error.includes('الحد') ? 413 : 415, { error: pre.error });
    const bytes = await request.arrayBuffer();
    const c = checkUpload(kind, type, bytes.byteLength);
    if (!c.ext) return json(c.error?.includes('الحد') ? 413 : 400, { error: c.error });
    const key = fileKey(user.co, c.ext);
    await e.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
    return json(200, { ok: true, key });
  }),
};

// POST { id, kind: 'design', images: [{ key, platform, format, headline, body, cta }] }: a new design version from the uploaded pictures.
// POST { id, kind: 'voiceover', audio_key }: the newest voice-over with its recorded audio, as a new version.
export const media = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'dream', { write: true });
  const body = await readJson(request, 20000);
  const p = await project(cfg, user, idOf(body.id));
  if (!p) return json(404, { error: 'المشروع مو موجود' });
  const id = Number(p['id']), l = latest(await parts(cfg, user.co, id));
  let kind: Part, content: Row | null;
  if (body.kind === 'design') { kind = 'design'; content = cleanDesign(user.co, body.images); }
  else if (body.kind === 'voiceover') {
    kind = 'voiceover';
    content = l.voiceover && ownFile(user.co, body.audio_key) ? { ...l.voiceover.content, audio_key: body.audio_key } : null;
  } else return json(400, { error: 'جزء غير معروف' });
  if (!content) return json(400, { error: kind === 'design' ? 'ارفع التصاميم أول' : 'اكتب الفويس أوفر وولّد الصوت أول' });
  const saved = await saveVersion(cfg, user, id, kind, l[kind]?.version ?? 0, content);
  return saved.error ?? json(200, { part: saved.row, stale: saved.down });
}) };

// POST { id }: Gemini TTS reads the newest voice-over script. The audio JSON goes straight to the page (no parsing here, for CPU);
// the page turns the PCM into WAV and uploads it. PAID per second; metered like the voice tab.
export const speak = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'dream', { write: true });
  const p = await project(cfg, user, idOf((await readJson(request)).id));
  if (!p) return json(404, { error: 'المشروع مو موجود' });
  if (!e.GEMINI_API_KEY) return json(503, { error: notEnabled(user, 'الفويس أوفر', 'GEMINI_API_KEY') });
  const v = latest(await parts(cfg, user.co, Number(p['id']))).voiceover?.content as { script?: string; voice?: string; accent?: string; tone?: string; seconds?: number } | undefined;
  if (!v?.script) return json(400, { error: 'اكتب الفويس أوفر أول' });
  const i = ttsInput({ text: v.script, voice: v.voice, accent: v.accent, tone: v.tone });
  const secs = Math.max(1, Math.ceil(i.text.split(/\s+/).filter(Boolean).length / 2.3));
  const over = await guard(cfg, user, 'voice_sec', secs); if (over) return over;
  await meter(cfg, user, 'dream', 'voice_sec', secs);
  const model = (e.GEMINI_TTS_MODEL || TTS_MODEL).replace(/[^a-z0-9.\-]/gi, '');
  let r: Response;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': e.GEMINI_API_KEY }, body: JSON.stringify(ttsBody(i)) });
  } catch { return json(502, { error: 'خدمة الصوت ما ردت، جرّب بعد دقيقة' }); }
  if (r.status === 429) return json(429, { error: 'وصلت حد توليد الصوت لهالفترة، جرّب بعدين' });
  if (!r.ok) return json(502, { error: `ما انولد الصوت (${r.status})` });
  return new Response(r.body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}) };

// «انشر» and «شغّل» (src/modules/dream/publish.ts): the paused campaigns on the platforms, behind the write guard
export { publish, activate, launches } from './publish';
