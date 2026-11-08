// Product studio: the Hoven scene rules, the fixed flat overlay, the Salla image fetch guard, and the route.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scenePrompt, overlaySpec, sallaImageUrl, fetchSallaImage, STUDIO_SIZES, SCENES, TEXT_COLORS, MAX_PHOTO } from './studio';
import { openaiImage } from '../../lib/llm';
import * as A from '../../lib/auth';
import { ROUTES } from '../routes';

afterEach(() => { vi.unstubAllGlobals(); });

describe('scene prompt', () => {
  it('keeps the product, forbids gold, haze, symbols and any text inside the picture', () => {
    const p = scenePrompt('bedroom', 'feed', true);
    expect(p).toContain('exactly as it is');
    expect(p).toMatch(/No gold/);
    expect(p).toMatch(/No AI look/);
    expect(p).toMatch(/dallah, sadu, lanterns, crescent/);
    expect(p).toMatch(/No text, letters, numbers, logos/);
    expect(p).toMatch(/new scene/);
    expect(p).not.toMatch(/healthcare|syringe|before\/after/i);        // nothing left from the old health prompt
  });
  it('without a product photo it does not claim one, and the frame follows the size', () => {
    expect(scenePrompt('kids', 'story', false)).not.toContain('exactly as it is');
    expect(scenePrompt('kids', 'story', false)).toContain('vertical 9:16');
    expect(scenePrompt('hotel', 'x', true)).toContain('wide 16:9');
    expect(scenePrompt('guest', 'feed', true, 'x'.repeat(500))).toContain('Extra direction: ' + 'x'.repeat(200));
    expect(Object.keys(SCENES).length).toBe(4);
  });
});

describe('overlay', () => {
  it('is flat: no box, shadow, stroke, gradient, italics or letter spacing; brand colours only', () => {
    const o = overlaySpec('feed', 'green');
    expect(o.flat).toEqual({ box: false, shadow: false, stroke: 0, gradient: false, italic: false, letterSpacing: 0 });
    expect(o).toMatchObject({ color: '#294036', align: 'right', direction: 'rtl', size: { w: 1080, h: 1350 } });
    expect(Object.values(TEXT_COLORS)).toEqual(['#141414', '#FFFFFF', '#293342', '#294036']);
  });
  it('9:16 leaves the platform margins (210 px) empty; the zone stays inside the frame', () => {
    const o = overlaySpec('story');
    expect(o.zone.y * STUDIO_SIZES.story.h).toBeGreaterThanOrEqual(210);
    for (const k of ['feed', 'story', 'x'] as const) { const z = overlaySpec(k).zone; expect(z.x + z.w).toBeLessThanOrEqual(1); expect(z.y + z.h).toBeLessThanOrEqual(1); }
  });
});

describe('Salla image guard', () => {
  it('only https on Salla image hosts, no port or credentials, no look-alikes', () => {
    expect(sallaImageUrl('https://cdn.salla.sa/abc/p.jpg')).not.toBeNull();
    for (const bad of ['http://cdn.salla.sa/a.jpg', 'https://cdn.salla.sa.evil.com/a.jpg', 'https://evil.com/cdn.salla.sa/a.jpg', 'https://cdn.salla.sa:8443/a.jpg',
      'https://user:pw@cdn.salla.sa/a.jpg', 'https://127.0.0.1/a.jpg', 'file:///etc/passwd', 'javascript:alert(1)', '', 'not a url']) expect(sallaImageUrl(bad)).toBeNull();
  });
  const img = (type: string, bytes = 10, extra: Record<string, string> = {}) => vi.fn(async () => new Response(new Uint8Array(bytes), { headers: { 'content-type': type, ...extra } }));
  it('fetches an image, refusing redirects, non-images and big files', async () => {
    const f = img('image/webp');
    const got = await fetchSallaImage('https://cdn.salla.sa/a.webp', f as unknown as typeof fetch);
    expect(got).toMatchObject({ mime: 'image/webp' });
    expect((f.mock.calls[0] as unknown[])[1]).toMatchObject({ redirect: 'error' });
    expect(await fetchSallaImage('https://cdn.salla.sa/a', img('text/html') as unknown as typeof fetch)).toHaveProperty('error');
    expect(await fetchSallaImage('https://cdn.salla.sa/a', img('image/png', 5, { 'content-length': String(MAX_PHOTO + 1) }) as unknown as typeof fetch)).toHaveProperty('error');
    expect(await fetchSallaImage('https://cdn.salla.sa/a', img('image/png', MAX_PHOTO + 1) as unknown as typeof fetch)).toHaveProperty('error');
    expect(await fetchSallaImage('https://evil.com/a.jpg', img('image/png') as unknown as typeof fetch)).toHaveProperty('error');
    expect(await fetchSallaImage('https://cdn.salla.sa/a', (async () => { throw new Error('redirect'); }) as unknown as typeof fetch)).toHaveProperty('error');
  });
});

