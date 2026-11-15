// 세미나실 예약: 칸을 누르거나 누른 채로 끌어서 여러 시간을 고른다
import {useEffect, useMemo, useRef, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {api, iso, addDays, koDate, koDay, koRange, toast} from '../lib/common.js';
import {useAsk, useLoad} from '../ui/base.jsx';
import {days7, HOURS, rangeLabel, whoMsg, Legend, DayHead, WeekNav, RoomPick} from './Lobby.jsx';

export default function Reserve({q}) {
  const ask = useAsk();
  const today = iso(new Date());
  const [room, setRoom] = useState(+q.get('room') || null);
  const [day, setDay] = useState(q.get('date') || today);
  // 넘겨받은 날이 오늘부터 7일 안이면 오늘부터, 밖이면 그날부터 보인다
  const [wstart, setWstart] = useState(() => { const d = q.get('date') || today; return d < today ? today : d > addDays(today, 6) ? d : today; });
  const [sel, setSel] = useState(() => new Set(q.get('hour') ? [+q.get('hour')] : []));
  const [busy, setBusy] = useState(false);
  const {data, reload} = useLoad(() => Promise.all([api('week?start=' + wstart), api('my_reservations')]), [wstart]);
  const anchor = useRef(null), gridRef = useRef(null), scrolled = useRef(false);

  const w = data?.[0], my = data?.[1];
  const rm = room || w?.rooms[0].id;
  const days = w ? days7(w.start) : [];
  const dsel = days.includes(day) ? day : days[0];
  const taken = useMemo(() => {
    const t = {}; w?.reservations.filter(r => r.room_id === rm).forEach(r => { t[r.date + '|' + r.hour] = r; }); return t;
  }, [w, rm]);
  const nowD = w?.now.slice(0, 10), nowH = w ? +w.now.slice(11, 13) : 0;
  const isPast = (d, h) => d < nowD || (d === nowD && h < nowH);
  const free = (d, h) => h >= 0 && h < 24 && !taken[d + '|' + h] && !isPast(d, h);

  // 넘겨받은 시간 칸이 보이게 한 번만 내린다
  useEffect(() => {
    if (!w || scrolled.current || !q.get('hour')) return;
    scrolled.current = true;
    gridRef.current?.querySelector(`[data-d="${dsel}"][data-h="${q.get('hour')}"]`)?.scrollIntoView({block: 'center'});
  }, [w]);

  if (!data) return <div className="cols"><div className="skel" style={{height: 700}} /><div className="skel" style={{height: 160}} /></div>;

  // 내 예약: 같은 방·날의 이어진 시간은 한 줄로
  const mine = [];
  [...my.reservations].sort((a, b) => a.date.localeCompare(b.date) || a.room.localeCompare(b.room) || a.hour - b.hour).forEach(r => {
    const g = mine[mine.length - 1];
    if (g && g.room === r.room && g.date === r.date && g.end === r.hour) { g.end++; g.ids.push(r.id); }
    else mine.push({room: r.room, date: r.date, start: r.hour, end: r.hour + 1, ids: [r.id]});
  });

  const reset = () => setSel(new Set());
  const at = e => { const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-h]'); return el && gridRef.current.contains(el) ? {d: el.dataset.d, h: +el.dataset.h} : null; };
  const extend = h => {                               // 시작 칸부터 h 까지(같은 날), 막힌 칸을 만나면 거기서 멈춘다
    const a = anchor.current, step = h >= a ? 1 : -1, s = new Set();
    for (let i = a; i !== h + step && free(dsel, i); i += step) s.add(i);
    setSel(s);
  };
  const down = e => {
    const p = at(e); if (!p) return;
    const r = taken[p.d + '|' + p.h];
    if (r) return toast(whoMsg(p.d, p.h, r.mine ? '내 예약' : r.who));
    if (!free(p.d, p.h)) return;
    const only = dsel === p.d && sel.size === 1 && sel.has(p.h);
    setDay(p.d); anchor.current = p.h; setSel(only ? new Set() : new Set([p.h]));
    gridRef.current.setPointerCapture(e.pointerId); e.preventDefault();
  };
  const move = e => { if (anchor.current == null) return; const p = at(e); if (p && p.d === dsel) extend(p.h); };
  const up = () => { anchor.current = null; };

  const hs = [...sel].sort((x, y) => x - y);
  const go = async () => {
    setBusy(true);
    try { await api('reserve', {room_id: rm, date: dsel, hours: hs}); reset(); toast('예약했습니다'); reload(); } catch {} finally { setBusy(false); }
  };
  const cancel = async ids => {
    if (!await ask.confirm('예약을 취소하시겠습니까?', {actionLabel: '예약 취소', danger: true})) return;
    await api('unreserve', {ids}); toast('취소했습니다'); reload();
  };
  const shift = n => { setWstart(addDays(w.start, n)); reset(); };

  return <div className="cols enter">
    <section className="card tight">
      <div className="head" style={{padding: '0 8px', margin: '0 0 8px'}}><h1 className="big-title">세미나실 예약</h1></div>
      <div style={{margin: '0 4px'}}><RoomPick rooms={w.rooms} room={rm} onChange={v => { setRoom(v); reset(); }} /></div>
      <div className="wkbar"><b>{rangeLabel(days)}</b>
        <WeekNav onPrev={() => shift(-7)} onToday={() => { setWstart(today); setDay(today); reset(); }} onNext={() => shift(7)} /></div>
      <div>
        <DayHead days={days} today={nowD} />
        <div className="tt" ref={gridRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {HOURS.map(hr => <div className="wk" key={hr}><span className="hh">{hr}시</span>{days.map(d => {
            const r = taken[d + '|' + hr];
            const cls = r ? (r.mine ? 'mine' : 'busy') : isPast(d, hr) ? 'past' : d === dsel && sel.has(hr) ? 'sel' : '';
            return <div key={d} className={'tc ' + cls} data-d={d} data-h={hr} />;
          })}</div>)}
        </div>
      </div>
      <Legend extra={<span>누른 채로 끌면 여러 시간을 한 번에 고릅니다</span>} />
      {hs.length > 0 && <div className="act">
        <span>{koDate(dsel)} {koRange(hs[0], hs[hs.length - 1] + 1)} ({hs.length}시간)</span>
        <Button label="예약" variant="secondary" size="lg" onClick={go} isLoading={busy} />
      </div>}
    </section>
    <section className="card"><h3>내 예약</h3>
      {mine.length ? <div className="list">{mine.map(g => <div key={g.ids[0]}>
        <span className="grow">{g.room}<br /><span className="muted">{koDay(g.date)}{koDay(g.date) === koDate(g.date) ? '' : ` ${koDate(g.date)}`} {koRange(g.start, g.end)}</span></span>
        <Button label="취소" variant="destructive" size="md" onClick={() => cancel(g.ids)} />
      </div>)}</div> : <p className="muted" style={{margin: 0}}>예약한 시간이 없습니다.</p>}
    </section>
  </div>;
}
