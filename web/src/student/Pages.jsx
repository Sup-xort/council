// 대여 · 행사 · 공지 · 메일 설정
import {useEffect, useState} from 'react';
import {api, md, koDate, koWhen, koStamp, koSpan, toDate, toast} from '../lib/common.js';
import {useLoad, useAsk} from '../ui/base.jsx';
import {Btn, Pill, Seg, Opts, Chk, Empty, Loading, Gauge, Rows, Head, Note, Legend, More, Md} from '../ui/kit.jsx';
import {IcBox, IcDoc, IcCheck, IcBack, IcNext} from '../ui/icons.jsx';
import {useMe, State, EventsList, chipHref, kicker} from './parts.jsx';

// ── 대여 ──────────────────────────────────────────────────────────────
const byKind = items => { const m = new Map(); items.forEach(i => { const k = i.kind || i.name; (m.get(k) || m.set(k, []).get(k)).push(i); }); return [...m]; };
function LoanHistory() {
  const {data} = useLoad(() => api('mypage'), []);
  const list = data ? data.loans : [];
  if (!list.length) return null;
  return <section className="card">
    <h3>내 대여 기록</h3>
    <div className="list">{list.map((r, i) => <div key={i}><div className="grow"><b className="li-t">{r.kind && r.num ? `${r.kind} ${r.num}번` : r.name}</b>
      <span className="muted">{koStamp(r.out_at)} 대여{r.in_at ? ` · ${koStamp(r.in_at)} 반납` : ''}</span></div>
      <Pill tone={r.in_at ? '' : 'mine'}>{r.in_at ? '반납함' : '대여 중'}</Pill></div>)}</div>
  </section>;
}
export function Items() {
  const {data} = useLoad(() => api('items'), []);
  if (!data) return <Loading rows={[80, 160, 160]} />;
  const mine = data.items.filter(i => i.mine), kinds = byKind(data.items);
  return <div className="enter">
    <Head big title="물품 대여" desc="물품에 붙은 QR을 휴대폰 기본 카메라로 찍으면 대여하고, 한 번 더 찍으면 반납됩니다." />
    {mine.length > 0 && <section className="card">
      <div className="row"><h3 className="grow" style={{margin: 0}}>내가 대여한 물품</h3><Pill tone="mine">{mine.length}개</Pill></div>
      <div className="list">{mine.map(i => {
        const late = i.due && toDate(i.due) < new Date();
        return <div key={i.id}><div className="grow"><b className="li-t">{i.name}</b>
          <span className="muted">{i.due ? `${koStamp(i.due)}까지 반납해 주십시오` : `${koStamp(i.borrowed_at)}에 대여`}</span>
          {late && <span className="req li-s">반납 기한이 지났습니다</span>}</div>
          <span className="muted nowrap">{koSpan(i.borrowed_at)}째</span></div>;
      })}</div>
    </section>}
    {kinds.length ? <section className="card">
      <h3>전체 물품</h3>
      {kinds.map(([k, its]) => {
        const left = its.filter(i => i.available).length;
        return <div className="kind" key={k}>
          <div className="row"><b className="grow">{k}</b>{left ? <Pill tone="ok">{left}개 남음</Pill> : <Pill tone="use">모두 사용 중</Pill>}<span className="muted">전체 {its.length}개</span></div>
          <div className="nums">{its.map(i => {
            const st = i.mine ? '내가 대여' : i.available ? '대여 가능' : '사용중';
            return <span key={i.id} className={i.mine ? 'num mine' : i.available ? 'num ok' : 'num'} title={st} aria-label={`${i.name} ${st}`}>{i.num != null ? `${i.num}번` : '1개'}</span>;
          })}</div>
        </div>;
      })}
      <Legend items={[['ok-soft', '대여 가능'], ['busy', '사용중'], ['mine', '내가 대여']]} />
    </section> : <div className="card"><Empty icon={<IcBox />} title="아직 대여할 수 있는 물품이 없습니다" desc="학생회가 물품을 등록하면 여기에 나타나요." /></div>}
    <LoanHistory />
  </div>;
}

