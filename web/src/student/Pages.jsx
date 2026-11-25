// 대여 · 행사 · 공지
import {useEffect, useState} from 'react';
import {Card, ClickableCard, Badge, Heading, Text, HStack, VStack, Grid, Button, Banner, EmptyState, MetadataList, MetadataListItem,
  TextInput, TextArea, Selector, CheckboxInput, RadioList, RadioListItem, CheckboxList, CheckboxListItem,
  SegmentedControl, SegmentedControlItem, List, ListItem, Link, Switch} from '../ui/ax.js';
import {Check, ChevronRight, ChevronLeft, ExternalLink} from 'lucide-react';
import {api, md, koDate, koWhen, koStamp, koSpan, toDate, toast} from '../lib/common.js';
import {useLoad, useAsk} from '../ui/base.jsx';
import {useMe, State, DDay, Gauge, EventsList, Md, Loading, PageHead, chipHref} from './parts.jsx';

// ── 대여 ──────────────────────────────────────────────────────────────
const byKind = items => { const m = new Map(); items.forEach(i => { const k = i.kind || i.name; (m.get(k) || m.set(k, []).get(k)).push(i); }); return [...m]; };
function LoanHistory() {
  const {data} = useLoad(() => api('mypage'), []);
  const list = data ? data.loans : [];
  if (!list.length) return null;
  return <VStack gap={2}>
    <Heading level={3}>내 대여 기록</Heading>
    <Card padding={2}><List hasDividers>{list.map((r, i) =>
      <ListItem key={i} label={r.kind && r.num ? `${r.kind} ${r.num}번` : r.name}
        description={`${koStamp(r.out_at)} 대여${r.in_at ? ` · ${koStamp(r.in_at)} 반납` : ''}`}
        endContent={<Badge variant={r.in_at ? 'neutral' : 'blue'} label={r.in_at ? '반납함' : '대여 중'} />} />)}</List></Card>
  </VStack>;
}
export function Items() {
  const {data} = useLoad(() => api('items'), []);
  if (!data) return <Loading rows={[80, 120, 120]} />;
  const mine = data.items.filter(i => i.mine), kinds = byKind(data.items);
  return <VStack gap={5} className="enter">
    <PageHead title="물품 대여" desc="물품에 붙은 QR을 휴대폰 기본 카메라로 찍으면 대여하고, 한 번 더 찍으면 반납됩니다." />
    {mine.length > 0 && <Card variant="blue" padding={4}><VStack gap={2}>
      <HStack gap={2} vAlign="center"><Heading level={3}>내가 대여한 물품</Heading><Badge variant="neutral" label={`${mine.length}개`} /></HStack>
      <List hasDividers>{mine.map(i => {
        const late = i.due && toDate(i.due) < new Date();
        return <ListItem key={i.id} label={i.name}
          description={i.due ? `${koStamp(i.due)}까지 반납해 주십시오${late ? ' (기한이 지났습니다)' : ''}` : `${koStamp(i.borrowed_at)}에 대여`}
          endContent={<Badge variant={late ? 'error' : 'neutral'} label={`${koSpan(i.borrowed_at)}째`} />} />;
      })}</List></VStack></Card>}
    <HStack gap={4} wrap="wrap" className="legend"><span><i style={{background: 'var(--ok-soft)'}} />대여 가능</span><span><i style={{background: 'var(--busy)'}} />대여 중</span><span><i style={{background: 'var(--mine)'}} />내가 대여 중</span></HStack>
    {kinds.length ? <Grid columns={{minWidth: 280, repeat: 'fill'}} gap={3} className="stagger">{kinds.map(([k, its]) => {
      const left = its.filter(i => i.available).length;
      return <Card key={k} padding={4}><VStack gap={3}>
        <HStack gap={2} vAlign="center"><Heading level={3} className="grow">{k}</Heading>
          {left ? <Badge variant="green" label={`${left}개 남음`} /> : <Badge variant="neutral" label="모두 사용 중" />}<Badge variant="neutral" label={`전체 ${its.length}개`} /></HStack>
        <div className="strip">{its.map(i => {
          const st = i.mine ? '내가 대여 중' : i.available ? '대여 가능' : '대여 중';
          return <span key={i.id} className={i.mine ? 'mine' : i.available ? '' : 'use'} title={`${i.name} ${st}`} aria-label={`${i.name} ${st}`}>{i.num ?? '1개'}</span>;
        })}</div>
      </VStack></Card>;
    })}</Grid> : <Card><EmptyState title="아직 대여할 수 있는 물품이 없습니다" /></Card>}
    <LoanHistory />
  </VStack>;
}

