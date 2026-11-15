// 관리 사이트 화면들 (글쓰기 둘은 Write.jsx)
import {useRef, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Selector} from '@astryxdesign/core/Selector';
import {api, toast, josa, iso, koDate, koTime, koRange, koStamp, koSpan, toDate} from '../lib/common.js';
import {useAsk, useLoad} from '../ui/base.jsx';
import DataTable, {Tag, Check} from './DataTable.jsx';

export const KIND = {dept: '학과 공지', event: '행사 공지'};
export const ROLE = {user: '학생', admin: '관리자', super: '최고 관리자'};
export function Head({title, desc, tools}) {
  return <div className="ph"><h1>{title}</h1>{tools}{desc && <p>{desc}</p>}</div>;
}
export const Loading = () => <div className="skel" style={{height: 320}} />;
// 표에서 고친 칸 저장 — 서버가 한 줄이라도 틀렸다고 하면 아무것도 바뀌지 않는다
const saver = (tbl, reload) => async changes => {
  await api('admin/cells', {table: tbl, rows: changes}); toast(`${changes.length}건을 저장했습니다`); reload();
};
// 시간을 읽기 쉽게: 48 → 2일, 50 → 2일 2시간, 5 → 5시간
export const hText = h => h < 24 ? `${h}시간` : h % 24 ? `${Math.floor(h / 24)}일 ${h % 24}시간` : `${h / 24}일`;
const lateText = h => `${hText(h)} 지남`;

