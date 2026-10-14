#!/usr/bin/env python3
"""Schedule + per-period attendance from a laptop raw zip -> edu_schedule / edu_attendance_periods (migration 014),
plus cockpit alerts (edu_alerts): new absence, new missing assignment, new low score (<70), class grade dipping below 90.
Rules: blank/garbled files are ignored (never wipe), upsert only, never delete; alerts only after a baseline exists.
Usage: school_extras.py <zip>  (also called from poller.process with its alert function)."""
import io, json, re, sys, zipfile, datetime as dt
import xml.etree.ElementTree as ET
from pathlib import Path
import requests
from graded_assignments import ck, d as mdy

def _root(z, n):
    if n not in z.namelist(): return None
    try: r = ET.fromstring(z.read(n).decode("utf-8", "replace"))
    except ET.ParseError: return None
    return None if r.tag == "RT_ERROR" else r

def schedule(z):
    r = _root(z, "StudentClassList.xml")
    if r is None: return []
    term = next((e.get("TermIndexName") or e.get("TermName") or "" for e in r.iter() if e.get("TermIndexName") or e.get("TermName")), "")
    out = []
    for c in r.iter("ClassListing"):
        try: p = int(c.get("Period") or "")
        except ValueError: continue
        out.append({"term": term, "period": p, "course": c.get("CourseTitle") or "", "course_key": ck(c.get("CourseTitle")),
                    "room": c.get("RoomName") or None, "teacher": c.get("Teacher") or None, "teacher_email": c.get("TeacherEmail") or None})
    return [x for x in out if x["course"]]

def absences(z):
    r = _root(z, "Attendance.xml")
    if r is None or r.find("Absences") is None: return None
    out = []
    for a in r.iter("Absence"):
        day = mdy(a.get("AbsenceDate"))
        if not day: continue
        for p in a.iter("Period"):
            if not (p.get("Name") or "").strip(): continue
            try: n = int(p.get("Number") or "")
            except ValueError: continue
            out.append({"date": day, "period": n, "code": p.get("Name"), "reason": (p.get("Reason") or a.get("Reason") or "").strip() or None,
                        "note": (a.get("Note") or "").strip() or None, "course": p.get("Course") or None, "teacher": p.get("Staff") or None})
    return out

def current_scores(z):
    """{course_key: (course, percent, period_name)} from the latest started quarter's gradebook (ParentVUE CalculatedScoreRaw)."""
    files = sorted((n for n in z.namelist() if re.fullmatch(r"GradebookAll_RP\d+\.xml", n)), key=lambda n: int(re.findall(r"\d+", n)[0]))
    if not files: return {}
    r = _root(z, files[-1]); out = {}
    if r is None: return {}
    rp = r.find(".//ReportingPeriod"); pname = rp.get("GradePeriod") if rp is not None else ""
    for c in r.iter("Course"):
        m = c.find(".//Mark")
        if m is None: continue
        try: pct = float(m.get("CalculatedScoreRaw") or "")
        except ValueError: continue
        if (m.get("CalculatedScoreString") or "").upper() in ("N/A", ""): continue
        course = re.sub(r"\s*\([\d.]+\)\s*$", "", c.get("Title") or ""); out[ck(course)] = (course, pct, pname)
    return out

def store(zbytes, url, key, uid, alert=None, state_dir=None, graded=None):
    H = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    z = zipfile.ZipFile(io.BytesIO(zbytes)); now = dt.datetime.now(dt.timezone.utc).isoformat(); res = {"schedule": 0, "absence_periods": 0, "alerts": 0}
    def get(t): x = requests.get(f"{url}/rest/v1/{t}", params={"select": "*", "user_id": f"eq.{uid}"}, headers=H, timeout=60); x.raise_for_status(); return x.json()
    def post(t, conflict, rows):
        if not rows: return
        x = requests.post(f"{url}/rest/v1/{t}", params={"on_conflict": conflict}, data=json.dumps(rows), headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"}, timeout=60)
        if x.status_code >= 300: raise RuntimeError(f"{t} upsert -> {x.status_code}: {x.text[:200]}")
    def fire(kind, k, msg):
        if alert and alert(kind, k, msg): res["alerts"] += 1
    try:
        sch = schedule(z)
        if sch: post("edu_schedule", "user_id,term,period,course", [{**s, "user_id": uid, "last_seen_at": now} for s in sch]); res["schedule"] = len(sch)
        ab = absences(z)
        if ab is not None:
            old = {(o["date"], o["period"]) for o in get("edu_attendance_periods")}
            post("edu_attendance_periods", "user_id,date,period", [{**a, "user_id": uid, "updated_at": now} for a in ab]); res["absence_periods"] = len(ab)
            if old:
                for day in sorted({a["date"] for a in ab if (a["date"], a["period"]) not in old}):
                    rs = [a for a in ab if a["date"] == day]; why = rs[0]["reason"] or rs[0]["code"]
                    fire("absence", f"absence:{day}", f"New absence recorded for Eli on {day}: {why}{' (' + rs[0]['note'] + ')' if rs[0]['note'] else ''}, {len(rs)} period(s).")
    except requests.HTTPError as e: res["error"] = f"014 tables: {e.response.status_code}"
    for r in (graded or {}).get("new_missing", []):
        fire("missing_assignment", f"missing:{r['course_key']}:{r['gradebook_id']}", f"Missing assignment in {r['course']}: {r['name']} (due {r['due_date'] or 'n/a'}).")
    for r in (graded or {}).get("new_low", []):
        fire("low_score", f"low:{r['course_key']}:{r['gradebook_id']}", f"Low score in {r['course']}: {r['name']} scored {r['percent']:g}%.")
    # class grade dipping below 90 (state kept on the box; first run only records a baseline)
    sc = current_scores(z)
    if sc and state_dir:
        f = Path(state_dir) / "grade-baseline.json"; prev = json.loads(f.read_text()) if f.exists() else None
        if prev is not None:
            for k, (course, pct, pname) in sc.items():
                p = prev.get(k)
                if p and p[2] == pname and p[1] >= 90 and pct < 90:
                    fire("grade_dip", f"dip:{k}:{pname}:{dt.date.today()}", f"{course} dipped below 90: now {pct:g}% (was {p[1]:g}%) in {pname}.")
        f.write_text(json.dumps({**(prev or {}), **{k: list(v) for k, v in sc.items()}}))
    return res

if __name__ == "__main__":
    import os
    sys.path.insert(0, os.path.dirname(__file__)); import poller
    print("EXTRAS " + json.dumps(store(open(sys.argv[1], "rb").read(), poller.URL, poller.KEY, poller.owner(), None, None)))
