// 학생 사이트(index.html)와 관리 사이트(admin.html)가 같이 쓰는 것: 글자 처리, 날짜 말로 쓰기, 본문 서식, 서버 호출.
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return iso(d); };

// ── 날짜·시간을 사람 말로 ────────────────────────────────────────────────
// 서버 값은 'YYYY-MM-DD' 또는 'YYYY-MM-DDTHH:MM' (한국 시간). new Date('YYYY-MM-DD') 는 UTC 로 읽으니 직접 나눈다.
const WD = ['일','월','화','수','목','금','토'];
function toDate(s) {
  if (s instanceof Date) return new Date(s);
  const m = String(s || '').match(/^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d))?/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
}
const wd = s => WD[toDate(s).getDay()];
// 11월 5일 (목) — 올해가 아니면 2025년 11월 5일 (목)
function koDate(s, {year} = {}) {
  const d = toDate(s); if (!d) return '';
  const y = year || d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}년 ` : '';
  return `${y}${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
}
// 시 앞말: 0시 → 밤 12시, 12시 → 낮 12시
const ampm = h => (h %= 24, h === 0 ? ['밤', 12] : h < 12 ? ['오전', h] : h === 12 ? ['낮', 12] : ['오후', h - 12]);
function koTime(h, mi = 0) { const [a, n] = ampm(h); return `${a} ${n}시${mi ? ` ${mi}분` : ''}`; }
function koClock(h, mi = 0) { const [a, n] = ampm(h); return `${a} ${n}:${pad(mi)}`; }
// 오후 2시~5시 · 오전 11시~오후 1시 · 끝이 24 면 밤 12시
function koRange(a, b) {
  const x = koTime(a), y = koTime(b);
  return x.split(' ')[0] === y.split(' ')[0] ? `${x}~${y.split(' ')[1]}` : `${x}~${y}`;
}
// 11월 12일 (목) 오후 3시 5분 — 시각이 없는 값이면 날짜만
function koWhen(s) {
  const d = toDate(s); if (!d) return '';
  return /T|\s\d/.test(String(s)) ? `${koDate(s)} ${koTime(d.getHours(), d.getMinutes())}` : koDate(s);
}
// 표 안의 짧은 꼴: 11월 12일 (목) 오후 3:05
function koStamp(s) {
  const d = toDate(s); if (!d) return '';
  return `${koDate(s)} ${koClock(d.getHours(), d.getMinutes())}`;
}
// 걸린 시간: 5분 · 2시간 10분 · 3일 4시간
function koSpan(from, to) {
  const a = toDate(from), b = to ? toDate(to) : new Date();
  if (!a || !b) return '';
  let m = Math.max(0, Math.round((b - a) / 6e4));
  const d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60); m %= 60;
  return d ? `${d}일${h ? ` ${h}시간` : ''}` : h ? `${h}시간${m ? ` ${m}분` : ''}` : `${m}분`;
}
// 받침에 맞는 조사: josa('우산 3번', '을', '를') → '우산 3번을'
function josa(w, a, b) {
  w = String(w ?? ''); const ch = w.slice(-1), c = ch.charCodeAt(0);
  if (c >= 0xAC00 && c <= 0xD7A3) return w + ((c - 0xAC00) % 28 ? a : b);
  return w + ('0136781LMNRlmnr'.includes(ch) ? a : b);
}
// 마감까지 남은 날: D-3 · D-DAY · 지났으면 '' (날짜만 보고 센다, 시각은 보지 않는다)
function dday(s) {
  const d = toDate(s); if (!d) return '';
  const t = new Date(); t.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0);
  const n = Math.round((d - t) / 864e5);
  return n < 0 ? '' : n === 0 ? 'D-DAY' : `D-${n}`;
}
// 오늘·내일·모레는 말로
function koDay(s) {
  const t = iso(new Date());
  return s === t ? '오늘' : s === addDays(t, 1) ? '내일' : s === addDays(t, 2) ? '모레' : koDate(s);
}

