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