// ── 행사 ──────────────────────────────────────────────────────────────
export function Events() {
  const {data} = useLoad(() => api('events'), []);
  return <div className="col">
    <Head big title="행사" />
    {data ? <EventsList list={data.events} /> : <Loading rows={[180, 180]} />}
  </div>;
}

function lockOf(data, me) {
  const e = data.event, g = data.gauge, app = data.application;
  const duesLock = e.dues_only && !me.dues && !app;      // 학생회비를 낸 학생만 받는 행사
  const locked = e.closed || (g.full && !app) || duesLock;
  const note = locked && <Note title={e.closed ? '신청이 마감됐습니다' : duesLock ? '학생회비 납부자만 신청할 수 있습니다' : '정원이 찼습니다'}>
    {e.closed ? (app ? '신청한 내용은 신청서에서 볼 수 있습니다.' : null) : duesLock ? '납부했는데 이 글이 보이면 학생회에 알려 주십시오.' : '더 이상 신청할 수 없습니다.'}</Note>;
  return {locked, note};
}
const Applied = ({closed}) => <div className="done"><IcCheck /><span>신청됐어요. {closed ? '신청은 마감됐어요.' : '마감 전까지 고치거나 취소할 수 있어요.'}</span></div>;

export function Event({id, q}) {
  const {me, isAdmin} = useMe();
  const {data} = useLoad(() => api('event?id=' + id), [id]);
  const lk = data && lockOf(data, me);
  useEffect(() => { if (lk && q.get('apply') && !lk.locked) location.replace(`#/event/${id}/apply`); }, [!!data]);
  if (!data) return <div className="col"><Loading rows={[100, 120, 300]} /></div>;
  const e = data.event, g = data.gauge, app = data.application;
  const state = e.closed ? '마감' : app ? '신청함' : g.full ? '정원 마감' : '모집 중';
  const goApply = `#/event/${e.id}/apply`;
  return <div className="col enter">
    <Head title={e.title} meta={<><State st={state} /><span>{kicker('', e.deadline, e.closed)}</span></>}
      end={isAdmin && <Btn kind="ghost" size="sm" href={`admin#/event/${e.id}`}>관리 사이트에서 수정</Btn>} />
    <div>
      <div className="card">{g.n == null ? <h3 style={{margin: 0}}>{g.full ? '정원이 찼습니다' : '신청 받는 중'}</h3> : <Gauge g={g} big />}</div>
      <Rows rows={[['일시', e.starts_at && koWhen(e.starts_at)], ['신청 마감', koWhen(e.deadline)], ['신청 대상', e.dues_only && '학생회비 납부자']]} />
      {(e.body.trim() || data.notice_id) && <div className="card reading"><Md html={md(e.body)} />
        {data.notice_id && <More href={`#/notice/${data.notice_id}`}>공지 전체 보기</More>}</div>}
      <div className="card stack">
        {app && <Applied closed={e.closed} />}
        {lk.note}
        {app ? <Btn size="wide" kind={lk.locked ? 'ghost' : ''} href={goApply}>{lk.locked ? '신청 내용 보기' : '신청 수정'}</Btn>
          : !lk.locked && <Btn size="wide" href={goApply}>참여 신청</Btn>}
      </div>
    </div>
  </div>;
}

// 신청서 한 칸: 객관식·체크박스는 2열 선택지, 드롭다운은 select, 나머지는 입력칸
function Field({f, i, value, onChange, disabled}) {
  const lab = <>{f.label}{f.required && <span className="req"> *</span>}</>;
  if (f.type === 'select' || f.type === 'multi') return <fieldset disabled={disabled}>
    <legend>{lab}{f.type === 'multi' && <span className="muted"> · 여러 개 고를 수 있습니다</span>}</legend>
    <Opts options={f.options} value={value} onChange={onChange} multi={f.type === 'multi'} disabled={disabled} /></fieldset>;
  if (f.type === 'checkbox') return <Chk label={lab} checked={value} onChange={onChange} disabled={disabled} />;
  const id = 'q' + i;
  if (f.type === 'dropdown') return <label className="t" htmlFor={id}>{lab}<select id={id} className="in" value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)}>
    <option value="" disabled>선택</option>{f.options.map(o => <option key={o} value={o}>{o}</option>)}</select></label>;
  if (f.type === 'long') return <label className="t" htmlFor={id}>{lab}<textarea id={id} className="in" rows={4} maxLength={2000} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} /></label>;
  return <label className="t" htmlFor={id}>{lab}<input id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} /></label>;
}

