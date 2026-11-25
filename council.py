"""SWITCH — 반도체융합공학과 학생회 홈페이지 (데모).

물품 대여(QR), 세미나실 예약, 행사 신청, 관리자 페이지.

QR 내용은 {ORIGIN}/q/<코드>. 기본 카메라로 찍으면 /q/<코드> 로 들어오고,
서버는 ../#/q/<코드> 로 돌려보낸다 — 대여·반납은 페이지가 POST api/scan 으로 한다
(GET 으로 상태를 바꾸면 메신저 링크 미리보기가 물건을 빌려 버린다).

최고 관리자 지정: 웹에서 가입한 뒤 `python3 council.py super <아이디>`.
표준 라이브러리 + vendor/segno(QR 매트릭스)만 쓴다.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import sqlite3
import sys
import threading
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(BASE, "vendor"))
import segno  # noqa: E402

HOST, PORT = "127.0.0.1", int(os.environ.get("COUNCIL_PORT", 8792))
DB = os.environ.get("COUNCIL_DB", os.path.join(BASE, "data", "council.db"))
ORIGIN = os.environ.get("COUNCIL_ORIGIN", "https://sce-council.o-r.kr")
PREFIX = os.environ.get("COUNCIL_PREFIX", "/council")  # 루트에 호스팅하면 ""
QR_PREFIX = ORIGIN + PREFIX + "/q/"
KST = ZoneInfo("Asia/Seoul")

COOKIE = "scene_sid"
RESET_MIN = 30                         # 비밀번호 재설정 링크 유효시간
SESSION_DAYS = 400                     # 브라우저가 허용하는 쿠키 최대 수명 — 쓸 때마다 다시 400일이라 사실상 로그인이 풀리지 않는다
PBKDF2_ITER = 200_000
MAX_BODY = 256 * 1024
CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"   # 헷갈리는 0/o, 1/l/i 제외
QR_SIZES_CM = (1.5, 2, 2.5, 3, 4)
ROOMS = ("세미나실 1", "세미나실 2")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pw TEXT NOT NULL,
  name TEXT NOT NULL, student_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user');
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
  expires TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  borrower_id INTEGER REFERENCES users ON DELETE SET NULL, borrowed_at TEXT);
CREATE TABLE IF NOT EXISTS loans(id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, out_at TEXT NOT NULL, in_at TEXT);
CREATE TABLE IF NOT EXISTS rooms(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reservations(id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms,
  user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, date TEXT NOT NULL, hour INTEGER NOT NULL,
  UNIQUE(room_id, date, hour));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL DEFAULT '', deadline TEXT NOT NULL, on_lobby INTEGER NOT NULL DEFAULT 1,
  fields TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS applications(id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, answers TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(event_id, user_id));
CREATE TABLE IF NOT EXISTS notices(id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('dept','event')),
  title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', chips TEXT NOT NULL DEFAULT '[]',
  event_id INTEGER REFERENCES events ON DELETE SET NULL, on_lobby INTEGER NOT NULL DEFAULT 0,
  author_id INTEGER REFERENCES users ON DELETE SET NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS resets(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
  expires TEXT NOT NULL);
"""


class Err(Exception):
    def __init__(self, status, msg):
        self.status, self.msg = status, msg


def now():
    return datetime.now(KST).replace(tzinfo=None, microsecond=0)


def stamp():
    return now().isoformat(timespec="minutes")


def connect():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def init_db():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    with connect() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(SCHEMA)
        icols = {r[1] for r in c.execute("PRAGMA table_info(items)")}
        if "kind" not in icols:             # 물품 = 종류 + 번호 (우산 1번, 우산 2번). 옛 물품은 번호 없이 종류=이름
            c.execute("ALTER TABLE items ADD COLUMN kind TEXT")
            c.execute("ALTER TABLE items ADD COLUMN num INTEGER")
            c.execute("UPDATE items SET kind=name")
        cols = {r[1] for r in c.execute("PRAGMA table_info(events)")}
        if "capacity" not in cols:          # NULL = 정원 없음
            c.execute("ALTER TABLE events ADD COLUMN capacity INTEGER")
        if "show_count" not in cols:        # 0 이면 신청 인원을 화면에 내지 않는다
            c.execute("ALTER TABLE events ADD COLUMN show_count INTEGER NOT NULL DEFAULT 1")
        if not c.execute("SELECT 1 FROM rooms").fetchone():
            c.executemany("INSERT INTO rooms(name) VALUES(?)", [(r,) for r in ROOMS])


def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    return f"{salt}${hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), PBKDF2_ITER).hex()}"


def check_pw(pw, stored):
    salt = stored.split("$", 1)[0]
    return hmac.compare_digest(hash_pw(pw, salt), stored)


def tok_hash(tok):
    return hashlib.sha256(tok.encode()).hexdigest()


def mask(name):
    if len(name) <= 1:
        return name
    if len(name) == 2:
        return name[0] + "*"
    return name[0] + "*" * (len(name) - 2) + name[-1]


def s(body, key, maxlen=200, required=True):
    v = body.get(key, "")
    v = v.strip() if isinstance(v, str) else ""
    if required and not v:
        raise Err(400, f"{key} 를 입력하세요")
    if len(v) > maxlen:
        raise Err(400, f"{key} 가 너무 깁니다")
    return v


