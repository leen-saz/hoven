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



# ---- The dashboard (pipeline/template.html + pipeline/dash/*.js, split by Well in phase 4.3) ----
# Hoven (ADR-0007): leads = purchases, conv = revenue in SAR. Tiles for orders, revenue, ROAS and Salla.
HOVEN_TILES = """    tile('الصرف',sar(a.spend),money(),spend,'spend',keys.map(k=>daySum(k,'spend'))),
    // Hoven (ADR-0007): leads = purchases, conv = revenue in SAR; Salla = the store's own sales
    ...(!crm ? (()=>{ const x=sallaSum(S.from,S.to), y=cur&&cur.compareOk&&prev?sallaSum(cur.pFrom,cur.pTo):{};
      const roas=ratio(a.conv,a.spend), roasB=ratio(b.conv,b.spend), tr2=ratio(x.net,a.spend), tr2B=y.net!=null?ratio(y.net,b.spend):null;
      return [
        tile('طلبات الإعلانات',qty(a.leads),'',delta(a.leads,b.leads,false),'closings',keys.map(k=>daySum(k,'leads')),'feature'),
        tile('إيراد الإعلانات',sar(a.conv),money(),delta(a.conv,b.conv,false),'paid',null),
        tile('ROAS',roas==null?'—':fmt(roas,2)+'×','',delta(roas,roasB,false),'ret',null),
        ...(D.salla&&D.salla.length ? [
          tile('مبيعات سلة',sar(x.net),money(),delta(x.net,y.net,false),'paid',null),
          tile('طلبات سلة',fmt(x.orders),'',delta(x.orders,y.orders,false),'closings',null),
          tile('العائد الحقيقي (سلة ÷ الصرف)',tr2==null?'—':fmt(tr2,2)+'×','',delta(tr2,tr2B,false),'ret',null),
        ] : []),
      ]; })() : []),
"""
SALLA_SUM = """function sallaSum(from,to){
  const o={orders:0,net:0};
  for(const r of D.salla||[]) if(r.day>=from&&r.day<=to){o.orders+=r.orders||0;o.net+=r.net||0;}
  return o;
}
function renderKpis(now,prev){"""
DASH_I18N = """  'الظهور':'Impressions',
  'طلبات الإعلانات':'Ad orders',
  'إيراد الإعلانات':'Ad revenue',
  'طلبات سلة':'Salla orders',
  'مبيعات سلة':'Salla sales',
  'العائد الحقيقي (سلة ÷ الصرف)':'True ROAS (Salla ÷ spend)',
  'كم واحد اشترى':'How many bought',
  'الإيراد (ر.س)':'Revenue (SAR)',
  'من نقرة إلى طلب':'Click to order',"""


