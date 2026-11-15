"""자체검사: python3 test_council.py — 임시 DB 로 서버를 띄워 핵심 흐름을 확인한다."""
import json
import os
import re
import subprocess
import tempfile
import threading
from datetime import timedelta
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError

os.environ["COUNCIL_DB"] = os.path.join(tempfile.mkdtemp(), "t.db")
import council  # noqa: E402

council.init_db()
council.SCE_EVERY = 0
srv = ThreadingHTTPServer(("127.0.0.1", 0), council.H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_port}"


class Client:
    def __init__(self):
        self.cookie = ""

    def call(self, path, body=None, raw=False):
        req = Request(URL + path, data=None if body is None else json.dumps(body).encode(),
                      headers={"Content-Type": "application/json", "Cookie": self.cookie})
        try:
            r = urlopen(req)
        except HTTPError as e:
            return e.code, json.loads(e.read())
        if sc := r.headers.get("Set-Cookie"):
            self.cookie = sc.split(";")[0]
        data = r.read()
        return r.status, data if raw else json.loads(data)


def signup(name, sid):
    c = Client()
    st, d = c.call("/api/signup", {"username": name, "password": "secret1", "name": name, "student_id": sid, "email": f"{name}@x.kr"})
    assert st == 200, d
    return c


a, b = signup("alice", "2024001"), signup("bob", "2024002")
assert a.call("/api/signup", {"username": "alice", "password": "secret1", "name": "a", "student_id": "1", "email": "a@x.kr"})[0] == 409
assert Client().call("/api/login", {"username": "alice", "password": "nope"})[0] == 401
assert Client().call("/api/signup", {"username": "dave", "password": "Pw1234!", "name": "Pw1234!", "student_id": "1", "email": "d@x.kr"})[0] == 400
assert Client().call("/api/scan", {"code": "abcd"})[0] == 401
assert a.call("/api/me")[1]["user"]["name"] == "alice"

# 관리자 권한: 일반 사용자는 막히고, super 명령 후 열린다
assert a.call("/api/admin/items")[0] == 403
subprocess.run(["python3", council.__file__, "super", "alice"], check=True, env=os.environ, capture_output=True)
assert a.call("/api/admin/item_add", {"kind": "우산", "count": 3})[0] == 200
assert a.call("/api/admin/item_add", {"kind": "우산", "count": 0})[0] == 400
assert a.call("/api/admin/item_add", {"kind": "우산", "count": 2})[0] == 200
assert [i["name"] for i in a.call("/api/items")[1]["items"]] == [f"우산 {n}번" for n in range(1, 6)]
item = a.call("/api/admin/items")[1]["items"][0]

# QR 스캔 3갈래
assert b.call("/api/scan", {"code": item["code"]})[1]["result"] == "borrowed"
assert a.call("/api/scan", {"code": item["code"]})[1]["result"] == "in_use"
assert a.call("/api/admin/items")[1]["items"][0]["who"] == "bob"
assert b.call("/api/scan", {"code": item["code"]})[1]["result"] == "returned"
assert a.call("/api/admin/items")[1]["loans"][0]["in_at"]

# 대여 기록은 전부 (관리 탭의 최근 50건 제한 없음)
for _ in range(30):
    b.call("/api/scan", {"code": item["code"]}); b.call("/api/scan", {"code": item["code"]})
assert b.call("/api/admin/loans")[0] == 403
loans = a.call("/api/admin/loans")[1]["loans"]
assert len(loans) == 31 and loans[0]["who"] == "bob" and loans[0]["student_id"] == "2024002" and loans[0]["kind"] == "우산"

# 관리 사이트 파일
for path in ("/admin", "/"):
    page = urlopen(URL + path).read().decode()
    for asset in re.findall(r'(?:src|href)="\./(assets/[^"]+)"', page):
        assert urlopen(URL + "/" + asset).status == 200, asset
assert urlopen(URL + "/next/").url.rstrip("/") == URL     # 예전 미리 보기 주소는 원래 주소로

# /q/<code> 는 상태를 안 바꾸고 페이지로 돌려보낸다
st = urlopen(Request(URL + "/q/" + item["code"], method="HEAD")).status
assert st == 200  # 302 를 따라가 index.html

# QR PDF
st, pdf = a.call(f"/api/admin/qr.pdf?size=2&ids={item['id']}", raw=True)
assert st == 200 and pdf.startswith(b"%PDF") and pdf.rstrip().endswith(b"%%EOF")
assert a.call(f"/api/admin/qr.pdf?size=9&ids={item['id']}")[0] == 400

# 예약: 겹치면 거부, 남의 예약은 못 지운다
tomorrow = (council.now() + timedelta(days=1)).date().isoformat()
assert b.call("/api/reserve", {"room_id": 1, "date": tomorrow, "hours": [10, 11]})[0] == 200
assert a.call("/api/reserve", {"room_id": 1, "date": tomorrow, "hours": [11, 12]})[0] == 409
assert a.call("/api/reserve", {"room_id": 2, "date": tomorrow, "hours": [11]})[0] == 200
assert a.call("/api/reserve", {"room_id": 1, "date": "2020-01-01", "hours": [11]})[0] == 400
w = b.call(f"/api/week?start={tomorrow}")[1]
assert {r["who"] for r in w["reservations"]} == {"b*b", "a***e"}, w["reservations"]
rid = b.call("/api/my_reservations")[1]["reservations"][0]["id"]
nb = Client()
nb.cookie = signup("carol", "2024003").cookie
nb.call("/api/unreserve", {"id": rid})
assert len(b.call("/api/my_reservations")[1]["reservations"]) == 2

