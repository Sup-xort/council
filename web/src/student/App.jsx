// 학생 사이트의 틀: Astryx 앱 틀 + 위쪽 메뉴. 폰에서는 메뉴가 서랍으로 들어간다.
import {useEffect, useState} from 'react';
import {AppShell, TopNav, TopNavHeading, TopNavItem, NavIcon, Button, IconButton, HStack, Text} from '../ui/ax.js';
import {Home, Megaphone, Umbrella, CalendarClock, PartyPopper, Settings2, LogOut} from 'lucide-react';
import {api} from '../lib/common.js';
import {useHash, ThemeButton} from '../ui/base.jsx';
import {useNarrow} from '../ui/narrow.js';
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
const BARE = /^\/(login|signup|forgot|reset)/;     // 로그인·가입·찾기 화면은 메뉴 없이
const TABS = [['#/', '로비', Home], ['#/notices', '공지', Megaphone, '/notice'], ['#/items', '대여', Umbrella], ['#/reserve', '예약', CalendarClock], ['#/events', '행사', PartyPopper, '/event']];


function Nav({path, me}) {
  const isAdmin = me && (me.role === 'admin' || me.role === 'super');
  const small = useNarrow();
  return <TopNav label="메뉴"
    heading={<TopNavHeading heading="SWITCH" subheading={small ? undefined : '반도체융합공학과 학생회'} headingHref="#/"
      logo={<NavIcon icon={<span className="logo-dots" aria-hidden="true"><i /><i /></span>} />} logoLabel="로비로" />}
    centerContent={small ? undefined : <>{TABS.map(([h, t, Ic, pre]) => {
      const on = path === h.slice(1) || (h !== '#/' && path.startsWith(pre || h.slice(1)));
      return <TopNavItem key={h} label={t} href={h} isSelected={on} icon={<Ic size={16} />} />;
    })}</>}
    endContent={<HStack gap={2} vAlign="center">
      {me ? (small ? <>
        {isAdmin && <IconButton label="관리 사이트" tooltip="관리 사이트" variant="ghost" href="admin" icon={<Settings2 size={18} />} />}
        <IconButton label={`${me.name} 로그아웃`} tooltip="로그아웃" variant="ghost" href="#/logout" icon={<LogOut size={18} />} />
      </> : <>
        {isAdmin && <Button label="관리 사이트" variant="ghost" href="admin" icon={<Settings2 size={16} />} />}
        <Text type="supporting" color="secondary">{me.name}</Text>
        <Button label="로그아웃" variant="ghost" href="#/logout" />
      </>) : <Button label="로그인" variant="primary" href="#/login" />}
      <ThemeButton />
    </HStack>} />;
}

export default function App() {
  const [me, setMe] = useState(undefined);       // undefined = 아직 모름, null = 로그인 안 함
  const {path, q} = useHash('/');
  const narrow = useNarrow();
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
  const body = <div className="page" key={path}>{page}</div>;
  const tabs = narrow && me && !BARE.test(path) && <nav className="tabbar" aria-label="메뉴">{TABS.map(([h, t, Ic, pre]) => {
    const on = path === h.slice(1) || (h !== '#/' && path.startsWith(pre || h.slice(1)));
    return <a key={h} href={h} aria-current={on ? 'page' : undefined} className={on ? 'on' : ''} aria-label={t}><Ic size={24} strokeWidth={on ? 2.4 : 1.8} />{on && <span>{t}</span>}</a>;
  })}</nav>;
  return <MeCtx.Provider value={{me, setMe}}>
    {BARE.test(path) ? body : <AppShell variant="wash" height="auto" mobileNav={false} contentPadding={narrow ? 4 : 5} topNav={<Nav path={path} me={me} />}>{tabs}{body}</AppShell>}
  </MeCtx.Provider>;
}
