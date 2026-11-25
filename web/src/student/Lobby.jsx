// 로비: 배너 → 행사 (세미나실을 켜면 넓은 화면에서 세미나실과 행사를 나란히)
import {useEffect, useRef, useState} from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import {api, addDays, toDate, koDate, koTime, koWhen, dday, wd, WD, toast} from '../lib/common.js';
import {useLoad, useMQ} from '../ui/base.jsx';
import {Rb, Seg, Legend as LegendBase, More, Loading} from '../ui/kit.jsx';
import {IcNext} from '../ui/icons.jsx';
import {useMe, goLogin, EventsList, chipHref, SEMINAR} from './parts.jsx';

export const days7 = start => [...Array(7)].map((_, i) => addDays(start, i));
export const HOURS = [...Array(24)].map((_, i) => i);          // 0시~23시 칸 (끝은 24시)
export const DAY_FROM = 8;                                      // 시간표는 기본으로 8시부터 보인다
export const rangeLabel = days => `${koDate(days[0]).replace(/ \(.\)$/, '')} – ${days[0].slice(5, 7) === days[6].slice(5, 7) ? `${+days[6].slice(8)}일` : koDate(days[6]).replace(/ \(.\)$/, '')}`;
export const whoMsg = (d, h, who) => `${koDate(d)} ${koTime(h)}는 ${who === '내 예약' ? '내가 예약한 시간입니다' : `${who} 님이 예약했습니다`}`;
export const Legend = ({extra}) => <LegendBase items={[['ok-soft', '비어 있음'], ['busy', '예약됨'], ['mine', '내 예약']]} extra={extra} />;
export function DayHead({days, today}) {
  return <div className="wk wk-head"><span />{days.map(d =>
    <div key={d} className={`dh ${d === today ? 'today' : ''} ${toDate(d).getDay() === 0 ? 'sun' : ''}`}>{wd(d)}<b>{+d.slice(8)}</b></div>)}</div>;
}
export function WeekNav({onPrev, onToday, onNext}) {
  return <div className="row wknav">
    <Rb label="이전 7일" onClick={onPrev}><ChevronLeft /></Rb>
    <button type="button" className="rb txt" onClick={onToday}>오늘</button>
    <Rb label="다음 7일" onClick={onNext}><ChevronRight /></Rb>
  </div>;
}
export const RoomPick = ({rooms, room, onChange}) => <Seg label="세미나실 고르기" value={room} onChange={onChange} items={rooms.map(r => [r.id, r.name])} />;

