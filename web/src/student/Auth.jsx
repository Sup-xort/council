// 로그인 · 가입 · 계정 찾기 · 새 비밀번호 · QR 스캔 결과
import {useEffect, useState} from 'react';
import {Center, VStack, Card, Heading, Text, TextInput, Button, Link, EmptyState, Spinner} from '../ui/ax.js';
import {CheckCircle2, Undo2, Ban, AlertCircle, MailCheck} from 'lucide-react';
import {api, toast} from '../lib/common.js';
import {useMe, goNext} from './parts.jsx';

function Brand() {
  return <VStack gap={1} hAlign="center">
    <a className="brand-mark" href="#/">SWITCH</a>
    <Text type="supporting" color="secondary">반도체융합공학과 학생회</Text>
  </VStack>;
}
function Box({title, desc, children, foot}) {
  return <Center axis="both" padding={4} className="auth">
    <VStack gap={5} hAlign="stretch" className="auth-col enter">
      <Brand />
      <Card padding={6}><VStack gap={5} hAlign="stretch">
        <VStack gap={1}><Heading level={2}>{title}</Heading>{desc && <Text type="supporting" color="secondary">{desc}</Text>}</VStack>
        {children}
        {foot && <Text type="supporting" color="secondary" justify="center">{foot}</Text>}
      </VStack></Card>
      <Center><Link href="#/" color="secondary" type="supporting">로비로 돌아가기</Link></Center>
    </VStack>
  </Center>;
}
function useForm(init) {
  const [v, setV] = useState(init);
  const bind = k => ({value: v[k], onChange: x => setV(o => ({...o, [k]: x}))});
  return [v, bind];
}
function useSubmit(fn) {
  const [busy, setBusy] = useState(false);
  const onSubmit = async e => { e.preventDefault(); if (busy) return; setBusy(true); try { await fn(); } catch {} finally { setBusy(false); } };
  return [busy, onSubmit];
}
const Submit = ({label, busy}) => <Button type="submit" label={label} variant="primary" size="lg" width="100%" isLoading={busy} />;

export function Login({q}) {
  const {setMe} = useMe();
  const next = q.get('next') || '#/';
  const [v, bind] = useForm({username: '', password: ''});
  const [busy, onSubmit] = useSubmit(async () => { const d = await api('login', v); setMe(d.user); goNext(next); });
  return <Box title="로그인" foot={<>처음 이용하십니까? <Link href={'#/signup?next=' + encodeURIComponent(next)}>회원가입</Link> · <Link href="#/forgot">계정 찾기</Link></>}>
    <form onSubmit={onSubmit}><VStack gap={4} hAlign="stretch">
      <TextInput label="아이디" htmlName="username" autoComplete="username" autoCapitalize="off" size="lg" {...bind('username')} />
      <TextInput label="비밀번호" type="password" htmlName="password" autoComplete="current-password" size="lg" {...bind('password')} />
      <Submit label="로그인" busy={busy} />
    </VStack></form>
  </Box>;
}

export function Signup({q}) {
  const {setMe} = useMe();
  const next = q.get('next') || '#/';
  const [v, bind] = useForm({username: '', name: '', student_id: '', email: '', password: ''});
  const [busy, onSubmit] = useSubmit(async () => {
    if (v.username.trim().length < 3) return toast('아이디는 3자 이상이어야 합니다');
    if (v.password.length < 6) return toast('비밀번호는 6자 이상이어야 합니다');
    const d = await api('signup', v); setMe(d.user); goNext(next);
  });
  return <Box title="회원가입" foot={<Link href={'#/login?next=' + encodeURIComponent(next)}>이미 계정이 있습니다</Link>}>
    <form onSubmit={onSubmit}><VStack gap={4} hAlign="stretch">
      <TextInput label="아이디" description="영문과 숫자로 3자 이상" htmlName="username" autoComplete="username" autoCapitalize="off" size="lg" {...bind('username')} />
      <TextInput label="이름" htmlName="name" autoComplete="name" size="lg" {...bind('name')} />
      <TextInput label="학번" htmlName="student_id" inputMode="numeric" autoComplete="off" size="lg" {...bind('student_id')} />
      <TextInput label="이메일" type="email" htmlName="email" autoComplete="email" size="lg" {...bind('email')} />
      {/* 비밀번호는 맨 끝 — 중간에 두면 iOS 자동완성이 다음 칸(이름)에도 비밀번호를 채운다 */}
      <TextInput label="비밀번호" description="6자 이상" type="password" htmlName="password" autoComplete="new-password" size="lg" {...bind('password')} />
      <Submit label="가입하기" busy={busy} />
    </VStack></form>
  </Box>;
}

