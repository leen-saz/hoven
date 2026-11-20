// احلم: the start page. An idea → a thinking chat (ChatGPT) → the campaign's parts, each with «عدّل» (a new version from
// an instruction) and «اعتمد» (locks that version). «جهّز الحملة» writes the text parts in order, one call each, so the
// page shows progress. «انشر» arrives with the platform connection (docs/implementation-plan.md, milestone 5).
import { $, $$, api, say, esc, shell, fmt, busy, toast, failure } from '/assets/common.js';
import { wav } from '/modules/voice/client.js';
import { frame, draw as paint, SIZE } from '/modules/design/frame.js';

const FAM = { meta: 'ميتا', snap: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل' };
const STATUS = { draft: 'مسودة', approved: 'معتمد', stale: 'يحتاج تحديث' };
let ST = null, P = null, tab = 'strategy', working = false;

const q = new URLSearchParams(location.search);
const setUrl = id => history.replaceState(null, '', id ? `/dream/?id=${id}` : '/dream/');
const latest = kind => (P?.parts || []).filter(p => p.kind === kind).sort((a, b) => b.version - a.version)[0];

const fileUrl = key => `/api/dream/file?key=${encodeURIComponent(key)}`;
const VOICE = { najdi: 'نجدية', hijazi: 'حجازية', gulf: 'خليجية', msa: 'فصحى' }, TONE = { warm: 'دافئة', energetic: 'حماسية', calm: 'هادية', formal: 'رسمية' };

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
  // The words sit on top of the picture as a layer (never baked in), the way the ad will carry them
  design: c => `<div class="dr-designs">${(c.images || []).map(i => `<figure class="dr-design"><img src="${fileUrl(i.key)}" alt="${esc(i.headline || 'تصميم')}" loading="lazy">
    <figcaption><b>${esc(i.headline)}</b>${i.cta ? `<span>${esc(i.cta)}</span>` : ''}</figcaption><small class="dr-tag">${esc(FAM[i.platform] || i.platform || '')}${i.format ? ` · ${esc(i.format)}` : ''}</small></figure>`).join('')}</div>`,
  voiceover: c => `<p style="white-space:pre-wrap">${esc(c.script)}</p><p class="muted">${fmt(c.seconds)} ثانية تقريباً · لهجة ${esc(VOICE[c.accent] || c.accent)} · نبرة ${esc(TONE[c.tone] || c.tone)} · صوت ${esc(c.voice)}</p>
    ${c.audio_key ? `<audio controls preload="none" src="${fileUrl(c.audio_key)}"></audio>` : '<p class="muted">ما انولد الصوت للحين.</p>'}`,
  motion: c => `<canvas class="dr-motion" id="mcanvas" aria-label="معاينة الموشن"></canvas>
    <div class="dr-acts"><button class="btn secondary sm" type="button" id="mplay">شغّل المعاينة</button></div>
    <ol class="muted">${(c.spec?.scenes || []).map(x => `<li>${fmt(x.from, 1)}–${fmt(x.to, 1)} ث: ${esc(x.text)}</li>`).join('')}${c.spec?.cta ? `<li>${esc(c.spec.cta.text)}</li>` : ''}</ol>`,
};

function drawTabs() {
  $('#tabs').innerHTML = ST.parts.map(k => {
    const p = latest(k), optional = !(ST.required || []).includes(k);
    return `<button type="button" role="tab" class="btn ${k === tab ? 'secondary' : 'ghost'} sm" data-k="${k}" aria-selected="${k === tab}"><span class="dr-dot ${p ? p.status : ''}" aria-hidden="true"></span>${esc(ST.names[k])}${optional ? ' <small class="muted">اختياري</small>' : ''}</button>`;
  }).join('');
}

