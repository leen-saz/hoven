// Two-step sign-in: TOTP (RFC 6238, SHA-1, 6 digits, 30 s) on WebCrypto, with the secret sealed at rest, hashed
// recovery codes, and a short-lived "password passed" token. No dependency.
import { sign, verify } from './auth';

const enc = new TextEncoder(), dec = new TextDecoder();
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_MS = 30_000;
export const MAX_FAILS = 5;
export const LOCK_MS = 15 * 60_000;
export const PENDING_MS = 5 * 60_000;

export function b32encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function b32decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = []; let bits = 0, value = 0;
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('bad base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

export const newSecret = (): string => b32encode(crypto.getRandomValues(new Uint8Array(20)));

export async function hotp(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(b32decode(secret)), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8); new DataView(msg.buffer).setUint32(4, counter >>> 0); new DataView(msg.buffer).setUint32(0, Math.floor(counter / 2 ** 32));
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[19]! & 15;
  const n = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

// The step a code belongs to (this one or one either side, for clock drift), or null. Steps at or below lastStep are
// refused, so a code works once.
export async function checkTotp(secret: string, code: string, now = Date.now(), lastStep = 0): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / STEP_MS);
  for (const s of [step, step - 1, step + 1]) if (s > lastStep && (await hotp(secret, s)) === code) return s;
  return null;
}

export const otpauth = (secret: string, email: string, issuer = 'Hoven'): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---- Sealing (AES-GCM, key from the app secret)
async function aes(appSecret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(appSecret + ':totp-seal'));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(plain: string, appSecret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(appSecret), enc.encode(plain)));
  return `v1.${b64u(iv)}.${b64u(ct)}`;
}
export async function open(sealed: string, appSecret: string): Promise<string | null> {
  const [v, iv, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct) return null;
  try { return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await aes(appSecret), unb64u(ct))); } catch { return null; }
}

// ---- Recovery codes: shown once, kept as hashes, each works once
export const newRecoveryCodes = (n = 8): string[] => Array.from({ length: n }, () => { const s = b32encode(crypto.getRandomValues(new Uint8Array(7))).toLowerCase().slice(0, 10); return `${s.slice(0, 5)}-${s.slice(5)}`; });
export async function hashCode(code: string, appSecret: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${appSecret}:recovery:${code.trim().toLowerCase()}`)));
  return [...h].map(x => x.toString(16).padStart(2, '0')).join('');
}

// ---- "Password passed, code still needed". Signed with a different key than the session cookie, so it can never be
// presented as a session.
const pendingKey = (appSecret: string) => `${appSecret}:2fa-pending`;
export const signPending = (uid: string, next: string, appSecret: string, now = Date.now()): Promise<string> => sign({ uid, next, exp: now + PENDING_MS }, pendingKey(appSecret));
export async function readPending(token: unknown, appSecret: string, now = Date.now()): Promise<{ uid: string; next: string } | null> {
  const p = await verify(typeof token === 'string' ? token : '', pendingKey(appSecret), now) as unknown as { uid: string; next?: string } | null;
  return p ? { uid: p.uid, next: typeof p.next === 'string' ? p.next : '' } : null;
}