export function Forgot() {
  const [v, bind] = useForm({email: ''});
  const [sent, setSent] = useState(false);
  const [busy, onSubmit] = useSubmit(async () => { await api('forgot', v); setSent(true); });
  if (sent) return <Center axis="both" padding={4} className="auth"><Card padding={6} className="auth-col enter">
    <EmptyState icon={<MailCheck className="pop" size={40} />} title="메일을 보냈습니다" description="가입한 이메일이면 곧 도착합니다. 안 보이면 스팸함도 확인해 주십시오."
      actions={<Button label="로그인으로" variant="secondary" href="#/login" />} /></Card></Center>;
  return <Box title="아이디·비밀번호 찾기" desc="가입할 때 쓴 이메일로 아이디와 비밀번호를 바꿀 수 있는 링크를 보내 드립니다." foot={<Link href="#/login">로그인으로</Link>}>
    <form onSubmit={onSubmit}><VStack gap={4} hAlign="stretch">
      <TextInput label="이메일" type="email" htmlName="email" autoComplete="email" size="lg" {...bind('email')} />
      <Submit label="메일 보내기" busy={busy} />
    </VStack></form>
  </Box>;
}

export function Reset({token}) {
  const {setMe} = useMe();
  useEffect(() => { history.replaceState(null, '', '#/reset'); }, []);   // 링크 토큰을 주소창·방문기록에 남기지 않는다
  const [v, bind] = useForm({password: ''});
  const [busy, onSubmit] = useSubmit(async () => {
    if (v.password.length < 6) return toast('비밀번호는 6자 이상이어야 합니다');
    const d = await api('reset', {token, ...v}); setMe(d.user); toast('비밀번호를 바꿨습니다'); location.hash = '#/';
  });
  return <Box title="새 비밀번호">
    <form onSubmit={onSubmit}><VStack gap={4} hAlign="stretch">
      <TextInput label="새 비밀번호" description="6자 이상" type="password" htmlName="password" autoComplete="new-password" size="lg" {...bind('password')} />
      <Submit label="비밀번호 바꾸기" busy={busy} />
    </VStack></form>
  </Box>;
}

export function Logout() {
  const {setMe} = useMe();
  useEffect(() => { api('logout', {}).finally(() => { setMe(null); location.hash = '#/'; }); }, []);
  return null;
}

// QR 을 찍으면 들어오는 곳: 대여 · 반납 · 남이 쓰는 중
const SCAN = {
  borrowed: [CheckCircle2, '대여했습니다', '다 쓰고 같은 QR을 한 번 더 찍으면 반납됩니다.', 'ok'],
  returned: [Undo2, '반납이 완료됐습니다', '이용해 주셔서 감사합니다.', 'ok'],
  in_use: [Ban, '다른 사람이 쓰고 있습니다', '반납된 뒤에 다시 찍어 주십시오.', 'mute'],
};
const scanned = new Map();      // 같은 화면이 두 번 그려져도 한 번만 서버에 보낸다
export function Scan({code}) {
  const [res, setRes] = useState(null);
  useEffect(() => {
    history.replaceState(null, '', '#/');      // 새로고침하면 반납돼 버리니 주소에서 QR 코드를 지운다
    if (!scanned.has(code)) scanned.set(code, api('scan', {code}).then(d => ({d}), e => ({err: e.message})));
    scanned.get(code).then(setRes);
  }, [code]);
  if (!res) return <Center axis="both" padding={10}><Spinner label="잠시만 기다려 주십시오" /></Center>;
  const [Ic, title, desc, tone] = res.err ? [AlertCircle, res.err, '', 'mute'] : SCAN[res.d.result];
  return <Center axis="both" padding={6}><Card padding={8} className="auth-col enter">
    <EmptyState icon={<span className={'scan-ic pop ' + tone}><Ic size={36} strokeWidth={2} /></span>} title={title}
      description={[res.d?.item, desc].filter(Boolean).join(' · ')}
      actions={<Button label={res.err ? '로비로' : '대여 화면으로'} variant="primary" size="lg" href={res.err ? '#/' : '#/items'} />} />
  </Card></Center>;
}