// ── 본문 서식 (마크다운을 줄인 것) ──────────────────────────────────────
// 먼저 전부 이스케이프한 뒤 우리가 만든 태그만 넣는다 — 글에 <script> 를 써도 글자로만 나온다.
// 링크는 https / http / mailto / 사이트 안 주소만, 그림은 https 와 이 사이트에 올린 그림(img/…)만.
// 글자 그대로 두고 싶은 서식 기호는 앞에 \ 를 붙인다 (글쓰기 도구가 알아서 붙인다).
const INVISIBLE = /[​⁠﻿]/g;             // 붙여 넣은 글에 섞여 오는 보이지 않는 문자 (U+200D 는 이모지라 남긴다)
const MD_ESC = /\\([\\`*_[\]()#+\-.!>~|])/g;
const IMG_SRC = /^(https:\/\/[^\s)]+|img\/[0-9a-f]{16}\.(?:jpg|png|webp|gif))$/;
const safeUrl = u => /^(https?:\/\/|mailto:|#\/)/i.test(u);
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
function md(src) {
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
    if (m = l.match(/^(#{1,3})\s+(.*)$/)) { const n = m[1].length + 2; out.push(`<h${n}>${mdInline(m[2])}</h${n}>`); i++; continue; }
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

// ── 서버 호출 · 알림 ────────────────────────────────────────────────────
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.append(t); setTimeout(() => t.remove(), 2600);
}
// 로그인이 풀렸을 때 할 일은 각 사이트가 정한다 (api.onAuth)
async function api(path, body) {
  const r = await fetch('api/' + path, body === undefined ? {} :
    {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const d = await r.json().catch(() => ({error: '연결이 원활하지 않습니다. 잠시 뒤 다시 시도해 주십시오'}));
  if (r.status === 401 && path !== 'login') { api.onAuth?.(d); throw new Error(d.error); }
  if (!r.ok) { toast(d.error || '문제가 생겼습니다. 다시 시도해 주십시오'); throw new Error(d.error); }
  return d;
}

// ── 화면 밝기: 기본은 기기 설정을 따른다. 아이콘 하나로 밝게↔어둡게를 바꾸고, 고른 것은 이 브라우저에 기억한다.
// 기기 설정과 같은 쪽으로 돌아오면 기억을 지워 다시 '기기를 따름'이 된다.
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const themeNow = () => { try { return localStorage.getItem('theme'); } catch { return null; } };
const isDark = () => (themeNow() || (darkMQ.matches ? 'dark' : 'light')) === 'dark';
const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>';
const themeIcon = b => { b.innerHTML = isDark() ? SUN : MOON; b.setAttribute('aria-label', isDark() ? '밝은 화면으로' : '어두운 화면으로'); b.title = b.getAttribute('aria-label'); };
const themeBtn = () => `<button type="button" class="themebtn" data-theme-btn aria-label="${isDark() ? '밝은 화면으로' : '어두운 화면으로'}" title="${isDark() ? '밝은 화면으로' : '어두운 화면으로'}">${isDark() ? SUN : MOON}</button>`;
function themeSet(t) {
  const device = darkMQ.matches ? 'dark' : 'light';
  const fixed = (t === 'dark' || t === 'light') && t !== device ? t : null;
  if (fixed) document.documentElement.dataset.theme = fixed; else delete document.documentElement.dataset.theme;
  try { fixed ? localStorage.setItem('theme', fixed) : localStorage.removeItem('theme'); } catch {}
  $$('[data-theme-btn]').forEach(themeIcon);
}
themeSet(themeNow());
darkMQ.addEventListener?.('change', () => themeSet(themeNow()));
document.addEventListener('click', e => {
  if (!e.target.closest('[data-theme-btn]')) return;
  themeSet(isDark() ? 'light' : 'dark');
});
