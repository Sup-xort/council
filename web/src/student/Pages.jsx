// 대여 · 행사 · 공지
import {useEffect, useRef, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Selector} from '@astryxdesign/core/Selector';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {ProgressBar} from '@astryxdesign/core/ProgressBar';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {api, md, koDate, koWhen, koStamp, koSpan, toDate, toast} from '../lib/common.js';
import {useLoad} from '../ui/base.jsx';
import {useMe, Kp, stTone, DDay, GaugeRow, EventsList, Md, Chev, Ic, chipHref} from './parts.jsx';

// ── 대여 ──────────────────────────────────────────────────────────────
const byKind = items => { const m = new Map(); items.forEach(i => { const k = i.kind || i.name; (m.get(k) || m.set(k, []).get(k)).push(i); }); return [...m]; };
export function Items() {
  const {data} = useLoad(() => api('items'), []);
  if (!data) return <div className="kinds"><div className="skel" style={{height: 120}} /><div className="skel" style={{height: 120}} /></div>;
  const mine = data.items.filter(i => i.mine), kinds = byKind(data.items);
  return <div className="enter" style={{display: 'flex', flexDirection: 'column', gap: 12}}>
    <div className="sec-head" style={{marginBottom: 0}}><h2>물품 대여</h2>
      <span className="keys"><span><i style={{background: 'var(--ok-soft)', boxShadow: 'inset 0 0 0 1px var(--line)'}} />대여 가능</span><span><i style={{background: 'var(--busy)'}} />대여 중</span><span><i style={{background: 'var(--mine)'}} />내가 대여 중</span></span></div>
    <p className="muted" style={{margin: '-4px 4px 0'}}>물품에 붙은 QR을 휴대폰 기본 카메라로 찍으면 대여하고, 한 번 더 찍으면 반납됩니다.</p>
    {mine.length > 0 && <section className="mybar" aria-label="내가 대여한 물품"><h3>내가 대여한 물품 <span className="kp">{mine.length}개</span></h3>
      <div className="myrows">{mine.map(i => <div className="myrow" key={i.id}><b>{i.name}</b><span className="when">{koStamp(i.borrowed_at)}에 대여</span>
        <span className="kp">{koSpan(i.borrowed_at)}째</span>
        {i.due && <span className="when"><b>{koStamp(i.due)}까지</b> 반납해 주십시오{toDate(i.due) < new Date() ? ' (기한이 지났습니다)' : ''}</span>}</div>)}</div></section>}
    <div className="kinds">{kinds.length ? kinds.map(([k, its]) => {
      const left = its.filter(i => i.available).length;
      return <section className="kind" aria-label={k} key={k}><div className="row"><b className="grow">{k}</b>
        {left ? <Kp tone="ok">{left}개 남음</Kp> : <Kp tone="dim">모두 사용 중</Kp>}<Kp tone="dim">전체 {its.length}개</Kp></div>
        <div className="strip">{its.map(i => {
          const st = i.mine ? '내가 대여 중' : i.available ? '대여 가능' : '대여 중';
          return <span key={i.id} className={i.mine ? 'mine' : i.available ? '' : 'use'} title={`${i.name} ${st}`} aria-label={`${i.name} ${st}`}>{i.num ?? '1개'}</span>;
        })}</div></section>;
    }) : <div className="card muted">아직 대여할 수 있는 물품이 없습니다.</div>}</div>
  </div>;
}

// ── 행사 ──────────────────────────────────────────────────────────────
export function Events() {
  const {data} = useLoad(() => api('events'), []);
  return <div className="col"><h2 style={{marginBottom: 0}}>행사</h2>
    {data ? <div className="enter"><EventsList list={data.events} /></div> : <div className="skel" style={{height: 300}} />}</div>;
}

// 객관식·체크박스 보기: 큰 단추로 고른다. 한 번 더 누르면 선택 해제
function Opts({f, value, onChange, disabled}) {
  const multi = f.type === 'multi';
  const on = o => multi ? value.includes(o) : value === o;
  const flip = o => onChange(multi ? (value.includes(o) ? value.filter(x => x !== o) : [...value, o]) : value === o ? '' : o);
  return <fieldset disabled={disabled}><legend>{f.label}{f.required && <span className="req"> *</span>}</legend>
    {multi && <span style={{fontSize: 12, color: 'var(--sub)'}}>여러 개 고를 수 있습니다</span>}
    <div className="opts">{f.options.map(o => <button type="button" key={o} aria-pressed={on(o)} onClick={() => flip(o)}>{o}</button>)}</div>
  </fieldset>;
}
function Field({f, value, onChange, disabled}) {
  const label = f.label + (f.required ? ' *' : '');
  if (f.type === 'select' || f.type === 'multi') return <Opts f={f} value={value} onChange={onChange} disabled={disabled} />;
  if (f.type === 'checkbox') return <CheckboxInput label={label} value={!!value} onChange={onChange} isDisabled={disabled} />;
  if (f.type === 'dropdown') return <Selector label={label} options={f.options} value={value || undefined} placeholder="선택" onChange={onChange} isDisabled={disabled} size="lg" />;
  if (f.type === 'long') return <TextArea label={label} value={value} onChange={onChange} rows={4} maxLength={2000} isDisabled={disabled} />;
  return <TextInput label={label} value={value} onChange={onChange} isDisabled={disabled} size="lg" />;
}

