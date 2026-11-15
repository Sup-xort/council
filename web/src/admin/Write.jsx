// 공지 쓰기 · 행사 쓰기 (넓으면 2단: 본문 | 설정, 좁으면 위아래)
import {useRef, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Switch} from '@astryxdesign/core/Switch';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {api, toast, koWhen} from '../lib/common.js';
import {useLoad} from '../ui/base.jsx';
import RichEditor from './RichEditor.jsx';
import {Head, Loading, KIND} from './Pages.jsx';

const TABS = {home: '로비', notices: '공지', events: '행사', reserve: '세미나실 예약', loans: '물품 대여'};
const CHIP_TYPES = [['tab', '다른 화면으로'], ['event', '행사 신청으로'], ['notice', '다른 공지로'], ['url', '바깥 주소로']];

// ── 공지 쓰기 ─────────────────────────────────────────────────────────
export function NoticeWrite({id}) {
  const isNew = id === 'new';
  const {data} = useLoad(() => Promise.all([api('admin/events'), api('admin/notices'), isNew ? null : api('admin/notice?id=' + id)]), [id]);
  if (!data) return <><Head title={isNew ? '공지 쓰기' : '공지 수정'} /><Loading /></>;
  return <NoticeForm key={id} isNew={isNew} id={id} evs={data[0].events} nts={data[1].notices}
    n={data[2] ? data[2].notice : {kind: 'event', title: '', summary: '', body: '', chips: [], event_id: null, on_lobby: false}} />;
}
function NoticeForm({isNew, id, evs, nts, n}) {
  const ed = useRef(null);
  const [kind, setKind] = useState(n.kind), [title, setTitle] = useState(n.title), [summary, setSummary] = useState(n.summary);
  const [onLobby, setOnLobby] = useState(!!n.on_lobby), [eventId, setEventId] = useState(n.event_id ? String(n.event_id) : '');
  const [chips, setChips] = useState(() => n.chips.map(c => ({...c, target: String(c.target)})));
  const [busy, setBusy] = useState(false);
  const others = nts.filter(x => x.id !== n.id);
  const first = {tab: 'reserve', event: String(evs[0]?.id ?? ''), notice: String(others[0]?.id ?? ''), url: ''};
  const setChip = (i, patch) => setChips(cs => cs.map((c, j) => j === i ? {...c, ...patch} : c));
  const target = (c, i) => {
    const on = e => setChip(i, {target: e.target.value});
    if (c.type === 'tab') return <select className="in" value={c.target} onChange={on}>{Object.entries(TABS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>;
    if (c.type === 'event') return <select className="in" value={c.target} onChange={on}>{evs.length ? evs.map(e => <option key={e.id} value={e.id}>{e.title}</option>) : <option value="">행사가 없습니다</option>}</select>;
    if (c.type === 'notice') return <select className="in" value={c.target} onChange={on}>{others.length ? others.map(x => <option key={x.id} value={x.id}>{x.title}</option>) : <option value="">다른 공지가 없습니다</option>}</select>;
    return <input className="in" value={c.target} onChange={on} placeholder="인터넷 주소 (https://…)" />;
  };
  const submit = async e => {
    e.preventDefault();
    if (ed.current.tooLong) return toast('본문은 2만 자까지 쓸 수 있습니다');
    setBusy(true);
    try {
      await api('admin/notice_save', {id: isNew ? undefined : n.id, kind, title, summary, body: ed.current.value, event_id: eventId || null, on_lobby: onLobby, chips});
      ed.current.clearDraft(); toast(isNew ? '올렸습니다' : '저장했습니다'); location.hash = '#/notices';
    } catch {} finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="enter">
    <Head title={isNew ? '공지 쓰기' : '공지 수정'} tools={<><Button label="목록으로" variant="secondary" href="#/notices" /><Button type="submit" label={isNew ? '올리기' : '저장'} variant="primary" isLoading={busy} /></>} />
    <div className="write"><div style={{display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0}}>
      <input className="title-in" value={title} onChange={e => setTitle(e.target.value)} required maxLength={100} placeholder="제목" aria-label="제목" />
      <input className="sub-in" value={summary} onChange={e => setSummary(e.target.value)} maxLength={100} placeholder="한 줄 소개 (목록과 로비 배너에 보입니다)" aria-label="한 줄 소개" />
      <RichEditor ref={ed} value={n.body} draftKey={'draft:notice:' + id} max={20000} /></div>
      <div className="side-set">
        <div className="box stack">
          <div className="fld">분류
            <SegmentedControl label="분류" value={kind} onChange={setKind} layout="fill" size="sm">
              {Object.entries(KIND).reverse().map(([k, t]) => <SegmentedControlItem key={k} value={k} label={t} />)}</SegmentedControl>
            <span className="hint">{kind === 'event' ? '행사 공지는 로그인하지 않은 사람도 읽을 수 있습니다.' : '학과 공지는 로그인한 사람만 읽을 수 있습니다.'}</span></div>
          <Switch label="로비 맨 위에 보이기" description="로그인하지 않은 사람도 이 글을 읽을 수 있게 됩니다" value={onLobby} onChange={setOnLobby} />
          <label className="fld">신청 현황을 같이 보여 줄 행사<select className="in" value={eventId} onChange={e => setEventId(e.target.value)}>
            <option value="">없음</option>{evs.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label></div>
        <div className="box stack" style={{gap: 8}}><b>바로가기 버튼</b>
          <span className="muted" style={{fontSize: 13}}>글 아래에 붙는 버튼입니다. 6개까지 달 수 있습니다.</span>
          {chips.map((c, i) => <div className="rowbox" key={i}>
            <div className="inline"><input className="in" value={c.label} onChange={e => setChip(i, {label: e.target.value})} placeholder="버튼 글 (예: 세미나실 예약하기)" maxLength={30} style={{flex: 1}} />
              <Button label="지우기" size="sm" variant="destructive" onClick={() => setChips(cs => cs.filter((_, j) => j !== i))} /></div>
            <div className="inline"><select className="in" value={c.type} onChange={e => setChip(i, {type: e.target.value, target: first[e.target.value]})}>
              {CHIP_TYPES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
              <div style={{flex: 1, minWidth: 0, display: 'flex'}}>{target(c, i)}</div></div></div>)}
          <Button label="+ 버튼 추가" variant="secondary" isDisabled={chips.length >= 6} onClick={() => setChips(cs => [...cs, {label: '', type: 'tab', target: 'reserve'}])} /></div>
      </div></div>
  </form>;
}

// ── 행사 쓰기 ─────────────────────────────────────────────────────────
const TYPES = [['text', '단답형'], ['long', '장문형'], ['select', '객관식'], ['multi', '체크박스'], ['dropdown', '드롭다운']];
const typesFor = f => f.type === 'checkbox' ? [...TYPES, ['checkbox', '체크 한 칸 (예전 방식)']] : TYPES;
const hasOpts = f => ['select', 'multi', 'dropdown'].includes(f.type);
const PREV = {text: '단답형 텍스트', long: '장문형 텍스트', checkbox: '학생이 칸에 체크합니다'};

export function EventWrite({id}) {
  const {data} = useLoad(() => id === 'new' ? null : api('admin/events'), [id]);
  if (id !== 'new' && !data) return <><Head title="행사 수정" /><Loading /></>;
  const found = data?.events.find(e => e.id === +id);
  if (id !== 'new' && !found) { toast('없는 행사입니다'); location.replace('#/events'); return null; }
  return <EventForm key={id} id={id} e={found || {title: '', body: '', starts_at: '', deadline: '', on_lobby: true, fields: [], n: 0}} isNew={!found} />;
}
function EventForm({id, e, isNew}) {
  const ed = useRef(null), list = useRef(null);
  const [v, setV] = useState({title: e.title, starts_at: e.starts_at || '', deadline: e.deadline || '', capacity: e.capacity ?? '',
    show_count: e.show_count !== 0, on_lobby: !!e.on_lobby, dues_only: !!e.dues_only});
  const set = k => x => setV(o => ({...o, [k]: x}));
  const [fields, setFields] = useState(() => e.fields.map((f, i) => ({...f, options: [...(f.options || [])], _k: i})));
  const [busy, setBusy] = useState(false);
  const nextKey = useRef(fields.length);
  const focusLater = sel => setTimeout(() => list.current?.querySelector(sel)?.focus(), 0);
  const upd = (i, patch) => setFields(fs => fs.map((f, j) => j === i ? {...f, ...patch} : f));
  const card = i => `.qcard[data-i="${i}"]`;
  const move = (i, d) => { setFields(fs => { const n = [...fs]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; }); focusLater(`${card(i + d)} [data-${d < 0 ? 'up' : 'down'}]`); };

  const submit = async ev => {
    ev.preventDefault();
    if (ed.current.tooLong) return toast('설명은 5천 자까지 쓸 수 있습니다');
    const bad = fields.findIndex(f => !f.label.trim() || (hasOpts(f) && !f.options.some(o => o.trim())));
    if (bad >= 0) { list.current?.querySelector(card(bad))?.scrollIntoView({block: 'center'}); return toast(!fields[bad].label.trim() ? `${bad + 1}번 질문의 내용을 적어 주십시오` : `${bad + 1}번 질문의 보기를 적어 주십시오`); }
    setBusy(true);
    try {
      await api('admin/event_save', {id: isNew ? undefined : e.id, title: v.title, body: ed.current.value, starts_at: v.starts_at, deadline: v.deadline,
        on_lobby: v.on_lobby, capacity: v.capacity || null, show_count: v.show_count, dues_only: v.dues_only,
        fields: fields.map(({_k, ...f}) => ({...f, options: hasOpts(f) ? f.options.map(o => o.trim()).filter(Boolean) : []}))});
      ed.current.clearDraft(); toast('저장했습니다'); location.hash = '#/events';
    } catch {} finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="enter">
    <Head title={isNew ? '새 행사' : '행사 수정'} tools={<><Button label="목록으로" variant="secondary" href="#/events" /><Button type="submit" label="저장" variant="primary" isLoading={busy} /></>} />
    <div className="write"><div style={{display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0}}>
      <input className="title-in" value={v.title} onChange={x => set('title')(x.target.value)} required maxLength={100} placeholder="행사 이름" aria-label="행사 이름" />
      <RichEditor ref={ed} value={e.body} draftKey={'draft:event:' + id} max={5000} placeholder="행사 설명을 쓰십시오" /></div>
      <div className="side-set">
        <div className="box stack">
          <label className="fld">행사 일시 (없으면 비워 두십시오)<input className="in" type="datetime-local" value={v.starts_at} onChange={x => set('starts_at')(x.target.value)} />
            <span className="hint">{v.starts_at ? koWhen(v.starts_at) : ''}</span></label>
          <label className="fld">신청 마감<input className="in" type="datetime-local" value={v.deadline} onChange={x => set('deadline')(x.target.value)} required />
            <span className="hint">{v.deadline ? koWhen(v.deadline) : ''}</span></label>
          <label className="fld">정원 (비워 두면 제한 없음)<input className="in" type="number" min="1" value={v.capacity} onChange={x => set('capacity')(x.target.value)} placeholder="제한 없음" /></label>
          <Switch label="신청 인원을 학생에게 보이기" description="끄면 인원 대신 '신청 받는 중'만 보입니다" value={v.show_count} onChange={set('show_count')} />
          <Switch label="로비에 보이기" value={v.on_lobby} onChange={set('on_lobby')} />
          <Switch label="학생회비 납부자만 신청 받기" description="미납부자에게는 신청서 대신 안내 문구가 보입니다. 회원 메뉴에서 납부자를 표시하십시오." value={v.dues_only} onChange={set('dues_only')} />
        </div>
        <div className="box stack"><b>신청서에 더 물어볼 것</b>
          <span className="muted" style={{fontSize: 13}}>이름·학번·이메일은 계정에서 자동으로 들어갑니다.</span>
          {e.n > 0 && <span style={{fontSize: 13, color: 'var(--req)'}}>이미 신청한 사람이 있습니다. 순서를 바꿔도 받아 둔 답은 그대로 따라가지만, 질문을 지우면 그 질문의 답도 함께 지워집니다.</span>}
          <div ref={list} style={{display: 'flex', flexDirection: 'column', gap: 8}}>
            {fields.length ? fields.map((f, i) => <div className="qcard" data-i={i} key={f._k}>
              <div className="qtop"><input className="qtitle" value={f.label} onChange={x => upd(i, {label: x.target.value})} maxLength={100} placeholder="질문 (예: 티셔츠 사이즈)" aria-label={`질문 ${i + 1}`} data-k="label" />
                <select className="in" value={f.type} aria-label="답하는 방식" onChange={x => { const t = x.target.value; upd(i, {type: t, options: hasOpts({type: t}) && !f.options.length ? [''] : f.options}); }}>
                  {typesFor(f).map(([tv, t]) => <option key={tv} value={tv}>{t}</option>)}</select></div>
              {hasOpts(f) ? <div className="qopts">{f.options.map((o, j) => <div className="qopt" key={j}>
                {f.type === 'dropdown' ? <span className="qn">{j + 1}</span> : <i className={f.type} />}
                <input value={o} maxLength={100} placeholder={`보기 ${j + 1}`} aria-label={`보기 ${j + 1}`} data-o={j}
                  onChange={x => upd(i, {options: f.options.map((p, k) => k === j ? x.target.value : p)})}
                  onKeyDown={x => { if (x.key !== 'Enter' || x.nativeEvent.isComposing) return; x.preventDefault(); const os = [...f.options]; os.splice(j + 1, 0, ''); upd(i, {options: os}); focusLater(`${card(i)} [data-o="${j + 1}"]`); }} />
                <button type="button" aria-label={`보기 ${j + 1} 지우기`} onClick={() => upd(i, {options: f.options.filter((_, k) => k !== j)})}>✕</button></div>)}
                <button type="button" className="qadd" onClick={() => { upd(i, {options: [...f.options, '']}); focusLater(`${card(i)} [data-o="${f.options.length}"]`); }}>
                  {f.type === 'dropdown' ? <span className="qn" /> : <i className={f.type} />}보기 추가</button></div>
                : <div className="qprev">{PREV[f.type]}</div>}
              <div className="qbar"><CheckboxInput label="필수 질문" value={!!f.required} onChange={x => upd(i, {required: x})} /><span className="sp" />
                <button type="button" className="ib" data-up disabled={!i} onClick={() => move(i, -1)}>↑ 위로</button>
                <button type="button" className="ib" data-down disabled={i >= fields.length - 1} onClick={() => move(i, 1)}>↓ 아래로</button>
                <button type="button" className="ib" onClick={() => { const k = nextKey.current++; setFields(fs => { const n = [...fs]; n.splice(i + 1, 0, {...f, id: undefined, options: [...f.options], _k: k}); return n; }); focusLater(`${card(i + 1)} [data-k="label"]`); }}>복사</button>
                <button type="button" className="ib del" onClick={() => setFields(fs => fs.filter((_, j) => j !== i))}>지우기</button></div>
            </div>) : <div className="muted" style={{fontSize: 13, padding: '6px 0'}}>아직 질문이 없습니다. 이름·학번·이메일만 받습니다.</div>}
          </div>
          <Button label="+ 질문 추가" variant="secondary" onClick={() => {
            const k = nextKey.current++; setFields(fs => [...fs, {label: '', type: 'text', required: false, options: [], _k: k}]);
            setTimeout(() => { const c = list.current?.querySelector(card(fields.length)); c?.scrollIntoView({block: 'center', behavior: 'smooth'}); c?.querySelector('[data-k="label"]')?.focus(); }, 0);
          }} />
        </div>
      </div></div>
  </form>;
}
