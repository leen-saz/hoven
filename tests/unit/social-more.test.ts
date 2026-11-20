// Social media additions (docs/PRD.md §3.5, §3.6): a platform's own text, posting slots in Riyadh time, and the hourly
// account check that waits an hour before calling an account disconnected. Synthetic data.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { api } from '../../src/api/index';
import { validate, textFor, publishPost, cleanSlots, nextSlot, type Draft } from '../../src/modules/social/social';
import { nextHealth, runAccountHealth, GRACE_MS } from '../../src/lib/account-health';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const NOW = Date.parse('2026-11-20T09:00:00Z');   // Friday 12:00 Riyadh
const later = new Date(NOW + 3600e3).toISOString();

describe("a platform's own text", () => {
  it('each platform is checked against its own limit; an override fixes a long shared text', () => {
    const long = 'ن'.repeat(400);
    expect(validate({ platforms: ['x', 'facebook'], body: long, publish_at: later }, NOW).error).toContain('X');
    const v = validate({ platforms: ['x', 'facebook'], body: long, publish_at: later, overrides: { x: 'قصير', instagram: 'ما اخترتها' } }, NOW);
    expect(v.error).toBeUndefined();
    expect(v.draft!.overrides).toEqual({ x: 'قصير' });   // only chosen platforms
  });
  it('compliance notices cover the platform texts too', () => {
    const v = validate({ platforms: ['facebook'], body: 'مفارش', publish_at: later, overrides: { facebook: 'الأرخص في السعودية' } }, NOW);
    expect(v.notices.length).toBeGreaterThan(0);
  });
  it('each platform publishes its own text, the rest the shared one', async () => {
    const post: Draft = { platforms: ['facebook'], body: 'مشترك', media: [], publish_at: later, mode: 'manual', overrides: { facebook: 'خاص بفيسبوك' } };
    expect(textFor(post, 'facebook')).toBe('خاص بفيسبوك');
    expect(textFor(post, 'instagram')).toBe('مشترك');
    const sent: string[] = [];
    const f = (async (_u: string, init?: RequestInit) => { sent.push(String(init?.body ?? '')); return new Response(JSON.stringify({ id: '1_2' })); }) as unknown as typeof fetch;
    await publishPost(post, { META_PAGE_ID: 'P', META_PAGE_ACCESS_TOKEN: 'T' }, f);
    const bodies = sent.map(b => new URLSearchParams(b).get('message'));
    expect(bodies).toContain('خاص بفيسبوك');
    expect(bodies).not.toContain('مشترك');
  });
});

describe('posting slots', () => {
  it('keeps valid, unique slots in week order', () => {
    expect(cleanSlots([{ weekday: 5, at: '20:00' }, { weekday: 1, at: '09:30' }, { weekday: 5, at: '20:00' }, { weekday: 7, at: '10:00' }, { weekday: 1, at: '25:00' }]))
      .toEqual([{ weekday: 1, at: '09:30' }, { weekday: 5, at: '20:00' }]);
  });
  it('the next free slot is in Riyadh time and skips a slot a post already holds', () => {
    const slots = cleanSlots([{ weekday: 5, at: '20:00' }, { weekday: 6, at: '10:00' }]);   // Friday 20:00, Saturday 10:00
    expect(nextSlot(slots, [], NOW)).toBe('2026-11-20T17:00:00.000Z');
    expect(nextSlot(slots, ['2026-11-20T17:00:00.000Z'], NOW)).toBe('2026-11-21T07:00:00.000Z');
    expect(nextSlot([], [], NOW)).toBeNull();
  });
});

describe('account health', () => {
  it('one failure is «failing»; still failing after an hour is «down»; any success is ok again', () => {
    const a = nextHealth(null, false, 'token', NOW);
    expect(a).toMatchObject({ health: 'failing', code: 'token' });
    expect(nextHealth(a, false, 'token', NOW + GRACE_MS - 1).health).toBe('failing');
    expect(nextHealth(a, false, 'token', NOW + GRACE_MS).health).toBe('down');
    expect(nextHealth(a, true, null, NOW + GRACE_MS)).toEqual({ health: 'ok', failing_since: null, code: null });
  });
  it('checks the connected Meta accounts with a light read and stores codes only', async () => {
    const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'o@x.test' };
    const writes: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      const url = String(u);
      if (url.includes('connector_env')) return new Response(JSON.stringify([{ name: 'META_ACCESS_TOKEN', value: 'BAD' }, { name: 'META_PAGE_ID', value: 'P' }, { name: 'META_PAGE_ACCESS_TOKEN', value: 'OK' }]));
      if (url.includes('/connection_health') && (init?.method ?? 'GET') === 'GET') return new Response('[]');
      if (url.includes('/connection_health')) { writes.push(JSON.parse(String(init?.body))); return new Response('', { status: 201 }); }
      if (url.includes('graph.facebook.com')) return url.includes('BAD') ? new Response('{"error":{}}', { status: 400 }) : new Response('{"id":"P"}');
      return new Response('[]');
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = await runAccountHealth(A.env(E), fetch, NOW);
    expect(out['meta']).toMatchObject({ health: 'failing', code: 'token' });
    expect(out['meta_pages']).toMatchObject({ health: 'ok' });
    expect(JSON.stringify(writes)).not.toContain('BAD');
  });
});

describe('slots API', () => {
  const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.test' };
  const cfg = A.env(E);
  const editor = { id: '22222222-2222-4222-8222-222222222222', email: 'e@example.test', role: 'member', dashboards: ['social'], access: { social: 'edit' }, active: true } as A.Profile;
  const owner: A.Profile = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test', role: 'owner', active: true };
  const cookie = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
  const post = async (who: A.Profile, body: unknown) => api.request('https://hoven.example/api/social/slots', { method: 'POST', body: JSON.stringify(body), headers: { cookie: await cookie(who), origin: 'https://hoven.example', 'content-type': 'application/json' } }, E);
  it('only an approver changes the slots, which replace the old ones', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(u).split('?')[0]}`);
      if (String(u).includes('/profiles')) return new Response(JSON.stringify([init && String(u).includes('22222222') ? editor : owner]));
      return new Response('[]', { status: 200 });
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect((await post(editor, { slots: [{ weekday: 1, at: '09:00' }] })).status).toBe(403);
    expect((await post(owner, { slots: [{ weekday: 1, at: '09:00' }] })).status).toBe(200);
    expect(calls).toEqual(expect.arrayContaining(['DELETE https://sb.example/rest/v1/social_slots', 'POST https://sb.example/rest/v1/social_slots']));
  });
});
