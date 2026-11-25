// 디자인 시스템 SWITCH 의 아이콘 (24px 선, currentColor). 없는 모양은 lucide-react 를 쓴다.
const I = ({d, cls = 'i', ...p}) => <svg className={cls} viewBox="0 0 24 24" aria-hidden="true" {...p}>{d.map((x, i) => typeof x === 'string' ? <path key={i} d={x} /> : x)}</svg>;
export const IcHome = p => <I d={['M3.5 10.5 12 3.5l8.5 7V20a.5.5 0 0 1-.5.5h-5v-6h-6v6H4a.5.5 0 0 1-.5-.5z']} {...p} />;
export const IcDoc = p => <I d={['M6 3.5h8l4.5 4.5v12a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z', 'M14 3.5V8h4.5M8.5 12.5h7M8.5 16h7']} {...p} />;
export const IcBox = p => <I d={['M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5z', 'M3.5 7.5 12 12l8.5-4.5M12 12v9']} {...p} />;
export const IcCal = p => <I d={[<rect key="r" x="3.5" y="5" width="17" height="15.5" rx="2.5" />, 'M3.5 10h17M8 3v4M16 3v4']} {...p} />;
export const IcFlag = p => <I d={['M5.5 21V4M5.5 4.5h11l-2.2 4 2.2 4h-11']} {...p} />;
export const IcCheck = p => <I d={['m5 12.5 4.5 4.5L19 7.5']} {...p} />;
export const IcNext = p => <I cls="s" d={['M9.5 6l6 6-6 6']} {...p} />;
export const IcBack = p => <I d={['M14.5 6 8.5 12l6 6']} {...p} />;
