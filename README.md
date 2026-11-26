# SWITCH — 반도체융합공학과 학생회 홈페이지

물품 대여, 세미나실 예약, 행사 신청, 공지를 한 곳에서 하는 학생회 사이트입니다. 학생이 쓰는 사이트와 관리자가 쓰는 관리 사이트(`/admin`)로 나뉘고, 둘 다 넓은 화면과 모바일 화면에 맞춰 짜여 있습니다.

주소는 `https://sqhsxp.duckdns.org/council/` 입니다.

## 학생이 할 수 있는 일

**로비**
- 지금 신청받는 행사와 최근 공지를 배너로 보여 줍니다. 로그인하지 않은 사람에게는 학과 공지를 먼저 보여 줍니다.

**물품 대여**
- 물품에 붙은 QR 을 기본 카메라로 찍으면 대여, 다시 찍으면 반납이 됩니다.
- 내가 빌린 물품과 반납 기한을 볼 수 있습니다. 대여할 때는 확인 메일이 갑니다.

**세미나실 예약**
- 세미나실 1, 2 를 날짜와 시간대별로 예약하고 취소합니다.
- 한 주(월~일)에 예약할 수 있는 시간과 취소 마감 시간은 관리자가 정합니다.

**행사 신청**
- 행사마다 관리자가 만든 질문(짧은 글, 긴 글, 하나 고르기, 드롭다운, 여러 개 고르기, 체크박스)에 답해 신청합니다. 마감 전에는 고치거나 취소할 수 있습니다.
- 정원이 있는 행사는 신청 현황을 게이지로 보여 주고, 정원이 차면 닫습니다. 인원 수를 보일지는 행사마다 관리자가 정합니다.

**공지**
- 학과 공지와 행사 공지를 나눠서 봅니다. 학과 공지는 학과 홈페이지에서 30분마다 새 글을 가져옵니다. 한 번 가져온 글은 관리자가 지워도 다시 들어오지 않습니다.

**계정**
- 가입은 `skku.edu` 또는 `g.skku.edu` 메일로만 받고, 메일로 받은 인증 코드를 넣어야 합니다. 새 회원을 받을지는 관리자가 켜고 끕니다.
- 비밀번호를 잊으면 메일로 아이디와 재설정 링크(30분, 한 번만)를 받습니다.
- 마이페이지에서 내 정보, 공지·행사 메일 수신 여부를 바꾸고 탈퇴할 수 있습니다.
- 한 번 로그인하면 사실상 풀리지 않습니다(쿠키 400일, 열 때마다 연장).
- 밝은 화면과 어두운 화면을 지원합니다. 따로 고르지 않으면 기기 설정을 따릅니다.

## 관리자가 할 수 있는 일

관리 사이트(`/admin`)의 메뉴는 물품, 대여 기록, 예약 기록, 행사, 신청자, 공지, 회원, 관리자입니다. 데이터는 잘라내지 않고 전부 표로 보여 주며 필터와 검색이 됩니다.

- **물품**: 물품을 추가·삭제하고, 대여 중인 물품을 강제로 반납 처리합니다. 종류별로 대여 기간(시간)을 정합니다. 물품 QR 은 PDF 로 뽑아 인쇄합니다. 크기는 1.5~4cm 중에서 고릅니다.
- **대여·예약 기록**: 누가 언제 빌리고 반납했는지, 누가 어느 시간을 잡았는지 봅니다. 세미나실 주당 시간과 취소 마감도 여기서 정합니다.
- **행사**: 행사 글과 신청 마감, 신청 질문을 만듭니다. 로비 노출 여부도 정합니다.
- **신청자**: 행사별 신청 내용을 표로 보고, 구글 시트에 자동으로 옮겨 적습니다.
- **공지**: 글을 쓰고 고칩니다. 공지에 붙는 버튼(칩)으로 행사 신청 등으로 바로 이어 줍니다. 공지를 올리면 메일 수신을 켠 회원에게 메일이 갑니다.
- **회원**: 가입한 회원 목록을 보고, 가입 받기를 켜고 끕니다.
- **관리자**: 최고 관리자만 다른 사람을 관리자로 지정하거나 해제합니다.