# 시간표는 고른 날부터 7일 (월요일로 맞추지 않는다)
wed = "2026-11-11"
assert council.date.fromisoformat(wed).weekday() == 2 and b.call(f"/api/week?start={wed}")[1]["start"] == wed
assert Client().call("/api/week")[1]["start"] == council.now().date().isoformat()

# 예약 기록: 관리자만, 이어진 시간은 한 묶음, 묶음을 한 번에 취소
assert b.call("/api/admin/reservations")[0] == 403
rs = a.call("/api/admin/reservations")[1]["reservations"]
bob_r = [r for r in rs if r["who"] == "bob"]
assert len(bob_r) == 1 and (bob_r[0]["start"], bob_r[0]["end"]) == (10, 12) and len(bob_r[0]["ids"]) == 2, rs
assert bob_r[0]["created_at"] and bob_r[0]["student_id"] == "2024002"
assert b.call("/api/unreserve", {"ids": "x"})[0] == 400
assert a.call("/api/unreserve", {"ids": bob_r[0]["ids"]})[0] == 200
assert b.call("/api/my_reservations")[1]["reservations"] == []

# 세미나실 규칙: 주 최대 시간·취소 가능 시간
dd0 = council.now().date() + timedelta(days=8)
dd0 += timedelta(days=(2 - dd0.weekday()) % 7)
wd, wd2 = dd0.isoformat(), (dd0 + timedelta(days=1)).isoformat()
assert b.call("/api/admin/room_rules")[0] == 403 and b.call("/api/admin/room_rules", {"week_hours": 2})[0] == 403
assert a.call("/api/admin/room_rules")[1] == {"week_hours": 0, "cancel_hours": 0}
assert a.call("/api/admin/room_rules", {"week_hours": "x"})[0] == 400
assert a.call("/api/admin/room_rules", {"week_hours": 2, "cancel_hours": 3})[1] == {"week_hours": 2, "cancel_hours": 3}
assert b.call("/api/reserve", {"room_id": 1, "date": wd, "hours": [9, 10, 11]})[0] == 400      # 3/2
assert b.call("/api/reserve", {"room_id": 1, "date": wd, "hours": [9]})[0] == 200
assert b.call("/api/reserve", {"room_id": 1, "date": wd2, "hours": [9, 10]})[0] == 400         # 같은 주 합산 3/2
assert b.call("/api/reserve", {"room_id": 1, "date": wd2, "hours": [9]})[0] == 200
assert b.call("/api/reserve", {"room_id": 2, "date": wd, "hours": [20]})[0] == 400
assert a.call("/api/reserve", {"room_id": 2, "date": wd, "hours": [20, 21, 22]})[0] == 200      # 관리자는 제한 없음
assert b.call(f"/api/week?start={wd}")[1]["rules"]["week_hours"] == 2
mine_ids = [r["id"] for r in b.call("/api/my_reservations")[1]["reservations"]]
assert b.call("/api/unreserve", {"ids": mine_ids})[0] == 200                                    # 멀리 남아 취소 가능
soon = council.now() + timedelta(hours=1)
assert b.call("/api/reserve", {"room_id": 1, "date": soon.date().isoformat(), "hours": [soon.hour]})[0] in (200, 400)
if b.call("/api/my_reservations")[1]["reservations"]:
    r = b.call("/api/my_reservations")[1]["reservations"][0]
    assert b.call("/api/unreserve", {"ids": [r["id"]]})[0] == 400                               # 3시간 안이라 취소 불가
assert a.call("/api/admin/room_rules", {"week_hours": 0, "cancel_hours": 0})[0] == 200
for r in a.call("/api/admin/reservations")[1]["reservations"]:
    a.call("/api/unreserve", {"ids": r["ids"]})

# 행사: 필수 항목 검사, 마감 전 수정, 마감 후 거부
fields = [{"label": "사이즈", "type": "select", "options": ["S", "M"], "required": True},
          {"label": "참석", "type": "checkbox"}]
