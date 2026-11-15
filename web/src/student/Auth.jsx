// 로그인 · 가입 · 계정 찾기 · 새 비밀번호 · QR 스캔 결과
import {useEffect, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {api, toast} from '../lib/common.js';
import {useMe, goNext, Ic} from './parts.jsx';

function Brand() {
  return <div className="brand"><a className="mark" href="#/">SWITCH</a><span className="muted">반도체융합공학과 학생회</span></div>;
}
function Box({title, children, foot}) {
  return <div className="authbox enter"><Brand />
    <div className="card">{title && <h2>{title}</h2>}{children}</div>
    {foot}
    <p style={{textAlign: 'center', margin: '8px 0 0'}}><a className="home" href="#/">로비로 돌아가기</a></p>
  </div>;
}
// 입력칸 여럿을 한 번에 다루는 작은 도우미
function useForm(init) {
  const [v, setV] = useState(init);
  const bind = k => ({value: v[k], onChange: x => setV(o => ({...o, [k]: x}))});
  return [v, bind];
}
function Submit({label, busy}) {
  return <Button className="wide" type="submit" label={label} variant="primary" size="lg" width="100%" isLoading={busy} />;
}
function useSubmit(fn) {
  const [busy, setBusy] = useState(false);
  const onSubmit = async e => { e.preventDefault(); if (busy) return; setBusy(true); try { await fn(); } catch {} finally { setBusy(false); } };
  return [busy, onSubmit];
}

export function Login({q}) {
  const {setMe} = useMe();
  const next = q.get('next') || '#/';
  const [v, bind] = useForm({username: '', password: ''});
  const [busy, onSubmit] = useSubmit(async () => { const d = await api('login', v); setMe(d.user); goNext(next); });
  return <Box title="로그인">
    <form className="fl" onSubmit={onSubmit}>
      <TextInput label="아이디" htmlName="username" autoComplete="username" autoCapitalize="off" isRequired size="lg" {...bind('username')} />
      <TextInput label="비밀번호" type="password" htmlName="password" autoComplete="current-password" isRequired size="lg" {...bind('password')} />
      <Submit label="로그인" busy={busy} />
    </form>
    <p className="muted" style={{textAlign: 'center'}}>처음 이용하십니까? <a href={'#/signup?next=' + encodeURIComponent(next)}>회원가입</a>&nbsp;&nbsp;&nbsp;<a href="#/forgot">계정 찾기</a></p>
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
  return <Box title="회원가입">
    <form className="fl" onSubmit={onSubmit}>
      <TextInput label="아이디 (영문·숫자)" htmlName="username" autoComplete="username" autoCapitalize="off" isRequired size="lg" {...bind('username')} />
      <TextInput label="이름" htmlName="name" autoComplete="name" isRequired size="lg" {...bind('name')} />
      <TextInput label="학번" htmlName="student_id" inputMode="numeric" autoComplete="off" isRequired size="lg" {...bind('student_id')} />
      <TextInput label="이메일" type="email" htmlName="email" autoComplete="email" isRequired size="lg" {...bind('email')} />
      {/* 비밀번호는 맨 끝 — 중간에 두면 iOS 자동완성이 다음 칸(이름)에도 비밀번호를 채운다 */}
      <TextInput label="비밀번호 (6자 이상)" type="password" htmlName="password" autoComplete="new-password" isRequired size="lg" {...bind('password')} />
      <Submit label="가입하기" busy={busy} />
    </form>
    <p className="muted" style={{textAlign: 'center'}}><a href={'#/login?next=' + encodeURIComponent(next)}>이미 계정이 있습니다</a></p>
  </Box>;
}

export function Forgot() {
  const [v, bind] = useForm({email: ''});
  const [sent, setSent] = useState(false);
  const [busy, onSubmit] = useSubmit(async () => { await api('forgot', v); setSent(true); });
  if (sent) return <div className="authbox enter"><Brand /><div className="card result">
    <div className="big pop"><Ic k="check" /></div>
    <h2>메일을 보냈습니다</h2><p className="muted">가입한 이메일이면 곧 도착합니다. 안 보이면 스팸함도 확인해 주십시오.</p>
    <Button className="wide" label="로그인으로" variant="secondary" size="lg" width="100%" href="#/login" /></div></div>;
  return <Box title="아이디·비밀번호 찾기">
    <p className="muted">가입할 때 쓴 이메일로 아이디와 비밀번호를 바꿀 수 있는 링크를 보내 드립니다.</p>
    <form className="fl" onSubmit={onSubmit}>
      <TextInput label="이메일" type="email" htmlName="email" autoComplete="email" isRequired size="lg" {...bind('email')} />
      <Submit label="메일 보내기" busy={busy} />
    </form>
    <p className="muted" style={{textAlign: 'center'}}><a href="#/login">로그인으로</a></p>
  </Box>;
}

export function Reset({token}) {
  const {setMe} = useMe();
  // 링크 토큰을 주소창·방문기록에 남기지 않는다 (화면은 그대로 두고 주소만 바꾼다)
  useEffect(() => { history.replaceState(null, '', '#/reset'); }, []);
  const [v, bind] = useForm({password: ''});
  const [busy, onSubmit] = useSubmit(async () => {
    if (v.password.length < 6) return toast('비밀번호는 6자 이상이어야 합니다');
    const d = await api('reset', {token, ...v}); setMe(d.user); toast('비밀번호를 바꿨습니다'); location.hash = '#/';
  });
  return <Box title="새 비밀번호">
    <form className="fl" onSubmit={onSubmit}>
      <TextInput label="새 비밀번호 (6자 이상)" type="password" htmlName="password" autoComplete="new-password" isRequired size="lg" {...bind('password')} />
      <Submit label="비밀번호 바꾸기" busy={busy} />
    </form>
  </Box>;
}

export function Logout() {
  const {setMe} = useMe();
  useEffect(() => { api('logout', {}).finally(() => { setMe(null); location.hash = '#/'; }); }, []);
  return null;
}

// QR 을 찍으면 들어오는 곳: 대여 · 반납 · 남이 쓰는 중
const SCAN = {
  borrowed: ['check', '대여했습니다', '다 쓰고 같은 QR을 한 번 더 찍으면 반납됩니다.', ''],
  returned: ['back', '반납이 완료됐습니다', '이용해 주셔서 감사합니다.', ''],
  in_use: ['stop', '다른 사람이 쓰고 있습니다', '반납된 뒤에 다시 찍어 주십시오.', 'mute'],
};
const scanned = new Map();      // 같은 화면이 두 번 그려져도 한 번만 서버에 보낸다
export function Scan({code}) {
  const [res, setRes] = useState(null);
  useEffect(() => {
    // 새로고침·탭 복원으로 같은 주소가 다시 열리면 반납돼 버린다 — 주소에서 QR 코드를 지운다
    history.replaceState(null, '', '#/');
    if (!scanned.has(code)) scanned.set(code, api('scan', {code}).then(d => ({d}), e => ({err: e.message})));
    scanned.get(code).then(setRes);
  }, [code]);
  if (!res) return <div className="result"><p className="muted">잠시만 기다려 주십시오…</p></div>;
  if (res.err) return <div className="result enter"><div className="big mute pop"><Ic k="alert" /></div>
    <h2 style={{fontSize: 24}}>{res.err}</h2><Button className="wide" label="로비로" variant="primary" size="lg" width="100%" href="#/" /></div>;
  const v = SCAN[res.d.result];
  return <div className="result enter"><div className={'big pop ' + v[3]}><Ic k={v[0]} /></div>
    <h2>{v[1]}</h2><p className="nm">{res.d.item}</p><p className="muted">{v[2]}</p>
    <Button className="wide" label="대여 화면으로" variant="primary" size="lg" width="100%" href="#/items" /></div>;
}