// ── 물품 ──────────────────────────────────────────────────────────────
function Rule({r, reload}) {
  const [h, setH] = useState(String(r.hours));
  const save = async e => {
    e.preventDefault();
    const d = await api('admin/kind_hours', {kind: r.kind, hours: h});
    toast(`${josa(r.kind, '은', '는')} ${hText(d.hours)} 안에 반납하면 됩니다`); reload();
  };
  return <form className="rule" onSubmit={save}><b>{r.kind}</b>
    <div className="inline" style={{marginTop: 8, flexWrap: 'nowrap'}}>
      <input className="in" type="number" inputMode="numeric" min="1" max="8760" value={h} onChange={e => setH(e.target.value)} aria-label={`${r.kind} 빌릴 수 있는 시간`} style={{width: 84}} />
      <span className="muted">시간</span><span className="muted" style={{flex: '1 1 auto', fontSize: 13}}>{+h > 0 ? hText(+h) : ''}</span>
      <Button type="submit" label="저장" size="sm" variant="primary" /></div>
    <div className="inline" style={{marginTop: 8, gap: 6}}>{[[24, '하루'], [48, '이틀'], [72, '사흘'], [168, '일주일']].map(([v, n]) =>
      <button type="button" className="chip" key={v} onClick={() => setH(String(v))}>{n}</button>)}</div>
  </form>;
}
export function Items({path}) {
  const ask = useAsk();
  const {data: d, reload} = useLoad(() => api('admin/items'), []);
  const [kind, setKind] = useState(''), [count, setCount] = useState('1'), [size, setSize] = useState('2');
  const table = useRef(null);
  if (!d) return <><Head title="물품" /><Loading /></>;
  const hours = Object.fromEntries(d.rules.map(r => [r.kind, r.hours]));
  const add = async e => { e.preventDefault(); await api('admin/item_add', {kind, count: +count}); toast('추가했습니다'); setKind(''); setCount('1'); reload(); };
  const pdf = () => {
    const ids = table.current.picked().map(r => r.id);
    if (!ids.length) return toast('인쇄할 물품을 표에서 먼저 고르십시오');
    location.href = `api/admin/qr.pdf?size=${size}&ids=${ids.join(',')}`;
  };
  return <div className="enter">
    <Head title="물품" desc="번호는 자동으로 붙습니다. 우산 3개를 넣으면 1번~3번이 되고, 우산을 또 넣으면 4번부터 이어집니다." />
    <div className="tops">
      <form className="box inline" onSubmit={add}><b style={{marginRight: 4}}>물품 추가</b>
        <div style={{flex: '1 1 140px'}}><TextInput label="종류" isLabelHidden placeholder="종류 (예: 우산)" value={kind} onChange={setKind} isRequired /></div>
        <span className="inline" style={{flexWrap: 'nowrap'}}><input className="in" type="number" min="1" max="100" value={count} onChange={e => setCount(e.target.value)} aria-label="개수" style={{width: 72}} /><span className="muted">개</span></span>
        <Button type="submit" label="추가" variant="primary" /></form>
      <div className="box inline"><b style={{marginRight: 4}}>QR 인쇄</b>
        <select className="in" value={size} onChange={e => setSize(e.target.value)} aria-label="QR 크기">{d.qr_sizes.map(s => <option key={s} value={s}>한 변 {s}cm</option>)}</select>
        <Button label="고른 물품 QR PDF 받기" variant="primary" onClick={pdf} />
        <span className="muted" style={{flex: '1 0 100%', fontSize: 13}}>표에서 고른 물품만 인쇄합니다. 인쇄는 실제 크기(100%)로 하십시오.</span></div>
    </div>
    {d.rules.length > 0 && <section className="box" aria-labelledby="rh" style={{marginBottom: 16}}><h2 id="rh" style={{fontSize: 15, margin: 0}}>종류별 빌릴 수 있는 시간</h2>
      <p className="muted" style={{margin: '2px 0 12px', fontSize: 13}}>빌려 간 뒤 이 시간 안에 반납해야 합니다. 정하지 않은 종류는 {hText(d.default_hours)}입니다. 시간이 지나도 반납하지 않은 물품은 ‘대여 기록’ 맨 위에 따로 모아 보여 드립니다.</p>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 10}}>{d.rules.map(r => <Rule key={r.kind + r.hours} r={r} reload={reload} />)}</div></section>}
    <DataTable ref={table} path={path} rows={d.items} select onSave={saver('items', reload)} search="물품, 코드, 대여자로 찾기" empty="위에서 물품 종류와 개수를 넣어 추가하십시오."
      group={r => r.kind || r.name}
      groupHead={(k, list) => <><b>{k}</b> <span className="muted">{list.length}개 · 대여 중 {list.filter(r => r.who).length}개 · 최대 {hText(hours[k] ?? d.default_hours)}</span>
        {list.some(r => r.late_hours) && <> <Tag tone="warn">기한 지남 {list.filter(r => r.late_hours).length}개</Tag></>}</>}
      columns={[
        {k: 'kind', label: '종류', filter: 'choice', title: true, edit: 'text', val: r => r.kind || r.name},
        {k: 'num', label: '번호', type: 'num', filter: false, edit: 'num', text: r => r.num ? `${r.num}번` : ''},
        {k: 'code', label: 'QR 코드', edit: 'text'},
        {k: 'state', label: '상태', filter: 'choice', val: r => r.who ? (r.late_hours ? '기한 지남' : '대여 중') : '보관 중',
          cell: r => r.who ? (r.late_hours ? <Tag tone="warn">기한 지남</Tag> : <Tag tone="mine">대여 중</Tag>) : <Tag tone="ok">보관 중</Tag>},
        {k: 'who', label: '대여자'}, {k: 'student_id', label: '학번'},
        {k: 'borrowed_at', label: '대여일자', type: 'date', period: true},
        {k: 'since', label: '빌린 기간', filter: false, val: r => r.borrowed_at ? -toDate(r.borrowed_at) : null, text: r => r.borrowed_at ? koSpan(r.borrowed_at) + '째' : ''},
        {k: 'due', label: '반납 기한', filter: false, val: r => r.due || '', text: r => r.due ? koStamp(r.due) + '까지' : '',
          cell: r => r.due ? <>{koStamp(r.due)}까지{r.late_hours ? <> <Tag tone="warn">{lateText(r.late_hours)}</Tag></> : null}</> : ''},
        {k: '_', label: '', act: r => [...(r.who ? [['ret', '반납 처리']] : []), ['del', '삭제', 'destructive']]},
      ]}
      onAction={async (a, r) => {
        if (a === 'ret' && await ask.confirm(`${josa(r.name, '을', '를')} 반납 처리하시겠습니까?`, {actionLabel: '반납 처리'})) { await api('admin/item_return', {id: r.id}); toast('반납 처리했습니다'); reload(); }
        if (a === 'del' && await ask.confirm(`${josa(r.name, '을', '를')} 삭제하시겠습니까?`, {description: '붙여 둔 QR은 더 이상 쓸 수 없고, 이 물품의 대여 기록도 함께 삭제됩니다.', actionLabel: '삭제', danger: true})) {
          await api('admin/item_del', {id: r.id}); toast('삭제했습니다'); reload();
        }
      }} />
  </div>;
}