// ── 행사 ──────────────────────────────────────────────────────────────
export function Events() {
  const {data} = useLoad(() => api('events'), []);
  return <div className="narrow"><VStack gap={5}><PageHead title="행사" />
    {data ? <EventsList list={data.events} /> : <Loading rows={[180, 180]} />}</VStack></div>;
}

function Field({f, value, onChange, disabled}) {
  const common = {label: f.label, isRequired: !!f.required, isDisabled: disabled};
  if (f.type === 'select') return <RadioList {...common} value={value} onChange={onChange}>
    {f.options.map(o => <RadioListItem key={o} value={o} label={o} />)}</RadioList>;
  if (f.type === 'multi') return <CheckboxList {...common} description="여러 개 고를 수 있습니다" value={value} onChange={onChange}>
    {f.options.map(o => <CheckboxListItem key={o} value={o} label={o} />)}</CheckboxList>;
  if (f.type === 'checkbox') return <CheckboxInput label={f.label} isRequired={!!f.required} value={!!value} onChange={onChange} isDisabled={disabled} />;
  if (f.type === 'dropdown') return <Selector {...common} options={f.options} value={value || undefined} placeholder="선택" onChange={onChange} size="lg" />;
  if (f.type === 'long') return <TextArea {...common} value={value} onChange={onChange} rows={4} maxLength={2000} />;
  return <TextInput {...common} value={value} onChange={onChange} size="lg" />;
}

function lockOf(data, me) {
  const e = data.event, g = data.gauge, app = data.application;
  const duesLock = e.dues_only && !me.dues && !app;      // 학생회비를 낸 학생만 받는 행사
  const locked = e.closed || (g.full && !app) || duesLock;
  const banner = locked && <Banner status={duesLock ? 'warning' : 'info'} title={e.closed ? '신청이 마감됐습니다' : duesLock ? '학생회비 납부자만 신청할 수 있습니다' : '정원이 찼습니다'}
    description={e.closed ? (app ? '신청한 내용은 신청서에서 볼 수 있습니다.' : undefined) : duesLock ? '납부했는데 이 글이 보이면 학생회에 알려 주십시오.' : '더 이상 신청할 수 없습니다.'} />;
  return {locked, banner};
}

export function Event({id, q}) {
  const {me, isAdmin} = useMe();
  const {data} = useLoad(() => api('event?id=' + id), [id]);
  const lk = data && lockOf(data, me);
  useEffect(() => { if (lk && q.get('apply') && !lk.locked) location.replace(`#/event/${id}/apply`); }, [!!data]);
  if (!data) return <div className="narrow"><Loading rows={[100, 120, 300]} /></div>;
  const e = data.event, g = data.gauge, app = data.application;
  const state = e.closed ? '마감' : app ? '신청함' : g.full ? '정원 마감' : '모집 중';
  const goApply = `#/event/${e.id}/apply`;
  return <div className="narrow enter"><VStack gap={4}>
    <PageHead back={['#/events', '행사 목록']} title={e.title}
      meta={<><State st={state} /><DDay date={e.deadline} closed={e.closed} /><Text type="supporting" color="secondary">{koDate(e.deadline)} 마감</Text></>}
      end={isAdmin && <Button label="관리 사이트에서 수정" variant="secondary" size="sm" href={`admin#/event/${e.id}`} />} />
    <Card padding={5}>{g.n == null ? <Heading level={3}>{g.full ? '정원이 찼습니다' : '신청 받는 중'}</Heading> : <Gauge g={g} big />}</Card>
    <Card padding={5}><MetadataList columns="single">
      {e.starts_at && <MetadataListItem label="일시">{koWhen(e.starts_at)}</MetadataListItem>}
      <MetadataListItem label="신청 마감">{koWhen(e.deadline)}</MetadataListItem>
      {e.dues_only && <MetadataListItem label="신청 대상">학생회비 납부자</MetadataListItem>}
    </MetadataList></Card>
    {(e.body.trim() || data.notice_id) && <Card padding={5}><VStack gap={3}><Md html={md(e.body)} />
      {data.notice_id && <div><Button label="공지 전체 보기" variant="ghost" size="sm" href={`#/notice/${data.notice_id}`} endContent={<ChevronRight size={14} />} /></div>}</VStack></Card>}
    <Card padding={5}><VStack gap={4}>
      {app && <Banner status="success" title="신청돼 있습니다" description={e.closed ? '신청이 마감됐습니다.' : '마감 전까지 수정하거나 취소할 수 있습니다.'} />}
      {lk.banner}
      {app ? <Button variant={lk.locked ? 'secondary' : 'primary'} size="lg" width="100%" href={goApply} label={lk.locked ? '신청 내용 보기' : '신청 내용 수정·취소'} />
        : !lk.locked && <Button variant="primary" size="lg" width="100%" href={goApply} label="신청서 쓰기" />}
    </VStack></Card>
  </VStack></div>;
}

