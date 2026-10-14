#!/usr/bin/env python3
"""Crystal school sync: Eli's normalized school pull -> Crystal Supabase edu_* tables.

Pipeline (unchanged upstream, see README.md):
  laptop (home network) fetch.ps1 -> ParentVUE SOAP + CTLS Learn -> zip -> Supabase storage
  -> box process_raw_from_supabase.py -> /workspace/eli-dashboard/data.json (+ term_finals.json)
  -> THIS SCRIPT -> Crystal Supabase (edu_students/grades/assignments/attendance/messages/calendar)

Idempotent: upserts on natural keys; grade snapshots are keyed by the pull's fetched_at, so
re-running on the same pull writes nothing new. Skips entirely if fetched_at is unchanged
(state in ~/.local/state/crystal/school_sync.json) unless --force.

Env (never printed): CRYSTAL_SUPABASE_SERVICE_ROLE_KEY, optional CRYSTAL_SUPABASE_URL,
CRYSTAL_OWNER_EMAIL (default iamrolan@gmail.com), ELI_DATA_DIR.
Exit codes: 0 ok/skipped, 2 owner not signed up yet, 3 tables missing (run migrations), 1 other.
"""
import argparse, hashlib, json, os, sys, datetime as dt
from pathlib import Path
import requests

URL = os.environ.get("CRYSTAL_SUPABASE_URL", "https://ogrrjkxkccbywbiikcak.supabase.co").rstrip("/")
KEY = os.environ.get("CRYSTAL_SUPABASE_SERVICE_ROLE_KEY", "")
OWNER = os.environ.get("CRYSTAL_OWNER_EMAIL", "iamrolan@gmail.com").lower()
DATA = Path(os.environ.get("ELI_DATA_DIR", "/workspace/eli-dashboard"))
STATE = Path.home() / ".local/state/crystal/school_sync.json"
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

def log(m): print(f"[{dt.datetime.now().astimezone():%F %T %Z}] {m}", flush=True)
def h(*p): return hashlib.sha1("|".join(str(x) for x in p).encode()).hexdigest()[:20]
def d(s): return (s or "")[:10] or None
def ck(name): return "".join(c for c in (name or "").lower().split(" q")[0].split("7")[0] if c.isalnum())[:24] or "x"

def rest(method, path, body=None, params=None, prefer="return=minimal"):
    r = requests.request(method, f"{URL}/rest/v1/{path}", params=params, timeout=60,
                         headers={**H, "Prefer": prefer}, data=None if body is None else json.dumps(body))
    if r.status_code == 404 or "PGRST205" in r.text: raise LookupError(path)
    if r.status_code >= 300: raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:300]}")
    return r.json() if r.text and "representation" in prefer or method == "GET" else None

def upsert(table, rows, conflict):
    for i in range(0, len(rows), 200):
        if rows[i:i+200]:
            rest("POST", table, rows[i:i+200], {"on_conflict": conflict}, "resolution=merge-duplicates,return=minimal")
    return len(rows)

def owner_id():
    page = 1
    while True:
        r = requests.get(f"{URL}/auth/v1/admin/users", params={"page": page, "per_page": 200}, headers=H, timeout=30)
        r.raise_for_status(); us = r.json().get("users", [])
        for u in us:
            if (u.get("email") or "").lower() == OWNER: return u["id"]
        if len(us) < 200: return None
        page += 1

