// 학생 사이트의 틀: 머리줄 + 메뉴, 주소에 맞는 화면
import {useEffect, useState} from 'react';
import {api} from '../lib/common.js';
import {useHash, ThemeButton} from '../ui/base.jsx';
import {MeCtx, goLogin} from './parts.jsx';
import {Login, Signup, Forgot, Reset, Logout, Scan} from './Auth.jsx';
import Lobby from './Lobby.jsx';
import Reserve from './Reserve.jsx';
import {Items, Events, Event, Notices, Notice} from './Pages.jsx';

// [주소 모양, 화면, 로그인 필요]
const ROUTES = [
  [/^\/login$/, ({q}) => <Login q={q} />],
  [/^\/signup$/, ({q}) => <Signup q={q} />],
  [/^\/forgot$/, () => <Forgot />],
  [/^\/reset\/([\w-]+)$/, ({m}) => <Reset token={m[1]} />],
  [/^\/reset$/, () => { location.hash = '#/forgot'; return null; }],
  [/^\/logout$/, () => <Logout />],
  [/^\/q\/([a-z0-9]+)$/, ({m}) => <Scan code={m[1]} />, true],
  [/^\/$/, () => <Lobby />],
  [/^\/items$/, () => <Items />, true],
  [/^\/reserve$/, ({q}) => <Reserve q={q} />, true],
  [/^\/events$/, () => <Events />],
  [/^\/event\/(\d+)$/, ({m, q}) => <Event id={m[1]} q={q} />, true],
  [/^\/notices$/, () => <Notices />],
  [/^\/notice\/(\d+)$/, ({m}) => <Notice id={m[1]} />],
];
const BARE = /^\/(login|signup|forgot|reset)/;     // 로그인·가입·찾기 화면은 머리줄·메뉴 없이
const TABS = [['#/', '로비'], ['#/notices', '공지', '/notice'], ['#/items', '대여'], ['#/reserve', '예약'], ['#/events', '행사', '/event']];

function Header({path, me}) {
  const isAdmin = me && (me.role === 'admin' || me.role === 'super');
  return <header><div className="bar"><a className="mark" href="#/">SWITCH</a>
    <nav id="nav" aria-label="메뉴">{TABS.map(([h, t, pre]) => {
      const on = path === h.slice(1) || (h !== '#/' && path.startsWith(pre || h.slice(1)));
      return <a key={h} href={h} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>{t}</a>;
    })}</nav>
    <div className="who">{me
      ? <>{isAdmin && <a className="adm" href="admin">관리 사이트</a>}<span>{me.name}</span><a href="#/logout">로그아웃</a></>
      : <a href="#/login">로그인</a>}<ThemeButton /></div>
  </div></header>;
}

export default function App() {
  const [me, setMe] = useState(undefined);       // undefined = 아직 모름, null = 로그인 안 함
  const {path, q, hash} = useHash('/');
  useEffect(() => { api.onAuth = () => { setMe(null); goLogin(); }; api('me').then(d => setMe(d.user), () => setMe(null)); }, []);
  useEffect(() => { if (/^\/admin/.test(path)) location.href = 'admin'; }, [path]);   // 옛 관리 탭 주소 → 관리 사이트
  useEffect(() => { window.scrollTo(0, 0); }, [path]);
  if (me === undefined) return null;
  let page = null;
  for (const [re, fn, needLogin] of ROUTES) {
    const m = path.match(re); if (!m) continue;
    if (needLogin && !me) { setTimeout(goLogin); break; }
    page = fn({m, q});
    break;
  }
  if (!page && !ROUTES.some(([re]) => re.test(path))) setTimeout(() => { location.hash = '#/'; });
  const bare = BARE.test(path);
  return <MeCtx.Provider value={{me, setMe}}>
    {!bare && <Header path={path} me={me} />}
    <main key={path}>{page}</main>
  </MeCtx.Provider>;
}
