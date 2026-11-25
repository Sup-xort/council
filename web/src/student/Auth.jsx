// 로그인 · 가입 · 계정 찾기 · 새 비밀번호 · QR 스캔 결과
import {useEffect, useState} from 'react';
import {Undo2, Ban, AlertCircle, MailCheck} from 'lucide-react';
import {api, toast} from '../lib/common.js';
import {Btn, Field, Chk} from '../ui/kit.jsx';
import {IcCheck} from '../ui/icons.jsx';
import {useMe, goNext} from './parts.jsx';

function Steps({step}) {
  const items = ['정보 입력', '개인정보 동의'];
  return <ol className="steps" aria-label={`가입 ${items.length}단계 중 ${step}단계`}>
    {items.map((t, i) => {
      const n = i + 1, state = n < step ? 'done' : n === step ? 'on' : '';
      return <li key={t} className={state} aria-current={n === step ? 'step' : undefined}>
        <span className="dot">{n < step ? <IcCheck /> : n}</span><span className="lb">{t}</span>
      </li>;
    })}
  </ol>;
}
// 로그인 상자: 로고 → 카드(제목 · 설명 · 내용 · 아래 글) → 로비로
function Box({title, desc, children, foot}) {
  return <div className="authbox auth">
    <div className="brand"><a className="mark" href="#/" aria-label="SWITCH 로비로"><span className="logo hero" /></a></div>
    <div className="card auth-card">
      <h2 className="auth-t">{title}</h2>{desc && <p className="muted auth-d">{desc}</p>}
      {children}
      {foot && <p className="muted center auth-foot">{foot}</p>}
    </div>
    <p className="center"><a className="muted" href="#/">로비로 돌아가기</a></p>
  </div>;
}
// 결과 화면 (QR · 메일 보냄): 원 아이콘 → 제목 → 물품 이름 → 안내 → 버튼
function Result({icon, mute, title, name, desc, action}) {
  return <div className="authbox"><div className="result enter">
    <div className={'big pop' + (mute ? ' mute' : '')}>{icon}</div>
    <h2>{title}</h2>{name && <p className="nm">{name}</p>}{desc && <p className="muted">{desc}</p>}{action}
  </div></div>;
}
function useForm(init) {
  const [v, setV] = useState(init);
  const bind = k => ({name: k, value: v[k], onChange: e => { const x = e.target.value; setV(o => ({...o, [k]: x})); }});
  return [v, bind];
}
function useSubmit(fn) {
  const [busy, setBusy] = useState(false);
  const onSubmit = async e => { e.preventDefault(); if (busy) return; setBusy(true); try { await fn(); } catch {} finally { setBusy(false); } };
  return [busy, onSubmit];
}
const Submit = ({label, busy, disabled}) => <Btn type="submit" size="wide" busy={busy} disabled={disabled}>{label}</Btn>;

const pwError = x => x.length < 6 ? '6자 이상으로 정해 주십시오' : !/[A-Za-z]/.test(x) || !/\d/.test(x) ? '영문자와 숫자를 모두 넣어 주십시오' : '';

export function Login({q}) {
  const {setMe, signupOpen} = useMe();
  const next = q.get('next') || '#/';
  const [v, bind] = useForm({username: '', password: ''});
  const [busy, onSubmit] = useSubmit(async () => { const d = await api('login', v); setMe(d.user); goNext(next); });
  return <Box title="로그인" foot={<>{signupOpen && <>처음 이용하십니까? <a href={'#/signup?next=' + encodeURIComponent(next)}>회원가입</a> · </>}<a href="#/forgot">계정 찾기</a></>}>
    <form onSubmit={onSubmit}>
      <Field label="아이디" id="username" autoComplete="username" autoCapitalize="off" {...bind('username')} />
      <Field label="비밀번호" id="password" type="password" autoComplete="current-password" {...bind('password')} />
      <Submit label="로그인" busy={busy} />
    </form>
  </Box>;
}

