// «احلم» in the browser: a project's chat and parts render, «اعتمد» locks a part and moves on, «عدّل» sends the instruction.
// The Dream API is answered in the browser (synthetic project), so this checks the page, not the model.
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

const PARTS = ['strategy', 'audience', 'budget', 'copy', 'design', 'motion', 'voiceover'];
const NAMES = { strategy: 'الاستراتيجية', audience: 'الجمهور', budget: 'الميزانية', copy: 'النصوص', design: 'التصاميم', motion: 'الموشن', voiceover: 'الفويس أوفر' };
const project = { id: 7, title: 'رمضان', idea: 'مفارش رمضان للعرسان', platforms: ['meta'], status: 'drafting' };

test('a project shows its chat and parts; approve and edit reach the API', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  let parts = [{ id: 1, kind: 'strategy', version: 1, status: 'draft', content: { goal: 'مبيعات رمضان', message: 'نومة أحلى', kpi: 'الطلبات', phases: [{ name: 'تشويق', days: 5, focus: 'ستوري' }] } }];
  const calls: { path: string; body: unknown }[] = [];
  await page.route('**/api/dream/**', async route => {
    const u = new URL(route.request().url()), path = u.pathname, body = route.request().postDataJSON?.() ?? null;
    calls.push({ path, body });
    const json = (o: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (path.endsWith('/state')) return json({ chat: { ok: true, engine: 'openrouter', model: 'm' }, voice: false, parts: PARTS, textParts: PARTS.slice(0, 4), names: NAMES });
    if (path.endsWith('/projects')) return json({ projects: [project] });
    if (path.endsWith('/item')) return json({ project, messages: [{ role: 'assistant', content: 'كم ميزانيتك التقريبية؟' }], parts, missing: ['strategy', 'audience', 'budget', 'copy'], canEdit: true, canApprove: true });
    if (path.endsWith('/approve')) { parts = parts.map(p => ({ ...p, status: 'approved' })); return json({ ok: true, missing: ['audience', 'budget', 'copy'] }); }
    if (path.endsWith('/draft')) return json({ part: { id: 2, kind: 'strategy', version: 2, status: 'draft', instruction: (body as { instruction: string }).instruction, content: { goal: 'مبيعات العرسان', message: 'م', kpi: 'ط' } }, stale: ['audience'] });
    return json({});
  });
  await page.goto('/dream/?id=7');
  await expect(page.locator('#log')).toContainText('كم ميزانيتك التقريبية؟');
  await expect(page.locator('#part')).toContainText('مبيعات رمضان');
  await expect(page.locator('#publish')).toContainText('باقي تعتمد');
  await page.locator('#part [data-ok]').click();
  await expect.poll(() => calls.some(c => c.path.endsWith('/approve'))).toBe(true);
  await expect(page.locator('#tabs [aria-selected="true"]')).toContainText('الجمهور');   // moves to the next part to approve
  await page.locator('#tabs [data-k="strategy"]').click();
  page.once('dialog', d => d.accept('ركز على العرسان'));
  await page.locator('#part [data-edit]').click();
  await expect(page.locator('#part')).toContainText('مبيعات العرسان');
  expect(calls.find(c => c.path.endsWith('/draft'))?.body).toMatchObject({ id: 7, kind: 'strategy', instruction: 'ركز على العرسان' });
  await expect(page.locator('#prog')).toContainText('الجمهور');
});

test('without a project the page asks for the idea', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.goto('/dream/');
  await expect(page.locator('#start')).toBeVisible();
  await expect(page.locator('#idea')).toBeVisible();
});

// A 1×1 JPEG, enough for the upload path
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