future = (council.now() + timedelta(days=3)).isoformat(timespec="minutes")
assert a.call("/api/admin/event_save", {"title": "간식 배부", "deadline": future, "on_lobby": True, "fields": fields})[0] == 200
eid = b.call("/api/events")[1]["events"][0]["id"]
assert b.call("/api/apply", {"event_id": eid, "answers": {"0": ""}})[0] == 400
assert b.call("/api/apply", {"event_id": eid, "answers": {"0": "XL"}})[0] == 400
assert b.call("/api/apply", {"event_id": eid, "answers": {"0": "S", "1": True}})[0] == 200
assert b.call("/api/apply", {"event_id": eid, "answers": {"0": "M"}})[0] == 200
assert b.call(f"/api/event?id={eid}")[1]["application"]["answers"] == {"0": "M", "1": False}
mf = [{"label": "메뉴", "type": "multi", "options": ["A", "B", "C"], "required": True}]
assert a.call("/api/admin/event_save", {"title": "복수 선택", "deadline": future, "on_lobby": False, "fields": mf})[0] == 200
mid = next(e["id"] for e in a.call("/api/admin/events")[1]["events"] if e["title"] == "복수 선택")
assert b.call("/api/apply", {"event_id": mid, "answers": {"0": []}})[0] == 400
assert b.call("/api/apply", {"event_id": mid, "answers": {"0": ["D"]}})[0] == 400
assert b.call("/api/apply", {"event_id": mid, "answers": {"0": ["C", "A", "A"]}})[0] == 200
assert b.call(f"/api/event?id={mid}")[1]["application"]["answers"] == {"0": ["A", "C"]}
lf = [{"label": "의견", "type": "long"}, {"label": "학년", "type": "dropdown", "options": ["1", "2"], "required": True}]
assert a.call("/api/admin/event_save", {"title": "긴 글", "deadline": future, "on_lobby": False, "fields": lf})[0] == 200
lid = next(e["id"] for e in a.call("/api/admin/events")[1]["events"] if e["title"] == "긴 글")
assert b.call("/api/apply", {"event_id": lid, "answers": {"0": "가\n나" * 500, "1": "3"}})[0] == 400
assert b.call("/api/apply", {"event_id": lid, "answers": {"0": "가\n나" * 500, "1": "2"}})[0] == 200
assert a.call("/api/admin/event_save", {"title": "복수 선택", "id": mid, "deadline": future, "on_lobby": False, "fields": [{"label": "x", "type": "multi", "options": []}]})[0] == 400
apps = a.call(f"/api/admin/applications?id={eid}")[1]["applications"]
assert len(apps) == 1 and apps[0]["answers"]["0"] == "M"
past = (council.now() - timedelta(minutes=1)).isoformat(timespec="minutes")
a.call("/api/admin/event_save", {"id": eid, "title": "간식 배부", "deadline": past, "on_lobby": True, "fields": fields})
assert b.call("/api/apply", {"event_id": eid, "answers": {"0": "S"}})[0] == 403

# 접근 규칙: 비로그인은 배너·행사 공지·배너에 오른 학과 공지만
anon = Client()
assert anon.call("/api/week")[0] == 200 and anon.call("/api/events")[0] == 200
for path in (f"/api/event?id={eid}", "/api/items", "/api/notices?kind=dept"):
    assert anon.call(path)[0] == 401, path

# 공지: 칩 검증, 분류별 공개 범위
def nsave(**kw):
    body = {"kind": "dept", "title": "t", "chips": [], **kw}
    return a.call("/api/admin/notice_save", body)
assert nsave(chips=[{"label": "x", "type": "tab", "target": "nope"}])[0] == 400
assert nsave(chips=[{"label": "x", "type": "url", "target": "javascript:alert(1)"}])[0] == 400
assert nsave(chips=[{"label": "x", "type": "event", "target": "9999"}])[0] == 400
assert b.call("/api/admin/notice_save", {"kind": "dept", "title": "t"})[0] == 403
assert nsave(title="수강정정", body="비공개 본문")[0] == 200
assert nsave(title="학과 배너", body="배너 본문", on_lobby=True,
             chips=[{"label": "예약하기", "type": "tab", "target": "reserve"},
                    {"label": "신청", "type": "event", "target": str(eid)}], event_id=eid)[0] == 200
assert nsave(kind="event", title="MT 공지", body="행사 본문")[0] == 200
ids = {n["title"]: n["id"] for n in a.call("/api/admin/notices")[1]["notices"]}
assert [n["title"] for n in anon.call("/api/notices")[1]["notices"]] == ["MT 공지"]
assert anon.call(f"/api/notice?id={ids['수강정정']}")[0] == 401
assert anon.call("/api/notice?id=9999")[0] == 401
st, d = anon.call(f"/api/notice?id={ids['학과 배너']}")
assert st == 200 and d["notice"]["body"] == "배너 본문" and d["notice"]["chips"][1]["type"] == "event"
assert d["notice"]["event"]["capacity"] is None and d["notice"]["event"]["n"] == 1     # 게이지는 비로그인도
assert d["prev"] is None or d["prev"]["title"] != "수강정정"                            # 이전 글에도 막힌 글이 안 샌다
assert len(b.call("/api/notices")[1]["notices"]) == 3
bn = anon.call("/api/banners")[1]["banners"]
assert [x["title"] for x in bn] == ["학과 배너"]       # 마감된 행사는 배너에서 빠진다

