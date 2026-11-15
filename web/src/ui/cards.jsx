// Astryx 카드를 그대로 쓰되, 폰에서는 안쪽 여백을 줄인다
import {Card as AxCard} from '@astryxdesign/core/Card';
import {ClickableCard as AxClickable} from '@astryxdesign/core/ClickableCard';
import {useNarrow, tight} from './narrow.js';
export function Card({padding, ...p}) { const n = useNarrow(); return <AxCard padding={tight(n, padding)} {...p} />; }
export function ClickableCard({padding, ...p}) { const n = useNarrow(); return <AxClickable padding={tight(n, padding)} {...p} />; }
