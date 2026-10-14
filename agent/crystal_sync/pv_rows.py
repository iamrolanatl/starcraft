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

from . import merge as M

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

# ---------------------------------------------------------------- validation + gates (docs/data-validation-strategy.md)
MIN_PV_OK = int(os.environ.get("CRYSTAL_MIN_PV_OK", "7"))      # of 9 ParentVUE requests
MANY_ASSIGNMENTS = 5
FIELDS = {
    "edu_assignments": (("source", "ext_id"), ["course", "name", "kind", "assigned_date", "due_date", "score_display", "score_pct", "points_possible", "missing", "zero", "late", "status"]),
    "edu_messages": (("source", "ext_id"), ["sent_at", "sender", "subject", "body", "course", "url", "unread"]),
    "edu_calendar": (("date", "title"), ["kind", "source"]),
    "edu_attendance": (("date", "kind"), ["reason", "note", "periods"]),
}
CONFLICT = {"edu_assignments": "student_id,source,ext_id", "edu_messages": "student_id,source,ext_id", "edu_calendar": "student_id,date,title", "edu_attendance": "student_id,date,kind"}

def validate(g, asg, att, msgs, cal, vlog):
    bad = 0
    def run(rows, checks, req, label):
        nonlocal bad; out = []
        for r in rows:
            r2, b = M.clean(dict(r), checks, req, vlog, f"{label} {r.get('course') or ''} {str(r.get('name') or r.get('subject') or r.get('title') or '')[:40]}".strip()); bad += b
            if r2: out.append(r2)
        return out
    g = run(g, {"percent": M.v_pct, "teacher_email": M.v_email, "captured_at": M.v_ts}, ["course", "course_key", "term", "captured_at"], "grade")
    asg = run(asg, {"score_pct": lambda v: M.v_pct(v, 0, 150), "due_date": M.v_date, "assigned_date": M.v_date}, ["name", "ext_id"], "assignment")
    att = run(att, {"date": M.v_date}, ["date", "kind"], "attendance")
    msgs = run(msgs, {"sent_at": M.v_ts}, ["ext_id"], "message")
    cal = run(cal, {"date": M.v_date}, ["date", "title"], "calendar")
    return g, asg, att, msgs, cal, bad