# 정원: 무제한 / 찼을 때 거절 / 기존 신청자 수정은 허용 / 인원 숨김
ev = {"title": "MT", "deadline": future, "on_lobby": True, "fields": []}
assert a.call("/api/admin/event_save", {**ev, "capacity": "abc"})[0] == 400
assert a.call("/api/admin/event_save", {**ev, "capacity": 1})[0] == 200
assert a.call("/api/admin/event_save", {**ev, "title": "무제한"})[0] == 200
evs = {e["title"]: e for e in a.call("/api/admin/events")[1]["events"]}
assert evs["MT"]["capacity"] == 1 and evs["무제한"]["capacity"] is None
mt, free = evs["MT"]["id"], evs["무제한"]["id"]
assert b.call("/api/apply", {"event_id": mt, "answers": {}})[0] == 200
assert a.call("/api/apply", {"event_id": mt, "answers": {}})[0] == 409
assert b.call("/api/apply", {"event_id": mt, "answers": {}})[0] == 200
assert b.call(f"/api/event?id={mt}")[1]["gauge"]["full"]
assert a.call("/api/apply", {"event_id": free, "answers": {}})[0] == 200
assert a.call("/api/admin/event_save", {**ev, "id": mt, "capacity": 1, "show_count": False})[0] == 200
g = b.call(f"/api/event?id={mt}")[1]["gauge"]
assert g["n"] is None and g["full"]                                         # 숨겨도 마감 여부는 안다
assert {e["id"]: e["n"] for e in a.call("/api/admin/events")[1]["events"]}[mt] == 1   # 관리자는 실제 수

# 붙여 넣은 글의 보이지 않는 문자는 저장할 때 지운다
assert nsave(title="\u200b붙여넣기", body="\u200b# 제목\n\n\u200b- 목록\ufeff")[0] == 200
pasted = [n for n in a.call("/api/admin/notices")[1]["notices"] if n["title"] == "붙여넣기"][0]
assert a.call(f"/api/admin/notice?id={pasted['id']}")[1]["notice"]["body"] == "# 제목\n\n- 목록"


def upload(cl, data, ctype="image/png"):
    req = Request(URL + "/api/admin/upload", data=data, headers={"Content-Type": ctype, "Cookie": cl.cookie})
    try:
        r = urlopen(req)
        return r.status, json.loads(r.read())
    except HTTPError as e:
        return e.code, json.loads(e.read())


# 그림 올리기: 관리자만, 그림 서명 검사, 5MB 제한, 같은 그림은 같은 주소
png = b"\x89PNG\r\n\x1a\n" + os.urandom(64)
assert upload(nb, png)[0] == 403
assert upload(a, b"<svg onload=alert(1)>", "image/svg+xml")[0] == 400
assert upload(a, b"\xff\xd8\xff" + b"0" * (5 * 1024 * 1024))[0] == 413
st, d = upload(a, png)
assert st == 200 and d["url"].startswith("img/") and d["url"].endswith(".png")
assert upload(a, png)[1]["url"] == d["url"]
r = urlopen(URL + "/" + d["url"])
assert r.read() == png and r.headers["Content-Type"] == "image/png" and r.headers["X-Content-Type-Options"] == "nosniff"
for bad in ("/img/../council.db", "/img/zzzz.png", "/img/0123456789abcdef.png"):
    try:
        urlopen(URL + bad); raise AssertionError(bad)
    except HTTPError as e:
        assert e.code == 404, bad

# 학생회비: 관리자가 표시하고, '납부자만' 행사는 낸 학생만 새로 신청한다
st, d = Client().call("/api/signup", {"username": "erin", "password": "secret1", "name": "", "student_id": "1", "email": "e@x.kr"})
assert st == 400 and d["error"] == "이름을 입력해 주십시오", d                      # 키 이름(name) 대신 우리말, 조사도 맞게
assert council.josa("학번", "을", "를") == "학번을" and council.josa("아이디", "을", "를") == "아이디를"
dues_ev = {"title": "납부자 행사", "deadline": future, "on_lobby": True, "fields": [], "dues_only": True}
assert a.call("/api/admin/event_save", dues_ev)[0] == 200
de = [e for e in a.call("/api/admin/events")[1]["events"] if e["title"] == "납부자 행사"][0]
assert de["dues_only"] is True
erin = signup("erin", "2024009")
st, d = erin.call("/api/apply", {"event_id": de["id"], "answers": {}})
assert st == 403 and "학생회비" in d["error"]
assert erin.call("/api/me")[1]["user"]["dues"] is False
uids = {u["username"]: u["id"] for u in a.call("/api/admin/users")[1]["users"]}
assert nb.call("/api/admin/dues", {"ids": [uids["erin"]], "dues": True})[0] == 403
assert a.call("/api/admin/dues", {"ids": [], "dues": True})[0] == 400
assert a.call("/api/admin/dues", {"ids": [uids["erin"]], "dues": True})[0] == 200
assert erin.call("/api/me")[1]["user"]["dues"] is True
assert erin.call("/api/apply", {"event_id": de["id"], "answers": {}})[0] == 200
a.call("/api/admin/dues", {"ids": [uids["erin"]], "dues": False})
assert erin.call("/api/apply", {"event_id": de["id"], "answers": {}})[0] == 200      # 이미 신청한 사람은 고칠 수 있다
# 표에서 바로 고치기: 납부 체크·이름 수정, 틀린 값이 하나라도 있으면 전부 취소
assert nb.call("/api/admin/cells", {"table": "users", "rows": [{"id": uids["erin"], "vals": {"dues": True}}]})[0] == 403
assert a.call("/api/admin/cells", {"table": "users", "rows": [{"id": uids["erin"], "vals": {"dues": True, "name": "에린2"}}]})[0] == 200
assert erin.call("/api/me")[1]["user"]["dues"] is True
assert a.call("/api/admin/cells", {"table": "users", "rows": [{"id": uids["erin"], "vals": {"dues": False}}, {"id": uids["erin"], "vals": {"email": "틀림"}}]})[0] == 400
assert erin.call("/api/me")[1]["user"]["dues"] is True
assert a.call("/api/admin/cells", {"table": "nope", "rows": [{"id": 1, "vals": {"x": 1}}]})[0] == 400
a.call("/api/admin/cells", {"table": "users", "rows": [{"id": uids["erin"], "vals": {"dues": False}}]})
ap0 = a.call(f"/api/admin/applications?id={de['id']}")[1]["applications"][0]
assert ap0["id"] and ap0["user_id"] == uids["erin"]
assert a.call("/api/admin/cells", {"table": "apps", "rows": [{"id": ap0["id"], "vals": {"dues": True}}]})[0] == 200
assert erin.call("/api/me")[1]["user"]["dues"] is True
assert a.call("/api/admin/cells", {"table": "apps", "rows": [{"id": ap0["id"], "vals": {"f9": "x"}}]})[0] == 400
assert a.call("/api/admin/cells", {"table": "apps", "rows": [{"id": 99999, "vals": {"dues": False}}]})[0] == 404
a.call("/api/admin/cells", {"table": "users", "rows": [{"id": uids["erin"], "vals": {"dues": False}}]})
ap = a.call(f"/api/admin/applications?id={de['id']}")[1]["applications"][0]
assert ap["created_at"] and ap["dues"] == 0

