// One adapter for the text models, so each tab names a provider and the rest stays the same.
// Leen's choice: Content + Design + the motion video plan (Maestro's video page) → OpenAI; Social, Maestro and Listening → Grok (xAI). Voice and the rest stay on Workers AI.
// PAID: OpenAI and Grok (xAI) bill every call; so does the Debugger's Claude (Anthropic SDK, src/modules/debugger/explain.ts).
// Workers AI is free within Cloudflare's daily limit and stays the fallback when a key is missing or the provider fails.
// OpenRouter (OPENROUTER_API_KEY) is one key for every model: when it is set it is used for all the text tabs and for images, ahead of the
// per-provider keys below (which stay as they are for Listening's live X search and when it is not set).
// Keys are Worker secrets Leen adds herself: OPENROUTER_API_KEY, OPENAI_API_KEY, XAI_API_KEY (docs/secrets/worker.env.example).
// Model ids from the providers' model pages (2026-11-03); change them with OPENAI_MODEL / XAI_MODEL, no code change.
import { AI_MODEL, type AiRun } from '../modules/content/content';

export type Provider = 'openrouter' | 'openai' | 'xai' | 'workers';
export interface LlmEnv { OPENROUTER_API_KEY?: string; OPENROUTER_MODEL?: string; OPENROUTER_IMAGE_MODEL?: string; OPENAI_API_KEY?: string; OPENAI_MODEL?: string; OPENAI_IMAGE_MODEL?: string; XAI_API_KEY?: string; XAI_MODEL?: string; AI?: { run: AiRun } }
export type Msg = { role: string; content: string };
export interface LlmInput { messages: Msg[]; max_tokens: number; response_format?: unknown; search?: ('web' | 'x')[] }
export interface LlmOut { response: string; engine: Provider; model: string }

export const DEFAULTS = { openrouter: 'openrouter/auto', openrouterImage: 'openai/gpt-image-1', openai: 'gpt-6.1-sol', xai: 'grok-4.7', image: 'gpt-image-2' } as const;
export const PROVIDER: Record<string, Provider> = { content: 'openai', design: 'openai', copy: 'openai', motion: 'openai', social: 'xai', maestro: 'xai', listening: 'xai' };
const URL_OF = { openrouter: 'https://openrouter.ai/api/v1/chat/completions', openai: 'https://api.openai.com/v1/responses', xai: 'https://api.x.ai/v1/responses' } as const;
export const OPENROUTER_IMAGES = 'https://openrouter.ai/api/v1/images';
const clean = (s: string | undefined) => (s || '').replace(/[^a-z0-9.\-_:]/gi, '').slice(0, 80);
// OpenRouter model slugs are vendor/model[:variant], so the slash stays
const slug = (s: string | undefined) => (s || '').replace(/[^a-z0-9.\-_:/]/gi, '').slice(0, 100);

// The provider a tab would use now: its own if the key is there, else Workers AI if bound, else none
export function pick(e: LlmEnv, module: string): { provider: Provider; model: string } | null {
  // OpenRouter wins for every tab. OPENROUTER_MODEL_<TAB> (e.g. OPENROUTER_MODEL_COPY) sets one tab's model, else OPENROUTER_MODEL.
  if (e.OPENROUTER_API_KEY) return { provider: 'openrouter', model: slug((e as Record<string, unknown>)[`OPENROUTER_MODEL_${module.toUpperCase()}`] as string | undefined) || slug(e.OPENROUTER_MODEL) || DEFAULTS.openrouter };
  const p = PROVIDER[module] || 'workers';
  if (p === 'openai' && e.OPENAI_API_KEY) return { provider: 'openai', model: clean(e.OPENAI_MODEL) || DEFAULTS.openai };
  if (p === 'xai' && e.XAI_API_KEY) return { provider: 'xai', model: clean(e.XAI_MODEL) || DEFAULTS.xai };
  return e.AI ? { provider: 'workers', model: AI_MODEL } : null;
}

