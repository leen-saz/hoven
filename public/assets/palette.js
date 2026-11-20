// Command palette (⌘K / Ctrl+K) and keyboard shortcuts (docs/PRD.md §4.3). Lists every place this user may open (the
// sidebar's own entries) plus a few actions; type to filter, arrows to move, Enter to go, Escape to close.
// Shortcuts: g then d / a / b / s / l / k (Dream, Analytics, Media buyer, Social, Listening, Knowledge), ? for the list.
// The palette lives on <body>, which the ClientRouter replaces on each tab change, so it is drawn again on every page.
import { sections } from './sidebar.js';
import { LANG } from './i18n.js';

const L = (ar, en) => (LANG === 'en' ? en : ar);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Arabic letters that share a shape: typing one finds the other
const fold = s => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ًٌٍَُِّْـ]/g, '');

export const GO = { d: '/dream/', a: '/overview/', b: '/buyer/', s: '/social/', l: '/listening/', k: '/knowledge/' };
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The palette's entries for this user: places they may open, then actions. Exported for the tests. */
export function entries(me, lang = LANG) {
  const l = (ar, en) => (lang === 'en' ? en : ar);
  const places = sections(me, l).flatMap(sec => sec.items).filter(it => it.state === 'ok')
    .map(it => ({ text: it.text, href: it.href, group: l('انتقل', 'Go to') }));
  const ok = href => places.some(p => p.href === href);
  const actions = [
    ok('/dream/') && { text: l('فكرة حملة جديدة', 'New campaign idea'), href: '/dream/?new=1' },
    ok('/social/') && { text: l('منشور جديد', 'New post'), href: '/social/' },
    ok('/control/') && { text: l('سجل القرارات', 'Decision history'), href: '/control/?tab=log' },
    { text: l('حسابي', 'My account'), href: '/account/' },
  ].filter(Boolean).map(a => ({ ...a, group: l('إجراء', 'Action') }));
  return [...places, ...actions];
}

function draw(list) {
  let d = document.getElementById('cmdk');
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'cmdk'; d.className = 'cmdk'; d.setAttribute('aria-label', L('لوحة الأوامر', 'Command palette'));
  d.innerHTML = `<input type="search" id="cmdkQ" placeholder="${L('وين تبي تروح؟', 'Where to?')}" autocomplete="off" aria-controls="cmdkList" aria-activedescendant="">
    <ul id="cmdkList" role="listbox"></ul>
    <p class="cmdk-help muted"><kbd>↑</kbd><kbd>↓</kbd> ${L('تنقّل', 'move')} · <kbd>Enter</kbd> ${L('افتح', 'open')} · <kbd>Esc</kbd> ${L('إغلاق', 'close')} · <kbd>?</kbd> ${L('الاختصارات', 'shortcuts')}</p>`;
  document.body.append(d);
  const q = d.querySelector('#cmdkQ'), ul = d.querySelector('#cmdkList');
  let shown = [], at = 0;
  const render = () => {
    const f = fold(q.value.trim());
    shown = list.filter(x => !f || fold(x.text).includes(f));
    at = Math.min(at, Math.max(shown.length - 1, 0));
    ul.innerHTML = shown.length ? shown.map((x, i) => `<li role="option" id="cmdk-${i}" aria-selected="${i === at}" data-i="${i}"><span>${esc(x.text)}</span><small class="muted">${esc(x.group)}</small></li>`).join('')
      : `<li class="muted" aria-disabled="true">${L('ما فيه نتيجة', 'No match')}</li>`;
    q.setAttribute('aria-activedescendant', shown.length ? `cmdk-${at}` : '');
    ul.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };
  const go = i => { const x = shown[i]; if (!x) return; d.close(); location.assign(x.href); };
  q.addEventListener('input', () => { at = 0; render(); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(at + 1, shown.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(at - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(at); }
  });
  ul.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) go(Number(li.dataset.i)); });
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => { q.value = ''; at = 0; });
  d.openWith = () => { render(); d.showModal(); q.focus(); };
  return d;
}

function help() {
  let d = document.getElementById('keys');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'keys'; d.className = 'cmdk';
    const k = MAC ? '⌘' : 'Ctrl';
    const rows = [[`${k} K`, L('لوحة الأوامر', 'Command palette')], ['g d', L('احلم', 'Dream')], ['g a', L('التحليلات', 'Analytics')], ['g b', L('الميديا باير', 'Media buyer')],
      ['g s', L('التواصل الاجتماعي', 'Social media')], ['g l', L('الرصد', 'Listening')], ['g k', L('المعرفة', 'Knowledge')], ['?', L('هالقائمة', 'This list')]];
    d.innerHTML = `<h2>${L('اختصارات لوحة المفاتيح', 'Keyboard shortcuts')}</h2><dl class="keys">${rows.map(([a, b]) => `<dt>${a.split(' ').map(x => `<kbd>${x}</kbd>`).join(' ')}</dt><dd>${b}</dd>`).join('')}</dl>
      <form method="dialog"><button class="btn secondary">${L('إغلاق', 'Close')}</button></form>`;
    document.body.append(d);
  }
  d.showModal();
}

// Typing in a field never triggers a shortcut
const typing = t => t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));

let ME = null, wired = false;
export function palette(me) {
  ME = me;
  if (wired) return;   // the key listener lives on document for the whole visit; the dialogs are redrawn per page
  wired = true;
  let g = 0;
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); draw(entries(ME)).openWith(); return; }
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (e.key === '?') { e.preventDefault(); help(); return; }
    if (e.key === 'g') { g = Date.now(); return; }
    if (g && Date.now() - g < 1200 && GO[e.key]) {
      g = 0;
      // Analytics opens the dashboard (/) when the Overview module is off for this user
      const list = entries(ME), hit = list.find(x => x.href === GO[e.key]) || (e.key === 'a' && list.find(x => x.href === '/'));
      if (hit) location.assign(hit.href);
    }
  });
}