test('«ارسم التصاميم» draws, uploads and saves the designs as one version', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  const approved = (kind: string, id: number, content = {}) => ({ id, kind, version: 1, status: 'approved', content });
  let parts: unknown[] = [approved('strategy', 1, { goal: 'م', message: 'م', kpi: 'ط' }), approved('audience', 2, { segments: [] }), approved('budget', 3, { split: [], daily: 0, days: 1, total: 0 }),
    approved('copy', 4, { items: [{ platform: 'meta', format: 'ستوري', headline: 'مفارش رمضان', body: 'ن', cta: 'اطلب' }] })];
  const calls: string[] = [];
  let mediaBody: { images?: { key: string; headline: string }[] } = {};
  await page.route('**/api/dream/**', async route => {
    const path = new URL(route.request().url()).pathname; calls.push(`${route.request().method()} ${path}`);
    const json = (o: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (path.endsWith('/state')) return json({ chat: { ok: true }, voice: false, draw: true, files: true, parts: PARTS, textParts: PARTS.slice(0, 4), drafted: [...PARTS.slice(0, 4), 'voiceover', 'motion'], required: [...PARTS.slice(0, 4), 'design'], names: NAMES, why: { draw: '', voice: 'الفويس أوفر يحتاج GEMINI_API_KEY' } });
    if (path.endsWith('/projects')) return json({ projects: [project] });
    if (path.endsWith('/item')) return json({ project, messages: [], parts, missing: ['design'], canEdit: true, canApprove: true });
    if (path.endsWith('/draw')) return json({ image: JPEG, item: { platform: 'meta', format: 'ستوري', headline: 'مفارش رمضان', cta: 'اطلب' }, index: 0, of: 1 });
    if (path.endsWith('/file') && route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from(JPEG.split(',')[1]!, 'base64') });
    if (path.endsWith('/file')) return json({ ok: true, key: 'motion/x/' + 'a'.repeat(32) + '.jpg' });
    if (path.endsWith('/media')) { mediaBody = route.request().postDataJSON(); const part = { id: 9, kind: 'design', version: 1, status: 'draft', content: { images: mediaBody.images } }; parts = [...parts, part]; return json({ part, stale: [] }); }
    return json({});
  });
  await page.goto('/dream/?id=7');
  await expect(page.locator('#tabs [aria-selected="true"]')).toContainText('التصاميم');   // the first part left to approve
  await page.locator('#drawBtn').click();
  await expect(page.locator('#prog')).toContainText('انرسمت');
  expect(calls.filter(c => c === 'POST /api/dream/draw')).toHaveLength(1);
  expect(calls.filter(c => c === 'POST /api/dream/file')).toHaveLength(1);   // one upload (the GETs are the picture showing)
  expect(mediaBody.images?.[0]).toMatchObject({ headline: 'مفارش رمضان' });
  await expect(page.locator('.dr-design figcaption')).toContainText('مفارش رمضان');
  await expect(page.locator('#part [data-ok]')).toBeVisible();
});

test('«انشر» asks for the link and budgets, sends one key per click, then «شغّل» switches the campaign on', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  const ok = (kind: string, id: number, content = {}) => ({ id, kind, version: 1, status: 'approved', content });
  const parts = [ok('strategy', 1, { goal: 'م', message: 'م', kpi: 'ط' }), ok('audience', 2, { segments: [] }), ok('budget', 3, { split: [{ platform: 'meta', daily: 300 }], daily: 300, days: 14, total: 4200 }),
    ok('copy', 4, { items: [] }), ok('design', 5, { images: [] })];
  let launches: unknown[] = [];
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/dream/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (o: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (route.request().method() === 'POST') bodies.push({ path, ...route.request().postDataJSON() });
    if (path.endsWith('/state')) return json({ chat: { ok: true }, draw: true, voice: true, files: true, parts: PARTS, textParts: PARTS.slice(0, 4), drafted: PARTS, required: [...PARTS.slice(0, 4), 'design'], names: NAMES, why: {} });
    if (path.endsWith('/projects')) return json({ projects: [project] });
    if (path.endsWith('/item')) return json({ project, messages: [], parts, missing: [], canEdit: true, canApprove: true });
    if (path.endsWith('/launches')) return json({ launches, writers: ['meta'], owner: true });
    if (path.endsWith('/publish')) { launches = [{ id: 3, platform: 'meta', status: 'created', daily_sar: 350 }]; return json({ launches: [{ platform: 'meta', status: 'created', launch: 3 }] }); }
    if (path.endsWith('/activate')) { launches = [{ id: 3, platform: 'meta', status: 'active', daily_sar: 350 }]; return json({ ok: true, status: 'active' }); }
    return json({});
  });
  await page.goto('/dream/?id=7');
  await expect(page.locator('#pubForm')).toBeVisible();
  await expect(page.locator('#b-meta')).toHaveValue('300');   // from the approved budget
  await page.locator('#pubLink').fill('https://hoven.example/p');
  await page.locator('#b-meta').fill('350');
  page.on('dialog', d => d.accept());
  await page.locator('#pubBtn').click();
  await expect(page.locator('.dr-launches')).toContainText('منشأة وموقوفة');
  const pub = bodies.find(b => String(b['path']).endsWith('/publish'))!;
  expect(pub).toMatchObject({ id: 7, link: 'https://hoven.example/p', budgets: { meta: 350 } });
  expect(String(pub['key'])).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
  await page.locator('[data-on="3"]').click();
  await expect(page.locator('.dr-launches')).toContainText('شغّالة');
  const act = bodies.find(b => String(b['path']).endsWith('/activate'))!;
  expect(act).toMatchObject({ launch: 3, on: true });
  expect(act['key']).not.toBe(pub['key']);
  await expect(page.locator('[data-off="3"]')).toBeVisible();
});
