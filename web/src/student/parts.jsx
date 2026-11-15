// 여러 화면이 같이 쓰는 작은 조각들.
import {createContext, useContext} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {ProgressBar} from '@astryxdesign/core/ProgressBar';
import {koDate, koWhen, dday} from '../lib/common.js';

// 로그인한 사람
export const MeCtx = createContext({me: null, setMe: () => {}});
export const useMe = () => {
  const c = useContext(MeCtx);
  return {...c, isAdmin: !!c.me && (c.me.role === 'admin' || c.me.role === 'super')};
};
export function goLogin() { location.hash = '#/login?next=' + encodeURIComponent(location.hash || '#/'); }
// 로그인 뒤 돌아갈 곳: 관리 사이트(admin…)에서 왔으면 그쪽으로
export const goNext = next => { if (/^admin(#|$)/.test(next)) location.href = next; else location.hash = next; };

// 테두리만 있는 단색 아이콘 — 선 색이 글자색을 따른다
const ICON = {
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  back: <><path d="M9 6.5 4.5 11 9 15.5" /><path d="M5 11h9.5a5 5 0 0 1 0 10H12" /></>,
  stop: <><circle cx="12" cy="12" r="7.5" /><path d="m6.8 17.2 10.4-10.4" /></>,
  alert: <path d="M12 6.5v7M12 17v.5" />,
  left: <path d="M14.5 6 8.5 12l6 6" />,
  right: <path d="M9.5 6l6 6-6 6" />,
};
export const Ic = ({k, className = 'i', ...p}) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...p}>{ICON[k]}</svg>;
export const Chev = () => <Ic k="right" className="s" />;

// 작은 칩: 글자 또는 색 이름이 붙은 글자
export const Kp = ({tone = '', children}) => <span className={'kp ' + tone}>{children}</span>;
export const stTone = st => st === '모집 중' ? 'ok' : st === '신청함' ? 'mine' : 'dim';
export function DDay({date, closed}) {
  const t = closed ? '' : dday(date);
  return t ? <b className={'dday' + (t === 'D-DAY' ? ' today' : '')}>{t}</b> : null;
}

// 신청 인원 막대. 정원이 없으면 연두 단색 막대 (끝을 정할 수 없으니 채움 정도는 없다)
export function GaugeRow({g}) {
  if (!g || g.n == null) return null;
  return <div className="g">
    <div className="t"><span><b>{g.n}명</b> 신청</span><span>{g.capacity == null ? '인원 제한 없음' : `정원 ${g.capacity}명`}</span></div>
    {g.capacity == null
      ? <div className="gauge open" role="img" aria-label={`${g.n}명 신청, 인원 제한 없음`} />
      : <ProgressBar className="gbar" label="신청 인원" isLabelHidden value={Math.min(g.n, g.capacity)} max={g.capacity} variant="accent" />}
  </div>;
}

// 행사 목록 (로비와 행사 화면이 같이 쓴다)
export function EventsList({list}) {
  const {me} = useMe();
  if (!list.length) return <div className="card muted">아직 열린 행사가 없습니다.</div>;
  const open = list.filter(e => !e.closed), done = list.filter(e => e.closed);
  return <div className="evlist">
    {open.map(e => {
      const g = e.gauge, st = e.applied ? '신청함' : g.full ? '정원 마감' : '모집 중';
      return <article className="ev" key={e.id}>
        <span className="kicker chipline"><DDay date={e.deadline} closed={e.closed} /><Kp tone={stTone(st)}>{st}</Kp><Kp>{koDate(e.deadline)} 마감</Kp>{e.dues_only && <Kp>납부자만</Kp>}</span>
        <h3>{e.title}</h3>
        {e.starts_at && <span className="when">{koWhen(e.starts_at)}</span>}
        <GaugeRow g={g} />
        <div className="acts">
          {e.applied ? <Button label="수정" variant="secondary" size="md" href={`#/event/${e.id}?apply=1`} />
            : g.full ? null
              : e.dues_only && me && !me.dues ? <span className="muted" style={{fontSize: 13}}>학생회비 납부자만 신청할 수 있습니다</span>
                : <Button label="신청" variant="primary" size="md" href={`#/event/${e.id}?apply=1`} />}
          <a className="lk" href={`#/event/${e.id}`}>자세히</a>
        </div>
      </article>;
    })}
    {done.map(e => <a className="evdone" key={e.id} href={`#/event/${e.id}`}><span className="grow">{e.title}</span><span style={{fontSize: 13}}>마감</span><Chev /></a>)}
  </div>;
}

// 본문 서식 글 (md() 가 먼저 전부 이스케이프하고 우리가 만든 태그만 넣는다)
export const Md = ({html, className = 'md'}) => <div className={className} dangerouslySetInnerHTML={{__html: html}} />;

// 공지 아래 바로가기 버튼이 가는 곳
const TABLINK = {home: '#/', notices: '#/notices', events: '#/events', reserve: '#/reserve', loans: '#/items'};
export const chipHref = c => c.type === 'tab' ? (TABLINK[c.target] || '#/') : c.type === 'event' ? `#/event/${c.target}?apply=1`
  : c.type === 'notice' ? `#/notice/${c.target}` : c.target;
