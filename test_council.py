"""자체검사: python3 test_council.py — 임시 DB 로 서버를 띄워 핵심 흐름을 확인한다."""
import json
import os
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

# 최고 관리자만 관리자 지정, super 는 못 내린다
uid = {u["username"]: u["id"] for u in a.call("/api/admin/users")[1]["users"]}
assert a.call("/api/admin/role", {"id": uid["bob"], "role": "admin"})[0] == 200
assert b.call("/api/admin/items")[0] == 200 and b.call("/api/admin/users")[0] == 403
a.call("/api/admin/role", {"id": uid["alice"], "role": "user"})
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
