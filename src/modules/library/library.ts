// Library: reusable templates with {{variables}} and the documents the team keeps. Pure helpers (cleaning, rendering,
// the starter pack); the routes call them. Anything unfilled stays a visible [placeholder], never an invented value.
export const KINDS = { copy: 'كوبي', design: 'تصميم', voice: 'صوت', social: 'سوشال', other: 'أخرى' } as const;
export type Kind = keyof typeof KINDS;
export const STATUSES = { draft: 'مسودة', final: 'نهائي' } as const;
export type Status = keyof typeof STATUSES;

export interface Field { key: string; label: string; hint: string }
export interface Template { name: string; kind: Kind; category: string; description: string; body: string; fields: Field[]; lang: 'ar' | 'en'; favorite: boolean }
export interface Doc { title: string; kind: Kind; body: string; status: Status; folder_id: number | null; template_id: number | null; source: string }

const VAR = /\{\{\s*([a-z][a-z0-9_]{0,30})\s*\}\}/g;
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '');
const kindOf = (v: unknown, fallback: Kind = 'copy'): Kind => (typeof v === 'string' && v in KINDS ? (v as Kind) : fallback);

export const varsOf = (body: string): string[] => [...new Set([...body.matchAll(VAR)].map(m => m[1]!))];

// Fields follow the body: one per variable, keeping the labels the author gave
function fieldsFor(body: string, given: unknown): Field[] {
  const old = new Map((Array.isArray(given) ? given : []).filter((f): f is Record<string, unknown> => !!f && typeof f === 'object').map(f => [str(f.key, 31), f]));
  return varsOf(body).slice(0, 20).map(key => ({ key, label: str(old.get(key)?.label, 40) || key, hint: str(old.get(key)?.hint, 120) }));
}

export function cleanTemplate(input: Record<string, unknown>, prev?: Template): Template | { error: string } {
  const name = str(input.name ?? prev?.name, 80);
  const body = str(input.body ?? prev?.body, 4000);
  if (!name) return { error: 'اكتب اسم القالب' };
  if (!body) return { error: 'اكتب نص القالب' };
  return {
    name, body,
    kind: kindOf(input.kind, prev?.kind),
    category: str(input.category ?? prev?.category, 40),
    description: str(input.description ?? prev?.description, 300),
    fields: fieldsFor(body, input.fields ?? prev?.fields),
    lang: (input.lang ?? prev?.lang) === 'en' ? 'en' : 'ar',
    favorite: typeof input.favorite === 'boolean' ? input.favorite : !!prev?.favorite,
  };
}

// Values never carry the template syntax; empty ones stay as [label] so nothing is invented
export function render(t: Pick<Template, 'body' | 'fields'>, values: Record<string, unknown>): { text: string; missing: string[] } {
  const label = new Map(t.fields.map(f => [f.key, f.label]));
  const missing: string[] = [];
  const text = t.body.replace(VAR, (_, key: string) => {
    const v = str(values[key], 500).replace(/\{\{|\}\}/g, '');
    if (v) return v;
    if (!missing.includes(key)) missing.push(key);
    return `[${label.get(key) || key}]`;
  });
  return { text, missing };
}

export function cleanDoc(input: Record<string, unknown>, prev?: Doc): Doc | { error: string } {
  const body = str(input.body ?? prev?.body, 20000);
  const title = str(input.title ?? prev?.title, 120) || body.split('\n')[0]!.slice(0, 60);
  if (!title) return { error: 'اكتب عنوان أو نص' };
  const id = (v: unknown, old: number | null | undefined): number | null => (v === null ? null : Number.isInteger(v) && (v as number) > 0 ? (v as number) : (old ?? null));
  return {
    title, body,
    kind: kindOf(input.kind, prev?.kind),
    status: (input.status ?? prev?.status) === 'final' ? 'final' : 'draft',
    folder_id: id(input.folder_id, prev?.folder_id),
    template_id: id(input.template_id, prev?.template_id),
    source: str(input.source ?? prev?.source, 40),
  };
}

export const cleanFolder = (input: Record<string, unknown>): { name: string } | { error: string } => {
  const name = str(input.name, 60);
  return name ? { name } : { error: 'اكتب اسم المجلد' };
};

// Starter pack (source 'starter'): Saudi plain voice, each feature written as a problem that gets solved,
// price/offer/delivery as variables so they are filled from the store, never made up.
const T = (kind: Kind, category: string, name: string, description: string, body: string): Template =>
  ({ kind, category, name, description, body, fields: fieldsFor(body, []), lang: 'ar', favorite: false });
export const STARTER: Template[] = [
  T('copy', 'منتج', 'منتج: مشكلة وحل', 'كابشن لمنتج واحد، كل ميزة تنكتب كمشكلة تنحل', '{{problem}}؟ {{solution}}.\n{{product}}: {{feature}}.\n{{cta}}'),
  T('copy', 'إعلان', 'إعلان متجر', 'نص أساسي لإعلان ميتا: افتتاحية، فايدة، دعوة', '{{hook}}\n{{benefit}}\n{{offer}} {{price}}\n{{cta}}'),
  T('social', 'ستوري', 'ستوري قصير', 'سطرين على الستوري', '{{hook}}\n{{cta}}'),
  T('social', 'إنستقرام', 'كابشن إنستقرام', 'كابشن قصير مع دعوة', '{{hook}}\n\n{{body}}\n\n{{cta}}'),
  T('voice', 'صوت', 'نص فويس أوفر 15 ثانية', 'حوالي 2.3 كلمة بالثانية: 35 كلمة أو أقل', '{{hook}} {{benefit}} {{cta}}'),
  T('other', 'خدمة العملاء', 'رد على استفسار', 'رد ثابت على سؤال متكرر', 'هلا {{customer}}، {{answer}}. مدة التوصيل: {{delivery}}.'),
];
