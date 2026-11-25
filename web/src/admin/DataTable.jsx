// 표 도구: 검색 · 항목별 필터 · 기간 · 정렬 · 묶음 · 고르기 · 칸 바로 고치기 · 더 보기
// columns: {k, label, type:'text'|'num'|'date', val:r=>정렬·필터 값, text:r=>보이는 글자, cell:r=>보이는 화면,
//           filter:'choice'|'text'|false, period:true(기간 필터를 걸 날짜 열), title:true(카드 제목),
//           act:r=>[[이름, 글, 모양], …] (줄 끝 단추), edit:'text'|'num'|'date'|'datetime'|'select'|'multi'|'check', options, raw:r=>고칠 때 처음 값}
// 필터 상태는 주소(#/loans?q=…)에 남는다. 새로고침하거나 주소를 보내도 같은 화면이 나온다. urlState:false 면 남기지 않는다.
// 모양은 디자인 시스템의 table.apps · .card · .pill · label.f 를 쓴다. 좁은 화면(760px 아래)에서는 표 대신 카드.
import {useEffect, useImperativeHandle, useMemo, useState} from 'react';
import {Search, SlidersHorizontal, ArrowUp, ArrowDown} from 'lucide-react';
import {iso, addDays, koStamp} from '../lib/common.js';
import {useMQ} from '../ui/base.jsx';
import {Btn, Pill, Empty, Rows} from '../ui/kit.jsx';

const LIMIT = 200;