// ── 대여 기록 (전부) ──────────────────────────────────────────────────
export function Loans({path}) {
  const ask = useAsk();
  const {data, reload} = useLoad(() => Promise.all([api('admin/loans'), api('admin/users'), api('admin/items')]), []);
  if (!data) return <><Head title="대여 기록" /><Loading /></>;
  const [d, us, its] = data;
  const whoLabel = u => `${u.name} (${u.student_id})`, itemNames = its.items.map(i => i.name);
  const open = d.loans.filter(l => !l.in_at).length;
  const late = d.loans.filter(l => !l.in_at && l.late_hours).sort((a, b) => b.late_hours - a.late_hours);
  return <div className="enter">
    <Head title="대여 기록" desc={`${open ? `아직 반납하지 않은 물품이 ${open}개 있습니다.` : '대여 중인 물품이 없습니다. 모두 반납됐습니다.'} 빌릴 수 있는 시간은 ‘물품’ 탭에서 종류별로 정합니다.`} />
    <section aria-labelledby="lh" style={{marginBottom: 28}}><h2 id="lh" style={{fontSize: 16, margin: '0 0 8px'}}>기한이 지난 대여 {late.length > 0 && <Tag tone="warn">{late.length}건</Tag>}</h2>
      <DataTable path={path} rows={late} urlState={false} search="물품, 이름, 학번으로 찾기" empty="기한이 지난 대여가 없습니다."
        onAction={async (a, r) => { if (a === 'ret' && await ask.confirm(`${josa(r.item, '을', '를')} 반납 처리하시겠습니까?`, {actionLabel: '반납 처리'})) { await api('admin/item_return', {id: r.item_id}); toast('반납 처리했습니다'); reload(); } }}
        columns={[
          {k: 'item', label: '물품', title: true}, {k: 'kind', label: '종류', filter: 'choice'},
          {k: 'who', label: '이름'}, {k: 'student_id', label: '학번'}, {k: 'email', label: '이메일'},
          {k: 'out_at', label: '대여일자', type: 'date'},
          {k: 'due', label: '반납 기한', filter: false, text: r => koStamp(r.due) + '까지'},
          {k: 'late_hours', label: '지난 시간', type: 'num', filter: false, text: r => lateText(r.late_hours), cell: r => <Tag tone="warn">{lateText(r.late_hours)}</Tag>},
          {k: '_', label: '', act: () => [['ret', '반납 처리']]},
        ]} /></section>
    <h2 style={{fontSize: 16, margin: '0 0 8px'}}>전체 기록</h2>
    <DataTable path={path} rows={d.loans} onSave={saver('loans', reload)} search="물품, 이름, 학번으로 찾기" empty="아직 대여 기록이 없습니다."
      columns={[
        {k: 'item', label: '물품', title: true, edit: 'select', options: itemNames}, {k: 'kind', label: '종류', filter: 'choice'},
        {k: 'who', label: '이름', edit: 'select', options: us.users.map(whoLabel), raw: r => `${r.who} (${r.student_id})`}, {k: 'student_id', label: '학번'}, {k: 'email', label: '이메일'},
        {k: 'out_at', label: '대여일자', type: 'date', period: true, edit: 'datetime'},
        {k: 'in_at', label: '반납일자', type: 'date', edit: 'datetime', cell: r => r.in_at ? koStamp(r.in_at) : <Tag tone="warn">{r.late_hours ? '기한 지남' : '반납 안 함'}</Tag>},
        {k: 'span', label: '빌린 기간', filter: false, val: r => (toDate(r.in_at) || new Date()) - toDate(r.out_at), text: r => koSpan(r.out_at, r.in_at) + (r.in_at ? '' : '째')},
        {k: 'state', label: '상태', filter: 'choice', val: r => r.in_at ? '반납함' : r.late_hours ? '기한 지남' : '반납 안 함'},
      ]} />
  </div>;
}

