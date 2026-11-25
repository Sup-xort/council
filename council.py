"""SWITCH — 반도체융합공학과 학생회 홈페이지 (데모).

물품 대여(QR), 세미나실 예약, 행사 신청, 관리자 페이지.

QR 내용은 {ORIGIN}/q/<코드>. 기본 카메라로 찍으면 /q/<코드> 로 들어오고,
서버는 ../#/q/<코드> 로 돌려보낸다 — 대여·반납은 페이지가 POST api/scan 으로 한다
(GET 으로 상태를 바꾸면 메신저 링크 미리보기가 물건을 빌려 버린다).

최고 관리자 지정: 웹에서 가입한 뒤 `python3 council.py super <아이디>`.
표준 라이브러리 + vendor/segno(QR 매트릭스)만 쓴다.
"""
import base64
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
import time
import html as htmllib
from urllib.request import Request, urlopen
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr
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
ENV_FILE = os.path.join(BASE, "council.env")
QR_PREFIX = ORIGIN + PREFIX + "/q/"
KST = ZoneInfo("Asia/Seoul")

SIGNUP_OPEN = os.environ.get("COUNCIL_SIGNUP") == "open"   # 관리 사이트에서 켜고 끈 값이 없을 때의 기본. 기본은 닫힘
COOKIE = "scene_sid"
RESET_MIN = 30                         # 비밀번호 재설정 링크 유효시간
SESSION_DAYS = 400                     # 브라우저가 허용하는 쿠키 최대 수명 — 쓸 때마다 다시 400일이라 사실상 로그인이 풀리지 않는다
PBKDF2_ITER = 600_000
PBKDF2_OLD = 200_000                   # 예전에 저장한 비밀번호가 만들어진 횟수. 로그인할 때 새 횟수로 다시 저장한다
MAX_BODY = 256 * 1024
CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"   # 헷갈리는 0/o, 1/l/i 제외
QR_SIZES_CM = (1.5, 2, 2.5, 3, 4)
DEFAULT_HOURS = 48                     # 대여 기간을 따로 정하지 않은 종류의 기본값 (시간제)
MAX_HOURS = 24 * 365
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
  starts_at TEXT NOT NULL DEFAULT '', deadline TEXT NOT NULL, on_lobby INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events ON DELETE CASCADE,
  position INTEGER NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS question_options(id INTEGER PRIMARY KEY, question_id INTEGER NOT NULL REFERENCES questions ON DELETE CASCADE,
  position INTEGER NOT NULL, label TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS applications(id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, updated_at TEXT NOT NULL,
  UNIQUE(event_id, user_id));
CREATE TABLE IF NOT EXISTS answers(id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL REFERENCES applications ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions ON DELETE CASCADE, value TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS answers_by_app ON answers(application_id);
CREATE INDEX IF NOT EXISTS questions_by_event ON questions(event_id, position);
CREATE TABLE IF NOT EXISTS notices(id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('dept','event')),
  title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', chips TEXT NOT NULL DEFAULT '[]',
  event_id INTEGER REFERENCES events ON DELETE SET NULL, on_lobby INTEGER NOT NULL DEFAULT 0,
  author_id INTEGER REFERENCES users ON DELETE SET NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kind_hours(kind TEXT PRIMARY KEY, hours INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pulled(src TEXT PRIMARY KEY, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS email_codes(email TEXT PRIMARY KEY, code TEXT NOT NULL, expires TEXT NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0, sent_at TEXT NOT NULL);
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
        for table in ("reservations", "users", "applications"):   # 언제 예약·가입·처음 신청했는지. 옛 행은 NULL
            if "created_at" not in {r[1] for r in c.execute(f"PRAGMA table_info({table})")}:
                c.execute(f"ALTER TABLE {table} ADD COLUMN created_at TEXT")
        ucols = {r[1] for r in c.execute("PRAGMA table_info(users)")}
        if "phone" not in ucols:             # 전화번호 (예전 회원은 빈칸)
            c.execute("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''")
        if "consent_at" not in ucols:        # 개인정보 수집·이용에 동의한 때
            c.execute("ALTER TABLE users ADD COLUMN consent_at TEXT")
        for col in ("mail_dept", "mail_event"):     # 공지 메일을 받을지 (학생이 고른다). 기본은 받지 않음
            if col not in ucols:
                c.execute(f"ALTER TABLE users ADD COLUMN {col} INTEGER NOT NULL DEFAULT 0")
        if "dues" not in {r[1] for r in c.execute("PRAGMA table_info(users)")}:      # 학생회비 납부 여부 (관리자가 표시)
            c.execute("ALTER TABLE users ADD COLUMN dues INTEGER NOT NULL DEFAULT 0")
        if "dues_only" not in cols:         # 1 이면 학생회비 납부자만 신청
            c.execute("ALTER TABLE events ADD COLUMN dues_only INTEGER NOT NULL DEFAULT 0")
        if c.execute("SELECT 1 FROM sqlite_master WHERE name='kind_rules'").fetchone():     # 일 단위로 정해 둔 것은 시간으로 옮긴다
            c.execute("INSERT OR IGNORE INTO kind_hours SELECT kind, days*24 FROM kind_rules")
            c.execute("DROP TABLE kind_rules")
        migrate_answers(c)
        add_pids(c)
        for name, col in (("users_sid_once", "student_id"), ("users_email_once", "lower(email)")):   # 겹치는 옛 회원이 있으면 만들지 못하고 넘어간다 — 가입 때의 검사가 막아 준다
            try:
                c.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS {name} ON users({col})")
            except sqlite3.IntegrityError:
                sys.stderr.write(f"경고: 같은 {col} 의 회원이 있어 중복 방지 색인을 만들지 못했습니다\n")
        if not c.execute("SELECT 1 FROM rooms").fetchone():
            c.executemany("INSERT INTO rooms(name) VALUES(?)", [(r,) for r in ROOMS])


PID = re.compile(r"[0-9a-f]{16}")


def new_pid():
    return secrets.token_hex(8)


def add_pids(c):
    """회원·공지·행사의 바깥용 번호. 주소·메일 링크·API 에는 차례대로 붙는 id 대신 이 무작위 번호만 나간다."""
    for t in ("users", "events", "notices"):
        if "pid" not in {r[1] for r in c.execute(f"PRAGMA table_info({t})")}:
            c.execute(f"ALTER TABLE {t} ADD COLUMN pid TEXT")
        for (i,) in c.execute(f"SELECT id FROM {t} WHERE pid IS NULL").fetchall():
            c.execute(f"UPDATE {t} SET pid=? WHERE id=?", (new_pid(), i))
        c.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS {t}_pid ON {t}(pid)")
    for n in c.execute("SELECT id, chips FROM notices").fetchall():     # 예전 바로가기 버튼은 행사·공지를 id 로 가리켰다
        chips = json.loads(n["chips"] or "[]")
        for ch in chips:
            if ch.get("type") in ("event", "notice") and str(ch.get("target", "")).isdigit():
                r = c.execute(f"SELECT pid FROM {ch['type']}s WHERE id=?", (int(ch["target"]),)).fetchone()
                ch["target"] = r[0] if r else ""
        c.execute("UPDATE notices SET chips=? WHERE id=?", (json.dumps(chips, ensure_ascii=False), n["id"]))


def by_pid(c, table, pid):
    pid = str(pid or "")
    return c.execute(f"SELECT * FROM {table} WHERE pid=?", (pid,)).fetchone() if PID.fullmatch(pid) else None


def id_of(c, table, pid):
    r = by_pid(c, table, pid)
    return r["id"] if r else None


def migrate_answers(c):
    """예전에는 질문을 events.fields, 답을 applications.answers 한 칸(JSON)에 묶어 두었다. 표로 풀어 옮기고 묶음 칸을 없앤다."""
    ecols = {r[1] for r in c.execute("PRAGMA table_info(events)")}
    if "fields" not in ecols and "answers" not in {r[1] for r in c.execute("PRAGMA table_info(applications)")}:
        return
    if "fields" in ecols and not os.path.exists(DB + ".bak-before-answers"):       # 옮기기 전 상태를 한 부 남겨 둔다
        bak = sqlite3.connect(DB + ".bak-before-answers")
        c.backup(bak)
        bak.close()
    for e in c.execute("SELECT id, fields FROM events").fetchall() if "fields" in ecols else []:
        qids = []
        for pos, f in enumerate(json.loads(e["fields"] or "[]")):
            qids.append(c.execute("INSERT INTO questions(event_id,position,label,type,required) VALUES(?,?,?,?,?)",
                                  (e["id"], pos, f["label"], f["type"], 1 if f.get("required") else 0)).lastrowid)
            for op, o in enumerate(f.get("options", [])):
                c.execute("INSERT INTO question_options(question_id,position,label) VALUES(?,?,?)", (qids[-1], op, o))
        fields = json.loads(e["fields"] or "[]")
        for a in c.execute("SELECT id, answers FROM applications WHERE event_id=?", (e["id"],)).fetchall():
            ans = json.loads(a["answers"] or "{}")
            for pos, qid in enumerate(qids):
                for v in answer_values(fields[pos], ans.get(str(pos))):
                    c.execute("INSERT INTO answers(application_id,question_id,value) VALUES(?,?,?)", (a["id"], qid, v))
    if "fields" in ecols:
        c.execute("ALTER TABLE events DROP COLUMN fields")
    if "answers" in {r[1] for r in c.execute("PRAGMA table_info(applications)")}:
        c.execute("ALTER TABLE applications DROP COLUMN answers")


def hash_pw(pw, salt=None, iters=PBKDF2_ITER):
    salt = salt or secrets.token_hex(16)
    return f"{iters}${salt}${hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), iters).hex()}"


def parse_hash(stored):
    """새 형식은 '횟수$salt$해시', 예전 형식은 'salt$해시'."""
    parts = stored.split("$")
    return (int(parts[0]), parts[1]) if len(parts) == 3 else (PBKDF2_OLD, parts[0])


def check_pw(pw, stored):
    iters, salt = parse_hash(stored)
    return hmac.compare_digest(hash_pw(pw, salt, iters).rsplit("$", 1)[1], stored.rsplit("$", 1)[1])


def pw_error(pw):
    if not isinstance(pw, str) or len(pw) < 6 or len(pw) > 128:
        return "비밀번호는 6자 이상 128자 이하로 정해 주십시오"
    if not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        return "비밀번호에는 영문자와 숫자가 모두 들어가야 합니다"
    return None


def tok_hash(tok):
    return hashlib.sha256(tok.encode()).hexdigest()


def mask(name):
    if len(name) <= 1:
        return name
    if len(name) == 2:
        return name[0] + "*"
    return name[0] + "*" * (len(name) - 2) + name[-1]


# 붙여 넣은 글에 섞여 오는 보이지 않는 문자. 줄 맨 앞에 있으면 제목·목록 서식이 먹지 않는다.
# U+200D(이모지 결합)는 남긴다.
INVISIBLE = re.compile("[​⁠﻿]")


LABEL = {"username": "아이디", "name": "이름", "student_id": "학번", "email": "이메일", "phone": "전화번호", "title": "제목",
         "summary": "한 줄 소개", "body": "본문", "kind": "종류", "label": "항목 이름"}


def josa(word, with_final, without_final):
    """받침이 있으면 앞의 것(을·이·은), 없으면 뒤의 것(를·가·는)."""
    ch = (word or " ")[-1]
    if "가" <= ch <= "힣":
        return word + (with_final if (ord(ch) - 0xAC00) % 28 else without_final)
    return word + (with_final if ch in "0136781LMNRlmnr" else without_final)


def s(body, key, maxlen=200, required=True, label=None):
    v = body.get(key, "")
    v = INVISIBLE.sub("", v).strip() if isinstance(v, str) else ""
    name = label or LABEL.get(key, key)
    if required and not v:
        raise Err(400, f"{josa(name, '을', '를')} 입력해 주십시오")
    if len(v) > maxlen:
        raise Err(400, f"{josa(name, '은', '는')} {maxlen:,}자까지 쓸 수 있습니다")
    return v


def parse_dt(v, what):
    try:
        return datetime.fromisoformat(v).replace(second=0, microsecond=0)
    except (TypeError, ValueError):
        raise Err(400, f"{what} 날짜와 시간을 다시 확인해 주십시오")


def phone_of(v, required=True):
    """숫자만 남겨 9~11자리인지 보고 하이픈을 붙인다."""
    d = re.sub(r"\D", "", str(v or ""))
    if not d and not required:
        return ""
    if not 9 <= len(d) <= 11:
        raise Err(400, "전화번호를 다시 확인해 주십시오")
    if len(d) == 11:
        return f"{d[:3]}-{d[3:7]}-{d[7:]}"
    if len(d) == 10:
        return f"{d[:2]}-{d[2:6]}-{d[6:]}" if d.startswith("02") else f"{d[:3]}-{d[3:6]}-{d[6:]}"
    return f"{d[:2]}-{d[2:5]}-{d[5:]}"


def student_id_of(v):
    v = str(v or "").strip()
    if not re.fullmatch(r"\d{10}", v):
        raise Err(400, "학번은 숫자 10자리로 써 주십시오")
    return v


def school_email_of(v):
    v = str(v or "").strip()
    if not re.fullmatch(r"[^@\s]+@(g\.)?skku\.edu", v, re.I):
        raise Err(400, "이메일은 skku.edu 또는 g.skku.edu 주소로 써 주십시오")
    return v


def user_out(u):
    return dict({k: u[k] for k in ("username", "name", "student_id", "email", "phone", "role")}, dues=bool(u["dues"]),
                mail_dept=bool(u["mail_dept"]), mail_event=bool(u["mail_event"]))


def taken_by(c, id=None, email=None, student_id=None):
    """학번·이메일이 이미 다른 회원 것이면 알려 줄 문구를, 아니면 None. 이메일은 대소문자를 가리지 않는다."""
    if student_id is not None and c.execute("SELECT 1 FROM users WHERE student_id=? AND id IS NOT ?", (student_id, id)).fetchone():
        return "이미 가입된 학번입니다"
    if email is not None and c.execute("SELECT 1 FROM users WHERE lower(email)=lower(?) AND id IS NOT ?", (email, id)).fetchone():
        return "이미 가입된 이메일입니다"
    return None


# ── 인증 ────────────────────────────────────────────────────────────────

def signup_open(c):
    r = c.execute("SELECT value FROM settings WHERE key='signup_open'").fetchone()
    return bool(r["value"]) if r else SIGNUP_OPEN


def admin_signup(c, me, b, q):
    if not isinstance(b.get("open"), bool):
        raise Err(400, "가입을 받을지 끌지 다시 골라 주십시오")
    c.execute("INSERT INTO settings(key,value) VALUES('signup_open',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (int(b["open"]),))
    return {"signup_open": b["open"]}


def signup(c, me, b, q):
    if not signup_open(c):
        raise Err(403, "지금은 새 회원을 받지 않습니다")
    username = s(b, "username", 32)
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,32}", username):
        raise Err(400, "아이디는 영문과 숫자로 3~32자를 써 주십시오")
    pw = b.get("password") or ""
    if err := pw_error(pw):
        raise Err(400, err)
    if pw in (s(b, "name", 40), b.get("student_id"), b.get("email")):   # 자동완성이 비밀번호를 다른 칸에 채운 경우
        raise Err(400, "이름·학번·이메일 칸에 비밀번호가 들어간 것 같습니다. 다시 확인해 주십시오")
    email = school_email_of(s(b, "email", 120))
    sid = student_id_of(b.get("student_id"))
    phone = phone_of(b.get("phone"))
    if b.get("consent") is not True:
        raise Err(400, "개인정보 수집·이용에 동의해 주십시오")
    taken = taken_by(c, email=email, student_id=sid)
    if taken:
        raise Err(409, taken)
    if mail_ready():
        check_email_code(c, email, b.get("code"))
    try:
        cur = c.execute("INSERT INTO users(pid,username,pw,name,student_id,email,phone,consent_at,created_at,mail_dept,mail_event) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                        (new_pid(), username, hash_pw(pw), s(b, "name", 40), sid, email, phone, stamp(), stamp(),
                         1 if b.get("mail_dept") is True else 0, 1 if b.get("mail_event") is True else 0))
    except sqlite3.IntegrityError as e:
        raise Err(409, "이미 가입된 학번 또는 이메일입니다" if "users." in str(e) and "username" not in str(e) else "이미 쓰고 있는 아이디입니다")
    return new_session(c, cur.lastrowid)


def login(c, me, b, q):
    u = c.execute("SELECT * FROM users WHERE username=?", (str(b.get("username", "")).strip(),)).fetchone()
    if not u or not check_pw(str(b.get("password", "")), u["pw"]):
        raise Err(401, "아이디나 비밀번호가 맞지 않습니다")
    if parse_hash(u["pw"])[0] != PBKDF2_ITER:
        c.execute("UPDATE users SET pw=? WHERE id=?", (hash_pw(str(b["password"])), u["id"]))
    return new_session(c, u["id"])


def new_session(c, uid):
    tok = secrets.token_urlsafe(32)
    c.execute("DELETE FROM sessions WHERE expires < ?", (stamp(),))
    c.execute("INSERT INTO sessions VALUES(?,?,?)", (tok_hash(tok), uid, (now() + timedelta(days=SESSION_DAYS)).isoformat()))
    u = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return {"user": user_out(u)}, tok


def send_mail(to, subject, body, page=None):
    # SMTP_HOST·SMTP_USER·SMTP_PASS 는 council.env (systemd EnvironmentFile). 465 SSL 만 쓴다
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = formataddr((os.environ.get("SMTP_NAME", "SWITCH 학생회"), os.environ["SMTP_USER"])), to, subject
    m.set_content(body)
    if page:
        m.add_alternative(page, subtype="html")
    with smtplib.SMTP_SSL(os.environ["SMTP_HOST"], 465, timeout=20) as s:
        s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"])
        s.send_message(m)


def smtp_setup(c, me, b, q):
    host = s(b, "host", 100)
    user = s(b, "user", 120)
    pw = re.sub(r"\s", "", str(b.get("password") or ""))
    name = s(b, "name", 60, required=False) or "SWITCH 학생회"
    if not pw or not re.fullmatch(r"[\w.-]+", host) or not re.fullmatch(r"[^@\s]+@[^@\s]+", user):
        raise Err(400, "서버 주소, 메일 주소, 앱 비밀번호를 다시 확인해 주십시오")
    try:
        with smtplib.SMTP_SSL(host, 465, timeout=15) as srv:
            srv.login(user, pw)
    except smtplib.SMTPAuthenticationError:
        raise Err(400, "메일 주소나 앱 비밀번호가 맞지 않습니다")
    except Exception:
        raise Err(502, "메일 서버에 연결하지 못했습니다. 서버 주소를 확인해 주십시오")
    keep = [l for l in open(ENV_FILE, encoding="utf-8").read().splitlines() if not l.startswith("SMTP_")] if os.path.exists(ENV_FILE) else []
    esc = lambda v: v.replace("\\", "\\\\").replace('"', '\\"')
    keep += [f'SMTP_{k}="{esc(v)}"' for k, v in (("HOST", host), ("USER", user), ("PASS", pw), ("NAME", name))]
    fd = os.open(ENV_FILE + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(keep) + "\n")
    os.replace(ENV_FILE + ".tmp", ENV_FILE)
    os.environ.update(SMTP_HOST=host, SMTP_USER=user, SMTP_PASS=pw, SMTP_NAME=name)
    return {"ok": True}


def mail_ready():
    return bool(os.environ.get("SMTP_HOST"))


CODE_MIN = 10                          # 가입 인증 코드 유효시간
CODE_TRIES = 5


def signup_code(c, me, b, q):
    """가입 화면에서 이메일 소유를 확인할 6자리 코드를 보낸다. 같은 주소에 1분 안에 다시 보내지 않는다."""
    if not signup_open(c):
        raise Err(403, "지금은 새 회원을 받지 않습니다")
    if not mail_ready():
        raise Err(503, "지금은 메일을 보낼 수 없습니다. 학생회에 문의해 주십시오")
    email = school_email_of(b.get("email")).lower()
    if msg := taken_by(c, email=email):
        raise Err(409, msg)
    c.execute("DELETE FROM email_codes WHERE expires < ?", (now().isoformat(),))
    old = c.execute("SELECT sent_at FROM email_codes WHERE email=?", (email,)).fetchone()
    if old and old["sent_at"] > (now() - timedelta(seconds=60)).isoformat():
        raise Err(429, "방금 코드를 보냈습니다. 1분 뒤에 다시 눌러 주십시오")
    code = "".join(secrets.choice("0123456789") for _ in range(6))
    c.execute("INSERT OR REPLACE INTO email_codes VALUES(?,?,?,0,?)",
              (email, tok_hash(code), (now() + timedelta(minutes=CODE_MIN)).isoformat(), now().isoformat()))
    mail_later(email, "[SWITCH] 이메일 인증 코드",
               f"인증 코드는 {code} 입니다.\n{CODE_MIN}분 안에 가입 화면에 입력해 주십시오.\n\n가입하지 않으셨다면 이 메일은 무시하셔도 됩니다.",
               system_page("이메일 인증 코드", f"아래 코드를 {CODE_MIN}분 안에 가입 화면에 입력해 주십시오.", big=code,
                           note="가입하지 않으셨다면 이 메일은 무시하셔도 됩니다."))
    return {"ok": True}


def check_email_code(c, email, code):
    email = email.lower()
    r = c.execute("SELECT * FROM email_codes WHERE email=? AND expires > ?", (email, now().isoformat())).fetchone()
    if not r:
        raise Err(400, "인증 코드를 먼저 받아 주십시오")
    if r["tries"] >= CODE_TRIES:
        c.execute("DELETE FROM email_codes WHERE email=?", (email,))
        c.commit()
        raise Err(400, "코드를 여러 번 틀렸습니다. 코드를 다시 받아 주십시오")
    if not secrets.compare_digest(r["code"], tok_hash(str(code or "").strip())):
        c.execute("UPDATE email_codes SET tries=tries+1 WHERE email=?", (email,))
        c.commit()
        raise Err(400, "인증 코드가 맞지 않습니다")
    c.execute("DELETE FROM email_codes WHERE email=?", (email,))


def mail_prefs(c, me, b, q):
    for k in ("mail_dept", "mail_event"):
        if k in b:
            c.execute(f"UPDATE users SET {k}=? WHERE id=?", (1 if b[k] is True else 0, me["id"]))
    u = c.execute("SELECT * FROM users WHERE id=?", (me["id"],)).fetchone()
    return {"user": user_out(u)}


def mail_one(to, subject, text, page, unsub):
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = formataddr((os.environ.get("SMTP_NAME", "SWITCH 학생회"), os.environ["SMTP_USER"])), to, subject
    m["List-Unsubscribe"] = f"<{unsub}>"
    m["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    m.set_content(text)
    m.add_alternative(page, subtype="html")
    with smtplib.SMTP_SSL(os.environ["SMTP_HOST"], 465, timeout=30) as s:
        s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"])
        s.send_message(m)


MAIL_KEY_FILE = os.path.join(os.path.dirname(DB), "mail_key")
NOTICE_TEMPLATE = os.path.join(BASE, "mail_notice.html")


def mail_key():
    if not os.path.exists(MAIL_KEY_FILE):
        fd = os.open(MAIL_KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_hex(32))
    with open(MAIL_KEY_FILE) as f:
        return f.read().strip().encode()


def unsub_sig(upid, kind):
    return hmac.new(mail_key(), f"u:{upid}:{kind}".encode(), hashlib.sha256).hexdigest()[:32]


def unsub_ok(upid, kind, sig):
    return kind in ("dept", "event") and PID.fullmatch(str(upid)) is not None and hmac.compare_digest(str(sig), unsub_sig(upid, kind))


def unsub_link(upid, kind):
    return f"{ORIGIN}{PREFIX}/unsub?u={upid}&k={kind}&t={unsub_sig(upid, kind)}"


def notice_page(kind, title, summary, link, unsub):
    from string import Template
    with open(NOTICE_TEMPLATE, encoding="utf-8") as f:
        tpl = Template(f.read())
    e = htmllib.escape
    return tpl.substitute(
        title=e(title), label="행사 공지" if kind == "event" else "학과 공지", preview=e(summary or title)[:100],
        date=now().strftime("%Y년 %m월 %d일"), summary=e(summary).replace("\n", "<br>") if summary else "새 공지가 올라왔습니다. 전문은 아래 버튼에서 확인해 주십시오.",
        link=e(link), unsub=e(unsub))


def unsub_apply(c, upid, kind, sig):
    if not unsub_ok(upid, kind, sig):
        return False
    c.execute(f"UPDATE users SET mail_{kind}=0 WHERE pid=?", (upid,))
    return True


def mail_notices(c, rows):
    """새 공지를 받겠다고 한 회원에게 알린다. rows 는 (공지 pid, kind, title, summary). 사람마다 차단 링크가 달라 한 명씩 보낸다. 보내는 일은 따로 돌려 응답을 막지 않는다."""
    if not mail_ready() or not rows:
        return
    jobs = []
    for nid, kind, title, summary in rows:
        col = "mail_event" if kind == "event" else "mail_dept"
        label = "행사 공지" if kind == "event" else "학과 공지"
        link = f"{ORIGIN}{PREFIX}/#/notice/{nid}"
        for r in c.execute(f"SELECT pid, email FROM users WHERE {col}=1").fetchall():
            unsub = unsub_link(r["pid"], "event" if kind == "event" else "dept")
            text = (f"[{label}] {title}\n\n{summary}\n\n" if summary else f"[{label}] {title}\n\n") + \
                   f"전문 보기: {link}\n\n{label} 알림 차단: {unsub}"
            jobs.append((r["email"], f"[SWITCH] {title}"[:120], text, notice_page(kind, title, summary, link, unsub), unsub))

    def run():
        for job in jobs:
            try:
                mail_one(*job)
            except Exception as e:
                sys.stderr.write(f"notice mail failed: {e!r}\n")
    threading.Thread(target=run, daemon=True).start()


SYSTEM_TEMPLATE = os.path.join(BASE, "mail_system.html")


def system_page(title, intro, big=None, button=None, note=""):
    """인증 코드·비밀번호 찾기처럼 요청한 사람에게만 가는 안내 메일. 차단 버튼은 없다."""
    from string import Template
    with open(SYSTEM_TEMPLATE, encoding="utf-8") as f:
        tpl = Template(f.read())
    e = htmllib.escape
    extra = ""
    if big:
        extra += ('<tr><td align="center" style="padding:12px 28px;"><div style="display:inline-block;padding:16px 28px;border-radius:12px;background:#f0e7e5;'
                  f'font-size:32px;font-weight:700;letter-spacing:8px;color:#5b4545;">{e(big)}</div></td></tr>')
    if button:
        extra += ('<tr><td align="left" style="padding:12px 28px 8px 28px;"><a href="' + e(button[1]) + '" style="display:inline-block;padding:13px 26px;border-radius:10px;'
                  'background:#5b4545;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">' + e(button[0]) + '</a></td></tr>')
    return tpl.substitute(title=e(title), preview=e(title), intro=e(intro).replace("\n", "<br>"), extra=extra, note=e(note).replace("\n", "<br>"))


def mail_later(to, subject, body, page=None):
    # 응답을 기다리게 하지 않고, 걸린 시간·실패로 가입 여부가 드러나지 않게 따로 보낸다
    def run():
        try:
            send_mail(to, subject, body, page)
        except Exception as e:
            sys.stderr.write(f"mail to {to} failed: {e!r}\n")
    threading.Thread(target=run, daemon=True).start()


def forgot(c, me, b, q):
    """이메일로 아이디와 비밀번호 재설정 링크를 보낸다. 가입 여부와 상관없이 같은 답을 한다."""
    if not os.environ.get("SMTP_HOST"):
        raise Err(503, "지금은 메일을 보낼 수 없습니다. 학생회에 문의해 주십시오")
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
                   f"비밀번호를 바꾸려면 {RESET_MIN}분 안에 아래 링크를 여십시오.\n"
                   f"{ORIGIN}{PREFIX}/#/reset/{tok}\n\n요청하지 않았다면 이 메일은 무시하셔도 됩니다.",
                   system_page("아이디 / 비밀번호 찾기", f"{u['name']} 님, 아이디는 {u['username']} 입니다.\n비밀번호를 바꾸려면 {RESET_MIN}분 안에 아래 버튼을 누르십시오.",
                               button=("비밀번호 바꾸기", f"{ORIGIN}{PREFIX}/#/reset/{tok}"), note="요청하지 않았다면 이 메일은 무시하셔도 됩니다."))
    return {"ok": True}


def reset(c, me, b, q):
    r = c.execute("SELECT user_id FROM resets WHERE token=? AND expires > ?",
                  (tok_hash(str(b.get("token", ""))), now().isoformat())).fetchone()
    if not r:
        raise Err(400, "시간이 지났거나 이미 쓴 링크입니다. 다시 요청해 주십시오")
    pw = b.get("password") or ""
    if err := pw_error(pw):
        raise Err(400, err)
    c.execute("UPDATE users SET pw=? WHERE id=?", (hash_pw(pw), r["user_id"]))
    c.execute("DELETE FROM resets WHERE user_id=?", (r["user_id"],))
    c.execute("DELETE FROM sessions WHERE user_id=?", (r["user_id"],))   # 다른 기기의 로그인은 끊는다
    return new_session(c, r["user_id"])


def logout(c, me, b, q):
    return {"ok": True}, ""


def get_me(c, me, b, q):
    return {"user": user_out(me) if me else None, "signup_open": signup_open(c)}


# ── 물품 / QR ────────────────────────────────────────────────────────────

def scan(c, me, b, q):
    it = c.execute("SELECT * FROM items WHERE code=?", (str(b.get("code", "")).lower(),)).fetchone()
    if not it:
        raise Err(404, "학생회에 등록되지 않은 QR입니다")
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
    rl = rules(c)
    return {"items": [{"id": r["id"], "kind": r["kind"], "num": r["num"], "name": r["name"], "available": r["borrower_id"] is None,
                       "mine": r["borrower_id"] == me["id"], "borrowed_at": r["borrowed_at"],
                       "due": due_info(r["borrowed_at"], hours_of(rl, r["kind"] or r["name"]))[0] if r["borrower_id"] == me["id"] else None}
                      for r in rows]}


def rules(c):
    """물품 종류별 대여 기간(시간). 따로 정하지 않은 종류는 DEFAULT_HOURS."""
    return {r["kind"]: r["hours"] for r in c.execute("SELECT kind, hours FROM kind_hours")}


def hours_of(rl, kind):
    return rl.get(kind, DEFAULT_HOURS)


def due_info(out_at, hours):
    """대여 시각 + 기간 = 반납 기한. 반환: (기한 'YYYY-MM-DDTHH:MM', 지난 시간 — 안 지났으면 0, 지난 시간은 올림)"""
    if not out_at:
        return None, 0
    due = datetime.fromisoformat(out_at) + timedelta(hours=hours)
    over = (now() - due).total_seconds()
    return due.isoformat(timespec="minutes"), (int(-(-over // 3600)) if over > 0 else 0)


def admin_items(c, me, b, q):
    rows = c.execute("""SELECT i.id, i.code, i.kind, i.num, i.name, i.borrowed_at, u.name AS who, u.student_id
                        FROM items i LEFT JOIN users u ON u.id=i.borrower_id ORDER BY i.kind, i.num, i.id""").fetchall()
    rl, items_out = rules(c), []
    for r in rows:
        d = dict(r)
        d["hours"] = hours_of(rl, r["kind"] or r["name"])
        d["due"], d["late_hours"] = due_info(r["borrowed_at"], d["hours"]) if r["who"] else (None, 0)
        items_out.append(d)
    loans = c.execute("""SELECT l.out_at, l.in_at, i.name AS item, u.name AS who, u.student_id
                         FROM loans l JOIN items i ON i.id=l.item_id JOIN users u ON u.id=l.user_id
                         ORDER BY l.id DESC LIMIT 50""").fetchall()
    return {"items": items_out, "loans": [dict(r) for r in loans], "qr_sizes": QR_SIZES_CM,
            "default_hours": DEFAULT_HOURS,
            "rules": [{"kind": k, "hours": hours_of(rl, k)} for k in dict.fromkeys(r["kind"] or r["name"] for r in rows)]}


def admin_kind_hours(c, me, b, q):
    """종류별로 빌릴 수 있는 시간 설정. 비우면 기본(48시간)으로 돌아간다."""
    kind = s(b, "kind", 40)
    if not c.execute("SELECT 1 FROM items WHERE kind=?", (kind,)).fetchone():
        raise Err(404, "없는 물품 종류입니다. 새로고침해 주십시오")
    if b.get("hours") in (None, ""):
        c.execute("DELETE FROM kind_hours WHERE kind=?", (kind,))
        return {"ok": True, "hours": DEFAULT_HOURS}
    hours = need_int(b["hours"], 1, MAX_HOURS, "시간 수")
    c.execute("INSERT INTO kind_hours(kind,hours) VALUES(?,?) ON CONFLICT(kind) DO UPDATE SET hours=excluded.hours", (kind, hours))
    return {"ok": True, "hours": hours}


def admin_loans(c, me, b, q):
    """대여 기록 전부. 지운 물품의 기록은 ON DELETE CASCADE 로 같이 사라진다."""
    rows = c.execute("""SELECT l.id, l.item_id, l.out_at, l.in_at, i.kind, i.num, i.name AS item, i.code,
                               u.name AS who, u.student_id, u.email
                        FROM loans l JOIN items i ON i.id=l.item_id JOIN users u ON u.id=l.user_id
                        ORDER BY l.id DESC""").fetchall()
    rl, out = rules(c), []
    for r in rows:
        d = dict(r)
        d["hours"] = hours_of(rl, r["kind"] or r["item"])
        d["due"], d["late_hours"] = due_info(r["out_at"], d["hours"]) if not r["in_at"] else (None, 0)
        out.append(d)
    return {"loans": out}


def admin_item_add(c, me, b, q):
    """종류와 개수만 받는다 — 우산 3개면 '우산 1번~3번'. 같은 종류를 또 추가하면 다음 번호부터 이어진다."""
    kind = s(b, "kind", 40)
    try:
        count = int(b.get("count", 1))
    except (TypeError, ValueError):
        raise Err(400, "개수는 숫자로 써 주십시오")
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
            raise Err(500, "QR 코드를 만들지 못했습니다. 다시 시도해 주십시오")
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
        raise Err(400, "요청을 처리하지 못했습니다. 새로고침한 뒤 다시 시도해 주십시오")
    if size not in QR_SIZES_CM:
        raise Err(400, "고를 수 없는 QR 크기입니다")
    if not ids:
        raise Err(400, "인쇄할 물품을 골라 주십시오")
    rows = c.execute(f"SELECT code, name FROM items WHERE id IN ({','.join('?' * len(ids))}) ORDER BY kind, num, id", ids).fetchall()
    if not rows:
        raise Err(400, "인쇄할 물품을 골라 주십시오")
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

def room_rules(c):
    """세미나실 규칙. week_hours = 한 주(월~일)에 한 사람이 예약할 수 있는 최대 시간, cancel_hours = 시작 몇 시간 전까지 취소할 수 있는지. 0 = 제한 없음."""
    r = {x["key"]: x["value"] for x in c.execute("SELECT key, value FROM settings")}
    return {"week_hours": r.get("week_hours", 0), "cancel_hours": r.get("cancel_hours", 0)}


def monday(d):
    return (d - timedelta(days=d.weekday())).isoformat()


def week_used(c, user_id, d):
    """d 가 속한 주(월~일)에 이 사람이 이미 예약한 시간 수"""
    m = date.fromisoformat(monday(d))
    return c.execute("SELECT COUNT(*) FROM reservations WHERE user_id=? AND date BETWEEN ? AND ?",
                     (user_id, m.isoformat(), (m + timedelta(days=6)).isoformat())).fetchone()[0]


def admin_room_rules(c, me, b, q):
    if b:
        for k in ("week_hours", "cancel_hours"):
            v = need_int(b.get(k) or 0, 0, 24 * 7 if k == "week_hours" else 24 * 30, "시간 수")
            c.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, v))
    return room_rules(c)


def week(c, me, b, q):
    try:
        start = date.fromisoformat(q.get("start", [""])[0])
    except ValueError:
        start = now().date()
    end = start + timedelta(days=6)                   # 고른 날(기본 오늘)부터 7일
    admin = me and me["role"] in ("admin", "super")
    rows = c.execute("""SELECT r.id, r.room_id, r.date, r.hour, r.user_id, u.name, u.student_id
                        FROM reservations r JOIN users u ON u.id=r.user_id WHERE r.date BETWEEN ? AND ?""",
                     (start.isoformat(), end.isoformat())).fetchall()
    return {"start": start.isoformat(), "now": now().isoformat(),
            "rooms": [dict(r) for r in c.execute("SELECT * FROM rooms ORDER BY id")],
            "reservations": [{"id": r["id"], "room_id": r["room_id"], "date": r["date"], "hour": r["hour"],
                              "mine": bool(me and r["user_id"] == me["id"]),
                              "who": f"{r['name']} {r['student_id']}" if admin else mask(r["name"])} for r in rows],
            "rules": room_rules(c),
            "used": {m: n for m, n in c.execute("SELECT date, COUNT(*) FROM reservations WHERE user_id=? GROUP BY date", (me["id"],))} if me else {}}


def reserve(c, me, b, q):
    try:
        d = date.fromisoformat(str(b.get("date")))
        hours = sorted({int(h) for h in b.get("hours", [])})
        room = int(b.get("room_id"))
    except (TypeError, ValueError):
        raise Err(400, "요청을 처리하지 못했습니다. 새로고침한 뒤 다시 시도해 주십시오")
    if not hours or not all(0 <= h <= 23 for h in hours) or len(hours) > 24:
        raise Err(400, "예약할 시간을 골라 주십시오")
    if not c.execute("SELECT 1 FROM rooms WHERE id=?", (room,)).fetchone():
        raise Err(400, "없는 세미나실입니다")
    if datetime.combine(d, datetime.min.time()) + timedelta(hours=hours[0] + 1) <= now():
        raise Err(400, "지난 시간은 예약할 수 없습니다")
    cap = room_rules(c)["week_hours"]
    if cap and me["role"] not in ("admin", "super") and week_used(c, me["id"], d) + len(hours) > cap:
        raise Err(400, f"한 주에 {cap}시간까지만 예약할 수 있습니다")
    try:
        t = stamp()
        c.executemany("INSERT INTO reservations(room_id,user_id,date,hour,created_at) VALUES(?,?,?,?,?)",
                      [(room, me["id"], d.isoformat(), h, t) for h in hours])
    except sqlite3.IntegrityError:
        c.rollback()
        raise Err(409, "그사이 다른 사람이 예약한 시간이 있습니다. 다시 골라 주십시오")
    return {"ok": True}


def unreserve(c, me, b, q):
    """id 하나 또는 ids 목록(관리 사이트에서 이어진 시간을 한 번에)."""
    try:
        ids = [int(x) for x in (b.get("ids") or [b.get("id")])][:48]
    except (TypeError, ValueError):
        raise Err(400, "요청을 처리하지 못했습니다. 새로고침한 뒤 다시 시도해 주십시오")
    lead = room_rules(c)["cancel_hours"]
    admin = me["role"] in ("admin", "super")
    if lead and not admin:
        for i in ids:
            r = c.execute("SELECT date, hour FROM reservations WHERE id=? AND user_id=?", (i, me["id"])).fetchone()
            if r and datetime.fromisoformat(r["date"]) + timedelta(hours=r["hour"] - lead) < now():
                raise Err(400, f"시작 {lead}시간 전까지만 취소할 수 있습니다")
    for i in ids:
        if admin:
            c.execute("DELETE FROM reservations WHERE id=?", (i,))
        else:
            c.execute("DELETE FROM reservations WHERE id=? AND user_id=?", (i, me["id"]))
    return {"ok": True}


def admin_reservations(c, me, b, q):
    """지금 남아 있는 예약 전부(지난 날짜 포함). 같은 사람·방·날의 이어진 시간은 한 묶음으로."""
    rows = c.execute("""SELECT r.id, r.date, r.hour, r.created_at, m.name AS room, u.name AS who, u.student_id, u.email, r.user_id, r.room_id
                        FROM reservations r JOIN rooms m ON m.id=r.room_id JOIN users u ON u.id=r.user_id
                        ORDER BY r.date DESC, r.room_id, r.user_id, r.hour""").fetchall()
    out = []
    for r in rows:
        last = out[-1] if out else None
        if last and (last["date"], last["room_id"], last["user_id"]) == (r["date"], r["room_id"], r["user_id"]) \
                and last["end"] == r["hour"]:
            last["end"] = r["hour"] + 1
            last["ids"].append(r["id"])
            last["created_at"] = min(filter(None, (last["created_at"], r["created_at"])), default=None)
            continue
        out.append({"id": r["id"], "ids": [r["id"]], "date": r["date"], "start": r["hour"], "end": r["hour"] + 1, "room": r["room"],
                    "room_id": r["room_id"], "user_id": r["user_id"], "who": r["who"], "student_id": r["student_id"],
                    "email": r["email"], "created_at": r["created_at"]})
    for o in out:
        del o["room_id"], o["user_id"]
    return {"reservations": out, "rooms": [r["name"] for r in c.execute("SELECT name FROM rooms ORDER BY id")]}


def my_reservations(c, me, b, q):
    rows = c.execute("""SELECT r.id, r.date, r.hour, m.name AS room FROM reservations r JOIN rooms m ON m.id=r.room_id
                        WHERE r.user_id=? AND r.date >= ? ORDER BY r.date, r.hour""",
                     (me["id"], now().date().isoformat())).fetchall()
    return {"reservations": [dict(r) for r in rows], "rules": room_rules(c)}


# ── 행사 ────────────────────────────────────────────────────────────────

def load_fields(c, event_id):
    """행사의 신청서 질문을 순서대로. 질문마다 고유 번호(id)가 있어, 순서를 바꿔도 받아 둔 답이 어긋나지 않는다."""
    opts = {}
    for o in c.execute("""SELECT o.question_id, o.label FROM question_options o JOIN questions q ON q.id=o.question_id
                          WHERE q.event_id=? ORDER BY o.position""", (event_id,)):
        opts.setdefault(o["question_id"], []).append(o["label"])
    out = []
    for q in c.execute("SELECT * FROM questions WHERE event_id=? ORDER BY position, id", (event_id,)):
        f = {"id": q["id"], "label": q["label"], "type": q["type"], "required": bool(q["required"])}
        if q["type"] in ("select", "dropdown", "multi"):
            f["options"] = opts.get(q["id"], [])
        out.append(f)
    return out


def save_fields(c, event_id, fields):
    """질문 목록을 저장한다. id 가 있는 질문은 그대로 고치고(답 유지), 없는 질문은 새로 만들고, 빠진 질문은 답과 함께 지운다."""
    have = {r["id"]: r["type"] for r in c.execute("SELECT id, type FROM questions WHERE event_id=?", (event_id,))}
    seen = set()
    for f in fields:                                         # 같은 번호가 두 번 오면 첫 번째만 기존 질문, 나머지는 새 질문
        if f.get("id") in seen or f.get("id") not in have:
            f.pop("id", None)
        else:
            seen.add(f["id"])
    keep = set(seen)
    for qid in set(have) - keep:
        c.execute("DELETE FROM questions WHERE id=?", (qid,))
    for pos, f in enumerate(fields):
        qid = f.get("id") if f.get("id") in have else None
        if qid:
            if have[qid] != f["type"]:                       # 질문 종류가 바뀌면 옛 답은 뜻이 없어진다
                c.execute("DELETE FROM answers WHERE question_id=?", (qid,))
            c.execute("UPDATE questions SET position=?, label=?, type=?, required=? WHERE id=?",
                      (pos, f["label"], f["type"], 1 if f["required"] else 0, qid))
            c.execute("DELETE FROM question_options WHERE question_id=?", (qid,))
        else:
            qid = c.execute("INSERT INTO questions(event_id,position,label,type,required) VALUES(?,?,?,?,?)",
                            (event_id, pos, f["label"], f["type"], 1 if f["required"] else 0)).lastrowid
        for op, o in enumerate(f.get("options", [])):
            c.execute("INSERT INTO question_options(question_id,position,label) VALUES(?,?,?)", (qid, op, o))
        if f.get("options") is not None:                      # 보기에서 빠진 항목을 고른 답은 지운다
            c.execute("DELETE FROM answers WHERE question_id=? AND value NOT IN (SELECT label FROM question_options WHERE question_id=?)"
                      " AND ? IN ('select','dropdown','multi')", (qid, qid, f["type"]))


def answer_values(f, v):
    """답 하나를 저장할 값 목록으로. 체크는 '1'/'0', 여러 개 고르기는 고른 보기마다 하나씩, 나머지는 글 하나."""
    if f["type"] == "checkbox":
        return ["1" if v else "0"]
    if f["type"] == "multi":
        return [x for x in (v if isinstance(v, list) else ([v] if isinstance(v, str) and v else [])) if isinstance(x, str)]
    return [v if isinstance(v, str) else ""]


def answers_of(c, app_ids, fields_by_event, events_of):
    """신청 여러 건의 답을 {신청 id: {'0': 값, '1': 값…}}(질문 순서 번호 기준)으로. 화면은 예전과 같은 모양을 받는다."""
    if not app_ids:
        return {}
    got = {}
    for r in c.execute(f"SELECT application_id, question_id, value FROM answers WHERE application_id IN ({','.join('?' * len(app_ids))}) ORDER BY id", app_ids):
        got.setdefault((r["application_id"], r["question_id"]), []).append(r["value"])
    out = {}
    for aid in app_ids:
        res = {}
        for pos, f in enumerate(fields_by_event[events_of[aid]]):
            vals = got.get((aid, f["id"]), [])
            res[str(pos)] = (vals[:1] == ["1"]) if f["type"] == "checkbox" else vals if f["type"] == "multi" else (vals[0] if vals else "")
        out[aid] = res
    return out


def save_answers(c, app_id, fields, ans):
    """질문마다 답 한 줄씩(여러 개 고르기는 고른 보기마다 한 줄) 저장한다. ans 는 check_answers 를 거친 {'0': 값…}."""
    c.execute("DELETE FROM answers WHERE application_id=?", (app_id,))
    for pos, f in enumerate(fields):
        for v in answer_values(f, ans.get(str(pos))):
            c.execute("INSERT INTO answers(application_id,question_id,value) VALUES(?,?,?)", (app_id, f["id"], v))


def event_out(c, e):
    d = dict(e, id=e["pid"])
    del d["pid"]
    d["fields"] = load_fields(c, e["id"])
    d["on_lobby"] = bool(e["on_lobby"])
    d["dues_only"] = bool(e["dues_only"])
    d["closed"] = parse_dt(e["deadline"], "마감") <= now()
    return d


def count_of(c, e):
    return c.execute("SELECT COUNT(*) FROM applications WHERE event_id=?", (e["id"],)).fetchone()[0]


def gauge(c, e):
    """공개해도 되는 신청 현황. show_count=0 이면 n 을 뺀다. 정원이 없으면 capacity=None."""
    n, cap = count_of(c, e), e["capacity"]
    return {"id": e["pid"], "title": e["title"], "deadline": e["deadline"], "capacity": cap,
            "n": n if e["show_count"] else None, "show_count": bool(e["show_count"]),
            "full": cap is not None and n >= cap, "closed": parse_dt(e["deadline"], "마감") <= now()}


def events(c, me, b, q):
    rows = c.execute("SELECT * FROM events WHERE on_lobby=1 ORDER BY deadline DESC").fetchall()
    mine = {r[0] for r in c.execute("SELECT event_id FROM applications WHERE user_id=?", (me["id"],))} if me else set()
    return {"events": [dict(event_out(c, e), applied=e["id"] in mine, gauge=gauge(c, e)) for e in rows]}


def event(c, me, b, q):
    e = by_pid(c, "events", q.get("id", [""])[0])
    if not e:
        raise Err(404, "없는 행사입니다")
    a = c.execute("SELECT id, updated_at FROM applications WHERE event_id=? AND user_id=?", (e["id"], me["id"])).fetchone()
    nt = c.execute("SELECT pid FROM notices WHERE event_id=? ORDER BY id DESC LIMIT 1", (e["id"],)).fetchone()
    return {"event": event_out(c, e), "gauge": gauge(c, e), "notice_id": nt["pid"] if nt else None,
            "application": {"answers": answers_of(c, [a["id"]], {e["id"]: load_fields(c, e["id"])}, {a["id"]: e["id"]})[a["id"]], "updated_at": a["updated_at"]} if a else None}


def check_answers(fields, ans):
    if not isinstance(ans, dict):
        raise Err(400, "요청을 처리하지 못했습니다. 새로고침한 뒤 다시 시도해 주십시오")
    out = {}
    for i, f in enumerate(fields):
        v = ans.get(str(i))
        if f["type"] == "checkbox":
            v = bool(v)
            if f.get("required") and not v:
                raise Err(400, f"'{f['label']}'에 체크해 주십시오")
        elif f["type"] == "multi":
            picked = v if isinstance(v, list) else ([v] if isinstance(v, str) and v else [])
            if any(not isinstance(x, str) or x not in f.get("options", []) for x in picked):
                raise Err(400, f"'{f['label']}'에서 보기 중에서만 골라 주십시오")
            v = [o for o in f.get("options", []) if o in picked]       # 보기 순서대로, 중복 없이
            if f.get("required") and not v:
                raise Err(400, f"'{f['label']}'에서 하나 이상 골라 주십시오")
        else:
            v = v.strip() if isinstance(v, str) else ""
            if f.get("required") and not v:
                raise Err(400, f"'{f['label']}' 칸을 채워 주십시오")
            lim = 2000 if f["type"] == "long" else 1000
            if len(v) > lim:
                raise Err(400, f"'{f['label']}' 칸은 {lim:,}자까지 쓸 수 있습니다")
            if f["type"] in ("select", "dropdown") and v and v not in f.get("options", []):
                raise Err(400, f"'{f['label']}'에서 보기 중 하나를 골라 주십시오")
        out[str(i)] = v
    return out


def apply(c, me, b, q):
    e = by_pid(c, "events", b.get("event_id"))
    if not e:
        raise Err(404, "없는 행사입니다")
    if parse_dt(e["deadline"], "마감") <= now():
        raise Err(403, "신청이 마감된 행사입니다")
    already = c.execute("SELECT 1 FROM applications WHERE event_id=? AND user_id=?", (e["id"], me["id"])).fetchone()
    if e["dues_only"] and not me["dues"] and not already:     # 이미 신청한 사람은 고칠 수 있다
        raise Err(403, "학생회비 납부자만 신청할 수 있습니다. 납부했는데 이 글이 보이면 학생회에 알려 주십시오")
    fields = load_fields(c, e["id"])
    ans = check_answers(fields, b.get("answers", {}))
    c.execute("BEGIN IMMEDIATE")          # 정원 확인과 저장 사이에 다른 신청이 끼어들지 못하게
    mine = c.execute("SELECT 1 FROM applications WHERE event_id=? AND user_id=?", (e["id"], me["id"])).fetchone()
    if not mine and e["capacity"] is not None and count_of(c, e) >= e["capacity"]:
        raise Err(409, "정원이 다 찼습니다")
    t = stamp()
    c.execute("""INSERT INTO applications(event_id,user_id,updated_at,created_at) VALUES(?,?,?,?)
                 ON CONFLICT(event_id,user_id) DO UPDATE SET updated_at=excluded.updated_at""", (e["id"], me["id"], t, t))
    save_answers(c, c.execute("SELECT id FROM applications WHERE event_id=? AND user_id=?", (e["id"], me["id"])).fetchone()["id"], fields, ans)
    return {"ok": True}


def apply_cancel(c, me, b, q):
    e = by_pid(c, "events", b.get("event_id"))
    if not e:
        raise Err(404, "없는 행사입니다")
    if parse_dt(e["deadline"], "마감") <= now():
        raise Err(403, "마감된 뒤에는 신청을 취소할 수 없습니다. 학생회에 문의해 주십시오")
    if not c.execute("DELETE FROM applications WHERE event_id=? AND user_id=?", (e["id"], me["id"])).rowcount:
        raise Err(404, "신청한 내용이 없습니다")
    return {"ok": True}


def check_fields(fields):
    if not isinstance(fields, list) or len(fields) > 30:
        raise Err(400, "신청서 질문을 다시 확인해 주십시오")
    out = []
    for f in fields:
        if not isinstance(f, dict) or f.get("type") not in ("text", "long", "select", "dropdown", "multi", "checkbox"):
            raise Err(400, "신청서 질문을 다시 확인해 주십시오")
        label = s(f, "label", 100)
        g = {"label": label, "type": f["type"], "required": bool(f.get("required"))}
        if isinstance(f.get("id"), int):
            g["id"] = f["id"]
        if f["type"] in ("select", "dropdown", "multi"):
            opts = [str(o).strip()[:100] for o in f.get("options", []) if str(o).strip()]
            if not opts:
                raise Err(400, f"'{label}' 질문의 보기를 적어 주십시오")
            g["options"] = opts
        out.append(g)
    return out


def admin_events(c, me, b, q):
    rows = c.execute("""SELECT e.*, (SELECT COUNT(*) FROM applications a WHERE a.event_id=e.id) AS n
                        FROM events e ORDER BY e.id DESC""").fetchall()
    return {"events": [dict(event_out(c, e), n=e["n"]) for e in rows]}   # 관리자에겐 show_count 와 상관없이 실제 n


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
            raise Err(400, "정원은 숫자로 써 주십시오")
        if not 1 <= cap <= 100000:
            raise Err(400, "정원은 1명 이상이어야 합니다")
    vals = (s(b, "title", 100), s(b, "body", 5000, required=False), starts, deadline,
            1 if b.get("on_lobby") else 0,
            cap, 0 if b.get("show_count") is False else 1, 1 if b.get("dues_only") else 0)
    fields = check_fields(b.get("fields", []))
    if b.get("id"):
        eid = id_of(c, "events", b["id"])
        if not eid:
            raise Err(404, "없는 행사입니다")
        c.execute("UPDATE events SET title=?, body=?, starts_at=?, deadline=?, on_lobby=?, capacity=?, show_count=?, dues_only=? WHERE id=?", vals + (eid,))
    else:
        eid = c.execute("INSERT INTO events(pid,title,body,starts_at,deadline,on_lobby,capacity,show_count,dues_only) VALUES(?,?,?,?,?,?,?,?,?)", (new_pid(),) + vals).lastrowid
    save_fields(c, eid, fields)
    return {"ok": True}


def admin_event_del(c, me, b, q):
    c.execute("DELETE FROM events WHERE pid=?", (str(b.get("id") or ""),))
    return {"ok": True}


def admin_applications(c, me, b, q):
    """id 가 있으면 그 행사, 없으면 모든 행사의 신청을 한 번에."""
    e = by_pid(c, "events", q.get("id", [""])[0]) if q.get("id", [""])[0] else None
    if q.get("id", [""])[0] and not e:
        raise Err(404, "없는 행사입니다")
    eid = e["id"] if e else None
    if e:
        evs = [e]
    else:
        evs = c.execute("SELECT * FROM events ORDER BY id DESC").fetchall()
    rows = c.execute(f"""SELECT a.id, a.user_id, (SELECT pid FROM events WHERE id=a.event_id) AS event_id, u.name, u.student_id, u.email, u.dues, a.updated_at, a.created_at FROM applications a
                         JOIN users u ON u.id=a.user_id {'WHERE a.event_id=?' if eid else ''} ORDER BY a.id""",
                     (eid,) if eid else ()).fetchall()
    out = {"events": [event_out(c, e) for e in evs]}
    ans = answers_of(c, [r["id"] for r in rows], {e["id"]: e["fields"] for e in out["events"]}, {r["id"]: r["event_id"] for r in rows})
    out["applications"] = [dict(r, answers=ans[r["id"]]) for r in rows]
    if eid:
        out["event"] = out["events"][0]
    return out


# ── 공지 · 배너 ─────────────────────────────────────────────────────────
# 행사 공지와 로비 배너에 오른 공지는 비로그인도 읽는다. 나머지 학과 공지는 로그인해야 목록·본문이 보인다.

TABS = ("home", "notices", "events", "reserve", "loans")


def readable(me, n):
    return bool(me) or n["kind"] == "event" or bool(n["on_lobby"])


def notice_out(c, n, full=False):
    d = {"id": n["pid"], "kind": n["kind"], "title": n["title"], "summary": n["summary"], "on_lobby": bool(n["on_lobby"]),
         "chips": json.loads(n["chips"]), "created_at": n["created_at"], "event_id": None}
    u = c.execute("SELECT name FROM users WHERE id=?", (n["author_id"],)).fetchone()
    d["author"] = u["name"] if u else ""
    e = c.execute("SELECT * FROM events WHERE id=?", (n["event_id"],)).fetchone() if n["event_id"] else None
    d["event"] = gauge(c, e) if e else None
    d["event_id"] = e["pid"] if e else None
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
        out.append({"type": "event", "id": e["pid"], "kind": "event", "title": e["title"],
                    "summary": e["body"].split("\n", 1)[0][:100], "starts_at": e["starts_at"], "event": g,
                    "chips": [{"label": "참여 신청", "type": "event", "target": e["pid"]}]})
    return {"banners": out}


def notices(c, me, b, q):
    kind = q.get("kind", [""])[0]
    if kind not in ("", "dept", "event"):
        raise Err(400, "공지 분류를 다시 골라 주십시오")
    if kind == "dept" and not me:
        raise Err(401, "로그인해 주십시오")
    sql, args = "SELECT * FROM notices", []
    if kind:
        sql, args = sql + " WHERE kind=?", [kind]
    elif not me:
        sql += " WHERE kind='event'"
    return {"notices": [notice_out(c, n) for n in c.execute(sql + " ORDER BY id DESC LIMIT 200", args)]}


def notice(c, me, b, q):
    n = by_pid(c, "notices", q.get("id", [""])[0])
    if not me and not (n and readable(me, n)):     # 비로그인에겐 없는 글과 막힌 글이 같은 답
        raise Err(401, "로그인해 주십시오")
    if not n:
        raise Err(404, "없는 공지입니다")
    vis = "" if me else " AND kind='event'"
    prev = c.execute(f"SELECT pid AS id,title FROM notices WHERE id<?{vis} ORDER BY id DESC LIMIT 1", (n["id"],)).fetchone()
    nxt = c.execute(f"SELECT pid AS id,title FROM notices WHERE id>?{vis} ORDER BY id LIMIT 1", (n["id"],)).fetchone()
    return {"notice": notice_out(c, n, full=True), "prev": dict(prev) if prev else None, "next": dict(nxt) if nxt else None}


def check_chips(c, chips):
    if not isinstance(chips, list) or len(chips) > 6:
        raise Err(400, "바로가기 버튼은 6개까지 달 수 있습니다")
    out = []
    for ch in chips:
        if not isinstance(ch, dict):
            raise Err(400, "바로가기 버튼을 다시 확인해 주십시오")
        label, typ, target = s(ch, "label", 30, label="버튼 글"), ch.get("type"), str(ch.get("target", "")).strip()
        if typ == "tab":
            ok = target in TABS
        elif typ == "event":
            ok = by_pid(c, "events", target) is not None
        elif typ == "notice":
            ok = by_pid(c, "notices", target) is not None
        elif typ == "url":
            ok = re.fullmatch(r"https?://[^\s]{1,500}", target) is not None
        else:
            ok = False
        if not ok:
            raise Err(400, f"'{label}' 버튼이 갈 곳을 다시 골라 주십시오")
        out.append({"label": label, "type": typ, "target": target})
    return out


def admin_notices(c, me, b, q):
    return {"notices": [notice_out(c, n) for n in c.execute("SELECT * FROM notices ORDER BY id DESC")]}


def admin_notice(c, me, b, q):
    n = by_pid(c, "notices", q.get("id", [""])[0])
    if not n:
        raise Err(404, "없는 공지입니다")
    return {"notice": notice_out(c, n, full=True)}


def admin_notice_save(c, me, b, q):
    kind = b.get("kind")
    if kind not in ("dept", "event"):
        raise Err(400, "공지 분류를 다시 골라 주십시오")
    eid = id_of(c, "events", b.get("event_id")) if b.get("event_id") else None
    if b.get("event_id") and not eid:
        raise Err(400, "연결한 행사가 지워졌습니다. 다른 행사를 골라 주십시오")
    vals = (kind, s(b, "title", 100), s(b, "summary", 100, required=False), s(b, "body", 20000, required=False),
            json.dumps(check_chips(c, b.get("chips", [])), ensure_ascii=False), eid, 1 if b.get("on_lobby") else 0)
    if b.get("id"):
        if not c.execute("UPDATE notices SET kind=?, title=?, summary=?, body=?, chips=?, event_id=?, on_lobby=? WHERE pid=?",
                         vals + (str(b["id"]),)).rowcount:
            raise Err(404, "없는 공지입니다")
    else:
        pid = new_pid()
        c.execute("INSERT INTO notices(pid,kind,title,summary,body,chips,event_id,on_lobby,author_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                  (pid,) + vals + (me["id"], stamp()))
        mail_notices(c, [(pid, kind, vals[1], vals[2])])
    return {"ok": True}


def admin_notice_del(c, me, b, q):
    c.execute("DELETE FROM notices WHERE pid=?", (str(b.get("id") or ""),))
    return {"ok": True}


# ── 학과 홈페이지 공지 가져오기 ─────────────────────────────────────────
# 반도체융합공학과 홈페이지 메인에는 최신 공지 4건이 본문 전문과 함께 나온다(글 상세 페이지는 로그인 벽).
# 새 글만 학과 공지로 넣는다. 한 번 가져온 글은 pulled 에 적어 두어, 관리자가 지워도 다시 들어오지 않는다.

SCE_INDEX = os.environ.get("COUNCIL_SCE_URL", "https://sce.skku.edu/sce/index.do")
SCE_EVERY = int(os.environ.get("COUNCIL_SCE_MINUTES", 30)) * 60       # 0 이면 가져오지 않음


def tidy_body(text):
    """홈페이지 본문은 한 줄로 이어 붙어 있다. '1. 신청' 같은 번호와 ' - ' 항목 앞에서 줄을 나눈다."""
    text = re.sub(r"\s+(?=\d{1,2}\. [가-힣])", "\n\n", text)
    text = re.sub(r"\s+[-*] (?=\S)", "\n- ", text)   # * 주석은 마크다운에서 기울임이 되므로 항목으로
    return text.strip()


def parse_sce(page):
    """메인 페이지 → [{no, category, title, date, body, url}] (최신 먼저). 구조가 달라지면 빈 목록."""
    i = page.find("mini-type01")
    if i < 0:
        return []
    block = page[i:page.find("</ul>", i)]
    out = []
    for li in block.split("<li>")[1:]:
        def pick(pat):
            m = re.search(pat, li, re.S)
            return " ".join(htmllib.unescape(re.sub(r"<[^>]+>", " ", m.group(1))).split()) if m else ""
        m = re.search(r'mini-board-content-title">\s*<a href="([^"]*articleNo=(\d+)[^"]*)"', li)
        if not m:
            continue
        title = pick(r'mini-board-content-title">(.*?)</p>')
        body = pick(r'mini-board-content-inner">(.*?)</p>')
        if body.startswith(title):
            body = body[len(title):].strip()
        url = urljoin_sce(htmllib.unescape(m.group(1)))
        out.append({"no": int(m.group(2)), "category": pick(r'mini-board-category">(.*?)</span>'), "title": title,
                    "date": pick(r'mini-board-date">(.*?)</span>'), "body": tidy_body(body), "url": url})
    return out


def urljoin_sce(href):
    return href if href.startswith("http") else re.match(r"https?://[^/]+", SCE_INDEX).group(0) + href


def import_sce(c, articles):
    """새 글만 학과 공지로 넣는다. 오래된 글부터 넣어 목록에서 최신이 위로 온다. 넣은 개수를 돌려준다."""
    n = 0
    fresh = []
    for a in reversed(articles):
        src = f"sce:{a['no']}"
        if c.execute("SELECT 1 FROM pulled WHERE src=?", (src,)).fetchone() or not a["title"]:
            continue
        d = a["date"] if re.fullmatch(r"\d{4}-\d\d-\d\d", a["date"]) else stamp()[:10]
        body = a["body"][:20000]
        summary = (body.split("\n", 1)[0] if body else "")[:100]
        chips = [{"label": "학과 홈페이지에서 보기", "type": "url", "target": a["url"]}] if re.fullmatch(r"https?://[^\s]{1,500}", a["url"]) else []
        title = ("[%s] %s" % (a["category"], a["title"]) if a["category"] else a["title"])[:100]
        pid = new_pid()
        c.execute("INSERT INTO notices(pid,kind,title,summary,body,chips,on_lobby,author_id,created_at) VALUES(?,'dept',?,?,?,?,0,NULL,?)",
                  (pid, title, summary, body, json.dumps(chips, ensure_ascii=False), d + "T00:00"))
        c.execute("INSERT INTO pulled(src,at) VALUES(?,?)", (src, stamp()))
        fresh.append((pid, "dept", title, summary))
        n += 1
    mail_notices(c, fresh[-5:])
    return n


def pull_sce():
    req = Request(SCE_INDEX, headers={"User-Agent": "Mozilla/5.0 (council)"})
    with urlopen(req, timeout=20) as r:
        page = r.read().decode("utf-8", "replace")
    arts = parse_sce(page)
    if not arts:
        raise RuntimeError("학과 홈페이지 공지 목록을 찾지 못했습니다 (페이지 모양이 바뀐 듯)")
    with connect() as c:
        return import_sce(c, arts)


def sce_loop():
    while True:
        try:
            n = pull_sce()
            if n:
                print(f"학과 공지 {n}건 가져옴", flush=True)
        except Exception as e:  # noqa: BLE001 — 학교 서버가 잠깐 안 돼도 다음 차례에 다시
            print(f"학과 공지 가져오기 실패: {e}", file=sys.stderr, flush=True)
        time.sleep(SCE_EVERY)


# ── 사용자 (최고 관리자) ────────────────────────────────────────────────

def admin_users(c, me, b, q):
    """관리자는 회원 목록을 읽기만 한다. 관리자 지정(admin_role)은 최고 관리자만."""
    rows = c.execute("SELECT * FROM users ORDER BY role='user', name").fetchall()
    return {"users": [dict(user_out(u), id=u["id"], created_at=u["created_at"]) for u in rows], "signup_open": signup_open(c)}


def admin_dues(c, me, b, q):
    """학생회비 납부 여부 표시. ids 목록을 한 번에 바꿀 수 있다."""
    try:
        ids = [int(x) for x in b.get("ids") or []][:5000]
    except (TypeError, ValueError):
        raise Err(400, "요청을 처리하지 못했습니다. 새로고침한 뒤 다시 시도해 주십시오")
    if not ids:
        raise Err(400, "바꿀 회원을 골라 주십시오")
    c.executemany("UPDATE users SET dues=? WHERE id=?", [(1 if b.get("dues") else 0, i) for i in ids])
    return {"ok": True}


def need_int(v, lo, hi, what):
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise Err(400, f"{josa(what, '은', '는')} 숫자로 써 주십시오")
    if not lo <= n <= hi:
        raise Err(400, f"{josa(what, '은', '는')} {lo}~{hi} 사이로 써 주십시오")
    return n


def when_or_none(v, what):
    """비운 칸은 None, 아니면 'YYYY-MM-DDTHH:MM' 으로 바로잡아 돌려준다."""
    return parse_dt(v, what).isoformat(timespec="minutes") if v not in (None, "") else None


LOCKED = ("username", "name", "student_id", "email")     # 계정을 가리키는 칸 — 이메일을 바꾸면 비밀번호 찾기로 그 계정을 차지할 수 있다


def edit_users(c, id, v, me=None):
    sets, args = [], []
    if me is not None and any(k in v for k in LOCKED):
        if me["role"] != "super":
            raise Err(403, "아이디·이름·학번·이메일은 최고 관리자만 고칠 수 있습니다")
        target = c.execute("SELECT role FROM users WHERE id=?", (id,)).fetchone()
        if target and target["role"] != "user":
            raise Err(403, "관리자 계정의 아이디·이름·학번·이메일은 여기서 고칠 수 없습니다")
    if "username" in v:
        un = s(v, "username", 32)
        if not re.fullmatch(r"[A-Za-z0-9_.-]{3,32}", un):
            raise Err(400, "아이디는 영문과 숫자로 3~32자를 써 주십시오")
        if c.execute("SELECT 1 FROM users WHERE username=? AND id!=?", (un, id)).fetchone():
            raise Err(409, "이미 쓰고 있는 아이디입니다")
        sets.append("username=?"); args.append(un)
    if "created_at" in v: sets.append("created_at=?"); args.append(when_or_none(v["created_at"], "가입"))
    if "name" in v: sets.append("name=?"); args.append(s(v, "name", 40))
    sid = student_id_of(v["student_id"]) if "student_id" in v else None
    mail = school_email_of(s(v, "email", 120)) if "email" in v else None
    if msg := taken_by(c, id, mail, sid):
        raise Err(409, msg)
    if sid: sets.append("student_id=?"); args.append(sid)
    if mail: sets.append("email=?"); args.append(mail)
    if "phone" in v: sets.append("phone=?"); args.append(phone_of(v["phone"], required=False))
    if "dues" in v: sets.append("dues=?"); args.append(1 if v["dues"] else 0)
    return "users", sets, args


def edit_items(c, id, v):
    """종류·번호·QR 코드. 이름('우산 3번')은 종류와 번호에서 다시 만든다. 대여 상태는 대여 기록에서 고친다."""
    it = c.execute("SELECT num, kind, code FROM items WHERE id=?", (id,)).fetchone()
    if not it:
        raise Err(404, "삭제된 물품이 있습니다. 새로고침해 주십시오")
    kind = s(v, "kind", 40) if "kind" in v else it["kind"]
    num = (None if v["num"] in (None, "") else need_int(v["num"], 1, 9999, "번호")) if "num" in v else it["num"]
    sets, args = ["kind=?", "num=?", "name=?"], [kind, num, f"{kind} {num}번" if num else kind]
    if c.execute("SELECT 1 FROM items WHERE kind=? AND num IS ? AND id!=?", (kind, num, id)).fetchone():
        raise Err(409, f"{kind} {num}번은 이미 있습니다" if num else f"{kind}은 이미 있습니다")
    if "code" in v:
        code = s(v, "code", 12).lower()
        if not re.fullmatch(r"[a-z0-9]{4,12}", code):
            raise Err(400, "QR 코드는 영문 소문자와 숫자 4~12자로 써 주십시오")
        if c.execute("SELECT 1 FROM items WHERE code=? AND id!=?", (code, id)).fetchone():
            raise Err(409, "이미 쓰고 있는 QR 코드입니다")
        sets.append("code=?"); args.append(code)
    c.execute("INSERT OR IGNORE INTO kind_hours SELECT ?, hours FROM kind_hours WHERE kind=?", (kind, it["kind"]))   # 새 종류로 옮겨도 대여 시간을 따라간다
    return "items", sets, args


def edit_events(c, id, v):
    sets, args = [], []
    if "title" in v: sets.append("title=?"); args.append(s(v, "title", 100))
    if "starts_at" in v:
        sets.append("starts_at=?"); args.append(parse_dt(v["starts_at"], "일시").isoformat(timespec="minutes") if v["starts_at"] else "")
    if "deadline" in v: sets.append("deadline=?"); args.append(parse_dt(v["deadline"], "마감").isoformat(timespec="minutes"))
    if "capacity" in v:
        sets.append("capacity=?"); args.append(None if v["capacity"] in (None, "", 0, "0") else need_int(v["capacity"], 1, 100000, "정원"))
    if "on_lobby" in v: sets.append("on_lobby=?"); args.append(1 if v["on_lobby"] else 0)
    if "dues_only" in v: sets.append("dues_only=?"); args.append(1 if v["dues_only"] else 0)
    return "events", sets, args


def edit_notices(c, id, v):
    sets, args = [], []
    if "title" in v: sets.append("title=?"); args.append(s(v, "title", 100))
    if "on_lobby" in v: sets.append("on_lobby=?"); args.append(1 if v["on_lobby"] else 0)
    if "summary" in v: sets.append("summary=?"); args.append(s(v, "summary", 100, required=False))
    if "kind" in v:
        if v["kind"] not in ("dept", "event"):
            raise Err(400, "공지 분류를 다시 골라 주십시오")
        sets.append("kind=?"); args.append(v["kind"])
    if "created_at" in v:
        when = when_or_none(v["created_at"], "작성")
        if not when:
            raise Err(400, "작성일자는 비울 수 없습니다")
        sets.append("created_at=?"); args.append(when)
    return "notices", sets, args


def edit_apps(c, id, v):
    """신청자 표: 학생회비 납부 체크(회원 정보)와 신청서 답변(f0, f1, …)을 고친다."""
    a = c.execute("SELECT a.user_id, a.event_id FROM applications a WHERE a.id=?", (id,)).fetchone()
    if not a:
        raise Err(404, "삭제된 항목이 있습니다. 새로고침해 주십시오")
    if "dues" in v:
        c.execute("UPDATE users SET dues=? WHERE id=?", (1 if v["dues"] else 0, a["user_id"]))
    new = {k[1:]: val for k, val in v.items() if re.fullmatch(r"f\d+", k)}
    if new:
        fields = load_fields(c, a["event_id"])
        if any(int(i) >= len(fields) for i in new):
            raise Err(400, "요청을 처리하지 못했습니다. 새로고침한 뒤 다시 시도해 주십시오")
        ans = answers_of(c, [id], {a["event_id"]: fields}, {id: a["event_id"]})[id]
        ans.update(new)
        save_answers(c, id, fields, check_answers(fields, ans))
    sets, args = [], []
    if "created_at" in v: sets.append("created_at=?"); args.append(when_or_none(v["created_at"], "신청"))
    if "updated_at" in v:
        when = when_or_none(v["updated_at"], "수정")
        sets.append("updated_at=?"); args.append(when or c.execute("SELECT COALESCE(created_at, updated_at) FROM applications WHERE id=?", (id,)).fetchone()[0])
    return "applications", sets, args


def user_by_label(c, label):
    """표에 보이는 '이름 (학번)' 으로 회원 한 명을 찾는다."""
    m = re.fullmatch(r"(.+) \((.+)\)", str(label).strip())
    rows = c.execute("SELECT id FROM users WHERE name=? AND student_id=?", (m[1], m[2])).fetchall() if m else []
    if len(rows) != 1:
        raise Err(400, "회원을 다시 골라 주십시오")
    return rows[0][0]


def sync_item(c, item_id):
    """물품의 '지금 빌린 사람'을 아직 반납하지 않은 대여 기록에 맞춘다."""
    o = c.execute("SELECT user_id, out_at FROM loans WHERE item_id=? AND in_at IS NULL ORDER BY id DESC LIMIT 1", (item_id,)).fetchone()
    c.execute("UPDATE items SET borrower_id=?, borrowed_at=? WHERE id=?", (o["user_id"], o["out_at"], item_id) if o else (None, None, item_id))


def edit_loans(c, id, v):
    """대여 기록: 물품·대여자·대여일자·반납일자. 반납일자를 비우면 아직 빌려 간 상태가 된다."""
    ln = c.execute("SELECT * FROM loans WHERE id=?", (id,)).fetchone()
    if not ln:
        raise Err(404, "삭제된 항목이 있습니다. 새로고침해 주십시오")
    out = when_or_none(v["out_at"], "대여") if "out_at" in v else ln["out_at"]
    back = when_or_none(v["in_at"], "반납") if "in_at" in v else ln["in_at"]
    if not out:
        raise Err(400, "대여일자는 비울 수 없습니다")
    if back and back < out:
        raise Err(400, "반납일자가 대여일자보다 빠릅니다")
    uid = user_by_label(c, v["who"]) if "who" in v else ln["user_id"]
    iid = ln["item_id"]
    if "item" in v:
        rows = c.execute("SELECT id FROM items WHERE name=?", (v["item"],)).fetchall()
        if len(rows) != 1:
            raise Err(400, "물품을 다시 골라 주십시오")
        iid = rows[0][0]
    if not back and c.execute("SELECT 1 FROM loans WHERE item_id=? AND in_at IS NULL AND id!=?", (iid, id)).fetchone():
        raise Err(409, "이미 다른 사람이 빌려 간 물품입니다. 반납일자를 먼저 채워 주십시오")
    c.execute("UPDATE loans SET item_id=?, user_id=?, out_at=?, in_at=? WHERE id=?", (iid, uid, out, back, id))
    for i in {ln["item_id"], iid}:
        sync_item(c, i)
    return "loans", [], []


def edit_reservations(c, id, v):
    """예약 기록(이어진 시간 한 묶음): 사용일자·시작·끝·방·예약자. id 는 묶음의 첫 시간."""
    r = c.execute("SELECT * FROM reservations WHERE id=?", (id,)).fetchone()
    if not r:
        raise Err(404, "삭제된 항목이 있습니다. 새로고침해 주십시오")
    hrs = {x["hour"]: x["id"] for x in c.execute("SELECT id, hour FROM reservations WHERE room_id=? AND user_id=? AND date=?",
                                                  (r["room_id"], r["user_id"], r["date"]))}
    lo = hi = r["hour"]                                  # 이어진 시간만 한 묶음
    while lo - 1 in hrs:
        lo -= 1
    while hi + 1 in hrs:
        hi += 1
    run, start, end = [hrs[h] for h in range(lo, hi + 1)], lo, hi + 1

    def hour_of(key, default):
        if key not in v:
            return default
        m = re.fullmatch(r"\s*(\d{1,2})\s*시?\s*", str(v[key]))
        if not m:
            raise Err(400, "시간을 다시 골라 주십시오")
        return int(m[1])
    try:
        day = date.fromisoformat(str(v["date"])) if "date" in v else date.fromisoformat(r["date"])
    except ValueError:
        raise Err(400, "사용일자를 다시 확인해 주십시오")
    start, end = hour_of("start", start), hour_of("end", end)
    if not (0 <= start < end <= 24):
        raise Err(400, "끝 시간은 시작 시간보다 늦어야 합니다")
    room = r["room_id"]
    if "room" in v:
        row = c.execute("SELECT id FROM rooms WHERE name=?", (v["room"],)).fetchone()
        if not row:
            raise Err(400, "없는 세미나실입니다")
        room = row[0]
    uid = user_by_label(c, v["who"]) if "who" in v else r["user_id"]
    c.executemany("DELETE FROM reservations WHERE id=?", [(i,) for i in run])
    try:
        c.executemany("INSERT INTO reservations(room_id,user_id,date,hour,created_at) VALUES(?,?,?,?,?)",
                      [(room, uid, day.isoformat(), h, r["created_at"]) for h in range(start, end)])
    except sqlite3.IntegrityError:
        c.rollback()
        raise Err(409, "그 시간에는 이미 다른 예약이 있습니다")
    return "reservations", [], []


EDITABLE = {"loans": edit_loans, "reservations": edit_reservations, "apps": edit_apps, "users": edit_users, "items": edit_items, "events": edit_events, "notices": edit_notices}


def admin_cells(c, me, b, q):
    """표에서 바로 고친 칸들을 한 번에 저장한다. 한 줄이라도 틀리면 아무것도 바뀌지 않는다."""
    fn = EDITABLE.get(b.get("table"))
    rows = b.get("rows")
    if not fn or not isinstance(rows, list) or not rows or len(rows) > 2000:
        raise Err(400, "요청을 처리하지 못했습니다. 새로고침한 뒤 다시 시도해 주십시오")
    for r in rows:
        v = r.get("vals") if isinstance(r, dict) else None
        if not isinstance(v, dict) or not v:
            raise Err(400, "요청을 처리하지 못했습니다. 새로고침한 뒤 다시 시도해 주십시오")
        rid = id_of(c, b["table"], r.get("id")) if b["table"] in ("events", "notices") else r.get("id")
        table, sets, args = fn(c, rid, v, me) if fn is edit_users else fn(c, rid, v)
        if sets and not c.execute(f"UPDATE {table} SET {', '.join(sets)} WHERE id=?", args + [rid]).rowcount:
            raise Err(404, "삭제된 항목이 있습니다. 새로고침해 주십시오")
    return {"ok": True, "n": len(rows)}


IMG_DIR = os.path.join(os.path.dirname(DB), "img")
IMG_MAX = 5 * 1024 * 1024
IMG_TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}
IMG_NAME = re.compile(r"[0-9a-f]{16}\.(jpg|png|webp|gif)")


def img_ext(data):
    """파일 앞부분 서명으로 종류를 정한다. 보낸 쪽이 붙인 이름·Content-Type 은 믿지 않는다."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    return None


def admin_upload(c, me, data, q):
    """공지 그림. 본문(data)은 JSON 이 아니라 그림 바이트 그대로 받는다."""
    ext = img_ext(data)
    if not ext:
        raise Err(400, "그림 파일(JPG, PNG, WebP, GIF)만 올릴 수 있습니다")
    name = f"{hashlib.sha256(data).hexdigest()[:16]}.{ext}"   # 같은 그림은 한 번만 저장
    os.makedirs(IMG_DIR, exist_ok=True)
    path = os.path.join(IMG_DIR, name)
    if not os.path.exists(path):
        tmp = path + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    return {"url": "img/" + name}


def admin_role(c, me, b, q):
    if b.get("role") not in ("user", "admin"):
        raise Err(400, "바꿀 권한을 다시 골라 주십시오")
    c.execute("UPDATE users SET role=? WHERE id=? AND role != 'super'", (b["role"], b.get("id")))
    return {"ok": True}


def admin_handover(c, me, b, q):
    """최고 관리자 자리를 다른 회원에게 넘긴다. 나는 관리자가 된다. 본인 비밀번호를 한 번 더 확인한다."""
    if not check_pw(str(b.get("password", "")), me["pw"]):
        raise Err(400, "비밀번호가 맞지 않습니다")
    to = c.execute("SELECT * FROM users WHERE id=?", (b.get("id"),)).fetchone()
    if not to or to["id"] == me["id"]:
        raise Err(400, "넘길 회원을 다시 골라 주십시오")
    c.execute("UPDATE users SET role='super' WHERE id=?", (to["id"],))
    c.execute("UPDATE users SET role='admin' WHERE id=?", (me["id"],))
    return {"ok": True, "to": to["name"]}


UNSUB_PAGE = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>알림 차단</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3efee;font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;color:#2b2222}
main{box-sizing:border-box;width:min(92vw,420px);background:#fff;border-radius:16px;padding:32px 28px;text-align:center}
h1{font-size:20px;margin:0 0 10px}p{margin:0 0 22px;line-height:1.7;color:#6b5d5b;font-size:14px}
button,a{display:inline-block;padding:12px 24px;border-radius:10px;border:0;background:#5b4545;color:#fff;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}</style></head>
<body><main>%s</main></body></html>"""
UNSUB_ASK = '<h1>%s 알림을 차단할까요?</h1><p>이 메일 주소로 오는 %s 메일이 멈춥니다. 설정 화면에서 언제든 다시 켤 수 있습니다.</p><form method="post" action="%s"><button type="submit">알림 차단</button></form>'
UNSUB_DONE = '<h1>%s 알림을 차단했습니다</h1><p>더는 %s 메일을 보내지 않습니다.</p><a href="%s/">사이트로 가기</a>'
UNSUB_BAD = '<h1>차단 링크가 올바르지 않습니다</h1><p>링크가 잘렸을 수 있습니다. 사이트의 설정 화면에서 직접 끌 수 있습니다.</p><a href="%s/#/settings">설정 화면으로</a>'

SETUP_PAGE = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>메일 설정</title>
<style>
body{margin:0;font:16px/1.6 system-ui,sans-serif;background:#f4f5f7;color:#1c1e21;display:flex;justify-content:center;padding:24px 16px}
main{width:100%;max-width:420px;background:#fff;border-radius:16px;padding:24px;box-sizing:border-box}
h1{font-size:20px;margin:0 0 4px}
p{margin:0 0 16px;color:#5c6270;font-size:14px}
label{display:block;font-size:14px;font-weight:600;margin:14px 0 4px}
input{width:100%;box-sizing:border-box;font:inherit;padding:12px;border:1px solid #c9ced6;border-radius:10px}
button{width:100%;margin-top:20px;font:inherit;font-weight:600;padding:14px;border:0;border-radius:10px;background:#1c1e21;color:#fff}
button:disabled{opacity:.5}
#msg{margin-top:14px;font-size:14px;min-height:1.4em}
.err{color:#c62828}.ok{color:#1b7f3b}
</style></head><body><main>
<h1>메일 보내기 설정</h1>
<p>최고 관리자로 로그인한 상태에서만 저장됩니다. 저장하기 전에 실제로 로그인해 보고, 맞을 때만 저장합니다.</p>
<form id="f" autocomplete="off">
<label for="host">메일 서버</label><input id="host" value="smtp.gmail.com" required>
<label for="user">보내는 메일 주소</label><input id="user" type="email" placeholder="example@gmail.com" required>
<label for="password">앱 비밀번호</label><input id="password" type="password" autocomplete="new-password" required>
<label for="name">보내는 이름</label><input id="name" value="SWITCH 학생회">
<button id="go" type="submit">확인하고 저장</button>
</form>
<div id="msg" role="status"></div>
</main>
<script>
var f=document.getElementById('f'),msg=document.getElementById('msg'),go=document.getElementById('go');
f.addEventListener('submit',function(e){
e.preventDefault();go.disabled=true;msg.className='';msg.textContent='확인하는 중입니다';
var body={};['host','user','password','name'].forEach(function(k){body[k]=document.getElementById(k).value});
fetch('api/admin/smtp_setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
.then(function(r){return r.json().then(function(d){return[r.status,d]})})
.then(function(x){
go.disabled=false;
if(x[0]===200){document.getElementById('password').value='';msg.className='ok';msg.textContent='저장했습니다. 바로 적용됩니다.'}
else{msg.className='err';msg.textContent=x[0]===401?'먼저 최고 관리자로 로그인해 주십시오':(x[1].error||'저장하지 못했습니다')}
}).catch(function(){go.disabled=false;msg.className='err';msg.textContent='서버에 연결하지 못했습니다'})
});
</script></body></html>""".encode()


# 경로 → (함수, 필요한 권한). None=누구나, user=로그인, admin, super
GET = {"/api/me": (get_me, None), "/api/items": (items, "user"), "/api/week": (week, None), "/api/admin/room_rules": (admin_room_rules, "admin"),
       "/api/my_reservations": (my_reservations, "user"), "/api/events": (events, None), "/api/event": (event, "user"),
       "/api/banners": (banners, None), "/api/notices": (notices, None), "/api/notice": (notice, None),
       "/api/admin/notices": (admin_notices, "admin"), "/api/admin/notice": (admin_notice, "admin"),
       "/api/admin/items": (admin_items, "admin"), "/api/admin/qr.pdf": (admin_qr_pdf, "admin"),
       "/api/admin/loans": (admin_loans, "admin"), "/api/admin/reservations": (admin_reservations, "admin"),
       "/api/admin/events": (admin_events, "admin"), "/api/admin/applications": (admin_applications, "admin"),
       "/api/admin/users": (admin_users, "admin")}
POST = {"/api/signup": (signup, None), "/api/signup_code": (signup_code, None), "/api/mail_prefs": (mail_prefs, "user"), "/api/login": (login, None), "/api/logout": (logout, None),
        "/api/forgot": (forgot, None), "/api/reset": (reset, None),
        "/api/scan": (scan, "user"), "/api/reserve": (reserve, "user"), "/api/unreserve": (unreserve, "user"),
        "/api/apply": (apply, "user"), "/api/apply_cancel": (apply_cancel, "user"), "/api/admin/item_add": (admin_item_add, "admin"),
        "/api/admin/item_del": (admin_item_del, "admin"), "/api/admin/item_return": (admin_item_return, "admin"), "/api/admin/kind_hours": (admin_kind_hours, "admin"), "/api/admin/room_rules": (admin_room_rules, "admin"),
        "/api/admin/event_save": (admin_event_save, "admin"), "/api/admin/event_del": (admin_event_del, "admin"),
        "/api/admin/notice_save": (admin_notice_save, "admin"), "/api/admin/notice_del": (admin_notice_del, "admin"),
        "/api/admin/upload": (admin_upload, "admin"), "/api/admin/dues": (admin_dues, "admin"), "/api/admin/signup": (admin_signup, "admin"), "/api/admin/cells": (admin_cells, "admin"), "/api/admin/role": (admin_role, "super"),
        "/api/admin/handover": (admin_handover, "super"), "/api/admin/smtp_setup": (smtp_setup, "super")}
RANK = {None: 0, "user": 1, "admin": 2, "super": 3}
RAW_BODY = {admin_upload}              # JSON 이 아니라 바이트 그대로 받는 곳
# 화면은 React 로 만들어 web/dist 에 구운 것을 보낸다 (원본은 web/src, 굽기: cd web && npm run build)
WEB_DIR = os.path.join(BASE, "web", "dist")
PAGES = {"/": "index.html", "/admin": "admin.html"}
ASSET_TYPES = {"js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8", "svg": "image/svg+xml",
               "woff2": "font/woff2", "png": "image/png"}
ASSET = re.compile(r"/assets/([\w.-]+\.(js|css|svg|woff2|png))")
NEXT = "/next"                         # 옮기는 동안 쓰던 미리 보기 주소 — 이제 원래 주소로 보낸다


SECURITY_HEADERS = (
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Referrer-Policy", "same-origin"),
    ("Strict-Transport-Security", "max-age=31536000"),
    ("Permissions-Policy", "camera=(self), microphone=(), geolocation=()"),
)
INLINE_SCRIPT = re.compile(rb"<script>(.*?)</script>", re.S)


def csp(scripts=()):
    """화면 파일 안에 직접 들어 있는 짧은 스크립트(테마 복원)는 내용 지문으로만 허용한다."""
    src = " ".join(["'self'"] + [f"'sha256-{base64.b64encode(hashlib.sha256(x).digest()).decode()}'" for x in scripts])
    return (f"default-src 'self'; script-src {src}; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; "
            "frame-ancestors 'none'; base-uri 'self'; form-action 'self'")


class H(BaseHTTPRequestHandler):
    server_version = "switch"

    def log_message(self, fmt, *a):
        if not self.path.startswith("/api/me"):
            sys.stderr.write(fmt % a + "\n")

    def send(self, status, body, ctype="application/json; charset=utf-8", headers=(), cache="no-store", scripts=()):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        for k, v in SECURITY_HEADERS:
            self.send_header(k, v)
        self.send_header("Content-Security-Policy", csp(scripts))
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
        if path in (NEXT, NEXT + "/", NEXT + "/admin"):
            return self.send(301, b"", "text/plain", [("Location", {NEXT: "./", NEXT + "/": "../"}.get(path, "../admin"))])
        if path.startswith(NEXT + "/"):
            self.path = self.path[len(NEXT):]
            path = urlparse(self.path).path
        if m := re.fullmatch(r"/q/([a-z0-9]{1,16})", path.lower()):
            return self.send(302, b"", "text/plain", [("Location", f"../#/q/{m[1]}")])
        if m := re.fullmatch(r"/img/([^/]+)", path):
            if not IMG_NAME.fullmatch(m[1]) or not os.path.isfile(os.path.join(IMG_DIR, m[1])):
                return self.send(404, '{"error":"없는 주소입니다"}'.encode())
            with open(os.path.join(IMG_DIR, m[1]), "rb") as f:
                return self.send(200, f.read(), IMG_TYPES[m[1].rsplit(".", 1)[1]],
                                 [("X-Content-Type-Options", "nosniff")], cache="public, max-age=31536000, immutable")
        if path == "/unsub":
            return self.unsub(False)
        if path == "/mail-setup":
            return self.send(200, SETUP_PAGE, "text/html; charset=utf-8", cache="no-store", scripts=INLINE_SCRIPT.findall(SETUP_PAGE))
        if path == "/admin/":
            return self.send(301, b"", "text/plain", [("Location", "../admin")])
        if path in PAGES:
            f = os.path.join(WEB_DIR, PAGES[path])
            if not os.path.isfile(f):
                return self.send(503, '{"error":"화면 파일이 없습니다. web 폴더에서 npm run build 를 실행해 주십시오"}'.encode())
            with open(f, "rb") as fh:          # 화면 파일은 매번 새로 확인 — 새로 구우면 바로 바뀐다
                page = fh.read()
                return self.send(200, page, "text/html; charset=utf-8", cache="no-cache", scripts=INLINE_SCRIPT.findall(page))
        if m := ASSET.fullmatch(path):
            f = os.path.join(WEB_DIR, "assets", m[1])
            if not os.path.isfile(f):
                return self.send(404, '{"error":"없는 주소입니다"}'.encode())
            with open(f, "rb") as fh:          # 이름에 내용 지문이 붙어 있어 바뀌면 이름도 바뀐다 — 오래 보관해도 된다
                return self.send(200, fh.read(), ASSET_TYPES[m[2]], cache="public, max-age=31536000, immutable")
        self.api(GET)

    def unsub(self, apply):
        q = parse_qs(urlparse(self.path).query)
        uid, kind, sig = (q.get(k, [""])[0] for k in ("u", "k", "t"))
        label = "행사 공지" if kind == "event" else "학과 공지"
        ok = unsub_ok(uid, kind, sig)
        if ok and apply:
            c = connect()
            try:
                unsub_apply(c, uid, kind, sig)
                c.commit()
            finally:
                c.close()
        body = (UNSUB_DONE % (label, label, PREFIX) if apply else UNSUB_ASK % (label, label, htmllib.escape("unsub?" + urlparse(self.path).query, quote=True))) if ok else UNSUB_BAD % PREFIX
        self.send(200 if ok else 400, (UNSUB_PAGE % body).encode(), "text/html; charset=utf-8")

    def do_POST(self):
        # 다른 사이트에서 쿠키를 싣고 오는 요청 차단 (SameSite=Lax 에 더해)
        origin = self.headers.get("Origin")
        if origin and origin != ORIGIN:
            return self.send(403, '{"error":"다른 사이트에서 보낸 요청은 받지 않습니다"}'.encode())
        if self.path.startswith(NEXT + "/"):
            self.path = self.path[len(NEXT):]
        if urlparse(self.path).path == "/unsub":
            return self.unsub(True)
        self.api(POST)

    def api(self, table):
        u = urlparse(self.path)
        if u.path not in table:
            return self.send(404, '{"error":"없는 주소입니다"}'.encode())
        fn, need = table[u.path]
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > (IMG_MAX if fn in RAW_BODY else MAX_BODY):
                if n <= 4 * IMG_MAX:          # 다 받아 버려야 브라우저가 연결 끊김 대신 이 오류 문구를 본다
                    self.rfile.read(n)
                else:
                    self.close_connection = True
                raise Err(413, "그림은 5MB까지 올릴 수 있습니다" if fn in RAW_BODY else "보낸 내용이 너무 깁니다")
            if fn in RAW_BODY:
                body = self.rfile.read(n)
            else:
                body = json.loads(self.rfile.read(n) or b"{}") if self.command == "POST" else {}
                if not isinstance(body, dict):
                    raise Err(400, "요청을 처리하지 못했습니다. 새로고침한 뒤 다시 시도해 주십시오")
        except (ValueError, Err) as e:
            return self.send(getattr(e, "status", 400), json.dumps({"error": getattr(e, "msg", "요청을 처리하지 못했습니다. 새로고침한 뒤 다시 시도해 주십시오")}, ensure_ascii=False).encode())
        c = connect()
        try:
            me, tok = None, SimpleCookie(self.headers.get("Cookie", "")).get(COOKIE)
            if tok:
                me = c.execute("""SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
                                  WHERE s.token=? AND s.expires > ?""", (tok_hash(tok.value), stamp())).fetchone()
            headers = []
            if RANK[me["role"] if me else None] < RANK[need]:
                raise Err(401 if not me else 403, "로그인해 주십시오" if not me else "관리자만 할 수 있습니다")
            if fn is logout and tok:
                c.execute("DELETE FROM sessions WHERE token=?", (tok_hash(tok.value),))
            elif fn is get_me and me:      # 들어올 때마다 만료를 다시 SESSION_DAYS 로
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
            self.send(500, '{"error":"서버에 문제가 생겼습니다. 잠시 뒤 다시 시도해 주십시오"}'.encode())
        finally:
            c.close()


def main():
    init_db()
    if len(sys.argv) == 3 and sys.argv[1] == "super":
        with connect() as c:
            if not c.execute("UPDATE users SET role='super' WHERE username=?", (sys.argv[2],)).rowcount:
                sys.exit(f"아이디 '{sys.argv[2]}' 가 없습니다. 웹에서 먼저 가입하십시오.")
        print(f"{sys.argv[2]} → 최고 관리자")
        return
    ThreadingHTTPServer.daemon_threads = True
    if SCE_EVERY:
        threading.Thread(target=sce_loop, daemon=True).start()
    srv = ThreadingHTTPServer((HOST, PORT), H)
    print(f"council on http://{HOST}:{PORT}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
