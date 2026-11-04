// HOV-6: the source sheet gate (same rules as check-source.py), the pack content, and the pack route.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSource } from './sourcesheet';
import { HOV6, VOICE_DOC } from './hov6';
import * as A from '../../lib/auth';
import { ROUTES } from '../routes';

afterEach(() => { vi.unstubAllGlobals(); });

const TODAY = '2026-10-27';
const good = () => ({ trend: { name: 'صباح الخير', startedAt: '2026-10-20', referenceDate: '2026-10-24' }, referenceUrl: 'https://x.com/a/status/1', takenSpecifically: 'روتين الصباح', hovenConnection: 'ترتيب السرير', classification: 'آمن تجاريا', previousBatchReferences: [] as string[] });

describe('source sheet gate', () => {
  it('the empty template fails on purpose', () => {
    const r = checkSource({ trend: { name: '', startedAt: '', referenceDate: '' }, referenceUrl: '', takenSpecifically: '', hovenConnection: '', classification: '', previousBatchReferences: [] }, TODAY);
    expect(r.ok).toBe(false); expect(r.decision).toBe('reject'); expect(r.errors.length).toBeGreaterThanOrEqual(7);
  });
  it('a complete safe sheet passes, with the human-check reminder', () => {
    const r = checkSource(good(), TODAY);
    expect(r).toMatchObject({ ok: true, decision: 'pass', errors: [] });
    expect(r.note).toContain('تحقق بشري');
  });
  it('rejects a reference older than 14 days, in the future, or starting after the reference', () => {
    expect(checkSource({ ...good(), trend: { ...good().trend, referenceDate: '2026-10-12' } }, TODAY).errors).toContain('المرجع خارج 14 يوم');
    expect(checkSource({ ...good(), trend: { ...good().trend, referenceDate: '2026-10-28', startedAt: '2026-10-28' } }, TODAY).errors).toContain('المرجع خارج 14 يوم');
    expect(checkSource({ ...good(), trend: { ...good().trend, startedAt: '2026-10-25' } }, TODAY).errors).toContain('بداية الترند بعد تاريخ المرجع');
    expect(checkSource({ ...good(), trend: { ...good().trend, startedAt: '2026-10-10', referenceDate: '2026-10-13' } }, TODAY).ok).toBe(true);   // exactly 14 days
  });
  it('rejects non-https links, repeats (even with a trailing slash or #), and bad dates', () => {
    expect(checkSource({ ...good(), referenceUrl: 'http://x.com/a' }, TODAY).errors).toContain('ليس رابطاً مباشراً صالحاً (https)');
    expect(checkSource({ ...good(), referenceUrl: 'javascript:alert(1)' }, TODAY).ok).toBe(false);
    expect(checkSource({ ...good(), previousBatchReferences: ['HTTPS://x.com/a/status/1/#t'] }, TODAY).errors).toContain('المرجع مكرر من دفعة سابقة');
    expect(checkSource({ ...good(), trend: { ...good().trend, referenceDate: '2026-02-30' } }, TODAY).ok).toBe(false);
  });
  it('sensitive needs Leen, forbidden never passes, anything else is refused', () => {
    expect(checkSource({ ...good(), classification: 'حساس يحتاج موافقة' }, TODAY)).toMatchObject({ ok: false, decision: 'needs_approval' });
    expect(checkSource({ ...good(), classification: 'ممنوع' }, TODAY)).toMatchObject({ ok: false, decision: 'reject' });
    expect(checkSource({ ...good(), classification: 'ok' }, TODAY).ok).toBe(false);
    expect(checkSource(null, TODAY).ok).toBe(false);
  });
});

describe('HOV-6 pack', () => {
  it('has the eight types, all design, with Arabic labels and sizes', () => {
    expect(HOV6.length).toBe(8);
    expect(new Set(HOV6.map(t => t.name)).size).toBe(8);
    for (const t of HOV6) { expect(t.kind).toBe('design'); expect(t.description).toContain('1080×1920'); for (const f of t.fields) expect(f.label).not.toBe(f.key); }
  });
  it('price and testimonial are variables, never filled in', () => {
    for (const t of HOV6) expect(t.body).not.toMatch(/\d|ريال|ر\.س/);
    expect(HOV6.find(t => t.name.includes('سعر'))!.fields.map(f => f.key)).toContain('price');
  });
  it('the dialect guide is a draft with the editorial-example warning', () => {
    expect(VOICE_DOC.title).toContain('مسودة');
    expect(VOICE_DOC.body).toContain('وليست بوستات ناجحة موثقة');
    expect(VOICE_DOC.body).not.toMatch(/https?:\/\//);
  });
});

describe('pack route', () => {
  const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
  const cfg = A.env(E);
  const owner: A.Profile = { id: '11111111-1111-1111-1111-111111111111', email: 'leen@example.com', active: true };
  const req = async (path: string, body: unknown) => new Request('https://hoven.example' + path, { method: 'POST', body: JSON.stringify(body),
    headers: { cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(owner, cfg), cfg.secret))}`, origin: 'https://hoven.example', 'sec-fetch-site': 'same-origin' } });
  it('hov6 adds the eight templates and the guide once; a second press adds nothing', async () => {
    const posts: { url: string; body: unknown[] }[] = []; let seeded = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes('/profiles?id=eq.')) return new Response(JSON.stringify([owner]));
      if (init.method === 'POST' && url.includes('library_')) { posts.push({ url, body: JSON.parse(String(init.body)) as unknown[] }); seeded = true; return new Response('', { status: 201 }); }
      if (url.includes('library_templates')) return new Response(JSON.stringify(seeded ? HOV6.map(t => ({ name: t.name })) : []));
      if (url.includes('library_documents')) return new Response(JSON.stringify(seeded ? [{ title: VOICE_DOC.title }] : []));
      return new Response('[]');
    }));
    const first = await (await ROUTES.library.starter.POST!(await req('/api/library/starter', { pack: 'hov6' }), E)).json();
    expect(first).toEqual({ ok: true, added: 8, documents: 1 });
    expect(posts.find(p => p.url.includes('library_documents'))!.body[0]).toMatchObject({ status: 'draft', source: 'hov6' });
    expect(await (await ROUTES.library.starter.POST!(await req('/api/library/starter', { pack: 'hov6' }), E)).json()).toEqual({ ok: true, added: 0, documents: 0 });
  });
  it('the gate route returns the verdict', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/profiles?id=eq.') ? [owner] : []))));
    const r = await (await ROUTES.library.sourcecheck.POST!(await req('/api/library/sourcecheck', {}), E)).json() as { ok: boolean };
    expect(r.ok).toBe(false);
  });
});
