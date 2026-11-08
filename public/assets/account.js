import { $, api, say, esc, shell, busy, settingsTabs, freshMe } from './common.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {

  // The sidebar's stored copy has no email: the line under the title takes it from the server
  shell({ active: 'settings', title: 'الإعدادات' }).then(me => { settingsTabs('account', me); return freshMe(); }).then(me => { $('#who').textContent = `${me.name ? me.name + ' · ' : ''}${me.email}`; }).catch(() => {});
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    if ($('#p1').value !== $('#p2').value) { say($('#msg'), 'الباسووردين مو نفس بعض'); return; }
    const btn = e.submitter; busy(btn, true);
    try {
      await api('/api/account/password', { method: 'POST', body: { current: $('#cur').value, password: $('#p1').value } });
      say($('#msg'), 'تغيّر الباسوورد.', true); e.target.reset();
    } catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  });

  // Two-step sign-in
  let SEALED = '';
  const group = k => k.replace(/(.{4})/g, '$1 ').trim();
  async function tstate() {
    try {
      const r = await api('/api/account/totp');
      $('#tstate').textContent = r.enabled ? `مفعّل. كودات الاسترداد المتبقية: ${r.recovery}.` : 'مو مفعّل. بعد الباسوورد يطلب كود من تطبيق في جوالك.';
      $('#ton').hidden = r.enabled; $('#toff').hidden = !r.enabled; $('#tstart').hidden = true;
    } catch (err) { $('#tstate').textContent = ''; say($('#tmsg'), err.message); }
  }
  $('#ton').onclick = async e => {
    busy(e.currentTarget, true);
    try {
      const r = await api('/api/account/totp', { method: 'POST', body: { action: 'start' } });
      SEALED = r.sealed; $('#tsecret').textContent = group(r.secret); $('#turi').href = r.uri; $('#tstart').hidden = false; $('#ton').hidden = true; $('#tcode').value = '';
    } catch (err) { say($('#tmsg'), err.message); }
    busy(e.currentTarget, false);
  };
  $('#tconfirm').onclick = async e => {
    busy(e.currentTarget, true);
    try {
      const r = await api('/api/account/totp', { method: 'POST', body: { action: 'confirm', sealed: SEALED, code: $('#tcode').value } });
      $('#tcodelist').textContent = r.recovery.join('\n'); $('#tcodes').hidden = false; say($('#tmsg'), 'تفعّل التحقق بخطوتين.', true); await tstate(); $('#toff').hidden = true;
    } catch (err) { say($('#tmsg'), err.message); }
    busy(e.currentTarget, false);
  };
  $('#tdisable').onclick = async e => {
    busy(e.currentTarget, true);
    try {
      await api('/api/account/totp', { method: 'POST', body: { action: 'disable', current: $('#tcur').value, code: $('#tcode2').value } });
      $('#tcodes').hidden = true; $('#tcur').value = ''; $('#tcode2').value = ''; say($('#tmsg'), 'انطفى.', true); await tstate();
    } catch (err) { say($('#tmsg'), err.message); }
    busy(e.currentTarget, false);
  };
  tstate();
}