describe('image call', () => {
  it('uses the size asked for and names a webp product file as webp', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: 'AAAA' }] })));
    await openaiImage({ OPENAI_API_KEY: 'k' }, 'p', f as unknown as typeof fetch, { bytes: new Uint8Array(3), mime: 'image/webp' }, '1536x1024');
    const form = ((f.mock.calls[0] as unknown[])[1] as { body: FormData }).body;
    expect(form.get('size')).toBe('1536x1024');
    expect((form.get('image') as File).name).toBe('product.webp');
  });
});

describe('route', () => {
  const E: A.AuthEnv & { OPENAI_API_KEY?: string } = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
  const cfg = A.env(E);
  const owner: A.Profile = { id: '11111111-1111-1111-1111-111111111111', email: 'leen@example.com', active: true };
  const req = async (body: unknown) => new Request('https://hoven.example/api/design/studio', { method: 'POST', body: JSON.stringify(body),
    headers: { cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(owner, cfg), cfg.secret))}`, origin: 'https://hoven.example', 'sec-fetch-site': 'same-origin' } });
  const stub = (calls: string[] = []) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push(url + (init.method ? ' ' + init.method : ''));
    if (url.includes('/profiles?id=eq.')) return new Response(JSON.stringify([owner]));
    if (url.includes('cdn.salla.sa')) return new Response(new Uint8Array(20), { headers: { 'content-type': 'image/jpeg' } });
    if (url.includes('api.openai.com')) return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }));
    return new Response('[]');
  }));

  it('without an image model it still returns the prompt, the overlay and the compliance notes', async () => {
    stub();
    const r = await (await ROUTES.design.studio.POST!(await req({ size: 'story', scene: 'hotel', title: 'أفضل نوم مضمون', tone: 'light' }), E)).json() as Record<string, unknown> & { overlay: { color: string } };
    expect(r).toMatchObject({ image: null, reason: 'no_image_model' });
    expect(r.overlay.color).toBe('#FFFFFF');
    expect(String(r.prompt)).toContain('hotel suite');
    expect((r.notes as string[]).length).toBeGreaterThan(0);          // «مضمون» / «أفضل»
  });
  it('with the key and a Salla link it edits that photo into a new scene', async () => {
    const calls: string[] = []; stub(calls);
    const withKey = { ...E, OPENAI_API_KEY: 'k' };
    const r = await (await ROUTES.design.studio.POST!(await req({ product_url: 'https://cdn.salla.sa/x/p.jpg', size: 'x' }), withKey)).json() as { image: string; reason: null };
    expect(r.image).toMatch(/^data:image\/jpeg;base64,/);
    expect(calls.some(c => c.includes('cdn.salla.sa'))).toBe(true);
    expect(calls.some(c => c.includes('/v1/images/edits'))).toBe(true);
  });
  it('refuses a product link that is not Salla\'s, and fetches nothing', async () => {
    const calls: string[] = []; stub(calls);
    const r = await ROUTES.design.studio.POST!(await req({ product_url: 'http://169.254.169.254/latest' }), E);
    expect(r.status).toBe(400);
    expect(calls.some(c => c.includes('169.254'))).toBe(false);
  });
});