export function EventApply({id}) {
  const {me} = useMe();
  const ask = useAsk();
  const {data} = useLoad(() => api('event?id=' + id), [id]);
  const [vals, setVals] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) return;
    const app = data.application, v = {};
    data.event.fields.forEach((f, i) => { const x = app?.answers?.[i]; v[i] = f.type === 'checkbox' ? !!x : f.type === 'multi' ? (Array.isArray(x) ? [...x] : []) : (x ?? ''); });
    setVals(v);
  }, [data]);
  if (!data || !vals) return <div className="col"><Loading rows={[100, 120, 300]} /></div>;

  const e = data.event, app = data.application, {locked, note} = lockOf(data, me);
  const back = `#/event/${e.id}`;
  const ok = e.fields.every((f, i) => !f.required || (f.type === 'checkbox' ? vals[i] : f.type === 'multi' ? vals[i].length : String(vals[i]).trim()));
  const cancel = async () => {
    if (!await ask.confirm('신청을 취소하시겠습니까?', {actionLabel: '신청 취소', danger: true})) return;
    setBusy(true);
    try { await api('apply_cancel', {event_id: e.id}); toast('신청을 취소했습니다'); location.hash = back; } catch {} finally { setBusy(false); }
  };
  const submit = async ev => {
    ev.preventDefault(); if (!ok || locked) return;
    setBusy(true);
    try { await api('apply', {event_id: e.id, answers: vals}); toast(app ? '수정했습니다' : '신청했습니다'); location.hash = back; } catch {} finally { setBusy(false); }
  };
  return <div className="col enter apply-bg"><form className="card apply" onSubmit={submit}>
    <div><span className="kicker">{e.title}</span><h2>{app ? '신청 수정' : '참여 신청'}</h2></div>
    <div><div className="who"><b>{me.name}</b><span>{me.student_id}</span></div><p className="muted" style={{margin: '6px 2px 0'}}>이름·학번·이메일은 계정에서 자동으로 들어갑니다.</p></div>
    {e.fields.map((f, i) => <Field key={f.id ?? i} f={f} i={i} value={vals[i]} disabled={locked} onChange={v => setVals(o => ({...o, [i]: v}))} />)}
    {app && !locked && <Applied />}
    {note}
    {!locked && <Btn type="submit" size="wide" busy={busy} disabled={!ok}>{ok ? (app ? '신청 수정' : '참여 신청') : '필수 질문에 답해 주십시오'}</Btn>}
    {app && !locked && <Btn kind="red" size="wide" disabled={busy} onClick={cancel}>신청 취소</Btn>}
    {locked && <Btn kind="ghost" size="wide" href={back}>행사로 돌아가기</Btn>}
  </form></div>;
}