def build(data, finals, uid, sid):
    f_at = data["fetched_at"]; base = {"user_id": uid, "student_id": sid}
    rp = data.get("reporting_period") or {}; term = rp.get("name") or "current"
    grades = [{**base, "captured_at": f_at, "term": term, "course_key": ck(c["name"]), "course": c["name"],
               "period": c.get("period"), "teacher": c.get("teacher"), "teacher_email": c.get("teacher_email"),
               "percent": c.get("percent") if c.get("mark") not in (None, "N/A") else None,
               "mark": c.get("mark"), "is_final": False} for c in data.get("courses", [])]
    for qname, q in finals.items():
        if not isinstance(q, dict) or "courses" not in q: continue
        grades += [{**base, "captured_at": q["fetched_at"], "term": qname, "course_key": ck(c["full"]), "course": c["full"],
                    "period": c.get("period"), "teacher": c.get("teacher"), "teacher_email": None,
                    "percent": c.get("percent"), "mark": c.get("mark"), "is_final": True} for c in q["courses"]]
    asg = [{**base, "source": "ParentVUE", "ext_id": a.get("gradebook_id") or h(a["course"], a["name"], a.get("date")),
            "course": a.get("course"), "name": a["name"].replace("&amp;", "&"), "kind": a.get("type"),
            "assigned_date": d(a.get("date")), "due_date": d(a.get("due_date")), "score_display": a.get("score_display"),
            "score_pct": a.get("score_pct"), "points_possible": a.get("score_max"), "missing": bool(a.get("missing")),
            "zero": bool(a.get("zero")), "late": bool(a.get("late")), "status": "Not graded" if a.get("not_graded") else "Graded",
            "updated_at": f_at} for a in data.get("assignments", [])]
    ctls = data.get("ctls") or {}
    asg += [{**base, "source": "CTLS", "ext_id": a["ctls_id"], "course": a.get("course") or a.get("classroom"),
             "name": a["name"], "kind": a.get("type"), "assigned_date": None, "due_date": d(a.get("due") or a.get("due_date")),
             "score_display": a.get("ui_status"), "score_pct": a.get("percent"), "points_possible": a.get("points_possible"),
             "missing": bool(a.get("missing")), "zero": False, "late": False, "status": a.get("status"), "updated_at": f_at}
            for a in ctls.get("assignments", []) if a.get("current", True)]
    att = data.get("attendance") or {}
    attendance = [{**base, "date": e["date"], "kind": e.get("kind") or "absence", "reason": e.get("reason"),
                   "note": e.get("note"), "periods": e.get("periods") or []} for e in att.get("entries", [])]
    msgs = [{**base, "source": "ParentVUE", "ext_id": m.get("id") or h(m.get("date"), m.get("subject")), "sent_at": m.get("date"),
             "sender": m.get("from") or "ParentVUE", "subject": m.get("subject"), "body": m.get("body_text"),
             "course": m.get("module"), "url": None, "unread": not m.get("read", False)} for m in data.get("messages", [])]
    msgs += [{**base, "source": "CTLS", "ext_id": a["id"], "sent_at": a.get("date"), "sender": a.get("author"),
              "subject": a.get("title"), "body": (a.get("text") or "")[:4000], "course": a.get("course") or a.get("classroom"),
              "url": None, "unread": None} for a in ctls.get("announcements", [])]
    msgs += [{**base, "source": "Gmail", "ext_id": t["thread_id"], "sent_at": t.get("date"), "sender": t.get("from"),
              "subject": t.get("subject"), "body": t.get("snippet"), "course": None, "url": t.get("url"), "unread": t.get("unread")}
             for t in (data.get("gmail") or {}).get("threads", []) if t.get("from_teacher") or t.get("from_school_staff")]
    seen, cal = set(), []
    for c in (data.get("calendar") or []) + (data.get("upcoming_calendar") or []):
        k = (c["date"], c["title"])
        if k in seen: continue
        seen.add(k); cal.append({**base, "date": c["date"], "title": c["title"], "kind": c.get("day_type"), "source": "ParentVUE"})
    return grades, asg, attendance, msgs, cal

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--force", action="store_true"); ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--no-run-log", action="store_true")
    a = ap.parse_args()
    if not KEY: log("CRYSTAL_SUPABASE_SERVICE_ROLE_KEY not set"); return 1
    data = json.loads((DATA / "data.json").read_text())
    finals = json.loads((DATA / "term_finals.json").read_text()) if (DATA / "term_finals.json").exists() else {}
    f_at = data["fetched_at"]
    st = json.loads(STATE.read_text()) if STATE.exists() else {}
    if st.get("fetched_at") == f_at and not a.force and not a.dry_run:
        log(f"no new pull (fetched_at {f_at}); skipping"); return 0
    if a.dry_run:
        rows = build(data, finals, "UID", "SID")
        log("dry-run counts: " + json.dumps(dict(zip(["grades", "assignments", "attendance", "messages", "calendar"], map(len, rows))))); return 0
    uid = owner_id()
    if not uid: log(f"owner {OWNER} has not signed in to Crystal yet; nothing written"); return 2
    try:
        s = data.get("student") or {}
        stu = rest("POST", "edu_students", [{"user_id": uid, "source_key": "cobb:eli", "name": s.get("first_name") or "Eli",
              "grade": s.get("grade"), "school": s.get("school"), "district": s.get("district"),
              "attendance_totals": (data.get("attendance") or {}).get("totals") or {}, "reporting_period": data.get("reporting_period") or {},
              "last_fetched_at": f_at, "last_synced_at": dt.datetime.now(dt.timezone.utc).isoformat()}],
              {"on_conflict": "user_id,source_key", "select": "id"}, "resolution=merge-duplicates,return=representation")
        sid = stu[0]["id"]
        g, asg, att, msgs, cal = build(data, finals, uid, sid)
        counts = {"grades": upsert("edu_grades", g, "student_id,course_key,term,captured_at"),
                  "assignments": upsert("edu_assignments", asg, "student_id,source,ext_id"),
                  "attendance": upsert("edu_attendance", att, "student_id,date,kind"),
                  "messages": upsert("edu_messages", msgs, "student_id,source,ext_id"),
                  "calendar": upsert("edu_calendar", cal, "student_id,date,title")}
        if not a.no_run_log: rest("POST", "edu_sync_runs", [{"user_id": uid, "student_id": sid, "fetched_at": f_at, "source": "box:eli-dashboard", "status": "ok", "counts": counts}])
    except LookupError as e:
        log(f"table {e} missing: run supabase/migrations/001_tasks.sql and 002_education.sql"); return 3
    STATE.parent.mkdir(parents=True, exist_ok=True); STATE.write_text(json.dumps({"fetched_at": f_at}))
    log(f"synced pull {f_at}"); print("COUNTS " + json.dumps(counts), flush=True); return 0

if __name__ == "__main__":
    sys.exit(main())
