// What Claude reads before it answers in the media buyer's chat, and how a proposal becomes a decision-board row.
import { FAMS, FAM_AR, type Goals, type Rec, type Summary, type Kind, type Result } from './engine';

// Starting rules until Leen writes her own (the «القواعد» tab replaces them all)
export const DEFAULT_RULES = [
  'النتيجة اللي نحكم فيها = الطلبات في سلة، مو النقرات ولا المشاهدات.',
  'لا تحكم على حملة قبل ٣ طلبات أو صرف يساوي ضعف تكلفة الطلب المستهدفة.',
  'أي تغيير في الميزانية ما يتعدى ٢٠٪ في المرة، ومرة كل ٣ أيام بالكثير.',
  'لا تقترح إيقاف حملة في أول ٣ أيام من تشغيلها إلا إذا تعدت حد الإيقاف.',
  'إذا نزلت نسبة النقر ٣٠٪ عن الأسبوع اللي قبله، اقترح تصميم جديد قبل ما تلمس الميزانية.',
];

const RESULT_AR: Record<Result, string> = { worked: 'نجح', no_change: 'ما غيّر شي', worse: 'خرّب', unclear: 'ما ينحكم عليه' };
export const KIND_AR: Record<Kind, string> = { pause: 'إيقاف', budget_down: 'تنزيل الميزانية', budget_up: 'رفع الميزانية', refresh_creative: 'تصميم جديد', roas_alert: 'تنبيه العائد' };

export interface PastRec { kind: string; campaign: string | null; platform: string; status: string; d3?: Result | null; d7?: Result | null }
export interface Context { summary: Summary; goals: Goals; rules: string[]; lessons: string[]; knowledge: string; recs: Rec[]; past: PastRec[] }

const fmtN = (x: number | null | undefined) => (x == null ? '—' : String(Math.round(x * 100) / 100));

export function systemFor(c: Context): string {
  const s = c.summary;
  const plat = FAMS.filter(f => s.platforms[f].now.spend || s.platforms[f].prev.spend).map(f => {
    const p = s.platforms[f], g = c.goals[f] || {};
    return `- ${FAM_AR[f]}: صرف ${fmtN(p.now.spend)} (قبل ${fmtN(p.prev.spend)})، طلبات ${fmtN(p.now.purchases)} (قبل ${fmtN(p.prev.purchases)})، تكلفة الطلب ${fmtN(p.now.cpa)} (قبل ${fmtN(p.prev.cpa)})، نسبة النقر ${fmtN(p.now.ctr)}٪`
      + ` | الهدف: تكلفة طلب ${fmtN(g.targetCpa)}، عائد ${fmtN(g.targetRoas)}×، ميزانية يومية ${fmtN(g.dailyBudget)}، حد إيقاف ${fmtN(g.stopSpend)}`;
  });
  const camps = s.campaigns.slice(0, 25).map(x => `- [${FAM_AR[x.fam]}] ${x.campaign}${x.live ? '' : ' (موقوفة)'}: صرف ${fmtN(x.now.spend)}، طلبات ${fmtN(x.now.purchases)}، تكلفة الطلب ${fmtN(x.now.cpa)}، نسبة النقر ${fmtN(x.now.ctr)}٪ (قبل ${fmtN(x.prev.ctr)}٪)`);
  const parts = [
    'أنت الميديا باير لمتجر هوفن (مفارش ومنسوجات منزلية، السعودية). تكلم بلهجة سعودية بيضاء، مختصر وواضح، وبالأرقام.',
    'النتيجة = طلبات الشراء في سلة. العائد (ROAS) = مبيعات سلة الصافية ÷ صرف الإعلانات. العملة ريال سعودي.',
    'أنت تقترح بس: ما تنفّذ شي. كل اقتراح يروح لوحة القرارات ولين توافق عليه. حسابات الإعلانات قراءة بس.',
    'كل اقتراح: وش تسوي، ليش (بالأرقام)، وش نقيس بعد ٣ و٧ أيام، وكيف نتراجع. إذا الأرقام ما تكفي للحكم قلها بصراحة.',
    `\n## الأرقام (آخر ٧ أيام كاملة ${s.from} إلى ${s.to}، مقارنة بـ ${s.prevFrom} إلى ${s.prevTo})`,
    `- المتجر: مبيعات سلة ${fmtN(s.store.sales)} (قبل ${fmtN(s.store.prevSales)})، طلبات ${fmtN(s.store.orders)}، صرف الإعلانات ${fmtN(s.store.spend)}، العائد ${fmtN(s.store.roas)}× (قبل ${fmtN(s.store.prevRoas)}×)`,
    ...plat,
    camps.length ? '\n## الحملات (الأعلى صرفاً)\n' + camps.join('\n') : '',
    '\n## قواعد لين (التزم فيها)\n' + c.rules.map(r => `- ${r}`).join('\n'),
    c.lessons.length ? '\n## دروس تعلمتها (لين اعتمدتها)\n' + c.lessons.slice(0, 30).map(l => `- ${l}`).join('\n') : '',
    c.recs.length ? '\n## اقتراحات القواعد الحالية\n' + c.recs.map(r => `- ${KIND_AR[r.kind]}${r.campaign ? ` «${r.campaign}»` : ''}: ${r.why}`).join('\n') : '',
    c.past.length ? '\n## وش صار في اقتراحاتك اللي قبل\n' + c.past.slice(0, 20).map(p => `- ${KIND_AR[p.kind as Kind] || p.kind}${p.campaign ? ` «${p.campaign}»` : ''} (${p.status}): بعد ٣ أيام ${p.d3 ? RESULT_AR[p.d3] : '—'}، بعد ٧ أيام ${p.d7 ? RESULT_AR[p.d7] : '—'}`).join('\n') : '',
    c.knowledge ? '\n' + c.knowledge : '',
  ];
  return parts.filter(Boolean).join('\n');
}

