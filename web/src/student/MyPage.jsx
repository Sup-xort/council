// 마이페이지: 알림 · 계정 정보 · 로그아웃 · 탈퇴
import {Card, Text, VStack, List, ListItem} from '../ui/ax.js';
import {api, toast} from '../lib/common.js';
import {useAsk} from '../ui/base.jsx';
import {useMe, PageHead} from './parts.jsx';
import {MailSettings} from './Pages.jsx';

function Account() {
  const {me, setMe} = useMe();
  const ask = useAsk();
  const out = async () => { if (await ask.confirm('로그아웃할까요?', {actionLabel: '로그아웃'})) location.hash = '#/logout'; };
  const leave = async () => {
    if (!await ask.confirm('정말 탈퇴할까요?', {danger: true, actionLabel: '계속',
      description: '계정과 대여·신청 기록이 모두 삭제되고, 되돌릴 수 없어요. 이미 학생회 구글 시트에 적힌 신청 내용은 학생회에서 따로 지워요.'})) return;
    const pw = await ask.prompt('본인 확인을 위해 비밀번호를 입력해 주세요', {label: '비밀번호', type: 'password', actionLabel: '탈퇴하기'});
    if (!pw) return;
    try { await api('withdraw', {password: pw}); setMe(null); toast('탈퇴가 끝났어요. 그동안 이용해 주셔서 고마워요'); location.hash = '#/'; } catch {}
  };
  return <VStack gap={4} hAlign="stretch">
    <MailSettings />
    <Card padding={2}><List hasDividers>
      <ListItem label="이름" endContent={<Text type="supporting" color="secondary">{me.name}</Text>} />
      <ListItem label="학번" endContent={<Text type="supporting" color="secondary">{me.student_id}</Text>} />
      <ListItem label="이메일" endContent={<Text type="supporting" color="secondary">{me.email}</Text>} />
      <ListItem label="학생회비 납부" endContent={<span className={me.dues ? 'dues dues-o' : 'dues dues-x'}>{me.dues ? 'O' : 'X'}</span>} />
    </List></Card>
    <Card padding={2}><List hasDividers>
      <ListItem label="로그아웃" onClick={out} />
      <ListItem label="회원 탈퇴" description="계정과 기록이 모두 삭제돼요" onClick={leave} />
    </List></Card>
  </VStack>;
}

export default function MyPage() {
  const {me} = useMe();
  return <div className="narrow"><VStack gap={4}>
    <PageHead title={`${me.name}(${me.student_id})`} desc="내 정보와 설정" />
    <Account />
  </VStack></div>;
}