export function EventApply({id}) {
  const {me} = useMe();
  const ask = useAsk();
  const {data} = useLoad(() => api('event?id=' + id), [id]);
  const [vals, setVals] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) return;
    const app = data.application, v = {};
    data.event.fields.forEach((f, i) => { const x = app?.answers?.[i]; v[i] = f.type === 'checkbox' ? !!x : f.type === 'multi' ? (Array.isArray(x) ? [...x] : []) : (x ?? ''); });
    setVals(v);
  }, [data]);
  if (!data || !vals) return <div className="narrow"><Loading rows={[100, 120, 300]} /></div>;

  const e = data.event, app = data.application, {locked, banner} = lockOf(data, me);
  const back = `#/event/${e.id}`;
  const ok = e.fields.every((f, i) => !f.required || (f.type === 'checkbox' ? vals[i] : f.type === 'multi' ? vals[i].length : String(vals[i]).trim()));
  const cancel = async () => {
    if (!await ask.confirm('신청을 취소하시겠습니까?', {actionLabel: '신청 취소', danger: true})) return;
    setBusy(true);
    try { await api('apply_cancel', {event_id: e.id}); toast('신청을 취소했습니다'); location.hash = back; } catch {} finally { setBusy(false); }
  };
  const submit = async ev => {
    ev.preventDefault(); if (!ok || locked) return;
    setBusy(true);
    try { await api('apply', {event_id: e.id, answers: vals}); toast(app ? '수정했습니다' : '신청했습니다'); location.hash = back; } catch {} finally { setBusy(false); }
  };
  return <div className="narrow enter apply"><form onSubmit={submit}><VStack gap={3}>
    <PageHead back={[back, e.title]} title="신청서" desc={e.title} />
    <Card padding={5}><VStack gap={3}>
      <MetadataList columns="single"><MetadataListItem label="신청자">{me.name} · {me.student_id}</MetadataListItem></MetadataList>
      <Text type="supporting" color="secondary">이름·학번·이메일은 계정에서 자동으로 들어갑니다.</Text>
    </VStack></Card>
    {e.fields.map((f, i) => {
      const x = vals[i], done = f.type === 'checkbox' ? !!x : f.type === 'multi' ? x.length > 0 : !!String(x).trim();
      return <Card key={f.id ?? i} padding={5} className={done ? 'q done' : 'q'}><VStack gap={3}>
        <HStack gap={2} vAlign="center"><span className="qn">{done ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
          <Text type="supporting" color="secondary">질문 {i + 1} / {e.fields.length} · {f.required ? '필수' : '선택'}</Text></HStack>
        <Field f={f} value={x} disabled={locked} onChange={v => setVals(o => ({...o, [i]: v}))} />
      </VStack></Card>;
    })}
    <Card padding={5}><VStack gap={4}>
      {app && !locked && <Banner status="success" title="신청돼 있습니다" description="마감 전까지 수정하거나 취소할 수 있습니다." />}
      {banner}
      {!locked && <Button type="submit" variant="primary" size="lg" width="100%" isDisabled={!ok} isLoading={busy}
        label={ok ? (app ? '신청 내용 수정' : '참여 신청') : '필수 질문에 답해 주십시오'} />}
      {app && !locked && <Button label="신청 취소" variant="secondary" size="lg" width="100%" isDisabled={busy} onClick={cancel} />}
      {locked && <Button label="행사로 돌아가기" variant="secondary" size="lg" width="100%" href={back} />}
    </VStack></Card>
  </VStack></form></div>;
}