// ── 공지 ──────────────────────────────────────────────────────────────
const KIND = {dept: '학과 공지', event: '행사 공지'};
let noticeKind = '';
export function Notices() {
  const {me, isAdmin} = useMe();
  const [kind, setKind] = useState(noticeKind);
  noticeKind = kind;
  const {data} = useLoad(() => api('notices' + (kind ? '?kind=' + kind : '')), [kind]);
  const tabs = [['', '전체'], ['event', '행사 공지']].concat(me ? [['dept', '학과 공지']] : []);
  return <div className="col">
    <Head big title="공지" end={isAdmin && <Btn size="sm" href="admin#/notice/new">글쓰기</Btn>} />
    <div>
      <Seg label="공지 종류" value={kind} onChange={setKind} items={tabs} />
      {data ? (data.notices.length ? <div key={kind}>{data.notices.map(n =>
        <a className="nrow" key={n.id} href={`#/notice/${n.id}`}>
          <div className="meta-l"><Pill tone={n.kind === 'event' ? 'ok' : 'mine'}>{KIND[n.kind]}</Pill><span className="kicker">{koDate(n.created_at)}</span></div>
          <h3>{n.title}</h3>
          {n.summary && <p className="muted" style={{margin: '4px 0 0'}}>{n.summary}</p>}
        </a>)}</div>
        : <div className="card"><Empty icon={<IcDoc />} title="아직 올라온 공지가 없습니다" /></div>) : <Loading rows={[96, 96, 96]} />}
      {!me && <p className="muted">학과 공지는 로그인하면 볼 수 있습니다. <a href="#/login?next=%23%2Fnotices">로그인</a></p>}
    </div>
  </div>;
}
function LinkedEvent({g}) {
  const st = g.closed ? '마감' : g.full ? '정원 마감' : '모집 중';
  return <div className="card linked">
    <span className="kicker">연결된 행사 · {kicker(st, g.deadline, g.closed)}</span>
    <h3 style={{margin: 0}}>{g.title}</h3>
    <Gauge g={g} />
    <a className="pb" href={`#/event/${g.id}${g.closed ? '' : '?apply=1'}`}>{g.closed ? '행사 보기' : '참여 신청'}</a>
  </div>;
}
export function Notice({id}) {
  const {isAdmin} = useMe();
  const {data} = useLoad(() => api('notice?id=' + id), [id]);
  if (!data) return <div className="col"><Loading rows={[100, 400]} /></div>;
  const n = data.notice;
  return <div className="col enter">
    <Head title={n.title}
      meta={<><Pill tone={n.kind === 'event' ? 'ok' : 'mine'}>{KIND[n.kind]}</Pill><span>{koDate(n.created_at)}</span>{n.author && <><span aria-hidden="true">·</span><span>{n.author}</span></>}</>}
      end={isAdmin && <Btn kind="ghost" size="sm" href={`admin#/notice/${n.id}`}>수정</Btn>} />
    <div>
      <article className="card reading">
        <Md html={md(n.body)} />
        {n.chips?.length > 0 && <div className="chips">{n.chips.map((c, i) => c.type === 'url'
          ? <a key={i} className="chip" href={c.target} target="_blank" rel="noopener noreferrer">{c.label} ↗</a>
          : <a key={i} className="chip" href={chipHref(c)}>{c.label} ›</a>)}</div>}
      </article>
      {n.event && <LinkedEvent g={n.event} />}
      {(data.prev || data.next) && <nav className="pn" aria-label="이전·다음 공지">
        {data.prev && <a href={`#/notice/${data.prev.id}`}><small><IcBack className="s" /> 이전</small><b>{data.prev.title}</b></a>}
        {data.next && <a href={`#/notice/${data.next.id}`}><small>다음 <IcNext /></small><b>{data.next.title}</b></a>}
      </nav>}
    </div>
  </div>;
}

export function MailSettings() {
  const {me, setMe} = useMe();
  const [busy, setBusy] = useState('');
  const set = async (k, v) => {
    setBusy(k);
    try { const d = await api('mail_prefs', {[k]: v}); setMe(d.user); toast(v ? '메일을 받도록 바꿨어요' : '메일을 받지 않도록 바꿨어요'); }
    catch {} finally { setBusy(''); }
  };
  return <div className="card">
    <h3>메일 알림</h3>
    <p className="muted">새 공지가 올라오면 가입한 이메일로 알려 드려요.</p>
    <Chk label="학과 공지 메일" desc={`${me.email} 로 받아요`} checked={me.mail_dept} disabled={busy === 'mail_dept'} onChange={v => set('mail_dept', v)} />
    <Chk label="행사 공지 메일" desc="새 행사 공지가 올라올 때만 받아요" checked={me.mail_event} disabled={busy === 'mail_event'} onChange={v => set('mail_event', v)} />
  </div>;
}