## 만든 방식

- `council.py` 서버, API, QR PDF 만들기. 표준 라이브러리와 `vendor/segno`(QR 그리기)만 씁니다.
- `data/council.db` sqlite 데이터베이스. 지우면 전부 사라집니다.
- `web/src/student`, `web/src/admin` 학생·관리 화면(React). 디자인은 SWITCH 디자인 시스템(`web/src/ui`)을 씁니다.
- `sheet_script.gs` 구글 시트에 신청 내용을 받는 Apps Script 웹 앱.

## 실행과 배포

화면을 고친 뒤에는 `cd web && npm run build` 로 `web/dist` 를 다시 만듭니다.

```sh
python3 council.py              # 127.0.0.1:8792
python3 test_council.py         # 자체검사 (임시 DB)
./deploy.sh                     # main 에서 받아 서버를 다시 켜고 응답을 확인
```

처음 올릴 때는 `council.service` 를 systemd 에 등록하고, nginx 가 `/council/` 를 벗겨서 8792 로 넘기게 합니다.

```sh
sudo cp council.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now council
# nginx: /etc/nginx/sites-available/yeobaek 의 cli 블록 아래에 (백업 먼저)
#   location = /council { return 301 /council/; }
#   location /council/ {
#       proxy_pass http://127.0.0.1:8792/;
#       proxy_http_version 1.1;
#       proxy_set_header Host $host;
#       proxy_set_header X-Real-IP $remote_addr;
#       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
#       proxy_set_header X-Forwarded-Proto $scheme;
#   }
sudo nginx -t && sudo systemctl reload nginx
```

최고 관리자는 웹에서 가입한 뒤 `python3 council.py super <아이디>` 로 지정합니다.

## 설정 (`council.env`)

`council.env` 는 `chmod 600` 으로 두고 커밋이나 공유를 하지 않습니다. 고친 뒤에는 `sudo systemctl restart council` 을 합니다.

```
SMTP_HOST=smtp.naver.com
SMTP_USER=보내는주소@naver.com
SMTP_PASS=앱 비밀번호
```

- 메일은 외부 SMTP(465 SSL)로 보냅니다. OCI 가 나가는 25번을 막고 duckdns 는 MX/SPF/DKIM 을 못 걸어서 자체 메일서버는 쓸 수 없습니다.
- 설정이 없으면 비밀번호 찾기 화면에 "메일 발송이 아직 설정되지 않았습니다" 가 뜹니다. 발송에 실패하면 `journalctl -u council` 에 `mail to … failed` 가 남습니다.

## 알아 둘 점

**QR**: 내용은 `https://sqhsxp.duckdns.org/council/q/<4자 코드>` 입니다. 서버가 `../#/q/<코드>` 로 돌려보내고, 페이지가 `POST api/scan` 으로 대여·반납을 합니다. GET 으로 상태를 바꾸면 메신저 링크 미리보기가 물건을 빌려 버리기 때문입니다. 결과 화면은 주소에서 코드를 지워서, 새로고침해도 반납되지 않습니다. PDF 의 QR 은 벡터라 해상도가 없고, 둘레 4칸 여백이 들어갑니다. 한글 라벨은 PDF 표준 한글 폰트(HYGoThic-Medium)를 임베드 없이 쓰므로, 라벨이 깨지는 뷰어가 있으면 폰트 임베드로 바꿔야 합니다.

**비밀번호**: PBKDF2-SHA256 으로 계정마다 다른 salt 를 써서 저장합니다. 재설정하면 그 계정의 다른 로그인은 전부 끊깁니다. 찾기는 가입 여부와 상관없이 같은 답을 하고, 같은 계정이 2분 안에 다시 요청하면 무시합니다.

**디자인 토큰**: `web/design/tokens.json` 이 바뀌면 `cd web && npm run tokens` 로 `web/src/ui/tokens.css` 를 다시 만듭니다.