// ── 예약 기록 (지금 남아 있는 예약 전부) ─────────────────────────────
export function Reservations({path}) {
  const ask = useAsk();
  const {data, reload} = useLoad(() => Promise.all([api('admin/reservations'), api('admin/users')]), []);
  if (!data) return <><Head title="예약 기록" /><Loading /></>;
  const [d, us] = data, today = iso(new Date()), hourOpts = n => Array.from({length: n}, (_, h) => `${h}시`);
  return <div className="enter">
    <Head title="예약 기록" desc="취소된 예약은 남지 않습니다. 수정에서 날짜·시간·방·예약자를 고칠 수 있으며, 다른 예약과 겹치는 시간으로는 바꿀 수 없습니다." />
    <DataTable path={path} rows={d.reservations} onSave={saver('reservations', reload)} empty="예약이 없습니다."
      columns={[
        {k: 'date', label: '사용일자', type: 'date', period: true, title: true, edit: 'date', val: r => r.date, text: r => koDate(r.date)},
        {k: 'start', label: '시작', filter: false, edit: 'select', options: hourOpts(24), raw: r => `${r.start}시`, val: r => r.start, text: r => koTime(r.start)},
        {k: 'end', label: '끝', filter: false, edit: 'select', options: hourOpts(25).slice(1), raw: r => `${r.end}시`, val: r => r.end, text: r => koTime(r.end)},
        {k: 'hours', label: '길이', type: 'num', filter: false, val: r => r.end - r.start, text: r => `${r.end - r.start}시간`},
        {k: 'room', label: '방', filter: 'choice', edit: 'select', options: d.rooms},
        {k: 'who', label: '이름', edit: 'select', options: us.users.map(u => `${u.name} (${u.student_id})`), raw: r => `${r.who} (${r.student_id})`}, {k: 'student_id', label: '학번'}, {k: 'email', label: '이메일'},
        {k: 'created_at', label: '예약일자', type: 'date'},
        {k: 'when', label: '구분', filter: 'choice', val: r => r.date < today ? '지난 예약' : r.date === today ? '오늘' : '앞으로'},
        {k: '_', label: '', act: r => r.date >= today ? [['cancel', '취소', 'destructive']] : []},
      ]}
      onAction={async (a, r) => {
        if (a === 'cancel' && await ask.confirm(`예약을 취소하시겠습니까?`, {description: `${r.who} 님의 ${koDate(r.date)} ${koRange(r.start, r.end)} ${r.room} 예약`, actionLabel: '예약 취소', danger: true})) {
          await api('unreserve', {ids: r.ids}); toast('취소했습니다'); reload();
        }
      }} />
  </div>;
}

// ── 행사 ──────────────────────────────────────────────────────────────
export function Events({path}) {
  const ask = useAsk();
  const {data: d, reload} = useLoad(() => api('admin/events'), []);
  const head = <Head title="행사" tools={<Button label="+ 새 행사" variant="primary" href="#/event/new" />} />;
  if (!d) return <>{head}<Loading /></>;
  return <div className="enter">{head}
    <DataTable path={path} rows={d.events} onSave={saver('events', reload)} search="행사 이름으로 찾기" empty="행사가 없습니다."
      columns={[
        {k: 'title', label: '제목', title: true, edit: 'text'},
        {k: 'starts_at', label: '행사일자', type: 'date', edit: 'datetime'},
        {k: 'deadline', label: '신청 마감', type: 'date', period: true, edit: 'datetime'},
        {k: 'n', label: '신청', type: 'num', filter: false, text: r => `${r.n}명${r.capacity ? ` / ${r.capacity}명` : ''}`},
        {k: 'capacity', label: '정원', type: 'num', filter: false, edit: 'num', text: r => r.capacity ? `${r.capacity}명` : '제한 없음'},
        {k: 'state', label: '상태', filter: 'choice', val: r => r.closed ? '마감' : r.capacity && r.n >= r.capacity ? '정원 마감' : '모집 중'},
        {k: 'dues_only', label: '납부자만 신청', filter: 'choice', edit: 'check', val: r => r.dues_only ? '납부자만' : '모두', cell: r => <Check on={r.dues_only} label={r.dues_only ? '납부자만' : '모두'} />},
        {k: 'on_lobby', label: '로비', filter: 'choice', edit: 'check', val: r => r.on_lobby ? '보임' : '숨김', cell: r => <Check on={r.on_lobby} label={r.on_lobby ? '보임' : '숨김'} />},
        {k: '_', label: '', act: () => [['apps', '신청자'], ['edit', '수정'], ['del', '삭제', 'destructive']]},
      ]}
      onAction={async (a, r) => {
        if (a === 'apps') location.hash = `#/apps?event=${r.id}`;
        if (a === 'edit') location.hash = `#/event/${r.id}`;
        if (a === 'del' && await ask.confirm(`'${r.title}' 행사를 삭제하시겠습니까?`, {description: `신청 ${r.n}건도 함께 삭제됩니다.`, actionLabel: '삭제', danger: true})) {
          await api('admin/event_del', {id: r.id}); toast('삭제했습니다'); reload();
        }
      }} />
  </div>;
}