// 배너 그림: 글 번호로 정해지는 난수로 도형 배치를 고른다 — 같은 글은 늘 같은 그림, 글마다 다른 그림
function seeded(str) {
  let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
function BannerArt({b}) {
  const r = seeded(b.type + b.id), P = ['var(--ok)', 'var(--mine)', 'var(--sand)', 'var(--art-ink)'];
  const pick = () => P[Math.floor(r() * 3)], k = Math.floor(r() * 3), ev = b.type === 'event';
  let g;
  if (ev) {
    const a = Math.floor(r() * 3);
    g = <><circle cx={290 + r() * 20} cy={10 + r() * 20} r={70 + r() * 20} style={{fill: P[a]}} />
      <circle cx={10 + r() * 30} cy={210 - r() * 20} r={50 + r() * 20} style={{fill: P[(a + 1) % 3]}} /></>;
  } else if (k === 0) {
    g = <><circle cx={200 + r() * 40} cy={70 + r() * 30} r={80 + r() * 20} style={{fill: P[0]}} />
      <circle cx={80 + r() * 30} cy={170 + r() * 20} r={55 + r() * 15} style={{fill: P[1]}} />
      {[0, 1, 2].map(i => [0, 1, 2].map(j => <circle key={i * 3 + j} cx={40 + i * 18} cy={36 + j * 18} r="3.5" style={{fill: 'var(--art-ink)'}} />))}</>;
  } else if (k === 1) {
    const c1 = pick(), c2 = P[(P.indexOf(c1) + 1) % 3];
    g = <>{[0, 1, 2, 3].map(i => <path key={i} d={`M${-10 + i * 90} 220 a45 45 0 0 1 90 0z`} style={{fill: i % 2 ? c1 : c2}} />)}
      <rect x={170 + r() * 40} y={30 + r() * 20} width="88" height="88" rx="18" transform={`rotate(${-12 + r() * 24} 230 80)`} style={{fill: pick()}} />
      <circle cx={70 + r() * 30} cy={70 + r() * 20} r="26" style={{fill: 'none', stroke: 'var(--art-ink)', strokeWidth: 6}} /></>;
  } else {
    g = <><circle cx={110 + r() * 40} cy="110" r="78" style={{fill: P[1]}} />
      <circle cx={200 + r() * 30} cy="110" r="78" style={{fill: P[0], mixBlendMode: 'multiply'}} />
      <circle cx="260" cy={40 + r() * 20} r="22" style={{fill: 'none', stroke: 'var(--art-ink)', strokeWidth: 6}} />
      <rect x={36 + r() * 20} y="132" width="30" height="30" rx="8" style={{fill: 'var(--art-ink)'}} /></>;
  }
  let date = null;
  if (ev) {
    const s = b.starts_at || b.event.deadline, d = toDate(s), dd = dday(b.event.deadline);
    date = <div className="date"><small>{d.getMonth() + 1}월{b.starts_at ? '' : ' 마감'}</small><b>{d.getDate()}</b><small className="wd">{WD[d.getDay()]}요일</small>{dd && !b.event.closed && <em>마감 {dd}</em>}</div>;
  }
  return <div className="art" aria-hidden="true"><svg viewBox="0 0 320 220" preserveAspectRatio="xMidYMid slice">{g}</svg>{date}</div>;
}
function Banner({b}) {
  const g = b.event, ev = b.type === 'event';
  const label = ev ? `행사 · ${g.closed ? '마감' : g.full ? '정원 마감' : '모집 중'}` : (b.kind === 'dept' ? '학과 공지' : '행사 공지');
  const sub = ev ? (b.starts_at ? `${koWhen(b.starts_at)} 시작` : `${koDate(g.deadline)} 마감`) : b.summary;
  const chip = (b.chips || [])[0], url = chip?.type === 'url';
  return <>
    <div className="bn-text">
      <span className="bn-kicker">{label}</span>
      <h2>{b.title}</h2>
      {sub && <p className="bn-sub">{sub}</p>}
      <div className="bn-go">
        {chip && <a className="bn-cta" href={url ? chip.target : chipHref(chip)} target={url ? '_blank' : undefined} rel={url ? 'noopener noreferrer' : undefined}>{chip.label}</a>}
        <a className="bn-more" href={ev ? `#/event/${b.id}` : `#/notice/${b.id}`}>자세히 보기<IcNext /></a>
      </div>
    </div>
    <BannerArt b={b} />
  </>;
}
function Carousel({list}) {
  const [i, setI] = useState(0), n = list.length;
  const cur = Math.min(i, n - 1), x0 = useRef(null), dir = useRef(1);
  const [hold, setHold] = useState(false);
  const to = k => { dir.current = k > cur || (cur === n - 1 && k === 0) ? 1 : -1; setI(k); };
  // 7초마다 저절로 넘긴다. 손가락이 닿거나 마우스가 올라가 있으면 멈춘다
  useEffect(() => {
    if (n < 2 || hold || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(() => { dir.current = 1; setI(k => (Math.min(k, n - 1) + 1) % n); }, 7000);
    return () => clearTimeout(t);
  }, [cur, n, hold]);
  if (!n) return null;
  return <section className="banner" aria-label="공지·행사 배너" aria-roledescription="carousel" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}
    onTouchStart={e => { x0.current = e.touches[0].clientX; setHold(true); }}
    onTouchEnd={e => {
      setHold(false);
      if (x0.current == null) return; const dx = e.changedTouches[0].clientX - x0.current; x0.current = null;
      if (Math.abs(dx) > 50 && n > 1) to((cur + (dx < 0 ? 1 : -1) + n) % n);
    }}>
    <div className={'slide ' + (dir.current > 0 ? 'fwd' : 'bwd')} key={list[cur].type + list[cur].id}><Banner b={list[cur]} /></div>
    {n > 1 && <div className="dots">{list.map((_, k) =>
      <button key={k} aria-label={`${k + 1}번째 배너`} aria-current={k === cur} className={k === cur ? 'on' : ''} onClick={() => to(k)}><i /></button>)}</div>}
  </section>;
}

// 로비 시간표 칸: 비어 있으면 예약하러 가고, 차 있으면 누가 했는지 알려 준다
function WeekGrid({w, days, room, me}) {
  const today = w.now.slice(0, 10), nowH = +w.now.slice(11, 13), map = {};
  w.reservations.filter(r => r.room_id === room).forEach(r => { map[r.date + '|' + r.hour] = r; });
  const click = (d, hr, r) => {
    if (r) return toast(whoMsg(d, hr, r.mine ? '내 예약' : r.who));
    if (!me) return goLogin();
    location.hash = `#/reserve?room=${room}&date=${d}&hour=${hr}`;
  };
  const key = f => e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f(); } };
  return <div className="grid-rows">{HOURS.filter(hr => hr >= DAY_FROM).map(hr => <div className="wk" key={hr}><span className="hh">{hr}시</span>
    {days.map(d => {
      const r = map[d + '|' + hr], past = d < today || (d === today && hr < nowH), f = () => click(d, hr, r);
      return r ? <span key={d} role="button" tabIndex={0} className={'c ' + (r.mine ? 'mine' : 'busy')} onClick={f} onKeyDown={key(f)}
          aria-label={`${koDate(d)} ${koTime(hr)} ${r.mine ? '내 예약' : '예약됨'}`}>{r.mine ? '내 예약' : '예약됨'}</span>
        : past ? <button key={d} className="past" disabled aria-label={`${koDate(d)} ${koTime(hr)} 지남`} />
          : <button key={d} onClick={f} aria-label={`${koDate(d)} ${koTime(hr)} 예약하기`} />;
    })}</div>)}</div>;
}

