# فحص الترجمة الإنجليزية

يطلّع كل النصوص العربية في الواجهة ويشوف أيها ما له ترجمة في `public/assets/i18n.js` + `i18n-hoven.js`.

```
python3 scripts/i18n/extract.py . /tmp/strings.json
node scripts/i18n/check.mjs "$PWD" /tmp/strings.json /tmp/missing.json
```

النتيجة فيها شوية ضجيج (قوائم كلمات اللهجة، أجزاء كود). النص الجديد يندفع في `public/assets/i18n-hoven.js` (مفتاح عربي بالضبط، وقيمة إنجليزية). النصوص اللي فيها متغيرات (`${...}` أو `{x}` في JSX) ما يمسكها القاموس: تنكتب بـ `L('عربي', 'English')` أو تنضاف لها صيغة في `PAT`.