// ── 신청자 ────────────────────────────────────────────────────────────
export function Apps({path, q}) {
  const eid = q.get('event') || '';
  const {data, reload} = useLoad(async () => {
    const d = await api('admin/applications' + (eid ? '?id=' + eid : ''));
    return [d, eid ? (await api('admin/events')).events : d.events];
  }, [eid]);
  if (!data) return <><Head title="신청자" /><Loading /></>;
  const [d, all] = data;
  const ev = d.event, byId = Object.fromEntries(d.events.map(e => [e.id, e]));
  const answer = (f, v) => f.type === 'checkbox' ? (v ? '체크함' : '체크 안 함') : f.type === 'multi' ? (v || []).join(', ') : v ?? '';
  const allQuestions = [...new Set(d.events.flatMap(e => e.fields.map(f => f.label)))];
  const cols = [
    ...(ev ? [] : [{k: 'event', label: '행사', filter: 'choice', title: true, val: r => byId[r.event_id]?.title || ''}]),
    {k: 'name', label: '이름', title: !!ev}, {k: 'student_id', label: '학번'}, {k: 'email', label: '이메일'},
    {k: 'dues', label: '학생회비 납부', filter: 'choice', edit: 'check', val: r => r.dues ? '납부' : '미납부', cell: r => <Check on={r.dues} label={r.dues ? '납부' : '미납부'} />},
    ...(ev ? ev.fields.map((f, i) => ({k: 'f' + i, label: f.label, filter: f.type === 'text' || f.type === 'long' ? 'text' : 'choice', val: r => answer(f, r.answers[i]),
      edit: f.type === 'checkbox' ? 'check' : f.type === 'select' || f.type === 'dropdown' ? 'select' : f.type === 'multi' ? 'multi' : 'text', options: f.options,
      raw: r => r.answers[i] ?? (f.type === 'checkbox' ? false : f.type === 'multi' ? [] : '')}))
      : allQuestions.map((label, n) => {      // 모든 행사: 질문 이름마다 한 열. 그 질문이 없는 행사의 신청은 빈칸
        const at = r => (byId[r.event_id]?.fields || []).findIndex(f => f.label === label);
        const types = d.events.flatMap(e => e.fields.filter(f => f.label === label).map(f => f.type));
        return {k: 'q' + n, label, filter: types.every(t => t === 'text' || t === 'long') ? 'text' : 'choice',
          val: r => { const i = at(r), f = byId[r.event_id]?.fields[i]; return f ? answer(f, r.answers[i]) : ''; }};
      })),
    {k: 'created_at', label: '신청일자', type: 'date', period: true, edit: 'datetime', val: r => r.created_at || r.updated_at},
    {k: 'updated_at', label: '수정일자', type: 'date', edit: 'datetime', val: r => r.created_at && r.updated_at !== r.created_at ? r.updated_at : ''},
  ];
  const opts = [{value: 'all', label: '모든 행사'}, ...all.map(e => ({value: String(e.id), label: e.title}))];
  return <div className="enter" key={eid}>
    <Head title="신청자" desc={ev ? `${ev.title} 신청 ${d.applications.length}명` : `모든 행사의 신청 ${d.applications.length}건`}
      tools={<div style={{width: 320, maxWidth: '100%'}}><Selector label="행사 고르기" isLabelHidden options={opts} value={eid || 'all'}
        onChange={v => { location.hash = '#/apps' + (v && v !== 'all' ? '?event=' + v : ''); }} /></div>} />
    <DataTable path={eid ? `/apps?event=${eid}` : path} rows={d.applications} columns={cols} onSave={saver('apps', reload)} empty="아직 신청한 사람이 없습니다." />
  </div>;
}

