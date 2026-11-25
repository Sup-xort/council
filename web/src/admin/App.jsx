// 관리 사이트의 틀: 넓으면 왼쪽 메뉴, 좁으면 위 머리줄 + 가로로 넘기는 메뉴 탭.
import {useEffect, useState} from 'react';
import {Package, History, CalendarClock, PartyPopper, ClipboardList, Megaphone, Users as UsersIc, ShieldCheck, ArrowLeft} from 'lucide-react';
import {api} from '../lib/common.js';
import {useHash, ThemeButton} from '../ui/base.jsx';
import {Btn, Empty} from '../ui/kit.jsx';
import {Items, Loans, Reservations, Events, Apps, Notices, Users, Admins, ROLE} from './Pages.jsx';
import {NoticeWrite, EventWrite} from './Write.jsx';

const MENU = [['items', '물품', Package], ['loans', '대여 기록', History], ['reservations', '예약 기록', CalendarClock], ['events', '행사', PartyPopper],
  ['apps', '신청자', ClipboardList], ['notices', '공지', Megaphone], ['users', '회원', UsersIc], ['admins', '관리자', ShieldCheck]];
const toLogin = () => { location.href = './#/login?next=' + encodeURIComponent('admin' + location.hash); };
const ROUTES = [
  [/^\/items$/, p => <Items {...p} />], [/^\/loans$/, p => <Loans {...p} />], [/^\/reservations$/, p => <Reservations {...p} />],
  [/^\/events$/, p => <Events {...p} />], [/^\/apps$/, p => <Apps {...p} />], [/^\/notices$/, p => <Notices {...p} />],
  [/^\/users$/, p => <Users {...p} />], [/^\/admins$/, p => <Admins {...p} />],
  [/^\/notice\/(new|[0-9a-f]{16})$/, p => <NoticeWrite id={p.m[1]} />], [/^\/event\/(new|[0-9a-f]{16})$/, p => <EventWrite id={p.m[1]} />],
];

export default function App() {
  const [me, setMe] = useState(undefined);
  const {path, q} = useHash('/items');
  useEffect(() => { api.onAuth = toLogin; api('me').then(d => { if (!d.user) toLogin(); else setMe(d.user); }, () => {}); }, []);
  useEffect(() => { if (path === '/' || path === '') location.replace('#/items'); else window.scrollTo(0, 0); }, [path]);
  if (!me) return null;
  if (me.role !== 'admin' && me.role !== 'super') return <main><div className="authbox"><div className="card">
    <Empty icon={<ShieldCheck />} title="관리자만 쓸 수 있습니다" desc={`${me.name} 님의 계정은 관리자 권한이 없습니다.`}
      action={<Btn href="./">학생 사이트로</Btn>} /></div></div></main>;
  const cur = path.split('/')[1] || 'items', sec = {notice: 'notices', event: 'events'}[cur] || cur;
  let page = null;
  for (const [re, fn] of ROUTES) { const m = path.match(re); if (m) { page = fn({m, q, path, me}); break; } }
  if (!page) setTimeout(() => location.replace('#/items'));
  return <div className="adm">
    <aside className="side" aria-label="관리 메뉴">
      <a className="side-h" href="#/items"><span className="logo" aria-hidden="true" /><span><b>SWITCH 관리</b><small>반도체융합공학과 학생회</small></span></a>
      <nav className="side-m">{MENU.map(([k, t, Ic]) => <a key={k} href={'#/' + k} className={sec === k ? 'on' : undefined} aria-current={sec === k ? 'page' : undefined}>
        <Ic className="i" strokeWidth={sec === k ? 1.9 : 1.6} aria-hidden="true" /><span>{t}</span></a>)}</nav>
      <div className="side-f">
        <a href="./" className="side-back"><ArrowLeft className="i" aria-hidden="true" />학생 사이트로</a>
        <div className="row"><span className="grow muted nowrap">{me.name} ({ROLE[me.role]})</span><ThemeButton /></div>
      </div>
    </aside>
    <main className="adm-main" key={path}>{page}</main>
  </div>;
}