# 최고 관리자만 관리자 지정, super 는 못 내린다
uid = {u["username"]: u["id"] for u in a.call("/api/admin/users")[1]["users"]}
assert a.call("/api/admin/role", {"id": uid["bob"], "role": "admin"})[0] == 200
assert b.call("/api/admin/items")[0] == 200 and b.call("/api/admin/users")[0] == 200     # 관리자는 회원 목록을 읽는다
assert b.call("/api/admin/role", {"id": uid["carol"], "role": "admin"})[0] == 403        # 지정은 최고 관리자만
assert "created_at" in a.call("/api/admin/users")[1]["users"][0]
a.call("/api/admin/role", {"id": uid["alice"], "role": "user"})
assert a.call("/api/me")[1]["user"]["role"] == "super"

# 최고 관리자 넘기기: 비밀번호 확인, 관리자도 못 함, 넘기면 나는 관리자
assert b.call("/api/admin/handover", {"id": uid["carol"], "password": "x"})[0] == 403
assert a.call("/api/admin/handover", {"id": uid["bob"], "password": "wrong-pw"})[0] == 400
assert a.call("/api/admin/handover", {"id": uid["alice"], "password": "secret1"})[0] == 400      # 나에게는 못 넘김
assert a.call("/api/admin/handover", {"id": 99999, "password": "secret1"})[0] == 400
assert a.call("/api/admin/handover", {"id": uid["bob"], "password": "secret1"})[0] == 200
assert a.call("/api/me")[1]["user"]["role"] == "admin" and b.call("/api/me")[1]["user"]["role"] == "super"
assert a.call("/api/admin/role", {"id": uid["carol"], "role": "admin"})[0] == 403         # 이제 앨리스는 지정 못 함
assert b.call("/api/admin/handover", {"id": uid["alice"], "password": "secret1"})[0] == 200      # 다시 돌려받음
assert a.call("/api/me")[1]["user"]["role"] == "super"

# 아이디·비밀번호 찾기: 메일은 가로채서 본다
assert Client().call("/api/forgot", {"email": "bob@x.kr"})[0] == 503        # SMTP 미설정
os.environ["SMTP_HOST"] = "test"
sent = []
council.mail_later = lambda to, subj, body: sent.append((to, body))
assert Client().call("/api/forgot", {"email": "nobody@x.kr"}) == (200, {"ok": True}) and not sent
assert Client().call("/api/forgot", {"email": "BOB@x.kr"})[0] == 200 and sent[0][0] == "bob@x.kr" and "bob" in sent[0][1]
Client().call("/api/forgot", {"email": "bob@x.kr"})
assert len(sent) == 1                                                          # 2분 안 재요청은 무시
tok = sent[0][1].split("#/reset/")[1].split()[0]
assert Client().call("/api/reset", {"token": "x", "password": "newpass1"})[0] == 400
assert Client().call("/api/reset", {"token": tok, "password": "123"})[0] == 400
c = Client()
assert c.call("/api/reset", {"token": tok, "password": "newpass1"})[1]["user"]["username"] == "bob"
assert b.call("/api/me")[1]["user"] is None                                    # 옛 세션은 끊긴다
assert Client().call("/api/reset", {"token": tok, "password": "again12"})[0] == 400   # 한 번만 쓴다
assert Client().call("/api/login", {"username": "bob", "password": "secret1"})[0] == 401
assert Client().call("/api/login", {"username": "bob", "password": "newpass1"})[0] == 200

assert a.call("/api/logout", {})[0] == 200 and a.call("/api/me")[1]["user"] is None
print("ok")


