// ---- render
let cur=null;
function applyMode(mode, push){
  if(mode!=='ads' && mode!=='organic') mode='ads';
  const prev=S.mode;
  if(mode==='organic' && prev!=='organic'){ S._adsPage=S.page; S._adsPlat=S.plat; if(S._orgPage) S.page=S._orgPage; if(S._orgPlat) S.plat=S._orgPlat; }
  if(mode==='ads' && prev==='organic'){ S._orgPage=S.page; S._orgPlat=S.plat; if(S._adsPage) S.page=S._adsPage; if(S._adsPlat) S.plat=S._adsPlat; }
  S.mode=mode;
  syncModeShape();
  if(push){
    const url=new URL(location.href);
    if(mode==='organic') url.searchParams.set('mode','organic'); else url.searchParams.delete('mode');
    url.hash='';
    history.pushState({mode},'',url.pathname+url.search);
  }
  save(); render(); window.scrollTo({top:0});
}
window.addEventListener('popstate',()=>{
  const q=new URLSearchParams(location.search).get('lang');
  LANG = q==='en' ? 'en' : 'ar';
  try{ localStorage.setItem('hoven-lang', LANG); }catch(e){}
  const next=modeFromUrl(), prev=S.mode;
  if(next==='organic' && prev!=='organic'){ S._adsPage=S.page; S._adsPlat=S.plat; if(S._orgPage) S.page=S._orgPage; if(S._orgPlat) S.plat=S._orgPlat; }
  if(next==='ads' && prev==='organic'){ S._orgPage=S.page; S._orgPlat=S.plat; if(S._adsPage) S.page=S._adsPage; if(S._adsPlat) S.plat=S._adsPlat; }
  S.mode=next; syncModeShape(); render();
});
function render(){
  if(CREATIVE_ONLY) S.page='creative';
  refreshOrder();
  buildFilters();
  document.querySelectorAll('#presets button').forEach(b=>b.setAttribute('aria-pressed',S.preset===b.dataset.k));
  document.querySelectorAll('#plats button[data-v]').forEach(b=>b.setAttribute('aria-pressed',S.plat===b.dataset.v));
  document.querySelectorAll('#stat button').forEach(b=>b.setAttribute('aria-pressed',S.stat===b.dataset.v));
  if(document.activeElement!==$('#from')) $('#from').value=S.from;
  if($('#sort')) $('#sort').value=S.sort;
  if(document.activeElement!==$('#to')) $('#to').value=S.to;
  const n = diffDays(S.from,S.to)+1;
  const pTo = addDays(S.from,-1), pFrom = addDays(pTo,-(n-1));
  const now = agg(S.from,S.to), prev = pFrom>=MIN ? agg(pFrom,pTo) : null;
  const holes = S.mode==='ads' ? holesBetween(S.from,S.to) : [];
  const prevHoles = prev && S.mode==='ads' ? holesBetween(pFrom,pTo) : [];
  const compareOk = !!(prev && !holes.length && !prevHoles.length);
  cur = {now,prev,n,pFrom,pTo,compareOk,holes};
  const partial = S.to===TODAY && TODAY!==MAX ? ` · <b style="color:var(--bad)">${tr('اليوم الحالي جزئي')}</b>` : '';
  const holeNote = holes.length ? ` · <b style="color:var(--bad)">${ui('بيانات ناقصة','Missing data')}: ${holes.map(fam=>{ const end=coverEnd(fam); const name=platName(fam)||fam; return end?`${name} ${ui('حتى','through')} ${nice(end)}`:name; }).join(ui('، ', ', '))}</b>` : '';
  const liveNote = S.mode!=='ads' ? '' : S.stat==='live' ? ` · ${tr('الأرقام للإعلانات النشطة الآن فقط')}` : S.stat==='off' ? ` · ${tr('الأرقام للإعلانات المتوقفة فقط')}` : '';
  const dayWord = n===1 ? tr('يوم') : (LANG==='en'?'days':tr('يوم'));
  const prevBit = prev ? ` · ${tr('مقارنة بـ')} <b>${nice(pFrom)} – ${nice(pTo)}</b>` : ` · ${tr('لا توجد فترة سابقة كاملة للمقارنة')}`;
  $('#rangeLabel').innerHTML = `${tr('الفترة:')} <b>${nice(S.from)} – ${nice(S.to)}</b> (${n} ${dayWord})` + (S.mode==='organic' ? '' : prevBit) + partial + holeNote + liveNote;
  const head=$('#headSub'); if(head) head.textContent = S.mode==='organic' ? 'صفحات فيسبوك · انستقرام · تيك توك · تحليلات الموقع' : (CREATIVE_ONLY ? 'ميتا · سناب شات · تيك توك — كل المبالغ بالريال السعودي' : 'ميتا · جوجل · سناب شات · تيك توك — كل المبالغ بالريال السعودي');
  buildSelects(); renderChips();
  syncSections();
  if(shown('kpis')) renderKpis(now,prev);
  if(shown('chSpend')) renderCharts(now);
  if(shown('share')||shown('heat')) renderBI(now);
  if(shown('tPlat')) renderPlat(now,prev);
  if(shown('tCamp')) renderCamp(now);
  if(shown('tMonth')) renderMonths();
  if(shown('pace')) renderPace();
  if(shown('tTree')) renderTree(now);
  if(shown('cards')) renderCards(cur);
  if(shown('perCards')) renderPersonas(cur);
  renderReport(now,prev); renderWins();
  localize();
}

