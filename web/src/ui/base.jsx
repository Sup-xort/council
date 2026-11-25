// 두 사이트가 같이 쓰는 틀: 화면 밝기, 알림, 확인·입력 창, 주소(#/…) 따라가기, 불러오기.
// 모양은 디자인 시스템 SWITCH (tokens.css + switch.css) 를 따른다.
import {createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Sun, Moon} from 'lucide-react';
import {setToast} from '../lib/common.js';

// ── 주소 따라가기 ─────────────────────────────────────────────────────
// 예전 사이트와 같은 주소(#/notice/3, admin#/event/2 …)를 그대로 쓴다. QR·공유 링크가 안 깨진다.
const subHash = fn => { addEventListener('hashchange', fn); return () => removeEventListener('hashchange', fn); };
export function useHash(fallback = '/') {
  const hash = useSyncExternalStore(subHash, () => location.hash);
  const [path, qs = ''] = (hash.slice(1) || fallback).split('?');
  return {path, q: new URLSearchParams(qs), hash};
}
export const go = h => { location.hash = h; };

// 화면 폭 (폰처럼 좁은지)
export function useMQ(q) {
  const mq = useRef(matchMedia(q)).current;
  return useSyncExternalStore(f => { mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, () => mq.matches);
}

// ── 화면 밝기 ─────────────────────────────────────────────────────────
// 기본은 기기 설정. 단추 하나로 밝게↔어둡게를 바꾸고, 고른 것은 이 브라우저에 기억한다.
// 기기 설정과 같은 쪽으로 돌아오면 기억을 지워 다시 '기기를 따름'이 된다. <html data-theme> 로 건다.
const stored = () => { try { return localStorage.getItem('theme'); } catch { return null; } };
const ModeCtx = createContext(null);
function useMode() {
  const deviceDark = useMQ('(prefers-color-scheme: dark)');
  const [mode, setMode] = useState(() => stored() || 'system');
  const dark = mode === 'system' ? deviceDark : mode === 'dark';
  useEffect(() => {
    const h = document.documentElement;
    if (mode === 'system') delete h.dataset.theme; else h.dataset.theme = mode;
  }, [mode]);
  const toggle = () => {
    const want = dark ? 'light' : 'dark';
    const fixed = want === (deviceDark ? 'dark' : 'light') ? null : want;
    try { fixed ? localStorage.setItem('theme', fixed) : localStorage.removeItem('theme'); } catch {}
    setMode(fixed || 'system');
  };
  return {mode, dark, toggle};
}
export function ThemeButton() {
  const {dark, toggle} = useContext(ModeCtx);
  const label = dark ? '밝은 화면으로' : '어두운 화면으로';
  return <button type="button" className="rb" aria-label={label} title={label} onClick={toggle}>{dark ? <Sun /> : <Moon />}</button>;
}

// ── 확인 창 · 입력 창 ─────────────────────────────────────────────────
// 브라우저 기본 confirm/prompt 대신 띄운다. await ask.confirm(...) / ask.prompt(...) 로 답을 받는다.
const AskCtx = createContext(null);
export const useAsk = () => useContext(AskCtx);
function Dlg({role, title, desc, onCancel, children}) {
  const box = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    (box.current.querySelector('input') || box.current.querySelector('.acts .btn:last-child'))?.focus();
    const esc = e => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };
    addEventListener('keydown', esc);
    return () => { removeEventListener('keydown', esc); prev?.focus?.(); };
  }, []);
  return <div className="dlg-back" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
    <div className="dlg" role={role} aria-modal="true" aria-labelledby="dlg-t" aria-describedby={desc ? 'dlg-d' : undefined} ref={box}>
      <h2 id="dlg-t">{title}</h2>
      {desc && <p id="dlg-d">{desc}</p>}
      {children}
    </div>
  </div>;
}
function AskHost({children}) {
  const [alert, setAlert] = useState(null);      // {title, description, actionLabel, danger, resolve}
  const [prompt, setPrompt] = useState(null);    // {title, description, label, type, value, actionLabel, resolve}
  const ask = useRef(null);
  ask.current ||= {
    confirm: (title, {description = '', actionLabel = '확인', danger = false} = {}) =>
      new Promise(resolve => setAlert({title, description, actionLabel, danger, resolve})),
    prompt: (title, {description = '', label = title, type = 'text', value = '', actionLabel = '확인'} = {}) =>
      new Promise(resolve => setPrompt({title, description, label, type, value, actionLabel, resolve})),
  };
  const closeAlert = ok => { alert?.resolve(ok); setAlert(null); };
  const closePrompt = v => { prompt?.resolve(v); setPrompt(null); };
  return <AskCtx.Provider value={ask.current}>
    {children}
    {alert && <Dlg role="alertdialog" title={alert.title} desc={alert.description} onCancel={() => closeAlert(false)}>
      <div className="acts">
        <button type="button" className="btn ghost" onClick={() => closeAlert(false)}>취소</button>
        <button type="button" className={'btn' + (alert.danger ? ' danger' : '')} onClick={() => closeAlert(true)}>{alert.actionLabel}</button>
      </div>
    </Dlg>}
    {prompt && <Dlg role="dialog" title={prompt.title} desc={prompt.description} onCancel={() => closePrompt(null)}>
      <form onSubmit={e => { e.preventDefault(); closePrompt(prompt.value); }}>
        <label className="f" style={{marginBottom: 0}}>{prompt.label}
          <input type={prompt.type} value={prompt.value} onChange={e => { const v = e.target.value; setPrompt(p => ({...p, value: v})); }}
            autoComplete={prompt.type === 'password' ? 'current-password' : 'off'} /></label>
        <div className="acts" style={{marginTop: 16}}>
          <button type="button" className="btn ghost" onClick={() => closePrompt(null)}>취소</button>
          <button type="submit" className="btn">{prompt.actionLabel}</button>
        </div>
      </form>
    </Dlg>}
  </AskCtx.Provider>;
}

// 화면 아래에 잠깐 뜨는 한 줄 알림 (2.6초)
function ToastHost() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    let t = 0;
    setToast(m => { clearTimeout(t); setMsg({m, k: Date.now()}); t = setTimeout(() => setMsg(null), 2600); });
    return () => clearTimeout(t);
  }, []);
  return msg && <div className="toast" role="status" aria-live="polite" key={msg.k}>{msg.m}</div>;
}

export function Providers({children}) {
  const m = useMode();
  return <ModeCtx.Provider value={m}>
    <AskHost>{children}</AskHost>
    <ToastHost />
  </ModeCtx.Provider>;
}

// 불러오기: 주소가 바뀌면 다시 부른다. 앞 화면의 늦은 응답이 새 화면을 덮지 않게 마지막 것만 쓴다.
export function useLoad(fn, deps) {
  const [state, setState] = useState({data: null, error: null, loading: true});
  const seq = useRef(0);
  const run = useCallback(() => {
    const my = ++seq.current;
    setState(s => ({...s, loading: true}));
    Promise.resolve().then(fn).then(
      data => my === seq.current && setState({data, error: null, loading: false}),
      error => my === seq.current && setState(s => ({data: s.data, error, loading: false})));
  }, deps);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(run, [run]);
  return {...state, reload: run};
}