export function Event({id, q}) {
  const {me, isAdmin} = useMe();
  const {data, reload} = useLoad(() => api('event?id=' + id), [id]);
  const [vals, setVals] = useState(null);
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!data) return;
    const app = data.application, v = {};
    data.event.fields.forEach((f, i) => { const x = app?.answers?.[i]; v[i] = f.type === 'checkbox' ? !!x : f.type === 'multi' ? (Array.isArray(x) ? [...x] : []) : (x ?? ''); });
    setVals(v);
  }, [data]);
  useEffect(() => { if (vals && q.get('apply')) box.current?.scrollIntoView({behavior: 'smooth'}); }, [!!vals]);
  if (!data || !vals) return <div className="col"><div className="skel" style={{height: 120}} /><div className="skel" style={{height: 300}} /></div>;

  const e = data.event, g = data.gauge, app = data.application;
  const state = e.closed ? '마감' : app ? '신청함' : g.full ? '정원 마감' : '모집 중';
  const cap = g.capacity, n = g.n;
  const duesLock = e.dues_only && !me.dues && !app;      // 학생회비를 낸 학생만 받는 행사
  const locked = e.closed || (g.full && !app) || duesLock;
  const ok = e.fields.every((f, i) => !f.required || (f.type === 'checkbox' ? vals[i] : f.type === 'multi' ? vals[i].length : String(vals[i]).trim()));
  const submit = async ev => {
    ev.preventDefault(); if (!ok || locked) return;
    setBusy(true);
    try { await api('apply', {event_id: e.id, answers: vals}); toast(app ? '수정했습니다' : '신청했습니다'); reload(); } catch {} finally { setBusy(false); }
  };
  return <div className="col enter">
    <div className="head"><div className="meta"><a className="lk" href="#/events" style={{minHeight: 32}}>‹ 행사 목록</a></div>
      <div className="meta"><span className={'pill ' + (app ? 'mine' : '')}>{state}</span><span><DDay date={e.deadline} closed={e.closed} />{koDate(e.deadline)} 마감</span>
        {isAdmin && <Button label="관리 사이트에서 수정" variant="secondary" size="md" href={`admin#/event/${e.id}`} style={{marginLeft: 'auto'}} />}</div>
      <h1>{e.title}</h1></div>
    <section className="card" aria-label="신청 현황" style={{margin: 0}}>
      {n == null ? <div className="gbig"><div className="n"><b style={{fontSize: 22}}>{g.full ? '정원이 찼습니다' : '신청 받는 중'}</b></div></div>
        : <div className="gbig"><div className="n"><b>{n}명</b><span>신청</span><em>{cap == null ? '인원 제한 없음' : cap - n > 0 ? `정원 ${cap}명 중 ${cap - n}자리 남음` : `정원 ${cap}명 마감`}</em></div>
          {cap == null ? <div className="gauge open" role="img" aria-label={`${n}명 신청, 인원 제한 없음`} />
            : <ProgressBar className="gbar big" label="신청 인원" isLabelHidden value={Math.min(n, cap)} max={cap} variant="accent" />}</div>}
    </section>
    <section className="rows" aria-label="행사 정보" style={{margin: 0}}>
      {e.starts_at && <div><span>일시</span><span>{koWhen(e.starts_at)}</span></div>}
      <div><span>신청 마감</span><span>{koWhen(e.deadline)}</span></div>
      {e.dues_only && <div><span>신청 대상</span><span>학생회비 납부자</span></div>}
    </section>
    {(e.body.trim() || data.notice_id) && <article className="card" style={{margin: 0}}><Md html={md(e.body)} />
      {data.notice_id && <a href={`#/notice/${data.notice_id}`} className="lk" style={{marginTop: 8}}>공지 전체 보기<Chev /></a>}</article>}
    <section className="card apply" ref={box} aria-label="신청서" style={{margin: 0}}><h2>신청서</h2>
      <div style={{display: 'flex', flexDirection: 'column', gap: 8}}><span className="kicker">신청자</span>
        <div className="who"><b>{me.name}</b><span>{me.student_id}</span></div>
        <span style={{fontSize: 12, color: 'var(--sub)'}}>이름·학번·이메일은 계정에서 자동으로 들어갑니다.</span></div>
      <form onSubmit={submit} style={{display: 'contents'}}>
        {e.fields.map((f, i) => <Field key={f.id ?? i} f={f} value={vals[i]} disabled={locked} onChange={v => setVals(o => ({...o, [i]: v}))} />)}
        {app && <div className="done"><Ic k="check" style={{width: 20, height: 20, strokeWidth: 2.4}} /><span>신청돼 있습니다. 마감 전까지 수정할 수 있습니다.</span></div>}
        {locked ? <p className="muted" style={{margin: 0}}>{e.closed ? '신청이 마감됐습니다.' + (app ? ' 신청한 내용은 위와 같습니다.' : '')
          : duesLock ? '학생회비 납부자만 신청할 수 있습니다. 납부했는데 이 글이 보이면 학생회에 알려 주십시오.' : '정원이 차서 더 이상 신청할 수 없습니다.'}</p>
          : <Button className="wide" type="submit" variant="primary" size="lg" width="100%" isDisabled={!ok} isLoading={busy}
            label={ok ? (app ? '신청 내용 수정' : '참여 신청') : '필수 질문에 답해 주십시오'} />}
      </form>
    </section>
  </div>;
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
  return <div className="col" style={{gap: 0}}>
    <div className="row"><h2 className="grow" style={{marginBottom: 16}}>공지</h2>{isAdmin && <Button label="글쓰기" variant="primary" size="md" href="admin#/notice/new" />}</div>
    <SegmentedControl className="seg" label="공지 종류" value={kind || 'all'} onChange={v => setKind(v === 'all' ? '' : v)} layout="fill">
      {tabs.map(([k, n]) => <SegmentedControlItem key={k || 'all'} value={k || 'all'} label={n} />)}
    </SegmentedControl>
    {data ? <div className="enter" key={kind}>{data.notices.length ? data.notices.map(n => <a className="nrow" key={n.id} href={`#/notice/${n.id}`}>
      <span className="kicker chipline"><Kp tone={n.kind === 'event' ? 'ok' : 'mine'}>{KIND[n.kind]}</Kp><Kp>{koDate(n.created_at)}</Kp></span>
      <h3>{n.title}</h3>{n.summary && <p className="muted" style={{margin: '4px 0 0'}}>{n.summary}</p>}</a>)
      : <div className="card muted">아직 올라온 공지가 없습니다.</div>}</div> : <div className="skel" style={{height: 240}} />}
    {!me && <p className="muted" style={{padding: '0 4px'}}>학과 공지는 로그인하면 볼 수 있습니다. <a href="#/login?next=%23%2Fnotices">로그인</a></p>}
  </div>;
}
function LinkedEvent({g}) {
  const st = g.closed ? '마감' : g.full ? '정원 마감' : '모집 중';
  return <section className="card linked" aria-label="연결된 행사" style={{margin: 0}}>
    <span className="kicker chipline"><DDay date={g.deadline} closed={g.closed} /><Kp>연결된 행사</Kp><Kp tone={stTone(st)}>{st}</Kp><Kp>{koDate(g.deadline)} 마감</Kp></span>
    <span style={{fontSize: 19, fontWeight: 600, letterSpacing: -.4}}>{g.title}</span><GaugeRow g={g} />
    <Button className="wide" variant="primary" size="lg" width="100%" href={`#/event/${g.id}${g.closed ? '' : '?apply=1'}`} label={g.closed ? '행사 보기' : '신청하러 가기'} />
  </section>;
}
export function Notice({id}) {
  const {isAdmin} = useMe();
  const {data} = useLoad(() => api('notice?id=' + id), [id]);
  if (!data) return <div className="col"><div className="skel" style={{height: 100}} /><div className="skel" style={{height: 400}} /></div>;
  const n = data.notice;
  return <div className="col enter" key={id}>
    <div className="head"><div className="meta"><a className="lk" href="#/notices" style={{minHeight: 32}}>‹ 공지 목록</a></div>
      <div className="meta"><span className="pill">{KIND[n.kind]}</span><Kp>{koDate(n.created_at)}</Kp>{n.author && <Kp>{n.author}</Kp>}
        {isAdmin && <Button label="수정" variant="secondary" size="md" href={`admin#/notice/${n.id}`} style={{marginLeft: 'auto'}} />}</div>
      <h1>{n.title}</h1></div>
    <article className="reading"><Md html={md(n.body)} />
      {n.chips?.length > 0 && <div className="chips">{n.chips.map((c, i) => c.type === 'url'
        ? <a key={i} className="chip" href={c.target} target="_blank" rel="noopener noreferrer">{c.label} ›</a>
        : <a key={i} className="chip" href={chipHref(c)}>{c.label} ›</a>)}</div>}</article>
    {n.event && <LinkedEvent g={n.event} />}
    {(data.prev || data.next) && <nav className="pn" aria-label="다른 공지">
      {data.prev && <a href={`#/notice/${data.prev.id}`}><small>이전 글</small><b>{data.prev.title}</b></a>}
      {data.next && <a href={`#/notice/${data.next.id}`}><small>다음 글</small><b>{data.next.title}</b></a>}</nav>}
  </div>;
}
