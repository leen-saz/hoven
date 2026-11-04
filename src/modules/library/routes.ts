// /api/library/*: templates with {{variables}}, a starter pack, rendering a template into text, folders and saved documents.
// Archive instead of delete (the row stays, archived_at is set). Rendered text and saved documents get compliance notices.
import { sb, json, readJson, handle, requireUser, audit, missingSchema, notApplied, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { loadKnowledge, forbiddenRules } from '../knowledge/knowledge';
import { check, notice } from '../compliance/compliance';
import { HOV6, VOICE_DOC } from './hov6';
import { checkSource } from './sourcesheet';
import { KINDS, STATUSES, STARTER, cleanTemplate, cleanDoc, cleanFolder, render as renderText, type Template, type Doc, type Kind } from './library';

const MIG = 'migration 023_library.sql';
type TRow = Template & { id: number; source: string; updated_at?: string };
type DRow = Doc & { id: number; updated_at?: string };
type FRow = { id: number; name: string };
const rows = <T>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);
const fail = (r: { ok: boolean; data: unknown }, msg: string) => json(missingSchema(r as never) ? 503 : 500, { error: missingSchema(r as never) ? notApplied(MIG) : msg });
const idOf = (v: unknown): number => { const n = parseInt(String(v), 10); return Number.isInteger(n) && n > 0 ? n : 0; };
const notes = async (cfg: Cfg, co: string, text: string): Promise<string[]> => check(text, forbiddenRules(await loadKnowledge(cfg, co))).map(notice);

async function template(cfg: Cfg, co: string, id: number): Promise<TRow | null> {
  const r = await sb<TRow[]>(cfg, scoped(`/rest/v1/library_templates?id=eq.${id}&archived_at=is.null&select=*`, co), { admin: true });
  return rows<TRow>(r.data)[0] ?? null;
}

export const templates = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'library');
    const kind = new URL(request.url).searchParams.get('kind') || '';
    const filter = kind in KINDS ? `&kind=eq.${kind}` : '';
    const r = await sb<TRow[]>(cfg, scoped(`/rest/v1/library_templates?archived_at=is.null${filter}&select=*&order=favorite.desc,updated_at.desc&limit=200`, user.co), { admin: true });
    if (!r.ok) return fail(r, 'ما قدرت أقرأ القوالب');
    return json(200, { templates: rows<TRow>(r.data), kinds: KINDS });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'library', { write: true });
    const t = cleanTemplate(await readJson(request, 20_000));
    if ('error' in t) return json(400, { error: t.error });
    const r = await sb<TRow[]>(cfg, '/rest/v1/library_templates', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: { ...t, company_id: user.co, created_by: user.email } });
    if (!r.ok || !rows(r.data).length) return fail(r, 'ما انحفظ القالب');
    await audit(cfg, user, 'library_template_created', { target: { id: rows<TRow>(r.data)[0]!.id, name: t.name } });
    return json(200, { ok: true, template: rows<TRow>(r.data)[0] });
  }),
  PATCH: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'library', { write: true });
    const b = await readJson(request, 20_000);
    const id = idOf(b.id);
    const prev = id ? await template(cfg, user.co, id) : null;
    if (!prev) return json(404, { error: 'القالب مو موجود' });
    const t = cleanTemplate(b, prev);
    if ('error' in t) return json(400, { error: t.error });
    const r = await sb<TRow[]>(cfg, scoped(`/rest/v1/library_templates?id=eq.${id}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { ...t, updated_at: new Date().toISOString() } });
    if (!r.ok || !rows(r.data).length) return fail(r, 'ما انحفظ القالب');
    return json(200, { ok: true, template: rows<TRow>(r.data)[0] });
  }),
  DELETE: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'library', { write: true });
    const id = idOf(new URL(request.url).searchParams.get('id'));
    if (!id || !(await template(cfg, user.co, id))) return json(404, { error: 'القالب مو موجود' });
    const r = await sb(cfg, scoped(`/rest/v1/library_templates?id=eq.${id}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=minimal' }, body: { archived_at: new Date().toISOString() } });
    if (!r.ok) return fail(r, 'ما انأرشف القالب');
    await audit(cfg, user, 'library_template_archived', { target: { id } });
    return json(200, { ok: true });
  }),
};