export function Signup({q}) {
  const {setMe, signupOpen} = useMe();
  const next = q.get('next') || '#/';
  const [step, setStep] = useState(1);
  const [agree, setAgree] = useState(false);
  const [mailDept, setMailDept] = useState(false);
  const [mailEvent, setMailEvent] = useState(false);
  const [wait, setWait] = useState(0);
  const [v, bind] = useForm({username: '', name: '', student_id: '', email: '', code: '', phone: '', password: '', password2: ''});
  useEffect(() => { if (wait > 0) { const id = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(id); } }, [wait]);
  const [tried, setTried] = useState(false);
  const digits = x => x.replace(/\D/g, '');
  const RULES = {
    username: x => /^[A-Za-z0-9_.-]{3,32}$/.test(x.trim()) ? '' : '영문과 숫자로 3~32자를 써 주십시오',
    name: x => x.trim() ? '' : '이름을 써 주십시오',
    student_id: x => /^\d{10}$/.test(x.trim()) ? '' : `숫자 10자리로 써 주십시오 (지금 ${x.trim().length}자)`,
    email: x => /^[^@\s]+@(g\.)?skku\.edu$/i.test(x.trim()) ? '' : 'skku.edu 또는 g.skku.edu 주소로 써 주십시오',
    code: x => /^\d{6}$/.test(x.trim()) ? '' : '메일로 받은 6자리 숫자를 써 주십시오',
    phone: x => /^\d{9,11}$/.test(digits(x)) ? '' : '전화번호를 다시 확인해 주십시오',
    password: x => pwError(x),
    password2: x => x === v.password ? '' : '비밀번호가 서로 다릅니다',
  };
  const errs = Object.fromEntries(Object.keys(RULES).map(k => [k, RULES[k](v[k])]));
  const field = k => ({...bind(k), id: k, error: (v[k] || tried) ? errs[k] || undefined : undefined});
  const sendCode = async () => {
    if (errs.email) { setTried(true); return toast(errs.email); }
    try { await api('signup_code', {email: v.email.trim()}); setWait(60); toast('인증 코드를 보냈습니다. 메일함을 확인해 주십시오'); }
    catch { setWait(5); }
  };
  const go = e => {
    e.preventDefault();
    if (Object.values(errs).some(Boolean)) { setTried(true); return toast('빨간 칸을 먼저 고쳐 주십시오'); }
    setStep(2); window.scrollTo(0, 0);
  };
  const [busy, onSubmit] = useSubmit(async () => {
    if (!agree) return toast('개인정보 수집·이용에 동의해 주십시오');
    try { const d = await api('signup', {...v, code: v.code.trim(), consent: true, mail_dept: mailDept, mail_event: mailEvent}); setMe(d.user); goNext(next); }
    catch (e) { setStep(1); throw e; }
  });
  const foot = <a href={'#/login?next=' + encodeURIComponent(next)}>이미 계정이 있습니다</a>;
  if (!signupOpen) return <Box title="회원가입" desc="지금은 새 회원을 받지 않습니다." foot={foot} />;
  if (step === 2) return <Box title="개인정보 수집·이용 동의" desc="아래 내용을 확인하고 동의해 주십시오." foot={foot}>
    <Steps step={2} />
    <form onSubmit={onSubmit}>
      <div className="doc consent">
        <table><tbody>
          <tr><th>수집 항목</th><td>아이디, 비밀번호, 이름, 학번, 이메일, 전화번호</td></tr>
          <tr><th>이용 목적</th><td>회원 가입 및 관리(본인 식별·인증, 회원자격 유지·관리, 고지·통지, 고충처리), 서비스 제공(물품 대여·반납, 세미나실 예약, 행사 신청 관리)</td></tr>
          <tr><th>보유 기간</th><td>회원 탈퇴 시까지</td></tr>
        </tbody></table>
        <p className="muted">동의를 거부할 수 있습니다. 다만 동의하지 않으면 회원 가입과 서비스 이용이 제한됩니다. 자세한 내용은 <a href="#/privacy" target="_blank">개인정보 처리방침</a>에서 확인할 수 있습니다.</p>
      </div>
      <Chk label="개인정보 수집·이용에 동의합니다 (필수)" checked={agree} onChange={setAgree} />
      <p className="muted" style={{margin: '14px 0 4px'}}>새 공지가 올라오면 이메일로 알려 드립니다. 받을 공지를 골라 주십시오. 나중에 설정에서 바꿀 수 있습니다.</p>
      <Chk label="학과 공지 메일 받기 (선택)" checked={mailDept} onChange={setMailDept} />
      <Chk label="행사 공지 메일 받기 (선택)" checked={mailEvent} onChange={setMailEvent} />
      <div className="stack" style={{marginTop: 16}}>
        <Submit label="동의하고 가입하기" busy={busy} disabled={!agree} />
        <Btn kind="ghost" size="wide" onClick={() => setStep(1)}>이전</Btn>
      </div>
    </form>
  </Box>;
  return <Box title="회원가입" foot={foot}>
    <Steps step={1} />
    <form onSubmit={go} noValidate>
      <Field label="아이디" hint="영문과 숫자로 3자 이상" autoComplete="username" autoCapitalize="off" {...field('username')} />
      <Field label="이름" autoComplete="name" {...field('name')} />
      <Field label="학번" hint="숫자 10자리" inputMode="numeric" maxLength={10} autoComplete="off" {...field('student_id')} />
      <Field label="이메일" hint="skku.edu 또는 g.skku.edu 주소" type="email" autoComplete="email" {...field('email')} />
      <div className="row code-row">
        <Field className="grow" label="인증 코드" hint="이메일로 받은 6자리 숫자" inputMode="numeric" maxLength={6} autoComplete="one-time-code" {...field('code')} />
        <Btn kind="ghost" disabled={wait > 0} onClick={sendCode}>{wait > 0 ? `${wait}초` : '코드 받기'}</Btn>
      </div>
      <Field label="전화번호" type="tel" inputMode="tel" autoComplete="tel" {...field('phone')} />
      {/* 비밀번호는 맨 끝 — 중간에 두면 iOS 자동완성이 다음 칸(이름)에도 비밀번호를 채운다 */}
      <Field label="비밀번호" hint="영문+숫자 6자 이상" type="password" autoComplete="new-password" {...field('password')} />
      <Field label="비밀번호 확인" type="password" autoComplete="new-password" {...field('password2')} />
      <Submit label="다음" />
    </form>
  </Box>;
}

