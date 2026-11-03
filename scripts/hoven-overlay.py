#!/usr/bin/env python3
"""Re-applies Hoven's own changes on files taken from Well (leen-saz/well-ads) after an upstream sync.

Usage: python3 scripts/hoven-overlay.py [files...]   (no args = every file this script knows about)
Idempotent: running it twice changes nothing. Each rule is a plain text or regex replacement, so a rule that no
longer matches is reported, never applied blindly. Name/colour/font rewrites live in .upstream/well-to-hoven.pl;
this file holds the content changes (sales wording, consumer-protection words, departments, error state).
"""
import glob, os, re, sys

A = "؀-ۿ"
LEAD_WORDS = [("تكلفة الليد", "تكلفة الطلب"), ("الليدز", "الطلبات"), ("الليد", "الطلب"), ("ليدز", "طلبات"), ("ليد", "طلب")]
WELL_DEPTS = "{ iv: 'المحاليل الوريدية', midwife: 'القبالة / رعاية الحمل', foot: 'تقويم القدم', renan: 'رينان لصحة الطفل'"
MOH_LIST = "const MOH = ['الأفضل', 'الأرخص', 'الوحيد', 'مضمون', 'مضمونة', 'أصلي 100%', 'آخر قطعة', 'خصم وهمي'];   // consumer-protection words needing proof or terms"
SHELL_OLD = "  if (!ME || Date.now() - ME.t > 5 * 60 * 1000) ME = { t: Date.now(), v: await api('/api/account/password') };"
SHELL_NEW = """  if (!ME || Date.now() - ME.t > 5 * 60 * 1000) {
    try { ME = { t: Date.now(), v: await api('/api/account/password') }; }
    catch (err) {
      // Without this the page stays blank: every page swallows shell() errors
      const main = $('#content') || $('main');
      if (main) main.innerHTML = `<div class="card empty">${icon('alert')}<div>${esc(err.message || 'صار خطأ')}</div><button class="btn secondary" style="margin-top:12px" id="shellRetry">${icon('refresh')}حاول مرة ثانية</button></div>`;
      $('#shellRetry')?.addEventListener('click', () => location.reload());
      throw err;
    }
  }"""


def lead_to_order(s):
    for a, b in LEAD_WORDS:
        s = re.sub(rf"(?<![{A}]){a}(?![{A}])", b, s)
    return s.replace("ولا ليد،", "ولا طلب،")


def depts(s):
    return s.replace(WELL_DEPTS, "{ hoven: 'هوفن'").replace(
        "const CODE = { iv: 'IV', midwife: 'Midwife', foot: 'Foot', renan: 'Renan' };", "const CODE = { hoven: 'Hoven' };")


def moh(s):
    s = re.sub(r"const MOH = \[[^\]]*\];[^\n]*", lambda m: MOH_LIST, s, count=1)
    s = s.replace("// كلمات تخالف تعليمات وزارة الصحة في الإعلان الصحي (تطلع تحذير قبل الإرسال)",
                  "// كلمات تحتاج دليل أو شروط حسب نظام التجارة الإلكترونية وحماية المستهلك (تطلع تحذير قبل الإرسال)")
    s = s.replace("كلمات تخالف تعليمات وزارة الصحة:", "كلمات تحتاج دليل أو شروط (حماية المستهلك):")
    s = s.replace("كلمات تخالف تعليمات وزارة الصحة", "كلمات تحتاج دليل أو شروط (حماية المستهلك)")
    return s.replace("['وزارة الصحة']", "['حماية المستهلك']")


def i18n_en(s):
    out = []
    for l in s.split("\n"):
        if "طلب" in l:
            l = re.sub(r"(?<=[ '])Leads(?=[ ,'])", "Orders", l); l = re.sub(r"(?<=[ '])leads(?=[ ,'.])", "orders", l)
            l = re.sub(r"(?<=[ '])Lead(?=[ ,'])", "Order", l); l = re.sub(r"(?<=[ '])lead(?=[ ,'.\-])", "order", l)
        out.append(l)
    return "\n".join(out)


def launch(s):
    s = re.sub(r"C\('final_url', 'رابط الصفحة', 'url', \{ value: '[^']*' \}\)", "C('final_url', 'رابط الصفحة', 'url', { placeholder: 'https://' })", s)
    return s


SHELL2_OLD = "  if (!ME?.v) me = await fetchMe();\n"
SHELL2_NEW = """  if (!ME?.v) {
    try { me = await fetchMe(); }
    catch (err) {
      // Without this the page stays blank: every page swallows shell() errors
      const main = $('#content') || $('main');
      if (main) main.innerHTML = `<div class="card empty">${icon('alert')}<div>${esc(err.message || 'صار خطأ')}</div><button class="btn secondary" style="margin-top:12px" id="shellRetry">${icon('refresh')}حاول مرة ثانية</button></div>`;
      $('#shellRetry')?.addEventListener('click', () => location.reload());
      throw err;
    }
  }
"""


