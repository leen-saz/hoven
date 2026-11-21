// Grok's replies on social (Leen, 2026-11-21): comments and private messages on Facebook and Instagram. Pure functions:
// the prompt Grok reads, how its answer becomes a category and a draft, which messages may still be answered, and what
// is old enough to delete. The calls to Meta live in Hoven's MCP server (src/mcp/adapters/meta-engage.ts).
//  - «بموافقتي»: every reply waits for Leen's click (or an approver's). «تلقائي» comes later, per agent.
//  - Complaints, refunds and negative messages get no reply from Grok: they go to Leen («يحتاجك»).
//  - Private messages are deleted 90 days after they arrive (PDPL); Meta allows answering one within 24 hours only.
import { check, type Rule } from '../compliance/compliance';

export const CATEGORIES = ['question', 'complaint', 'refund', 'negative', 'spam', 'other'] as const;
export type Category = typeof CATEGORIES[number];
export const ESCALATE: Category[] = ['complaint', 'refund', 'negative'];
export const DM_KEEP_DAYS = 90;
export const DM_WINDOW_MS = 24 * 3600e3;
export const MAX_REPLY = { comment: 600, dm: 1000 } as const;

export interface Incoming { platform: 'facebook' | 'instagram'; kind: 'comment' | 'dm'; author: string | null; text: string; post_text?: string | null }

/** What Grok reads for one message: who we are, the rules, and the message. Answer: one JSON object. */
export function replyPrompt(m: Incoming): string {
  const where = m.kind === 'dm' ? `رسالة خاصة على ${m.platform === 'instagram' ? 'انستقرام' : 'فيسبوك'}` : `تعليق على منشور في ${m.platform === 'instagram' ? 'انستقرام' : 'فيسبوك'}`;
  return [
    'أنت ترد باسم متجر هوفن (مفارش ومنسوجات منزلية، السعودية) على التواصل الاجتماعي. لهجة سعودية بيضاء، ودودة ومختصرة، تخاطب بالمذكر.',
    'صنّف الرسالة أول: question (سؤال عن منتج أو سعر أو شحن أو استبدال أو رابط)، complaint (شكوى)، refund (طلب استرجاع فلوس أو إلغاء طلب)، negative (تعليق سلبي أو هجوم)، spam (دعاية أو روابط مشبوهة)، other (شكر أو مدح أو كلام عام).',
    'اكتب رد بس إذا التصنيف question أو other. لـ complaint و refund و negative و spam خل الرد فاضي: هذي تروح لصاحبة المتجر.',
    'الرد من المعرفة اللي فوق بس. إذا المعلومة مو موجودة قل إننا بنتواصل معه، ولا تخترع سعر أو موعد أو خصم. لا تعد بشي ما نقدر نضمنه، ولا تقول الأفضل أو الأرخص.',
    m.kind === 'comment' ? `الرد عام تحت التعليق: سطر أو سطرين، وإذا يحتاج تفاصيل خاصة اطلب منه يراسلنا خاص. بحد ${MAX_REPLY.comment} حرف.` : `الرد في رسالة خاصة: واضح ومباشر، بحد ${MAX_REPLY.dm} حرف. لا تطلب بيانات بطاقة أو كلمة مرور أبداً.`,
    `## ${where}`,
    m.post_text ? `المنشور: ${m.post_text.slice(0, 300)}` : '',
    `${m.author ? `من ${m.author.slice(0, 60)}: ` : ''}${m.text.slice(0, 1500)}`,
    'رد بكائن JSON واحد بس، بدون أي نص قبله أو بعده: {"category":"question|complaint|refund|negative|spam|other","reply":"الرد أو فاضي"}',
  ].filter(Boolean).join('\n\n');
}

/** Grok's answer → category and draft (a draft only where Grok may answer, capped, control characters out). */
export function parseReply(raw: string, kind: 'comment' | 'dm'): { category: Category; draft: string | null } {
  const t = String(raw || '').replace(/```(?:json)?/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  let j: Record<string, unknown> = {};
  if (a >= 0 && b > a) { try { j = JSON.parse(t.slice(a, b + 1)) as Record<string, unknown>; } catch { j = {}; } }
  const category = (CATEGORIES as readonly string[]).includes(String(j['category'])) ? j['category'] as Category : 'other';
  const reply = String(j['reply'] ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, MAX_REPLY[kind]);
  return { category, draft: ESCALATE.includes(category) || category === 'spam' || !reply ? null : reply };
}

/** The status a new message gets once Grok has read it. */
export const statusFor = (c: Category, draft: string | null): 'drafted' | 'escalated' | 'ignored' | 'new' =>
  ESCALATE.includes(c) ? 'escalated' : c === 'spam' ? 'ignored' : draft ? 'drafted' : 'new';

/** A private message may still be answered (Meta's 24-hour window). */
export const inWindow = (at: string, now = Date.now()) => now - Date.parse(at) < DM_WINDOW_MS;

/** The text Leen approves: hers when she edited it, else the draft; trimmed, capped, with compliance notices. */
export function finalText(kind: 'comment' | 'dm', draft: string | null, edited: unknown, rules: Rule[] = []): { text: string; notices: string[] } | null {
  const text = String(edited ?? draft ?? '').trim().slice(0, MAX_REPLY[kind]);
  if (!text) return null;
  return { text, notices: check(text, rules).map(h => h.title) };
}

/** The cut-off before which private messages are deleted. */
export const dmCutoff = (now = Date.now()) => new Date(now - DM_KEEP_DAYS * 864e5).toISOString();
