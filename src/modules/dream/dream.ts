// «احلم» (docs/PRD.md §3.2): an idea becomes a campaign. Pure functions only (no I/O): the parts, what each part depends
// on, how a model's answer becomes a stored part, and when a project may be published.
// Each part is versioned: «عدّل» writes a new version, «اعتمد» locks one. A new version of a part marks the approved parts
// built on it as "needs update" (stale), so nothing is published on top of something that changed.
import { check, type Rule } from '../compliance/compliance';
import { FAMS, type Fam, type Goals } from '../buyer/engine';

export const PARTS = ['strategy', 'audience', 'budget', 'copy', 'design', 'motion', 'voiceover'] as const;
export type Part = typeof PARTS[number];
// The text parts come in this milestone; the media parts (design, motion, voiceover) need their own engines (milestone 4)
export const TEXT_PARTS: Part[] = ['strategy', 'audience', 'budget', 'copy'];
export const PART_AR: Record<Part, string> = { strategy: 'الاستراتيجية', audience: 'الجمهور', budget: 'الميزانية', copy: 'النصوص', design: 'التصاميم', motion: 'الموشن', voiceover: 'الفويس أوفر' };
export const DEPENDS: Record<Part, Part[]> = {
  strategy: [], audience: ['strategy'], budget: ['strategy', 'audience'], copy: ['strategy', 'audience'],
  design: ['copy'], motion: ['design', 'copy'], voiceover: ['copy'],
};
export const isPart = (x: unknown): x is Part => typeof x === 'string' && (PARTS as readonly string[]).includes(x);

export type Status = 'chatting' | 'drafting' | 'approved' | 'publishing' | 'published' | 'failed';
export interface PartRow { id: number; kind: Part; version: number; status: 'draft' | 'approved' | 'stale'; content: Record<string, unknown> }

/** The parts that must change state when `kind` gets a new version: approved parts built on it become stale. */
export function staleAfter(kind: Part): Part[] {
  const out = new Set<Part>();
  const walk = (k: Part) => { for (const p of PARTS) if (DEPENDS[p].includes(k) && !out.has(p)) { out.add(p); walk(p); } };
  walk(kind);
  return [...out];
}

/** The newest version of each part. */
export function latest(rows: PartRow[]): Partial<Record<Part, PartRow>> {
  const out: Partial<Record<Part, PartRow>> = {};
  for (const r of rows) if (!out[r.kind] || out[r.kind]!.version < r.version) out[r.kind] = r;
  return out;
}

/** What is missing before «انشر»: every needed part's newest version approved (text parts now; media parts once they exist). */
export function missing(rows: PartRow[], need: Part[] = TEXT_PARTS): Part[] {
  const l = latest(rows);
  return need.filter(k => l[k]?.status !== 'approved');
}

// ---- Turning a model's answer into a part. Models are asked for one JSON object; anything else is dropped or capped.
const str = (x: unknown, max = 400) => String(x ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const num = (x: unknown, max = 1e7) => { const v = Number(x); return Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 100) / 100 : null; };
const arr = (x: unknown, n: number) => (Array.isArray(x) ? x.slice(0, n) : []);
const obj = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});
const fam = (x: unknown): Fam | null => { const f = str(x, 20).toLowerCase(); return (FAMS as string[]).includes(f) ? f as Fam : null; };

/** The JSON object in a model's answer (```json fences and text around it allowed). */
export function parseJson(text: string): Record<string, unknown> | null {
  const t = text.replace(/```(?:json)?/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { const v = JSON.parse(t.slice(a, b + 1)) as unknown; return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null; } catch { return null; }
}

export interface Ctx { goals: Goals; platforms: Fam[]; rules?: Rule[] }

/** A model's answer for one text part → the stored content, with the guardrails applied (budget caps, compliance notices). */
export function cleanPart(kind: Part, raw: Record<string, unknown>, ctx: Ctx): Record<string, unknown> | null {
  const on = (f: Fam | null): f is Fam => !!f && (!ctx.platforms.length || ctx.platforms.includes(f));
  if (kind === 'strategy') {
    const out = { goal: str(raw['goal']), message: str(raw['message']), kpi: str(raw['kpi'], 200), offer: str(raw['offer'], 300),
      phases: arr(raw['phases'], 6).map(p => ({ name: str(obj(p)['name'], 80), days: num(obj(p)['days'], 365), focus: str(obj(p)['focus'], 300) })).filter(p => p.name) };
    return out.goal || out.message ? out : null;
  }
  if (kind === 'audience') {
    const segments = arr(raw['segments'], 12).map(s => { const o = obj(s); return { platform: fam(o['platform']), name: str(o['name'], 120), age: str(o['age'], 40), gender: str(o['gender'], 40),
      regions: arr(o['regions'], 12).map(r => str(r, 60)).filter(Boolean), interests: arr(o['interests'], 15).map(r => str(r, 60)).filter(Boolean), notes: str(o['notes'], 300) }; })
      .filter(s => on(s.platform) && s.name);
    return segments.length ? { segments } : null;
  }
  if (kind === 'budget') {
    const notes: string[] = [];
    const split = arr(raw['split'], 8).map(s => { const o = obj(s); return { platform: fam(o['platform']), daily: num(o['daily']) }; })
      .filter((s): s is { platform: Fam; daily: number } => on(s.platform) && s.daily != null && s.daily > 0)
      .map(s => {
        // Never above Leen's planned daily budget for the platform (buyer goals): capped, and said so
        const cap = ctx.goals[s.platform]?.dailyBudget;
        if (cap && s.daily > cap) { notes.push(`ميزانية ${s.platform} اليومية نزلت من ${s.daily} إلى ${cap} (حد أهدافك)`); return { ...s, daily: cap }; }
        return s;
      });
    if (!split.length) return null;
    const days = num(raw['days'], 120) || 14, daily = Math.round(split.reduce((t, s) => t + s.daily, 0) * 100) / 100;
    return { split, daily, days, total: Math.round(daily * days * 100) / 100, learning: str(raw['learning'], 400), notes,
      // No goals for a platform: Leen types the budget herself before «انشر» (docs/PRD.md §3.2)
      needsOwner: split.filter(s => !ctx.goals[s.platform]?.dailyBudget).map(s => s.platform) };
  }
  if (kind === 'copy') {
    const items = arr(raw['items'], 20).map(i => { const o = obj(i); return { platform: fam(o['platform']), format: str(o['format'], 40), headline: str(o['headline'], 120), body: str(o['body'], 1200), cta: str(o['cta'], 40) }; })
      .filter(i => on(i.platform) && (i.headline || i.body))
      .map(i => ({ ...i, notices: check(`${i.headline}\n${i.body}\n${i.cta}`, ctx.rules || []).map(h => ({ level: h.level, title: h.title, fix: h.fix, match: h.match })) }));
    return items.length ? { items } : null;
  }
  return null;
}

export const cleanPlatforms = (x: unknown): Fam[] => [...new Set(arr(x, 8).map(fam).filter((f): f is Fam => !!f))];
export const cleanTitle = (x: unknown) => str(x, 120);
export const cleanIdea = (x: unknown) => str(x, 4000);