def common(s):
    if "shellRetry" in s:
        return s
    if SHELL_OLD in s:
        return s.replace(SHELL_OLD, SHELL_NEW)
    if SHELL2_OLD in s:
        return s.replace(SHELL2_OLD, SHELL2_NEW, 1)
    print("overlay: common.js shell() changed upstream, error state not re-applied")
    return s


HOVEN_RULES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hoven", "compliance-rules.ts.txt")


def compliance(s):
    """Swap Well's health-advertising sources and rules for Hoven's store rules (scripts/hoven/compliance-rules.ts.txt)."""
    if "title: 'خصم بدون السعر قبل الخصم أو مدة العرض'" in s:
        return s
    block = open(HOVEN_RULES, encoding="utf-8").read()
    sources, rules = block.split("//__RULES__\n")
    rules = rules.split("//__END__")[0]
    a = s.find("// Sources."); b = s.find("const COMPANY: Source"); b = s.find("\n", b) + 1
    if a < 0 or b <= 0:
        print("overlay: compliance sources block changed upstream, rules not swapped"); return s
    s = s[:a] + sources + s[b:]
    a = s.find("export const RULES: Rule[] = ["); b = s.find("\n];\n", a) + 4
    if a < 0 or b < 4:
        print("overlay: compliance RULES changed upstream, rules not swapped"); return s
    s = s[:a] + rules + s[b:]
    s = s.replace("// Compliance (الامتثال): the one list of health-advertising rules", "// Compliance (الامتثال): the one list of Saudi e-commerce and consumer-protection rules")
    s = re.sub(r"أعد كتابة هذا النص الإعلاني لشركة رعاية صحية في السعودية بحيث يلتزم بأنظمة الإعلان الصحي",
               "أعد كتابة هذا النص الإعلاني لمتجر سعودي للمفارش والمنسوجات المنزلية بحيث يلتزم بنظام التجارة الإلكترونية وحماية المستهلك", s)
    s = re.sub(r"ممنوع: الوعد بالشفاء[^\n]*", "ممنوع: خصم بدون السعر قبل وبعد ومدته، \"مجاني\" بدون شرط، الأفضل/الأرخص/رقم 1 بدون دليل، أي سعر بدون الإجمالي.", s)
    return s


def voice(s):
    pairs = [("كلام ودود فيه ثقة الطبيب: \"فريقنا الطبي المرخّص\".", "كلام ودود وواثق يوصف المنتج: \"قطن ناعم يدوم\"."),
             ("'آمن طبياً'", "'صادق مع العميل'"), ("نتائج تختلف من شخص لآخر، وبعد تقييم طبي.", "مواصفات حقيقية وسعر واضح وسياسة استرجاع مكتوبة."),
             ("ضمان، شفاء، \"الأفضل\"", "خصم وهمي، \"الأرخص\"، \"الأفضل\" بدون دليل"),
             ("كل نص ينتهي بخطوة: \"احجز\"، \"تواصل معنا\".", "كل نص ينتهي بخطوة: \"اطلب الحين\"، \"تسوّق\"."),
             ("أضف خطوة: \"احجز", "أضف خطوة: \"اطلب"),
             ("بصوت علامة Hoven (رعاية صحية منزلية في السعودية):", "بصوت علامة Hoven (متجر سعودي للمفارش والمنسوجات المنزلية):"),
             ("وينتهي بدعوة واضحة (\"احجز\" أو \"تواصل معنا\").", "وينتهي بدعوة واضحة (\"اطلب الحين\" أو \"تسوّق\")."),
             ("- بدون ضمان نتائج، بدون \"علاج نهائي\"، بدون \"الأفضل\"، بدون أرقام وعود.", "- بدون خصم وهمي، بدون \"الأرخص\" أو \"الأفضل\" بدون دليل، والمواصفات والأسعار حقيقية."),
             ("لشركة رعاية صحية منزلية:", "لمتجر مفارش ومنسوجات منزلية:"), ("(احجز|تواصل|", "(احجز|تسوق|تسوّق|تواصل|")]
    for a, b in pairs:
        if b not in s:
            s = s.replace(a, b)
    return s


EMPTY_DASH = """    if (!page) {
      // Before the first data pull the dashboards do not exist yet: say why and where to go, not a bare 404
      if (key.endsWith('.html')) return new Response(
        '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hoven</title>'
        + '<body style="font-family:system-ui;background:#F2F0E3;color:#293342;padding:48px 16px;max-width:560px;margin:auto">'
        + '<h1>اللوحة تنبني بعد أول سحب بيانات</h1><p>اربط المنصات (Meta، سناب، جوجل، سلة) من صفحة الربط، والتحديث يشتغل كل ساعة.</p>'
        + '<p><a href="/connectors/">افتح صفحة الربط</a> · <a href="/account/">حسابي</a></p></body></html>',
        { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" } });
      return new Response('غير موجود', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
"""