def parse_dt(v, what):
    try:
        return datetime.fromisoformat(v).replace(second=0, microsecond=0)
    except (TypeError, ValueError):
        raise Err(400, f"{what} 형식이 잘못됐습니다")


def user_out(u):
    return {k: u[k] for k in ("id", "username", "name", "student_id", "email", "role")}


# ── 인증 ────────────────────────────────────────────────────────────────

def signup(c, me, b, q):
    username = s(b, "username", 32)
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,32}", username):
        raise Err(400, "아이디는 영문·숫자로만 구성되어야 합니다.")
    pw = b.get("password") or ""
    if not isinstance(pw, str) or len(pw) < 6:
        raise Err(400, "비밀번호는 6자 이상")
    if pw in (s(b, "name", 40), b.get("student_id"), b.get("email")):   # 자동완성이 비밀번호를 다른 칸에 채운 경우
        raise Err(400, "이름·학번·이메일 칸에 비밀번호가 들어갔습니다. 확인해 주세요")
    email = s(b, "email", 120)
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise Err(400, "이메일 형식이 잘못됐습니다")
    try:
        cur = c.execute("INSERT INTO users(username,pw,name,student_id,email) VALUES(?,?,?,?,?)",
                        (username, hash_pw(pw), s(b, "name", 40), s(b, "student_id", 20), email))
    except sqlite3.IntegrityError:
        raise Err(409, "이미 있는 아이디입니다")
    return new_session(c, cur.lastrowid)


def login(c, me, b, q):
    u = c.execute("SELECT * FROM users WHERE username=?", (str(b.get("username", "")).strip(),)).fetchone()
    if not u or not check_pw(str(b.get("password", "")), u["pw"]):
        raise Err(401, "아이디 또는 비밀번호가 틀렸습니다")
    return new_session(c, u["id"])


def new_session(c, uid):
    tok = secrets.token_urlsafe(32)
    c.execute("DELETE FROM sessions WHERE expires < ?", (stamp(),))
    c.execute("INSERT INTO sessions VALUES(?,?,?)", (tok_hash(tok), uid, (now() + timedelta(days=SESSION_DAYS)).isoformat()))
    u = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return {"user": user_out(u)}, tok


def send_mail(to, subject, body):
    # SMTP_HOST·SMTP_USER·SMTP_PASS 는 council.env (systemd EnvironmentFile). 465 SSL 만 쓴다
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = f"SWITCH 학생회 <{os.environ['SMTP_USER']}>", to, subject
    m.set_content(body)
    with smtplib.SMTP_SSL(os.environ["SMTP_HOST"], 465, timeout=20) as s:
        s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"])
        s.send_message(m)


def mail_later(to, subject, body):
    # 응답을 기다리게 하지 않고, 걸린 시간·실패로 가입 여부가 드러나지 않게 따로 보낸다
    def run():
        try:
            send_mail(to, subject, body)
        except Exception as e:
            sys.stderr.write(f"mail to {to} failed: {e!r}\n")
    threading.Thread(target=run, daemon=True).start()


def forgot(c, me, b, q):
    """이메일로 아이디와 비밀번호 재설정 링크를 보낸다. 가입 여부와 상관없이 같은 답을 한다."""
    if not os.environ.get("SMTP_HOST"):
        raise Err(503, "메일 발송이 아직 설정되지 않았습니다. 학생회에 문의하세요")
    email = s(b, "email", 120)
    for u in c.execute("SELECT * FROM users WHERE lower(email)=lower(?)", (email,)).fetchall():
        # 같은 계정에 2분 안에 다시 요청하면 무시 — 남의 메일함에 폭탄 방지
        if c.execute("SELECT 1 FROM resets WHERE user_id=? AND expires > ?",
                     (u["id"], (now() + timedelta(minutes=RESET_MIN - 2)).isoformat())).fetchone():
            continue
        tok = secrets.token_urlsafe(32)
        c.execute("DELETE FROM resets WHERE user_id=? OR expires < ?", (u["id"], now().isoformat()))
        c.execute("INSERT INTO resets VALUES(?,?,?)",
                  (tok_hash(tok), u["id"], (now() + timedelta(minutes=RESET_MIN)).isoformat()))
        mail_later(u["email"], "[SWITCH] 아이디 / 비밀번호 찾기",
                   f"{u['name']} 님, 아이디는 {u['username']} 입니다.\n\n"
                   f"비밀번호를 바꾸려면 {RESET_MIN}분 안에 아래 링크를 여세요.\n"
                   f"{ORIGIN}{PREFIX}/#/reset/{tok}\n\n요청하지 않았다면 이 메일은 무시하셔도 됩니다.")
    return {"ok": True}


def reset(c, me, b, q):
    r = c.execute("SELECT user_id FROM resets WHERE token=? AND expires > ?",
                  (tok_hash(str(b.get("token", ""))), now().isoformat())).fetchone()
    if not r:
        raise Err(400, "링크가 만료됐거나 이미 쓰였습니다. 다시 요청하세요")
    pw = b.get("password") or ""
    if not isinstance(pw, str) or len(pw) < 6:
        raise Err(400, "비밀번호는 6자 이상")
    c.execute("UPDATE users SET pw=? WHERE id=?", (hash_pw(pw), r["user_id"]))
    c.execute("DELETE FROM resets WHERE user_id=?", (r["user_id"],))
    c.execute("DELETE FROM sessions WHERE user_id=?", (r["user_id"],))   # 다른 기기의 로그인은 끊는다
    return new_session(c, r["user_id"])


