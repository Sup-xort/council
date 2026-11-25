// 여러 화면이 같이 쓰는 조각들 — 모두 Astryx 부품으로 짓는다.
import {createContext, useContext} from 'react';
import {Card, Badge, Heading, Text, HStack, VStack, Button, ProgressBar, List, ListItem, EmptyState, Skeleton} from '../ui/ax.js';
import {koDate, koWhen, dday} from '../lib/common.js';
import {ChevronRight} from 'lucide-react';

export const MeCtx = createContext({me: null, setMe: () => {}});
export const useMe = () => {
  const c = useContext(MeCtx);
  return {...c, isAdmin: !!c.me && (c.me.role === 'admin' || c.me.role === 'super')};
};
export function goLogin() { location.hash = '#/login?next=' + encodeURIComponent(location.hash || '#/'); }
// 로그인 뒤 돌아갈 곳: 관리 사이트(admin…)에서 왔으면 그쪽으로
export const goNext = next => { if (/^admin(#|$)/.test(next)) location.href = next; else location.hash = next; };

// 상태 표시: 모집 중 = 연두, 신청함 = 하늘, 나머지 = 회색
export const stTone = st => st === '모집 중' ? 'green' : st === '신청함' ? 'blue' : 'neutral';
export const State = ({st}) => <Badge variant={stTone(st)} label={st} />;
export function DDay({date, closed}) {
  const t = closed ? '' : dday(date);
  return t ? <Badge variant={t === 'D-DAY' ? 'error' : 'neutral'} label={t} /> : null;
}

// 신청 인원 막대. 정원이 없으면 숫자만
export function Gauge({g, big}) {
  if (!g || g.n == null) return null;
  const cap = g.capacity, n = g.n;
  const right = cap == null ? '인원 제한 없음' : big ? (cap - n > 0 ? `정원 ${cap}명 중 ${cap - n}자리 남음` : `정원 ${cap}명 마감`) : `정원 ${cap}명`;
  return <VStack gap={2}>
    <HStack hAlign="between" vAlign="end">
      <Text type={big ? 'display-3' : 'supporting'} weight="semibold">{n}명 <Text type="supporting" color="secondary">신청</Text></Text>
      <Text type="supporting" color="secondary">{right}</Text>
    </HStack>
    {cap != null && <ProgressBar label="신청 인원" isLabelHidden value={Math.min(n, cap)} max={cap} variant="accent" />}
  </VStack>;
}

// 행사 목록 (로비와 행사 화면이 같이 쓴다)
export function EventsList({list}) {
  const {me} = useMe();
  if (!list.length) return <Card><EmptyState isCompact title="아직 열린 행사가 없습니다" /></Card>;
  const open = list.filter(e => !e.closed), done = list.filter(e => e.closed);
  return <VStack gap={3} className="stagger">
    {open.map(e => {
      const g = e.gauge, st = e.applied ? '신청함' : g.full ? '정원 마감' : '모집 중';
      return <Card key={e.id} padding={5}><VStack gap={3}>
        <HStack gap={1} wrap="wrap"><DDay date={e.deadline} closed={e.closed} /><State st={st} />{!dday(e.deadline) && <Badge variant="neutral" label={`${koDate(e.deadline)} 마감`} />}
          {e.dues_only && <Badge variant="neutral" label="납부자만" />}</HStack>
        <VStack gap={1}><Heading level={3}>{e.title}</Heading>
          {e.starts_at && <Text type="supporting" color="secondary">{koWhen(e.starts_at)}</Text>}</VStack>
        <Gauge g={g} />
        <HStack gap={2} vAlign="center">
          {e.applied ? <Button label="수정" variant="secondary" href={`#/event/${e.id}?apply=1`} />
            : g.full ? null
              : e.dues_only && me && !me.dues ? <Text type="supporting" color="secondary">학생회비 납부자만 신청할 수 있습니다</Text>
                : <Button label="신청" variant="primary" href={`#/event/${e.id}?apply=1`} />}
          <Button label="자세히" variant="ghost" href={`#/event/${e.id}`} />
        </HStack>
      </VStack></Card>;
    })}
    {done.length > 0 && <Card padding={2}><List hasDividers>{done.map(e =>
      <ListItem key={e.id} label={e.title} description="마감됨" endContent={<ChevronRight size={16} />} onClick={() => { location.hash = `#/event/${e.id}`; }} />)}</List></Card>}
  </VStack>;
}

// 본문 서식 글 (md() 가 먼저 전부 이스케이프하고 우리가 만든 태그만 넣는다)
export const Md = ({html}) => <div className="md" dangerouslySetInnerHTML={{__html: html}} />;

// 불러오는 동안 자리 잡기
export const Loading = ({rows = [120, 240]}) => <VStack gap={3}>{rows.map((h, i) => <Skeleton key={i} height={h} index={i} />)}</VStack>;

// 페이지 머리: 위에 작은 줄, 제목, 그 아래 설명
export function PageHead({back, meta, title, desc, end}) {
  return <VStack gap={2}>
    {back && <div><Button label={back[1]} variant="ghost" size="sm" href={back[0]} icon={<span aria-hidden="true">‹</span>} /></div>}
    {meta && <HStack gap={1} wrap="wrap" vAlign="center">{meta}</HStack>}
    <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap"><Heading level={1}>{title}</Heading>{end}</HStack>
    {desc && <Text color="secondary">{desc}</Text>}
  </VStack>;
}

export const SEMINAR = false;   // 세미나실 기능을 숨기는 스위치. true 로 바꾸면 다시 나타난다

// 공지 아래 바로가기 버튼이 가는 곳
const TABLINK = {home: '#/', notices: '#/notices', events: '#/events', reserve: '#/reserve', loans: '#/items'};
export const chipHref = c => c.type === 'tab' ? (TABLINK[c.target] || '#/') : c.type === 'event' ? `#/event/${c.target}?apply=1`
  : c.type === 'notice' ? `#/notice/${c.target}` : c.target;
