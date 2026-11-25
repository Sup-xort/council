// 공지 쓰기 · 행사 쓰기 (넓으면 2단: 본문 | 설정, 좁으면 위아래)
import {useRef, useState} from 'react';
import {Plus, X, ArrowUp, ArrowDown, Copy, Trash2, Circle, Square} from 'lucide-react';
import {Btn, Rb, Field, Select, Chk, Seg, Empty, Note} from '../ui/kit.jsx';
import {api, toast, koWhen} from '../lib/common.js';
import {useLoad} from '../ui/base.jsx';
import RichEditor from './RichEditor.jsx';
import {Head, Loading, Page, KIND} from './Pages.jsx';

const TABS = {home: '로비', notices: '공지', events: '행사', reserve: '세미나실 예약', loans: '물품 대여'};
const CHIP_TYPES = [['tab', '다른 화면으로'], ['event', '행사 신청으로'], ['notice', '다른 공지로'], ['url', '바깥 주소로']];
const opts = list => list.map(([value, label]) => ({value: String(value), label}));

// 날짜·시각 칸: 브라우저 달력을 쓰고, 아래에 읽기 쉬운 말로 다시 보여 준다
function When({label, value, onChange, required}) {
  return <Field label={label} req={required} hint={value ? koWhen(value) : undefined} type="datetime-local" value={value} onChange={e => onChange(e.target.value)} required={required} />;
}

// ── 공지 쓰기 ─────────────────────────────────────────────────────────
export function NoticeWrite({id}) {
  const isNew = id === 'new';
  const {data} = useLoad(() => Promise.all([api('admin/events'), api('admin/notices'), isNew ? null : api('admin/notice?id=' + id)]), [id]);
  if (!data) return <Page><Head title={isNew ? '공지 쓰기' : '공지 수정'} /><Loading /></Page>;
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
    const on = v => setChip(i, {target: v});
    if (c.type === 'url') return <Field label="인터넷 주소" value={c.target} onChange={e => on(e.target.value)} placeholder="https://…" />;
    const list = c.type === 'tab' ? Object.entries(TABS) : c.type === 'event' ? evs.map(e => [e.id, e.title]) : others.map(x => [x.id, x.title]);
    return <Select label="갈 곳" options={opts(list)} value={c.target} onChange={on} placeholder={list.length ? '고르기' : '고를 것이 없습니다'} />;
  };
  const submit = async e => {
    e.preventDefault();
    if (!title.trim()) return toast('제목을 적어 주십시오');
    if (ed.current.tooLong) return toast('본문은 2만 자까지 쓸 수 있습니다');
    setBusy(true);
    try {
      await api('admin/notice_save', {id: isNew ? undefined : n.id, kind, title, summary, body: ed.current.value, event_id: eventId || null, on_lobby: onLobby, chips});
      ed.current.clearDraft(); toast(isNew ? '올렸습니다' : '저장했습니다'); location.hash = '#/notices';
    } catch {} finally { setBusy(false); }
  };
  return <form onSubmit={submit}><Page>
    <Head title={isNew ? '공지 쓰기' : '공지 수정'} tools={<><Btn kind="ghost" size="sm" href="#/notices">목록으로</Btn><Btn type="submit" size="sm" busy={busy}>{isNew ? '올리기' : '저장'}</Btn></>} />
    <div className="write">
      <div>
        <Field label="제목" value={title} onChange={e => setTitle(e.target.value)} placeholder="제목" />
        <Field label="한 줄 소개" hint="목록과 로비 배너에 보입니다" value={summary} onChange={e => setSummary(e.target.value)} />
        <RichEditor ref={ed} value={n.body} draftKey={'draft:notice:' + id} max={20000} />
      </div>
      <div className="side-set">
        <div className="card">
          <span className="lab-s">분류</span>
          <Seg label="분류" value={kind} onChange={setKind} items={Object.entries(KIND).reverse()} />
          <p className="muted" style={{margin: '-6px 0 14px'}}>{kind === 'event' ? '행사 공지는 로그인하지 않은 사람도 읽을 수 있습니다.' : '학과 공지는 로그인한 사람만 읽을 수 있습니다.'}</p>
          <Chk label="로비 맨 위에 보이기" desc="로그인하지 않은 사람도 이 글을 읽을 수 있게 됩니다" checked={onLobby} onChange={setOnLobby} />
          <Select label="신청 현황을 같이 보여 줄 행사" className="mt" options={[{value: '', label: '없음'}, ...opts(evs.map(e => [e.id, e.title]))]}
            value={eventId} onChange={setEventId} />
        </div>
        <div className="card">
          <h3 style={{marginBottom: 4}}>바로가기 버튼</h3><p className="muted" style={{marginTop: 0}}>글 아래에 붙는 버튼입니다. 6개까지 달 수 있습니다.</p>
          {chips.map((c, i) => <div key={i} className="fieldrow enter">
            <div className="row end"><Field className="grow" label="버튼 글" value={c.label} onChange={e => setChip(i, {label: e.target.value})} placeholder="예: 세미나실 예약하기" />
              <Rb label="버튼 지우기" onClick={() => setChips(cs => cs.filter((_, j) => j !== i))}><X /></Rb></div>
            <Select label="누르면 갈 곳" options={opts(CHIP_TYPES)} value={c.type} onChange={v => setChip(i, {type: v, target: first[v]})} />
            {target(c, i)}
          </div>)}
          <Btn kind="ghost" icon={<Plus size={16} aria-hidden="true" />} disabled={chips.length >= 6} onClick={() => setChips(cs => [...cs, {label: '', type: 'tab', target: 'reserve'}])}>버튼 추가</Btn>
        </div>
      </div>
    </div>
  </Page></form>;
}