def logout(c, me, b, q):
    return {"ok": True}, ""


def get_me(c, me, b, q):
    return {"user": user_out(me) if me else None}


# ── 물품 / QR ────────────────────────────────────────────────────────────

def scan(c, me, b, q):
    it = c.execute("SELECT * FROM items WHERE code=?", (str(b.get("code", "")).lower(),)).fetchone()
    if not it:
        raise Err(404, "등록되지 않은 QR 입니다")
    t = stamp()
    # 조건부 UPDATE 하나로 처리 — 두 사람이 동시에 찍어도 한 명만 빌린다
    if c.execute("UPDATE items SET borrower_id=?, borrowed_at=? WHERE id=? AND borrower_id IS NULL",
                 (me["id"], t, it["id"])).rowcount:
        c.execute("INSERT INTO loans(item_id,user_id,out_at) VALUES(?,?,?)", (it["id"], me["id"], t))
        return {"result": "borrowed", "item": it["name"]}
    if c.execute("UPDATE items SET borrower_id=NULL, borrowed_at=NULL WHERE id=? AND borrower_id=?",
                 (it["id"], me["id"])).rowcount:
        c.execute("UPDATE loans SET in_at=? WHERE item_id=? AND user_id=? AND in_at IS NULL", (t, it["id"], me["id"]))
        return {"result": "returned", "item": it["name"]}
    return {"result": "in_use", "item": it["name"]}


def items(c, me, b, q):
    rows = c.execute("SELECT id, kind, num, name, borrower_id, borrowed_at FROM items ORDER BY kind, num, id").fetchall()
    return {"items": [{"id": r["id"], "kind": r["kind"], "num": r["num"], "name": r["name"], "available": r["borrower_id"] is None,
                       "mine": r["borrower_id"] == me["id"], "borrowed_at": r["borrowed_at"]} for r in rows]}


def admin_items(c, me, b, q):
    rows = c.execute("""SELECT i.id, i.code, i.kind, i.num, i.name, i.borrowed_at, u.name AS who, u.student_id
                        FROM items i LEFT JOIN users u ON u.id=i.borrower_id ORDER BY i.kind, i.num, i.id""").fetchall()
    loans = c.execute("""SELECT l.out_at, l.in_at, i.name AS item, u.name AS who, u.student_id
                         FROM loans l JOIN items i ON i.id=l.item_id JOIN users u ON u.id=l.user_id
                         ORDER BY l.id DESC LIMIT 50""").fetchall()
    return {"items": [dict(r) for r in rows], "loans": [dict(r) for r in loans], "qr_sizes": QR_SIZES_CM}


def admin_item_add(c, me, b, q):
    """종류와 개수만 받는다 — 우산 3개면 '우산 1번~3번'. 같은 종류를 또 추가하면 다음 번호부터 이어진다."""
    kind = s(b, "kind", 40)
    try:
        count = int(b.get("count", 1))
    except (TypeError, ValueError):
        raise Err(400, "개수는 숫자여야 합니다")
    if not 1 <= count <= 100:
        raise Err(400, "한 번에 1~100개까지 추가할 수 있습니다")
    last = c.execute("SELECT COALESCE(MAX(num), 0) FROM items WHERE kind=?", (kind,)).fetchone()[0]
    for num in range(last + 1, last + count + 1):
        for _ in range(20):
            code = "".join(secrets.choice(CODE_CHARS) for _ in range(4))
            try:
                c.execute("INSERT INTO items(code,kind,num,name) VALUES(?,?,?,?)", (code, kind, num, f"{kind} {num}번"))
                break
            except sqlite3.IntegrityError:
                continue
        else:
            raise Err(500, "코드 생성 실패")
    return {"ok": True, "added": count}


def admin_item_del(c, me, b, q):
    c.execute("DELETE FROM items WHERE id=?", (b.get("id"),))
    return {"ok": True}


def admin_item_return(c, me, b, q):
    c.execute("UPDATE loans SET in_at=? WHERE item_id=? AND in_at IS NULL", (stamp(), b.get("id")))
    c.execute("UPDATE items SET borrower_id=NULL, borrowed_at=NULL WHERE id=?", (b.get("id"),))
    return {"ok": True}


def admin_qr_pdf(c, me, b, q):
    try:
        size = float(q.get("size", ["2"])[0])
        ids = [int(x) for x in q.get("ids", [""])[0].split(",") if x]
    except ValueError:
        raise Err(400, "잘못된 요청")
    if size not in QR_SIZES_CM:
        raise Err(400, "지원하지 않는 크기")
    if not ids:
        raise Err(400, "물품을 고르세요")
    rows = c.execute(f"SELECT code, name FROM items WHERE id IN ({','.join('?' * len(ids))}) ORDER BY kind, num, id", ids).fetchall()
    if not rows:
        raise Err(400, "물품을 고르세요")
    return qr_pdf([(r["name"], r["code"]) for r in rows], size)


# ── QR PDF ──────────────────────────────────────────────────────────────
# 모듈을 벡터 사각형으로 그려서 해상도가 없다 — 1.5cm 에서도 프린터 해상도 그대로 선명하다.
# 한글 라벨은 PDF 표준 한글 폰트(HYGoThic-Medium)를 임베드 없이 쓴다 — 파일이 수 KB.

MM = 72 / 25.4


def utf16hex(t):
    return t.encode("utf-16-be").hex().upper()