function drawPart() {
  const p = latest(tab);
  const make = tab === 'design'
    ? (ST.draw ? `<button class="btn secondary" type="button" id="drawBtn">${p ? 'ارسم من جديد' : 'ارسم التصاميم'}</button>` : `<span class="muted">${esc(ST.why?.draw || '')}</span>`)
    : `<button class="btn ${p ? 'ghost' : 'secondary'}" type="button" data-draft="${tab}">${p ? 'اكتب من جديد' : `اكتب ${esc(ST.names[tab])}`}</button>`;
  if (!p) {
    const hint = { design: 'تصميم لكل نص معتمد (حتى ٣)، والكلام فوق الصورة مو مكتوب فيها. يحتاج النصوص معتمدة.', voiceover: 'نص تعليق صوتي قصير من النصوص المعتمدة، وبعدها تولّد الصوت.', motion: 'خطة مشاهد تتحرك فوق التصميم المعتمد على وقت الفويس أوفر.' }[tab]
      || 'ما انكتب للحين. اضغط «جهّز الحملة» يكتب كل الأجزاء، أو اكتب هذا الجزء بس.';
    $('#part').innerHTML = `<p class="muted">${esc(hint)}</p>${P.canEdit ? `<div class="dr-acts">${make}</div>` : ''}`;
    return;
  }
  const versions = (P.parts || []).filter(x => x.kind === tab).length;
  $('#part').innerHTML = `<p style="margin:0 0 10px"><span class="dr-tag ${p.status}">${STATUS[p.status]}</span> <span class="muted">النسخة ${fmt(p.version)}${versions > 1 ? ` من ${fmt(versions)}` : ''}${p.instruction ? ` · تعديلك: «${esc(p.instruction)}»` : ''}</span></p>
    ${(VIEW[tab] || (c => `<pre>${esc(JSON.stringify(c, null, 2))}</pre>`))(p.content || {})}
    <div class="dr-acts">
      ${P.canEdit && tab !== 'design' ? `<button class="btn secondary" type="button" data-edit="${tab}">عدّل</button>` : ''}
      ${P.canEdit && tab === 'voiceover' ? (ST.voice ? `<button class="btn secondary" type="button" id="speakBtn">${p.content?.audio_key ? 'ولّد الصوت من جديد' : 'ولّد الصوت'}</button>` : `<span class="muted">${esc(ST.why?.voice || '')}</span>`) : ''}
      ${P.canApprove && p.status !== 'approved' ? `<button class="btn primary" type="button" data-ok="${p.id}">اعتمد</button>` : ''}
      ${P.canEdit ? make : ''}
    </div>`;
  if (tab === 'motion') preview(p.content);
}

// «انشر»: once every required part is approved, Leen (the owner) gives the store link and confirms each platform's daily
// budget; the platforms get the campaign PAUSED. Each launch then has «شغّل» / «أوقف». Every click carries its own
// Idempotency-Key, so a double click or a retry never creates twice.
const STATE_AR = { pending: 'قيد الإنشاء', created: 'منشأة وموقوفة', failed: 'ما انشأت', active: 'شغّالة', paused: 'موقوفة', soon: 'قريباً', refused: 'مرفوض' };
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');

function drawPublish() {
  const left = P.missing || [];
  const L = P.launches || [];
  const rowsHtml = L.length ? `<ul class="dr-launches">${L.map(l => `<li><b>${esc(FAM[l.platform] || l.platform)}</b> <span class="dr-tag ${l.status === 'active' ? 'approved' : l.status === 'failed' ? 'stale' : ''}">${esc(STATE_AR[l.status] || l.status)}</span>
      ${l.daily_sar ? `<span class="muted">${fmt(l.daily_sar)} ر.س يومياً</span>` : ''}${l.error ? `<span class="muted">${esc(l.error)}</span>` : ''}
      ${P.owner && ['created', 'paused'].includes(l.status) ? `<button class="btn primary sm" type="button" data-on="${l.id}">شغّل</button>` : ''}
      ${P.owner && l.status === 'active' ? `<button class="btn danger sm" type="button" data-off="${l.id}">أوقف</button>` : ''}</li>`).join('')}</ul>` : '';
  if (left.length) {
    $('#publish').innerHTML = `<b>قبل «انشر»</b><span class="muted">باقي تعتمد: ${left.map(k => esc(ST.names[k])).join('، ')}.</span>${rowsHtml}`;
    return;
  }
  const split = latest('budget')?.content?.split || [];
  const plats = P.project.platforms || [];
  const done = new Set(L.filter(l => ['created', 'active', 'paused'].includes(l.status)).map(l => l.platform));
  const todo = plats.filter(f => !done.has(f));
  $('#publish').innerHTML = `<b>${todo.length ? 'الحملة معتمدة ✓' : 'انشرت الحملة ✓'}</b>
    ${todo.length ? (P.owner ? `<form id="pubForm" class="dr-pub">
      <label for="pubLink">رابط المتجر أو صفحة المنتج</label><input id="pubLink" type="url" inputmode="url" dir="ltr" placeholder="https://" value="${esc(P.link || '')}" required>
      ${todo.map(f => `<label for="b-${f}">الميزانية اليومية في ${esc(FAM[f] || f)} (ر.س)${(P.writers || []).includes(f) ? '' : ' · <span class="muted">النشر التلقائي قريباً</span>'}</label>
        <input id="b-${f}" data-budget="${f}" type="number" inputmode="decimal" min="1" step="any" value="${esc(split.find(s => s.platform === f)?.daily ?? '')}">`).join('')}
      <p class="muted" style="margin:0">تنشأ الحملة <b>موقوفة</b> في كل منصة، وما تصرف شي لين تضغط «شغّل». الميزانية فوق خطتك لازم تكتبها بنفسك هنا.</p>
      <button class="btn primary" type="submit" id="pubBtn">انشر</button></form>` : '<span class="muted">النشر على المنصات بموافقة لين بس.</span>') : ''}
    ${rowsHtml}`;
}

