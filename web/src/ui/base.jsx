// 두 사이트가 같이 쓰는 틀: Astryx 테마·한국어·알림·확인 창, 화면 밝기 단추, 주소(#/…) 따라가기.
import {createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Theme} from '@astryxdesign/core/theme';
import {InternationalizationProvider} from '@astryxdesign/core/i18n';
import KO from '@astryxdesign/core/locales/ko-KR.generated.js';
import {LayerProvider} from '@astryxdesign/core/Layer';
import {useToast} from '@astryxdesign/core/Toast';
import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Sun, Moon} from 'lucide-react';
import {HStack} from '@astryxdesign/core/HStack';
import {VStack} from '@astryxdesign/core/VStack';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
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

// ── 화면 밝기 ─────────────────────────────────────────────────────────
// 기본은 기기 설정을 따른다. 단추 하나로 밝게↔어둡게를 바꾸고, 고른 것은 이 브라우저에 기억한다.
// 기기 설정과 같은 쪽으로 돌아오면 기억을 지워 다시 '기기를 따름'이 된다. (예전 사이트와 같은 저장 이름)
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const stored = () => { try { return localStorage.getItem('theme'); } catch { return null; } };
const ModeCtx = createContext(null);
function useMode() {
  const [mode, setMode] = useState(() => stored() || 'system');
  const [deviceDark, setDeviceDark] = useState(darkMQ.matches);
  useEffect(() => { const f = () => setDeviceDark(darkMQ.matches); darkMQ.addEventListener?.('change', f); return () => darkMQ.removeEventListener?.('change', f); }, []);
  const dark = mode === 'system' ? deviceDark : mode === 'dark';
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
  return <IconButton label={dark ? '밝은 화면으로' : '어두운 화면으로'} tooltip={dark ? '밝은 화면으로' : '어두운 화면으로'} variant="ghost"
    icon={dark ? <Sun size={18} /> : <Moon size={18} />} onClick={toggle} />;
}

// ── 확인 창 · 입력 창 ─────────────────────────────────────────────────
// 브라우저 기본 confirm/prompt 대신 Astryx 창을 띄운다. await ask(...) 로 답을 받는다.
const AskCtx = createContext(null);
export const useAsk = () => useContext(AskCtx);
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
    {alert && <AlertDialog isOpen onOpenChange={o => !o && closeAlert(false)} title={alert.title} description={alert.description || ' '}
      cancelLabel="취소" actionLabel={alert.actionLabel} actionVariant={alert.danger ? 'destructive' : 'primary'} onAction={() => closeAlert(true)} />}
    {prompt && <Dialog isOpen onOpenChange={o => !o && closePrompt(null)} width={420}>
      <form onSubmit={e => { e.preventDefault(); closePrompt(prompt.value); }}>
        <VStack gap={4} padding={5}>
          <DialogHeader title={prompt.title} subtitle={prompt.description || undefined} onOpenChange={o => !o && closePrompt(null)} />
          <TextInput label={prompt.label} type={prompt.type} value={prompt.value} hasAutoFocus
            onChange={v => setPrompt(p => ({...p, value: v}))} autoComplete={prompt.type === 'password' ? 'current-password' : 'off'} />
          <HStack gap={2} hAlign="end">
            <Button label="취소" variant="secondary" onClick={() => closePrompt(null)} />
            <Button label={prompt.actionLabel} variant="primary" type="submit" />
          </HStack>
        </VStack>
      </form>
    </Dialog>}
  </AskCtx.Provider>;
}

// 예전 toast() 를 Astryx 알림으로
function ToastBridge() {
  const show = useToast();
  useEffect(() => { setToast(msg => show({body: msg, autoHideDuration: 2600})); }, [show]);
  return null;
}

export function Providers({children}) {
  const m = useMode();
  return <ModeCtx.Provider value={m}>
    <InternationalizationProvider locale="ko-KR" messages={{'ko-KR': KO}}>
      <Theme theme={neutralTheme} mode={m.mode}>
        <LayerProvider>
          <ToastBridge />
          <AskHost>{children}</AskHost>
        </LayerProvider>
      </Theme>
    </InternationalizationProvider>
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
