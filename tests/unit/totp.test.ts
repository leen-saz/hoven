// Two-step sign-in: RFC 6238 vectors, sealing, recovery codes, the pending token, the login second step and enrolment.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { b32encode, b32decode, hotp, checkTotp, otpauth, seal, open, newRecoveryCodes, hashCode, signPending, readPending, newSecret, STEP_MS } from '../../src/lib/totp';
import { login, twofa } from '../../src/api/routes/auth';
import { totp } from '../../src/api/routes/account';

afterEach(() => { vi.unstubAllGlobals(); });
const RFC = b32encode(new TextEncoder().encode('12345678901234567890'));   // the RFC 6238 test secret
const SECRET = 'x'.repeat(40);
const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: SECRET, OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(E);

describe('totp', () => {
  it('base32 round-trips and matches the RFC alphabet', () => {
    expect(RFC).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(new TextDecoder().decode(b32decode(RFC))).toBe('12345678901234567890');
    expect(() => b32decode('1!')).toThrow();
  });
  it('RFC 6238 vectors (last 6 digits of the 8-digit values)', async () => {
    expect(await hotp(RFC, Math.floor(59 / 30))).toBe('287082');
    expect(await hotp(RFC, Math.floor(1111111109 / 30))).toBe('081804');
    expect(await hotp(RFC, Math.floor(1234567890 / 30))).toBe('005924');
  });
  it('accepts one step of drift, refuses older, and a code works once', async () => {
    const now = 1_700_000_000_000, step = Math.floor(now / STEP_MS);
    const code = await hotp(RFC, step);
    expect(await checkTotp(RFC, code, now)).toBe(step);
    expect(await checkTotp(RFC, code, now + STEP_MS)).toBe(step);        // drift of one step
    expect(await checkTotp(RFC, code, now + 3 * STEP_MS)).toBeNull();      // too old
    expect(await checkTotp(RFC, code, now, step)).toBeNull();              // already used
    expect(await checkTotp(RFC, '12345', now)).toBeNull();
    expect(await checkTotp(RFC, 'abcdef', now)).toBeNull();
  });
  it('otpauth link names the issuer and the account', () => {
    expect(otpauth('ABC', 'a@b.sa')).toBe('otpauth://totp/Hoven:a%40b.sa?secret=ABC&issuer=Hoven&algorithm=SHA1&digits=6&period=30');
    expect(newSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
  it('sealing hides the secret and only the right app secret opens it', async () => {
    const sealed = await seal(RFC, SECRET);
    expect(sealed).not.toContain(RFC);
    expect(await open(sealed, SECRET)).toBe(RFC);
    expect(await open(sealed, 'y'.repeat(40))).toBeNull();
    expect(await open('garbage', SECRET)).toBeNull();
    expect(await seal(RFC, SECRET)).not.toBe(sealed);                      // fresh IV each time
  });
  it('recovery codes: 8 unique, hashed, case and dash tolerant', async () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(await hashCode(codes[0]!, SECRET)).toBe(await hashCode(codes[0]!.toUpperCase(), SECRET));
    expect(await hashCode(codes[0]!, SECRET)).not.toBe(await hashCode(codes[1]!, SECRET));
  });
  it('the pending token expires and is never a session', async () => {
    const t = await signPending('u1', '/control/', SECRET, 1000);
    expect(await readPending(t, SECRET, 2000)).toEqual({ uid: 'u1', next: '/control/' });
    expect(await readPending(t, SECRET, 1000 + 6 * 60_000)).toBeNull();
    expect(await readPending(t, 'y'.repeat(40), 2000)).toBeNull();
    expect(await A.verify(t, SECRET, 2000)).toBeNull();                      // not valid as a session cookie
  });
});

// ---- Routes
type Call = { url: string; init: RequestInit };
const req = (path: string, body: unknown, cookie = '') => new Request('https://hoven.example' + path, { method: 'POST', body: JSON.stringify(body), headers: { cookie, origin: 'https://hoven.example', 'sec-fetch-site': 'same-origin' } });
const stub = (profile: Record<string, unknown> | null, calls: Call[] = []) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
  calls.push({ url, init });
  if (url.includes('/auth/v1/token')) return new Response(JSON.stringify({ user: { id: 'u1' }, access_token: 't' }));
  if (url.includes('/profiles?id=eq.')) return new Response(init.method === 'PATCH' ? '' : JSON.stringify(profile ? [profile] : []));
  return new Response('[]');
}));
const base = { id: 'u1', email: 'a@b.sa', active: true, role: 'member', dashboards: ['ceo'] };
const patches = (calls: Call[]) => calls.filter(c => c.init.method === 'PATCH' && c.url.includes('/profiles')).map(c => JSON.parse(String(c.init.body)) as Record<string, unknown>);

describe('login', () => {
  it('without 2FA nothing changes: a session cookie is set', async () => {
    stub(base);
    const r = await login.POST!(req('/api/auth/login', { email: 'a@b.sa', password: 'pw' }), E);
    expect(r.headers.get('set-cookie')).toContain(A.SESSION);
  });
  it('with 2FA the password alone gets no cookie, only a pending token', async () => {
    stub({ ...base, totp_enabled: true, totp_secret: await seal(RFC, SECRET) });
    const r = await login.POST!(req('/api/auth/login', { email: 'a@b.sa', password: 'pw', next: '/control/' }), E);
    const j = await r.json() as { need2fa: boolean; pending: string };
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(j.need2fa).toBe(true);
    expect(await readPending(j.pending, cfg.secret)).toEqual({ uid: 'u1', next: '/control/' });
  });
});

