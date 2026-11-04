// Product studio: the product photo (from the Salla CDN or an upload) kept as it is, a new realistic scene around it,
// and the text as a flat layer on top. The rules come from the HOVEN design skill: full-frame photo, new scene every
// time, no gold, no AI haze, no cultural symbols, nothing written inside the picture, flat text with no box.
export const STUDIO_SIZES = {
  feed: { ar: 'بوست 4:5', w: 1080, h: 1350, image: '1024x1536', safeTop: 0, safeBottom: 0 },
  story: { ar: 'ستوري 9:16', w: 1080, h: 1920, image: '1024x1536', safeTop: 210, safeBottom: 210 },
  x: { ar: 'غلاف X 16:9', w: 1600, h: 900, image: '1536x1024', safeTop: 0, safeBottom: 0 },
} as const;
export type StudioSize = keyof typeof STUDIO_SIZES;

export const SCENES = {
  bedroom: ['غرفة نوم رئيسية', 'a calm master bedroom with a made bed'],
  kids: ['غرفة أطفال', 'a tidy children\'s bedroom with a made bed'],
  guest: ['غرفة ضيوف', 'a quiet guest room with a made bed'],
  hotel: ['سويت فندقي', 'a simple hotel suite with a made bed'],
} as const;
export type Scene = keyof typeof SCENES;

// The brand palette (skill): black, beige, navy, dark green, white. Text is one flat colour from it.
export const TEXT_COLORS = { dark: '#141414', light: '#FFFFFF', navy: '#293342', green: '#294036' } as const;
export type Tone = keyof typeof TEXT_COLORS;

export function scenePrompt(scene: Scene, size: StudioSize, withProduct: boolean, note = ''): string {
  const frame = size === 'x' ? 'wide 16:9' : size === 'story' ? 'vertical 9:16' : 'portrait 4:5';
  return [
    withProduct ? 'Keep the product in this photo exactly as it is: same fabric, stitching, colour and number of pieces. Use the photo for the product only, not for the room or the accessories. Build a new scene around it.' : '',
    `Realistic full-frame photograph, ${frame}, edge to edge, no bars, borders or empty margins. Setting: ${SCENES[scene][1]}.`,
    'Compose it so the product sits in the lower two-thirds and the top third is a calm, simple area (plain wall or soft surface) where text will go. Never put text space over the product.',
    'Neutral daylight. Neutral palette of beige, cream, navy and dark green. No gold, brass, copper or amber objects, no golden or warm-amber lighting, no warm colour grade.',
    'No AI look: no glow, no bloom, no milky haze, no plastic or waxy surfaces. Natural folds with the weight of real fabric.',
    'No cultural symbols (no dallah, sadu, lanterns, crescent or heritage patterns), nothing the product photo itself does not show.',
    'No text, letters, numbers, logos, badges or watermarks anywhere in the picture.',
    note ? `Extra direction: ${note.slice(0, 200)}` : '',
  ].filter(Boolean).join('\n');
}

// Where the page puts the text. Fixed coordinates (fractions of the frame), flat: one colour, no box, no shadow, no stroke,
// no gradient. RTL, right aligned. In 9:16 the platform's top and bottom 210 px are left empty.
export function overlaySpec(size: StudioSize, tone: Tone = 'dark') {
  const s = STUDIO_SIZES[size];
  const top = Math.max(0.07, s.safeTop / s.h + 0.03);
  return {
    size: { w: s.w, h: s.h },
    color: TEXT_COLORS[tone],
    zone: { x: 0.07, y: top, w: 0.86, h: size === 'x' ? 0.5 : 0.26 },
    align: 'right' as const, direction: 'rtl' as const,
    title: { px: Math.round(s.w * (size === 'x' ? 0.05 : 0.066)), weight: 700 },
    sub: { px: Math.round(s.w * (size === 'x' ? 0.026 : 0.036)), weight: 400 },
    cta: { px: Math.round(s.w * (size === 'x' ? 0.022 : 0.032)), weight: 400 },
    flat: { box: false, shadow: false, stroke: 0, gradient: false, italic: false, letterSpacing: 0 },
    logo: { corner: 'top-left' as const, maxWidthRatio: 0.22 },
  };
}

// ---- Product photo from the Salla CDN (so nobody downloads and re-uploads it). Only Salla's image hosts, https,
// no redirects, a real image and a size limit: the Worker never fetches an address a user chose freely.
export const SALLA_HOSTS = ['cdn.salla.sa', 'cdn.files.salla.network', 'cdn.salla.network'];
const MIMES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_PHOTO = 2_000_000;

export function sallaImageUrl(raw: unknown): URL | null {
  try {
    const u = new URL(String(raw || '').trim());
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && SALLA_HOSTS.includes(u.hostname) ? u : null;
  } catch { return null; }
}

export async function fetchSallaImage(raw: unknown, f: typeof fetch = fetch): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string } | { error: string }> {
  const u = sallaImageUrl(raw);
  if (!u) return { error: 'الرابط لازم يكون صورة من سلة (cdn.salla.sa)' };
  let r: Response;
  try { r = await f(u.toString(), { redirect: 'error', headers: { accept: 'image/*' } }); } catch { return { error: 'ما قدرت أجيب الصورة من سلة' }; }
  const mime = (r.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase();
  if (!r.ok || !MIMES.includes(mime)) return { error: 'الرابط مو صورة (JPEG أو PNG أو WebP)' };
  if (Number(r.headers.get('content-length') || 0) > MAX_PHOTO) return { error: 'الصورة كبيرة (الحد 2 ميقا)' };
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > MAX_PHOTO) return { error: 'الصورة كبيرة (الحد 2 ميقا)' };
  return { bytes: buf, mime };
}
