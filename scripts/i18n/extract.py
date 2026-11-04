import re,json,os,sys
root=sys.argv[1]
AR=re.compile(r'[؀-ۿ]')
out={}
def add(f,s):
    s=s.strip()
    if not s or not AR.search(s) or '${' in s or '{' in s and '}' in s and 'Astro' in s: return
    out.setdefault(s,set()).add(f)
def scan(path):
    t=open(path,encoding='utf-8').read(); rel=os.path.relpath(path,root)
    if path.endswith('.astro'):
        body=re.sub(r'^---.*?---','',t,flags=re.S)
        body=re.sub(r'<style.*?</style>','',body,flags=re.S); body=re.sub(r'<script.*?</script>','',body,flags=re.S)
        for m in re.finditer(r'>([^<>{}]*[؀-ۿ][^<>{}]*)<',body): add(rel,re.sub(r'\s+',' ',m.group(1)))
        for m in re.finditer(r'(?:placeholder|aria-label|title|data-tip)="([^"]*[؀-ۿ][^"]*)"',body): add(rel,m.group(1))
        for m in re.finditer(r'\{[^{}]*?(["\'])([^"\']*[؀-ۿ][^"\']*)\1',body): add(rel,m.group(2))
    else:
        for m in re.finditer(r"'((?:[^'\\\n]|\\.)*[؀-ۿ](?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*[؀-ۿ](?:[^\"\\\n]|\\.)*)\"|`((?:[^`\\]|\\.)*[؀-ۿ](?:[^`\\]|\\.)*)`",t):
            s=next(g for g in m.groups() if g); add(rel,s.replace("\\'","'"))
        # text inside template-literal HTML
        for m in re.finditer(r'>([^<>$`]*[؀-ۿ][^<>$`]*)<',t): add(rel,re.sub(r'\s+',' ',m.group(1)))
dirs=[('src/pages',('.astro',)),('src/modules',('.astro','.tsx')),('src/components',('.tsx',)),('public/assets',('.js',)),('public/modules',('.js',))]
for d,ex in dirs:
    for dp,_,fs in os.walk(os.path.join(root,d)):
        for f in fs:
            if f.endswith(ex) and 'i18n.js' not in f and '.test.' not in f: scan(os.path.join(dp,f))
# Server messages shown to users
for dp,_,fs in os.walk(os.path.join(root,'src')):
    for f in fs:
        p=os.path.join(dp,f)
        if f.endswith('.ts') and '.test.' not in f:
            t=open(p,encoding='utf-8').read(); rel=os.path.relpath(p,root)
            for m in re.finditer(r"(?:error|message|msg|hint)\s*:\s*(?:'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\")",t):
                s=next(g for g in m.groups() if g); add(rel,s.replace("\\'","'"))
json.dump({k:sorted(v) for k,v in out.items()},open(sys.argv[2],'w'),ensure_ascii=False)
print(len(out))
