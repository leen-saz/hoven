// السوشال: التحقق من المنشور، وحدود كل منصة، والنشر. النشر الفعلي الحين لفيسبوك وانستقرام (Graph API)،
// والباقي يطلع "قريباً" لين يكون عندنا تطبيق معتمد لكل منصة (ADR-0006).
// التوكنات من الخزنة (صفحة الربط) بأسماء المتغيرات، وما ترجع للمتصفح أبداً.
import { check, notice, type Rule } from '../compliance/compliance';

export const SOCIAL = {
  facebook: { name: 'فيسبوك', max: 63206, live: true },
  instagram: { name: 'انستقرام', max: 2200, live: true, needsMedia: true },
  tiktok: { name: 'تيك توك', max: 2200, live: false, needsMedia: true },
  x: { name: 'X', max: 280, live: false },
  linkedin: { name: 'لينكدإن', max: 3000, live: false },
  snapchat: { name: 'سناب شات', max: 250, live: false, needsMedia: true },
} as const;
export type SocialPlatform = keyof typeof SOCIAL;
export interface Media { url: string; type: 'image' | 'video' }
// overrides: a platform's own text (X's 280 characters, a longer Instagram caption…); a platform without one uses body
export interface Draft { platforms: SocialPlatform[]; body: string; media: Media[]; publish_at: string; mode: 'auto' | 'manual'; overrides?: Partial<Record<SocialPlatform, string>> }
/** The text a platform publishes: its own when written, else the shared one. */
export const textFor = (post: Pick<Draft, 'body' | 'overrides'>, p: SocialPlatform): string => (post.overrides?.[p] ?? '').trim() || post.body;


// Compliance (one list, src/modules/compliance) plus the company's forbidden words: a precise notice, never a block (Leen's rule).
// The notice shows when a post is scheduled and on the post itself, so its approver sees it too.
export function validate(input: Record<string, unknown>, now = Date.now(), extra: Rule[] = []): { draft?: Draft; error?: string; notices: string[] } {
  const platforms = [...new Set(Array.isArray(input.platforms) ? input.platforms : [])].filter((p): p is SocialPlatform => typeof p === 'string' && p in SOCIAL);
  const body = String(input.body || '').trim();
  const media = (Array.isArray(input.media) ? input.media : []).flatMap(m => {
    const url = String((m as Media)?.url || '');
    return /^https:\/\/\S+$/.test(url) ? [{ url, type: (m as Media).type === 'video' ? 'video' : 'image' } as Media] : [];
  }).slice(0, 10);
  const at = Date.parse(String(input.publish_at || ''));
  // Only for a chosen platform, trimmed; an empty one falls back to the shared text
  const raw = (input.overrides && typeof input.overrides === 'object' ? input.overrides : {}) as Record<string, unknown>;
  const overrides = Object.fromEntries(platforms.map(p => [p, String(raw[p] ?? '').trim()]).filter(([, v]) => v)) as Partial<Record<SocialPlatform, string>>;
  // Leen: nothing goes out without the named approver, so every post waits for approval (no auto mode)
  const mode = 'manual' as const;
  const notices = [...new Set([body, ...Object.values(overrides)].filter(Boolean))].flatMap(t => check(t as string, extra).map(notice));
  if (!platforms.length) return { error: 'اختر منصة وحدة على الأقل', notices };
  const videos = media.filter(m => m.type === 'video').length;
  if (videos > 1) return { error: 'فيديو واحد بس لكل منشور', notices };
  if (videos && media.length > 1) return { error: 'فيديو واحد أو صور، مو الاثنين مع بعض', notices };
  if (!body && !media.length && platforms.some(p => !overrides[p])) return { error: 'اكتب نص أو أضف صورة/فيديو', notices };
  if (!Number.isFinite(at)) return { error: 'حدد وقت النشر', notices };
  if (at < now - 60_000) return { error: 'وقت النشر راح', notices };
  for (const p of platforms) {
    const s = SOCIAL[p];
    const text = textFor({ body, overrides }, p);
    if (text.length > s.max) return { error: `نص ${s.name} أطول من حدها (${s.max} حرف)${overrides[p] ? '' : `: اكتب له نص خاص`}`, notices };
    if ('needsMedia' in s && s.needsMedia && !media.length) return { error: `${s.name} يحتاج صورة أو فيديو`, notices };
  }
  if (platforms.some(p => !SOCIAL[p].live)) notices.push('بعض المنصات المختارة ما ينشر لها تلقائي للحين، وبتنحفظ كتذكير.');
  return { draft: { platforms, body, media, publish_at: new Date(at).toISOString(), mode, ...(Object.keys(overrides).length ? { overrides } : {}) }, notices };
}

