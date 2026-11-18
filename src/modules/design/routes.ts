// /api/design/brief: brief + headline variants from our best ads, and a ChatGPT background when no photo is given. Writes nothing.
// /api/design/videos|videofile|video|videoedit|videoapprove: the «موشن جرافيك» type (motion projects and their versions).
import { json, readJson, handle, requireUser, audit } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { readAll } from '../../lib/paging';
import { type AiRun } from '../content/content';
import { generate, drawImage, canDraw, pick, type LlmEnv } from '../../lib/llm';
import { usageCtx } from '../../lib/usage';
import { knowledgeFor, withKnowledge, loadKnowledge, forbiddenRules } from '../knowledge/knowledge';
import { guard, meter } from '../../lib/quotas';
import { brandFor, serveFile } from '../knowledge/brand';
import { STUDIO_SIZES, SCENES, TEXT_COLORS, scenePrompt, overlaySpec, fetchSallaImage, type StudioSize, type Scene, type Tone } from './studio';
import { check, notice } from '../compliance/compliance';
import { SIZES, TYPES, VISION_MODEL, VISION_PROMPT, backgroundPrompt, images, productPhoto, variantsFrom, prompt, stylePrompt, templates, winners, type AdIn, type MetIn } from './design';

// Vision stays on Workers AI (free); the copy is written by OpenAI when OPENAI_API_KEY is set (src/lib/llm.ts)
type AiEnv = Omit<LlmEnv, 'AI'> & { AI?: { run: AiRun & ((model: string, input: { image: number[]; prompt: string; max_tokens: number }) => Promise<unknown>) } };

// The company's active brand (المعرفة ← الهوية والبصريات) comes with the options, so the page uses it without uploads
export const options = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'design');
  return json(200, { sizes: SIZES, types: TYPES, brand: await brandFor(cfg, user.co) });
}) };

// An active brand file (logo, font, reference image) for the design page; inactive ones stay hidden here
export const brandfile = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'design');
  return serveFile(cfg, user.co, parseInt(new URL(request.url).searchParams.get('id') || '', 10) || 0, (e as { FILES?: R2Bucket }).FILES, true);
}) };

export const brief = { POST: handle(async (request, e: AiEnv & Parameters<typeof requireUser>[1]) => {
  const { cfg, user } = await requireUser(request, e, 'design', { write: true });
  if (pick(e, 'design')) { const over = await guard(cfg, user, 'text'); if (over) return over; await meter(cfg, user, 'design', 'text'); }
  // Up to 5 small images (product + 4 references, each capped in images()) and the product at 1024 px ride in this body
  const b = await readJson(request, 3_200_000);
  const input = { type: String(b.type || 'ad'), offer: String(b.offer || '').slice(0, 200), audience: String(b.audience || '').slice(0, 200), dept: String(b.dept || '').slice(0, 60) };
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [ads, metrics] = await Promise.all([
    readAll<AdIn>(cfg, scoped('/rest/v1/ads?select=ad_key,platform,name,format,goal,text:doc->>text&goal=eq.lead', user.co), 'ad_key.asc', 3),
    readAll<MetIn>(cfg, `/rest/v1/ad_metrics?select=ad_key,spend,leads,clicks,impressions&day=gte.${since}`, 'ad_key.asc,day.asc', 8),
  ]);
  const ref = winners(ads.rows, metrics.rows);
  let variants = templates(input.offer, input.audience), engine = 'templates', style = '';
  // Product photo and references: described by Workers AI vision, then used by the copy model. Not stored anywhere.
  const pics = images(b.images), looks = { product: [] as string[], refs: [] as string[] };
  if (e.AI && pics.length) {
    const said = await Promise.all(pics.map(p => e.AI!.run(VISION_MODEL, { image: p.bytes, prompt: VISION_PROMPT, max_tokens: 90 })
      .then(o => String((o as { description?: unknown; response?: unknown })?.description ?? (o as { response?: unknown })?.response ?? '').trim()).catch(() => '')));
    pics.forEach((p, i) => { const t = (said[i] || '').slice(0, 300); if (t) (p.kind === 'product' ? looks.product : looks.refs).push(t); });
  }
  // No references sent this time: the brand's approved reference images (described once, at upload) and colours
  const brand = await brandFor(cfg, user.co);
  if (!looks.refs.length) looks.refs.push(...brand.notes);
  if (brand.colors.length) looks.refs.push(`ألوان العلامة: ${brand.colors.join(' ')}`);
  if (pick(e, 'design') && (looks.product.length || looks.refs.length)) {
    try { style = (await generate(e, 'design', { messages: [{ role: 'user', content: stylePrompt(looks) }], max_tokens: 160 }, fetch, usageCtx(cfg, user))).response.trim().slice(0, 400); } catch { /* notes are optional */ }
  }
  // ChatGPT draws the picture (OpenAI Images, PAID per image) while the text is written: the product photo put in a
  // new scene when one is given, else a new background
  const hd = productPhoto(b.product);
  const drawing = canDraw(e) ? drawImage(e, backgroundPrompt(input, brand.colors, style, !!hd), fetch, hd ?? undefined) : Promise.resolve(null);
  if (pick(e, 'design')) {
    try {
      const out = await generate(e, 'design', { messages: withKnowledge([{ role: 'user', content: prompt(input, ref.hooks, looks) }], await knowledgeFor(cfg, user.co, 'design')), max_tokens: 700 }, fetch, usageCtx(cfg, user));
      // parseVariants keeps only well-formed variants (length-capped, compliance-flagged) and falls back to the templates
      const got = variantsFrom(out.response);
      if (got.length) { variants = got; engine = out.engine === 'workers' ? 'workers-ai' : out.engine; }
    } catch { /* templates stay */ }
  }
  const image = await drawing;
  return json(200, { input, reference: ref, variants, engine, sizes: SIZES, style, image, images: { product: looks.product.length, refs: looks.refs.length, sent: pics.length } });
}) };

