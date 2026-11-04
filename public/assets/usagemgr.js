// الإعدادات ← الاستخدام: استهلاك الشهر لكل وحدة، وحد شهري تحدده المالكة (فاضي = بلا حد).
import { $, $$, api, say, esc, shell, busy, settingsTabs, LANG } from './common.js';

export default async function mount() {
  const L = (ar, en) => (LANG === 'en' ? en : ar);
  const me = await shell({ active: 'settings', title: L('الإعدادات', 'Settings') });
  settingsTabs('usagemgr', me);
  const draw = r => {
    $('#month').textContent = L(`من ${r.month}`, `Since ${r.month}`);
    $('#units').innerHTML = r.units.map(u => {
      const pct = u.limit ? Math.min(100, Math.round((100 * u.used) / u.limit)) : 0;
      const by = Object.entries(u.byModule).map(([m, n]) => `${esc(m)}: ${n}`).join('، ');
      return `<div class="us"><header><b>${esc(u.label)}</b><span><b>${u.used}</b>${u.limit !== null ? ` / ${u.limit}` : ''}</span>
        <label class="sr" for="q_${u.unit}">${L('الحد الشهري', 'Monthly limit')}</label><input type="number" min="0" id="q_${u.unit}" data-u="${u.unit}" placeholder="${L('بلا حد', 'No limit')}" value="${u.limit ?? ''}"></header>
        ${u.limit !== null ? `<div class="us-bar${pct >= 90 ? ' hot' : ''}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>` : ''}
        ${by ? `<small>${by}</small>` : ''}</div>`;
    }).join('');
  };
  draw(await api('/api/admin/usage'));
  $('#save').onclick = async e => {
    busy(e.target, true);
    try {
      draw(await api('/api/admin/usage', { method: 'PATCH', body: Object.fromEntries($$('[data-u]').map(i => [i.dataset.u, i.value === '' ? null : Number(i.value)])) }));
      say($('#msg'), L('انحفظ.', 'Saved.'), true);
    } catch (err) { say($('#msg'), err.message); }
    busy(e.target, false);
  };
}
