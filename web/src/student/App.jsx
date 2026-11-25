// 학생 사이트의 틀: 위 머리줄(로고 · 이름 · 밝기) + 아래 떠 있는 유리 탭바.
import {useEffect, useState} from 'react';
import {Settings} from 'lucide-react';
import {IcHome, IcDoc, IcBox, IcCal, IcFlag, IcBack} from '../ui/icons.jsx';
import {api} from '../lib/common.js';
import {useHash, ThemeButton, useAsk} from '../ui/base.jsx';
import {MeCtx, goLogin, SEMINAR} from './parts.jsx';
import {Login, Signup, Forgot, Reset, Logout, Scan} from './Auth.jsx';
import Lobby from './Lobby.jsx';
import Reserve from './Reserve.jsx';
import Privacy from './Privacy.jsx';
import {Items, Events, Event, EventApply, Notices, Notice, MailSettings} from './Pages.jsx';

let resetToken = '';

// [주소 모양, 화면, 로그인 필요]
const ROUTES = [
  [/^\/login$/, ({q}) => <Login q={q} />],
  [/^\/signup$/, ({q}) => <Signup q={q} />],
  [/^\/forgot$/, () => <Forgot />],
  [/^\/reset\/([\w-]+)$/, ({m}) => { resetToken = m[1]; return <Reset token={m[1]} />; }],
  [/^\/reset$/, () => { if (resetToken) return <Reset token={resetToken} />; location.hash = '#/forgot'; return null; }],
  [/^\/logout$/, () => <Logout />],
  [/^\/q\/([a-z0-9]+)$/, ({m}) => <Scan code={m[1]} />, true],
  [/^\/$/, () => <Lobby />],
  [/^\/items$/, () => <Items />, true],
  ...(SEMINAR ? [[/^\/reserve$/, ({q}) => <Reserve q={q} />, true]] : []),
  [/^\/events$/, () => <Events />],
  [/^\/event\/([0-9a-f]{16})\/apply$/, ({m}) => <EventApply id={m[1]} />, true],
  [/^\/event\/([0-9a-f]{16})$/, ({m, q}) => <Event id={m[1]} q={q} />, true],
  [/^\/privacy$/, () => <Privacy />],
  [/^\/settings$/, () => <MailSettings />, true],
  [/^\/notices$/, () => <Notices />],
  [/^\/notice\/([0-9a-f]{16})$/, ({m}) => <Notice id={m[1]} />],
];
const BARE = /^\/(login|signup|forgot|reset|q\/)/;     // 로그인·가입·찾기·QR 결과는 탭바 없이
// [주소, 글, 아이콘, 이 글자로 시작하는 주소도 켜짐]
const TABS = [['#/', '로비', IcHome], ['#/notices', '공지', IcDoc, '/notice'], ['#/items', '대여', IcBox],
  ...(SEMINAR ? [['#/reserve', '예약', IcCal]] : []), ['#/events', '행사', IcFlag, '/event']];
// 상세 화면은 머리줄 왼쪽에 로고 대신 뒤로가기
const backOf = path => {
  let m;
  if ((m = path.match(/^\/event\/(\w+)\/apply$/))) return [`#/event/${m[1]}`, '행사'];
  if (/^\/event\//.test(path)) return ['#/events', '행사'];
  if (/^\/notice\//.test(path)) return ['#/notices', '공지'];
  if (/^\/(privacy|settings)$/.test(path)) return ['#/', '로비'];
  return null;
};

function Footer() {
  return <footer className="foot">
    <span>© {new Date().getFullYear()} SWITCH · 반도체융합공학과 학생회</span>
    <a href="#/privacy">개인정보 처리방침</a>
  </footer>;
}

function Header({me, back}) {
  const ask = useAsk();
  const out = async e => { e.preventDefault(); if (await ask.confirm('로그아웃하시겠습니까?', {actionLabel: '로그아웃'})) location.hash = '#/logout'; };
  return <header>
    {back ? <a className="back" href={back[0]}><IcBack />{back[1]}</a>
      : <a className="mark" href="#/" aria-label="SWITCH 로비"><span className="logo" /></a>}
    <div className="who">
      {me ? <>
        <a href="#/settings" title="메일 알림 설정">{me.name}</a>
        <a href="#/logout" onClick={out}>로그아웃</a>
      </> : <a href="#/login" className="who-in">로그인</a>}
      <ThemeButton />
    </div>
  </header>;
}

function TabBar({path, me}) {
  const isAdmin = me && (me.role === 'admin' || me.role === 'super');
  const tabs = isAdmin ? [...TABS, ['admin', '관리', Settings, '\0']] : TABS;
  return <nav id="nav" aria-label="메뉴">{tabs.map(([h, t, Ic, pre]) => {
    const on = h.startsWith('#') && (path === h.slice(1) || (h !== '#/' && path.startsWith(pre || h.slice(1))));
    return <a key={h} href={h} className={on ? 'on' : undefined} aria-current={on ? 'page' : undefined}>
      {Ic === Settings ? <Settings className="i" strokeWidth={on ? 1.9 : 1.6} aria-hidden="true" /> : <Ic />}<span>{t}</span></a>;
  })}</nav>;
}

export default function App() {
  const [signupOpen, setSignupOpen] = useState(false);
  const [me, setMe] = useState(undefined);       // undefined = 아직 모름, null = 로그인 안 함
  const {path, q} = useHash('/');
  useEffect(() => { api.onAuth = () => { setMe(null); goLogin(); }; api('me').then(d => { setMe(d.user); setSignupOpen(!!d.signup_open); }, () => setMe(null)); }, []);
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
  return <MeCtx.Provider value={{me, setMe, signupOpen}}>
    {!bare && <Header me={me} back={backOf(path)} />}
    <main className={bare ? 'bare' : undefined} key={path}>{page}{!bare && <Footer />}</main>
    {!bare && <TabBar path={path} me={me} />}
  </MeCtx.Provider>;
}