// Responses API body (OpenAI and xAI share it). JSON schemas go to OpenAI's text.format; Grok gets the JSON ask in the prompt.
export function body(provider: 'openai' | 'xai', model: string, i: LlmInput): Record<string, unknown> {
  const out: Record<string, unknown> = { model, input: i.messages, max_output_tokens: i.max_tokens };
  const rf = i.response_format as { type?: string; json_schema?: unknown } | undefined;
  if (provider === 'openai' && rf?.type === 'json_schema' && rf.json_schema) out.text = { format: { type: 'json_schema', name: 'answer', schema: rf.json_schema, strict: false } };
  if (provider === 'xai' && i.search?.length) out.tools = i.search.map(s => ({ type: s === 'x' ? 'x_search' : 'web_search' }));
  return out;
}

// Chat Completions body (OpenRouter). The JSON ask stays in the prompt, as for Grok: many models refuse structured outputs.
// 'web' search goes through OpenRouter's web plugin; X search has no equivalent there.
export function chatBody(model: string, i: LlmInput): Record<string, unknown> {
  const out: Record<string, unknown> = { model, messages: i.messages, max_tokens: i.max_tokens };
  if (i.search?.includes('web')) out.plugins = [{ id: 'web' }];
  return out;
}
export function chatText(j: unknown): string {
  const c = ((j || {}) as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  return Array.isArray(c) ? c.map(x => (x && typeof x === 'object' && typeof (x as { text?: unknown }).text === 'string' ? (x as { text: string }).text : '')).join('') : '';
}
const HEADERS = (key: string | undefined): Record<string, string> => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Hoven' });

// The answer text: output_text when present, else the output_text parts of the message items
export function textOf(j: unknown): string {
  const o = (j || {}) as { output_text?: unknown; output?: { type?: string; content?: { type?: string; text?: string }[] }[] };
  if (typeof o.output_text === 'string') return o.output_text;
  return (o.output || []).filter(x => x.type === 'message').flatMap(x => x.content || []).filter(c => c.type === 'output_text').map(c => c.text || '').join('');
}

export async function generate(e: LlmEnv, module: string, i: LlmInput, f: typeof fetch = fetch): Promise<LlmOut> {
  const p = pick(e, module);
  if (!p) throw new Error('no_model');
  if (p.provider !== 'workers') {
    const key = p.provider === 'openrouter' ? e.OPENROUTER_API_KEY : p.provider === 'openai' ? e.OPENAI_API_KEY : e.XAI_API_KEY;
    try {
      const r = await f(URL_OF[p.provider], { method: 'POST', headers: HEADERS(key), body: JSON.stringify(p.provider === 'openrouter' ? chatBody(p.model, i) : body(p.provider, p.model, i)) });
      if (r.ok) {
        const j = await r.json();
        const text = (p.provider === 'openrouter' ? chatText(j) : textOf(j)).trim();
        if (text) return { response: text, engine: p.provider, model: p.model };
        console.warn('llm_empty', p.provider);
      } else console.warn('llm_failed', p.provider, r.status);   // the status only: the body may echo the request
    } catch (err) { console.warn('llm_failed', p.provider, (err as Error).message); }
    if (!e.AI) throw new Error('llm_failed');
  }
  const out = await e.AI!.run(AI_MODEL, { messages: i.messages, max_tokens: i.max_tokens, ...(i.response_format ? { response_format: i.response_format } : {}) });
  const r = (out as { response?: unknown })?.response;
  return { response: typeof r === 'string' ? r : r ? JSON.stringify(r) : '', engine: 'workers', model: AI_MODEL };
}

// Same shape as Workers AI's run(), for code written against it. The model argument is ignored: the tab decides.
export const aiFor = (e: LlmEnv, module: string): AiRun | undefined =>
  pick(e, module) ? (...a) => generate(e, module, a[1]) : undefined;

// Grok with live search (Listening). PAID: tokens, plus $5 per 1,000 web searches and X billed per post fetched (xAI pricing).
// Never falls back: a model without search would make the posts up.
export async function grokSearch(e: LlmEnv, messages: Msg[], sources: ('web' | 'x')[], max_tokens: number, f: typeof fetch = fetch): Promise<string | null> {
  if (!e.XAI_API_KEY) return null;
  try {
    const r = await f(URL_OF.xai, { method: 'POST', headers: { authorization: `Bearer ${e.XAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body('xai', clean(e.XAI_MODEL) || DEFAULTS.xai, { messages, max_tokens, search: sources })) });
    if (!r.ok) { console.warn('grok_search_failed', r.status); return null; }
    return textOf(await r.json());
  } catch (err) { console.warn('grok_search_failed', (err as Error).message); return null; }
}

// Images from OpenAI's Images API (the design tab). PAID per image (more for higher quality and size).
// With a product photo it is an edit: the product kept, a new scene around it. Without one, a new background.
// No fallback: Workers AI has no image model we use. Returns a data: URL, or null with the reason logged.
export async function openaiImage(e: LlmEnv, prompt: string, f: typeof fetch = fetch, product?: { bytes: Uint8Array<ArrayBuffer>; mime: string }, size: '1024x1536' | '1536x1024' = '1024x1536'): Promise<string | null> {
  if (!e.OPENAI_API_KEY) return null;
  const model = clean(e.OPENAI_IMAGE_MODEL) || DEFAULTS.image, opts = { size, quality: 'medium', output_format: 'jpeg' };
  try {
    let r: Response;
    if (product) {
      const form = new FormData();
      form.append('model', model); form.append('prompt', prompt); form.append('n', '1');
      for (const [k, v] of Object.entries(opts)) form.append(k, v);
      form.append('image', new Blob([product.bytes], { type: product.mime }), `product.${{ 'image/png': 'png', 'image/webp': 'webp' }[product.mime] ?? 'jpg'}`);
      r = await f('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { authorization: `Bearer ${e.OPENAI_API_KEY}` }, body: form });
    } else {
      r = await f('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { authorization: `Bearer ${e.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt, n: 1, ...opts }) });
    }
    if (!r.ok) { console.warn('image_failed', product ? 'edit' : 'new', r.status); return null; }
    const b64 = ((await r.json()) as { data?: { b64_json?: string }[] })?.data?.[0]?.b64_json;
    return b64 ? `data:image/jpeg;base64,${b64}` : null;
  } catch (err) { console.warn('image_failed', (err as Error).message); return null; }
}

