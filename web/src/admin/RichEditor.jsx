// 보이는 대로 쓰는 편집기 — 저장은 서식 기호(마크다운)로 하지만 쓰는 사람에겐 보이지 않는다.
// 글자 편집은 브라우저의 contenteditable 이 하고, React 는 틀만 잡는다 (React 가 글 안을 다시 그리면 커서가 튄다).
import {useEffect, useImperativeHandle, useRef, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {ToggleButton} from '@astryxdesign/core/ToggleButton';
import {Banner} from '@astryxdesign/core/Banner';
import {Heading1, Heading2, Bold, Italic, List as ListIc, ListOrdered, Quote, Link2, ImagePlus, Minus} from 'lucide-react';
import {md, esc, koStamp, toast, INVISIBLE, IMG_SRC, safeUrl} from '../lib/common.js';
import {useAsk} from '../ui/base.jsx';

// ── 화면 → 서식 기호 ──────────────────────────────────────────────────
const MD_SPECIAL = /[\\`*_[\]~]/g;
export function toMd(root) {
  const inl = node => {
    let out = '';
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) { out += n.nodeValue.replace(INVISIBLE, '').replace(/ /g, ' ').replace(/\s*\n\s*/g, ' ').replace(MD_SPECIAL, '\\$&'); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName, css = n.style || {};
      const wrap = (m, inner) => { const t = inner.trim(); if (!t) return inner; const lead = inner.match(/^\s*/)[0], tail = inner.match(/\s*$/)[0]; return `${lead}${m}${t}${m}${tail}`; };
      if (tag === 'BR') out += '\n';
      else if (tag === 'IMG') { const s = n.getAttribute('src') || ''; if (IMG_SRC.test(s)) out += `![${(n.getAttribute('alt') || '').replace(/[[\]]/g, '')}](${s})`; }
      else if (tag === 'A') {
        const h = n.getAttribute('href') || '', t = inl(n);
        out += !safeUrl(h) || /[\s)]/.test(h) ? t : t.replace(/\\/g, '') === h ? h : `[${t}](${h})`;
      }
      else if (tag === 'CODE') out += '`' + n.textContent.replace(/`/g, '') + '`';
      else if (tag === 'B' || tag === 'STRONG' || +css.fontWeight >= 600 || css.fontWeight === 'bold') out += wrap('**', inl(n));
      else if (tag === 'I' || tag === 'EM' || css.fontStyle === 'italic') out += wrap('*', inl(n));
      else if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') out += wrap('~~', inl(n));
      else if (/^(P|DIV|H\d|LI|BLOCKQUOTE)$/.test(tag)) out += (out && !out.endsWith('\n') ? '\n' : '') + inl(n) + '\n';
      else out += inl(n);
    });
    return out;
  };
  // 문단 줄 첫머리가 제목·목록·인용·구분선으로 읽히지 않게 기호 앞에 \ 를 붙인다 (* 와 ` 는 위에서 이미)
  const guard = l => l.replace(/^(\s*)(\d+)([.)])(?=\s)/, '$1$2\\$3').replace(/^(\s*)(#{1,6}(?=\s)|[-+](?=\s)|>|-(?=-{2,}\s*$))/, '$1\\$2');
  const blocks = [];
  let buf = null;
  const flush = () => { if (buf) { const t = inl(buf).replace(/\n+$/, ''); if (t.trim()) blocks.push(t.split('\n').map(l => guard(l.replace(/\s+$/, ''))).join('\n')); } buf = null; };
  const one = s => s.replace(/\n+/g, ' ').trim();
  const BLOCKS = 'P,DIV,H1,H2,H3,H4,H5,H6,UL,OL,BLOCKQUOTE,HR,PRE,TABLE,FIGURE';
  const walk = parent => parent.childNodes.forEach(n => {
    const tag = n.nodeType === 1 ? n.tagName : '';
    // 브라우저가 문단 안에 목록·인용을 넣어 버리는 경우(<p><ul>…)가 있다 — 안쪽 블록을 바깥 블록처럼 다룬다
    if ((tag === 'P' || tag === 'DIV') && n.querySelector(BLOCKS)) { flush(); return walk(n); }
    if (!/^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|HR|PRE|TABLE|FIGURE)$/.test(tag)) {   // 글자·인라인은 한 문단으로 모은다
      if (n.nodeType === 3 && !n.nodeValue.trim() && !buf) return;
      (buf ||= document.createElement('p')).append(n.cloneNode(true)); return;
    }
    flush();
    if (/^H[1-3]$/.test(tag)) { const t = one(inl(n)); if (t) blocks.push('# ' + t); }
    else if (tag === 'H4') { const t = one(inl(n)); if (t) blocks.push('## ' + t); }
    else if (/^H[56]$/.test(tag)) { const t = one(inl(n)); if (t) blocks.push('### ' + t); }
    else if (tag === 'HR') blocks.push('---');
    else if (tag === 'PRE') blocks.push('```\n' + n.textContent.replace(/```/g, '') + '\n```');
    else if (tag === 'UL' || tag === 'OL') {
      const items = [];
      n.querySelectorAll('li').forEach(li => {
        const c = li.cloneNode(true); c.querySelectorAll('ul,ol').forEach(x => x.remove());
        const t = one(inl(c)); if (t) items.push((tag === 'OL' ? `${items.length + 1}. ` : '- ') + t);
      });
      if (items.length) blocks.push(items.join('\n'));
    }
    else if (tag === 'BLOCKQUOTE') { const t = toMd(n); if (t.trim()) blocks.push(t.split('\n').map(l => l ? '> ' + l : '>').join('\n')); }
    else { buf = n; flush(); }
  });
  walk(root);
  flush();
  return blocks.join('\n\n');
}
const cleanText = s => String(s).replace(/\r/g, '').replace(INVISIBLE, '');

// 그림: 긴 변 1600px 로 줄여 다시 굽는다 (사진 위치 정보도 같이 지워진다). GIF 는 움직임을 지키려고 그대로.
async function shrinkImage(file) {
  if (file.type === 'image/gif') return file;
  const bmp = await createImageBitmap(file, {imageOrientation: 'from-image'});
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const png = file.type === 'image/png';
  return new Promise(res => cv.toBlob(res, png ? 'image/png' : 'image/jpeg', .85));
}
async function uploadImage(file) {
  if (!/^image\//.test(file.type)) { toast('그림 파일만 넣을 수 있습니다'); throw new Error(); }
  toast('그림을 올리는 중…');
  const blob = await shrinkImage(file);
  if (blob.size > 5 * 1024 * 1024) { toast('그림은 5MB까지 올릴 수 있습니다'); throw new Error(); }
  const r = await fetch('api/admin/upload', {method: 'POST', headers: {'Content-Type': blob.type || 'application/octet-stream'}, body: blob});
  const d = await r.json().catch(() => ({error: '연결이 원활하지 않습니다. 잠시 뒤 다시 시도해 주십시오'}));
  if (!r.ok) { toast(d.error || '그림을 올리지 못했습니다'); throw new Error(); }
  return d.url;
}

const IC = {h3: Heading1, h4: Heading2, bold: Bold, italic: Italic, ul: ListIc, ol: ListOrdered, quote: Quote, link: Link2, img: ImagePlus, hr: Minus};
const TOGGLE = new Set(['h3', 'h4', 'bold', 'italic', 'ul', 'ol', 'quote']);     // 켜고 끄는 서식 (나머지는 한 번 넣기)
const BAR = [['h3', '제목'], ['h4', '소제목'], '|', ['bold', '굵게'], ['italic', '기울임'], '|', ['ul', '목록'], ['ol', '번호 목록'], ['quote', '인용'], '|', ['link', '링크'], ['img', '그림'], ['hr', '구분선']];

export default function RichEditor({ref, value = '', draftKey = '', max = 20000, placeholder = '내용을 쓰십시오'}) {
  const ask = useAsk();
  const el = useRef(null), file = useRef(null);
  const [pressed, setPressed] = useState({});
  const [count, setCount] = useState(0);
  const [draft, setDraft] = useState(() => {
    try { const d = draftKey ? JSON.parse(localStorage.getItem(draftKey) || 'null') : null; return d?.body && d.body.trim() !== String(value).trim() ? d : null; } catch { return null; }
  });
  const s = useRef({composing: false, pending: null, saved: null, tmr: 0}).current;
  const holdDraft = useRef(!!draft);

  const load = v => { el.current.innerHTML = cleanText(v).trim() ? md(v) : ''; };
  const len = () => toMd(el.current).length;
  const changed = () => {
    setCount(len());
    clearTimeout(s.tmr);
    if (draftKey && !holdDraft.current) s.tmr = setTimeout(() => { try { localStorage.setItem(draftKey, JSON.stringify({body: toMd(el.current), at: new Date().toISOString().slice(0, 16)})); } catch {} }, 400);
  };
  const inBlock = tag => { const sel = getSelection(); let n = sel.rangeCount ? sel.getRangeAt(0).startContainer : null; for (; n && n !== el.current; n = n.parentNode) if (n.nodeType === 1 && n.tagName === tag) return true; return false; };
  const refresh = () => {
    if (!el.current?.contains(getSelection().anchorNode)) return;
    setPressed({bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'),
      ul: inBlock('UL'), ol: inBlock('OL'), h3: inBlock('H3'), h4: inBlock('H4'), quote: inBlock('BLOCKQUOTE')});
  };
  const keep = () => { const sel = getSelection(); if (sel.rangeCount && el.current.contains(sel.anchorNode)) s.saved = sel.getRangeAt(0).cloneRange(); };
  const back = () => { el.current.focus(); if (s.saved) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(s.saved); } };
  const block = tag => tag === 'BLOCKQUOTE' && inBlock(tag) ? document.execCommand('outdent')
    : document.execCommand('formatBlock', false, inBlock(tag) ? '<p>' : `<${tag.toLowerCase()}>`);
  const insertImg = async f => { try { const url = await uploadImage(f); back(); document.execCommand('insertImage', false, url); changed(); toast('그림을 넣었습니다'); } catch {} };
  const act = {
    h3: () => block('H3'), h4: () => block('H4'), quote: () => block('BLOCKQUOTE'),
    bold: () => document.execCommand('bold'), italic: () => document.execCommand('italic'),
    ul: () => document.execCommand('insertUnorderedList'), ol: () => document.execCommand('insertOrderedList'),
    hr: () => document.execCommand('insertHorizontalRule'),
    link: async () => {
      keep();
      const sel = getSelection().toString().trim();
      let u = await ask.prompt('링크 넣기', {label: '인터넷 주소', value: /^https?:\/\//.test(sel) ? sel : 'https://', type: 'url', actionLabel: '넣기'});
      if (u == null) return; u = u.trim(); if (!u || u === 'https://') return;
      if (!/^(https?:\/\/|mailto:)/i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
      if (/\s/.test(u)) return toast('주소에 띄어쓰기가 있으면 안 됩니다');
      back();
      if (getSelection().isCollapsed) document.execCommand('insertText', false, u);
      else document.execCommand('createLink', false, u);
      changed();
    },
    img: () => { keep(); file.current.click(); },
  };
  const run = k => { const go = () => { el.current.focus(); act[k](); changed(); refresh(); }; if (s.composing) s.pending = go; else go(); };   // 한글 조합 중이면 조합이 끝난 뒤에

  useEffect(() => {
    const e = el.current;
    document.execCommand('defaultParagraphSeparator', false, 'p');
    load(value); setCount(len());
    document.addEventListener('selectionchange', refresh);
    const onStart = () => { s.composing = true; };
    const onEnd = () => { s.composing = false; if (s.pending) { const p = s.pending; s.pending = null; setTimeout(p, 0); } };
    const onKey = ev => {
      if (ev.isComposing || s.composing) return;
      const mod = ev.ctrlKey || ev.metaKey, k = ev.key.toLowerCase();
      if (mod && !ev.shiftKey && (k === 'b' || k === 'i' || k === 'k')) { ev.preventDefault(); act[{b: 'bold', i: 'italic', k: 'link'}[k]](); changed(); }
    };
    // 붙여넣기: 다른 곳의 글꼴·색·표는 버리고 글자만. 보이지 않는 문자도 지운다. 그림 파일이면 올린다.
    const onPaste = ev => {
      ev.preventDefault();
      const img = [...(ev.clipboardData?.files || [])].find(f => /^image\//.test(f.type));
      if (img) { keep(); return insertImg(img); }
      const t = cleanText(ev.clipboardData?.getData('text/plain') || '');
      if (!t) return;
      if (!/\n/.test(t)) return document.execCommand('insertText', false, t);
      document.execCommand('insertHTML', false, t.split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''));
    };
    const onOver = ev => { if ([...ev.dataTransfer.items].some(i => i.kind === 'file')) ev.preventDefault(); };
    const onDrop = ev => {
      const f = [...ev.dataTransfer.files].find(f => /^image\//.test(f.type));
      const place = () => { const r = document.caretRangeFromPoint?.(ev.clientX, ev.clientY); if (r) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } };
      if (f) { ev.preventDefault(); place(); keep(); insertImg(f); }
      else if (ev.dataTransfer.getData('text/html')) { ev.preventDefault(); place(); document.execCommand('insertText', false, cleanText(ev.dataTransfer.getData('text/plain'))); }
    };
    e.addEventListener('compositionstart', onStart); e.addEventListener('compositionend', onEnd);
    e.addEventListener('input', changed); e.addEventListener('keydown', onKey); e.addEventListener('paste', onPaste);
    e.addEventListener('dragover', onOver); e.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('selectionchange', refresh); clearTimeout(s.tmr);
      e.removeEventListener('compositionstart', onStart); e.removeEventListener('compositionend', onEnd);
      e.removeEventListener('input', changed); e.removeEventListener('keydown', onKey); e.removeEventListener('paste', onPaste);
      e.removeEventListener('dragover', onOver); e.removeEventListener('drop', onDrop);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    get value() { return toMd(el.current); },
    get tooLong() { return len() > max; },
    clearDraft() { clearTimeout(s.tmr); try { localStorage.removeItem(draftKey); } catch {} },
  }));

  const drop = useLoadDraft => { holdDraft.current = false; if (useLoadDraft) load(draft.body); else try { localStorage.removeItem(draftKey); } catch {} setDraft(null); changed(); };
  return <div className="re">
    {draft && <Banner status="info" container="section" title={`${koStamp(draft.at)}에 저장하지 않고 나간 글이 있습니다`}
      endContent={<><Button label="그 글 불러오기" size="sm" variant="primary" onClick={() => drop(true)} /><Button label="버리기" size="sm" variant="secondary" onClick={() => drop(false)} /></>} />}
    <div className="re-bar" role="toolbar" aria-label="서식" onPointerDown={e => { if (e.target.closest('button')) e.preventDefault(); }}>
      {BAR.map((b, i) => {
        if (b === '|') return <span key={i} className="sep" aria-hidden="true" />;
        const Ic = IC[b[0]], icon = <Ic size={16} />;
        return TOGGLE.has(b[0])
          ? <ToggleButton key={b[0]} label={b[1]} size="sm" icon={icon} isPressed={!!pressed[b[0]]} onPressedChange={() => run(b[0])} />
          : <Button key={b[0]} label={b[1]} size="sm" variant="ghost" icon={icon} onClick={() => run(b[0])} />;
      })}
    </div>
    <div ref={el} className="re-body md" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="본문" data-ph={placeholder} />
    <div className="re-foot"><span style={{color: count > max ? 'var(--req)' : undefined}}>{count.toLocaleString()} / {max.toLocaleString()}자{count > max ? ' (글자 수를 넘었습니다)' : ''}</span>
      <span>Enter는 새 문단, Shift+Enter는 줄바꿈. 그림은 끌어다 놓아도 들어갑니다</span></div>
    <input ref={file} type="file" accept="image/*" hidden onChange={ev => { const f = ev.target.files[0]; if (f) insertImg(f); ev.target.value = ''; }} />
  </div>;
}