// A rule proposal -> a row for the decision board (suggestions). Campaign level, keyed by platform + campaign name so the
// board keeps one open proposal per campaign and kind. The executor runs only Meta ad/ad set pauses today: anything else
// is approved on the board and done by hand in the platform.
export function toSuggestion(r: Rec, by: string, source: 'rule' | 'claude' = 'rule') {
  if (r.fam === 'store') return null;
  const campaign = (r.campaign || '').slice(0, 200);
  return {
    platform: r.fam, level: 'campaign', target_id: `buyer:${campaign}`.slice(0, 250), target_name: campaign, campaign, kind: r.kind,
    params: { ...(r.pct ? { pct: r.pct } : {}), from: 'buyer' }, reason: r.why.slice(0, 1000), evidence: r.evidence,
    priority: r.kind === 'pause' ? 80 : r.kind === 'budget_down' ? 60 : 40, source, status: 'open',
    expect: { measure: r.measure }, measure_plan: `بعد ٣ أيام وبعد ٧ أيام: ${r.measure}`,
    reversal_plan: r.kind === 'pause' ? 'تشغيل الحملة من جديد' : r.kind.startsWith('budget') ? 'ترجيع الميزانية لقيمتها قبل التغيير' : 'ترجيع الإعلان القديم',
    requested_by: by, risk: r.kind === 'budget_up' ? ['زيادة صرف'] : [],
    critic: { ok: true, issues: ['اقتراح من الميديا باير: يتنفّذ يدوياً في المنصة بعد الموافقة'], at: new Date().toISOString() },
  };
}

// Proposal written by Claude in the chat and sent by Leen: same shape, kind from a fixed list, text capped
export function fromChat(x: Record<string, unknown>): Rec | null {
  const fam = String(x.platform || '');
  const kind = String(x.kind || '') as Kind;
  if (!(FAMS as string[]).includes(fam) || !(['pause', 'budget_down', 'budget_up', 'refresh_creative'] as string[]).includes(kind)) return null;
  const campaign = String(x.campaign || '').trim().slice(0, 200);
  const why = String(x.why || '').trim().slice(0, 1000);
  if (!campaign || !why) return null;
  const pct = Number(x.pct);
  return { key: `${fam}|${campaign}|${kind}`, fam: fam as Rec['fam'], campaign, kind, why, measure: String(x.measure || 'تكلفة الطلب والطلبات بعد ٣ و٧ أيام').slice(0, 300),
    evidence: {}, ...(kind.startsWith('budget') ? { pct: Number.isFinite(pct) && pct > 0 ? Math.min(pct, 50) : 20 } : {}) };
}

// What Claude is asked to add at the end when it proposes something: one JSON block the page turns into buttons
export const PROPOSE = 'إذا اقترحت تغيير على حملة، اختم ردك بسطر واحد بهالشكل بالضبط (بدون أي شي بعده):\n'
  + 'PROPOSALS: [{"platform":"meta|snap|tiktok|google","campaign":"اسم الحملة كما هو","kind":"pause|budget_down|budget_up|refresh_creative","pct":20,"why":"السبب بالأرقام","measure":"وش نقيس"}]\n'
  + 'وإذا ما فيه اقتراح لا تكتب السطر.';
export function splitProposals(text: string): { text: string; proposals: Rec[] } {
  const i = text.lastIndexOf('PROPOSALS:');
  if (i < 0) return { text, proposals: [] };
  try {
    const arr = JSON.parse(text.slice(i + 10).trim().replace(/^```(?:json)?|```$/g, '').trim()) as unknown;
    const proposals = (Array.isArray(arr) ? arr : []).slice(0, 5).map(x => fromChat((x || {}) as Record<string, unknown>)).filter((p): p is Rec => !!p);
    return { text: text.slice(0, i).trim(), proposals };
  } catch { return { text, proposals: [] }; }
}