def dash(s):
    s = s.replace("'ما فيه ليدز في هذي الفترة.':'No leads in this range.'", "'ما فيه طلبات في هذي الفترة.':'No orders in this range.'")
    if "HOVEN-DASH" in s:
        return s
    o = s
    one = lambda a, b: s.replace(a, b, 1) if a in s else s
    s = one("    tile('الصرف',sar(a.spend),money(),spend,'spend',keys.map(k=>daySum(k,'spend'))),\n", HOVEN_TILES)
    s = one("function renderKpis(now,prev){", SALLA_SUM)
    s = one("const vol = [a.impr||0, a.clicks||0, (a.leads||0)+(a.conv||0), crm ? allN : (a.booked||0)];", "const vol = [a.impr||0, a.clicks||0, a.leads||0, crm ? allN : (a.booked||0)];   // Hoven: conv is revenue, not a count")
    s = one("const clickToLead = ratio(100*((a.leads||0)+(a.conv||0)), a.clicks), clickToLeadB = ratio(100*((b.leads||0)+(b.conv||0)), b.clicks);", "const clickToLead = ratio(100*(a.leads||0), a.clicks), clickToLeadB = ratio(100*(b.leads||0), b.clicks);")
    s = one("hint:'كم واحد ترك بياناته أو راسلنا'", "hint:'كم واحد اشترى'")
    s = one("kpi('محادثات واتساب وماسنجر',fmt(a.conv),'',delta(a.conv,b.conv,false),'sub')", "kpi('الإيراد (ر.س)',sar(a.conv),money(),delta(a.conv,b.conv,false),'sub')")
    s = s.replace("['#7C8CFF','#8B6CFF','#294036','#5B36D6']", "['#7fb59a','#4f7a63','#294036','#293342']")
    s = one("  'الظهور':'Impressions',", DASH_I18N)
    s = s.replace("'محادثات واتساب وماسنجر':", "'x-unused-chats':")
    s = s.replace("page.name==='Hoven Care.'", "page.name==='Hoven'")
    # Personas: results are orders
    for a, b in [("ui('النتايج (ليدز ومحادثات)','Results (leads and chats)')", "ui('الطلبات','Orders')"), ("ui('تكلفة النتيجة','Cost per result')", "ui('تكلفة الطلب','Cost per order')"),
                 ("ui('الأرخص نتيجة','Cheapest result')", "ui('الأرخص طلب','Cheapest order')")]:
        s = s.replace(a, b)
    # Well's departments and the excluded TikTok account
    s = re.sub(r"departments:\{\s*iv:\{ar:'المحاليل الوريدية'.*?brand:\{ar:'[^']*',color:'--d-brand'\}\s*\}", "departments:{ hoven:{ar:'هوفن',color:'--d-brand'} }", s, count=1, flags=re.S)
    s = s.replace("{default:'brand', order:['iv','midwife','foot','renan','brand'], departments:{", "{default:'hoven', order:['hoven'], departments:{")
    s = re.sub(r"const DEP_EN=\{[^}]*\};", "const DEP_EN={hoven:'Hoven'};", s, count=1)
    s = re.sub(r"const hints=LANG==='en'\s*\?\s*\{iv:.*?\}\s*:\s*\{iv:.*?renan:'رينان'\};", "const hints={hoven:''};", s, count=1, flags=re.S)
    s = re.sub(r"\s*--d-iv:[^;]*;\s*--d-midwife:[^;]*;\s*--d-foot:[^;]*;\s*--d-renan:[^;]*;", "\n  ", s, count=1)
    s = s.replace("يُستنتج من نص المنشور، وحيوية الشعر ضمن المحاليل.", "يُستنتج من نص المنشور.")
    if "// Spring Rose0406" in s and "function ttExcludedAd(a){" in s:
        a = s.index("// Spring Rose0406"); b = s.index("function ttExcludedAd(a){"); e = s.index("\n}\n", b) + 3
        s = s[:a] + "// Well excluded one TikTok account here; Hoven excludes none.\nfunction ttExcludedAccount(){ return false; }\nfunction ttExcludedAd(){ return false; }\n" + s[e:]
    s = re.sub(r".*fonts\.googleapis\.com/css2\?family=Playfair.*\n", "", s)
    # Labels: leads -> orders, chats -> revenue (Arabic, then English inside ui()/dictionaries)
    for a, b in [("ومحادثات", "والإيراد"), ("والمحادثات", "والإيراد"), ("ومحادثة", "وإيراد"), ("والليدز", "والطلبات"), ("وليدز", "وطلبات"), ("بالمحادثات", "بالإيراد"),
                 ("للمحادثات", "للإيراد"), ("للليدز", "للطلبات"), ("بالليدز", "بالطلبات"), ("تكلفة المحادثة", "تكلفة الطلب"), ("من نقرة إلى ليد", "من نقرة إلى طلب")]:
        s = s.replace(a, b)
    for a, b in [("تكلفة الليد", "تكلفة الطلب"), ("الليدز", "الطلبات"), ("الليد", "الطلب"), ("ليدز", "طلبات"), ("ليد", "طلب"), ("المحادثات", "الإيراد"), ("محادثات", "الإيراد"), ("محادثة", "ريال إيراد")]:
        s = re.sub(rf"(?<![{A}]){a}(?![{A}])", b, s)
    for a, b in [("Cost per lead", "Cost per order"), ("CPL", "CPA"), ("Leads", "Orders"), ("Lead", "Order"), ("Conversations", "Revenue"), ("Chats", "Revenue")]:
        s = re.sub(rf"(?<![A-Za-z_.$'\"]){a}(?![A-Za-z_])", b, s)
    for a, b in [("leads", "orders"), ("lead or chat", "order"), ("conversations", "revenue"), ("chats", "SAR revenue")]:
        s = re.sub(rf"(?<=[ '`(]){a}(?![A-Za-z_])", b, s)
    if s != o:
        s = s.rstrip("\n") + "\n" + ("<!-- HOVEN-DASH -->\n" if s.lstrip().startswith("<") else "// HOVEN-DASH: Hoven overlay applied\n")
    return s