function DayBar({name, w, room}) {
  const today = w.now.slice(0, 10), nowH = +w.now.slice(11, 13) + +w.now.slice(14, 16) / 60, map = {};
  w.reservations.filter(r => r.room_id === room && r.date === today).forEach(r => { map[r.hour] = r; });
  return <div className="daybar-w">
    <b>{name}</b>
    <div className="daybar" role="img" aria-label={`${name} 오늘 예약 현황`}>
      {HOURS.map(h => <i key={h} className={map[h] ? (map[h].mine ? 'mine' : 'busy') : ''} />)}
      <b style={{left: `${nowH / 24 * 100}%`}} />
    </div>
    <div className="daybar-t"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
  </div>;
}

const keep = {room: null, start: null};   // 화면을 옮겨 다녀도 고른 방·주는 기억한다
export default function Lobby() {
  const {me} = useMe(), narrow = useMQ('(max-width: 640px)');
  const [start, setStart] = useState(keep.start), [room, setRoom] = useState(keep.room);
  keep.start = start; keep.room = room;
  const {data} = useLoad(() => Promise.all([api('banners'), SEMINAR ? api('week' + (start ? '?start=' + start : '')) : null, api('events')]), [start]);
  if (!data) return <Loading rows={[248, 300]} />;
  const [{banners}, w, ev] = data;
  const rm = w && (room || w.rooms[0].id), days = w && days7(w.start);
  return <div className="col-lobby enter">
    <Carousel list={banners} />
    <div className={SEMINAR ? 'lobby' : 'lobby solo'}>
      {!SEMINAR ? null : narrow ? <section className="room">
        <div className="sec-h"><h2>세미나실</h2><More href={me ? '#/reserve' : '#/login'}>예약하기</More></div>
        <div className="card">
          <p className="kicker">오늘 {koDate(w.now.slice(0, 10))}</p>
          {w.rooms.map(r => <DayBar key={r.id} name={r.name} w={w} room={r.id} />)}
          <Legend /></div>
      </section>
      : <section className="room">
        <div className="sec-h"><h2>세미나실</h2><span className="kicker">{rangeLabel(days)}</span></div>
        <div className="row"><div className="grow"><RoomPick rooms={w.rooms} room={rm} onChange={setRoom} /></div>
          <WeekNav onPrev={() => setStart(addDays(w.start, -7))} onToday={() => setStart(null)} onNext={() => setStart(addDays(w.start, 7))} /></div>
        <div className="card">
          <DayHead days={days} today={w.now.slice(0, 10)} />
          <WeekGrid w={w} days={days} room={rm} me={me} />
          <Legend /></div>
        {!me && <p className="muted center">예약·대여·행사 신청은 <a href="#/login">로그인</a> 후 이용할 수 있습니다</p>}
      </section>}
      <section className="ev-sec">
        <div className="sec-h"><h2>행사</h2><More href="#/events">전체 보기</More></div>
        <EventsList list={ev.events.slice(0, 6)} />
      </section>
    </div>
  </div>;
}