// Who may approve: the company's named approvers; none named = the owner only (checked when approving).
export const canApprove = (email: string, approvers: string[], owner: boolean): boolean =>
  approvers.length ? approvers.includes(email.toLowerCase()) : owner;

// A post goes out at its time only once approved. With named approvers, the approval must still be one of
// theirs when it is due (an approver removed meanwhile does not publish).
export const due = (p: { status: string; approved_at?: string | null; approved_by?: string | null; publish_at: string }, approvers: string[] = [], now = Date.now()) =>
  p.status === 'scheduled' && Date.parse(p.publish_at) <= now && !!p.approved_at
  && (!approvers.length || approvers.includes(String(p.approved_by || '').toLowerCase()));

export const cleanApprovers = (v: unknown): string[] =>
  [...new Set((Array.isArray(v) ? v : []).map(x => String(x || '').trim().toLowerCase()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))].slice(0, 10);

// Publishing, retries and the connection check talk to Meta: they live in Hoven's MCP server (src/mcp/adapters/meta-social.ts)
export { STALE_MS, VIDEO_WAIT_MS, readiness, publishOne, publishPost, outcomeOf, pending, stale, retryPlan, checkConnection,
  type Code, type Result, type Results, type Ctx, type Outcome, type Level, type Check, type Connection } from '../../mcp/adapters/meta-social';

// "اكتب لي نص": the post written by the social model (Grok when keyed) from what the user typed, within the
// shortest limit of the chosen platforms. Checked like any post; the user edits it before scheduling.
export function suggestPrompt(brief: string, platforms: SocialPlatform[]): string {
  const max = Math.min(...platforms.map(p => SOCIAL[p].max), 600);
  return `اكتب منشور سوشال بالسعودي لمتجر سعودي للمفارش والمنسوجات المنزلية، مخاطبة المذكر، للمنصات: ${platforms.map(p => SOCIAL[p].name).join('، ')}.
الفكرة: ${brief}
القواعد: جمل قصيرة، الفائدة قبل الميزة، دعوة واضحة للطلب من المتجر، بدون وعد ما يتثبت، بدون "الأفضل" أو "الوحيد"، بدون آراء عملاء ما لها مصدر، بدون سعر إلا لو موجود في المعرفة ومعه الإجمالي.
الحد ${max} حرف. رد بنص المنشور بس، بدون شرح وبدون علامات تنصيص.`;
}
export function cleanSuggestion(raw: string, platforms: SocialPlatform[]): string {
  const max = Math.min(...platforms.map(p => SOCIAL[p].max), 600);
  const t = String(raw || '').trim().replace(/^["«“]+|["»”]+$/g, '').replace(/^(المنشور|النص)\s*:\s*/, '').trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') : t;
}

// ---- Posting slots (docs/PRD.md §3.5): fixed times in the week, Riyadh time (UTC+3, no daylight saving). «الخانة الجاية»
// is the first slot after `now` that no scheduled post holds already.
export interface Slot { weekday: number; at: string }   // 0 = Sunday … 6 = Saturday; "HH:MM"
const RIYADH = 3 * 3600e3;
export const cleanSlots = (x: unknown): Slot[] => {
  const seen = new Set<string>();
  return (Array.isArray(x) ? x : []).flatMap(s => {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const weekday = Number(o['weekday']), at = String(o['at'] || '');
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(at) || seen.has(`${weekday} ${at}`)) return [];
    seen.add(`${weekday} ${at}`); return [{ weekday, at }];
  }).sort((a, b) => a.weekday - b.weekday || a.at.localeCompare(b.at)).slice(0, 42);
};
/** The next free slot after `now` within two weeks, as an ISO time; null when there are no slots. */
export function nextSlot(slots: Slot[], taken: string[], now = Date.now()): string | null {
  if (!slots.length) return null;
  const busy = new Set(taken.map(t => Math.round(Date.parse(t) / 60000)));
  const local = new Date(now + RIYADH), day0 = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  for (let d = 0; d < 15; d++) {
    const dayStart = day0 + d * 864e5, wd = new Date(dayStart).getUTCDay();
    for (const s of slots.filter(x => x.weekday === wd)) {
      const [h, m] = s.at.split(':').map(Number);
      const t = dayStart + (h! * 60 + m!) * 60000 - RIYADH;
      if (t > now + 60000 && !busy.has(Math.round(t / 60000))) return new Date(t).toISOString();
    }
  }
  return null;
}