def site(s):
    if "اللوحة تنبني بعد أول سحب بيانات" in s:
        return s
    old = "  if (!page) return new Response('غير موجود', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });\n"
    if old not in s:
        print("overlay: site.ts servePage changed upstream, empty-dashboard page not re-applied"); return s
    return s.replace(old, EMPTY_DASH.replace("    ", "  ", 1).replace("\n    ", "\n  "), 1)


def content_prompts(s):
    pairs = [("أنت خبير SEO و AEO للسوق السعودي (الرياض). الموقع: ${site}. النيش: ${niche || 'غير محدد'}.",
              "أنت خبير SEO و AEO لمتجر إلكتروني سعودي. الموقع: ${site}. النيش: ${niche || 'غير محدد'}.\nقاعدة: اعتمد فقط على النيش والصفحات تحت. لا تخترع خدمات أو منتجات أو مجال ما هو مذكور، وإذا الصفحات فاضية اكتب البنود على النيش بس."),
             ("كل بند يستهدف بحث حقيقي في الرياض، بدون ادعاءات طبية (وزارة الصحة).", "كل بند يستهدف بحث شراء حقيقي في السعودية عن منتجات النيش، بدون ادعاءات مبالغ فيها."),
             ("كل بند يستهدف بحث حقيقي في الرياض، بدون ادعاءات طبية (حماية المستهلك).", "كل بند يستهدف بحث شراء حقيقي في السعودية عن منتجات النيش، بدون ادعاءات مبالغ فيها."),
             ("it.kind === 'page' ? 'نص صفحة خدمة' : 'مقال'} بالعربي السعودي الواضح لموقع ${p.site} بعنوان:",
              "it.kind === 'page' ? 'نص صفحة فئة أو منتج' : 'مقال'} بالعربي السعودي الواضح لمتجر ${p.site} (النيش: ${String(p.niche || '') || 'غير محدد'}) بعنوان:"),
             ("['MedicalClinic', 'MedicalBusiness', 'LocalBusiness', 'Organization']", "['Organization', 'OnlineStore', 'Store', 'LocalBusiness', 'Product']"),
             ("'أضف schema للمنشأة (MedicalClinic / LocalBusiness)', 'يربط اسمك وعنوانك وخدماتك في نتايج البحث والخرائط.'", "'أضف schema للمتجر (Organization / OnlineStore + Product)', 'يربط اسم المتجر ومنتجاته وأسعاره في نتايج البحث.'")]
    for a, b in pairs:
        s = s.replace(a, b)
    if "لا تخترع خدمات أو مجالات" not in s and "بعنوان: \"${it.title}\". السبب: ${it.why}.\n" in s:
        s = s.replace("بعنوان: \"${it.title}\". السبب: ${it.why}.\n", "بعنوان: \"${it.title}\". السبب: ${it.why}.\nقاعدة: اكتب عن النيش هذا بس. لا تخترع خدمات أو مجالات أو أسعار أو سياسات (شحن، استرجاع) ما هي مذكورة، وحط [تأكد] جنب أي معلومة لازم المتجر يأكدها.\n", 1)
    return s


RULES = {
    "src/lib/site.ts": [site],
    "src/modules/content/routes.ts": [content_prompts],
    "src/modules/content/content.ts": [content_prompts],
    "src/modules/voice/voice.ts": [voice],
    "src/modules/compliance/compliance.ts": [compliance],
    "public/assets/common.js": [common, lead_to_order],
    "public/assets/control.js": [depts, moh, lead_to_order],
    "public/assets/launch.js": [depts, moh, launch, lead_to_order],
    "public/assets/i18n.js": [lead_to_order, i18n_en],
    "src/api/routes/control.ts": [moh, lead_to_order],
    "src/lib/auth.ts": [depts],
}
# Every other user-facing script and module: lead -> order wording only
GLOBS = ["pipeline/modules/**/*.py", "public/assets/*.js", "public/modules/**/*.js", "src/**/*.astro", "src/**/*.ts", "src/**/*.tsx"]


def main(paths):
    targets = set(paths) if paths else {f for g in GLOBS for f in glob.glob(g, recursive=True)} | set(RULES)
    for p in sorted(targets):
        if "/tests/" in p or p.endswith((".test.ts", ".test.tsx")) or "__pycache__" in p:
            continue
        try:
            s = open(p, encoding="utf-8").read()
        except (FileNotFoundError, IsADirectoryError, UnicodeDecodeError):
            continue
        o = s
        for fn in RULES.get(p, [lead_to_order]):
            s = fn(s)
        if s != o:
            open(p, "w", encoding="utf-8").write(s)
            print("overlay:", p)


if __name__ == "__main__":
    main(sys.argv[1:])
