// المكتبة: قوالب بمتغيرات، توليد النص منها، ومستندات في مجلدات.
import { $, $$, api, say, esc, shell, busy } from '/assets/common.js';

export default async function mount() {
  let TEMPLATES = [], DOCS = [], FOLDERS = [], KINDS = {}, STATUS = { draft: 'مسودة', final: 'نهائي' }, CUR = null, LAST = '';

  const folderOpts = (all) => `<option value="">${all ? 'كل المجلدات' : 'بدون مجلد'}</option>${FOLDERS.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}`;

  function drawTemplates() {
    $('#tlist').innerHTML = TEMPLATES.length ? TEMPLATES.map(t => `<button type="button" class="lb-item" data-id="${t.id}" aria-pressed="${CUR?.id === t.id}">
      <header><b>${esc(t.name)}</b><span class="chip line">${esc(KINDS[t.kind] || t.kind)}</span>${t.category ? `<span class="chip line">${esc(t.category)}</span>` : ''}${t.favorite ? '<span class="chip">★</span>' : ''}</header>
      ${t.description ? `<small>${esc(t.description)}</small>` : ''}</button>`).join('') : '<p class="muted">ما فيه قوالب للحين. اضغط «أضف الحزمة الأساسية» أو سوّ قالبك.</p>';
  }
<<<<<<< well
  let seq = 0;   // typing in the filters starts many loads: only the last one is drawn
  async function load() {
    const mine = ++seq;
    try {
      const got = await api('/api/library' + (query() ? '?' + query() : ''));
      if (mine !== seq) return;
      D = got;
      if (!$('#fmod').dataset.done) {
        $('#fmod').insertAdjacentHTML('beforeend', D.modules.filter(m => m.ok).map(m => `<option value="${esc(m.key)}">${esc(m.ar)}</option>`).join(''));
        $('#fkind').insertAdjacentHTML('beforeend', Object.entries(D.kinds).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join(''));
        $('#fmod').dataset.done = '1';
      }
      draw();
    } catch (err) { say($('#msg'), err.message); }
=======

  function drawForm() {
    $('#tformTitle').textContent = CUR ? 'تعديل القالب' : 'قالب جديد';
    $('#tname').value = CUR?.name || ''; $('#tk').value = CUR?.kind || 'copy'; $('#tcat').value = CUR?.category || '';
    $('#tdesc').value = CUR?.description || ''; $('#tbody').value = CUR?.body || '';
    $('#tnew').hidden = $('#tfav').hidden = $('#tarch').hidden = !CUR;
    $('#tfav').textContent = CUR?.favorite ? 'شيل من المفضلة' : 'مفضل';
    $('#tsave').textContent = CUR ? 'احفظ التعديل' : 'احفظ القالب';
    $('#uf').hidden = !CUR; $('#uout').hidden = true; $('#useHint').hidden = !!CUR;
    $('#ufields').innerHTML = (CUR?.fields || []).map(f => `<label for="v_${esc(f.key)}">${esc(f.label)}${f.hint ? ` <span class="muted">${esc(f.hint)}</span>` : ''}</label><input type="text" id="v_${esc(f.key)}" data-k="${esc(f.key)}" maxlength="500">`).join('') || '<p class="muted">هذا القالب بدون متغيرات.</p>';
  }

  function drawDocs() {
    $('#dlist').innerHTML = DOCS.length ? DOCS.map(d => `<article class="lb-doc" data-id="${d.id}">
      <div class="grow"><b>${esc(d.title)}</b> <span class="chip line">${esc(KINDS[d.kind] || d.kind)}</span> <span class="chip${d.status === 'final' ? '' : ' line'}">${esc(STATUS[d.status] || d.status)}</span><pre>${esc(d.body)}</pre></div>
      <button class="btn sm secondary" type="button" data-copy="${d.id}">انسخ</button>
      <button class="btn sm ghost" type="button" data-final="${d.id}">${d.status === 'final' ? 'رجّعه مسودة' : 'نهائي'}</button>
      <button class="btn sm ghost" type="button" data-arch="${d.id}">أرشفة</button></article>`).join('') : '<p class="muted">ما فيه مستندات للحين.</p>';
  }

  async function loadAll() {
    const [t, f] = await Promise.all([api('/api/library/templates' + ($('#tkind').value ? `?kind=${$('#tkind').value}` : '')), api('/api/library/folders')]);
    TEMPLATES = t.templates; KINDS = t.kinds; FOLDERS = f.folders;
    if (CUR) CUR = TEMPLATES.find(x => x.id === CUR.id) || null;
    const keep = $('#ffolder').value; $('#ffolder').innerHTML = folderOpts(true); $('#ffolder').value = keep;
    $('#dfolder').innerHTML = folderOpts(false);
    drawTemplates(); drawForm(); await loadDocs();
  }
  async function loadDocs() {
    const r = await api('/api/library/documents' + ($('#ffolder').value ? `?folder=${$('#ffolder').value}` : ''));
    DOCS = r.documents; STATUS = r.statuses || STATUS; drawDocs();
>>>>>>> hoven
  }

  $('#tkind').onchange = () => loadAll().catch(e => say($('#tmsg'), e.message));
  $('#ffolder').onchange = () => loadDocs().catch(e => say($('#lmsg'), e.message));
  $('#tlist').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (!b) return; CUR = TEMPLATES.find(t => t.id === Number(b.dataset.id)) || null; drawTemplates(); drawForm(); });
  $('#tnew').onclick = () => { CUR = null; drawTemplates(); drawForm(); };

  for (const b of $$('[data-pack]')) b.onclick = async e => {
    const btn = e.currentTarget; busy(btn, true);
    try {
      const r = await api('/api/library/starter', { method: 'POST', body: { pack: btn.dataset.pack } });
      say($('#tmsg'), r.added || r.documents ? `انضاف ${r.added} قوالب${r.documents ? ` و${r.documents} مستند (مسودة)` : ''}.` : 'الحزمة موجودة كلها.', true); await loadAll();
    } catch (err) { say($('#tmsg'), err.message); }
    busy(btn, false);
  };

  $('#sf').addEventListener('submit', async e => {
    e.preventDefault(); const b = e.submitter; busy(b, true);
    const sheet = { trend: { name: $('#s_name').value, startedAt: $('#s_start').value, referenceDate: $('#s_ref').value }, referenceUrl: $('#s_url').value, takenSpecifically: $('#s_taken').value, hovenConnection: $('#s_conn').value,
      classification: $('#s_cls').value, previousBatchReferences: $('#s_prev').value.split('\n').map(x => x.trim()).filter(Boolean) };
    try {
      const r = await api('/api/library/sourcecheck', { method: 'POST', body: sheet });
      $('#sres').innerHTML = `<div class="lb-note"><b>${r.ok ? 'الورقة كاملة' : r.decision === 'needs_approval' ? 'تحتاج موافقة' : 'مرفوضة'}</b><br>${r.errors.map(esc).join('<br>')}${r.errors.length ? '<br>' : ''}${esc(r.note)}</div>`;
    } catch (err) { $('#sres').innerHTML = `<div class="lb-note">${esc(err.message)}</div>`; }
    busy(b, false);
  });

  $('#tf').addEventListener('submit', async e => {
    e.preventDefault(); const b = e.submitter; busy(b, true);
    const body = { name: $('#tname').value, kind: $('#tk').value, category: $('#tcat').value, description: $('#tdesc').value, body: $('#tbody').value };
    try {
      const r = CUR ? await api('/api/library/templates', { method: 'PATCH', body: { id: CUR.id, ...body } }) : await api('/api/library/templates', { method: 'POST', body });
      CUR = r.template; say($('#tmsg'), 'انحفظ.', true); await loadAll();
    } catch (err) { say($('#tmsg'), err.message); }
    busy(b, false);
  });
  $('#tfav').onclick = async () => { try { await api('/api/library/templates', { method: 'PATCH', body: { id: CUR.id, favorite: !CUR.favorite } }); await loadAll(); } catch (err) { say($('#tmsg'), err.message); } };
  $('#tarch').onclick = async () => {
    if (!confirm('أرشفة القالب؟ يختفي من القائمة، والسجل يبقى.')) return;
    try { await api(`/api/library/templates?id=${CUR.id}`, { method: 'DELETE' }); CUR = null; await loadAll(); } catch (err) { say($('#tmsg'), err.message); }
  };

  $('#uf').addEventListener('submit', async e => {
    e.preventDefault(); const b = e.submitter; busy(b, true);
    const values = Object.fromEntries($$('#ufields [data-k]').map(i => [i.dataset.k, i.value]));
    try {
      const r = await api('/api/library/render', { method: 'POST', body: { template_id: CUR.id, values } });
      LAST = r.text; $('#utext').textContent = r.text; $('#uout').hidden = false; $('#dtitle').value = CUR.name;
      $('#unotes').innerHTML = [...(r.missing.length ? [`خانات فاضية: ${r.missing.map(esc).join('، ')}`] : []), ...r.notes.map(esc)].map(n => `<div class="lb-note">${n}</div>`).join('');
      say($('#umsg'), '');
    } catch (err) { say($('#umsg'), err.message); }
    busy(b, false);
  });
  $('#dcopy').onclick = async () => { try { await navigator.clipboard.writeText(LAST); say($('#dmsg'), 'اننسخ.', true); } catch { say($('#dmsg'), 'ما قدرت أنسخ'); } };
  $('#dsave').onclick = async e => {
    busy(e.currentTarget, true);
    try {
      await api('/api/library/documents', { method: 'POST', body: { title: $('#dtitle').value, body: LAST, kind: CUR.kind, template_id: CUR.id, folder_id: $('#dfolder').value ? Number($('#dfolder').value) : null, source: 'library' } });
      say($('#dmsg'), 'انحفظ في المستندات.', true); await loadDocs();
    } catch (err) { say($('#dmsg'), err.message); }
    busy(e.currentTarget, false);
  };

  $('#newfolder').onclick = async () => {
    const name = prompt('اسم المجلد'); if (!name) return;
    try { await api('/api/library/folders', { method: 'POST', body: { name } }); await loadAll(); } catch (err) { say($('#lmsg'), err.message); }
  };
  $('#dlist').addEventListener('click', async e => {
    const c = e.target.closest('[data-copy]'), f = e.target.closest('[data-final]'), a = e.target.closest('[data-arch]');
    try {
      if (c) { await navigator.clipboard.writeText(DOCS.find(d => d.id === Number(c.dataset.copy)).body); c.textContent = 'اننسخ ✓'; }
      if (f) { const d = DOCS.find(x => x.id === Number(f.dataset.final)); await api('/api/library/documents', { method: 'PATCH', body: { id: d.id, status: d.status === 'final' ? 'draft' : 'final' } }); await loadDocs(); }
      if (a && confirm('أرشفة المستند؟')) { await api(`/api/library/documents?id=${a.dataset.arch}`, { method: 'DELETE' }); await loadDocs(); }
    } catch (err) { say($('#lmsg'), err.message); }
  });

  shell({ active: 'library', title: 'المكتبة' }).then(loadAll).catch(err => say($('#tmsg'), err.message));
  // The shared items saved from every tab (the shared library) sit above the templates on the same page
  import('/modules/library/saved.js').then(m => m.default()).catch(err => say($('#msg'), err.message));
}
