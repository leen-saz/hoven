#!/usr/bin/env python3
"""Re-applies Hoven's own changes on files taken from Well (leen-saz/well-ads) after an upstream sync.

Usage: python3 scripts/hoven-overlay.py [files...]   (no args = every file this script knows about)
Idempotent: running it twice changes nothing. Each rule is a plain text or regex replacement, so a rule that no
longer matches is reported, never applied blindly. Name/colour/font rewrites live in .upstream/well-to-hoven.pl;
this file holds the content changes (sales wording, consumer-protection words, departments, error state).
"""
import glob, re, sys

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


RULES = {
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
