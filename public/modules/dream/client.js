// احلم: the start page. An idea → a thinking chat (ChatGPT) → the campaign's parts, each with «عدّل» (a new version from
// an instruction) and «اعتمد» (locks that version). «جهّز الحملة» writes the text parts in order, one call each, so the
// page shows progress. «انشر» arrives with the platform connection (docs/implementation-plan.md, milestone 5).
import { $, $$, api, say, esc, shell, fmt, busy, toast, failure } from '/assets/common.js';

const FAM = { meta: 'ميتا', snap: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل' };
const STATUS = { draft: 'مسودة', approved: 'معتمد', stale: 'يحتاج تحديث' };
let ST = null, P = null, tab = 'strategy', working = false;

const q = new URLSearchParams(location.search);
const setUrl = id => history.replaceState(null, '', id ? `/dream/?id=${id}` : '/dream/');
const latest = kind => (P?.parts || []).filter(p => p.kind === kind).sort((a, b) => b.version - a.version)[0];

// ---- rendering one part's content, per kind
const list = xs => (xs || []).filter(Boolean).map(esc).join('، ');
const VIEW = {
  strategy: c => `<dl><dt>الهدف</dt><dd>${esc(c.goal)}</dd><dt>الرسالة</dt><dd>${esc(c.message)}</dd>${c.offer ? `<dt>العرض</dt><dd>${esc(c.offer)}</dd>` : ''}<dt>نحكم بـ</dt><dd>${esc(c.kpi)}</dd></dl>
    ${(c.phases || []).length ? `<h3 style="margin-top:12px">المراحل</h3><ul>${c.phases.map(p => `<li><b>${esc(p.name)}</b>${p.days ? ` (${fmt(p.days)} يوم)` : ''}: ${esc(p.focus)}</li>`).join('')}</ul>` : ''}`,
  audience: c => (c.segments || []).map(s => `<div class="dr-item"><b>${esc(s.name)}</b> <span class="dr-tag">${esc(FAM[s.platform] || s.platform)}</span>
    <dl style="margin-top:6px"><dt>العمر</dt><dd>${esc(s.age) || '—'}</dd><dt>الجنس</dt><dd>${esc(s.gender) || '—'}</dd><dt>المناطق</dt><dd>${list(s.regions) || '—'}</dd><dt>الاهتمامات</dt><dd>${list(s.interests) || '—'}</dd></dl>
    ${s.notes ? `<p class="muted" style="margin:6px 0 0">${esc(s.notes)}</p>` : ''}</div>`).join(''),
  budget: c => `<dl><dt>يومياً</dt><dd>${fmt(c.daily)} ر.س</dd><dt>المدة</dt><dd>${fmt(c.days)} يوم</dd><dt>الإجمالي</dt><dd>${fmt(c.total)} ر.س</dd></dl>
    <ul>${(c.split || []).map(s => `<li>${esc(FAM[s.platform] || s.platform)}: ${fmt(s.daily)} ر.س يومياً</li>`).join('')}</ul>
    ${c.learning ? `<p class="muted">${esc(c.learning)}</p>` : ''}
    ${(c.notes || []).map(n => `<p class="dr-note card pad" style="margin:8px 0">${esc(n)}</p>`).join('')}
    ${(c.needsOwner || []).length ? `<p class="dr-note card pad" style="margin:8px 0">ما فيه ميزانية يومية في أهدافك لـ ${(c.needsOwner).map(f => esc(FAM[f] || f)).join('، ')}: حطها في الميديا باير ← الأهداف قبل «انشر».</p>` : ''}`,
  copy: c => (c.items || []).map(i => `<div class="dr-item"><span class="dr-tag">${esc(FAM[i.platform] || i.platform)}${i.format ? ` · ${esc(i.format)}` : ''}</span>
    ${i.headline ? `<h3 style="margin-top:8px">${esc(i.headline)}</h3>` : ''}<p style="white-space:pre-wrap;margin:6px 0">${esc(i.body)}</p>${i.cta ? `<b>${esc(i.cta)}</b>` : ''}
    ${(i.notices || []).map(n => `<p class="muted" style="margin:6px 0 0">⚠︎ ${esc(n.title)}: «${esc(n.match)}». ${esc(n.fix)}</p>`).join('')}</div>`).join(''),
};

function drawTabs() {
  $('#tabs').innerHTML = ST.parts.map(k => {
    const p = latest(k), text = ST.textParts.includes(k);
    return `<button type="button" role="tab" class="btn ${k === tab ? 'secondary' : 'ghost'} sm" data-k="${k}" aria-selected="${k === tab}"><span class="dr-dot ${p ? p.status : ''}" aria-hidden="true"></span>${esc(ST.names[k])}${text ? '' : ' <small class="muted">قريباً</small>'}</button>`;
  }).join('');
}

function drawPart() {
  const p = latest(tab), text = ST.textParts.includes(tab);
  if (!text) { $('#part').innerHTML = `<p class="muted">${esc(ST.names[tab])} يجي في التحديث الجاي: يتولّد من النصوص المعتمدة.</p>`; return; }
  if (!p) {
    $('#part').innerHTML = `<p class="muted">ما انكتب للحين. اضغط «جهّز الحملة» يكتب كل الأجزاء، أو اكتب هذا الجزء بس.</p>
      ${P.canEdit ? `<div class="dr-acts"><button class="btn secondary" type="button" data-draft="${tab}">اكتب ${esc(ST.names[tab])}</button></div>` : ''}`;
    return;
  }
  const versions = (P.parts || []).filter(x => x.kind === tab).length;
  $('#part').innerHTML = `<p style="margin:0 0 10px"><span class="dr-tag ${p.status}">${STATUS[p.status]}</span> <span class="muted">النسخة ${fmt(p.version)}${versions > 1 ? ` من ${fmt(versions)}` : ''}${p.instruction ? ` · تعديلك: «${esc(p.instruction)}»` : ''}</span></p>
    ${(VIEW[tab] || (c => `<pre>${esc(JSON.stringify(c, null, 2))}</pre>`))(p.content || {})}
    <div class="dr-acts">
      ${P.canEdit ? `<button class="btn secondary" type="button" data-edit="${tab}">عدّل</button>` : ''}
      ${P.canApprove && p.status !== 'approved' ? `<button class="btn primary" type="button" data-ok="${p.id}">اعتمد</button>` : ''}
      ${P.canEdit ? `<button class="btn ghost" type="button" data-draft="${tab}">اكتب من جديد</button>` : ''}
    </div>`;
}

function drawPublish() {
  const left = P.missing || [];
  $('#publish').innerHTML = left.length
    ? `<b>قبل «انشر»</b><span class="muted">باقي تعتمد: ${left.map(k => esc(ST.names[k])).join('، ')}.</span>`
    : `<b>الحملة معتمدة ✓</b><span class="muted">«انشر» ينشئ الحملة في المنصات موقوفة، وأنت تشغّلها. يجي مع ربط المنصات في التحديث الجاي.</span>`;
  $('#publish').insertAdjacentHTML('beforeend', '<button class="btn primary" type="button" disabled title="يجي مع ربط المنصات">انشر</button>');
}

function drawChat() {
  const msgs = [{ role: 'user', content: P.project.idea }, ...(P.messages || [])];
  $('#log').innerHTML = msgs.map(m => `<div class="dr-msg ${m.role === 'assistant' ? 'assistant' : 'user'}">${esc(m.content)}</div>`).join('');
  $('#log').scrollTop = $('#log').scrollHeight;
  $('#ask').hidden = !P.canEdit; $('#prepBtn').hidden = !P.canEdit;
}

function drawAll() { drawChat(); drawTabs(); drawPart(); drawPublish(); }

async function projects(select) {
  const r = await api('/api/dream/projects');
  if (r.setup) $('#setup').innerHTML = `<div class="card pad dr-note">${esc(r.setup)}</div>`;
  $('#bar').hidden = !r.projects.length;
  $('#pick').innerHTML = `<option value="">مشاريعك (${fmt(r.projects.length)})</option>` + r.projects.map(p => `<option value="${p.id}"${p.id === select ? ' selected' : ''}>${esc(p.title || 'بدون عنوان')}</option>`).join('');
  return r.projects;
}

async function open(id) {
  P = await api(`/api/dream/item?id=${id}`);
  setUrl(id);
  $('#start').hidden = true; $('#work').hidden = false;
  const first = ST.textParts.find(k => latest(k)?.status !== 'approved');
  tab = first || tab;
  drawAll();
}

function startView() {
  P = null; setUrl(null);
  $('#start').hidden = false; $('#work').hidden = true;
  $('#idea').focus();
}

// One part at a time, so a slow model never hits one long request; the page says where it is
async function draft(kind, instruction = '') {
  const r = await api('/api/dream/draft', { method: 'POST', body: { id: P.project.id, kind, instruction }, timeout: 150000 });
  P.parts = [r.part, ...(P.parts || []).map(x => (r.stale || []).includes(x.kind) && x.status === 'approved' ? { ...x, status: 'stale' } : x)];
  P.missing = ST.textParts.filter(k => latest(k)?.status !== 'approved');
  return r;
}

async function prepare(btn) {
  if (working) return;
  working = true; busy(btn, true);
  try {
    const todo = ST.textParts.filter(k => latest(k)?.status !== 'approved');
    for (const [i, k] of todo.entries()) {
      $('#prog').textContent = `أكتب ${ST.names[k]} (${fmt(i + 1)} من ${fmt(todo.length)})…`;
      await draft(k);
      tab = k; drawTabs(); drawPart();
    }
    $('#prog').textContent = todo.length ? 'خلصت. راجع كل جزء: «عدّل» أو «اعتمد».' : 'كل الأجزاء معتمدة.';
    tab = todo[0] || tab; drawAll();
  } catch (e) { $('#prog').textContent = ''; toast(e.message, true); }
  finally { working = false; busy(btn, false); }
}

export default async function mount() {
  await shell({ active: 'dream', title: 'احلم' });
  try { ST = await api('/api/dream/state'); } catch (e) { failure($('#content'), e, () => location.reload()); return; }
  if (!ST.chat.ok) $('#setup').innerHTML = `<div class="card pad dr-note">${esc(ST.chat.why)}</div>`;
  let list = [];
  try { list = await projects(Number(q.get('id')) || 0); } catch (e) { failure($('#content'), e, () => location.reload()); return; }
  const want = Number(q.get('id')) || 0;
  if (want && !q.has('new')) { try { await open(want); } catch (e) { toast(e.message, true); startView(); } }
  else startView();
  void list;

  $('#pick').addEventListener('change', e => { const id = Number(e.target.value); if (id) open(id).catch(err => toast(err.message, true)); else startView(); });
  $('#newBtn').addEventListener('click', () => { $('#pick').value = ''; startView(); });

  $('#startForm').addEventListener('submit', async e => {
    e.preventDefault();
    const idea = $('#idea').value.trim();
    if (!idea) return say($('#smsg'), 'اكتب فكرة الحملة');
    const platforms = $$('input[name=pf]:checked').map(x => x.value);
    busy($('#startBtn'), true);
    try {
      const r = await api('/api/dream/projects', { method: 'POST', body: { idea, platforms } });
      await projects(r.project.id);
      await open(r.project.id);
      $('#idea').value = '';
      // The first reply: the model reads the idea and asks what it needs
      if (ST.chat.ok) await ask('');
    } catch (err) { say($('#smsg'), err.message); }
    finally { busy($('#startBtn'), false); }
  });

  async function ask(text) {
    const message = text || 'هذي فكرتي. وش تحتاج تعرف عشان نطلع حملة قوية؟';
    if (text) { P.messages = [...(P.messages || []), { role: 'user', content: text }]; drawChat(); }
    busy($('#askBtn'), true); say($('#cmsg'), '');
    try {
      const r = await api('/api/dream/chat', { method: 'POST', body: { id: P.project.id, message }, timeout: 120000 });
      if (!text) P.messages = [...(P.messages || []), { role: 'user', content: message }];
      P.messages = [...P.messages, { role: 'assistant', content: r.reply }];
      drawChat();
    } catch (err) {
      if (text) { P.messages = P.messages.slice(0, -1); $('#q').value = text; drawChat(); }
      say($('#cmsg'), err.message);
    } finally { busy($('#askBtn'), false); }
  }

  $('#ask').addEventListener('submit', e => { e.preventDefault(); const t = $('#q').value.trim(); if (!t) return; $('#q').value = ''; ask(t); });
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#ask').requestSubmit(); } });
  $('#prepBtn').addEventListener('click', e => prepare(e.currentTarget));

  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; tab = b.dataset.k; drawTabs(); drawPart(); });
  $('#part').addEventListener('click', async e => {
    const ok = e.target.closest('[data-ok]'), ed = e.target.closest('[data-edit]'), dr = e.target.closest('[data-draft]');
    if (ok) {
      busy(ok, true);
      try {
        const r = await api('/api/dream/approve', { method: 'POST', body: { id: Number(ok.dataset.ok) } });
        P.parts = P.parts.map(x => (x.id === Number(ok.dataset.ok) ? { ...x, status: 'approved' } : x)); P.missing = r.missing;
        const next = ST.textParts.find(k => latest(k)?.status !== 'approved');
        if (next) tab = next;
        drawTabs(); drawPart(); drawPublish(); toast('اعتمدته');
      } catch (err) { toast(err.message, true); busy(ok, false); }
    }
    if (ed || dr) {
      const kind = (ed || dr).dataset.edit || (ed || dr).dataset.draft;
      const instruction = ed ? prompt(`وش تبي تغيّر في ${ST.names[kind]}؟`, '') : '';
      if (ed && !instruction?.trim()) return;
      const b = ed || dr;
      busy(b, true); $('#prog').textContent = `أكتب ${ST.names[kind]}…`;
      try { const r = await draft(kind, instruction.trim()); tab = kind; drawAll(); $('#prog').textContent = r.stale?.length ? `انكتبت نسخة جديدة. ${r.stale.map(k => ST.names[k]).join('، ')} يحتاج مراجعة بعدها.` : 'انكتبت نسخة جديدة.'; }
      catch (err) { $('#prog').textContent = ''; toast(err.message, true); busy(b, false); }
    }
  });
}
