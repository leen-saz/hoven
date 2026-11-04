// /api/account/password. Port of web/api/account/password.js: changing the password needs the current one.
import { sb, json, readJson, handle, requireUser, audit, loadProfile, PASSWORD_MIN, can } from '../../lib/auth';
import { newSecret, seal, open, checkTotp, otpauth, newRecoveryCodes, hashCode } from '../../lib/totp';
import { MODULES } from '../../modules/registry';

export const password = {
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'any', { write: true });
    const body = await readJson(request);
    const current = String(body.current || ''), pw = String(body.password || '');
    if (pw.length < PASSWORD_MIN) return json(400, { error: `الباسوورد لازم ${PASSWORD_MIN} أحرف أو أكثر` });
    const r = await sb<{ access_token?: string }>(cfg, '/auth/v1/token?grant_type=password', { method: 'POST', body: { email: user.email, password: current } });
    if (!r.ok || !r.data || !r.data.access_token) return json(400, { error: 'الباسوورد الحالي غلط' });
    const u = await sb(cfg, '/auth/v1/user', { method: 'PUT', token: r.data.access_token, body: { password: pw } });
    if (!u.ok) return json(400, { error: 'ما تغيّر الباسوورد، جرّب مرة ثانية' });
    await audit(cfg, user, 'password_changed');
    return json(200, { ok: true });
  }),
  GET: handle(async (request, e) => {
    const { user } = await requireUser(request, e, 'any');
    // The sidebar draws every module from here: locked = switched off for the company, ok = this user may open it
    const modules = MODULES.map(m => ({ key: m.key, ar: m.ar, en: m.en, icon: m.icon, group: m.group, status: m.status, does: m.does, doesEn: m.doesEn, pages: m.pages ?? [],
      locked: !!user.off?.includes(m.key), ok: m.status === 'soon' || can(user, m.key) }));
    return json(200, { email: user.email, name: user.name, role: user.role, dashboards: user.dash, departments: user.depts || [], modules });
  }),
};

// Two-step sign-in (TOTP). GET: status. POST { action: 'start' } gives a secret (sealed copy included); { action: 'confirm', sealed, code }
// turns it on and returns the recovery codes once; { action: 'disable', current, code } turns it off (password and a code).
const SETUP_MS = 10 * 60_000;
export const totp = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'any');
    const p = await loadProfile(cfg, user.uid);
    return json(200, { enabled: !!p?.totp_enabled, recovery: p?.totp_recovery?.length ?? 0 });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'any', { write: true });
    const b = await readJson(request);
    const p = await loadProfile(cfg, user.uid);
    if (!p) return json(404, { error: 'الحساب مو موجود' });
    const patch = (body: Record<string, unknown>) => sb(cfg, `/rest/v1/profiles?id=eq.${encodeURIComponent(user.uid)}`, { method: 'PATCH', admin: true, headers: { Prefer: 'return=minimal' }, body });
    const migration = () => json(500, { error: 'ما انحفظ. تأكد إن migration 025_totp.sql انطبق' });

    if (b.action === 'start') {
      if (p.totp_enabled) return json(400, { error: 'التحقق بخطوتين مفعّل من قبل' });
      const secret = newSecret();
      return json(200, { secret, uri: otpauth(secret, user.email), sealed: await seal(JSON.stringify({ s: secret, uid: user.uid, exp: Date.now() + SETUP_MS }), cfg.secret) });
    }
    if (b.action === 'confirm') {
      const o = JSON.parse((await open(String(b.sealed || ''), cfg.secret)) || 'null') as { s?: string; uid?: string; exp?: number } | null;
      if (!o?.s || o.uid !== user.uid || !o.exp || o.exp < Date.now()) return json(400, { error: 'انتهت المحاولة. ابدأ من جديد.' });
      const step = await checkTotp(o.s, String(b.code || '').trim());
      if (step === null) return json(400, { error: 'الكود غلط' });
      const codes = newRecoveryCodes();
      const r = await patch({ totp_secret: await seal(o.s, cfg.secret), totp_enabled: true, totp_recovery: await Promise.all(codes.map(c => hashCode(c, cfg.secret))), totp_last_step: step, totp_fails: 0, totp_locked_until: null });
      if (!r.ok) return migration();
      await audit(cfg, user, 'totp_enabled');
      return json(200, { ok: true, recovery: codes });
    }
    if (b.action === 'disable') {
      if (!p.totp_enabled || !p.totp_secret) return json(400, { error: 'التحقق بخطوتين مو مفعّل' });
      const auth = await sb<{ access_token?: string }>(cfg, '/auth/v1/token?grant_type=password', { method: 'POST', body: { email: user.email, password: String(b.current || '') } });
      if (!auth.ok || !auth.data?.access_token) return json(400, { error: 'الباسوورد الحالي غلط' });
      const secret = await open(p.totp_secret, cfg.secret);
      const code = String(b.code || '').trim();
      if (!secret || (await checkTotp(secret, code, Date.now(), p.totp_last_step || 0)) === null) return json(400, { error: 'الكود غلط' });
      const r = await patch({ totp_enabled: false, totp_secret: null, totp_recovery: [], totp_last_step: 0, totp_fails: 0, totp_locked_until: null });
      if (!r.ok) return migration();
      await audit(cfg, user, 'totp_disabled');
      return json(200, { ok: true });
    }
    return json(400, { error: 'طلب غير معروف' });
  }),
};