// «موشن جرافيك»: the video projects of this tab (src/modules/design/video.ts)
export { videos, videofile, video, videoedit, videoapprove } from './video';

// «الاستوديو»: the product photo (Salla CDN link or an upload) in a new scene by the Hoven rules, and where the flat text goes.
// The picture needs the image model (OPENROUTER_API_KEY, or OPENAI_API_KEY; paid per image); without it the page still lays the text on a photo you give it.
export const studio = { POST: handle(async (request, e: AiEnv & Parameters<typeof requireUser>[1]) => {
  const { cfg, user } = await requireUser(request, e, 'design', { write: true });
  const b = await readJson(request, 3_200_000);
  const size: StudioSize = String(b.size) in STUDIO_SIZES ? (String(b.size) as StudioSize) : 'feed';
  const scene: Scene = String(b.scene) in SCENES ? (String(b.scene) as Scene) : 'bedroom';
  const tone: Tone = String(b.tone) in TEXT_COLORS ? (String(b.tone) as Tone) : 'dark';
  const text = { title: String(b.title || '').trim().slice(0, 80), sub: String(b.sub || '').trim().slice(0, 120), cta: String(b.cta || '').trim().slice(0, 40) };
  let photo: { bytes: Uint8Array<ArrayBuffer>; mime: string } | null = null;
  if (b.product_url) {
    const got = await fetchSallaImage(b.product_url);
    if ('error' in got) return json(400, { error: got.error });
    photo = got;
  } else photo = productPhoto(b.product);
  const prompt = scenePrompt(scene, size, !!photo, String(b.note || ''));
  const notes = check([text.title, text.sub, text.cta].filter(Boolean).join('\n'), forbiddenRules(await loadKnowledge(cfg, user.co))).map(notice);
  const image = canDraw(e) ? await drawImage(e, prompt, fetch, photo ?? undefined, STUDIO_SIZES[size].image) : null;
  await audit(cfg, user, 'design_studio', { target: { size, scene, product: photo ? 'photo' : 'none', image: !!image } });
  return json(200, { image, reason: image ? null : canDraw(e) ? 'image_failed' : 'no_image_model', prompt, overlay: overlaySpec(size, tone), text, notes });
}) };
