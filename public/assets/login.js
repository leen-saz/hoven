// A new sign-in starts with fresh sidebar info (common.js and nav.js keep the user's last copy in this browser)
try { localStorage.removeItem('hoven-me-2'); sessionStorage.removeItem('hoven-me-2'); } catch { /* storage blocked */ }
import { $, api, say, busy } from './common.js';
import { langSwitch } from './i18n.js';
document.getElementById('lang').innerHTML = langSwitch();

const next = new URLSearchParams(location.search).get('next') || '';
$('#f').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter; busy(btn, true); say($('#msg'), '');
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: { email: $('#email').value, password: $('#password').value, next } });
    if (r.need2fa) { PENDING = r.pending; $('#f').hidden = true; $('#f2').hidden = false; $('#code').value = ''; $('#code').focus(); busy(btn, false); return; }
    location.href = r.next || '/';
  } catch (err) { say($('#msg'), err.message); busy(btn, false); }
});
// Second step (two-step sign-in): the code, or a recovery code
let PENDING = '';
$('#f2').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter; busy(btn, true); say($('#msg2'), '');
  try {
    const r = await api('/api/auth/twofa', { method: 'POST', body: { pending: PENDING, code: $('#code').value } });
    location.href = r.next || '/';
  } catch (err) { say($('#msg2'), err.message); busy(btn, false); }
});
$('#back').addEventListener('click', () => { PENDING = ''; $('#f2').hidden = true; $('#f').hidden = false; $('#password').value = ''; });
$('#forgot').addEventListener('click', async () => {
  const email = $('#email').value.trim();
  if (!email) { say($('#msg'), 'اكتب إيميلك فوق أول'); $('#email').focus(); return; }
  // ضغطة وحدة بس: كل إيميل جديد يلغي رابط اللي قبله
  const b = $('#forgot'); b.disabled = true;
  try {
    await api('/api/auth/forgot', { method: 'POST', body: { email } });
    say($('#msg'), 'انرسل الرابط. افتح آخر إيميل يوصلك بس، ولو ما لقيته شيّك على الـSpam.', true);
    setTimeout(() => { b.disabled = false; }, 60000);
  } catch (err) { say($('#msg'), err.message); b.disabled = false; }
});
