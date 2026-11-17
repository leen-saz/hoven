// الميديا باير: الأرقام مقابل الأهداف، اقتراحات تروح لوحة القرارات (ما يتنفّذ شي بدون موافقة)، محادثة مع Claude، الأهداف، القواعد، الدروس.
import { $, $$, api, say, esc, shell, fmt, sar, busy, toast, failure } from '/assets/common.js';

const FAM = { meta: 'ميتا', snap: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل', store: 'المتجر' };
const KIND = { pause: 'إيقاف', budget_down: 'تنزيل الميزانية', budget_up: 'رفع الميزانية', refresh_creative: 'تصميم جديد', roas_alert: 'تنبيه العائد' };
const RES = { worked: ['نجح', 'good'], no_change: ['ما غيّر', ''], worse: ['خرّب', 'bad'], unclear: ['ما ينحكم', ''] };
const STATUS = { approved: 'موافق عليه', executed: 'تنفّذ', rejected: 'مرفوض', modified: 'طلب تعديل', failed: 'ما تنفّذ', expired: 'انتهى' };
const GOAL_FIELDS = [['targetCpa', 'تكلفة الطلب المستهدفة (ر.س)'], ['targetRoas', 'العائد المستهدف (×)'], ['dailyBudget', 'الميزانية اليومية (ر.س)'], ['stopSpend', 'حد الإيقاف: صرف بدون طلب (ر.س)'], ['maxStepPct', 'أقصى تغيير في الميزانية (٪)']];
const ch = (now, prev) => (now == null || !prev || now === prev ? '' : `<small>${now >= prev ? '▲' : '▼'} ${fmt(Math.abs((now - prev) / prev) * 100)}٪</small>`);

let S = null, history = [];

function kpis() {
  const s = S.summary, all = Object.values(s.platforms);
  const purchases = all.reduce((t, p) => t + p.now.purchases, 0), prevP = all.reduce((t, p) => t + p.prev.purchases, 0);
  const cpa = purchases ? s.store.spend / purchases : null;
  $('#kpis').innerHTML = [
    [sar(s.store.spend), 'صرف الإعلانات (ر.س)', ''],
    [fmt(purchases), 'طلبات من الإعلانات', ch(purchases, prevP)],
    [sar(cpa), 'تكلفة الطلب (ر.س)', ''],
    [s.store.roas == null ? '—' : fmt(s.store.roas, 2) + '×', `العائد من مبيعات سلة (${sar(s.store.sales)} ر.س)`, ch(s.store.roas, s.store.prevRoas)],
  ].map(([v, k, c]) => `<div class="card kpi"><div class="v">${v}${c}</div><div class="k">${esc(k)}</div></div>`).join('');
  $('#period').textContent = `آخر ٧ أيام كاملة: ${s.from} إلى ${s.to}، مقارنة بالأسبوع اللي قبلها.`;
}

function recs() {
  const can = S.canEdit && S.board;
  $('#sendAll').hidden = !can || !S.recs.some(r => r.fam !== 'store');
  $('#recs').innerHTML = S.recs.length ? S.recs.map(r => `<article class="card mb-rec">
      ${r.fam !== 'store' && can ? `<input type="checkbox" data-key="${esc(r.key)}" aria-label="حدد ${esc(KIND[r.kind])} ${esc(r.campaign || '')}" checked>` : '<span></span>'}
      <div><h3>${esc(KIND[r.kind])}${r.pct ? ` ${fmt(r.pct)}٪` : ''}${r.campaign ? ` · ${esc(r.campaign)}` : ''}</h3>
        <p>${esc(r.why)}</p><p class="muted">نقيس: ${esc(r.measure)}</p></div>
      <span class="mb-tag">${esc(FAM[r.fam])}</span></article>`).join('')
    : `<div class="card pad"><b>ما فيه اقتراحات الحين.</b><p class="muted" style="margin:6px 0 0">${Object.keys(S.goals).length ? 'الحملات ضمن أهدافك، أو الأرقام ما تكفي للحكم.' : 'حط أهدافك في تبويب «الأهداف» عشان أقدر أقارن الأرقام فيها.'}</p></div>`;
  const rows = S.summary.campaigns.slice(0, 40);
  $('#camps').innerHTML = rows.length ? `<table class="dg-plat"><thead><tr><th>الحملة</th><th>المنصة</th><th>صرف</th><th>طلبات</th><th>تكلفة الطلب</th><th>نسبة النقر</th></tr></thead><tbody>
      ${rows.map(c => `<tr><td>${esc(c.campaign)}${c.live ? '' : ' <span class="muted">(موقوفة)</span>'}</td><td>${esc(FAM[c.fam])}</td><td class="n">${sar(c.now.spend)}</td><td class="n">${fmt(c.now.purchases)}</td><td class="n">${sar(c.now.cpa)}</td><td class="n">${c.now.ctr == null ? '—' : fmt(c.now.ctr, 2) + '٪'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">ما فيه صرف آخر أسبوعين.</p>';
  $('#past').innerHTML = S.past.length ? `<div class="tbl"><table class="dg-plat"><thead><tr><th>الاقتراح</th><th>القرار</th><th>بعد ٣ أيام</th><th>بعد ٧ أيام</th></tr></thead><tbody>
      ${S.past.map(p => `<tr><td>${esc(KIND[p.kind] || p.kind)}${p.campaign ? ` · ${esc(p.campaign)}` : ''}</td><td>${esc(STATUS[p.status] || p.status)}</td>${[p.d3, p.d7].map(d => `<td>${d ? `<span class="mb-tag ${RES[d][1]}">${RES[d][0]}</span>` : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">ما أرسلت اقتراحات للحين. أول ما توافق على اقتراح، أقيس نتيجته بعد ٣ و٧ أيام وأتعلم منها.</p>';
}

function goals() {
  $('#goals').innerHTML = ['meta', 'snap', 'tiktok', 'google'].map(f => `<fieldset><legend>${FAM[f]}</legend>
    ${GOAL_FIELDS.map(([k, l]) => `<label for="g-${f}-${k}">${l}</label><input type="number" inputmode="decimal" min="0" step="any" id="g-${f}-${k}" data-f="${f}" data-k="${k}" value="${esc(S.goals[f]?.[k] ?? '')}" ${S.canEdit ? '' : 'disabled'}>`).join('')}</fieldset>`).join('');
  $('#saveGoals').hidden = !S.canEdit;
}

function rules() {
  $('#rules').value = S.rules.join('\n');
  $('#rules').disabled = !S.canEdit;
  $('#rulesNote').textContent = S.customRules ? 'هذي قواعدك. Claude يلتزم فيها في كل رد واقتراح.' : 'هذي القواعد الأساسية. عدّلها وتصير قواعدك.';
  $('#saveRules').hidden = $('#resetRules').hidden = !S.canEdit;
}

function lessons() {
  $('#lessonForm').hidden = !S.canEdit;
  $('#lessons').innerHTML = S.lessons.length ? S.lessons.map(l => `<li class="card"><span>${esc(l.lesson)} ${l.status === 'approved' ? '' : '<span class="mb-tag">ينتظر الموافقة</span>'}</span>
      ${S.canApprove ? `<button class="btn ghost sm" type="button" data-off="${l.id}">احذف</button>` : ''}</li>`).join('')
    : '<li class="muted">ما فيه دروس للحين. أضف درس هنا، أو احفظ رد من المحادثة كدرس.</li>';
}

function propHtml(p, i) {
  return `<div class="mb-prop"><b>${esc(KIND[p.kind])}${p.pct ? ` ${fmt(p.pct)}٪` : ''} · ${esc(p.campaign)} <span class="mb-tag">${esc(FAM[p.fam])}</span></b><span>${esc(p.why)}</span>
    ${S.canEdit && S.board ? `<button class="btn secondary sm" type="button" data-prop="${i}">أرسل للوحة القرارات</button>` : ''}</div>`;
}
const props = [];
function drawChat() {
  props.length = 0;
  $('#log').innerHTML = history.length ? history.map((m, i) => `<div class="mb-msg ${m.role}" dir="auto">${esc(m.content)}
      ${m.role === 'assistant' ? `${(m.proposals || []).map(p => propHtml(p, props.push(p) - 1)).join('')}${S.canEdit ? `<div class="mb-acts"><button class="btn ghost sm" type="button" data-learn="${i}">احفظ كدرس</button></div>` : ''}` : ''}</div>`).join('')
    : `<p class="muted">${S.chat.ok ? 'اسألني عن أي حملة أو منصة. أقرأ الأرقام ومبيعات سلة وأهدافك وقواعدك ودروسك قبل ما أرد.' : esc(S.chat.why)}</p>`;
  $('#log').scrollTop = $('#log').scrollHeight;
  $('#q').disabled = $('#askBtn').disabled = !S.chat.ok || !S.canEdit;
}

function show(tab) {
  $$('[data-tab]').forEach(b => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.setAttribute('aria-pressed', String(on)); });
  for (const [t, id] of [['recs', '#paneRecs'], ['chat', '#paneChat'], ['goals', '#paneGoals'], ['rules', '#paneRules'], ['lessons', '#paneLessons']]) $(id).hidden = t !== tab;
  if (tab === 'chat') $('#log').scrollTop = $('#log').scrollHeight;
}

async function load() {
  S = await api('/api/buyer/state');
  $('#setup').innerHTML = [S.setup, S.dataOk ? '' : 'ما قدرت أقرأ أرقام الإعلانات كاملة. الأرقام اللي تحت ممكن تكون ناقصة.'].filter(Boolean)
    .map(t => `<div class="card pad mb-note">${esc(t)}</div>`).join('');
  kpis(); recs(); goals(); rules(); lessons(); drawChat();
}

async function send(btn, body) {
  busy(btn, true);
  try {
    const r = await api('/api/buyer/send', { method: 'POST', body });
    toast(r.sent.length ? `انرسل ${fmt(r.sent.length)} للوحة القرارات، ينتظر موافقتك` : 'موجود في لوحة القرارات من قبل');
    return true;
  } catch (e) { toast(e.message, true); return false; } finally { busy(btn, false); }
}

export default async function mount() {
  await shell({ active: 'buyer', title: 'الميديا باير' });
  try { await load(); } catch (e) { failure($('#content'), e, () => location.reload()); return; }
  $$('[data-tab]').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));

  $('#sendAll').addEventListener('click', async e => {
    const keys = $$('#recs input[data-key]:checked').map(x => x.dataset.key);
    if (!keys.length) return say($('#rmsg'), 'حدد اقتراح واحد على الأقل');
    say($('#rmsg'), '');
    await send(e.currentTarget, { keys });
  });

  $('#ask').addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('#q').value.trim();
    if (!q) return;
    history.push({ role: 'user', content: q }); $('#q').value = ''; drawChat(); say($('#cmsg'), '');
    busy($('#askBtn'), true);
    try {
      const r = await api('/api/buyer/chat', { method: 'POST', body: { messages: history.map(({ role, content }) => ({ role, content })) }, timeout: 120000 });
      history.push({ role: 'assistant', content: r.reply, proposals: r.proposals || [] });
    } catch (err) { history.pop(); $('#q').value = q; say($('#cmsg'), err.message); }
    finally { busy($('#askBtn'), false); drawChat(); }
  });
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#ask').requestSubmit(); } });

  $('#log').addEventListener('click', async e => {
    const learn = e.target.closest('[data-learn]'), prop = e.target.closest('[data-prop]');
    if (learn) {
      const m = history[Number(learn.dataset.learn)];
      const text = prompt('الدرس اللي تبي أتذكره (عدّله إذا تبي):', m.content.slice(0, 1000));
      if (!text || !text.trim()) return;
      busy(learn, true);
      try { const r = await api('/api/buyer/lessons', { method: 'POST', body: { lesson: text.trim(), from: 'chat' } }); S.lessons.unshift(r.lesson); lessons(); toast('انحفظ الدرس'); }
      catch (err) { toast(err.message, true); } finally { busy(learn, false); }
    }
    if (prop) {
      const p = props[Number(prop.dataset.prop)];
      if (p && await send(prop, { proposal: { platform: p.fam, kind: p.kind, campaign: p.campaign, pct: p.pct, why: p.why, measure: p.measure } })) prop.disabled = true;
    }
  });

  $('#goalsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const g = {};
    for (const i of $$('#goals input')) if (i.value !== '') (g[i.dataset.f] ||= {})[i.dataset.k] = Number(i.value);
    busy($('#saveGoals'), true);
    try { const r = await api('/api/buyer/goals', { method: 'POST', body: { goals: g } }); S.goals = r.goals; goals(); say($('#gmsg'), 'انحفظت الأهداف', true); await load(); }
    catch (err) { say($('#gmsg'), err.message); } finally { busy($('#saveGoals'), false); }
  });

  const saveRules = async (body, btn) => {
    busy(btn, true);
    try { const r = await api('/api/buyer/rules', { method: 'POST', body }); S.rules = r.rules; S.customRules = r.customRules; rules(); say($('#umsg'), 'انحفظت القواعد', true); }
    catch (err) { say($('#umsg'), err.message); } finally { busy(btn, false); }
  };
  $('#rulesForm').addEventListener('submit', e => { e.preventDefault(); saveRules({ rules: $('#rules').value }, $('#saveRules')); });
  $('#resetRules').addEventListener('click', e => { if (confirm('ترجع القواعد الأساسية وتمسح قواعدك؟')) saveRules({ reset: true }, e.currentTarget); });

  $('#lessonForm').addEventListener('submit', async e => {
    e.preventDefault();
    const text = $('#lesson').value.trim();
    if (!text) return say($('#lmsg'), 'اكتب الدرس');
    busy($('#addLesson'), true);
    try { const r = await api('/api/buyer/lessons', { method: 'POST', body: { lesson: text } }); S.lessons.unshift(r.lesson); $('#lesson').value = ''; lessons(); say($('#lmsg'), 'انحفظ الدرس', true); }
    catch (err) { say($('#lmsg'), err.message); } finally { busy($('#addLesson'), false); }
  });
  $('#lessons').addEventListener('click', async e => {
    const b = e.target.closest('[data-off]');
    if (!b || !confirm('تحذف الدرس؟')) return;
    busy(b, true);
    try { await api('/api/buyer/lessons', { method: 'DELETE', body: { id: Number(b.dataset.off) } }); S.lessons = S.lessons.filter(l => l.id !== Number(b.dataset.off)); lessons(); toast('انحذف'); }
    catch (err) { toast(err.message, true); busy(b, false); }
  });
}