def gates(data, fetch_log, last_good, live_courses, n_asg):
    """Return a list of plain-English reasons to quarantine this pull (empty list = accept)."""
    why = []
    if fetch_log:
        okn = sum(1 for x in fetch_log.get("log", []) if x.get("ok"))
        if okn < MIN_PV_OK: why.append(f"only {okn} of {fetch_log.get('requests', len(fetch_log.get('log', [])))} ParentVUE requests succeeded (need {MIN_PV_OK})")
        if not any(x.get("ok") for x in fetch_log.get("log", []) if x.get("method") == "ChildList"): why.append("ParentVUE login (ChildList) failed")
    if not live_courses: why.append("gradebook section is empty (0 courses)")
    if not (data.get("schedule") or []): why.append("schedule section is empty")
    if M.is_blank((data.get("student") or {}).get("name")): why.append("student section is empty")
    lg = last_good or {}
    if lg.get("courses") and len(live_courses) < lg["courses"] - 1:
        why.append(f"course count dropped from {lg['courses']} to {len(live_courses)}")
    term = (data.get("reporting_period") or {}).get("name")
    if n_asg == 0 and (lg.get("assignments") or 0) >= MANY_ASSIGNMENTS and term == lg.get("term"):
        why.append(f"0 assignments (last good pull had {lg['assignments']}, same term)")
    return why

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--force", action="store_true"); ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--no-run-log", action="store_true")
    a = ap.parse_args()
    if not KEY: log("CRYSTAL_SUPABASE_SERVICE_ROLE_KEY not set"); return 1
    data = json.loads((DATA / "data.json").read_text())
    finals = json.loads((DATA / "term_finals.json").read_text()) if (DATA / "term_finals.json").exists() else {}
    fl_p = DATA / "raw" / "_fetch_log.json"
    fetch_log = json.loads(fl_p.read_text(encoding="utf-8-sig")) if fl_p.exists() else None
    f_at = data.get("fetched_at")
    st = json.loads(STATE.read_text()) if STATE.exists() else {}
    if st.get("fetched_at") == f_at and not a.force and not a.dry_run:
        log(f"no new pull (fetched_at {f_at}); skipping"); return 0
    uid = "UID" if a.dry_run else owner_id()
    if not uid: log(f"owner {OWNER} has not signed in to Crystal yet; nothing written"); return 2
    now = dt.datetime.now(dt.timezone.utc).isoformat(); vlog = []
    try:
        old_st = [] if a.dry_run else rest("GET", "edu_students", params={"user_id": f"eq.{uid}", "source_key": "eq.cobb:eli", "select": "*"})
        old_st = old_st[0] if old_st else None
        last_good = (old_st or {}).get("last_good") or {}
        g, asg, att, msgs, cal = build(data, finals, uid, (old_st or {}).get("id") or "SID")
        if not f_at: g = []
        g, asg, att, msgs, cal, bad = validate(g, asg, att, msgs, cal, vlog)
        term = (data.get("reporting_period") or {}).get("name")
        live = [x for x in g if not x["is_final"]]
        pv_asg = [x for x in asg if x["source"] == "ParentVUE"]
        reasons = gates(data, fetch_log, last_good, live, len(pv_asg))
        if not f_at: reasons.insert(0, "pull has no fetched_at")
        if reasons:
            log("QUARANTINED: " + "; ".join(reasons))
            print("QUARANTINE " + json.dumps({"reasons": reasons, "fields_rejected": bad, "validation": vlog[:50]}), flush=True); return 4
        if a.dry_run:
            log(f"dry-run: accepted; {len(g)} grades, {len(asg)} assignments; {bad} invalid values dropped"); [log("  " + v) for v in vlog[:20]]; return 0
        term_changed = bool(last_good.get("term")) and term != last_good.get("term")
        stats = M.Counter(); stats["fields_rejected"] = bad

        # student: non-destructive merge
        s = data.get("student") or {}
        new_st = {"name": s.get("first_name") or s.get("name"), "grade": s.get("grade"), "school": s.get("school"), "district": s.get("district"),
                  "attendance_totals": (data.get("attendance") or {}).get("totals"), "reporting_period": data.get("reporting_period")}
        m, c, _ = M.merge_fields(old_st, new_st, list(new_st)); stats.update(c)
        row = {k: m.get(k) for k in new_st}; row.update({"user_id": uid, "source_key": "cobb:eli", "last_fetched_at": f_at, "last_synced_at": now})
        row["name"] = row["name"] or "Eli"; row["attendance_totals"] = row["attendance_totals"] or {}; row["reporting_period"] = row["reporting_period"] or {}
        sid = rest("POST", "edu_students", [row], {"on_conflict": "user_id,source_key", "select": "id"}, "resolution=merge-duplicates,return=representation")[0]["id"]
        for coll in (g, asg, att, msgs, cal):
            for r in coll: r["student_id"] = sid

        # grades: immutable append-only snapshots. Blank teacher/email are carried forward from the last snapshot for that course.
        prev = rest("GET", "edu_grades", params={"student_id": f"eq.{sid}", "select": "course_key,teacher,teacher_email,captured_at", "order": "captured_at.asc"}) or []
        lastp = {p["course_key"]: p for p in prev}
        for r in g:
            p = lastp.get(r["course_key"]) or {}
            for f in ("teacher", "teacher_email", "period"):
                if M.is_blank(r.get(f)) and not M.is_blank(p.get(f)): r[f] = p[f]; stats["kept_old"] += 1
        g = [r for r in g if not (r["is_final"] and r.get("percent") is None)]   # a blank final is never recorded
        rest("POST", "edu_grades", g, {"on_conflict": "student_id,course_key,term,captured_at"}, "resolution=ignore-duplicates,return=minimal")
        counts = {"grades": len(g)}
        # rows: field merge + missing tracking, never deleted
        for table, rows in (("edu_assignments", asg), ("edu_messages", msgs), ("edu_calendar", cal), ("edu_attendance", att)):
            key, fields = FIELDS[table]
            old = rest("GET", table, params={"student_id": f"eq.{sid}", "select": "*"}) or []
            for o in old: o.pop("id", None)
            out, c = M.merge_rows(old, rows, key, fields, now, archive_after=3, archive_all=False, extra={"user_id": uid, "student_id": sid})
            if table == "edu_assignments" and term_changed:   # term change: assignments absent from the new term are archived at once
                for r in out:
                    if r.get("missing_since") == now and not r.get("archived_at"): r["archived_at"] = now; c["archived_rows"] += 1; c["missing_rows"] -= 1
            stats.update({k: v for k, v in c.items() if k in ("accepted", "kept_old")})
            counts[table[4:]] = len(rows); counts[table[4:] + "_missing"] = c["missing_rows"]; counts[table[4:] + "_archived"] = c["archived_rows"]
            cols = list(key) + fields + ["user_id", "student_id", "last_seen_at", "last_changed_at", "missing_since", "missing_count", "archived_at"]
            upsert(table, [{k: r.get(k) for k in cols} for r in out], CONFLICT[table])
        lg = {"fetched_at": f_at, "term": term, "courses": len(live), "assignments": len(pv_asg), "schedule": len(data.get("schedule") or [])}
        rest("PATCH", "edu_students", {"last_good": lg}, {"id": f"eq.{sid}"})
        counts.update({"fields_accepted": stats["accepted"], "fields_kept_old": stats["kept_old"], "fields_rejected": stats["fields_rejected"]})
        if not a.no_run_log: rest("POST", "edu_sync_runs", [{"user_id": uid, "student_id": sid, "fetched_at": f_at, "source": "box:eli-dashboard", "status": "ok", "counts": counts,
                                                             "fields_accepted": stats["accepted"], "fields_kept": stats["kept_old"], "fields_rejected": stats["fields_rejected"], "reason": "; ".join(vlog[:5]) or None}])
    except LookupError as e:
        log(f"table {e} missing: run supabase/migrations 001-003 and 007"); return 3
    STATE.parent.mkdir(parents=True, exist_ok=True); STATE.write_text(json.dumps({"fetched_at": f_at}))
    for v in vlog[:20]: log("  " + v)
    log(f"synced pull {f_at}"); print("COUNTS " + json.dumps({**counts, "validation": vlog[:20]}), flush=True); return 0

if __name__ == "__main__":
    sys.exit(main())
