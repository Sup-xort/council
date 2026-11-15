import fs from 'fs';
import path from 'path';

const dir = path.resolve('dist');
const bad = [];
const walk = d => fs.readdirSync(d, {withFileTypes: true}).forEach(e => {
  const f = path.join(d, e.name);
  if (e.isDirectory()) return walk(f);
  const t = fs.readFileSync(f, 'utf8');
  if (f.endsWith('.map')) bad.push(`${f}: 원본 지도 파일`);
  if (f.endsWith('.html') && /<!--/.test(t)) bad.push(`${f}: <!-- -->`);
  if (f.endsWith('.css') && /\/\*/.test(t)) bad.push(`${f}: /* */`);
  if (f.endsWith('.js') && /\/\*[!*@#]|@license|\/\/[#@] source/.test(t)) bad.push(`${f}: 주석`);
});
walk(dir);
if (bad.length) { console.error('보내는 파일에 주석이 남았습니다:\n' + bad.join('\n')); process.exit(1); }
console.log('주석 검사 통과');