function delta(a,b,lowerIsBetter){
  if(b==null||a==null||!isFinite(a)||!isFinite(b)||b===0) return `<span class="delta flat">— لا مقارنة</span>`;
  const ch = 100*(a-b)/Math.abs(b);
  if(Math.abs(ch)<0.5) return `<span class="delta flat">● ثابت</span>`;
  const up = ch>0, good = lowerIsBetter ? !up : up;
  // From a tiny base, +1,130% says little: show it as a multiple (×12.3)
  const txt = up && ch>=300 ? `×${fmt(a/b,1)}` : `${fmt(Math.abs(ch),1)}%`;
  return `<span class="delta ${good?'good':'bad'}">${up?'▲':'▼'} ${txt} <span style="color:var(--muted)">${tr('عن الفترة السابقة')}</span></span>`;
}
document.addEventListener('click', e => { const m = e.target.closest && e.target.closest('#moreF'); if(m){ const c=$('#filterCard'); const on=!c.classList.contains('show-adv'); c.classList.toggle('show-adv',on); m.setAttribute('aria-expanded',String(on)); m.textContent=tr(on?'فلاتر أقل':'فلاتر أكثر'); } });
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-crmby]'); if(!b) return; S.crmBy = b.dataset.crmby; render(); });
// Full-funnel summary (awareness → interest → conversion → sale), then the outcome: the usual way to read ad performance.
function sallaSum(from,to){
  const o={orders:0,net:0};
  for(const r of D.salla||[]) if(r.day>=from&&r.day<=to){o.orders+=r.orders||0;o.net+=r.net||0;}
  return o;
}
function sallaSum(from,to){
  const o={orders:0,net:0};
  for(const r of D.salla||[]) if(r.day>=from&&r.day<=to){o.orders+=r.orders||0;o.net+=r.net||0;}
  return o;
}
function renderKpis(now,prev){
  const a=derive(now.tot), b=cur&&cur.compareOk&&prev?derive(prev.tot):{};
  const dl = d => /لا مقارنة/.test(d) ? '' : d;   // no comparison → no line
  const kpi = (l,v,u,d,cls='') => `<div class="kpi ${cls}"><span class="l">${l}</span><span class="v">${v}${u?`<small>${u}</small>`:''}</span>${dl(d)}</div>`;
  const ratio = (x,y) => x!=null && y ? x/y : null;
  const allN = a.allPaidN||0, allP = a.allPaid||0;
  const mer = ratio(allP, a.spend), merB = ratio(b.allPaid, b.spend);
  const crm = !!(D.crm && D.crm.paid_all);
  // 1) Outcome
<<<<<<< well
  const toggle = D.crm ? `<span class="seg seg-sm" role="group" aria-label="${tr('الإقفالات حسب')}">`
    + [['lead','يوم الليد'],['paid','يوم الدفع']].map(([v,l])=>`<button type="button" data-crmby="${v}" aria-pressed="${(S.crmBy||'lead')===v}">${tr(l)}</button>`).join('') + `</span>` : '';
=======
  const toggle = D.crm ? `<span class="seg seg-sm" role="group" aria-label="${tr('الاقفالات حسب')}">`
    + [['lead','يوم الطلب'],['paid','يوم الدفع']].map(([v,l])=>`<button type="button" data-crmby="${v}" aria-pressed="${(S.crmBy||'lead')===v}">${tr(l)}</button>`).join('') + `</span>` : '';
>>>>>>> hoven
  const spend = delta(a.spend,b.spend,null).replace(/delta (good|bad)">/,'delta flat">');
  // Outcome tiles (references: icon chip, number, change, and a small bar chart of the same number over the range)
  const BK = buckets(now), keys = BK.keys.slice(-14);
  const daySum = (k,f) => Object.values(BK.byKey[k]||{}).reduce((t,v)=>t+(v[f]||0),0);
  const paidIn = (k,amount) => { const [x,y] = BK.span(k); let n=0;
    for(const [ld,pd,am] of ((D.crm&&D.crm.paid_all)||[])){ const d = S.crmBy==='paid'?pd:ld; if(d && d>=x && d<=y) n += amount?am:1; } return n; };
  const spark = vals => { const m = Math.max(...vals,0); if(!m || vals.length<2) return '';
    const bw = 100/vals.length; return `<svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">${vals.map((v,i)=>{ const h=Math.max(2,30*v/m);
      return `<rect x="${(LANG==='en'?i:vals.length-1-i)*bw+bw*.18}" y="${32-h}" width="${bw*.64}" height="${h}" rx="1.5" opacity="${i===vals.length-1?1:.45}"/>`; }).join('')}</svg>`; };
  const ICON = {
    spend:'<path d="M3 7h18v12H3z"/><path d="M3 10h18"/><path d="M16 15h2"/>',
    closings:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    paid:'<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
    ret:'<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    cac:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>' };
  const tile = (l,v,u,d,ic,vals,cls='') => `<div class="kpi hero tile ${cls}"><span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24">${ICON[ic]}</svg></span>`
    + `<span class="l">${l}</span><span class="v">${v}${u?`<small>${u}</small>`:''}</span>${dl(d)}${vals?spark(vals):''}</div>`;
  const outcome = [
    tile('الصرف',sar(a.spend),money(),spend,'spend',keys.map(k=>daySum(k,'spend'))),
    // Hoven (ADR-0007): orders = purchases, conv = revenue in SAR; Salla = the store's own sales
    ...(!crm ? (()=>{ const x=sallaSum(S.from,S.to), y=cur&&cur.compareOk&&prev?sallaSum(cur.pFrom,cur.pTo):{};
      const roas=ratio(a.conv,a.spend), roasB=ratio(b.conv,b.spend), tr2=ratio(x.net,a.spend), tr2B=y.net!=null?ratio(y.net,b.spend):null;
      return [
        tile('طلبات الإعلانات',qty(a.leads),'',delta(a.leads,b.leads,false),'closings',keys.map(k=>daySum(k,'orders')),'feature'),
        tile('إيراد الإعلانات',sar(a.conv),money(),delta(a.conv,b.conv,false),'paid',null),
        tile('ROAS',roas==null?'—':fmt(roas,2)+'×','',delta(roas,roasB,false),'ret',null),
        ...(D.salla&&D.salla.length ? [
          tile('مبيعات سلة',sar(x.net),money(),delta(x.net,y.net,false),'paid',null),
          tile('طلبات سلة',fmt(x.orders),'',delta(x.orders,y.orders,false),'closings',null),
          tile('العائد الحقيقي (سلة ÷ الصرف)',tr2==null?'—':fmt(tr2,2)+'×','',delta(tr2,tr2B,false),'ret',null),
        ] : []),
      ]; })() : []),
    // Hoven (ADR-0007): orders = purchases, conv = revenue in SAR; Salla = the store's own sales
    ...(!crm ? (()=>{ const x=sallaSum(S.from,S.to), y=cur&&cur.compareOk&&prev?sallaSum(cur.pFrom,cur.pTo):{};
      const roas=ratio(a.conv,a.spend), roasB=ratio(b.conv,b.spend), tr2=ratio(x.net,a.spend), tr2B=y.net!=null?ratio(y.net,b.spend):null;
      return [
        tile('طلبات الإعلانات',qty(a.leads),'',delta(a.leads,b.leads,false),'closings',keys.map(k=>daySum(k,'orders')),'feature'),
        tile('إيراد الإعلانات',sar(a.conv),money(),delta(a.conv,b.conv,false),'paid',null),
        tile('ROAS',roas==null?'—':fmt(roas,2)+'×','',delta(roas,roasB,false),'ret',null),
        ...(D.salla&&D.salla.length ? [
          tile('مبيعات سلة',sar(x.net),money(),delta(x.net,y.net,false),'paid',null),
          tile('طلبات سلة',fmt(x.orders),'',delta(x.orders,y.orders,false),'closings',null),
          tile('العائد الحقيقي (سلة ÷ الصرف)',tr2==null?'—':fmt(tr2,2)+'×','',delta(tr2,tr2B,false),'ret',null),
        ] : []),
      ]; })() : []),
    ...(crm ? [
      tile('الإقفالات',fmt(allN),'',delta(allN,b.allPaidN,false),'closings',keys.map(k=>paidIn(k,false)),'feature'),
      tile('المدفوع',sar(allP),money(),delta(allP,b.allPaid,false),'paid',keys.map(k=>paidIn(k,true))),
      tile('العائد على الصرف',allN?(mer==null?'—':fmt(mer,2)+'×'):tr('لا توجد إقفالات'),'',delta(mer,merB,false),'ret',null),
    ] : []),
  ].join('');
  // 2) The customer journey: a horizontal pipe that narrows with the numbers, with its analysis (funnelHTML, below)
  $('#kpis').innerHTML = payerHTML(a,now)
    + `<div class="kgroup"><div class="khead"><h3>النتيجة</h3>${toggle}</div><div class="kpis kout">${outcome}</div>`
    + (crm ? `<p class="knote">${tr('الإقفالات والمدفوع من كل المصادر في نظام العملاء (مدفوعات ميسّر). العائد على الصرف = المدفوع ÷ الصرف. تكلفة العميل = الصرف ÷ الإقفالات.')}</p>` : '') + `</div>`
    + `<div class="kgroup"><div class="khead"><h3>رحلة العميل</h3></div>${funnelHTML(a,b)}`
    + (D.crm ? '' : `<p class="knote">${tr('مرحلة البيع فاضية لأن أرقام نظام العملاء ما وصلت لهالنسخة من اللوحة. أول ما توصل تطلع الإقفالات هنا.')}</p>`) + `</div>`
    + payRankHTML(a,now);
}

// The headline: what one paying customer costs (spend ÷ paid closings) against its target, beside the cost per lead.
// Not linked is shown as «غير مربوط», never 0. The target is targets.json «costPerPayer» when set, else costShare × what a closing brings.
function payerHTML(a,now){
  const v = funJudge(a), p = v.payer, lvl = {fine:'',watch:'watch',problem:'bad',disaster:'bad dis',na:'off'}[p.level];
  const T = funTargets().t, sev = p.level==='na' ? '' : `<span class="fv-badge">${ui(...JUDGE.SEV[p.level])}</span>`;
  const res = (a.leads||0)+(a.conv||0);
  const detail = p.value==null ? p.note
    : `${p.note} · ${ui(`${qty(p.closings)} عميل دافع`,`${qty(p.closings)} paying customers`)}${res?ui(` من ${qty(res)} ليد`,` from ${qty(res)} leads`):''}${funSliced()?` · ${ui('من كل نظام العملاء، مو بس الفلتر','across the whole CRM, not only the filter')}`:''}`;
  const cplText = a.cpl==null ? '—' : funFmt.sar(a.cpl);
  const wa = v.wa ? `<p class="m">${v.wa.line}</p>` : '';
  return `<div class="kgroup"><div class="payer ${lvl}"><div class="payer-main"><span class="l">${ui('تكلفة العميل الدافع','Cost per paying customer')}</span>`
    + `<span class="v">${p.text}</span>${sev}<span class="payer-note m">${detail}</span></div>`
    + `<div class="payer-side"><span class="l">${ui('تكلفة الليد','Cost per lead')}</span><span class="v">${cplText}</span>`
    + `<span class="payer-note m">${ui('الهدف','Target')} ${funFmt.sar(T.cpl)}</span>${wa}</div></div></div>`;
}

// Campaigns ranked by the paying customers that are linked to their ads, with how many sales are not linked to any ad
function payRankHTML(a,now){
  if(!(D.crm && D.crm.paid_all)) return '';
  const m = {};
  for(const [k,o] of Object.entries(now.byAd)){ const ad = ADS[k]; if(!ad || !o.booked) continue; const key = ad.platform+'|'+ad.campaign;
    const c = m[key] ||= {p:ad.platform, name:ad.campaign, n:0, value:0, spend:0}; c.n += o.booked; c.value += o.value||0; }
  for(const [k,o] of Object.entries(now.byAd)){ const ad = ADS[k]; const c = ad && m[ad.platform+'|'+ad.campaign]; if(c) c.spend += o.spend||0; }
  const rows = Object.values(m).sort((x,y)=>y.n-x.n || (x.spend/x.n)-(y.spend/y.n)).slice(0,8);
  const total = a.allPaidN||0, unlinked = Math.max(0,total-(a.booked||0));
  const note = total ? ui(`${qty(unlinked)} من ${qty(total)} إقفالة غير مربوطة بإعلان، وما تدخل في الترتيب. ما نخمّن ربطها.`, `${qty(unlinked)} of ${qty(total)} closings are not linked to an ad and are left out of this ranking. We do not guess links.`) : '';
  const body = rows.length ? `<div class="tbl"><table><thead><tr><th>${ui('الحملة','Campaign')}</th><th>${ui('المنصة','Platform')}</th><th class="n">${ui('عملاء دافعين','Paying customers')}</th><th class="n">${ui('تكلفة العميل الدافع','Cost per paying customer')}</th><th class="n">${ui('المدفوع','Paid')}</th></tr></thead><tbody>`
      + rows.map(r=>`<tr><td class="name">${esc(r.name)}</td><td>${platCell(r.p)}</td><td class="n">${fmt(r.n)}</td><td class="n">${r.spend?`${sar(r.spend/r.n)} ${money()}`:'—'}</td><td class="n">${sar(r.value)} ${money()}</td></tr>`).join('') + `</tbody></table></div>`
    : total ? `<p class="payrank-na"><b>${ui('غير مربوط','Not linked')}</b> ${ui('ما فيه إقفالة مربوطة بإعلانها في هالفترة، فما نقدر نرتّب الحملات بالعملاء الدافعين.','No closing is linked to its ad in this period, so campaigns cannot be ranked by paying customers.')}</p>`
    : `<p class="payrank-na"><b>${ui('لا توجد إقفالات','No closings')}</b> ${ui('ما فيه إقفالات مدفوعة في هالفترة.','No paid closings in this period.')}</p>`;
  return `<div class="kgroup"><div class="khead"><h3>${ui('الحملات حسب العملاء الدافعين','Campaigns by paying customers')}</h3></div>${body}<p class="knote">${note}</p></div>`;
}

function noteCard(title, line, alert){
  return `<div class="item${alert?' alert':''}"><span class="b">${title}</span><span class="sub">${line}</span></div>`;
}


// رحلة العميل كأنبوب أفقي يضيق مع الأرقام: المرحلة الأولى يمين (عكسها بالإنجليزي)، ارتفاع كل مرحلة من حجمها بمقياس مخفّف،
<<<<<<< well
// وكل وصلة تضيق لعنق، وتضيق أكثر إذا الخطوة تحت هدفها. الحكم من JUDGE (00-judge.js): كل خطوة مقابل هدف ثابت، نفس
// القواعد اللي في ملخص الأداء (src/modules/overview/judge.ts يستورد نفس الملف).
const FUN = { W:960, H:250, MID:118, MAX:170, MIN:26, EASE:.25, NECK:.6, MIN_NECK:8, COL:['#7C8CFF','#8B6CFF','#294036','#5B36D6'] };
// The rate steps sit on the links; the costs and the return sit on stages (cpl on stage 2, cpa and roas on stage 3)
const FUN_RATE = ['click','lead','sale'];
// The viewer's edits to the targets table (same key as Overview, same origin)
const FUN_KEY = 'well-ads-funnel-targets';
function funTargets(){
  let mine = null; try{ mine = JSON.parse(localStorage.getItem(FUN_KEY)||'null'); }catch(e){}
  return { mine, cfg:JUDGE.targets(D.funnel_targets), t:JUDGE.targets(D.funnel_targets, mine) };
}
const funFmt = { pct:v=>`${Number(v.toFixed(Math.abs(v)<.1?3:2)).toLocaleString('en-US',{maximumFractionDigits:3})}%`,
  sar:v=>`${fmt(v, Math.abs(v)>=100||Number.isInteger(v)?0:2)} ${money()}`, x:v=>`${fmt(v,2)}×`, qty:v=>qty(v), num:(v,d)=>fmt(v,d) };
// Any filter narrows the ads; the CRM's closings can't follow it, so the CRM side is then the whole account
const funSliced = () => S.plat!=='all' || !!S.dept || S.stat!=='all' || !!S.camp || !!S.goal || !!S.fmt;
// The whole account in the period (the CRM side), and every ad's leads by day (the cohort)
function funWhole(from,to){
  const o = {results:0, spend:0, crmLeads:0, booked:0, value:0, byDay:{}};
  for(const [k,date,sp,im,cl,ld,cv=0] of D.rows){ if(!ADS[k]) continue; o.byDay[date]=(o.byDay[date]||0)+ld+cv; if(date<from||date>to) continue; o.results+=ld+cv; o.spend+=sp; }
  for(const [k,leadDay,paidDay,paid,amount] of ((D.crm&&D.crm.rows)||[])){ if(!ADS[k]) continue;
    if(leadDay>=from && leadDay<=to) o.crmLeads++;
    const d = S.crmBy==='paid'?paidDay:leadDay; if(paid && d && d>=from && d<=to){ o.booked++; o.value+=amount||0; } }
  return o;
}
function funJudge(a){
  const T = funTargets().t, w = funWhole(S.from,S.to), all = !!(D.crm && D.crm.paid_all);
  const paid = all ? D.crm.paid_all.map(r=>[r[0],r[1]||null]) : ((D.crm&&D.crm.rows)||[]).filter(r=>r[3]).map(r=>[r[1],r[2]||null]);
  const cohort = D.crm ? JUDGE.cohort(Object.entries(w.byDay), paid, S.from, S.to, MAX, T.maturityDays) : null;
  return JUDGE.judge({
    top:{impr:a.impr||0, clicks:a.clicks||0, results:(a.leads||0)+(a.conv||0), spend:a.spend||0, cpl:a.cpl,
      waSpend:a.waSpend||0, waClicks:a.waClicks||0, leadClicks:(a.clicks||0)-(a.waClicks||0)},
    sale:{crm:!!D.crm, results:w.results, spend:w.spend, closings:all?(a.allPaidN||0):w.booked, paid:all?(a.allPaid||0):w.value, adClosings:w.booked, adLeads:w.crmLeads, wide:funSliced()},
    cohort }, T, LANG, funFmt);
}
// Editing a target re-judges at once (kept in this browser); «رجّع الافتراضي» drops the edits
document.addEventListener('change', e => { const i = e.target.closest && e.target.closest('input[data-ftarget]'); if(!i) return;
  const {mine} = funTargets(), next = {...(mine||{})}, n = Number(i.value);
  if(i.value==='' || !(n>0)) delete next[i.dataset.ftarget]; else next[i.dataset.ftarget] = n;
  try{ localStorage.setItem(FUN_KEY, JSON.stringify(next)); }catch(err){}
  render(); });
document.addEventListener('click', e => { if(!(e.target.closest && e.target.closest('[data-ftreset]'))) return;
  try{ localStorage.removeItem(FUN_KEY); }catch(err){} render(); });
// The benchmark table: each target «افتراضي — عدّله» until the viewer changes it
function funTargetsHTML(){
  const {mine, cfg, t} = funTargets(), unit = {'%':'%', sar:money(), share:ui('من قيمتها','of its value'), x:'×', days:ui('يوم','days')};
  const rows = JUDGE.FIELDS.map(f=>{ const own = mine && mine[f.key]!=null && mine[f.key]!==cfg[f.key];
    return `<tr><th scope="row">${ui(...f.label)}</th><td><label><span class="sr-only">${ui(...f.label)}</span><input type="number" inputmode="decimal" min="0" step="any" data-ftarget="${f.key}" value="${t[f.key]}"> <span class="m">${unit[f.unit]}</span></label></td>`
      + `<td class="m">${own?ui('معدّل منك','Your edit'):ui('افتراضي — عدّله','Default — edit it')}</td></tr>`; }).join('');
  const edited = mine && Object.keys(mine).length;
  return `<details class="ftargets"><summary>${ui('الأهداف اللي ينحكم عليها','The targets it judges against')}</summary><div class="ft-scroll"><table><caption class="sr-only">${ui('جدول الأهداف','Targets table')}</caption><tbody>${rows}</tbody></table></div>`
    + `<p class="m">${ui('التعديل يتحفظ في متصفحك بس. الأهداف الدائمة تتعدّل في ملف الأهداف بطلب تغيير.','Edits are kept in this browser only. The lasting targets live in pipeline/config/targets.json.')}${edited?` <button type="button" class="btn-sm" data-ftreset>${ui('رجّع الافتراضي','Back to defaults')}</button>`:''}</p></details>`;
=======
// وكل وصلة تضيق لعنق، وتضيق أكثر إذا الخطوة ضعيفة. التحليل بالقواعد بدون نموذج: كل خطوة مقارنة بالفترة السابقة وبالوسيط
// اليومي لآخر 30 يوم وبحد أدنى. نفس قواعد ملخص الأداء (src/modules/overview/funnel.ts).
// A step is weak only when weaker than every reference it has: WATCH (15% under all) and BAD (30%), or under its floor
const FUN = { W:960, H:250, MID:118, MAX:170, MIN:26, EASE:.25, NECK:.6, MIN_NECK:8, WATCH:.85, BAD:.7,
  COL:['#7fb59a','#4f7a63','#294036','#293342'], FLOORS:{click:.7, lead:1.5, sale:2}, COVER:.3, MIN_DAYS:7 };

// The usual level: the median of the daily values over the 30 days up to `to`, days with enough volume only
function funMedians(to){
  const from = addDays(to,-29), day = {};
  for(const [k,date,sp,im,cl,ld,cv=0] of D.rows){
    if(date<from||date>to) continue;
    const a = ADS[k]; if(!a||!matchesSlice(a)) continue;
    const o = day[date] ||= {spend:0,impr:0,clicks:0,res:0,ls:0,ln:0};
    o.spend+=sp; o.impr+=im; o.clicks+=cl; o.res+=ld+cv; if(a.goal==='lead'){ o.ls+=sp; o.ln+=ld; }
  }
  const med = xs => { if(xs.length<FUN.MIN_DAYS) return null; const s=[...xs].sort((x,y)=>x-y), m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; };
  const v = Object.values(day);
  return { click: med(v.filter(o=>o.impr>=200).map(o=>100*o.clicks/o.impr)),
    lead: med(v.filter(o=>o.clicks>=20).map(o=>100*o.res/o.clicks)),
    cpl: med(v.filter(o=>o.ln>=1).map(o=>o.ls/o.ln)),
    cpm: med(v.filter(o=>o.impr>=200).map(o=>1000*o.spend/o.impr)) };
}

// The ad-to-sale step can't be judged: no CRM, too few orders tied to an ad, or paid closings in the CRM with none tied to
// an ad in the period (counted over the whole CRM, so a platform filter can't turn missing attribution into a 0% rate)
function funUnlinked(a){
  if(!D.crm) return 'nocrm';
  const results = a.leads||0;   // Hoven: conv is revenue (SAR), not a count (ADR-0007)
  if(results>=10 && (a.crmLeads||0) < FUN.COVER*results) return 'cover';
  let bookedAll = 0;
  for(const [, leadDay, paidDay, paid] of (D.crm.rows||[])){ const d = S.crmBy==='paid'?paidDay:leadDay; if(paid && d && d>=S.from && d<=S.to) bookedAll++; }
  return (a.allPaidN||0)>0 && bookedAll===0 ? 'none' : null;
}

// Who owns each step, from how the funnel works; one table so it can be edited in one place (same as Overview's OWNERS).
// cpm: the price of reach (audience, bid, placement); click: whether the ad stops the scroll; lead: after the click
// (offer, page, form; the buyer too when the traffic is the wrong audience); sale: after the lead; cpl: a lead's cost;
// crm: whether the closings reach us tied to their ads.
const FUN_OWNERS = {
  cpm:{who:['المشتري الإعلامي','Media buyer'], fix:['راجع الجمهور والمزايدة وأماكن الظهور.','Review the audience, the bid and the placements.']},
  click:{who:['الإنتاج / الكريتيف','Production / creative'], fix:['جدّد الافتتاحية والمادة والنص.','Refresh the hook, the creative and the copy.']},
  lead:{who:['الإنتاج + صفحة الهبوط / النموذج','Production + landing page / form'], fix:['راجع العرض وطول النموذج وسرعة الصفحة، ومع المشتري الإعلامي إذا الزوار مو الجمهور الصح.','Review the offer, the form length and the page speed; with the media buyer if the traffic is the wrong audience.']},
  sale:{who:['المبيعات','Sales'], fix:['سرّع الرد على الطلب وتابع اللي ما ردوا.','Answer orders faster and follow up on the ones who did not reply.']},
  cpl:{who:['المشتري الإعلامي','Media buyer'], fix:['وسّع الجمهور أو غيّره، وبدّل المواد اللي طوّلت.','Widen or change the audience and replace long-running creatives.']},
  crm:{who:['نظام العملاء / العمليات','CRM / operations'], fix:['تأكد إن كل طلب ودفعة توصل ومعها رقم الإعلان.','Make sure every lead and payment arrives with its ad id.']},
};
const funOwner = k => ({owner:ui(...FUN_OWNERS[k].who), fix:ui(...FUN_OWNERS[k].fix)});
// The rate steps sit on the links; the two costs sit on stages (cpm on stage 0, cpl on stage 2)
const FUN_RATE = ['click','lead','sale'];

function funSteps(a,b,m,clickToLead,clickToLeadB,unlinked){
  const pc = v => pct(v), rs = v => `${fmt(v,2)} ${money()}`;
  const judge = (now,prev,median,floor,lower) => { if(now==null) return null; const r=[];
    for(const ref of [prev,median]) if(ref){ const x = lower ? (now?ref/now:null) : now/ref; if(x!=null) r.push(x); }
    // The best of the comparisons: «close to usual» is never weak just because the earlier period was better
    const hist = r.length ? Math.max(...r) : 1; return floor!=null && now<floor ? Math.min(hist, now/floor) : hist; };
  const line = (label,now,prev,median,floor,f) => { if(now==null) return `${label}: ${ui('ما فيه أرقام كفاية.','not enough numbers.')}`;
    const p=[];
    if(prev){ const ch=100*(now-prev)/prev; p.push(Math.abs(ch)<5?ui('نفس الفترة السابقة تقريبًا','about the same as the earlier period'):`${ch>0?ui('أعلى','higher'):ui('أقل','lower')} ${ui('من الفترة السابقة بـ','than the earlier period by')} ${fmt(Math.abs(ch),0)}%`); }
    if(median){ const ch=(now-median)/median; p.push(Math.abs(ch)<.1?`${ui('قريب من المعتاد','close to usual')} (${f(median)})`:`${ch>0?ui('أعلى','higher'):ui('أقل','lower')} ${ui('من المعتاد','than usual')} (${f(median)})`); }
    if(floor!=null && now<floor) p.push(`${ui('وتحت الحد المقبول','and under the floor')} (${f(floor)})`);
    return `${label} ${f(now)}${p.length?': '+p.join(ui('، ',', ')):''}.`; };
  const mk = (key,label,link,now,prev,median,floor,lower,f) => { const score=judge(now,prev,median,floor,lower), below=floor!=null&&now!=null&&now<floor;
    return {key,label,link,now,score,level:score==null?'ok':below||score<FUN.BAD?'bad':score<FUN.WATCH?'watch':'ok',line:line(label,now,prev,median,floor,f),...funOwner(key)}; };
  const sale = unlinked
    ? {key:'sale',label:tr('من طلب إلى اقفالة'),link:2,now:null,score:null,level:'ok',unlinked:true,...funOwner('crm'),line:
        unlinked==='nocrm' ? ui('غير مربوط: نظام العملاء مو موصول بهالأرقام، فما نعرف كم طلب صار اقفالة.','Not linked: the CRM is not connected to these numbers.')
        : unlinked==='none' ? ui(`غير مربوط: في نظام العملاء ${fmt(a.allPaidN)} اقفالة مدفوعة بس ولا وحدة منها مربوطة بإعلان، فنسبة الاقفال من الإعلانات ما تنحسب (مو صفر).`,`Not linked: the CRM has ${fmt(a.allPaidN)} paid closings but none is tied to an ad, so the ad close rate can't be computed (it is not zero).`)
        : ui(`غير مربوط: أغلب الطلبات ما انربطت بإعلان في نظام العملاء (${fmt(a.crmLeads||0)} من ${fmt(a.leads||0)})، فنسبة الاقفال ما تنحكم.`,`Not linked: most orders are not tied to an ad in the CRM, so the close rate can't be judged.`)}
    : mk('sale',tr('من طلب إلى اقفالة'),2,a.closeRate,b.closeRate,null,FUN.FLOORS.sale,false,pc);
  return [
    mk('click',tr('نسبة النقر'),0,a.ctr,b.ctr,m.click,FUN.FLOORS.click,false,pc),
    mk('lead',tr('من نقرة إلى طلب'),1,clickToLead,clickToLeadB,m.lead,FUN.FLOORS.lead,false,pc),
    sale,
    mk('cpl',tr('تكلفة الطلب'),2,a.cpl,b.cpl,m.cpl,null,true,rs),
    mk('cpm',tr('تكلفة الألف ظهور'),0,a.cpm,b.cpm,m.cpm,null,true,rs),
  ];
}

const FUN_ADVICE = {
  cpm:{t:['الوصول صار أغلى','Reach got more expensive'], w:['المزايدة أو الجمهور أو أماكن الظهور ترفع سعر الوصول.','The bid, the audience or the placements are pushing up the price of reach.'], d:['راجع الجمهور والمزايدة وأماكن الظهور، وجرّب جمهور أوسع.','Review the audience, the bid and the placements; try a wider audience.']},
  click:{t:['الإعلان ما يجيب نقرات كفاية','The ads get too few clicks'], w:['الإعلان ما يشد: الصورة أو أول سطر ما يوقف اللي يمرر.','The ad does not stop the scroll: the image or the first line.'], d:['جرّب مادة جديدة، وغيّر أول سطر والعنوان، وابدأ بالفايدة أو بسؤال يلمس المشكلة.','Try a new creative and a new first line; lead with the benefit or a question.']},
  lead:{t:['النقرات ما تصير طلبات','Clicks are not becoming orders'], w:['الناس تضغط بس ما تكمل: النموذج طويل، أو الصفحة بطيئة، أو دخول الواتساب فيه خطوة زايدة.','People click but stop: a long form, a slow page, or an extra step into WhatsApp.'], d:['قصّر النموذج، وشيك على سرعة الصفحة من الجوال، وجرّب رسالة الواتساب الجاهزة بنفسك.','Shorten the form, check the page speed on a phone, try the WhatsApp entry yourself.']},
  sale:{t:['الطلبات ما تصير اقفالات','Orders are not closing'], w:['المتابعة متأخرة، أو جودة الطلبات نازلة.','Follow-up is slow, or order quality dropped.'], d:['شيك كم ياخذ الفريق عشان يرد على العميل، وراجع أسئلة النموذج عشان تفلتر الجادين.','Check how fast the team answers a lead; tighten the form questions.']},
  cpl:{t:['تكلفة الطلب طالعة','Cost per order is rising'], w:['الجمهور تشبّع، أو المواد تعبت من كثر ما انعرضت.','The audience is saturated or the creatives are worn out.'], d:['وسّع الجمهور أو غيّره، وبدّل المواد اللي صار لها فترة طويلة تنعرض.','Widen or change the audience; replace long-running creatives.']},
};
const FUN_UNLINKED = {w:['الاقفالات ما توصل من نظام العملاء مربوطة بإعلاناتها، فما نقدر نقول وين تضيع الطلبات بعد التواصل.','Closings reach us without their ads, so we cannot tell where orders drop after contact.'],
  d:['شيك على ربط نظام العملاء من صفحة الربط، وتأكد إن كل طلب يوصل ومعه رقم الإعلان.','Check the CRM link on the Connectors page; make sure every lead carries its ad id.']};

// The bottleneck: the weakest step that can be judged; an unlinked step is never it
function funVerdict(steps){
  const unlinked = steps.some(s=>s.unlinked);
  // A step under its floor (bad) outranks one only weaker than usual (watch); then the lowest score
  const rank = {bad:0, watch:1, ok:2};
  const pick = steps.filter(s=>s.score!=null).sort((x,y)=>rank[x.level]-rank[y.level] || x.score-y.score)[0];
  if(!pick) return {step:null,level:'ok',title:ui('ما فيه أرقام كفاية للتحليل','Not enough numbers to judge'),why:'',todo:'',owner:null,unlinked};
  const A = FUN_ADVICE[pick.key], L = x => ui(x[0],x[1]);
  if(pick.level==='ok') return {step:null,level:'ok',title:ui('لا توجد مشكلة واضحة','No clear problem'),why:ui('كل خطوة في حدودها المعتادة أو قريبة منها، وما فيه شي تحت حده الأدنى.','Every step is at or near its usual level and nothing is under its floor.'),todo:ui('كمّل على نفس الخطة.','Keep the plan.'),owner:null,unlinked};
  return {step:pick.key,level:pick.level,title:L(A.t),why:L(A.w),todo:L(A.d),owner:pick.owner,unlinked};
>>>>>>> hoven
}

// Band geometry: eased heights, a neck on every link (pinched further by a weak step), stage 1 on the right in Arabic
function funShape(vols, scores){
  const top = Math.max(1,...vols.map(v=>v||0));
  const h = v => v==null||v<=0 ? FUN.MIN : FUN.MIN + (FUN.MAX-FUN.MIN)*Math.pow(v/top, FUN.EASE);
  const heights = vols.map(h);
  const waists = scores.map((s,i)=>Math.max(FUN.MIN_NECK, Math.min(heights[i],heights[i+1])*FUN.NECK*Math.max(.35,Math.min(1,s==null?1:s))));
  return {heights,waists};
}
const funX = i => { const slot=FUN.W/4, c=(i+.5)*slot; return LANG==='en' ? c : FUN.W-c; };
// The outline: a flat run over each stage, a smooth S into the neck between stages (horizontal tangents at every point)
function funPath(sh){
  const slot = FUN.W/4, run = slot*.42, pts = [];
  const order = [0,1,2,3].sort((i,j)=>funX(i)-funX(j));
  order.forEach((i,n)=>{ pts.push({x:funX(i)-run/2,h:sh.heights[i]},{x:funX(i)+run/2,h:sh.heights[i]});
    if(n<3){ const j=order[n+1], l=Math.min(i,j); pts.push({x:(funX(i)+funX(j))/2,h:sh.waists[l]}); } });
  pts[0].x=0; pts[pts.length-1].x=FUN.W;
  const y = (p,s) => (FUN.MID + s*p.h/2).toFixed(1);
  const edge = (ps,s) => ps.map((p,k)=>{ if(!k) return ''; const q=ps[k-1], m=((q.x+p.x)/2).toFixed(1);
    return `C${m},${y(q,s)} ${m},${y(p,s)} ${p.x.toFixed(1)},${y(p,s)}`; }).join('');
  const back = [...pts].reverse();
  return `M${pts[0].x},${y(pts[0],-1)}${edge(pts,-1)}L${back[0].x},${y(back[0],1)}${edge(back,1)}Z`;
}

// The whole journey block: the band, each stage's numbers with labelled changes, the verdict and a line per step
function funnelHTML(a,b){
  const crm = !!(D.crm && D.crm.paid_all), allN = a.allPaidN||0;
  const ratio = (x,y) => x!=null && y ? x/y : null;
<<<<<<< well
  const clickToLead = ratio(100*((a.leads||0)+(a.conv||0)), a.clicks), clickToLeadB = ratio(100*((b.leads||0)+(b.conv||0)), b.clicks);
  const v = funJudge(a), steps = v.steps, unlinked = !!v.unlinked;
  // Lead to closing on the whole CRM when the ads aren't narrowed by a filter (the judge's own figure); else the ad-linked rate
  const res = (a.leads||0)+(a.conv||0), resB = (b.leads||0)+(b.conv||0), wideRate = crm && !funSliced();
  const saleRate = wideRate ? (res ? 100*allN/res : null) : a.closeRate, saleRateB = wideRate ? (resB ? 100*(b.allPaidN||0)/resB : null) : b.closeRate;
=======
  const clickToLead = ratio(100*(a.leads||0), a.clicks), clickToLeadB = ratio(100*(b.leads||0), b.clicks);
  const unlinked = funUnlinked(a);
  const steps = funSteps(a,b,funMedians(S.to),clickToLead,clickToLeadB,unlinked), v = funVerdict(steps);
>>>>>>> hoven
  const saleN = D.crm ? (crm?allN:(a.booked||0)) : null;
  const NA = tr('غير مربوط'), NONE = tr('لا توجد إقفالات'), noSale = crm && !allN, dl = d => /لا مقارنة/.test(d) ? '' : d;
  const rs = v => v==null||!isFinite(v) ? '—' : `${sar(v)} ${money()}`;
  const kpi = (l,val,d,cls='') => `<div class="kpi ${cls}"><span class="l">${l}</span><span class="v">${val}</span>${dl(d||'')}</div>`;
  const stages = [
    {n:'الوعي', hint:'كم شخص شاف الإعلان', vol:a.impr||0, val:fmt(a.impr), main:kpi(tr('الظهور'),fmt(a.impr),delta(a.impr,b.impr,false)),
     cost:[tr('تكلفة الألف ظهور'),rs(a.cpm)], sub:[kpi(tr('تكلفة الألف ظهور'),`${sar(a.cpm)} <small>${money()}</small>`,delta(a.cpm,b.cpm,true),'sub')]},
    {n:'الاهتمام', hint:'كم واحد ضغط', vol:a.clicks||0, val:fmt(a.clicks), main:kpi(tr('نقرات الرابط والسوايب'),fmt(a.clicks),delta(a.clicks,b.clicks,false)),
     cost:[tr('تكلفة النقرة'),rs(a.cpc)], sub:[kpi(tr('تكلفة النقرة'),`${sar(a.cpc)} <small>${money()}</small>`,delta(a.cpc,b.cpc,true),'sub')],
     rate:[tr('نسبة النقر'),pct(a.ctr),delta(a.ctr,b.ctr,false)]},
    {n:'التحويل', hint:'كم واحد اشترى', vol:a.leads||0, val:qty(a.leads), main:kpi(tr('الطلبات'),qty(a.leads),delta(a.leads,b.leads,false)),
     cost:[tr('تكلفة الطلب'),rs(a.cpl)], sub:[kpi(tr('تكلفة الطلب'),`${sar(a.cpl)} <small>${money()}</small>`,delta(a.cpl,b.cpl,true),'sub'), kpi(tr('الإيراد (ر.س)'),sar(a.conv),delta(a.conv,b.conv,false),'sub')],
     rate:[tr('من نقرة إلى طلب'),pct(clickToLead),delta(clickToLead,clickToLeadB,false)]},
    {n:'البيع', hint:D.crm?'كم واحد دفع':'نظام العملاء مو موصول بهالأرقام', vol:saleN, val:saleN==null?'—':fmt(saleN),
     main:kpi(tr('إقفالات مدفوعة'),saleN==null?'—':fmt(saleN),D.crm?delta(saleN,crm?b.allPaidN:b.booked,false):''),
     cost:[tr('تكلفة العميل'),crm&&allN?rs(a.spend/allN):noSale?NONE:'—'],
     // The sales amount: every paid closing in the CRM, called the CRM's total when the closings aren't tied to ads
     amount:D.crm?[crm&&unlinked?ui('إجمالي المدفوع (CRM)','Total paid (CRM)'):ui('مبلغ المبيعات','Sales amount'),rs(crm?a.allPaid:a.value)]:null,
     sub:[kpi(crm&&unlinked?ui('إجمالي المدفوع (CRM)','Total paid (CRM)'):ui('مبلغ المبيعات','Sales amount'),D.crm?`${sar(crm?a.allPaid:a.value)} <small>${money()}</small>`:'—',D.crm?delta(crm?a.allPaid:a.value,crm?b.allPaid:b.value,false):'','sub'),
<<<<<<< well
       ...(crm?[kpi(ui('المبيعات من الإعلانات','Sales from ads'),noSale?NONE:unlinked?NA:`${sar(a.value||0)} <small>${money()}</small>`,unlinked&&!noSale?'':delta(a.value,b.value,false),'sub')]:[]),
       kpi(tr('إقفالات من الإعلانات'),noSale?NONE:unlinked?NA:fmt(a.booked||0),unlinked||noSale?'':delta(a.booked,b.booked,false),'sub'), kpi(tr('العائد من الإعلانات'),noSale?NONE:unlinked||a.roas==null?(unlinked?NA:'—'):fmt(a.roas,2)+'×',unlinked||noSale?'':delta(a.roas,b.roas,false),'sub')],
     rate:[tr('من ليد إلى إقفالة'),wideRate?pct(saleRate):unlinked?NA:pct(saleRate),wideRate||!unlinked?delta(saleRate,saleRateB,false):'']},
=======
       ...(crm?[kpi(ui('المبيعات من الإعلانات','Sales from ads'),unlinked?NA:`${sar(a.value||0)} <small>${money()}</small>`,unlinked?'':delta(a.value,b.value,false),'sub')]:[]),
       kpi(tr('اقفالات من الإعلانات'),unlinked?NA:fmt(a.booked||0),unlinked?'':delta(a.booked,b.booked,false),'sub'), kpi(tr('العائد من الإعلانات'),unlinked||a.roas==null?(unlinked?NA:'—'):fmt(a.roas,2)+'×',unlinked?'':delta(a.roas,b.roas,false),'sub')],
     rate:[tr('من طلب إلى اقفالة'),unlinked?NA:pct(a.closeRate),unlinked?'':delta(a.closeRate,b.closeRate,false)]},
>>>>>>> hoven
  ];
  const linkStep = i => steps.find(s=>s.link===i && FUN_RATE.includes(s.key));
  const sh = funShape(stages.map(s=>s.vol), [0,1,2].map(i=>linkStep(i).score));
  const weakV = v.level!=='fine' && v.level!=='na';
  const weakLink = weakV && FUN_RATE.includes(v.step) ? FUN_RATE.indexOf(v.step) : null;
  // A weak cost or return (cpl on stage 2, cpa or roas on stage 3) shows in red under its stage
  const weakCost = weakV && v.step && !FUN_RATE.includes(v.step) ? steps.find(s=>s.key===v.step).link : null;
  const grad = [0,1,2,3].map(i=>({o:funX(i)/FUN.W, c:i===3&&saleN==null?'#C9C2E8':FUN.COL[i]})).sort((x,y)=>x.o-y.o)
    .map(s=>`<stop offset="${s.o.toFixed(3)}" stop-color="${s.c}"/>`).join('');
  const svgStages = stages.map((s,i)=>{ const x=funX(i), hh=sh.heights[i]/2, on=s.vol!=null && hh*2>=56;
    const vy = on ? FUN.MID-2 : FUN.MID-hh-8, ly = on ? FUN.MID+16 : FUN.MID+hh+15;
    return `<g class="fstage"><text x="${x}" y="22" class="fs-name">${i+1}. ${tr(s.n)}</text>`
      + `<text x="${x}" y="${vy}" class="fs-val${on?' on':''}">${s.val}</text>`
      + `<text x="${x}" y="${ly}" class="fs-lab${on?' on':''}">${s.main.match(/<span class="l">(.*?)<\/span>/)[1]}</text>`
      + (s.amount ? `<text x="${x}" y="${on ? FUN.MID+hh+14 : ly+16}" class="fs-amount">${s.amount[0]}: ${s.amount[1]}</text>` : '')
      + `<text x="${x}" y="${FUN.H-26}" class="fs-lab">${s.cost[0]}</text><text x="${x}" y="${FUN.H-8}" class="fs-cost${i===weakCost?' bad':''}">${s.cost[1]}</text></g>`; }).join('');
  const svgLinks = [0,1,2].map(i=>{ const x=(funX(i)+funX(i+1))/2, st=linkStep(i), r=stages[i+1].rate, weak=weakLink===i, off=!!st.unattributed;
    return `<g class="flinkp${weak?' weak':''}${off?' off':''}${st.level==='watch'?' watch':''}${st.level==='problem'||st.level==='disaster'?' bad':''}">${weak?`<text x="${x}" y="${FUN.MID-26}" class="fl-neck">${tr('عنق الزجاجة')}</text>`:''}`
      + `<rect x="${x-44}" y="${FUN.MID-13}" width="88" height="26" rx="13"/><text x="${x}" y="${FUN.MID+5}">${r[1]}</text></g>`; }).join('');
  const svg = `<div class="fpipe-scroll"><svg class="fpipe" viewBox="0 0 ${FUN.W} ${FUN.H}" role="img" aria-label="${tr('رحلة العميل')}">`
    + `<defs><linearGradient id="fpipeFill" x1="0" x2="1" y1="0" y2="0">${grad}</linearGradient></defs>`
    + `<path d="${funPath(sh)}" fill="url(#fpipeFill)"/>${svgStages}${svgLinks}</svg></div>`;
  // Each stage's numbers in the same right-to-left order as the band, with the change against the earlier period
  const cols = stages.map((s,i)=>`<div class="fcol"><div class="fname"><b>${i+1}</b><span>${tr(s.n)}</span><em>${tr(s.hint)}</em></div>${s.main}${s.sub.join('')}`
    + (s.rate?kpi(s.rate[0],s.rate[1],s.rate[2],'rate'):'')+`</div>`).join('');
  const cls = l => ({fine:'', watch:'watch', problem:'bad', disaster:'bad dis', na:'off'})[l];
  const conf = {high:ui('عالية','high'), medium:ui('متوسطة','medium'), low:ui('منخفضة','low')};
  const row = (k,val) => val ? `<p><span class="m">${k}</span>${val}</p>` : '';
  const verdict = `<div class="fverdict ${cls(v.level)}"><div class="fv-head"><span class="fv-badge">${ui(...JUDGE.SEV[v.level])}</span><span class="fv-conf m">${ui('الثقة','Confidence')}: ${conf[v.confidence]}</span></div>`
    + `<h4>${v.title}</h4>${v.owner?`<span class="fv-owner"><span class="m">${ui('المسؤول','Owner')}: </span><b>${v.owner}</b></span>`:''}`
    + row(ui('المرحلة: ','Stage: '), v.stage) + row(ui('الدليل: ','Evidence: '), v.evidence) + row(ui('على المحك: ','At stake: '), v.sar!=null?`<b>≈ ${funFmt.sar(v.sar)}</b>`:'')
    + row(ui('ليش: ','Why: '), v.why) + row(ui('وش تسوي: ','What to do: '), v.todo) + row(ui('وش يغيّر الحكم: ','What would change it: '), v.change)
    + (v.unlinked?`<div class="fv-unlinked"><b>${ui('الربط بالإعلانات ناقص','Attribution to ads is incomplete')}</b><span class="fv-owner"><span class="m">${ui('المسؤول','Owner')}: </span><b>${v.unlinked.owner}</b></span><p>${v.unlinked.why}</p><p><span class="m">${ui('وش تسوي: ','What to do: ')}</span>${v.unlinked.todo}</p></div>`:'')
    + (v.rule?`<p class="fv-note">${ui('القاعدة: ','Rule: ')}${v.rule}</p>`:'')
    + `<p class="fv-note">${ui('حكم بالقواعد: كل خطوة مقابل هدف ثابت من جدول الأهداف تحت.','Rule-based: every step against a fixed target from the table below.')}</p></div>`;
  // One «التحليل» heading over the lines (each line already starts with its step's name), then the end-to-end rate,
  // the biggest loss, the data trust and the lead cohorts
  const lines = `<h4 class="flines-h">${ui('التحليل','Analysis')}</h4><ul class="flines">${steps.map(s=>`<li class="${cls(s.level)}">${s.line}<span class="fl-owner">${ui('المسؤول','Owner')}: ${s.owner}${s.unattributed||(s.level!=='fine'&&s.level!=='na')?` · ${s.fix}`:''}</span></li>`).join('')}`
    + (v.e2e?`<li class="${cls(v.e2e.level)}">${v.e2e.line}</li>`:'') + `</ul>`
    + `<div class="fmeta">${v.biggest?`<p class="fbig">${v.biggest}</p>`:''}<p>${v.trust.line}</p>${v.cohort?`<p>${v.cohort.line}</p>`:''}</div>` + funTargetsHTML();
  return `<div class="ffun2"><div class="fmain">${svg}<div class="fcols">${cols}</div></div>${verdict}</div>${lines}`;
}
// HOVEN-DASH: Hoven overlay applied
