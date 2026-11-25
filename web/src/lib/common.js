// 학생 사이트와 관리 사이트가 같이 쓰는 것: 날짜 말로 쓰기, 조사, 본문 서식, 서버 호출.
// 예전 common.js 를 그대로 옮겼다. 화면을 그리는 부분만 React 로 바뀌었다.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return iso(d); };

// ── 날짜·시간을 사람 말로 ────────────────────────────────────────────────
// 서버 값은 'YYYY-MM-DD' 또는 'YYYY-MM-DDTHH:MM' (한국 시간). new Date('YYYY-MM-DD') 는 UTC 로 읽으니 직접 나눈다.
export const WD = ['일', '월', '화', '수', '목', '금', '토'];
export function toDate(s) {
  if (s instanceof Date) return new Date(s);
  const m = String(s || '').match(/^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d))?/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
}
export const wd = s => WD[toDate(s).getDay()];
// 11월 5일 (목) — 올해가 아니면 2025년 11월 5일 (목)
export function koDate(s, {year} = {}) {
  const d = toDate(s); if (!d) return '';
  const y = year || d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}년 ` : '';
  return `${y}${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
}
// 시 앞말: 0시 → 밤 12시, 12시 → 낮 12시
const ampm = h => (h %= 24, h === 0 ? ['밤', 12] : h < 12 ? ['오전', h] : h === 12 ? ['낮', 12] : ['오후', h - 12]);
export function koTime(h, mi = 0) { const [a, n] = ampm(h); return `${a} ${n}시${mi ? ` ${mi}분` : ''}`; }
export function koClock(h, mi = 0) { const [a, n] = ampm(h); return `${a} ${n}:${pad(mi)}`; }
// 오후 2시~5시 · 오전 11시~오후 1시 · 끝이 24 면 밤 12시
export function koRange(a, b) {
  const x = koTime(a), y = koTime(b);
  return x.split(' ')[0] === y.split(' ')[0] ? `${x}~${y.split(' ')[1]}` : `${x}~${y}`;
}
// 11월 12일 (목) 오후 3시 5분 — 시각이 없는 값이면 날짜만
export function koWhen(s) {
  const d = toDate(s); if (!d) return '';
  return /T|\s\d/.test(String(s)) ? `${koDate(s)} ${koTime(d.getHours(), d.getMinutes())}` : koDate(s);
}
// 표 안의 짧은 꼴: 11월 12일 (목) 오후 3:05
export function koStamp(s) {
  const d = toDate(s); if (!d) return '';
  return `${koDate(s)} ${koClock(d.getHours(), d.getMinutes())}`;
}
// 걸린 시간: 5분 · 2시간 10분 · 3일 4시간
export function koSpan(from, to) {
  const a = toDate(from), b = to ? toDate(to) : new Date();
  if (!a || !b) return '';
  let m = Math.max(0, Math.round((b - a) / 6e4));
  const d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60); m %= 60;
  return d ? `${d}일${h ? ` ${h}시간` : ''}` : h ? `${h}시간${m ? ` ${m}분` : ''}` : `${m}분`;
}
// 받침에 맞는 조사: josa('우산 3번', '을', '를') → '우산 3번을'
export function josa(w, a, b) {
  w = String(w ?? ''); const ch = w.slice(-1), c = ch.charCodeAt(0);
  if (c >= 0xAC00 && c <= 0xD7A3) return w + ((c - 0xAC00) % 28 ? a : b);
  return w + ('0136781LMNRlmnr'.includes(ch) ? a : b);
}
// 마감까지 남은 날: D-3 · D-DAY · 지났으면 '' (날짜만 보고 센다, 시각은 보지 않는다)
export function dday(s) {
  const d = toDate(s); if (!d) return '';
  const t = new Date(); t.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0);
  const n = Math.round((d - t) / 864e5);
  return n < 0 ? '' : n === 0 ? 'D-DAY' : `D-${n}`;
}
// 오늘·내일·모레는 말로
export function koDay(s) {
  const t = iso(new Date());
  return s === t ? '오늘' : s === addDays(t, 1) ? '내일' : s === addDays(t, 2) ? '모레' : koDate(s);
}

