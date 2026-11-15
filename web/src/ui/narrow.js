// 폰처럼 좁은 화면인지. 여백·카드 안쪽 여백을 줄이는 데 쓴다.
import {useSyncExternalStore} from 'react';
const mq = matchMedia('(max-width: 640px)');
const sub = f => { mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); };
export const useNarrow = () => useSyncExternalStore(sub, () => mq.matches);
// 좁은 화면에서도 카드 안쪽 여백은 16px 이상 지킨다 (넓은 값만 20px 로 줄인다)
export const tight = (narrow, p) => narrow ? Math.max(Math.min(p ?? 4, 5), 4) : p;
