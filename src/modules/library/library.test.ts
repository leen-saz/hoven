// Library: template cleaning, rendering with placeholders, documents, the starter pack, and the routes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { varsOf, cleanTemplate, render, cleanDoc, cleanFolder, STARTER, type Template } from './library';
import * as A from '../../lib/auth';
import { ROUTES } from '../routes';

afterEach(() => { vi.unstubAllGlobals(); });

const T = (x: Partial<Template> = {}): Template => ({ name: 'منتج', kind: 'copy', category: '', description: '', body: '{{product}} بـ {{price}}', fields: [], lang: 'ar', favorite: false, ...x });

describe('templates', () => {
  it('variables are lowercase words between double braces, unique and in order', () => {
    expect(varsOf('{{a}} و {{ b_2 }} و {{a}} و {{Bad}} و {{1x}}')).toEqual(['a', 'b_2']);
  });
  it('needs a name and a body; fields follow the body and keep given labels', () => {
    expect(cleanTemplate({ body: 'x' })).toEqual({ error: 'اكتب اسم القالب' });
    expect(cleanTemplate({ name: 'ن' })).toEqual({ error: 'اكتب نص القالب' });
    const t = cleanTemplate({ name: ' ن ', body: '{{product}} {{price}}', fields: [{ key: 'price', label: 'السعر', hint: 'شامل الضريبة' }, { key: 'gone', label: 'x' }], kind: 'nope' });
    expect(t).toMatchObject({ name: 'ن', kind: 'copy', fields: [{ key: 'product', label: 'product', hint: '' }, { key: 'price', label: 'السعر', hint: 'شامل الضريبة' }] });
  });
  it('a partial update keeps the previous values', () => {
    const t = cleanTemplate({ favorite: true }, T({ fields: [{ key: 'price', label: 'السعر', hint: '' }] }));
    expect(t).toMatchObject({ name: 'منتج', favorite: true, kind: 'copy' });
  });
});

describe('render', () => {
  const t = { body: '{{product}} بـ {{price}}. {{product}}!', fields: [{ key: 'product', label: 'المنتج', hint: '' }, { key: 'price', label: 'السعر', hint: '' }] };
  it('fills values and leaves empty ones as [label], never invented', () => {
    expect(render(t, { product: 'مخدة' })).toEqual({ text: 'مخدة بـ [السعر]. مخدة!', missing: ['price'] });
  });
  it('values cannot inject the template syntax or run long', () => {
    expect(render(t, { product: '{{price}}x', price: '9' }).text).toBe('pricex بـ 9. pricex!');
    expect(render({ body: '{{a}}', fields: [] }, { a: 'x'.repeat(900) }).text.length).toBe(500);
  });
});

describe('documents and folders', () => {
  it('title falls back to the first line; status is draft unless final', () => {
    expect(cleanDoc({ body: 'السطر الأول\nالثاني' })).toMatchObject({ title: 'السطر الأول', status: 'draft', folder_id: null, kind: 'copy' });
    expect(cleanDoc({})).toEqual({ error: 'اكتب عنوان أو نص' });
    expect(cleanDoc({ title: 'ع', status: 'final', folder_id: 3 })).toMatchObject({ status: 'final', folder_id: 3 });
    expect(cleanDoc({ folder_id: null }, { title: 'ع', kind: 'copy', body: '', status: 'draft', folder_id: 3, template_id: null, source: '' })).toMatchObject({ folder_id: null });
  });
  it('a folder needs a name', () => {
    expect(cleanFolder({})).toEqual({ error: 'اكتب اسم المجلد' });
    expect(cleanFolder({ name: ' حملة ' })).toEqual({ name: 'حملة' });
  });
});

describe('starter pack', () => {
  it('price, offer and delivery are variables, never written in', () => {
    expect(STARTER.length).toBeGreaterThanOrEqual(6);
    expect(new Set(STARTER.map(t => t.name)).size).toBe(STARTER.length);
    for (const t of STARTER) expect(t.body).not.toMatch(/\d|ريال|خصم|الأفضل|مضمون/);
    expect(STARTER.find(t => t.name === 'إعلان متجر')!.fields.map(f => f.key)).toEqual(expect.arrayContaining(['price', 'offer']));
  });
});

describe('routes', () => {
  const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
  const cfg = A.env(E);
  const owner: A.Profile = { id: '11111111-1111-1111-1111-111111111111', email: 'leen@example.com', active: true };
  const cookie = async () => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(owner, cfg), cfg.secret))}`;
  const req = async (path: string, init: RequestInit = {}) => new Request('https://hoven.example' + path,
    { ...init, headers: { cookie: await cookie(), origin: 'https://hoven.example', 'sec-fetch-site': 'same-origin' } });
  const stub = (db: Record<string, unknown[]>, calls: { url: string; init: RequestInit }[] = []) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.includes('/profiles?id=eq.')) return new Response(JSON.stringify([owner]));
    const table = Object.keys(db).find(k => url.includes(`/rest/v1/${k}`));
    if (init.method === 'POST' && table) return new Response(JSON.stringify([{ id: 9, ...(JSON.parse(String(init.body)) as object) }]), { status: 201 });
    return new Response(JSON.stringify(table ? db[table] : []));
  }));

  it('lists templates of this company only', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    stub({ library_templates: [{ id: 1, name: 'ن' }] }, calls);
    const r = await ROUTES.library.templates.GET!(await req('/api/library/templates?kind=copy'), E);
    expect(r.status).toBe(200);
    const url = calls.find(c => c.url.includes('library_templates'))!.url;
    expect(url).toContain('company_id=eq.');
    expect(url).toContain('archived_at=is.null');
    expect(url).toContain('kind=eq.copy');
  });
  it('renders a template and leaves empty variables visible', async () => {
    stub({ library_templates: [{ id: 1, name: 'ن', body: 'مخدة بـ {{price}}', fields: [{ key: 'price', label: 'السعر', hint: '' }] }] });
    const r = await ROUTES.library.render.POST!(await req('/api/library/render', { method: 'POST', body: JSON.stringify({ template_id: 1, values: {} }) }), E);
    expect(await r.json()).toMatchObject({ text: 'مخدة بـ [السعر]', missing: ['price'] });
  });
  it('starter adds only the missing ones', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    stub({ library_templates: [{ name: STARTER[0]!.name }] }, calls);
    const r = await ROUTES.library.starter.POST!(await req('/api/library/starter', { method: 'POST', body: '{}' }), E);
    expect(await r.json()).toEqual({ ok: true, added: STARTER.length - 1 });
    const post = calls.find(c => c.init.method === 'POST' && c.url.includes('library_templates'))!;
    expect((JSON.parse(String(post.init.body)) as { source: string }[]).every(x => x.source === 'starter')).toBe(true);
  });
  it('a document cannot point at another company\'s folder', async () => {
    stub({ library_folders: [] });
    const r = await ROUTES.library.documents.POST!(await req('/api/library/documents', { method: 'POST', body: JSON.stringify({ title: 'ع', body: 'نص', folder_id: 5 }) }), E);
    expect(r.status).toBe(400);
  });
  it('archives instead of deleting', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    stub({ library_documents: [{ id: 4, title: 'ع' }] }, calls);
    const r = await ROUTES.library.documents.DELETE!(await req('/api/library/documents?id=4', { method: 'DELETE' }), E);
    expect(r.status).toBe(200);
    expect(calls.some(c => c.init.method === 'DELETE')).toBe(false);
    expect(JSON.parse(String(calls.find(c => c.init.method === 'PATCH')!.init.body))).toHaveProperty('archived_at');
  });
});