// ── 본문 서식 (마크다운을 줄인 것) ──────────────────────────────────────
// 먼저 전부 이스케이프한 뒤 우리가 만든 태그만 넣는다 — 글에 <script> 를 써도 글자로만 나온다.
// 링크는 https / http / mailto / 사이트 안 주소만, 그림은 https 와 이 사이트에 올린 그림(img/…)만.
// 글자 그대로 두고 싶은 서식 기호는 앞에 \ 를 붙인다 (글쓰기 도구가 알아서 붙인다).
export const INVISIBLE = /[​⁠﻿]/g;      // 붙여 넣은 글에 섞여 오는 보이지 않는 문자 (U+200D 는 이모지라 남긴다)
const MD_ESC = /\\([\\`*_[\]()#+\-.!>~|])/g;
export const IMG_SRC = /^(https:\/\/[^\s)]+|img\/[0-9a-f]{16}\.(?:jpg|png|webp|gif))$/;
export const safeUrl = u => /^(https?:\/\/|mailto:|#\/)/i.test(u);
const mdLink = (u, a) => /^#\//.test(u) || /^mailto:/i.test(u)
  ? `<a href="${u}">${a}</a>` : `<a href="${u}" target="_blank" rel="noopener noreferrer">${a}</a>`;
function mdInline(raw) {
  const stash = [], keep = h => '\u0001' + (stash.push(h) - 1) + '\u0001';
  let t = String(raw).replace(/\u0001/g, '').replace(MD_ESC, (_, c) => keep(esc(c)));
  t = esc(t);
  t = t.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`));
  t = t.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, (m, a, u) => IMG_SRC.test(u) ? keep(`<img src="${u}" alt="${a}" loading="lazy">`) : m);
  t = t.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (m, a, u) => safeUrl(u) ? keep(mdLink(u, a)) : m);
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)\u0001]+)/g, (_, p, u) => p + keep(mdLink(u, u)));   // 주소만 붙여 넣어도 링크
  t = t.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  for (let k = 0; k < 3 && /\u0001/.test(t); k++) t = t.replace(/\u0001(\d+)\u0001/g, (_, i) => stash[+i]);
  return t;
}
export function md(src) {
  const L = String(src ?? '').replace(/\r/g, '').replace(INVISIBLE, '').split('\n'), out = [];
  const LI = /^\s*([-*+]|\d+[.)])\s+/;
  const block = l => /^#{1,3}\s/.test(l) || LI.test(l) || /^>/.test(l) || /^```/.test(l) || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(l);
  for (let i = 0, m; i < L.length;) {
    const l = L[i];
    if (!l.trim()) { i++; continue; }
    if (/^```/.test(l)) {
      const buf = []; i++;
      while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]);
      i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue;
    }
    if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { const n = m[1].length + 2; out.push(`<h${n}>${mdInline(m[2])}</h${n}>`); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^>/.test(l)) {
      const buf = [];
      while (i < L.length && /^>/.test(L[i])) buf.push(L[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${md(buf.join('\n'))}</blockquote>`); continue;
    }
    if (LI.test(l)) {
      const ord = /^\s*\d/.test(l), items = [];
      while (i < L.length && LI.test(L[i]) && /^\s*\d/.test(L[i]) === ord) items.push(`<li>${mdInline(L[i++].replace(LI, ''))}</li>`);
      out.push(ord ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`); continue;
    }
    const buf = [l]; i++;
    while (i < L.length && L[i].trim() && !block(L[i])) buf.push(L[i++]);
    out.push(`<p>${buf.map(mdInline).join('<br>')}</p>`);      // 줄바꿈은 그대로 줄바꿈
  }
  return out.join('\n');
}

// ── 알림 ────────────────────────────────────────────────────────────────
// 화면 아래에 잠깐 뜨는 한 줄 알림. 실제로 띄우는 일은 Providers(ui/base.jsx)의 .toast 가 맡는다.
let showToast = msg => console.log(msg);
export const setToast = fn => { showToast = fn; };
export const toast = msg => { showToast(msg); };

// ── 서버 호출 ───────────────────────────────────────────────────────────
// 로그인이 풀렸을 때 할 일은 각 사이트가 정한다 (api.onAuth)
export async function api(path, body) {
  const r = await fetch('api/' + path, body === undefined ? {} :
    {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const d = await r.json().catch(() => ({error: '연결이 원활하지 않습니다. 잠시 뒤 다시 시도해 주십시오'}));
  if (r.status === 401 && path !== 'login') { api.onAuth?.(d); throw new Error(d.error); }
  if (!r.ok) { toast(d.error || '문제가 생겼습니다. 다시 시도해 주십시오'); throw new Error(d.error); }
  return d;
}
