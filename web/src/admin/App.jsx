// 관리 사이트의 틀: Astryx 앱 틀 + 왼쪽 메뉴. 폰에서는 메뉴가 서랍으로 들어간다.
import {useEffect, useState} from 'react';
import {AppShell, SideNav, SideNavHeading, SideNavItem, SideNavSection, NavIcon, Card, EmptyState, Button, Center, HStack, Text} from '../ui/ax.js';
import {Package, History, CalendarClock, PartyPopper, ClipboardList, Megaphone, Users as UsersIc, ShieldCheck, ArrowLeft} from 'lucide-react';
import {api} from '../lib/common.js';
import {useHash, ThemeButton} from '../ui/base.jsx';
import {useNarrow} from '../ui/narrow.js';
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
  const narrow = useNarrow();
  useEffect(() => { api.onAuth = toLogin; api('me').then(d => { if (!d.user) toLogin(); else setMe(d.user); }, () => {}); }, []);
  useEffect(() => { if (path === '/' || path === '') location.replace('#/items'); else window.scrollTo(0, 0); }, [path]);
  if (!me) return null;
  if (me.role !== 'admin' && me.role !== 'super') return <Center axis="both" padding={6} className="gate"><Card padding={6}>
    <EmptyState icon={<ShieldCheck size={36} />} title="관리자만 쓸 수 있습니다" description={`${me.name} 님의 계정은 관리자 권한이 없습니다.`}
      actions={<Button label="학생 사이트로" variant="primary" href="./" />} /></Card></Center>;
  const cur = path.split('/')[1] || 'items', sec = {notice: 'notices', event: 'events'}[cur] || cur;
  let page = null;
  for (const [re, fn] of ROUTES) { const m = path.match(re); if (m) { page = fn({m, q, path, me}); break; } }
  if (!page) setTimeout(() => location.replace('#/items'));
  const nav = <SideNav aria-label="관리 메뉴"
    header={<SideNavHeading heading="SWITCH 관리" subheading="반도체융합공학과 학생회" headingHref="#/items"
      icon={<NavIcon icon={<span className="logo-mark" aria-hidden="true" />} />} />}
    footer={<SideNavSection title="계정" isHeaderHidden>
      <SideNavItem label="학생 사이트로" icon={ArrowLeft} href="./" />
      <HStack gap={2} vAlign="center" hAlign="between" className="nav-foot"><Text type="supporting" color="secondary" maxLines={1}>{me.name} ({ROLE[me.role]})</Text><ThemeButton /></HStack>
    </SideNavSection>}>
    <SideNavSection title="메뉴" isHeaderHidden>
      {MENU.map(([k, t, Ic]) => <SideNavItem key={k} label={t} icon={Ic} href={'#/' + k} isSelected={sec === k} />)}
    </SideNavSection>
  </SideNav>;
  return <AppShell height="auto" contentPadding={narrow ? 4 : 6} sideNav={nav}><div className="page" key={path}>{page}</div></AppShell>;
}
