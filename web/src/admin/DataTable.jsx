// 표 도구 (Astryx 표 위에): 검색 · 항목별 필터 · 기간 · 정렬 · 묶음 · 고르기 · 칸 바로 고치기 · 더 보기
// columns: {k, label, type:'text'|'num'|'date', val:r=>정렬·필터 값, text:r=>보이는 글자, cell:r=>보이는 화면,
//           filter:'choice'|'text'|false, period:true(기간 필터를 걸 날짜 열), title:true(카드 제목),
//           act:r=>[[이름, 글, 모양], …] (줄 끝 단추), edit:'text'|'num'|'date'|'datetime'|'select'|'multi'|'check', options, raw:r=>고칠 때 처음 값}
// 필터 상태는 주소(#/loans?q=…)에 남는다. 새로고침하거나 주소를 보내도 같은 화면이 나온다. urlState:false 면 남기지 않는다.
import {useEffect, useImperativeHandle, useMemo, useState} from 'react';
import {Table, useTableSortable, useTableSelection} from '@astryxdesign/core/Table';
import {DateInput} from '@astryxdesign/core/DateInput';
import {Card, Badge, Text, HStack, VStack, Grid, Button, TextInput, Selector, CheckboxInput, EmptyState, MetadataList, MetadataListItem, Collapsible} from '../ui/ax.js';
import {Search, SlidersHorizontal} from 'lucide-react';
import {iso, addDays, koStamp} from '../lib/common.js';

const narrowMQ = matchMedia('(max-width:759px)');      // 이보다 좁으면 표 대신 카드
function useNarrow() {
  const [n, setN] = useState(narrowMQ.matches);
  useEffect(() => { const f = () => setN(narrowMQ.matches); narrowMQ.addEventListener('change', f); return () => narrowMQ.removeEventListener('change', f); }, []);
  return n;
}
const LIMIT = 200;
const ALL = '__all';

// 한 묶음(또는 묶음 없는 전체)의 표. 정렬·고르기는 Astryx 표 플러그인이 그린다.
function GroupTable({items, cols, sort, onSort, select, picked, setPicked, cell}) {
  const sortable = useTableSortable({sort, onSortChange: onSort, allowUnsortedState: true});
  const selection = useTableSelection({
    getIsItemSelected: it => picked.has(it.__i),
    onSelectItem: ({item, isSelected}) => setPicked(s => { const n = new Set(s); isSelected ? n.add(item.__i) : n.delete(item.__i); return n; }),
    getIsAllSelected: () => items.length > 0 && items.every(it => picked.has(it.__i)),
    getIsIndeterminate: () => items.some(it => picked.has(it.__i)) && !items.every(it => picked.has(it.__i)),
    onSelectAll: ({isAllSelected}) => setPicked(s => { const n = new Set(s); items.forEach(it => isAllSelected ? n.add(it.__i) : n.delete(it.__i)); return n; }),
    getRowLabel: it => cols[0].text(it.__r),
  });
  // 줄 끝 단추 칸은 단추가 다 들어가는 너비로 고정한다 (글자 수로 어림)
  const actW = c => Math.max(0, ...items.map(it => c.act(it.__r).reduce((w, [, l]) => w + l.length * 14 + 28, 0))) + 16;
  const columns = cols.map(c => ({
    key: c.k, header: c.label, sortable: !c.act, align: c.type === 'num' ? 'end' : undefined,
    width: c.act ? {type: 'pixel', value: actW(c)} : undefined,
    renderCell: it => cell(c, it.__r, it.__i),
  }));
  return <div className="dt-scroll"><Table data={items} columns={columns} idKey="__k" density="compact" hasHover textOverflow="wrap"
    plugins={select ? {sortable, selection} : {sortable}} /></div>;
}

