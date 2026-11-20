// The rules every write to an ad platform passes (docs/PRD.md §6.3, approved by Leen 2026-11-19). Pure: the caller reads
// the state (kill switch, managed list, today's changes) and this decides. A refusal is a sentence Leen can act on.
//  1. Every create or change goes through Leen's approval: here, her own click (the owner) until she names another approver.
//  2. Created campaigns start paused; switching one on is its own click.
//  3. Fixed limits even with approval: a budget never rises more than 20% in a day; changes only on managed campaigns;
//     no new daily budget above the planned one in the buyer goals unless she typed it herself.
//  4. The kill switch stops every write at once.
//  5. Full automation per agent, only when she switches it on (not offered yet: every write is a click).

export const MAX_DAILY_RAISE = 0.2;
export const MAX_DAILY_SAR = 100_000;   // a typed budget above this is a typo, not a plan

export type Action = 'create_paused' | 'activate' | 'pause' | 'set_budget';
export interface WriteState {
  kill: boolean;                 // control_settings.global.guardrails.kill
  owner: boolean;                // the person clicking is Leen (or a named approver, later)
  managed: boolean;              // the campaign is on Leen's managed list (a campaign Dream created is added when created)
}
export interface BudgetCheck {
  planned?: number | null;       // dailyBudget in the buyer goals for the platform
  typed?: number | null;         // what Leen typed in the publish dialog
  startOfDay?: number | null;    // the budget at the start of the Riyadh day (before today's changes)
  next: number;                  // the budget asked for
}

/** null = allowed; else why not. */
export function checkWrite(action: Action, s: WriteState): string | null {
  if (!s.owner) return 'التنفيذ على المنصات بموافقة لين بس';
  if (action === 'pause') return null;   // stopping spend is always allowed to the approver, kill switch or not, managed or not
  if (s.kill) return 'زر الطوارئ شغّال: كل التنفيذ واقف لين تطفيه';
  if (action !== 'create_paused' && !s.managed) return 'هالحملة مو من الحملات المُدارة: حددها في الميديا باير أول';
  return null;
}

/** The daily budget a write may set, or why not. */
export function checkBudget(b: BudgetCheck): string | null {
  if (!Number.isFinite(b.next) || b.next <= 0) return 'الميزانية اليومية لازم رقم أكبر من صفر';
  if (b.next > MAX_DAILY_SAR) return `الميزانية اليومية أكبر من ${MAX_DAILY_SAR.toLocaleString('en-US')} ر.س: تأكد من الرقم`;
  // A new budget: within the plan, or typed by Leen herself
  if (b.startOfDay == null) {
    if (b.typed != null && Math.abs(b.typed - b.next) < 0.005) return null;
    if (b.planned != null && b.next <= b.planned + 0.005) return null;
    return b.planned != null ? `الميزانية اليومية أعلى من خطتك (${b.planned} ر.س): اكتبها بنفسك في نافذة النشر` : 'ما فيه ميزانية يومية في خطتك لهالمنصة: اكتبها بنفسك في نافذة النشر';
  }
  // A change: never more than 20% above where the day started
  if (b.next > b.startOfDay * (1 + MAX_DAILY_RAISE) + 0.005) return `الزيادة أكثر من ${MAX_DAILY_RAISE * 100}٪ في يوم واحد (من ${b.startOfDay} إلى ${b.next} ر.س)`;
  return null;
}

/** Meta and Snap take budgets in the currency's minor unit (halalas for SAR). */
export const minor = (sar: number) => Math.round(sar * 100);