def overview_results(s):
    # Hoven (ADR-0007): conv is revenue in SAR, never added to a count of results
    s = s.replace("x.leads + x.conv", "x.leads").replace("res: num(r[5]) + num(r[6])", "res: num(r[5])")
    return lead_to_order(s)


def copy_store(s):
    """Copywriter: an online store selling home textiles, not home-visit health services."""
    pairs = [("هدف الإعلان: طلب أو حجز.", "هدف الإعلان: طلب شراء من المتجر."), ("هدف الإعلان: ليد أو حجز.", "هدف الإعلان: طلب شراء من المتجر."),
             ("(المشكلة، الراحة، العرض، سؤال)", "(الراحة، الجودة، العرض، سؤال)"), (", وشهادات مرضى", ", وتقييمات عملاء ما لها مصدر"),
             ("، وشهادات مرضى", "، وتقييمات عملاء ما لها مصدر"), ("p.cta || 'اطلب الحين'", "p.cta || 'اطلب الحين'"),
             ("{ hook: `تبي ${what} بدون مشوار؟`, body: `فريقنا يجيك لين بيتك.${offer}`, headline: `${what} في بيتك`, description: 'احجز بخطوات بسيطة', cta }",
              "{ hook: `تبي ${what} تريحك كل ليلة؟`, body: `اطلبها من المتجر وتوصلك لين بيتك.${offer}`, headline: `${what} لبيتك`, description: 'اطلب بخطوات بسيطة', cta }"),
             ("{ hook: `${what}، بالطريقة اللي تريحك`, body: `فريقنا معك من أول خطوة.${offer}`, headline: `${what} بدون انتظار`, description: 'فريق مرخّص يجيك', cta }",
              "{ hook: `${what}، بالجودة اللي تستاهلها`, body: `خامات مختارة وتوصيل سريع.${offer}`, headline: `${what} بتوصيل سريع`, description: 'توصيل لكل مدن المملكة', cta }"),
             ("{ hook: `وش تحتاج تعرف عن ${what}؟`, body: `نجاوبك على كل سؤال قبل ما تقرر.${offer}`, headline: `اسألنا عن ${what}`, description: 'نرد عليك اليوم', cta }",
              "{ hook: `وش تحتاج تعرف عن ${what}؟`, body: `المقاسات والخامات والعناية كلها في صفحة المنتج.${offer}`, headline: `اكتشف ${what}`, description: 'شوف التفاصيل واطلب', cta }")]
    for a, b in pairs:
        s = s.replace(a, b)
    return lead_to_order(s)


def content_store(s):
    s = s.replace("أنت خبير SEO و AEO للسوق السعودي (الرياض). الموقع: ${site}. مجال النشاط: ${niche || 'غير محدد'}.",
                  "أنت خبير SEO و AEO لمتجر إلكتروني سعودي. الموقع: ${site}. مجال النشاط: ${niche || 'غير محدد'}.\nقاعدة: اعتمد فقط على مجال النشاط والصفحات تحت. لا تخترع خدمات أو منتجات أو مجال ما هو مذكور، وإذا الصفحات فاضية اكتب البنود على مجال النشاط بس.")
    s = s.replace("بالسعودي لخدماتنا في الرياض، بدون ادعاءات طبية (حماية المستهلك).", "بالسعودي عن منتجات النيش في السعودية، بدون ادعاءات مبالغ فيها (حماية المستهلك).")
    return s.replace("(الفئة العمرية، الخدمة، المكان)، ومن خدماتنا فعلاً", "(المنتج، الفئة، المكان)، ومن منتجاتنا فعلاً")