// Adds the templates (and documents) of a pack this company does not have yet, matched by source + name/title, so it is
// safe to press twice. Packs: starter (the basic six) and hov6 (the eight HOV-6 design templates + the dialect guide).
const PACKS: Record<string, { source: string; templates: Template[]; docs: { title: string; kind: Kind; body: string; source: string }[] }> = {
  starter: { source: 'starter', templates: STARTER, docs: [] },
  hov6: { source: 'hov6', templates: HOV6, docs: [VOICE_DOC] },
};
export const starter = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'library', { write: true });
  const b = await readJson(request);
  const key = typeof b.pack === 'string' && Object.hasOwn(PACKS, b.pack) ? b.pack : 'starter';
  const pack = PACKS[key]!;
  const [have, haveDocs] = await Promise.all([
    sb<{ name: string }[]>(cfg, scoped(`/rest/v1/library_templates?source=eq.${pack.source}&select=name`, user.co), { admin: true }),
    pack.docs.length ? sb<{ title: string }[]>(cfg, scoped(`/rest/v1/library_documents?source=eq.${pack.source}&select=title`, user.co), { admin: true }) : Promise.resolve(null),
  ]);
  if (!have.ok) return fail(have, 'ما قدرت أقرأ القوالب');
  if (haveDocs && !haveDocs.ok) return fail(haveDocs, 'ما قدرت أقرأ المستندات');
  const names = new Set(rows<{ name: string }>(have.data).map(x => x.name));
  const titles = new Set(rows<{ title: string }>(haveDocs?.data).map(x => x.title));
  const add = pack.templates.filter(t => !names.has(t.name)).map(t => ({ ...t, source: pack.source, company_id: user.co, created_by: user.email }));
  const addDocs = pack.docs.filter(d => !titles.has(d.title)).map(d => ({ ...d, status: 'draft', company_id: user.co, created_by: user.email }));
  if (add.length) {
    const r = await sb(cfg, '/rest/v1/library_templates', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' }, body: add });
    if (!r.ok) return fail(r, 'ما انضافت القوالب');
  }
  if (addDocs.length) {
    const r = await sb(cfg, '/rest/v1/library_documents', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' }, body: addDocs });
    if (!r.ok) return fail(r, 'ما انضافت المستندات');
  }
  if (add.length || addDocs.length) await audit(cfg, user, 'library_pack_added', { target: { pack: key, templates: add.length, documents: addDocs.length } });
  return json(200, { ok: true, added: add.length, documents: addDocs.length });
}) };

// Checks a trend source sheet (HOV-6 gate). Nothing is stored: a pass only means the sheet is complete.
export const sourcecheck = { POST: handle(async (request, e) => {
  await requireUser(request, e, 'library', { write: true });
  return json(200, checkSource(await readJson(request, 20_000)));
}) };

export const renderRoute = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'library', { write: true });
  const b = await readJson(request, 20_000);
  const t = await template(cfg, user.co, idOf(b.template_id));
  if (!t) return json(404, { error: 'القالب مو موجود' });
  const out = renderText(t, typeof b.values === 'object' && b.values ? (b.values as Record<string, unknown>) : {});
  return json(200, { ...out, notes: await notes(cfg, user.co, out.text) });
}) };

export const folders = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'library');
    const r = await sb<FRow[]>(cfg, scoped('/rest/v1/library_folders?select=id,name&order=name.asc&limit=200', user.co), { admin: true });
    if (!r.ok) return fail(r, 'ما قدرت أقرأ المجلدات');
    return json(200, { folders: rows<FRow>(r.data) });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'library', { write: true });
    const f = cleanFolder(await readJson(request));
    if ('error' in f) return json(400, { error: f.error });
    const r = await sb<FRow[]>(cfg, '/rest/v1/library_folders', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: { ...f, company_id: user.co, created_by: user.email } });
    if (!r.ok || !rows(r.data).length) return fail(r, 'ما انحفظ المجلد');
    return json(200, { ok: true, folder: rows<FRow>(r.data)[0] });
  }),
};

