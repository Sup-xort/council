// design/tokens.json(디자인 시스템 SWITCH 의 토큰) → src/ui/tokens.css
// 밝게가 기본, 기기가 어두우면 어둡게. <html data-theme="light|dark"> 가 있으면 그쪽을 따른다.
import fs from 'fs';
const t = JSON.parse(fs.readFileSync('design/tokens.json', 'utf8'));
const light = [], dark = [];
const put = (name, v) => {
  if (v && typeof v === 'object') { light.push(`--${name}:${v.light}`); if (v.dark && v.dark !== v.light) dark.push(`--${name}:${v.dark}`); }
  else light.push(`--${name}:${v}`);
};
t.color.tokens.forEach(x => put(x.name, x.value));
for (const fam of ['spacing', 'radius', 'shadow', 'size']) (t[fam]?.tokens || []).forEach(x => put(x.name, x.value));
Object.entries(t.type.families).forEach(([k, v]) => light.push(`--font-${k}:${v}`));
const css = `:root{color-scheme:light;${light.join(';')}}
:root[data-theme=dark]{color-scheme:dark;${dark.join(';')}}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){color-scheme:dark;${dark.join(';')}}}
`;
fs.writeFileSync('src/ui/tokens.css', '/* design/tokens.json 에서 만든 파일 — 고치지 말고 npm run tokens */\n' + css);
console.log(`tokens.css: 밝게 ${light.length}개, 어둡게 ${dark.length}개`);