HOVEN_EN = {"الإيراد": "Revenue", "تكلفة الطلب": "Cost per order", "طلبات": "Orders", "الطلبات": "Orders",
            "من نقرة إلى طلب": "Click to order", "الطلبات اليومية": "Daily orders", "الإيراد اليومي": "Daily revenue", "هدف تكلفة الطلب": "Cost-per-order target"}
PAIR = re.compile(r"'((?:[^'\\]|\\.)+)'\s*:\s*'((?:[^'\\]|\\.)*)'\s*,?[ \t]*")


def dedupe_dict(s):
    """Lead->order rewording makes two keys identical in the EN dictionaries. A JS object keeps the last one, so the
    English label could read 'Conversations' for الإيراد. Keep one entry per key (the last), with Hoven's meaning."""
    start = s.find("{", s.find("const EN") if "const EN" in s else 0)
    hits = [m for m in PAIR.finditer(s) if m.start() > start]
    last = {}
    for m in hits:
        last[m.group(1)] = m
    out, pos = [], 0
    for m in hits:
        k = m.group(1)
        if last[k] is not m:
            out.append(s[pos:m.start()]); pos = m.end()
    out.append(s[pos:]); s = "".join(out)
    s = re.sub(r"\n[ \t]+(?=\n)", "", s)   # the lines emptied above
    for k, v in HOVEN_EN.items():
        s = re.sub(r"('" + re.escape(k) + r"'\s*:\s*')(?:[^'\\]|\\.)*(')", lambda m: m.group(1) + v + m.group(2), s)
    return s


RULES = {
    "src/modules/overview/analytics.ts": [overview_results],
    "src/modules/overview/numbers.ts": [overview_results],
    "src/lib/site.ts": [site],
    "src/modules/content/routes.ts": [content_prompts],
    "src/modules/content/content.ts": [content_prompts, content_store],
    "src/modules/copy/copy.ts": [copy_store],
    "src/modules/voice/voice.ts": [voice],
    "src/modules/compliance/compliance.ts": [compliance],
    "public/assets/common.js": [common, lead_to_order],
    "public/assets/control.js": [depts, moh, lead_to_order],
    "public/assets/launch.js": [depts, moh, launch, lead_to_order],
    "public/assets/i18n.js": [lead_to_order, i18n_en, dedupe_dict],
    "src/api/routes/control.ts": [moh, lead_to_order],
    "src/lib/auth.ts": [depts],
}
# Every other user-facing script and module: lead -> order wording only
GLOBS = ["pipeline/modules/**/*.py", "public/assets/*.js", "public/modules/**/*.js", "src/**/*.astro", "src/**/*.ts", "src/**/*.tsx"]


DASH_FILES = ["pipeline/template.html"] + sorted(glob.glob("pipeline/dash/*.js"))


def main(paths):
    targets = set(paths) if paths else {f for g in GLOBS for f in glob.glob(g, recursive=True)} | set(RULES) | set(DASH_FILES)
    for p in sorted(targets):
        if "/tests/" in p or p.endswith((".test.ts", ".test.tsx")) or "__pycache__" in p:
            continue
        try:
            s = open(p, encoding="utf-8").read()
        except (FileNotFoundError, IsADirectoryError, UnicodeDecodeError):
            continue
        o = s
        for fn in RULES.get(p, [dash] if p in DASH_FILES else [lead_to_order]):
            s = fn(s)
        if p == "pipeline/dash/01-base.js":
            s = dedupe_dict(i18n_en(s))
        if s != o:
            open(p, "w", encoding="utf-8").write(s)
            print("overlay:", p)


if __name__ == "__main__":
    main(sys.argv[1:])