export function Forgot() {
  const [v, bind] = useForm({email: ''});
  const [sent, setSent] = useState(false);
  const [busy, onSubmit] = useSubmit(async () => { await api('forgot', v); setSent(true); });
  if (sent) return <Result icon={<MailCheck className="i" />} title="메일을 보냈습니다" desc="가입한 이메일이면 곧 도착합니다. 안 보이면 스팸함도 확인해 주십시오."
    action={<Btn kind="ghost" href="#/login">로그인으로</Btn>} />;
  return <Box title="아이디·비밀번호 찾기" desc="가입할 때 쓴 이메일로 아이디와 비밀번호를 바꿀 수 있는 링크를 보내 드립니다." foot={<a href="#/login">로그인으로</a>}>
    <form onSubmit={onSubmit}>
      <Field label="이메일" id="email" type="email" autoComplete="email" {...bind('email')} />
      <Submit label="메일 보내기" busy={busy} />
    </form>
  </Box>;
}

export function Reset({token}) {
  const {setMe} = useMe();
  useEffect(() => { history.replaceState(null, '', '#/reset'); }, []);   // 링크 토큰을 주소창·방문기록에 남기지 않는다
  const [v, bind] = useForm({password: '', password2: ''});
  const [busy, onSubmit] = useSubmit(async () => {
    const bad = pwError(v.password); if (bad) return toast(bad);
    if (v.password !== v.password2) return toast('비밀번호가 서로 다릅니다');
    const d = await api('reset', {token, password: v.password}); setMe(d.user); toast('비밀번호를 바꿨습니다'); location.hash = '#/';
  });
  return <Box title="새 비밀번호">
    <form onSubmit={onSubmit}>
      <Field label="새 비밀번호" id="password" hint="영문+숫자 6자 이상" type="password" autoComplete="new-password" {...bind('password')} />
      <Field label="새 비밀번호 확인" id="password2" type="password" autoComplete="new-password" {...bind('password2')} error={v.password2 && v.password2 !== v.password ? '비밀번호가 서로 다릅니다' : undefined} />
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
  borrowed: [<IcCheck />, '대여 완료', '다 쓰고 같은 QR을 한 번 더 찍으면 반납됩니다.', false],
  returned: [<Undo2 className="i" />, '반납 완료', '이용해 주셔서 감사합니다.', false],
  in_use: [<Ban className="i" />, '사용중', '다른 사람이 쓰고 있습니다. 반납된 뒤에 다시 찍어 주십시오.', true],
};
const scanned = new Map();      // 같은 화면이 두 번 그려져도 한 번만 서버에 보낸다
export function Scan({code}) {
  const [res, setRes] = useState(null);
  useEffect(() => {
    history.replaceState(null, '', '#/');      // 새로고침하면 반납돼 버리니 주소에서 QR 코드를 지운다
    if (!scanned.has(code)) scanned.set(code, api('scan', {code}).then(d => ({d}), e => ({err: e.message})));
    scanned.get(code).then(setRes);
  }, [code]);
  if (!res) return <div className="authbox"><div className="result" aria-busy="true"><span className="big mute sk" /><p className="muted">잠시만 기다려 주십시오</p></div></div>;
  const [icon, title, desc, mute] = res.err ? [<AlertCircle className="i" />, res.err, '', true] : SCAN[res.d.result];
  return <Result icon={icon} mute={mute} title={title} name={res.d?.item} desc={desc}
    action={<Btn size="wide" href={res.err ? '#/' : '#/items'}>{res.err ? '로비로' : '내 대여 보기'}</Btn>} />;
}
