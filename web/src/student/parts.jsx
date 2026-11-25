// 여러 화면이 같이 쓰는 조각들
import {createContext, useContext} from 'react';
import {IcFlag, IcNext} from '../ui/icons.jsx';
import {koDate, koWhen, dday} from '../lib/common.js';
import {Pb, Pill, stTone, Gauge, Empty, More} from '../ui/kit.jsx';

export const MeCtx = createContext({me: null, setMe: () => {}});
export const useMe = () => {
  const c = useContext(MeCtx);
  return {...c, isAdmin: !!c.me && (c.me.role === 'admin' || c.me.role === 'super')};
};
export function goLogin() { location.hash = '#/login?next=' + encodeURIComponent(location.hash || '#/'); }
// 로그인 뒤 돌아갈 곳: 관리 사이트(admin…)에서 왔으면 그쪽으로
export const goNext = next => { if (/^admin(#|$)/.test(next)) location.href = next; else location.hash = next; };

export const State = ({st}) => <Pill tone={stTone(st)}>{st}</Pill>;
// kicker: "모집 중 · 12.03 마감" / D-day 가 가까우면 "D-3"
const md = s => { const d = s && s.slice(5, 10).replace('-', '.'); return d || ''; };
export const kicker = (st, deadline, closed) => [st, closed ? '' : dday(deadline), deadline ? `${md(deadline)} 마감` : ''].filter(Boolean).join(' · ');

// 행사 목록 (로비와 행사 화면이 같이 쓴다): 한 판 안에 행사를 쌓고, 마감된 것은 아래 한 줄씩
export function EventsList({list}) {
  const {me} = useMe();
  if (!list.length) return <div className="card"><Empty icon={<IcFlag />} title="아직 열린 행사가 없습니다" /></div>;
  const open = list.filter(e => !e.closed), done = list.filter(e => e.closed);
  return <div className="evlist">
    {open.map(e => {
      const g = e.gauge, st = e.applied ? '신청함' : g.full ? '정원 마감' : '모집 중';
      return <div className="ev" key={e.id}>
        <span className="kicker">{kicker(st, e.deadline)}{e.dues_only ? ' · 납부자만' : ''}</span>
        <h3>{e.title}</h3>
        {e.starts_at && <span className="when">{koWhen(e.starts_at)}</span>}
        <Gauge g={g} />
        <div className="acts">
          {e.applied ? <Pb soft href={`#/event/${e.id}?apply=1`}>신청 수정</Pb>
            : g.full ? null
              : e.dues_only && me && !me.dues ? <span className="muted">학생회비 납부자만 신청할 수 있습니다</span>
                : <Pb href={`#/event/${e.id}?apply=1`}>참여 신청</Pb>}
          <More href={`#/event/${e.id}`} />
        </div>
      </div>;
    })}
    {done.map(e => <a className="evdone" key={e.id} href={`#/event/${e.id}`}><span className="grow">{e.title}</span><span>마감됨</span><IcNext /></a>)}
  </div>;
}

// 마감 날짜 한 줄 (상세 머리말용)
export const DueText = ({date}) => <span>{koDate(date)} 마감</span>;

export const SEMINAR = false;   // 세미나실 기능을 숨기는 스위치. true 로 바꾸면 다시 나타난다

// 공지 아래 바로가기 버튼이 가는 곳
const TABLINK = {home: '#/', notices: '#/notices', events: '#/events', reserve: '#/reserve', loans: '#/items'};
export const chipHref = c => c.type === 'tab' ? (TABLINK[c.target] || '#/') : c.type === 'event' ? `#/event/${c.target}?apply=1`
  : c.type === 'notice' ? `#/notice/${c.target}` : c.target;
