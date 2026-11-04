// الاستوديو: صورة المنتج في مشهد جديد، والنص طبقة مسطحة فوقها حسب الإحداثيات الثابتة من السيرفر. كله على canvas، والتحميل PNG.
import { $, api, say, esc, shell, busy } from '/assets/common.js';

let fontReady = null;
const font = () => (fontReady ||= Promise.all([
  new FontFace('HovenStudio', 'url(/assets/fonts/ibmplexsansarabic-bold.woff2)', { weight: '700' }).load(),
  new FontFace('HovenStudio', 'url(/assets/fonts/ibmplexsansarabic-regular.woff2)', { weight: '400' }).load(),
]).then(fs => fs.forEach(f => document.fonts.add(f))).catch(() => {}));

const picture = url => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
function lines(ctx, text, max) {
  const out = []; let cur = '';
  for (const w of String(text || '').split(/\s+/).filter(Boolean)) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > max && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur);
  return out;
}

// Photo (cover), then the text: one flat colour, no box, no shadow, no gradient. Right aligned (RTL) inside the zone.
function draw(canvas, spec, text, img, logo) {
  const { w: W, h: H } = spec.size;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#F2F0E3'; ctx.fillRect(0, 0, W, H);
  if (img) { const s = Math.max(W / img.width, H / img.height), w = img.width * s, h = img.height * s; ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); }
  const z = { x: spec.zone.x * W, y: spec.zone.y * H, w: spec.zone.w * W, h: spec.zone.h * H };
  ctx.direction = spec.direction; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = spec.color;
  let y = z.y;
  for (const [key, gap] of [['title', 1.25], ['sub', 1.5], ['cta', 1.5]]) {
    const t = text[key]; if (!t) continue;
    const f = spec[key]; ctx.font = `${f.weight} ${f.px}px HovenStudio, sans-serif`;
    for (const l of lines(ctx, t, z.w)) { y += f.px * (key === 'title' ? 1.0 : 0.95); if (y > z.y + z.h) return; ctx.fillText(l, z.x + z.w, y); y += f.px * (gap - 1); }
    y += f.px * 0.5;
  }
  if (logo) { const lw = W * spec.logo.maxWidthRatio, lh = lw * (logo.height / logo.width); ctx.drawImage(logo, W * 0.07, Math.max(H * 0.04, 24), lw, lh); }
}

export default async function mount() {
  let IMG = null, LOGO = null, SPEC = null, TEXT = null;
  const redraw = () => { if (SPEC) { draw($('#cv'), SPEC, TEXT, IMG, LOGO); $('#dl').disabled = !IMG; } };

  const me = await shell({ active: 'design', title: 'استوديو المنتج' }).catch(() => null);
  void me; await font();
  try { const b = (await api('/api/design/options')).brand; if (b?.logo) LOGO = await picture(`/api/design/brandfile?id=${b.logo}`).catch(() => null); } catch { /* no brand yet */ }

  $('#file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = async () => { IMG = await picture(r.result).catch(() => null); redraw(); }; r.readAsDataURL(f);
  };
  // The product photo goes to the server as a data URL (1024 px, JPEG) only when it was uploaded; a Salla link is fetched there
  const shrink = img => { const s = Math.min(1, 1024 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.9); };

  $('#sf').addEventListener('submit', async e => {
    e.preventDefault(); const btn = e.submitter; busy(btn, true); say($('#msg'), '');
    try {
      const url = $('#url').value.trim();
      const body = { size: $('#size').value, scene: $('#scene').value, tone: $('#tone').value, title: $('#title').value, sub: $('#sub').value, cta: $('#cta').value, note: $('#note').value };
      if (url) body.product_url = url; else if (IMG) body.product = shrink(IMG);
      const r = await api('/api/design/studio', { method: 'POST', body });
      SPEC = r.overlay; TEXT = r.text;
      if (r.image) IMG = await picture(r.image);
      else if (url && !IMG) IMG = await picture(url).catch(() => null);
      $('#prompt').textContent = r.prompt;
      $('#notes').innerHTML = [...(r.reason === 'no_image_model' ? ['ما فيه موديل صور مربوط، فالمشهد ما انولّد. النص انحط على الصورة اللي عندك، والبرومبت تحت.'] : r.reason === 'image_failed' ? ['موديل الصور ما رد. جرّب مرة ثانية.'] : []), ...r.notes].map(n => `<div class="st-note">${esc(n)}</div>`).join('');
      redraw(); if (r.image) say($('#msg'), 'جاهز.', true);
    } catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  });
  for (const id of ['title', 'sub', 'cta', 'tone']) $('#' + id).addEventListener('input', () => { if (SPEC) { TEXT = { title: $('#title').value, sub: $('#sub').value, cta: $('#cta').value }; SPEC = { ...SPEC, color: { dark: '#141414', light: '#FFFFFF', navy: '#293342', green: '#294036' }[$('#tone').value] }; redraw(); } });
  $('#dl').onclick = () => { const a = document.createElement('a'); a.download = 'hoven-studio.png'; a.href = $('#cv').toDataURL('image/png'); a.click(); };
}
