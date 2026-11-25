// 디자인 시스템 SWITCH 의 부품을 React 로. 모양은 전부 switch.css 의 클래스가 정한다 — 여기선 마크업만 짠다.
import {IcNext} from './icons.jsx';

// 버튼: 주 행동 .btn(갈색), 보조 ghost, 위험 red. href 가 있으면 링크로.
// size: 'sm'(44px) | 'wide'(폭 100%, 52px). busy 면 눌리지 않고 글자 뒤에 … 를 붙인다.
export function Btn({kind = '', size = '', href, busy, disabled, icon, end, children, className = '', type = 'button', ...p}) {
  const cls = ['btn', kind, size, className].filter(Boolean).join(' ');
  const body = <>{icon}{children}{busy ? '…' : ''}{end}</>;
  if (href && !disabled) return <a className={cls} href={href} {...p}>{body}</a>;
  return <button type={type} className={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...p}>{body}</button>;
}
// 카드 안 작은 알약 (36px). soft = 연한 바탕
export const Pb = ({soft, href, children, ...p}) => href
  ? <a className={soft ? 'pb soft' : 'pb'} href={href} {...p}>{children}</a>
  : <button type="button" className={soft ? 'pb soft' : 'pb'} {...p}>{children}</button>;
// 44px 원형 아이콘 버튼 — label 필수
export const Rb = ({label, href, children, ...p}) => href
  ? <a className="rb" href={href} aria-label={label} title={label} {...p}>{children}</a>
  : <button type="button" className="rb" aria-label={label} title={label} {...p}>{children}</button>;
// "자세히 보기 ›" 같은 글자 링크
export const More = ({href, children = '자세히 보기', ...p}) => <a className="lk" href={href} {...p}>{children}<IcNext /></a>;

// 상태 배지: ok(가능·진행) · mine(내 것) · use(남이 쓰는 중) · closed(마감) · 없으면 분류
export const Pill = ({tone = '', children}) => <span className={tone ? 'pill ' + tone : 'pill'}>{children}</span>;
// 행사 상태 글자 → 배지 색
export const stTone = st => st === '모집 중' ? 'ok' : st === '신청함' ? 'mine' : st === '마감' || st === '마감됨' ? 'closed' : 'use';

export const Card = ({as: T = 'div', className = '', children, ...p}) => <T className={'card ' + className} {...p}>{children}</T>;

// 입력칸: 라벨이 위에 붙는다. hint(보조 설명) · error(빨간 글) · req(필수 *)
export function Field({label, req, hint, error, multiline, children, className = '', ...p}) {
  const id = p.id || p.name;
  const input = children || (multiline ? <textarea {...p} aria-invalid={!!error || undefined} /> : <input {...p} aria-invalid={!!error || undefined} />);
  return <label className={'f ' + className} htmlFor={children ? undefined : id}>
    {label}{req && <span className="req"> *</span>}
    {input}
    {(error || hint) && <span className={error ? 'hint err' : 'hint'}>{error || hint}</span>}
  </label>;
}
export const Select = ({label, options, value, onChange, placeholder, ...p}) => <Field label={label} {...p}>
  <select value={value ?? ''} onChange={e => onChange(e.target.value)}>
    {placeholder != null && <option value="" disabled>{placeholder}</option>}
    {options.map(o => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
</Field>;

export const Chk = ({label, checked, onChange, disabled, desc}) => <label className="chk">
  <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
  <span>{label}{desc && <small className="chk-d">{desc}</small>}</span>
</label>;

// 같은 화면 안에서 보기 바꾸기. items: [[값, 글], …]
export const Seg = ({label, value, onChange, items}) => <div className="seg" role="tablist" aria-label={label}>
  {items.map(([v, t]) => <button key={v} type="button" role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{t}</button>)}
</div>;

// 신청서 선택지 (2열). multi 면 여러 개
export function Opts({options, value, onChange, multi, disabled}) {
  const on = o => multi ? (value || []).includes(o) : value === o;
  const flip = o => multi ? onChange(on(o) ? value.filter(x => x !== o) : [...(value || []), o]) : onChange(on(o) ? '' : o);
  return <div className="opts">{options.map(o => <button key={o} type="button" aria-pressed={on(o)} disabled={disabled} onClick={() => flip(o)}>{o}</button>)}</div>;
}

// 목록이 비었을 때: 아이콘 원 → 제목 → 설명 → 버튼 하나
export const Empty = ({icon, title, desc, action}) => <div className="empty">
  {icon && <span className="ic" aria-hidden="true">{icon}</span>}
  <b>{title}</b>{desc && <p>{desc}</p>}{action}
</div>;

// 불러오는 동안 자리 잡기 (카드 크기 그대로)
export const Loading = ({rows = [96, 96]}) => <div aria-busy="true" aria-label="불러오는 중" className="sk-col">
  {rows.map((h, i) => <span key={i} className="sk" style={{height: h}} />)}
</div>;

// 신청 인원 막대. big = 상세 화면용 (숫자 30px)
export function Gauge({g, big}) {
  if (!g || g.n == null) return null;
  const cap = g.capacity, n = g.n, pct = cap ? Math.min(100, n / cap * 100) : 0;
  const bar = cap != null && <div className="gauge" role="progressbar" aria-label="신청 인원" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={Math.min(n, cap)}><i style={{width: pct + '%'}} /></div>;
  if (big) return <div className="gbig">
    <div className="n"><b>{n}명</b><span>신청</span><em>{cap == null ? '인원 제한 없음' : cap - n > 0 ? `정원 ${cap}명 중 ${cap - n}자리 남음` : `정원 ${cap}명 마감`}</em></div>{bar}
  </div>;
  return <div className="g"><div className="t"><span><b>{n}명</b> 신청</span><span>{cap == null ? '인원 제한 없음' : `정원 ${cap}명`}</span></div>{bar}</div>;
}

// 항목명–값 두 칸 표. rows: [[이름, 값], …] (값이 비면 그 줄은 빼고)
export const Rows = ({rows}) => <div className="rows">{rows.filter(r => r && r[1] != null && r[1] !== false && r[1] !== '').map(([k, v]) => <div key={k}><span>{k}</span><span>{v}</span></div>)}</div>;

// 화면 머리말: 메타 줄 → 제목 → 설명. back = [주소, 글]
export function Head({meta, kicker, title, desc, end, big}) {
  return <div className="head">
    {kicker && <span className="kicker">{kicker}</span>}
    {meta && <div className="meta">{meta}</div>}
    <div className="head-t">{big ? <h1 className="big-title">{title}</h1> : <h1>{title}</h1>}{end && <div className="head-end">{end}</div>}</div>
    {desc && <p className="muted head-d">{desc}</p>}
  </div>;
}

// 상태 안내 (배너 대신): ok = 연두 완료 박스, 그 외는 fill 바탕 안내
export const Note = ({tone, title, children, icon}) => <div className={tone === 'ok' ? 'done' : 'info'} role="status">
  {icon}<div><b>{title}</b>{children && <div className="info-d">{children}</div>}</div>
</div>;

// 범례: 색만으로 구분하지 않게 글자를 같이 단다
export const Legend = ({items, extra}) => <div className="legend">
  {items.map(([c, t]) => <span key={t}><i style={{background: `var(--${c})`}} />{t}</span>)}{extra && <span className="legend-x">{extra}</span>}
</div>;

export const Md = ({html}) => <div className="md" dangerouslySetInnerHTML={{__html: html}} />;