# 학과 홈페이지 공지 가져오기: 새 글만, 지워도 다시 안 들어옴
PAGE = """<ul class="mini-type01"><li><span class="mini-board-category"> 일반 </span>
<p class="mini-board-content-title"><a href="/sce/notice.do?mode=view&amp;articleNo=7">제목 &#40;가&#41;</a></p>
<span class="mini-board-date"> 2026-11-11 </span>
<p class="mini-board-content-inner"><a href="x"> 제목 &#40;가&#41; 안내 1. 신청 - 항목 * 주석 <b>굵게</b></a></p></li></ul>"""
arts = council.parse_sce(PAGE)
assert len(arts) == 1 and arts[0]["title"] == "제목 (가)" and arts[0]["body"].startswith("안내\n\n1. 신청\n- 항목\n- 주석")
assert arts[0]["url"].endswith("/sce/notice.do?mode=view&articleNo=7") and council.parse_sce("<p>없음</p>") == []
with council.connect() as c:
    assert council.import_sce(c, arts) == 1 and council.import_sce(c, arts) == 0
    c.execute("DELETE FROM notices WHERE title LIKE '%제목%'")
    assert council.import_sce(c, arts) == 0
    c.execute("DELETE FROM pulled")
    assert council.import_sce(c, arts) == 1
    n = c.execute("SELECT kind,title,created_at FROM notices WHERE title LIKE '%제목%'").fetchone()
    assert (n["kind"], n["title"], n["created_at"]) == ("dept", "[일반] 제목 (가)", "2026-11-11T00:00")
print("학과 공지 가져오기 OK")

# 종류별 대여 시간: 기본 48시간, 설정, 기한 지난 대여 구분, 이름을 바꿔도 따라감
a, b = Client(), Client()      # 앞 시험 끝에서 로그아웃·비밀번호 변경이 있었으니 다시 로그인
assert a.call("/api/login", {"username": "alice", "password": "secret1"})[0] == 200
assert b.call("/api/login", {"username": "bob", "password": "newpass1"})[0] == 200
assert nb.call("/api/admin/kind_hours", {"kind": "우산", "hours": 3})[0] == 403
assert a.call("/api/admin/kind_hours", {"kind": "없는종류", "hours": 3})[0] == 404
assert a.call("/api/admin/kind_hours", {"kind": "우산", "hours": 0})[0] == 400
assert a.call("/api/admin/kind_hours", {"kind": "우산", "hours": "x"})[0] == 400
it = a.call("/api/admin/items")[1]
assert it["default_hours"] == 48 and {r["kind"]: r["hours"] for r in it["rules"]} == {"우산": 48}      # 정하지 않으면 48시간
code, iid = it["items"][1]["code"], it["items"][1]["id"]
assert b.call("/api/scan", {"code": code})[1]["result"] == "borrowed"
mine = [i for i in b.call("/api/items")[1]["items"] if i["mine"]][0]
assert mine["due"] > council.stamp() and mine["due"][:10] >= (council.now() + timedelta(hours=47)).isoformat()[:10]   # 빌린 사람은 기한을 본다
assert all(i["due"] is None for i in a.call("/api/items")[1]["items"])          # 남의 기한은 안 보임
row = [l for l in a.call("/api/admin/loans")[1]["loans"] if not l["in_at"]][0]
assert row["late_hours"] == 0 and row["hours"] == 48 and row["due"]
def backdate(h):
    with council.connect() as c:
        old = (council.now() - timedelta(hours=h)).isoformat(timespec="minutes")
        c.execute("UPDATE loans SET out_at=? WHERE id=?", (old, row["id"]))
        c.execute("UPDATE items SET borrowed_at=? WHERE id=?", (old, row["item_id"]))
    return [l for l in a.call("/api/admin/loans")[1]["loans"] if l["id"] == row["id"]][0]
assert backdate(47)["late_hours"] == 0                                         # 47시간 → 아직 기한 안
l = backdate(50)
assert 1 <= l["late_hours"] <= 3 and l["item_id"]                              # 50시간 → 약 2시간 지남 (분 단위 올림)
assert 1 <= [i for i in a.call("/api/admin/items")[1]["items"] if i["who"]][0]["late_hours"] <= 3
assert a.call("/api/admin/kind_hours", {"kind": "우산", "hours": 72})[1]["hours"] == 72
assert backdate(50)["late_hours"] == 0                                         # 72시간으로 늘리면 기한 안
assert a.call("/api/admin/kind_hours", {"kind": "우산", "hours": 24})[1]["hours"] == 24
assert 25 <= backdate(50)["late_hours"] <= 27
a.call("/api/admin/cells", {"table": "items", "rows": [{"id": iid, "vals": {"kind": "장우산"}}]})
assert {r["kind"]: r["hours"] for r in a.call("/api/admin/items")[1]["rules"]}["장우산"] == 24   # 이름을 바꿔도 따라감
assert a.call("/api/admin/kind_hours", {"kind": "우산", "hours": ""})[1]["hours"] == 48          # 비우면 기본
assert all(l["late_hours"] == 0 for l in a.call("/api/admin/loans")[1]["loans"] if l["in_at"])   # 반납한 건 연체 아님
print("대여 시간 OK")