describe('second step', () => {
  const setup = async (extra: Record<string, unknown> = {}) => ({ pending: await signPending('u1', '/control/', cfg.secret), profile: { ...base, totp_enabled: true, totp_secret: await seal(RFC, SECRET), totp_recovery: [] as string[], totp_last_step: 0, totp_fails: 0, ...extra } });
  it('a right code opens the session, stores the step, and a replay is refused', async () => {
    const { pending, profile } = await setup();
    const calls: Call[] = []; stub(profile, calls);
    const code = await hotp(RFC, Math.floor(Date.now() / STEP_MS));
    const r = await twofa.POST!(req('/api/auth/twofa', { pending, code }), E);
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toContain(A.SESSION);
    expect((await r.json() as { next: string }).next).toBe('/control/');
    expect(patches(calls)[0]).toMatchObject({ totp_fails: 0 });
    stub({ ...profile, totp_last_step: Math.floor(Date.now() / STEP_MS) });
    expect((await twofa.POST!(req('/api/auth/twofa', { pending, code }), E)).status).toBe(401);
  });
  it('a wrong code counts, and the 5th locks it for 15 minutes', async () => {
    const { pending, profile } = await setup({ totp_fails: 4 });
    const calls: Call[] = []; stub(profile, calls);
    const r = await twofa.POST!(req('/api/auth/twofa', { pending, code: '000000' }), E);
    expect(r.status).toBe(401); expect(r.headers.get('set-cookie')).toBeNull();
    expect(patches(calls)[0]).toHaveProperty('totp_locked_until');
    stub({ ...profile, totp_locked_until: new Date(Date.now() + 600_000).toISOString() });
    expect((await twofa.POST!(req('/api/auth/twofa', { pending, code: await hotp(RFC, Math.floor(Date.now() / STEP_MS)) }), E)).status).toBe(429);
  });
  it('a recovery code works once and is removed', async () => {
    const [c1, c2] = newRecoveryCodes(2) as [string, string];
    const { pending, profile } = await setup({ totp_recovery: [await hashCode(c1, cfg.secret), await hashCode(c2, cfg.secret)] });
    const calls: Call[] = []; stub(profile, calls);
    const r = await twofa.POST!(req('/api/auth/twofa', { pending, code: c1.toUpperCase() }), E);
    expect(r.status).toBe(200);
    expect((patches(calls)[0]!.totp_recovery as string[])).toEqual([await hashCode(c2, cfg.secret)]);
  });
  it('a missing or expired pending token is refused', async () => {
    stub(base);
    expect((await twofa.POST!(req('/api/auth/twofa', { pending: 'x', code: '123456' }), E)).status).toBe(401);
  });
});

describe('enrolment', () => {
  const cookie = async () => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(base as A.Profile, cfg), cfg.secret))}`;
  it('start → confirm turns it on with sealed secret and hashed recovery codes', async () => {
    const calls: Call[] = []; stub(base, calls);
    const s = await (await totp.POST!(req('/api/account/totp', { action: 'start' }, await cookie()), E)).json() as { secret: string; sealed: string; uri: string };
    expect(s.uri).toContain(s.secret);
    expect(s.sealed).not.toContain(s.secret);
    const bad = await totp.POST!(req('/api/account/totp', { action: 'confirm', sealed: s.sealed, code: '000000' }, await cookie()), E);
    expect(bad.status).toBe(400);
    const code = await hotp(s.secret, Math.floor(Date.now() / STEP_MS));
    const ok = await (await totp.POST!(req('/api/account/totp', { action: 'confirm', sealed: s.sealed, code }, await cookie()), E)).json() as { ok: boolean; recovery: string[] };
    expect(ok.recovery.length).toBe(8);
    const saved = patches(calls).at(-1)!;
    expect(saved).toMatchObject({ totp_enabled: true });
    expect(String(saved.totp_secret)).not.toContain(s.secret);
    expect(JSON.stringify(saved.totp_recovery)).not.toContain(ok.recovery[0]!);
  });
  it('a sealed setup from another account does not confirm', async () => {
    stub(base);
    const sealed = await seal(JSON.stringify({ s: RFC, uid: 'someone-else', exp: Date.now() + 60_000 }), cfg.secret);
    const r = await totp.POST!(req('/api/account/totp', { action: 'confirm', sealed, code: await hotp(RFC, Math.floor(Date.now() / STEP_MS)) }, await cookie()), E);
    expect(r.status).toBe(400);
  });
  it('turning it off needs the password and a code', async () => {
    const calls: Call[] = []; stub({ ...base, totp_enabled: true, totp_secret: await seal(RFC, SECRET), totp_last_step: 0 }, calls);
    const noCode = await totp.POST!(req('/api/account/totp', { action: 'disable', current: 'pw', code: '000000' }, await cookie()), E);
    expect(noCode.status).toBe(400);
    const r = await totp.POST!(req('/api/account/totp', { action: 'disable', current: 'pw', code: await hotp(RFC, Math.floor(Date.now() / STEP_MS)) }, await cookie()), E);
    expect(r.status).toBe(200);
    expect(patches(calls).at(-1)).toMatchObject({ totp_enabled: false, totp_secret: null });
  });
});