// Images from OpenRouter's Images API: one call, with the product photo as an input reference when there is one (an edit that
// keeps the product). PAID per image, at the chosen model's price. Returns a data: URL, or null with the reason logged.
const b64 = (bytes: Uint8Array): string => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
export async function openrouterImage(e: LlmEnv, prompt: string, f: typeof fetch = fetch, product?: { bytes: Uint8Array<ArrayBuffer>; mime: string }, size: '1024x1536' | '1536x1024' = '1024x1536'): Promise<string | null> {
  if (!e.OPENROUTER_API_KEY) return null;
  const model = slug(e.OPENROUTER_IMAGE_MODEL) || DEFAULTS.openrouterImage;
  const req: Record<string, unknown> = { model, prompt, n: 1, aspect_ratio: size === '1536x1024' ? '3:2' : '2:3', quality: 'medium', output_format: 'jpeg' };
  if (product) req.input_references = [{ type: 'image_url', image_url: { url: `data:${product.mime};base64,${b64(product.bytes)}` } }];
  try {
    const r = await f(OPENROUTER_IMAGES, { method: 'POST', headers: HEADERS(e.OPENROUTER_API_KEY), body: JSON.stringify(req) });
    if (!r.ok) { console.warn('image_failed', 'openrouter', r.status); return null; }
    const d = ((await r.json()) as { data?: { b64_json?: string; media_type?: string }[] })?.data?.[0];
    return d?.b64_json ? `data:${d.media_type && /^image\/(jpeg|png|webp)$/.test(d.media_type) ? d.media_type : 'image/jpeg'};base64,${d.b64_json}` : null;
  } catch (err) { console.warn('image_failed', 'openrouter', (err as Error).message); return null; }
}

// Which image service is on: OpenRouter first, else OpenAI directly, else none
export const canDraw = (e: LlmEnv): boolean => !!(e.OPENROUTER_API_KEY || e.OPENAI_API_KEY);
export const drawImage = (e: LlmEnv, prompt: string, f: typeof fetch = fetch, product?: { bytes: Uint8Array<ArrayBuffer>; mime: string }, size: '1024x1536' | '1536x1024' = '1024x1536'): Promise<string | null> =>
  e.OPENROUTER_API_KEY ? openrouterImage(e, prompt, f, product, size) : openaiImage(e, prompt, f, product, size);
