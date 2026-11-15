// 관리 사이트의 틀: 넓은 화면은 왼쪽 메뉴, 좁은 화면은 위쪽 머리줄 + 옆으로 미는 탭
import {useEffect, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {api} from '../lib/common.js';
import {useHash, ThemeButton} from '../ui/base.jsx';
import {Items, Loans, Reservations, Events, Apps, Notices, Users, Admins, ROLE} from './Pages.jsx';
import {NoticeWrite, EventWrite} from './Write.jsx';

const MENU = [['items', '물품'], ['loans', '대여 기록'], ['reservations', '예약 기록'], ['events', '행사'], ['apps', '신청자'], ['notices', '공지'], ['users', '회원'], ['admins', '관리자']];
const toLogin = () => { location.href = './#/login?next=' + encodeURIComponent('admin' + location.hash); };
const ROUTES = [
  [/^\/items$/, p => <Items {...p} />], [/^\/loans$/, p => <Loans {...p} />], [/^\/reservations$/, p => <Reservations {...p} />],
  [/^\/events$/, p => <Events {...p} />], [/^\/apps$/, p => <Apps {...p} />], [/^\/notices$/, p => <Notices {...p} />],
  [/^\/users$/, p => <Users {...p} />], [/^\/admins$/, p => <Admins {...p} />],
  [/^\/notice\/(new|\d+)$/, p => <NoticeWrite id={p.m[1]} />], [/^\/event\/(new|\d+)$/, p => <EventWrite id={p.m[1]} />],
];

export default function App() {
  const [me, setMe] = useState(undefined);
  const {path, q} = useHash('/items');
  useEffect(() => { api.onAuth = toLogin; api('me').then(d => { if (!d.user) toLogin(); else setMe(d.user); }, () => {}); }, []);
  useEffect(() => { if (path === '/' || path === '') location.replace('#/items'); else window.scrollTo(0, 0); }, [path]);
  if (!me) return null;
  if (me.role !== 'admin' && me.role !== 'super') return <div className="gate box enter"><h1 style={{marginBottom: 8}}>관리자만 쓸 수 있습니다</h1>
    <p className="muted">{me.name} 님의 계정은 관리자 권한이 없습니다.</p><Button label="학생 사이트로" variant="primary" href="./" /></div>;
  const cur = path.split('/')[1] || 'items', sec = {notice: 'notices', event: 'events'}[cur] || cur;
  let page = null;
  for (const [re, fn] of ROUTES) { const m = path.match(re); if (m) { page = fn({m, q, path, me}); break; } }
  if (!page) setTimeout(() => location.replace('#/items'));
  return <div className="shell">
    <aside className="side"><div className="brand"><b>SWITCH 관리</b><span>반도체융합공학과 학생회</span></div>
      <nav aria-label="관리 메뉴">{MENU.map(([k, t]) => <a key={k} href={'#/' + k} className={sec === k ? 'on' : ''} aria-current={sec === k ? 'page' : undefined}>{t}</a>)}</nav>
      <div className="foot"><span>{me.name} ({ROLE[me.role]})</span><a href="./">학생 사이트로</a><ThemeButton /></div></aside>
    <main className="page" key={path}>{page}</main>
  </div>;
}