def text_width(t, pt):
    return sum(500 if ord(ch) < 128 else 1000 for ch in t) * pt / 1000


def fit(t, pt, w):
    while t and text_width(t, pt) > w:
        t = t[:-1]
    return t


def qr_pdf(entries, size_cm):
    page_w, page_h, margin = 210 * MM, 297 * MM, 10 * MM
    side = size_cm * 10 * MM                         # QR 심볼(조용한 영역 제외) 한 변
    label_pt = 7 if size_cm < 2.5 else 9
    cell_w = max(side * 37 / 29, 24 * MM)            # 29모듈 + 양쪽 조용한 영역 4모듈
    cell_h = cell_w + label_pt * 2.6
    cols = int((page_w - 2 * margin) // cell_w)
    rows = int((page_h - 2 * margin) // cell_h)
    pages = []
    for p in range(0, len(entries), cols * rows):
        ops = ["0.75 G 0.3 w [2 2] 0 d"]
        for i, (name, code) in enumerate(entries[p:p + cols * rows]):
            x0 = margin + (i % cols) * cell_w
            top = page_h - margin - (i // cols) * cell_h
            ops.append(f"{x0:.2f} {top - cell_h:.2f} {cell_w:.2f} {cell_h:.2f} re S")   # 자르는 선
            qr = segno.make(QR_PREFIX + code, error="m", micro=False)
            n = qr.symbol_size(border=0)[0]
            m = side / n
            qx, qy = x0 + (cell_w - side) / 2, top - (cell_w - side) / 2
            ops.append("0 g")
            for r, row in enumerate(qr.matrix):
                c0 = None
                for col, dark in enumerate(list(row) + [0]):   # 가로로 이어진 검은 칸은 사각형 하나로
                    if dark and c0 is None:
                        c0 = col
                    elif not dark and c0 is not None:
                        ops.append(f"{qx + c0 * m:.3f} {qy - (r + 1) * m:.3f} {(col - c0) * m:.3f} {m:.3f} re")
                        c0 = None
            ops.append("f")
            ty = top - cell_w - label_pt * 0.6
            label = fit(name, label_pt, cell_w - 4)
            ops.append(f"BT /K {label_pt} Tf {x0 + (cell_w - text_width(label, label_pt)) / 2:.2f} {ty:.2f} Td <{utf16hex(label)}> Tj ET")
            ops.append(f"BT /H {label_pt * 0.85:.1f} Tf {x0 + (cell_w - len(code) * label_pt * 0.85 * 0.55) / 2:.2f} "
                       f"{ty - label_pt * 1.2:.2f} Td ({code}) Tj ET")
        pages.append("\n".join(ops).encode())
    return build_pdf(pages, page_w, page_h)


def build_pdf(contents, w, h):
    objs = {}
    n_pages = len(contents)
    page_ids = [6 + 2 * i for i in range(n_pages)]
    objs[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objs[2] = f"<< /Type /Pages /Kids [{' '.join(f'{i} 0 R' for i in page_ids)}] /Count {n_pages} >>".encode()
    objs[3] = (b"<< /Type /Font /Subtype /Type0 /BaseFont /HYGoThic-Medium /Encoding /UniKS-UCS2-H "
               b"/DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYGoThic-Medium "
               b"/CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 1 >> "
               b"/FontDescriptor 4 0 R /DW 1000 /W [1 95 500] >>] >>")
    objs[4] = (b"<< /Type /FontDescriptor /FontName /HYGoThic-Medium /Flags 6 /FontBBox [-6 -145 1003 880] "
               b"/ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>")
    objs[5] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    for pid, data in zip(page_ids, contents):
        objs[pid] = (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w:.2f} {h:.2f}] "
                     f"/Resources << /Font << /K 3 0 R /H 5 0 R >> >> /Contents {pid + 1} 0 R >>").encode()
        objs[pid + 1] = f"<< /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream"
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for i in sorted(objs):
        offsets[i] = len(out)
        out += f"{i} 0 obj\n".encode() + objs[i] + b"\nendobj\n"
    xref = len(out)
    size = max(objs) + 1
    out += f"xref\n0 {size}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{offsets[i]:010d} 00000 n \n".encode() for i in range(1, size))
    out += f"trailer\n<< /Size {size} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


# ── 세미나실 ────────────────────────────────────────────────────────────

def week(c, me, b, q):
    try:
        start = date.fromisoformat(q.get("start", [""])[0])
    except ValueError:
        start = now().date()
    start -= timedelta(days=start.weekday())          # 월요일부터
    end = start + timedelta(days=6)
    admin = me and me["role"] in ("admin", "super")
    rows = c.execute("""SELECT r.id, r.room_id, r.date, r.hour, r.user_id, u.name, u.student_id
                        FROM reservations r JOIN users u ON u.id=r.user_id WHERE r.date BETWEEN ? AND ?""",
                     (start.isoformat(), end.isoformat())).fetchall()
    return {"start": start.isoformat(), "now": now().isoformat(),
            "rooms": [dict(r) for r in c.execute("SELECT * FROM rooms ORDER BY id")],
            "reservations": [{"id": r["id"], "room_id": r["room_id"], "date": r["date"], "hour": r["hour"],
                              "mine": bool(me and r["user_id"] == me["id"]),
                              "who": f"{r['name']} {r['student_id']}" if admin else mask(r["name"])} for r in rows]}


def reserve(c, me, b, q):
    try:
        d = date.fromisoformat(str(b.get("date")))
        hours = sorted({int(h) for h in b.get("hours", [])})
        room = int(b.get("room_id"))
    except (TypeError, ValueError):
        raise Err(400, "잘못된 요청")
    if not hours or not all(0 <= h <= 23 for h in hours) or len(hours) > 24:
        raise Err(400, "시간을 고르세요")
    if not c.execute("SELECT 1 FROM rooms WHERE id=?", (room,)).fetchone():
        raise Err(400, "없는 방입니다")
    if datetime.combine(d, datetime.min.time()) + timedelta(hours=hours[0] + 1) <= now():
        raise Err(400, "지난 시간은 예약할 수 없습니다")
    try:
        c.executemany("INSERT INTO reservations(room_id,user_id,date,hour) VALUES(?,?,?,?)",
                      [(room, me["id"], d.isoformat(), h) for h in hours])
    except sqlite3.IntegrityError:
        c.rollback()
        raise Err(409, "이미 예약된 시간이 있습니다")
    return {"ok": True}


def unreserve(c, me, b, q):
    if me["role"] in ("admin", "super"):
        c.execute("DELETE FROM reservations WHERE id=?", (b.get("id"),))
    else:
        c.execute("DELETE FROM reservations WHERE id=? AND user_id=?", (b.get("id"), me["id"]))
    return {"ok": True}


def my_reservations(c, me, b, q):
    rows = c.execute("""SELECT r.id, r.date, r.hour, m.name AS room FROM reservations r JOIN rooms m ON m.id=r.room_id
                        WHERE r.user_id=? AND r.date >= ? ORDER BY r.date, r.hour""",
                     (me["id"], now().date().isoformat())).fetchall()
    return {"reservations": [dict(r) for r in rows]}


# ── 행사 ────────────────────────────────────────────────────────────────

def event_out(e):
    d = dict(e)
    d["fields"] = json.loads(e["fields"])
    d["on_lobby"] = bool(e["on_lobby"])
    d["closed"] = parse_dt(e["deadline"], "마감") <= now()
    return d


def count_of(c, e):
    return c.execute("SELECT COUNT(*) FROM applications WHERE event_id=?", (e["id"],)).fetchone()[0]


def gauge(c, e):
    """공개해도 되는 신청 현황. show_count=0 이면 n 을 뺀다. 정원이 없으면 capacity=None."""
    n, cap = count_of(c, e), e["capacity"]
    return {"id": e["id"], "title": e["title"], "deadline": e["deadline"], "capacity": cap,
            "n": n if e["show_count"] else None, "show_count": bool(e["show_count"]),
            "full": cap is not None and n >= cap, "closed": parse_dt(e["deadline"], "마감") <= now()}


def events(c, me, b, q):
    rows = c.execute("SELECT * FROM events WHERE on_lobby=1 ORDER BY deadline DESC").fetchall()
    mine = {r[0] for r in c.execute("SELECT event_id FROM applications WHERE user_id=?", (me["id"],))} if me else set()
    return {"events": [dict(event_out(e), applied=e["id"] in mine, gauge=gauge(c, e)) for e in rows]}


def event(c, me, b, q):
    e = c.execute("SELECT * FROM events WHERE id=?", (q.get("id", ["0"])[0],)).fetchone()
    if not e:
        raise Err(404, "없는 행사입니다")
    a = c.execute("SELECT answers, updated_at FROM applications WHERE event_id=? AND user_id=?",
                  (e["id"], me["id"])).fetchone()
    nt = c.execute("SELECT id FROM notices WHERE event_id=? ORDER BY id DESC LIMIT 1", (e["id"],)).fetchone()
    return {"event": event_out(e), "gauge": gauge(c, e), "notice_id": nt["id"] if nt else None,
            "application": {"answers": json.loads(a["answers"]), "updated_at": a["updated_at"]} if a else None}


def check_answers(fields, ans):
    if not isinstance(ans, dict):
        raise Err(400, "잘못된 요청")
    out = {}
    for i, f in enumerate(fields):
        v = ans.get(str(i))
        if f["type"] == "checkbox":
            v = bool(v)
            if f.get("required") and not v:
                raise Err(400, f"'{f['label']}' 에 체크하세요")
        else:
            v = v.strip() if isinstance(v, str) else ""
            if f.get("required") and not v:
                raise Err(400, f"'{f['label']}' 을(를) 입력하세요")
            if len(v) > 1000:
                raise Err(400, f"'{f['label']}' 이 너무 깁니다")
            if f["type"] == "select" and v and v not in f.get("options", []):
                raise Err(400, f"'{f['label']}' 선택지가 잘못됐습니다")
        out[str(i)] = v
    return out


def apply(c, me, b, q):
    e = c.execute("SELECT * FROM events WHERE id=?", (b.get("event_id"),)).fetchone()
    if not e:
        raise Err(404, "없는 행사입니다")
    if parse_dt(e["deadline"], "마감") <= now():
        raise Err(403, "마감된 행사입니다")
    ans = json.dumps(check_answers(json.loads(e["fields"]), b.get("answers", {})), ensure_ascii=False)
    c.execute("BEGIN IMMEDIATE")          # 정원 확인과 저장 사이에 다른 신청이 끼어들지 못하게
    mine = c.execute("SELECT 1 FROM applications WHERE event_id=? AND user_id=?", (e["id"], me["id"])).fetchone()
    if not mine and e["capacity"] is not None and count_of(c, e) >= e["capacity"]:
        raise Err(409, "정원이 찼습니다")
    c.execute("""INSERT INTO applications(event_id,user_id,answers,updated_at) VALUES(?,?,?,?)
                 ON CONFLICT(event_id,user_id) DO UPDATE SET answers=excluded.answers, updated_at=excluded.updated_at""",
              (e["id"], me["id"], ans, stamp()))
    return {"ok": True}


def check_fields(fields):
    if not isinstance(fields, list) or len(fields) > 30:
        raise Err(400, "추가 항목이 잘못됐습니다")
    out = []
    for f in fields:
        if not isinstance(f, dict) or f.get("type") not in ("text", "select", "checkbox"):
            raise Err(400, "추가 항목 종류가 잘못됐습니다")
        label = s(f, "label", 100)
        g = {"label": label, "type": f["type"], "required": bool(f.get("required"))}
        if f["type"] == "select":
            opts = [str(o).strip()[:100] for o in f.get("options", []) if str(o).strip()]
            if not opts:
                raise Err(400, f"'{label}' 선택지를 입력하세요")
            g["options"] = opts
        out.append(g)
    return out


def admin_events(c, me, b, q):
    rows = c.execute("""SELECT e.*, (SELECT COUNT(*) FROM applications a WHERE a.event_id=e.id) AS n
                        FROM events e ORDER BY e.id DESC""").fetchall()
    return {"events": [dict(event_out(e), n=e["n"]) for e in rows]}   # 관리자에겐 show_count 와 상관없이 실제 n


def admin_event_save(c, me, b, q):
    deadline = parse_dt(b.get("deadline"), "마감").isoformat(timespec="minutes")
    starts = b.get("starts_at") or ""
    if starts:
        starts = parse_dt(starts, "일시").isoformat(timespec="minutes")
    cap = b.get("capacity")
    if cap in (None, "", 0, "0"):
        cap = None                                   # 정원 없음
    else:
        try:
            cap = int(cap)
        except (TypeError, ValueError):
            raise Err(400, "정원은 숫자여야 합니다")
        if not 1 <= cap <= 100000:
            raise Err(400, "정원이 잘못됐습니다")
    vals = (s(b, "title", 100), s(b, "body", 5000, required=False), starts, deadline,
            1 if b.get("on_lobby") else 0, json.dumps(check_fields(b.get("fields", [])), ensure_ascii=False),
            cap, 0 if b.get("show_count") is False else 1)
    if b.get("id"):
        # 신청이 이미 있으면 항목 순서가 바뀔 때 답이 어긋난다 — 관리자 화면이 경고한다
        c.execute("UPDATE events SET title=?, body=?, starts_at=?, deadline=?, on_lobby=?, fields=?, capacity=?, show_count=? WHERE id=?",
                  vals + (b["id"],))
    else:
        c.execute("INSERT INTO events(title,body,starts_at,deadline,on_lobby,fields,capacity,show_count) VALUES(?,?,?,?,?,?,?,?)", vals)
    return {"ok": True}


def admin_event_del(c, me, b, q):
    c.execute("DELETE FROM events WHERE id=?", (b.get("id"),))
    return {"ok": True}


def admin_applications(c, me, b, q):
    e = c.execute("SELECT * FROM events WHERE id=?", (q.get("id", ["0"])[0],)).fetchone()
    if not e:
        raise Err(404, "없는 행사입니다")
    rows = c.execute("""SELECT u.name, u.student_id, u.email, a.answers, a.updated_at FROM applications a
                        JOIN users u ON u.id=a.user_id WHERE a.event_id=? ORDER BY a.id""", (e["id"],)).fetchall()
    return {"event": event_out(e), "applications": [dict(r, answers=json.loads(r["answers"])) for r in rows]}


# ── 공지 · 배너 ─────────────────────────────────────────────────────────
# 행사 공지와 로비 배너에 오른 공지는 비로그인도 읽는다. 나머지 학과 공지는 로그인해야 목록·본문이 보인다.

TABS = ("home", "notices", "events", "reserve", "loans")


def readable(me, n):
    return bool(me) or n["kind"] == "event" or bool(n["on_lobby"])


def notice_out(c, n, full=False):
    d = {"id": n["id"], "kind": n["kind"], "title": n["title"], "summary": n["summary"], "on_lobby": bool(n["on_lobby"]),
         "chips": json.loads(n["chips"]), "created_at": n["created_at"], "event_id": n["event_id"]}
    u = c.execute("SELECT name FROM users WHERE id=?", (n["author_id"],)).fetchone()
    d["author"] = u["name"] if u else ""
    e = c.execute("SELECT * FROM events WHERE id=?", (n["event_id"],)).fetchone() if n["event_id"] else None
    d["event"] = gauge(c, e) if e else None
    if full:
        d["body"] = n["body"]
    return d


def banners(c, me, b, q):
    out = []
    for n in c.execute("SELECT * FROM notices WHERE on_lobby=1 ORDER BY id DESC"):
        out.append(dict(notice_out(c, n), type="notice"))
    for e in c.execute("SELECT * FROM events WHERE on_lobby=1 ORDER BY deadline"):
        g = gauge(c, e)
        if g["closed"]:
            continue
        out.append({"type": "event", "id": e["id"], "kind": "event", "title": e["title"],
                    "summary": e["body"].split("\n", 1)[0][:100], "starts_at": e["starts_at"], "event": g,
                    "chips": [{"label": "참여 신청", "type": "event", "target": str(e["id"])}]})
    return {"banners": out}


def notices(c, me, b, q):
    kind = q.get("kind", [""])[0]
    if kind not in ("", "dept", "event"):
        raise Err(400, "잘못된 분류")
    if kind == "dept" and not me:
        raise Err(401, "로그인이 필요합니다")
    sql, args = "SELECT * FROM notices", []
    if kind:
        sql, args = sql + " WHERE kind=?", [kind]
    elif not me:
        sql += " WHERE kind='event'"
    return {"notices": [notice_out(c, n) for n in c.execute(sql + " ORDER BY id DESC LIMIT 200", args)]}


def notice(c, me, b, q):
    n = c.execute("SELECT * FROM notices WHERE id=?", (q.get("id", ["0"])[0],)).fetchone()
    if not me and not (n and readable(me, n)):     # 비로그인에겐 없는 글과 막힌 글이 같은 답
        raise Err(401, "로그인이 필요합니다")
    if not n:
        raise Err(404, "없는 공지입니다")
    vis = "" if me else " AND kind='event'"
    prev = c.execute(f"SELECT id,title FROM notices WHERE id<?{vis} ORDER BY id DESC LIMIT 1", (n["id"],)).fetchone()
    nxt = c.execute(f"SELECT id,title FROM notices WHERE id>?{vis} ORDER BY id LIMIT 1", (n["id"],)).fetchone()
    return {"notice": notice_out(c, n, full=True), "prev": dict(prev) if prev else None, "next": dict(nxt) if nxt else None}


def check_chips(c, chips):
    if not isinstance(chips, list) or len(chips) > 6:
        raise Err(400, "칩은 6개까지입니다")
    out = []
    for ch in chips:
        if not isinstance(ch, dict):
            raise Err(400, "칩이 잘못됐습니다")
        label, typ, target = s(ch, "label", 30), ch.get("type"), str(ch.get("target", "")).strip()
        if typ == "tab":
            ok = target in TABS
        elif typ == "event":
            ok = bool(c.execute("SELECT 1 FROM events WHERE id=?", (target,)).fetchone())
        elif typ == "notice":
            ok = bool(c.execute("SELECT 1 FROM notices WHERE id=?", (target,)).fetchone())
        elif typ == "url":
            ok = re.fullmatch(r"https?://[^\s]{1,500}", target) is not None
        else:
            ok = False
        if not ok:
            raise Err(400, f"칩 '{label}' 의 이동 대상이 잘못됐습니다")
        out.append({"label": label, "type": typ, "target": target})
    return out


def admin_notices(c, me, b, q):
    return {"notices": [notice_out(c, n) for n in c.execute("SELECT * FROM notices ORDER BY id DESC")]}


def admin_notice(c, me, b, q):
    n = c.execute("SELECT * FROM notices WHERE id=?", (q.get("id", ["0"])[0],)).fetchone()
    if not n:
        raise Err(404, "없는 공지입니다")
    return {"notice": notice_out(c, n, full=True)}


def admin_notice_save(c, me, b, q):
    kind = b.get("kind")
    if kind not in ("dept", "event"):
        raise Err(400, "분류가 잘못됐습니다")
    eid = b.get("event_id") or None
    if eid and not c.execute("SELECT 1 FROM events WHERE id=?", (eid,)).fetchone():
        raise Err(400, "연결할 행사가 없습니다")
    vals = (kind, s(b, "title", 100), s(b, "summary", 100, required=False), s(b, "body", 20000, required=False),
            json.dumps(check_chips(c, b.get("chips", [])), ensure_ascii=False), eid, 1 if b.get("on_lobby") else 0)
    if b.get("id"):
        if not c.execute("UPDATE notices SET kind=?, title=?, summary=?, body=?, chips=?, event_id=?, on_lobby=? WHERE id=?",
                         vals + (b["id"],)).rowcount:
            raise Err(404, "없는 공지입니다")
    else:
        c.execute("INSERT INTO notices(kind,title,summary,body,chips,event_id,on_lobby,author_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                  vals + (me["id"], stamp()))
    return {"ok": True}


def admin_notice_del(c, me, b, q):
    c.execute("DELETE FROM notices WHERE id=?", (b.get("id"),))
    return {"ok": True}


# ── 사용자 (최고 관리자) ────────────────────────────────────────────────

def admin_users(c, me, b, q):
    rows = c.execute("SELECT * FROM users ORDER BY role='user', name").fetchall()
    return {"users": [user_out(u) for u in rows]}


def admin_role(c, me, b, q):
    if b.get("role") not in ("user", "admin"):
        raise Err(400, "잘못된 권한")
    c.execute("UPDATE users SET role=? WHERE id=? AND role != 'super'", (b["role"], b.get("id")))
    return {"ok": True}


# 경로 → (함수, 필요한 권한). None=누구나, user=로그인, admin, super
GET = {"/api/me": (get_me, None), "/api/items": (items, "user"), "/api/week": (week, None),
       "/api/my_reservations": (my_reservations, "user"), "/api/events": (events, None), "/api/event": (event, "user"),
       "/api/banners": (banners, None), "/api/notices": (notices, None), "/api/notice": (notice, None),
       "/api/admin/notices": (admin_notices, "admin"), "/api/admin/notice": (admin_notice, "admin"),
       "/api/admin/items": (admin_items, "admin"), "/api/admin/qr.pdf": (admin_qr_pdf, "admin"),
       "/api/admin/events": (admin_events, "admin"), "/api/admin/applications": (admin_applications, "admin"),
       "/api/admin/users": (admin_users, "super")}
POST = {"/api/signup": (signup, None), "/api/login": (login, None), "/api/logout": (logout, None),
        "/api/forgot": (forgot, None), "/api/reset": (reset, None),
        "/api/scan": (scan, "user"), "/api/reserve": (reserve, "user"), "/api/unreserve": (unreserve, "user"),
        "/api/apply": (apply, "user"), "/api/admin/item_add": (admin_item_add, "admin"),
        "/api/admin/item_del": (admin_item_del, "admin"), "/api/admin/item_return": (admin_item_return, "admin"),
        "/api/admin/event_save": (admin_event_save, "admin"), "/api/admin/event_del": (admin_event_del, "admin"),
        "/api/admin/notice_save": (admin_notice_save, "admin"), "/api/admin/notice_del": (admin_notice_del, "admin"),
        "/api/admin/role": (admin_role, "super")}
RANK = {None: 0, "user": 1, "admin": 2, "super": 3}
STATIC = {"/": ("index.html", "text/html; charset=utf-8")}


class H(BaseHTTPRequestHandler):
    server_version = "switch"

    def log_message(self, fmt, *a):
        if not self.path.startswith("/api/me"):
            sys.stderr.write(fmt % a + "\n")

    def send(self, status, body, ctype="application/json; charset=utf-8", headers=()):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def cookie(self, tok):
        age = SESSION_DAYS * 86400 if tok else 0
        return ("Set-Cookie", f"{COOKIE}={tok}; Path={PREFIX}/; Max-Age={age}; HttpOnly; Secure; SameSite=Lax")

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = urlparse(self.path).path
        if m := re.fullmatch(r"/q/([a-z0-9]{1,16})", path.lower()):
            return self.send(302, b"", "text/plain", [("Location", f"../#/q/{m[1]}")])
        if path in STATIC:
            name, ctype = STATIC[path]
            with open(os.path.join(BASE, name), "rb") as f:
                return self.send(200, f.read(), ctype)
        self.api(GET)

    def do_POST(self):
        # 다른 사이트에서 쿠키를 싣고 오는 요청 차단 (SameSite=Lax 에 더해)
        origin = self.headers.get("Origin")
        if origin and origin != ORIGIN:
            return self.send(403, b'{"error":"origin"}')
        self.api(POST)

    def api(self, table):
        u = urlparse(self.path)
        if u.path not in table:
            return self.send(404, b'{"error":"not found"}')
        fn, need = table[u.path]
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                raise Err(413, "too large")
            body = json.loads(self.rfile.read(n) or b"{}") if self.command == "POST" else {}
            if not isinstance(body, dict):
                raise Err(400, "잘못된 요청")
        except (ValueError, Err) as e:
            return self.send(getattr(e, "status", 400), json.dumps({"error": getattr(e, "msg", "잘못된 요청")}).encode())
        c = connect()
        try:
            me, tok = None, SimpleCookie(self.headers.get("Cookie", "")).get(COOKIE)
            if tok:
                me = c.execute("""SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
                                  WHERE s.token=? AND s.expires > ?""", (tok_hash(tok.value), stamp())).fetchone()
            headers = []
            if RANK[me["role"] if me else None] < RANK[need]:
                raise Err(401 if not me else 403, "로그인이 필요합니다" if not me else "권한이 없습니다")
            if fn is logout and tok:
                c.execute("DELETE FROM sessions WHERE token=?", (tok_hash(tok.value),))
            elif fn is get_me and me:      # 들어올 때마다 만료를 다시 90일로
                c.execute("UPDATE sessions SET expires=? WHERE token=?",
                          ((now() + timedelta(days=SESSION_DAYS)).isoformat(), tok_hash(tok.value)))
                headers.append(self.cookie(tok.value))
            res = fn(c, me, body, parse_qs(u.query))
            if isinstance(res, tuple):     # 로그인·가입·로그아웃 — 쿠키를 굽거나 지운다
                res, new_tok = res
                headers.append(self.cookie(new_tok))
            c.commit()
            if isinstance(res, bytes):
                return self.send(200, res, "application/pdf",
                                 [("Content-Disposition", 'attachment; filename="switch-qr.pdf"')])
            self.send(200, json.dumps(res, ensure_ascii=False).encode(), headers=headers)
        except Err as e:
            c.rollback()
            self.send(e.status, json.dumps({"error": e.msg}, ensure_ascii=False).encode())
        except Exception as e:
            c.rollback()
            sys.stderr.write(f"500 {u.path}: {e!r}\n")
            self.send(500, '{"error":"서버 오류"}'.encode())
        finally:
            c.close()


def main():
    init_db()
    if len(sys.argv) == 3 and sys.argv[1] == "super":
        with connect() as c:
            if not c.execute("UPDATE users SET role='super' WHERE username=?", (sys.argv[2],)).rowcount:
                sys.exit(f"아이디 '{sys.argv[2]}' 가 없습니다. 웹에서 먼저 가입하세요.")
        print(f"{sys.argv[2]} → 최고 관리자")
        return
    ThreadingHTTPServer.daemon_threads = True
    srv = ThreadingHTTPServer((HOST, PORT), H)
    print(f"council on http://{HOST}:{PORT}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