function Table({items, cols, st, onSort, select, picked, setPicked, cell}) {
  const all = items.length > 0 && items.every(it => picked.has(it.i)), some = items.some(it => picked.has(it.i));
  const flipAll = () => setPicked(s => { const n = new Set(s); items.forEach(it => all ? n.delete(it.i) : n.add(it.i)); return n; });
  return <div className="scroll-x"><table className="apps dt">
    <thead><tr>
      {select && <th className="dt-chk"><input type="checkbox" aria-label="모두 고르기" checked={all} ref={el => el && (el.indeterminate = some && !all)} onChange={flipAll} /></th>}
      {cols.map(c => {
        const on = st.s === c.k, dir = on ? (st.d > 0 ? 'ascending' : 'descending') : undefined;
        return <th key={c.k} aria-sort={dir} className={c.type === 'num' ? 'n-r' : undefined}>
          {c.act || !c.label ? c.label : <button type="button" className="dt-sort" onClick={() => onSort(c.k)}>{c.label}
            {on && (st.d > 0 ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}</button>}
        </th>;
      })}
    </tr></thead>
    <tbody>{items.map(({i, r}) => <tr key={r.id ?? i} className={picked.has(i) ? 'sel' : undefined}>
      {select && <td className="dt-chk"><input type="checkbox" aria-label={`${cols[0].text(r)} 고르기`} checked={picked.has(i)}
        onChange={e => { const x = e.target.checked; setPicked(s => { const n = new Set(s); x ? n.add(i) : n.delete(i); return n; }); }} /></td>}
      {cols.map(c => <td key={c.k} className={c.type === 'num' ? 'n-r' : c.act ? 'act' : undefined}>{cell(c, r, i)}</td>)}
    </tr>)}</tbody>
  </table></div>;
}

export default function DataTable({ref, path, columns, rows, onAction, onSave, select = false, empty = '아직 아무것도 없습니다.',
  search = '이름, 학번으로 찾기', group, groupHead, cardTitle, urlState = true}) {
  const narrow = useMQ('(max-width: 759px)');
  const cols = useMemo(() => columns.map(c0 => {
    const c = {filter: c0.type === 'date' || c0.act ? false : 'text', type: 'text', ...c0};
    c.val ||= r => r[c.k];
    c.text ||= c.type === 'date' ? r => koStamp(c.val(r)) : r => String(c.val(r) ?? '');
    return c;
  }), [columns]);
  const pcol = cols.find(c => c.period);
  const hay = useMemo(() => rows.map(r => cols.filter(c => !c.act).map(c => c.text(r)).join(' ').toLowerCase()), [rows, cols]);
  const [base, baseQ = ''] = path.split('?');        // path 에 붙은 고정 조건(예: ?event=3)은 그대로 둔다

  const [st, setSt] = useState(() => {
    const p = new URLSearchParams(urlState ? location.hash.split('?')[1] || '' : '');
    const f = {}; for (const [k, v] of p) if (k.startsWith('f.')) f[k.slice(2)] = v;
    return {q: p.get('q') || '', from: p.get('from') || '', to: p.get('to') || '', s: p.get('s') || '', d: p.get('d') === 'desc' ? -1 : 1, f};
  });
  const [limit, setLimit] = useState(LIMIT);
  const [picked, setPicked] = useState(() => new Set());
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState(() => new Map());     // 줄 번호 → {칸: 새 값}
  const [saving, setSaving] = useState(false);
  const nf = Object.values(st.f).filter(Boolean).length;
  const [showF, setShowF] = useState(nf > 0);

  const set = patch => { setSt(s => ({...s, ...patch})); setLimit(LIMIT); };
  useEffect(() => {
    if (!urlState) return;
    const p = new URLSearchParams(baseQ);
    if (st.q) p.set('q', st.q); if (st.from) p.set('from', st.from); if (st.to) p.set('to', st.to);
    if (st.s) { p.set('s', st.s); p.set('d', st.d > 0 ? 'asc' : 'desc'); }
    Object.entries(st.f).forEach(([k, v]) => v && p.set('f.' + k, v));
    const s = p.toString();
    history.replaceState(null, '', '#' + base + (s ? '?' + s : ''));
  }, [st]);
  const active = !!(st.q || st.from || st.to || nf);

  const idx = useMemo(() => {
    const q = st.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out = rows.map((_, i) => i).filter(i => {
      const r = rows[i];
      if (q.length && !q.every(w => hay[i].includes(w))) return false;
      for (const c of cols) {
        const v = st.f[c.k]; if (!v) continue;
        if (c.filter === 'choice' ? c.text(r) !== v : !c.text(r).toLowerCase().includes(v.toLowerCase())) return false;
      }
      if (pcol && (st.from || st.to)) {
        const d = String(pcol.val(r) || '').slice(0, 10);
        if (!d || (st.from && d < st.from) || (st.to && d > st.to)) return false;
      }
      return true;
    });
    const sc = cols.find(c => c.k === st.s);
    if (sc) out.sort((a, b) => {
      const x = sc.val(rows[a]), y = sc.val(rows[b]);
      if (x == null || x === '') return 1; if (y == null || y === '') return -1;   // 빈 값은 늘 아래
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko', {numeric: true})) * st.d;
    });
    if (group) out.sort((a, b) => String(group(rows[a])).localeCompare(String(group(rows[b])), 'ko', {numeric: true}));
    return out;
  }, [rows, cols, st, hay]);

  // 스프레드시트로 보낼 때 쓸 것: 지금 걸러진 행을 열 이름·종류와 함께. 날짜는 원래 값(YYYY-MM-DDTHH:MM) 그대로 넘긴다.
  useImperativeHandle(ref, () => ({
    picked: () => [...picked].map(i => rows[i]),
    exportRows: () => ({columns: cols.filter(c => !c.act).map(c => ({label: c.label, type: c.type})),
      rows: idx.map(i => cols.filter(c => !c.act).map(c => c.type === 'date' ? c.val(rows[i]) ?? '' : c.type === 'num' ? c.val(rows[i]) : c.text(rows[i])))}),
  }), [picked, rows, cols, idx]);

  const choices = c => [...new Set(rows.map(r => c.text(r)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  const rawOf = (c, r) => c.raw ? c.raw(r) : r[c.k];
  const cur = (c, r, i) => { const e = edits.get(i); return e && c.k in e ? e[c.k] : rawOf(c, r); };
  const setEdit = (i, k, v) => setEdits(m => { const n = new Map(m); n.set(i, {...(n.get(i) || {}), [k]: v}); return n; });
  async function leaveEdit(save) {
    if (save) {
      const changes = [];
      edits.forEach((o, i) => {
        const vals = {};
        cols.forEach(c => { if (c.k in o && String(o[c.k] ?? '') !== String(rawOf(c, rows[i]) ?? '')) vals[c.k] = c.edit === 'num' && o[c.k] !== '' ? +o[c.k] : o[c.k]; });
        if (Object.keys(vals).length) changes.push({id: rows[i].id, vals});
      });
      if (changes.length) {
        setSaving(true);
        try { await onSave(changes); } catch { setSaving(false); return; }   // 저장하면 화면을 새로 그린다
        setSaving(false);
      }
    }
    setEditing(false); setEdits(new Map());
  }

  // 칸 고치기: 브라우저 기본 입력 (.in 모양)
  const editor = (c, r, i) => {
    const v = cur(c, r, i), on = x => setEdit(i, c.k, x), lab = c.label;
    if (c.edit === 'select') return <select className="in ce" aria-label={lab} value={v ?? ''} onChange={e => on(e.target.value)}>
      {!c.options.includes(v) && <option value={v ?? ''}>{v || '선택'}</option>}{c.options.map(o => <option key={o} value={o}>{o}</option>)}</select>;
    if (c.edit === 'multi') return <div className="ce-multi">{c.options.map(o => <label key={o} className="chk"><input type="checkbox" checked={(v || []).includes(o)}
      onChange={e => on(e.target.checked ? [...(v || []), o] : (v || []).filter(y => y !== o))} /><span>{o}</span></label>)}</div>;
    if (c.edit === 'check') return <input type="checkbox" aria-label={lab} checked={!!v} onChange={e => on(e.target.checked)} />;
    if (c.edit === 'date') return <input className="in ce" type="date" aria-label={lab} value={v || ''} onChange={e => on(e.target.value)} />;
    if (c.edit === 'datetime') return <input className="in ce" type="datetime-local" aria-label={lab} value={v ?? ''} onChange={e => on(e.target.value)} />;
    return <input className="in ce" aria-label={lab} value={String(v ?? '')} onChange={e => on(e.target.value)} inputMode={c.edit === 'num' ? 'numeric' : undefined} />;
  };
  const acts = (c, r) => <div className="dt-acts">{c.act(r).map(([k, label, variant]) =>
    <Btn key={k} kind={variant === 'destructive' ? 'red' : 'ghost'} size="sm" onClick={() => onAction?.(k, r)}>{label}</Btn>)}</div>;
  const cell = (c, r, i) => editing && c.edit ? editor(c, r, i) : c.act ? acts(c, r) : c.cell ? c.cell(r) : c.text(r);
  const fctl = c => <label className="f" key={c.k}>{c.label}{c.filter === 'choice'
    ? <select value={st.f[c.k] || ''} onChange={e => set({f: {...st.f, [c.k]: e.target.value}})}><option value="">전체</option>{choices(c).map(v => <option key={v} value={v}>{v}</option>)}</select>
    : <input type="search" value={st.f[c.k] || ''} placeholder="찾기" onChange={e => set({f: {...st.f, [c.k]: e.target.value}})} />}</label>;
  const quick = kind => { const t = iso(new Date()); set({to: t, from: kind === 'today' ? t : kind === '7' ? addDays(t, -6) : t.slice(0, 8) + '01'}); };
  const onSort = k => set(st.s !== k ? {s: k, d: 1} : st.d > 0 ? {d: -1} : {s: '', d: 1});

  // 보이는 줄을 묶음으로 나눈다
  const part = idx.slice(0, limit);
  const groups = [];
  for (const i of part) {
    const k = group ? group(rows[i]) : '';
    if (!groups.length || groups[groups.length - 1].k !== k) groups.push({k, items: []});
    groups[groups.length - 1].items.push({i, r: rows[i]});
  }
  const members = {}; if (group) idx.forEach(i => (members[group(rows[i])] ||= []).push(rows[i]));
  const none = active ? '찾는 조건에 맞는 것이 없습니다' : empty;

  const cards = items => <div className="dt-cards">{items.map(({i, r}) => {
    const tc = cols.find(c => c.k === cardTitle) || cols.find(c => c.title) || cols[0], ac = cols.find(c => c.act);
    return <div key={r.id ?? i} className="dt-card">
      <div className="row">{select && <input type="checkbox" aria-label="고르기" checked={picked.has(i)}
        onChange={e => { const x = e.target.checked; setPicked(s => { const n = new Set(s); x ? n.add(i) : n.delete(i); return n; }); }} />}
        <b className="grow">{cell(tc, r, i)}</b></div>
      <Rows rows={cols.filter(c => c !== tc && !c.act && (editing && c.edit || c.cell?.(r) || c.text(r))).map(c => [c.label, cell(c, r, i)])} />
      {ac && acts(ac, r)}
    </div>;
  })}</div>;
  const body = items => narrow ? cards(items)
    : <Table items={items} cols={cols} st={st} onSort={onSort} select={select} picked={picked} setPicked={setPicked} cell={cell} />;

  return <div className="dt-w">
    <div className="dt-bar">
      <label className="dt-q"><Search size={16} aria-hidden="true" /><input type="search" className="in" aria-label="찾기" value={st.q} placeholder={search} onChange={e => set({q: e.target.value})} /></label>
      {pcol && <div className="dt-period">
        <input type="date" className="in" aria-label={`${pcol.label} 시작`} value={st.from} onChange={e => set({from: e.target.value})} />
        <input type="date" className="in" aria-label={`${pcol.label} 끝`} value={st.to} onChange={e => set({to: e.target.value})} />
        <div className="dt-quick">
          <button type="button" className="rb txt" onClick={() => quick('today')}>오늘</button>
          <button type="button" className="rb txt" onClick={() => quick('7')}>최근 7일</button>
          <button type="button" className="rb txt" onClick={() => quick('month')}>이번 달</button></div></div>}
      <Btn kind={showF ? '' : 'ghost'} size="sm" icon={<SlidersHorizontal size={16} aria-hidden="true" />} aria-expanded={showF} onClick={() => setShowF(x => !x)}
        end={nf ? <span className="dt-n">{nf}</span> : null}>항목별 필터</Btn>
      {active && <Btn kind="ghost" size="sm" onClick={() => set({q: '', from: '', to: '', f: {}})}>필터 지우기</Btn>}
      <span className="grow" />
      <span className="muted" aria-live="polite">전체 {rows.length.toLocaleString()}건{active ? ` 중 ${idx.length.toLocaleString()}건` : ''}</span>
      {onSave && (editing ? <><Btn size="sm" busy={saving} onClick={() => leaveEdit(true)}>저장</Btn>
        <Btn kind="ghost" size="sm" onClick={() => leaveEdit(false)}>취소</Btn></>
        : <Btn kind="ghost" size="sm" onClick={() => setEditing(true)}>수정</Btn>)}
    </div>
    {showF && <div className="fieldrow dt-f enter">
      {cols.filter(c => c.filter).map(fctl)}
      {narrow && <label className="f">정렬<select value={st.s ? `${st.s}:${st.d}` : ''} onChange={e => { const [k, d] = e.target.value ? e.target.value.split(':') : []; set({s: k || '', d: +d || 1}); }}>
        <option value="">기본</option>{cols.filter(c => !c.act && c.label).flatMap(c => [1, -1].map(d => <option key={c.k + d} value={`${c.k}:${d}`}>{`${c.label} ${d > 0 ? '오름차순' : '내림차순'}`}</option>))}</select></label>}
    </div>}
    {!groups.length ? <div className="card"><Empty title={none} /></div>
      : group ? groups.map(g => <details key={g.k} open className="card dt-group"><summary>{groupHead(g.k, members[g.k])}</summary>{body(g.items)}</details>)
        : narrow ? body(groups[0].items) : <div className="card dt-card-w">{body(groups[0].items)}</div>}
    {idx.length > limit && <div className="center"><Btn kind="ghost" onClick={() => setLimit(l => l + LIMIT)}>{LIMIT}건 더 보기</Btn></div>}
  </div>;
}

// 작은 표시: 상태는 배지(ok 연두 · mine 하늘 · warn 빨간 글자), 켜짐/꺼짐은 읽기 전용 체크
export const Tag = ({tone = '', children}) => tone === 'warn' ? <span className="pill warn">{children}</span> : <Pill tone={tone}>{children}</Pill>;
export const Check = ({on, label}) => <span className="ck"><input type="checkbox" checked={!!on} readOnly disabled aria-label={label} /><span>{label}</span></span>;