async function loadLaunches() {
  try { const r = await api(`/api/dream/launches?id=${P.project.id}`); P.launches = r.launches; P.writers = r.writers || []; P.owner = !!r.owner; if (r.setup) say($('#prog'), r.setup); }
  catch { P.launches = P.launches || []; }
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
  await loadLaunches();
  $('#start').hidden = true; $('#work').hidden = false;
  const first = (ST.required || ST.textParts).find(k => latest(k)?.status !== 'approved');
  tab = first || tab;
  drawAll();
}

// Motion preview: the design picture with the scene plan animated on a canvas (the design tab's own renderer)
function preview(c) {
  const cv = $('#mcanvas'); if (!cv || !c?.spec) return;
  const [w, h] = SIZE[c.spec.ratio] || SIZE['9:16'];
  cv.width = w / 2; cv.height = h / 2;
  const ctx = cv.getContext('2d'), img = new Image();
  const at = t => { ctx.save(); ctx.scale(0.5, 0.5); paint(ctx, c.spec, frame(c.spec, t), img); ctx.restore(); };
  img.onload = () => at(Math.min(1.5, c.spec.seconds));
  if (c.design_key) img.src = fileUrl(c.design_key); else at(1.5);
  $('#mplay').onclick = () => {
    const audio = c.voice_key ? new Audio(fileUrl(c.voice_key)) : null, t0 = performance.now();
    audio?.play().catch(() => {});
    const tick = () => { const t = (performance.now() - t0) / 1000; at(t); if (t < c.spec.seconds && document.contains(cv)) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
}

// A data: URL to a Blob without fetch (the page's CSP allows connect-src 'self' only)
function dataBlob(url) {
  const [head, b64] = String(url).split(',', 2), type = /^data:([^;,]+)/.exec(head || '')?.[1] || 'image/jpeg';
  const bin = atob(b64 || ''), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type });
}