// ── 공지 ──────────────────────────────────────────────────────────────
const KIND = {dept: '학과 공지', event: '행사 공지'};
let noticeKind = '';
export function Notices() {
  const {me, isAdmin} = useMe();
  const [kind, setKind] = useState(noticeKind);
  noticeKind = kind;
  const {data} = useLoad(() => api('notices' + (kind ? '?kind=' + kind : '')), [kind]);
  const tabs = [['', '전체'], ['event', '행사 공지']].concat(me ? [['dept', '학과 공지']] : []);
  return <div className="narrow"><VStack gap={4}>
    <PageHead title="공지" end={isAdmin && <Button label="글쓰기" variant="primary" href="admin#/notice/new" />} />
    <SegmentedControl label="공지 종류" value={kind || 'all'} onChange={v => setKind(v === 'all' ? '' : v)} layout="fill">
      {tabs.map(([k, n]) => <SegmentedControlItem key={k || 'all'} value={k || 'all'} label={n} />)}
    </SegmentedControl>
    {data ? (data.notices.length ? <VStack gap={2} className="stagger" key={kind}>{data.notices.map(n =>
      <ClickableCard key={n.id} label={n.title} padding={4} onClick={() => { location.hash = `#/notice/${n.id}`; }}><VStack gap={2}>
        <HStack gap={1}><Badge variant={n.kind === 'event' ? 'green' : 'blue'} label={KIND[n.kind]} /><Badge variant="neutral" label={koDate(n.created_at)} /></HStack>
        <Heading level={3}>{n.title}</Heading>
        {n.summary && <Text type="supporting" color="secondary">{n.summary}</Text>}
      </VStack></ClickableCard>)}</VStack>
      : <Card><EmptyState title="아직 올라온 공지가 없습니다" /></Card>) : <Loading rows={[96, 96, 96]} />}
    {!me && <Text type="supporting" color="secondary">학과 공지는 로그인하면 볼 수 있습니다. <Link href="#/login?next=%23%2Fnotices">로그인</Link></Text>}
  </VStack></div>;
}
function LinkedEvent({g}) {
  const st = g.closed ? '마감' : g.full ? '정원 마감' : '모집 중';
  return <Card padding={5}><VStack gap={3}>
    <HStack gap={1} wrap="wrap"><Badge variant="neutral" label="연결된 행사" /><DDay date={g.deadline} closed={g.closed} /><State st={st} /><Badge variant="neutral" label={`${koDate(g.deadline)} 마감`} /></HStack>
    <Heading level={3}>{g.title}</Heading>
    <Gauge g={g} />
    <Button variant="primary" size="lg" width="100%" href={`#/event/${g.id}${g.closed ? '' : '?apply=1'}`} label={g.closed ? '행사 보기' : '신청하러 가기'} />
  </VStack></Card>;
}
export function Notice({id}) {
  const {isAdmin} = useMe();
  const {data} = useLoad(() => api('notice?id=' + id), [id]);
  if (!data) return <div className="narrow"><Loading rows={[100, 400]} /></div>;
  const n = data.notice;
  return <div className="narrow enter"><VStack gap={4}>
    <PageHead back={['#/notices', '공지 목록']} title={n.title}
      meta={<><Badge variant={n.kind === 'event' ? 'green' : 'blue'} label={KIND[n.kind]} /><Text type="supporting" color="secondary">{koDate(n.created_at)}{n.author ? ` · ${n.author}` : ''}</Text></>}
      end={isAdmin && <Button label="수정" variant="secondary" size="sm" href={`admin#/notice/${n.id}`} />} />
    <Card padding={6} className="reading"><VStack gap={5}>
      <Md html={md(n.body)} />
      {n.chips?.length > 0 && <HStack gap={2} wrap="wrap">{n.chips.map((c, i) => c.type === 'url'
        ? <Button key={i} label={c.label} variant="secondary" href={c.target} target="_blank" rel="noopener noreferrer" endContent={<ExternalLink size={14} />} />
        : <Button key={i} label={c.label} variant="secondary" href={chipHref(c)} endContent={<ChevronRight size={14} />} />)}</HStack>}
    </VStack></Card>
    {n.event && <LinkedEvent g={n.event} />}
    {(data.prev || data.next) && <Card padding={2}><List hasDividers>
      {data.prev && <ListItem label={data.prev.title} description="이전 글" startContent={<ChevronLeft size={16} />} onClick={() => { location.hash = `#/notice/${data.prev.id}`; }} />}
      {data.next && <ListItem label={data.next.title} description="다음 글" startContent={<ChevronRight size={16} />} onClick={() => { location.hash = `#/notice/${data.next.id}`; }} />}
    </List></Card>}
  </VStack></div>;
}

export function MailSettings() {
  const {me, setMe} = useMe();
  const [busy, setBusy] = useState('');
  const set = async (k, v) => {
    setBusy(k);
    try { const d = await api('mail_prefs', {[k]: v}); setMe(d.user); toast(v ? '메일을 받도록 바꿨어요' : '메일을 받지 않도록 바꿨어요'); }
    catch {} finally { setBusy(''); }
  };
  return <Card padding={5}><VStack gap={4} hAlign="stretch">
    <Text type="supporting" color="secondary">새 공지가 올라오면 가입한 이메일로 알려 드려요.</Text>
    <Switch label="학과 공지 메일" description={`${me.email} 로 받아요`} value={me.mail_dept} isDisabled={busy === 'mail_dept'} onChange={v => set('mail_dept', v)} />
    <Switch label="행사 공지 메일" description="새 행사 공지가 올라올 때만 받아요" value={me.mail_event} isDisabled={busy === 'mail_event'} onChange={v => set('mail_event', v)} />
  </VStack></Card>;
}