# 기록 포함 전체 수정: 대여 기록·예약 기록·물품·회원·행사·공지·신청
def cells(table, id, **vals):
    return a.call("/api/admin/cells", {"table": table, "rows": [{"id": id, "vals": vals}]})
users = {u["username"]: u for u in a.call("/api/admin/users")[1]["users"]}
lab = lambda n: f"{users[n]['name']} ({users[n]['student_id']})"
its = a.call("/api/admin/items")[1]["items"]
x, y = its[0], its[2]
# 대여 기록
assert b.call("/api/scan", {"code": x["code"]})[1]["result"] == "borrowed"
ln = [l for l in a.call("/api/admin/loans")[1]["loans"] if not l["in_at"]][0]
assert cells("loans", ln["id"], out_at="2026-01-01T09:00", in_at="2025-12-31T09:00")[0] == 400        # 반납이 대여보다 빠름
assert cells("loans", ln["id"], who="없는 (000)")[0] == 400 and cells("loans", ln["id"], item="없는 물품")[0] == 400
assert cells("loans", ln["id"], out_at="2026-01-01T09:00", in_at="2026-01-02T09:00")[0] == 200       # 반납 처리
assert not [i for i in a.call("/api/admin/items")[1]["items"] if i["id"] == ln["item_id"]][0]["who"]
assert cells("loans", ln["id"], in_at="", who=lab("alice"), item=y["name"])[0] == 200                # 다시 '빌려 간' 상태, 다른 사람·다른 물품
now_items = {i["id"]: i for i in a.call("/api/admin/items")[1]["items"]}
assert now_items[y["id"]]["who"] == "alice" and now_items[y["id"]]["borrowed_at"] == "2026-01-01T09:00" and not now_items[ln["item_id"]]["who"]
l2 = [l for l in a.call("/api/admin/loans")[1]["loans"] if l["id"] != ln["id"]][0]
assert cells("loans", l2["id"], in_at="", item=y["name"])[0] == 409                                    # 이미 빌려 간 물품
assert cells("loans", 99999, in_at="")[0] == 404
# 물품
assert cells("items", y["id"], num="1")[0] == 409                                                     # 번호 중복
assert cells("items", y["id"], code=x["code"])[0] == 409 and cells("items", y["id"], code="!!")[0] == 400
assert cells("items", y["id"], num="9", code="newc0de")[0] == 200
ni = [i for i in a.call("/api/admin/items")[1]["items"] if i["id"] == y["id"]][0]
assert ni["num"] == 9 and ni["code"] == "newc0de" and ni["name"].endswith("9번") and ni["who"] == "alice"
# 예약 기록
dd = (council.now().date() + timedelta(days=3)).isoformat()
rid = a.call("/api/reserve", {"date": dd, "room_id": 1, "hours": [10, 11, 12]})
rs = a.call("/api/admin/reservations")[1]; blk = [r for r in rs["reservations"] if r["date"] == dd][0]
assert rs["rooms"] and blk["start"] == 10 and blk["end"] == 13
assert cells("reservations", blk["id"], start="14시", end="13시")[0] == 400
assert cells("reservations", blk["id"], date=dd, start="14시", end="17시", room="세미나실 2", who=lab("bob"))[0] == 200
blk = [r for r in a.call("/api/admin/reservations")[1]["reservations"] if r["date"] == dd][0]
assert (blk["start"], blk["end"], blk["room"], blk["who"]) == (14, 17, "세미나실 2", "bob")
b.call("/api/reserve", {"date": dd, "room_id": 1, "hours": [9]})
assert cells("reservations", blk["id"], room="세미나실 1", start="9시")[0] == 409          # 다른 사람 예약과 겹침
assert cells("reservations", blk["id"], date="2026-13-45")[0] == 400
# 회원·행사·공지·신청
assert cells("users", users["bob"]["id"], username="alice")[0] == 409 and cells("users", users["bob"]["id"], username="a!")[0] == 400
assert cells("users", users["bob"]["id"], username="bob2", created_at="2026-03-01T10:00")[0] == 200
assert [u for u in a.call("/api/admin/users")[1]["users"] if u["id"] == users["bob"]["id"]][0]["username"] == "bob2"
ev0 = a.call("/api/admin/events")[1]["events"][0]
assert cells("events", ev0["id"], on_lobby=False, dues_only=True)[0] == 200
e1 = [e for e in a.call("/api/admin/events")[1]["events"] if e["id"] == ev0["id"]][0]
assert e1["on_lobby"] is False and e1["dues_only"] is True
nt = a.call("/api/admin/notices")[1]["notices"][0]
assert cells("notices", nt["id"], kind="x")[0] == 400 and cells("notices", nt["id"], created_at="")[0] == 400
assert cells("notices", nt["id"], kind="dept", summary="요약 고침", created_at="2026-02-02T08:00")[0] == 200
n1 = [n for n in a.call("/api/admin/notices")[1]["notices"] if n["id"] == nt["id"]][0]
assert n1["kind"] == "dept" and n1["summary"] == "요약 고침" and n1["created_at"] == "2026-02-02T08:00"
ap = a.call("/api/admin/applications")[1]["applications"]
if ap:
    assert cells("apps", ap[0]["id"], created_at="2026-02-03T09:00", updated_at="2026-02-04T09:00")[0] == 200
    assert a.call("/api/admin/applications")[1]["applications"][0]["created_at"] == "2026-02-03T09:00"