// Raw upload of a picture or a voice file to R2; returns its key
async function upload(blob, kind) {
  const r = await fetch(`/api/dream/file?kind=${kind}`, { method: 'POST', body: blob, headers: { 'content-type': blob.type }, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'ما انرفع الملف');
  return j.key;
}

// One picture per approved ad text (up to 3): drawn on the server, uploaded from here, then saved as one design version
async function drawDesigns(btn) {
  busy(btn, true);
  try {
    const images = [];
    for (let i = 0, of = 1; i < of; i++) {
      $('#prog').textContent = `أرسم التصميم ${fmt(i + 1)}…`;
      const r = await api('/api/dream/draw', { method: 'POST', body: { id: P.project.id, index: i }, timeout: 180000 });
      of = r.of;
      const blob = dataBlob(r.image);
      images.push({ key: await upload(blob, 'design'), ...r.item });
    }
    const r = await api('/api/dream/media', { method: 'POST', body: { id: P.project.id, kind: 'design', images } });
    P.parts = [r.part, ...markStale(r.stale)];
    $('#prog').textContent = `انرسمت ${fmt(images.length)} تصاميم. راجعها واعتمدها.`;
    drawAll();
  } catch (e) { $('#prog').textContent = ''; toast(e.message, true); busy(btn, false); }
}

// Gemini reads the script; the PCM becomes a WAV here, is uploaded, and saved on a new voice-over version
async function speakVoice(btn) {
  busy(btn, true); $('#prog').textContent = 'أولّد الصوت…';
  try {
    const j = await api('/api/dream/speak', { method: 'POST', body: { id: P.project.id }, timeout: 120000 });
    const d = j?.candidates?.[0]?.content?.parts?.find(x => x.inlineData)?.inlineData;
    if (!d?.data) throw new Error('ما رجع صوت، جرّب مرة ثانية');
    const key = await upload(wav(d.data, d.mimeType), 'voice');
    const r = await api('/api/dream/media', { method: 'POST', body: { id: P.project.id, kind: 'voiceover', audio_key: key } });
    P.parts = [r.part, ...markStale(r.stale)];
    $('#prog').textContent = 'انولد الصوت.';
    drawAll();
  } catch (e) { $('#prog').textContent = ''; toast(e.message, true); busy(btn, false); }
}

const markStale = stale => (P.parts || []).map(x => (stale || []).includes(x.kind) && x.status === 'approved' ? { ...x, status: 'stale' } : x);

function startView() {
  P = null; setUrl(null);
  $('#start').hidden = false; $('#work').hidden = true;
  $('#idea').focus();
}

// One part at a time, so a slow model never hits one long request; the page says where it is
async function draft(kind, instruction = '') {
  const r = await api('/api/dream/draft', { method: 'POST', body: { id: P.project.id, kind, instruction }, timeout: 150000 });
  P.parts = [r.part, ...markStale(r.stale)];
  P.missing = (ST.required || ST.textParts).filter(k => latest(k)?.status !== 'approved');
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

  $('#publish').addEventListener('submit', async e => {
    if (e.target.id !== 'pubForm') return;
    e.preventDefault();
    const link = $('#pubLink').value.trim(), budgets = {};
    for (const i of $$('#publish [data-budget]')) if (i.value) budgets[i.dataset.budget] = Number(i.value);
    const lines = Object.entries(budgets).map(([f, v]) => `${FAM[f] || f}: ${fmt(v)} ر.س يومياً`).join('\n');
    if (!confirm(`تنشئ الحملة موقوفة في:\n${lines}\n\nالرابط: ${link}\n\nما تصرف شي لين تضغط «شغّل». تكمل؟`)) return;
    const btn = $('#pubBtn'); busy(btn, true); P.link = link;
    try {
      const r = await api('/api/dream/publish', { method: 'POST', body: { id: P.project.id, key: newKey(), link, budgets }, timeout: 180000 });
      const bad = r.launches.filter(l => ['failed', 'refused'].includes(l.status));
      toast(bad.length ? bad.map(l => `${FAM[l.platform] || l.platform}: ${l.error}`).join(' · ') : 'انشأت الحملة موقوفة ✓', !!bad.length);
      await loadLaunches(); drawPublish();
    } catch (err) { toast(err.message, true); busy(btn, false); }
  });
  $('#publish').addEventListener('click', async e => {
    const b = e.target.closest('[data-on],[data-off]'); if (!b) return;
    const on = !!b.dataset.on, launch = Number(b.dataset.on || b.dataset.off);
    if (on && !confirm('تشغّل الحملة؟ تبدأ تصرف بالميزانية اليومية اللي حددتها.')) return;
    busy(b, true);
    try { await api('/api/dream/activate', { method: 'POST', body: { launch, on, key: newKey() } }); toast(on ? 'اشتغلت الحملة' : 'وقفت الحملة'); await loadLaunches(); drawPublish(); }
    catch (err) { toast(err.message, true); busy(b, false); }
  });

  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; tab = b.dataset.k; drawTabs(); drawPart(); });
  $('#part').addEventListener('click', async e => {
    if (e.target.closest('#drawBtn')) return drawDesigns(e.target.closest('#drawBtn'));
    if (e.target.closest('#speakBtn')) return speakVoice(e.target.closest('#speakBtn'));
    const ok = e.target.closest('[data-ok]'), ed = e.target.closest('[data-edit]'), dr = e.target.closest('[data-draft]');
    if (ok) {
      busy(ok, true);
      try {
        const r = await api('/api/dream/approve', { method: 'POST', body: { id: Number(ok.dataset.ok) } });
        P.parts = P.parts.map(x => (x.id === Number(ok.dataset.ok) ? { ...x, status: 'approved' } : x)); P.missing = r.missing;
        const next = (ST.required || ST.textParts).find(k => latest(k)?.status !== 'approved');
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