export default function DataTable({ref, path, columns, rows, onAction, onSave, select = false, empty = '아직 아무것도 없습니다.',
  search = '이름, 학번으로 찾기', group, groupHead, cardTitle, urlState = true}) {
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

  // 칸 고치기: 모두 Astryx 입력 부품
  const editor = (c, r, i) => {
    const v = cur(c, r, i), on = x => setEdit(i, c.k, x), a = {label: c.label, isLabelHidden: true, size: 'sm'};
    if (c.edit === 'select') return <Selector {...a} options={c.options} value={v || undefined} onChange={on} width="100%" />;
    if (c.edit === 'multi') return <HStack gap={2} wrap="wrap">{c.options.map(o =>
      <CheckboxInput key={o} label={o} size="sm" value={(v || []).includes(o)} onChange={x => on(x ? [...(v || []), o] : (v || []).filter(y => y !== o))} />)}</HStack>;
    if (c.edit === 'check') return <CheckboxInput label={c.label} isLabelHidden value={!!v} onChange={on} />;
    if (c.edit === 'date') return <DateInput {...a} value={v || undefined} onChange={x => on(x || '')} width="100%" />;
    if (c.edit === 'datetime') return <input className="ce" type="datetime-local" aria-label={c.label} value={v ?? ''} onChange={e => on(e.target.value)} />;
    return <TextInput {...a} type="text" value={String(v ?? '')} onChange={on} inputMode={c.edit === 'num' ? 'numeric' : undefined} width="100%" />;
  };
  const acts = (c, r) => <HStack gap={1} wrap="nowrap">{c.act(r).map(([k, label, variant = 'secondary']) =>
    <Button key={k} label={label} size="sm" variant={variant} onClick={() => onAction?.(k, r)} />)}</HStack>;
  const cell = (c, r, i) => editing && c.edit ? editor(c, r, i) : c.act ? acts(c, r) : c.cell ? c.cell(r) : c.text(r);
  const fctl = c => c.filter === 'choice'
    ? <Selector label={c.label} size="sm" options={[{value: ALL, label: '전체'}, ...choices(c).map(v => ({value: v, label: v}))]} value={st.f[c.k] || ALL}
      onChange={v => set({f: {...st.f, [c.k]: v === ALL ? '' : v}})} hasSearch={choices(c).length > 8} />
    : <TextInput label={c.label} size="sm" value={st.f[c.k] || ''} placeholder="찾기" onChange={v => set({f: {...st.f, [c.k]: v}})} hasClear />;
  const quick = kind => { const t = iso(new Date()); set({to: t, from: kind === 'today' ? t : kind === '7' ? addDays(t, -6) : t.slice(0, 8) + '01'}); };
  const sort = st.s ? [{sortKey: st.s, direction: st.d > 0 ? 'ascending' : 'descending'}] : [];
  const onSort = s => set({s: s[0]?.sortKey || '', d: s[0]?.direction === 'descending' ? -1 : 1});

  // 보이는 줄을 묶음으로 나눈다
  const part = idx.slice(0, limit);
  const groups = [];
  for (const i of part) {
    const k = group ? group(rows[i]) : '';
    if (!groups.length || groups[groups.length - 1].k !== k) groups.push({k, items: []});
    groups[groups.length - 1].items.push({__i: i, __k: String(rows[i].id ?? i), __r: rows[i]});
  }
  const members = {}; if (group) idx.forEach(i => (members[group(rows[i])] ||= []).push(rows[i]));
  const none = active ? '찾는 조건에 맞는 것이 없습니다' : empty;

  const cards = items => <VStack gap={2} className={group ? 'dt-inner' : undefined}>{items.map(({__i: i, __r: r}) => {
    const tc = cols.find(c => c.k === cardTitle) || cols.find(c => c.title) || cols[0], ac = cols.find(c => c.act);
    return <Card key={r.id ?? i} padding={4} variant={group ? 'muted' : undefined}><VStack gap={3}>
      <HStack gap={2} vAlign="center">{select && <CheckboxInput label="고르기" isLabelHidden value={picked.has(i)}
        onChange={x => setPicked(s => { const n = new Set(s); x ? n.add(i) : n.delete(i); return n; })} />}
        <Text weight="semibold">{cell(tc, r, i)}</Text></HStack>
      <MetadataList columns="single">{cols.filter(c => c !== tc && !c.act && (editing && c.edit || c.cell?.(r) || c.text(r))).map(c =>
        <MetadataListItem key={c.k} label={c.label}>{cell(c, r, i)}</MetadataListItem>)}</MetadataList>
      {ac && acts(ac, r)}
    </VStack></Card>;
  })}</VStack>;
  const body = items => narrow ? cards(items)
    : <GroupTable items={items} cols={cols} sort={sort} onSort={onSort} select={select} picked={picked} setPicked={setPicked} cell={cell} />;

  return <VStack gap={3}>
    <HStack gap={2} wrap="wrap" vAlign="end">
      <div className="dt-q"><TextInput type="search" label="찾기" isLabelHidden value={st.q} placeholder={search} onChange={v => set({q: v})} hasClear startIcon={<Search size={16} />} /></div>
      {pcol && <div className="dt-period">
        <DateInput label={`${pcol.label} 시작`} isLabelHidden placeholder={`${pcol.label} 부터`} value={st.from || undefined} onChange={v => set({from: v || ''})} hasClear width="100%" />
        <DateInput label={`${pcol.label} 끝`} isLabelHidden placeholder="까지" value={st.to || undefined} onChange={v => set({to: v || ''})} hasClear width="100%" />
        <HStack gap={1} className="dt-quick">
          <Button label="오늘" size="sm" variant="ghost" onClick={() => quick('today')} />
          <Button label="최근 7일" size="sm" variant="ghost" onClick={() => quick('7')} />
          <Button label="이번 달" size="sm" variant="ghost" onClick={() => quick('month')} /></HStack></div>}
      <Button label="항목별 필터" variant={showF ? 'primary' : 'secondary'} icon={<SlidersHorizontal size={16} />} onClick={() => setShowF(x => !x)}
        endContent={nf ? <Badge variant="neutral" label={nf} /> : undefined} />
      {active && <Button label="필터 지우기" variant="ghost" onClick={() => set({q: '', from: '', to: '', f: {}})} />}
      <span className="dt-sp" />
      <Text type="supporting" color="secondary" aria-live="polite">전체 {rows.length.toLocaleString()}건{active ? ` 중 ${idx.length.toLocaleString()}건` : ''}</Text>
      {onSave && (editing ? <><Button label="저장" variant="primary" isLoading={saving} onClick={() => leaveEdit(true)} />
        <Button label="취소" variant="secondary" onClick={() => leaveEdit(false)} /></>
        : <Button label="수정" variant="secondary" onClick={() => setEditing(true)} />)}
    </HStack>
    {showF && <Card variant="muted" padding={3} className="enter"><Grid columns={{minWidth: 170, repeat: 'fill'}} gap={3}>
      {cols.filter(c => c.filter).map(c => <div key={c.k}>{fctl(c)}</div>)}
      {narrow && <Selector label="정렬" size="sm" value={st.s ? `${st.s}:${st.d}` : ALL} onChange={v => { const [k, d] = v === ALL ? [] : v.split(':'); set({s: k || '', d: +d || 1}); }}
        options={[{value: ALL, label: '기본'}, ...cols.filter(c => !c.act).flatMap(c => [1, -1].map(d => ({value: `${c.k}:${d}`, label: `${c.label} ${d > 0 ? '오름차순' : '내림차순'}`})))]} />}
    </Grid></Card>}
    {!groups.length ? <Card><EmptyState isCompact title={none} /></Card>
      : group ? <VStack gap={3}>{groups.map(g => <Card key={g.k} padding={0} className="dt-group">
        <Collapsible defaultIsOpen trigger={<div className="dt-gh">{groupHead(g.k, members[g.k])}</div>}>{body(g.items)}</Collapsible></Card>)}</VStack>
        : narrow ? body(groups[0].items) : <Card padding={0}>{body(groups[0].items)}</Card>}
    {idx.length > limit && <HStack hAlign="center"><Button label={`${LIMIT}건 더 보기`} variant="secondary" onClick={() => setLimit(l => l + LIMIT)} /></HStack>}
  </VStack>;
}

// 작은 표시: 상태는 Astryx 배지, 켜짐/꺼짐은 읽기 전용 체크
export const Tag = ({tone = '', children}) => <Badge variant={{ok: 'green', mine: 'blue', warn: 'error'}[tone] || 'neutral'} label={children} />;
export const Check = ({on, label}) => <CheckboxInput label={label} isLabelHidden value={!!on} isReadOnly />;