print("전체 수정 OK")

# 신청서는 질문·보기·답변이 각각 표의 행으로 저장된다 (한 칸에 묶지 않음). 질문 순서를 바꿔도 답은 질문을 따라간다.
dl = (council.now() + timedelta(days=5)).isoformat(timespec="minutes")
fields = [{"label": "사이즈", "type": "select", "required": True, "options": ["S", "M", "L"]},
          {"label": "메모", "type": "text", "required": False}, {"label": "동의", "type": "checkbox", "required": False},
          {"label": "간식", "type": "multi", "required": False, "options": ["빵", "음료", "과일"]}]
assert a.call("/api/admin/event_save", {"title": "정규화 시험", "deadline": dl, "fields": fields})[0] == 200
ev = [e for e in a.call("/api/admin/events")[1]["events"] if e["title"] == "정규화 시험"][0]
assert [f["label"] for f in ev["fields"]] == ["사이즈", "메모", "동의", "간식"] and all(isinstance(f["id"], int) for f in ev["fields"])
assert b.call("/api/apply", {"event_id": ev["id"], "answers": {"0": "M", "1": "안녕", "2": True, "3": ["음료", "빵"]}})[0] == 200
with council.connect() as c:
    rows = [tuple(r) for r in c.execute("""SELECT q.label, a.value FROM answers a JOIN questions q ON q.id=a.question_id WHERE q.event_id=? ORDER BY a.id""", (ev["id"],))]
    assert rows == [("사이즈", "M"), ("메모", "안녕"), ("동의", "1"), ("간식", "빵"), ("간식", "음료")], rows     # 질문마다 한 줄, 여러 개 고르기는 고른 보기마다 한 줄
    assert "answers" not in {r[1] for r in c.execute("PRAGMA table_info(applications)")} and "fields" not in {r[1] for r in c.execute("PRAGMA table_info(events)")}
mine = b.call(f"/api/event?id={ev['id']}")[1]["application"]["answers"]
assert mine == {"0": "M", "1": "안녕", "2": True, "3": ["빵", "음료"]}, mine
# 질문 순서를 바꾸고 새 질문을 끼워도 받아 둔 답은 그 질문을 따라간다
f = ev["fields"]
assert a.call("/api/admin/event_save", {"id": ev["id"], "title": "정규화 시험", "deadline": dl,
              "fields": [f[3], {"label": "새 질문", "type": "text"}, f[0], f[2]]})[0] == 200           # 메모(f[1])는 뺌
mine = b.call(f"/api/event?id={ev['id']}")[1]["application"]["answers"]
assert mine == {"0": ["빵", "음료"], "1": "", "2": "M", "3": True}, mine
# 보기에서 뺀 항목을 고른 답은 지워지고, 질문 종류를 바꾸면 옛 답이 지워진다
f = [e for e in a.call("/api/admin/events")[1]["events"] if e["id"] == ev["id"]][0]["fields"]
f[0] = dict(f[0], options=["과일", "음료"])
assert a.call("/api/admin/event_save", {"id": ev["id"], "title": "정규화 시험", "deadline": dl, "fields": f})[0] == 200
assert b.call(f"/api/event?id={ev['id']}")[1]["application"]["answers"]["0"] == ["음료"]
# 신청자 표 수정도 행으로 저장된다
app = a.call(f"/api/admin/applications?id={ev['id']}")[1]["applications"][0]
assert cells("apps", app["id"], f0=["과일", "음료"], f1="수정함")[0] == 200
assert a.call(f"/api/admin/applications?id={ev['id']}")[1]["applications"][0]["answers"]["0"] == ["과일", "음료"]
assert a.call(f"/api/admin/applications?id={ev['id']}")[1]["applications"][0]["answers"]["1"] == "수정함"
# 행사를 지우면 질문·보기·답이 함께 지워진다
a.call("/api/admin/event_del", {"id": ev["id"]})
with council.connect() as c:
    assert not c.execute("SELECT 1 FROM questions WHERE event_id=?", (ev["id"],)).fetchone()
    assert not c.execute("SELECT 1 FROM answers WHERE question_id NOT IN (SELECT id FROM questions)").fetchone()
print("신청서 정규화 OK")
# 같은 번호의 질문이 두 번 오면(복제) 새 질문으로 만든다
evs = a.call("/api/admin/event_save", {"title": "복제 시험", "deadline": dl, "fields": [{"label": "하나", "type": "text"}]})
ev2 = [e for e in a.call("/api/admin/events")[1]["events"] if e["title"] == "복제 시험"][0]
q0 = ev2["fields"][0]
a.call("/api/admin/event_save", {"id": ev2["id"], "title": "복제 시험", "deadline": dl, "fields": [q0, dict(q0, label="둘")]})
got = [e for e in a.call("/api/admin/events")[1]["events"] if e["id"] == ev2["id"]][0]["fields"]
assert [f["label"] for f in got] == ["하나", "둘"] and got[0]["id"] == q0["id"] and got[1]["id"] != q0["id"]
print("복제 OK")