// ── 행사 쓰기 ─────────────────────────────────────────────────────────
const TYPES = [['text', '단답형'], ['long', '장문형'], ['select', '객관식'], ['multi', '체크박스'], ['dropdown', '드롭다운']];
const typesFor = f => f.type === 'checkbox' ? [...TYPES, ['checkbox', '체크 한 칸 (예전 방식)']] : TYPES;
const hasOpts = f => ['select', 'multi', 'dropdown'].includes(f.type);
const PREV = {text: '단답형 텍스트', long: '장문형 텍스트', checkbox: '학생이 칸에 체크합니다'};

export function EventWrite({id}) {
  const {data} = useLoad(() => id === 'new' ? null : api('admin/events'), [id]);
  if (id !== 'new' && !data) return <Page><Head title="행사 수정" /><Loading /></Page>;
  const found = data?.events.find(e => e.id === id);
  if (id !== 'new' && !found) { toast('없는 행사입니다'); location.replace('#/events'); return null; }
  return <EventForm key={id} id={id} e={found || {title: '', body: '', starts_at: '', deadline: '', on_lobby: true, fields: [], n: 0}} isNew={!found} />;
}
function Question({f, i, n, upd, move, dup, del, list}) {
  const focus = sel => setTimeout(() => list.current?.querySelector(`[data-q="${i}"] ${sel}`)?.focus(), 0);
  const Mark = f.type === 'multi' ? Square : Circle;
  return <div data-q={i} className="fieldrow qcard enter">
    <div className="row end wrap">
      <Field className="grow minw200" label={`질문 ${i + 1}`} value={f.label} onChange={e => upd({label: e.target.value})} placeholder="예: 티셔츠 사이즈" />
      <Select className="w170" label="답하는 방식" options={opts(typesFor(f))} value={f.type}
        onChange={t => upd({type: t, options: hasOpts({type: t}) && !f.options.length ? [''] : f.options})} />
    </div>
    {hasOpts(f) ? <div className="qopts">
      {f.options.map((o, j) => <div key={j} className="row">
        {f.type === 'dropdown' ? <span className="muted qn">{j + 1}</span> : <Mark size={16} className="qmark" aria-hidden="true" />}
        <div className="grow" data-o={j}><input className="in" aria-label={`보기 ${j + 1}`} value={o} placeholder={`보기 ${j + 1}`}
          onChange={e => upd({options: f.options.map((p, k) => k === j ? e.target.value : p)})}
          onKeyDown={x => { if (x.key !== 'Enter' || x.nativeEvent.isComposing) return; x.preventDefault(); const os = [...f.options]; os.splice(j + 1, 0, ''); upd({options: os}); focus(`[data-o="${j + 1}"] input`); }} /></div>
        <Rb label={`보기 ${j + 1} 지우기`} onClick={() => upd({options: f.options.filter((_, k) => k !== j)})}><X /></Rb>
      </div>)}
      <div><button type="button" className="pb soft" onClick={() => { upd({options: [...f.options, '']}); focus(`[data-o="${f.options.length}"] input`); }}>보기 추가</button></div>
    </div> : <p className="muted" style={{margin: '0 0 8px'}}>{PREV[f.type]}</p>}
    <div className="row wrap qbar">
      <Chk label="필수 질문" checked={!!f.required} onChange={v => upd({required: v})} /><span className="grow" />
      <Rb label="위로" disabled={!i} onClick={() => move(-1)}><ArrowUp /></Rb>
      <Rb label="아래로" disabled={i >= n - 1} onClick={() => move(1)}><ArrowDown /></Rb>
      <Rb label="복사" onClick={dup}><Copy /></Rb>
      <Rb label="지우기" onClick={del}><Trash2 /></Rb>
    </div>
  </div>;
}
function EventForm({id, e, isNew}) {
  const ed = useRef(null), list = useRef(null);
  const [v, setV] = useState({title: e.title, starts_at: e.starts_at || '', deadline: e.deadline || '', capacity: e.capacity ? String(e.capacity) : '',
    show_count: e.show_count !== 0, on_lobby: !!e.on_lobby, dues_only: !!e.dues_only});
  const set = k => x => setV(o => ({...o, [k]: x}));
  const [fields, setFields] = useState(() => e.fields.map((f, i) => ({...f, options: [...(f.options || [])], _k: i})));
  const [busy, setBusy] = useState(false);
  const nextKey = useRef(fields.length);
  const upd = (i, patch) => setFields(fs => fs.map((f, j) => j === i ? {...f, ...patch} : f));

  const submit = async ev => {
    ev.preventDefault();
    if (!v.title.trim()) return toast('행사 이름을 적어 주십시오');
    if (!v.deadline) return toast('신청 마감을 정해 주십시오');
    if (ed.current.tooLong) return toast('설명은 5천 자까지 쓸 수 있습니다');
    const bad = fields.findIndex(f => !f.label.trim() || (hasOpts(f) && !f.options.some(o => o.trim())));
    if (bad >= 0) { list.current?.querySelector(`[data-q="${bad}"]`)?.scrollIntoView({block: 'center'}); return toast(!fields[bad].label.trim() ? `${bad + 1}번 질문의 내용을 적어 주십시오` : `${bad + 1}번 질문의 보기를 적어 주십시오`); }
    setBusy(true);
    try {
      await api('admin/event_save', {id: isNew ? undefined : e.id, title: v.title, body: ed.current.value, starts_at: v.starts_at, deadline: v.deadline,
        on_lobby: v.on_lobby, capacity: v.capacity || null, show_count: v.show_count, dues_only: v.dues_only,
        fields: fields.map(({_k, ...f}) => ({...f, options: hasOpts(f) ? f.options.map(o => o.trim()).filter(Boolean) : []}))});
      ed.current.clearDraft(); toast('저장했습니다'); location.hash = '#/events';
    } catch {} finally { setBusy(false); }
  };
  return <form onSubmit={submit}><Page>
    <Head title={isNew ? '새 행사' : '행사 수정'} tools={<><Btn kind="ghost" size="sm" href="#/events">목록으로</Btn><Btn type="submit" size="sm" busy={busy}>저장</Btn></>} />
    <div className="write">
      <div>
        <Field label="행사 이름" value={v.title} onChange={x => set('title')(x.target.value)} placeholder="행사 이름" />
        <RichEditor ref={ed} value={e.body} draftKey={'draft:event:' + id} max={5000} placeholder="행사 설명을 쓰십시오" />
      </div>
      <div className="side-set">
        <div className="card">
          <When label="행사 일시 (없으면 비워 두십시오)" value={v.starts_at} onChange={set('starts_at')} />
          <When label="신청 마감" value={v.deadline} onChange={set('deadline')} required />
          <Field label="정원" hint="비워 두면 제한 없음" value={v.capacity} onChange={x => set('capacity')(x.target.value)} inputMode="numeric" placeholder="제한 없음" />
          <Chk label="신청 인원을 학생에게 보이기" desc="끄면 인원 대신 '신청 받는 중'만 보입니다" checked={v.show_count} onChange={set('show_count')} />
          <Chk label="로비에 보이기" checked={v.on_lobby} onChange={set('on_lobby')} />
          <Chk label="학생회비 납부자만 신청 받기" desc="미납부자에게는 신청서 대신 안내 문구가 보입니다. 회원 메뉴에서 납부자를 표시하십시오." checked={v.dues_only} onChange={set('dues_only')} />
        </div>
        <div className="card">
          <h3 style={{marginBottom: 4}}>신청서에 더 물어볼 것</h3><p className="muted" style={{marginTop: 0}}>이름·학번·이메일은 계정에서 자동으로 들어갑니다.</p>
          {e.n > 0 && <Note title="이미 신청한 사람이 있습니다">순서를 바꿔도 받아 둔 답은 그대로 따라가지만, 질문을 지우면 그 질문의 답도 함께 지워집니다.</Note>}
          <div className="qlist" ref={list}>
            {fields.length ? fields.map((f, i) => <Question key={f._k} f={f} i={i} n={fields.length} list={list} upd={p => upd(i, p)}
              move={d => setFields(fs => { const x = [...fs]; [x[i], x[i + d]] = [x[i + d], x[i]]; return x; })}
              dup={() => { const k = nextKey.current++; setFields(fs => { const x = [...fs]; x.splice(i + 1, 0, {...f, id: undefined, options: [...f.options], _k: k}); return x; }); }}
              del={() => setFields(fs => fs.filter((_, j) => j !== i))} />)
              : <Empty title="아직 질문이 없습니다" desc="이름·학번·이메일만 받습니다." />}
          </div>
          <Btn kind="ghost" icon={<Plus size={16} aria-hidden="true" />} onClick={() => {
            const k = nextKey.current++, at = fields.length; setFields(fs => [...fs, {label: '', type: 'text', required: false, options: [], _k: k}]);
            setTimeout(() => { const c = list.current?.querySelector(`[data-q="${at}"]`); c?.scrollIntoView({block: 'center', behavior: 'smooth'}); c?.querySelector('input')?.focus(); }, 0);
          }}>질문 추가</Btn>
        </div>
      </div>
    </div>
  </Page></form>;
}