// ── 공지 ──────────────────────────────────────────────────────────────
export function Notices({path}) {
  const ask = useAsk();
  const {data: d, reload} = useLoad(() => api('admin/notices'), []);
  const head = <Head title="공지" tools={<Button label="+ 글쓰기" variant="primary" href="#/notice/new" />} />;
  if (!d) return <>{head}<Loading /></>;
  const save = saver('notices', reload);
  return <div className="enter">{head}
    <DataTable path={path} rows={d.notices} search="제목, 쓴 사람으로 찾기" empty="아직 올린 공지가 없습니다."
      onSave={ch => save(ch.map(c => c.vals.kind ? {...c, vals: {...c.vals, kind: Object.keys(KIND).find(k => KIND[k] === c.vals.kind)}} : c))}
      columns={[
        {k: 'title', label: '제목', title: true, edit: 'text'}, {k: 'summary', label: '요약', filter: false, edit: 'text'},
        {k: 'kind', label: '분류', filter: 'choice', edit: 'select', options: Object.values(KIND), raw: r => KIND[r.kind], val: r => KIND[r.kind]},
        {k: 'created_at', label: '작성일자', type: 'date', period: true, edit: 'datetime', text: r => koDate(r.created_at)},
        {k: 'author', label: '쓴 사람', filter: 'choice'},
        {k: 'lobby', label: '로비 맨 위', filter: 'choice', edit: 'check', raw: r => r.on_lobby, val: r => r.on_lobby ? '보임' : '숨김', cell: r => <Check on={r.on_lobby} label={r.on_lobby ? '보임' : '숨김'} />},
        {k: 'ev', label: '연결된 행사', val: r => r.event?.title || ''},
        {k: '_', label: '', act: () => [['view', '보기'], ['edit', '수정'], ['del', '삭제', 'destructive']]},
      ]}
      onAction={async (a, r) => {
        if (a === 'view') window.open(`./#/notice/${r.id}`, '_blank');
        if (a === 'edit') location.hash = `#/notice/${r.id}`;
        if (a === 'del' && await ask.confirm(`'${r.title}' 공지를 삭제하시겠습니까?`, {actionLabel: '삭제', danger: true})) { await api('admin/notice_del', {id: r.id}); toast('삭제했습니다'); reload(); }
      }} />
  </div>;
}

// ── 회원 ──────────────────────────────────────────────────────────────
export function Users({path}) {
  const {data: d, reload} = useLoad(() => api('admin/users'), []);
  if (!d) return <><Head title="회원" /><Loading /></>;
  const paid = d.users.filter(u => u.dues).length;
  return <div className="enter">
    <Head title="회원" desc={`${d.users.length}명 중 ${paid}명이 학생회비를 납부했습니다. 표 위의 수정을 누르면 칸을 바로 고칠 수 있습니다. 관리자 지정은 ‘관리자’ 탭에서 합니다.`} />
    <DataTable path={path} rows={d.users} onSave={saver('users', reload)}
      columns={[
        {k: 'name', label: '이름', title: true, edit: 'text'}, {k: 'student_id', label: '학번', edit: 'text'},
        {k: 'dues', label: '학생회비 납부', filter: 'choice', edit: 'check', val: r => r.dues ? '납부' : '미납부', cell: r => <Check on={r.dues} label={r.dues ? '납부' : '미납부'} />},
        {k: 'username', label: '아이디', edit: 'text'}, {k: 'email', label: '이메일', edit: 'text'},
        {k: 'role', label: '권한', filter: 'choice', val: r => ROLE[r.role], cell: r => r.role === 'user' ? '학생' : <Tag tone="ok">{ROLE[r.role]}</Tag>},
        {k: 'created_at', label: '가입일자', type: 'date', period: true, edit: 'datetime'},
      ]} />
  </div>;
}

