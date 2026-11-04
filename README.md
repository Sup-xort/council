# SWITCH — 반도체융합공학과 학생회 홈페이지 (데모)

`https://sqhsxp.duckdns.org/council/` · systemd `council` · 127.0.0.1:8792 · nginx 가 `/council/` 를 벗겨 넘긴다.

- `council.py` 서버·API·QR PDF 생성. 표준 라이브러리 + `vendor/segno` (QR 매트릭스, segno 1.6.6, BSD — 서버에 pip 이 없어 wheel 을 풀어 둠)
- `index.html` 화면 전부 (모바일·아이패드 우선, 해시 라우팅, 상대경로만 씀)
- `data/council.db` sqlite. 지우면 전부 사라진다
- `python3 test_council.py` 자체검사 (임시 DB)

## 처음 배포

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

## 최고 관리자

웹에서 가입한 뒤 `python3 council.py super <아이디>`. 최고 관리자는 관리 → 관리자 탭에서 다른 사람을 관리자로 지정·해제한다.

## QR

내용은 `https://sqhsxp.duckdns.org/council/q/<4자 코드>` (QR 버전 3, 29×29, 오류정정 M). 기본 카메라로 찍으면
서버가 `../#/q/<코드>` 로 돌려보내고 페이지가 `POST api/scan` 으로 대여/반납한다 — GET 으로 상태를 바꾸면
메신저 링크 미리보기가 물건을 빌려 버린다. 결과 화면은 주소에서 코드를 지운다 (새로고침하면 반납되는 걸 막음).

PDF 의 QR 은 벡터 사각형이라 해상도가 없다. 기본 2cm(모듈 0.69mm), 1.5~4cm 선택. 둘레 4모듈 여백 포함.
한글 라벨은 PDF 표준 한글 폰트(HYGoThic-Medium)를 임베드 없이 쓴다 — 대부분 뷰어가 대체 폰트로 그리지만,
라벨이 깨지는 뷰어가 있으면 폰트 임베드로 바꿔야 한다 (QR 은 영향 없음).

## 로그인 유지

쿠키 `scene_sid` (HttpOnly·Secure·SameSite=Lax, Path=/council/), 90일. 앱을 열 때마다(`api/me`) 다시 90일로 늘어난다.

## 비밀번호 · 찾기

비밀번호는 PBKDF2-SHA256(계정마다 salt, 20만 회)으로만 저장한다. 찾기는 `POST api/forgot {email}` →
그 이메일의 계정마다 아이디 + 재설정 링크(`#/reset/<토큰>`, 30분, 한 번만)를 메일로 보낸다. 가입 여부와 상관없이
같은 답을 하고, 같은 계정 2분 안 재요청은 무시한다. 재설정하면 그 계정의 다른 로그인은 전부 끊긴다.

메일은 외부 SMTP(465 SSL)로 보낸다 — OCI 가 나가는 25번을 막고 duckdns 는 MX/SPF/DKIM 을 못 걸어서 자체 메일서버는 안 된다.
`council.env` (chmod 600, 커밋·공유 금지) 에 쓰고 `sudo systemctl restart council`:

```
SMTP_HOST=smtp.naver.com
SMTP_USER=보내는주소@naver.com
SMTP_PASS=앱 비밀번호
```

없으면 찾기 화면이 "메일 발송이 아직 설정되지 않았습니다" 를 띄운다. 발송 실패는 `journalctl -u council` 에 `mail to … failed`.