async function doc(cfg: Cfg, co: string, id: number): Promise<DRow | null> {
  const r = await sb<DRow[]>(cfg, scoped(`/rest/v1/library_documents?id=eq.${id}&archived_at=is.null&select=*`, co), { admin: true });
  return rows<DRow>(r.data)[0] ?? null;
}
// A folder id must belong to this company, or the document would point at someone else's folder
async function ownFolder(cfg: Cfg, co: string, id: number | null): Promise<boolean> {
  if (id === null) return true;
  const r = await sb<FRow[]>(cfg, scoped(`/rest/v1/library_folders?id=eq.${id}&select=id`, co), { admin: true });
  return rows(r.data).length === 1;
}

export const documents = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'library');
    const q = new URL(request.url).searchParams;
    const folder = idOf(q.get('folder')), kind = q.get('kind') || '', status = q.get('status') || '';
    const f = [folder ? `&folder_id=eq.${folder}` : '', kind in KINDS ? `&kind=eq.${kind}` : '', status in STATUSES ? `&status=eq.${status}` : ''].join('');
    const r = await sb<DRow[]>(cfg, scoped(`/rest/v1/library_documents?archived_at=is.null${f}&select=*&order=updated_at.desc&limit=200`, user.co), { admin: true });
    if (!r.ok) return fail(r, 'ما قدرت أقرأ المستندات');
    return json(200, { documents: rows<DRow>(r.data), statuses: STATUSES });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'library', { write: true });
    const d = cleanDoc(await readJson(request, 40_000));
    if ('error' in d) return json(400, { error: d.error });
    if (!(await ownFolder(cfg, user.co, d.folder_id))) return json(400, { error: 'المجلد مو موجود' });
    const r = await sb<DRow[]>(cfg, '/rest/v1/library_documents', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: { ...d, company_id: user.co, created_by: user.email } });
    if (!r.ok || !rows(r.data).length) return fail(r, 'ما انحفظ المستند');
    await audit(cfg, user, 'library_document_saved', { target: { id: rows<DRow>(r.data)[0]!.id, kind: d.kind } });
    return json(200, { ok: true, document: rows<DRow>(r.data)[0], notes: await notes(cfg, user.co, d.body) });
  }),
  PATCH: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'library', { write: true });
    const b = await readJson(request, 40_000);
    const id = idOf(b.id);
    const prev = id ? await doc(cfg, user.co, id) : null;
    if (!prev) return json(404, { error: 'المستند مو موجود' });
    const d = cleanDoc(b, prev);
    if ('error' in d) return json(400, { error: d.error });
    if (!(await ownFolder(cfg, user.co, d.folder_id))) return json(400, { error: 'المجلد مو موجود' });
    const r = await sb<DRow[]>(cfg, scoped(`/rest/v1/library_documents?id=eq.${id}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { ...d, updated_at: new Date().toISOString() } });
    if (!r.ok || !rows(r.data).length) return fail(r, 'ما انحفظ المستند');
    return json(200, { ok: true, document: rows<DRow>(r.data)[0], notes: await notes(cfg, user.co, d.body) });
  }),
  DELETE: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'library', { write: true });
    const id = idOf(new URL(request.url).searchParams.get('id'));
    if (!id || !(await doc(cfg, user.co, id))) return json(404, { error: 'المستند مو موجود' });
    const r = await sb(cfg, scoped(`/rest/v1/library_documents?id=eq.${id}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=minimal' }, body: { archived_at: new Date().toISOString() } });
    if (!r.ok) return fail(r, 'ما انأرشف المستند');
    await audit(cfg, user, 'library_document_archived', { target: { id } });
    return json(200, { ok: true });
  }),
};

// The URL segment is "render"; the export name avoids shadowing the helper
export { renderRoute as render };