// ── 관리자 ────────────────────────────────────────────────────────────
export function Admins({me}) {
  const ask = useAsk();
  const isSuper = me.role === 'super';
  const {data, reload} = useLoad(() => api('admin/users'), []);
  const [find, setFind] = useState(''), [to, setTo] = useState('');
  if (!data) return <><Head title="관리자" /><Loading /></>;
  const all = data.users;
  const sup = all.find(u => u.role === 'super'), admins = all.filter(u => u.role === 'admin'), students = all.filter(u => u.role === 'user');
  const Who = ({u}) => <span style={{flex: '1 1 160px', minWidth: 0}}><b>{u.name}</b> <span className="muted">{u.student_id} · {u.username}</span></span>;
  const role = async (msg, body, done) => { if (!await ask.confirm(msg, {actionLabel: '확인'})) return; await api('admin/role', body); toast(done); reload(); };
  const hand = async () => {
    const u = all.find(x => String(x.id) === to); if (!u) return toast('넘길 회원을 골라 주십시오');
    if (!await ask.confirm(`${u.name} 님에게 최고 관리자 자리를 넘기시겠습니까?`, {description: '넘기면 본인은 일반 관리자가 됩니다.', actionLabel: '넘기기', danger: true})) return;
    const pw = await ask.prompt('비밀번호 확인', {description: '본인의 비밀번호를 한 번 더 입력해 주십시오', label: '비밀번호', type: 'password', actionLabel: '넘기기'}); if (!pw) return;
    await api('admin/handover', {id: u.id, password: pw}); toast(`${u.name} 님이 최고 관리자가 되었습니다`); location.reload();
  };
  const k = find.trim().toLowerCase();
  const list = students.filter(u => !k || [u.name, u.student_id, u.username].some(v => String(v).toLowerCase().includes(k)));
  return <div className="enter">
    <Head title="관리자" desc={isSuper ? '관리자를 지정하거나 해제하고, 최고 관리자 자리를 넘길 수 있습니다.' : '관리자 지정은 최고 관리자만 할 수 있습니다.'} />
    <div style={{display: 'grid', gap: 16, maxWidth: 760}}>
      <div className="box"><b>최고 관리자</b>
        <div className="inline rowline">{sup ? <><Who u={sup} /><Tag tone="ok">최고 관리자</Tag></> : <span className="muted">지금 최고 관리자가 없습니다. 서버에서 python3 council.py super 아이디 를 한 번 실행해 주십시오.</span>}</div>
        {isSuper && <div className="inline rowline"><span className="muted" style={{flex: '1 0 100%', fontSize: 13}}>자리를 넘기면 본인은 일반 관리자가 되며, 되돌리려면 받은 사람이 다시 넘겨야 합니다.</span>
          <select className="in" value={to} onChange={e => setTo(e.target.value)} aria-label="넘길 회원" style={{flex: '1 1 200px'}}><option value="">넘길 회원 고르기</option>
            {all.filter(u => u.role !== 'super').map(u => <option key={u.id} value={u.id}>{u.name} ({u.student_id})</option>)}</select>
          <Button label="최고 관리자 넘기기" variant="destructive" onClick={hand} /></div>}</div>
      <div className="box"><b>관리자 <span className="muted">{admins.length}명</span></b>
        {admins.length ? admins.map(u => <div className="inline rowline" key={u.id}><Who u={u} />
          {isSuper && <Button label="관리자 해제" size="sm" variant="destructive" onClick={() => role(`${u.name} 님의 관리자 권한을 해제하시겠습니까?`, {id: u.id, role: 'user'}, '해제했습니다')} />}</div>)
          : <p className="muted" style={{margin: '8px 0 0'}}>아직 관리자가 없습니다.</p>}</div>
      {isSuper && <div className="box"><b>관리자로 지정하기</b>
        <div style={{marginTop: 8}}><TextInput label="회원 찾기" isLabelHidden placeholder="이름, 학번, 아이디로 찾기" value={find} onChange={setFind} hasClear /></div>
        {list.slice(0, 20).map(u => <div className="inline rowline" key={u.id}><Who u={u} />
          <Button label="관리자로 지정" size="sm" variant="secondary" onClick={() => role(`${u.name} 님을 관리자로 지정하시겠습니까?`, {id: u.id, role: 'admin'}, '지정했습니다')} /></div>)}
        {list.length > 20 && <p className="muted" style={{margin: '8px 0 0'}}>{list.length - 20}명 더 있습니다. 이름이나 학번으로 좁혀 주십시오.</p>}
        {!list.length && <p className="muted" style={{margin: '8px 0 0'}}>찾는 학생이 없습니다.</p>}</div>}
    </div>
  </div>;
}
