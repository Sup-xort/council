// 표 도구: 검색 · 열별 필터 · 기간 · 정렬 · 묶음 · 고르기 · 칸 바로 고치기 · 더 보기
// columns: {k, label, type:'text'|'num'|'date', val:r=>정렬·필터 값, text:r=>보이는 글자, cell:r=>보이는 화면,
//           filter:'choice'|'text'|false, period:true(기간 필터를 걸 날짜 열), title:true(카드 제목),
//           act:r=>[[이름, 글, 모양], …] (줄 끝 단추), edit:'text'|'num'|'date'|'datetime'|'select'|'multi'|'check', options, raw:r=>고칠 때 처음 값}
// 필터 상태는 주소(#/loans?q=…)에 남는다. 새로고침하거나 주소를 보내도 같은 화면이 나온다. urlState:false 면 남기지 않는다.
import {useEffect, useImperativeHandle, useMemo, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {iso, addDays, koStamp} from '../lib/common.js';

const narrowMQ = matchMedia('(max-width:759px)');      // 이보다 좁으면 표 대신 카드
function useNarrow() {
  const [n, setN] = useState(narrowMQ.matches);
  useEffect(() => { const f = () => setN(narrowMQ.matches); narrowMQ.addEventListener('change', f); return () => narrowMQ.removeEventListener('change', f); }, []);
  return n;
}
const LIMIT = 200;

export default function DataTable({ref, path, columns, rows, onAction, onSave, select = false, empty = '아직 아무것도 없습니다.',
  search = '이름, 학번으로 찾기', group, groupHead, urlState = true}) {
  const narrow = useNarrow();
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
  const [closed, setClosed] = useState(() => new Set());   // 접어 둔 묶음
  const [picked, setPicked] = useState(() => new Set());
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState(() => new Map());     // 줄 번호 → {칸: 새 값}
  const [saving, setSaving] = useState(false);

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
  const active = !!(st.q || st.from || st.to || Object.values(st.f).some(Boolean));

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

  const editor = (c, r, i) => {
    const v = cur(c, r, i), on = x => setEdit(i, c.k, x), a = {'aria-label': c.label};
    if (c.edit === 'select') return <select className="in ce" {...a} value={v ?? ''} onChange={e => on(e.target.value)}><option value="" />{c.options.map(o => <option key={o}>{o}</option>)}</select>;
    if (c.edit === 'multi') return <div className="multi" {...a}>{c.options.map(o => <label className="chk" key={o}>
      <input type="checkbox" checked={(v || []).includes(o)} onChange={e => on(e.target.checked ? [...(v || []), o] : (v || []).filter(x => x !== o))} />{o}</label>)}</div>;
    if (c.edit === 'check') return <input type="checkbox" {...a} checked={!!v} onChange={e => on(e.target.checked)} />;
    const t = c.edit === 'num' ? 'number' : c.edit === 'datetime' ? 'datetime-local' : c.edit === 'date' ? 'date' : 'text';
    return <input className="in ce" type={t} min={c.edit === 'num' ? 1 : undefined} {...a} value={v ?? ''} onChange={e => on(e.target.value)} />;
  };
  const acts = (c, r) => <div className="inline">{c.act(r).map(([k, label, variant = 'secondary']) =>
    <Button key={k} label={label} size="sm" variant={variant} onClick={() => onAction?.(k, r)} />)}</div>;
  const cell = (c, r, i) => editing && c.edit ? editor(c, r, i) : c.act ? acts(c, r) : c.cell ? c.cell(r) : c.text(r);
  const fctl = c => c.filter === 'choice'
    ? <select className="in" aria-label={`${c.label} 고르기`} value={st.f[c.k] || ''} onChange={e => set({f: {...st.f, [c.k]: e.target.value}})}>
      <option value="">전체</option>{choices(c).map(v => <option key={v}>{v}</option>)}</select>
    : c.filter === 'text' ? <input className="in" value={st.f[c.k] || ''} placeholder="찾기" aria-label={`${c.label}에서 찾기`} onChange={e => set({f: {...st.f, [c.k]: e.target.value}})} /> : null;
  const sortBy = k => setSt(s => ({...s, d: s.s === k ? -s.d : 1, s: k}));
  const quick = kind => { const t = iso(new Date()); set({to: t, from: kind === 'today' ? t : kind === '7' ? addDays(t, -6) : t.slice(0, 8) + '01'}); };
  const pick = (i, on) => setPicked(s => { const n = new Set(s); on ? n.add(i) : n.delete(i); return n; });

  // 묶음이 바뀌는 곳마다 머리글을 끼우고, 접힌 묶음의 행은 건너뛴다
  const part = idx.slice(0, limit), members = {};
  if (group) idx.forEach(i => (members[group(rows[i])] ||= []).push(rows[i]));
  const ncol = cols.length + (select ? 1 : 0);
  const out = []; let last;
  for (const i of part) {
    const r = rows[i];
    if (group) {
      const k = group(r);
      if (k !== last) {
        last = k;
        const head = <button type="button" className="gbtn" aria-expanded={!closed.has(k)}
          onClick={() => setClosed(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })}>
          <span aria-hidden="true" className={'tw' + (closed.has(k) ? '' : ' open')}>▸</span> {groupHead(k, members[k])}</button>;
        out.push(narrow ? <h3 className="gh" key={'g' + k}>{head}</h3> : <tr className="gh" key={'g' + k}><td colSpan={ncol}>{head}</td></tr>);
      }
      if (closed.has(k)) continue;
    }
    if (narrow) {
      const tc = cols.find(c => c.title) || cols[0], ac = cols.find(c => c.act);
      out.push(<article className="rc" key={r.id ?? i}>
        <div className="t">{select && <input type="checkbox" checked={picked.has(i)} onChange={e => pick(i, e.target.checked)} aria-label="고르기" />}<span>{cell(tc, r, i)}</span></div>
        <dl>{cols.filter(c => c !== tc && !c.act).map(c => <div key={c.k} style={{display: 'contents'}}><dt>{c.label}</dt><dd>{cell(c, r, i)}</dd></div>)}</dl>
        {ac && acts(ac, r)}</article>);
    } else {
      out.push(<tr key={r.id ?? i}>
        {select && <td className="ck"><input type="checkbox" checked={picked.has(i)} onChange={e => pick(i, e.target.checked)} aria-label="고르기" /></td>}
        {cols.map(c => <td key={c.k} className={c.act ? 'act' : c.type === 'num' ? 'num' : ''} title={c.act ? undefined : c.text(r)}>{cell(c, r, i)}</td>)}</tr>);
    }
  }
  const none = active ? '찾는 조건에 맞는 것이 없습니다.' : empty;
  const allOn = idx.length > 0 && idx.every(i => picked.has(i));

  return <div className="dt-host">
    <div className="dt-tools">
      <div className="q"><TextInput type="search" label="찾기" isLabelHidden value={st.q} placeholder={search} onChange={v => set({q: v})} hasClear size="md" /></div>
      {pcol && <div className="dt-period"><span className="lab">{pcol.label}</span>
        <input className="in" type="date" value={st.from} aria-label="시작일" onChange={e => set({from: e.target.value})} /><span className="lab">~</span>
        <input className="in" type="date" value={st.to} aria-label="끝일" onChange={e => set({to: e.target.value})} />
        <Button label="오늘" size="sm" variant="secondary" onClick={() => quick('today')} />
        <Button label="최근 7일" size="sm" variant="secondary" onClick={() => quick('7')} />
        <Button label="이번 달" size="sm" variant="secondary" onClick={() => quick('month')} /></div>}
      {active && <Button label="필터 지우기" size="sm" variant="ghost" onClick={() => set({q: '', from: '', to: '', f: {}})} />}
      <span className="dt-count" aria-live="polite">전체 {rows.length.toLocaleString()}건{active ? ` 중 ${idx.length.toLocaleString()}건` : ''}</span>
      {onSave && (editing ? <><Button label="저장" size="sm" variant="primary" isLoading={saving} onClick={() => leaveEdit(true)} />
        <Button label="취소" size="sm" variant="secondary" onClick={() => leaveEdit(false)} /></>
        : <Button label="수정" size="sm" variant="secondary" onClick={() => setEditing(true)} />)}
      {narrow && <details className="dt-flt" open={Object.values(st.f).some(Boolean) || undefined}><summary>항목별 필터와 정렬</summary><div className="grid">
        {cols.filter(c => c.filter).map(c => <label key={c.k}>{c.label}{fctl(c)}</label>)}
        <label>정렬<select className="in" value={st.s ? `${st.s}:${st.d}` : ''} onChange={e => { const [k, d] = e.target.value.split(':'); set({s: k || '', d: +d || 1}); }}>
          <option value="">기본</option>{cols.filter(c => !c.act).map(c => [1, -1].map(d =>
            <option key={c.k + d} value={`${c.k}:${d}`}>{c.label} {d > 0 ? '오름차순' : '내림차순'}</option>))}</select></label>
      </div></details>}
    </div>
    {narrow ? <div className="dt-cards">{out.length ? out : <div className="dt-empty box">{none}</div>}</div>
      : <div className="dt-wrap"><table className="dt"><thead><tr>
        {select && <th className="ck"><input type="checkbox" aria-label="보이는 행 모두 고르기" checked={allOn}
          onChange={e => setPicked(s => { const n = new Set(s); idx.forEach(i => e.target.checked ? n.add(i) : n.delete(i)); return n; })} /></th>}
        {cols.map(c => <th key={c.k} className={c.type === 'num' ? 'num' : ''}>{c.act ? <span className="sort" />
          : <button className="sort" onClick={() => sortBy(c.k)} aria-sort={st.s === c.k ? (st.d > 0 ? 'ascending' : 'descending') : undefined}>
            {c.label}<span aria-hidden="true" className={'arr' + (st.s === c.k ? ' on' : '')}>{st.s === c.k && st.d < 0 ? '▼' : '▲'}</span></button>}</th>)}</tr>
        {cols.some(c => c.filter) && <tr className="flt">{select && <th />}{cols.map(c => <th key={c.k}>{fctl(c)}</th>)}</tr>}</thead>
        <tbody>{out.length ? out : <tr><td colSpan={ncol} className="dt-empty">{none}</td></tr>}</tbody></table></div>}
    {idx.length > limit && <div className="dt-more"><Button label={`${LIMIT}건 더 보기`} variant="secondary" onClick={() => setLimit(l => l + LIMIT)} /></div>}
  </div>;
}

// 작은 표시
export const Tag = ({tone = '', children}) => <span className={'tag ' + tone}>{children}</span>;
export const Check = ({on, label}) => <input type="checkbox" disabled checked={!!on} aria-label={label} />;
