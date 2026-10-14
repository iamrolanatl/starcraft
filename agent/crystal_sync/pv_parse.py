#!/usr/bin/env python3
"""Normalize Eli's ParentVUE raw XML (+ Gmail search results) into data.json.

Inputs:
  raw/*.xml             decoded ProcessWebServiceRequestResult payloads from fetch.ps1
  raw/_fetch_log.json   per-request status written by fetch.ps1
  raw/ctls/*.json       CTLS Learn pull (optional): classrooms, assignments, scores, feed posts, contacts -> data["ctls"]
                        (userSettings.json is never read: it holds the CTLS session token/cookies)
  gmail_raw.json        Gmail search_threads result (read-only search), optional
Output:
  data.json
"""
import json, re, sys, html
from datetime import datetime, date, timedelta, timezone
from pathlib import Path
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

ET_TZ = ZoneInfo("America/New_York")
import os
BASE = Path(os.environ.get("CRYSTAL_SYNC_WORK") or Path(__file__).resolve().parent)
RAW = BASE / "raw"
errors = {}


def load_xml(name):
    p = RAW / f"{name}.xml"
    if not p.exists():
        return None, f"{name}.xml not present (request failed or skipped)"
    txt = p.read_text(encoding="utf-8-sig").strip()
    if not txt:
        return None, f"{name}.xml is empty"
    try:
        root = ET.fromstring(txt)
    except ET.ParseError as e:
        return None, f"{name}.xml parse error: {e}"
    if root.tag == "RT_ERROR":
        return None, "ParentVUE error: " + (root.get("ERROR_MESSAGE") or "unknown")
    return root, None


def pdate(s):
    """Parse ParentVUE dates like 10/6/2026, 09/16/2026, '10/05/2026 17:07:40'."""
    if not s:
        return None
    s = s.strip()
    for fmt in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    return None


def iso_d(s):
    d = pdate(s)
    return d.date().isoformat() if d else None


def num(s):
    if s is None:
        return None
    try:
        return float(str(s).replace(",", "").replace("%", "").strip())
    except ValueError:
        return None


# ---------------- fetch log ----------------
fetch_log = {}
try:
    fetch_log = json.loads((RAW / "_fetch_log.json").read_text(encoding="utf-8-sig"))
except Exception as e:
    errors["fetch_log"] = f"could not read _fetch_log.json: {e}"
fetched_at = fetch_log.get("fetched_at")
for entry in fetch_log.get("log", []) or []:
    if not entry.get("ok"):
        key = Path(entry.get("file") or entry.get("method")).stem
        errors[f"parentvue:{key}"] = entry.get("error") or "failed"

today = None
if fetched_at:
    try:
        today = datetime.fromisoformat(re.sub(r"(\.\d{6})\d+", r"\1", fetched_at)).astimezone(ET_TZ).date()
    except Exception:
        pass
if today is None:
    today = datetime.now(ET_TZ).date()

# ---------------- student ----------------
student = {}
root, err = load_xml("ChildList")
if err:
    errors["student"] = err
else:
    child = root.find(".//Child")
    if child is not None:
        student = {
            "name": (child.findtext("ChildName") or "").strip() or None,
            "first_name": child.get("ChildFirstName"),
            "grade": (child.findtext("Grade") or "").strip() or None,
            "school": (child.findtext("OrganizationName") or "").strip() or None,
            "district": root.get("DistrictName"),
        }
si_root, si_err = load_xml("StudentInfo")
if si_err:
    errors["student_info"] = si_err

# ---------------- courses + assignments ----------------
courses, assignments, reporting_period, reporting_periods = [], [], None, []
gb_name = "Gradebook"
gb_root, gb_err = load_xml("Gradebook")
if gb_root is None or gb_root.find(".//Course") is None:
    for alt in sorted(RAW.glob("Gradebook_RP*.xml")):
        r2, e2 = load_xml(alt.stem)
        if r2 is not None and r2.find(".//Course") is not None:
            gb_root, gb_err, gb_name = r2, None, alt.stem
            break
if gb_root is None:
    errors["grades"] = gb_err or "no gradebook data"
else:
    rp = gb_root.find("ReportingPeriod")
    if rp is not None:
        reporting_period = {"name": rp.get("GradePeriod"), "start": iso_d(rp.get("StartDate")), "end": iso_d(rp.get("EndDate"))}
    # full district calendar of grading periods (progress periods + quarters), exactly as ParentVUE lists them
    for x in gb_root.iter("ReportPeriod"):
        reporting_periods.append({"index": int(x.get("Index") or 0), "name": x.get("GradePeriod"),
                                  "start": iso_d(x.get("StartDate")), "end": iso_d(x.get("EndDate"))})
    for c in gb_root.iter("Course"):
        mark = c.find(".//Mark")
        pct = num(mark.get("CalculatedScoreRaw")) if mark is not None else None
        course = {
            "name": c.get("CourseName") or c.get("Title"),
            "title": c.get("Title"),
            "period": c.get("Period"),
            "room": c.get("Room"),
            "teacher": c.get("Staff"),
            "teacher_email": c.get("StaffEMail"),
            "mark_name": mark.get("MarkName") if mark is not None else None,
            "mark": mark.get("CalculatedScoreString") if mark is not None else None,
            "percent": pct,
            "categories": [],
            "assignment_count": 0,
        }
        if mark is not None:
            for g in mark.iter("AssignmentGradeCalc"):
                course["categories"].append({k: g.get(k) for k in ("Type", "Weight", "Points", "PointsPossible", "WeightedPct", "CalculatedMark")})
        seen_ids = set()
        for a in c.iter("Assignment"):
            gid = a.get("GradebookID")
            if gid and gid in seen_ids:  # ParentVUE sometimes repeats an assignment row
                continue
            seen_ids.add(gid)
            notes = (a.get("Notes") or "").strip()
            disp = (a.get("DisplayScore") or "").strip()
            score = num(a.get("ScoreCalValue")) if a.get("ScoreCalValue") is not None else num(a.get("Score"))
            smax = num(a.get("ScoreMaxValue"))
            low = (notes + " " + disp).lower()
            graded = score is not None
            item = {
                "course": course["name"],
                "period": course["period"],
                "teacher": course["teacher"],
                "name": (a.get("Measure") or "").strip(),
                "type": (a.get("Type") or "").strip(),
                "date": iso_d(a.get("Date")),
                "due_date": iso_d(a.get("DueDate")),
                "score_display": disp or None,
                "score": score,
                "score_max": smax,
                "score_pct": round(100 * score / smax, 1) if graded and smax else None,
                "points": a.get("Points"),
                "notes": notes or None,
                "missing": bool(re.search(r"\bmissing\b", low)),
                "zero": graded and score == 0,
                "late": bool(re.search(r"submitted late|turned in late|\blate\s*(\(|penalty|,|$)|\blate (submission|work)", low.strip())),
                "not_graded": disp.lower() in ("not graded", "not due") or not graded,
                "gradebook_id": a.get("GradebookID"),
            }
            assignments.append(item)
            course["assignment_count"] += 1
        courses.append(course)

# schedule / teacher fallback from class list
schedule = []
cl_root, cl_err = load_xml("StudentClassList")
if cl_err:
    errors["class_list"] = cl_err
else:
    for c in cl_root.iter("ClassListing"):
        schedule.append({"period": c.get("Period"), "course": c.get("CourseTitle"), "room": c.get("RoomName"),
                         "teacher": c.get("Teacher"), "teacher_email": c.get("TeacherEmail")})
    by_period = {s["period"]: s for s in schedule}
    for c in courses:
        s = by_period.get(c["period"])
        if s:
            c["teacher"] = c["teacher"] or s["teacher"]
            c["teacher_email"] = c["teacher_email"] or s["teacher_email"]
sch_root, sch_err = load_xml("StudentSchoolInfo")
if sch_err:
    errors["school_info"] = sch_err

# ---------------- attendance ----------------
attendance = {"totals": {}, "entries": [], "absence_days": 0, "tardy_count": 0}
at_root, at_err = load_xml("Attendance")
if at_err:
    errors["attendance"] = at_err
else:
    for tag, key in (("TotalExcused", "excused"), ("TotalUnexcused", "unexcused"), ("TotalTardies", "tardies"),
                     ("TotalUnexcusedTardies", "unexcused_tardies"), ("TotalActivities", "activities")):
        el = at_root.find(tag)
        if el is not None:
            attendance["totals"][key] = int(sum(num(p.get("Total")) or 0 for p in el.iter("PeriodTotal")))
    for ab in at_root.iter("Absence"):
        periods = []
        for p in ab.iter("Period"):
            if (p.get("Name") or "").strip():
                periods.append({"period": p.get("Number"), "code": p.get("Name"), "course": p.get("Course"),
                                "staff": p.get("Staff"), "reason": p.get("Reason") or None})
        codes = " ".join(p["code"] for p in periods).lower()
        kind = "tardy" if "tardy" in codes and "absent" not in codes else ("absence" if periods else "other")
        if "tardy" in codes and "absent" in codes:
            kind = "absence+tardy"
        attendance["entries"].append({
            "date": iso_d(ab.get("AbsenceDate")),
            "kind": kind,
            "reason": ab.get("Reason") or ab.get("CodeAllDayDescription") or None,
            "note": ab.get("Note") or None,
            "periods": periods,
        })
    attendance["entries"].sort(key=lambda e: e["date"] or "", reverse=True)
    attendance["absence_days"] = sum(1 for e in attendance["entries"] if "absence" in e["kind"])
    attendance["tardy_count"] = sum(1 for e in attendance["entries"] for p in e["periods"] if "tardy" in p["code"].lower())
    attendance["school"] = at_root.get("SchoolName")

# ---------------- ParentVUE messages ----------------
messages = []
mroot, merr = load_xml("GetPXPMessages")
if merr:
    errors["messages"] = merr
else:
    for m in list(mroot.iter("MessageListing")) + list(mroot.iter("SynergyMailMessageListing")):
        d = pdate(m.get("BeginDate"))
        frm = m.get("From")
        if frm is None:
            fe = m.find("From")
            frm = (fe.text or "").strip() if fe is not None and fe.text else None
        body = m.get("Content") or m.findtext("Content")
        messages.append({
            "source": "ParentVUE",
            "id": m.get("ID"),
            "date": d.isoformat() if d else None,
            "from": frm or None,
            "subject": html.unescape(m.get("SubjectNoHTML") or m.get("Subject") or "").strip() or None,
            "body_text": re.sub(r"<[^>]+>", " ", html.unescape(body)).strip() if body else None,
            "type": m.get("Type"),
            "module": m.get("Module"),
            "read": m.get("Read") == "true",
        })
    messages.sort(key=lambda x: x["date"] or "", reverse=True)
    if messages and all(m["body_text"] is None for m in messages):
        errors["messages_body"] = "GetPXPMessages returns listings only (no sender/body); bodies need a separate per-message call not made in v1"

# ---------------- calendar ----------------
calendar = []
seen = set()
for name in ("StudentCalendar", "StudentCalendar_next"):
    croot, cerr = load_xml(name)
    if cerr:
        errors[f"calendar:{name}"] = cerr
        continue
    for ev in croot.iter("EventList"):
        k = (ev.get("Date"), ev.get("Title"))
        if k in seen:
            continue
        seen.add(k)
        calendar.append({"date": iso_d(ev.get("Date")), "title": html.unescape(ev.get("Title") or "").strip(),
                         "day_type": ev.get("DayType"), "start_time": ev.get("StartTime") or None})
calendar.sort(key=lambda e: e["date"] or "")
upcoming_calendar = [e for e in calendar if e["date"] and e["date"] >= today.isoformat()]

# ---------------- Gmail ----------------
teacher_emails = {(c.get("teacher_email") or "").lower() for c in courses} | {(s.get("teacher_email") or "").lower() for s in schedule}
teacher_emails.discard("")
gmail = {"query": None, "searched_at": None, "threads": []}
gpath = BASE / "gmail_raw.json"
gmeta = BASE / "gmail_meta.json"
if gmeta.exists():
    gmail.update(json.loads(gmeta.read_text()))
if not gpath.exists():
    errors["gmail"] = "gmail_raw.json not present"
else:
    try:
        graw = json.loads(gpath.read_text(encoding="utf-8"))
        for th in graw.get("threads", []) or []:
            msgs = th.get("messages") or []
            m = msgs[-1] if msgs else {}
            sender = m.get("sender") or ""
            s_low = sender.lower()
            dt = None
            if m.get("date"):
                try:
                    dt = datetime.fromisoformat(m["date"].replace("Z", "+00:00")).astimezone(ET_TZ)
                except ValueError:
                    pass
            personal_school = s_low.endswith("@cobbk12.org") and not re.match(r"(ccsd\.schoolinfo|donotreply|do-not-reply|noreply)", s_low)
            gmail["threads"].append({
                "source": "Gmail",
                "thread_id": th.get("id") or m.get("threadId"),
                "date": dt.isoformat() if dt else m.get("date"),
                "from": sender or None,
                "subject": m.get("subject"),
                "snippet": html.unescape(m.get("snippet") or "") or None,
                "message_count": th.get("messageCount") or len(msgs),
                "unread": "UNREAD" in (m.get("labelIds") or []),
                "from_teacher": s_low in teacher_emails,
                "from_school_staff": personal_school,
                "url": th.get("viewUrl"),
            })
        gmail["threads"].sort(key=lambda x: x["date"] or "", reverse=True)
    except Exception as e:
        errors["gmail"] = f"could not parse gmail_raw.json: {e}"

# ---------------- CTLS Learn (raw/ctls/*.json, optional; additive to ParentVUE) ----------------
# Every file is parsed on its own: a missing/malformed file is logged in ctls.files + errors["ctls:<file>"] and
# never stops the parse. userSettings.json holds the CTLS session (token, signed cookies, encrypt key): it is
# never opened. Fields are whitelisted (no participant demographics, no image URLs, no signed URLs).
CTLS_DIR = RAW / "ctls"
CTLS_SENSITIVE = {"userSettings.json"}
CTLS_KNOWN = ["_ctls_log.json", "userSettings.json", "classrooms.json", "myGradesData.json", "studentAssignments.json",
              "gradebookGrades.json", "feed.json", "chatContacts.json", "chatGroups.json", "calendarUpcoming.json",
              "widgetsHome.json", "welcomeData.json"]
# subject key, regex on the CTLS classroom name, regex on the ParentVUE course name (period comes from ParentVUE)
CTLS_SUBJECTS = [
    ("ss", r"\bss ?7|social stud", r"\bsoc"),
    ("reading", r"\breading\b", r"^reading"),
    ("science", r"\bscience\b", r"science"),
    ("chorus", r"\bchorus\b", r"chorus"),
    ("pltw", r"design and model|\bpltw\b", r"pltw|design and model"),
    ("math", r"\bmath 7\b", r"^math"),
    ("la", r"\bela\b|language arts", r"language arts"),
]
SIGNED_URL = re.compile(r"(https?://[^\s\"'<>]+?)\?[^\s\"'<>]*(?:Signature|Policy|Key-Pair-Id|X-Amz-|token|sig=|Expires)[^\s\"'<>]*", re.I)
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def ctls_cell(h):
    t = re.sub(r"(?i)<\s*(br|/p|/div|/li)\b[^>]*>", "\n", h)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t)).replace("\xa0", " ")
    parts = [re.sub(r"\s+", " ", x).strip() for x in t.split("\n")]
    return "; ".join(x for x in parts if x)


def ctls_table(m):
    """Weekly-agenda tables (header row of days + rows of cells) -> 'Monday: ...' lines; other tables -> rows joined with ' · '."""
    rows = [[ctls_cell(c) for c in re.findall(r"(?is)<t[dh]\b[^>]*>(.*?)</t[dh]\s*>", r)]
            for r in re.findall(r"(?is)<tr\b[^>]*>(.*?)</tr\s*>", m.group(0))]
    rows = [r for r in rows if any(r)]
    if not rows:
        return "\n"
    head = rows[0]
    if len(rows) > 1 and all(h and len(h.split()) <= 4 for h in head):
        lines = []
        for r in rows[1:]:
            for h, c in zip(head, r):
                if c:
                    lines.append(f"{h}: {c}")
        return "\n" + "\n".join(lines) + "\n"
    return "\n" + "\n".join(" · ".join(x for x in r if x) for r in rows) + "\n"


def ctls_text(s, limit=1500):
    """HTML -> plain text; drops tags (so image src URLs go too) and strips query strings from signed URLs."""
    if not s or not isinstance(s, str):
        return None
    s = SIGNED_URL.sub(r"\1", s)
    s = re.sub(r"(?is)<table\b.*?</table\s*>", ctls_table, s)
    s = re.sub(r"(?i)<\s*(br|/p|/div|/li|/tr|/h\d)\b[^>]*>", "\n", s)
    s = re.sub(r"(?i)<\s*/t[dh]\s*>", " · ", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s).replace("\xa0", " ")
    s = SIGNED_URL.sub(r"\1", s)
    lines = [re.sub(r"[ \t]+", " ", x).strip(" ·") for x in s.splitlines()]
    s = "\n".join(x for x in lines if x)
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    if not s:
        return None
    return (s[:limit].rsplit(" ", 1)[0] + "…") if len(s) > limit else s


def ctls_dt(s):
    """ISO UTC timestamp -> ET datetime (None if absent/unparseable)."""
    if not s or not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(ET_TZ)
    except ValueError:
        return None


def ctls_d(s):
    d = ctls_dt(s)
    return d.date().isoformat() if d else None


def ctls_iso(s):
    d = ctls_dt(s)
    return d.isoformat(timespec="seconds") if d else None


def ctls_norm_name(s):
    s = html.unescape(s or "").lower()
    s = re.sub(r"\bweek\s*(\d+)", r"w\1", s)
    s = re.sub(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d{1,2}(\s*-\s*\d{1,2})?\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def ctls_due_from_text(txt, sy_start):
    """'due Sunday, Aug. 30 by 11:59pm' -> 2026-08-30 (within the school year), else None."""
    if not txt:
        return None
    m = re.search(r"\bdue\b[^.]{0,40}?\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})\b", txt, re.I)
    if not m:
        return None
    mo, dy = MONTHS[m.group(1).lower()[:3]], int(m.group(2))
    yr = sy_start.year if mo >= 7 else sy_start.year + 1
    try:
        return date(yr, mo, dy).isoformat()
    except ValueError:
        return None


def ctls_num(v):
    """Number or None (CTLS sometimes sends strings/null)."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    try:
        return float(str(v).replace("%", "").strip())
    except ValueError:
        return None


def ctls_load(name, files_status):
    p = CTLS_DIR / name
    if not p.exists():
        files_status[name] = "not in upload"
        return None
    try:
        raw_txt = p.read_text(encoding="utf-8-sig").strip()
        if not raw_txt:
            files_status[name] = "empty file"
            return None
        return json.loads(raw_txt)
    except Exception as e:  # malformed: log, keep going
        files_status[name] = f"unreadable: {type(e).__name__}"
        errors[f"ctls:{name}"] = f"could not parse {name}: {type(e).__name__}: {str(e)[:120]}"
        return None


def parse_ctls(courses, today):
    out = {"present": CTLS_DIR.is_dir(), "files": {}, "classrooms": [], "assignments": [], "gradebook": [],
           "announcements": [], "contacts": [], "calendar": [], "discrepancies": [], "notes": [], "counts": {}}
    if not out["present"]:
        return out
    files = out["files"]
    sy_start = date(today.year if today.month >= 7 else today.year - 1, 7, 1)
    sy_short = f"{sy_start.year % 100:02d}-{(sy_start.year + 1) % 100:02d}"
    out["school_year"] = f"{sy_start.year}-{(sy_start.year + 1) % 100:02d}"

    def step(name, fn):
        """Run one per-file parser; any exception is logged and the rest of the parse continues."""
        try:
            fn()
            files.setdefault(name, "ok")
        except Exception as e:
            files[name] = f"parse error: {type(e).__name__}"
            errors[f"ctls:{name}"] = f"{name}: {type(e).__name__}: {str(e)[:160]}"

    for extra in sorted(p.name for p in CTLS_DIR.iterdir() if p.is_file()):
        if extra not in CTLS_KNOWN:
            files[extra] = "unknown file (not parsed)"
    files["userSettings.json"] = ("present; not read (CTLS session token/cookies, redacted)"
                                  if (CTLS_DIR / "userSettings.json").exists() else "not in upload")

    # ParentVUE course per subject (period comes from ParentVUE)
    pv_by_subject = {}
    for key, _, pv_rx in CTLS_SUBJECTS:
        c = next((c for c in courses if re.search(pv_rx, (c.get("name") or ""), re.I)), None)
        if c:
            pv_by_subject[key] = c
    surname = {k: (c.get("teacher") or "").split()[-1].lower() for k, c in pv_by_subject.items() if c.get("teacher")}

    # ---- _ctls_log.json
    def f_log():
        lg = ctls_load("_ctls_log.json", files)
        if lg is None:
            return
        out["fetched_at"] = lg.get("fetched_at")
        out["login_ok"] = lg.get("login_ok")
        out["requests"] = [{"name": e.get("name"), "file": e.get("file") or None, "ok": bool(e.get("ok")),
                            "http": e.get("http"), "error": (str(e.get("error"))[:160] if e.get("error") else None)}
                           for e in (lg.get("log") or []) if isinstance(e, dict)]
        for e in out["requests"]:
            if not e["ok"]:
                errors[f"ctls:{e['name']}"] = f"CTLS request failed: {e['error'] or ('HTTP ' + str(e['http']))}"
    step("_ctls_log.json", f_log)

    # ---- classrooms.json
    cls_by_id = {}

    def f_classrooms():
        cl = ctls_load("classrooms.json", files)
        if cl is None:
            return
        if not isinstance(cl, list):
            raise ValueError(f"expected a list, got {type(cl).__name__}")
        taken = {}
        for r in cl:
            if not isinstance(r, dict):
                continue
            name = (r.get("text") or "").strip()
            low = name.lower()
            kw = next((k for k, rx, _ in CTLS_SUBJECTS if re.search(rx, low)), None)
            tn = next((k for k, sn in surname.items() if sn and re.search(rf"\b{re.escape(sn)}\b", low)), None)
            subj = kw or tn
            how = ("name+teacher" if kw and tn == kw else "name" if kw else "teacher" if tn else None)
            if kw and tn and tn != kw:
                out["notes"].append(f"classroom '{name}': name says {kw}, teacher name says {tn}; used {kw}")
            if subj and subj in taken:
                out["notes"].append(f"classroom '{name}' also looks like {subj} (already '{taken[subj]}'); left unmapped")
                subj, how = None, None
            pv = pv_by_subject.get(subj) if subj else None
            if subj and not pv:
                out["notes"].append(f"classroom '{name}' looks like {subj} but there's no matching ParentVUE course")
            if subj and pv:
                taken[subj] = name
            row = {"id": str(r.get("id")), "name": name, "subject": subj if pv else None,
                   "period": pv.get("period") if pv else None, "course": pv.get("name") if pv else None,
                   "teacher": pv.get("teacher") if pv else None, "match": how if pv else None,
                   "kind": "class" if pv else "other", "digital_course_id": r.get("digitalCourseId"),
                   "course_start": r.get("courseStart"), "last_activity": r.get("courseLastActivity")}
            cls_by_id[row["id"]] = row
            out["classrooms"].append(row)
        out["classrooms"].sort(key=lambda x: (x["period"] is None, int(re.sub(r"\D", "", str(x["period"])) or 99) if x["period"] else 0, x["name"]))
    step("classrooms.json", f_classrooms)
    cls_by_name = {c["name"].lower(): c for c in out["classrooms"]}

    def classroom_of(cid=None, cname=None):
        return cls_by_id.get(str(cid)) if cid else (cls_by_name.get(cname.lower()) if cname else None)

    def year_of(class_id, classroom, *dates):
        if classroom:
            return out["school_year"], True
        m = re.search(r"(\d{2})-(\d{2})$", class_id or "")
        if m:
            y = f"20{m.group(1)}-{m.group(2)}"
            return y, m.group(1) + "-" + m.group(2) == sy_short
        for d in dates:
            if d:
                dd = date.fromisoformat(d)
                return (out["school_year"], True) if dd >= sy_start else (None, False)
        return None, False

    # ---- assignments: studentAssignments.json + myGradesData.json (+ feed assignment text), keyed by assignment id
    asg = {}

    def put(aid, **kw):
        a = asg.setdefault(aid, {"ctls_id": aid})
        for k, v in kw.items():
            if v is not None and a.get(k) in (None, "", []):
                a[k] = v

    def f_student_assignments():
        sa = ctls_load("studentAssignments.json", files)
        if sa is None:
            return
        if not isinstance(sa, list):
            raise ValueError(f"expected a list, got {type(sa).__name__}")
        for r in sa:
            if not isinstance(r, dict) or r.get("isDeleted"):
                continue
            aid = str(r.get("assignmentId") or r.get("id") or r.get("_id"))
            sync = r.get("synergySyncInfo") if isinstance(r.get("synergySyncInfo"), dict) else {}
            au = r.get("author") if isinstance(r.get("author"), dict) else {}
            put(aid, name=(r.get("assignmentName") or r.get("name") or "").strip() or None,
                classroom_id=str(r["digitalClassroomId"]) if r.get("digitalClassroomId") else None,
                status=r.get("status"), missing_flag=r.get("isMissing"), points_possible=r.get("pointsPossible"),
                points=r.get("pointsAchieved"), percent=r.get("percentScore"), score_type=r.get("scoreType"),
                type=r.get("type"), created=ctls_d(r.get("dateCreated")), activated=ctls_d(r.get("dateActivated")),
                start=ctls_d(r.get("startDate")), due=ctls_d(r.get("endDate")), submitted=ctls_iso(r.get("dateSubmitted")),
                feedback=ctls_text(r.get("feedback"), 400),
                author=" ".join(x for x in (au.get("firstName"), au.get("lastName")) if x) or None,
                synced_score=sync.get("lastScoreSent"), synced_category=sync.get("lastCategory"),
                synced_at=ctls_iso(sync.get("lastSent")), src_student_assignments=True)
    step("studentAssignments.json", f_student_assignments)

    def f_mygrades():
        mg = ctls_load("myGradesData.json", files)
        if mg is None:
            return
        if not isinstance(mg, list):
            raise ValueError(f"expected a list, got {type(mg).__name__}")
        for r in mg:
            if not isinstance(r, dict):
                continue
            aid = str(r.get("id") or r.get("_id"))
            au = r.get("author") if isinstance(r.get("author"), dict) else {}
            put(aid, name=(r.get("name") or "").strip() or None,
                classroom_id=str(r["digitalClassroomId"]) if r.get("digitalClassroomId") else None,
                classroom_name=r.get("digitalClassroomName"), class_id=r.get("classId"),
                status=r.get("status"), ui_status=r.get("uiStatus"), missing_flag=r.get("isMissing"),
                points_possible=r.get("pointsPossible"), points=r.get("pointsAchieved"), percent=r.get("percentScore"),
                score_type=r.get("scoreType"), type=r.get("type"), source=r.get("source"),
                created=ctls_d(r.get("dateCreated")), start=ctls_d(r.get("startDate")), due=ctls_d(r.get("endDate")),
                closes=ctls_d(r.get("expirationDate")), submitted=ctls_iso(r.get("dateSubmitted")),
                description=ctls_text(r.get("description"), 600), feedback=ctls_text(r.get("feedback"), 400),
                author=" ".join(x for x in (au.get("firstName"), au.get("lastName")) if x) or None,
                src_my_grades=True)
    step("myGradesData.json", f_mygrades)

    # ---- gradebookGrades.json (score grid; mostly district common assessments)
    def f_gradebook():
        gg = ctls_load("gradebookGrades.json", files)
        if gg is None:
            return
        blocks = gg if isinstance(gg, list) else [gg]
        n = 0
        for b in blocks:
            if not isinstance(b, dict):
                continue
            for grid in (b.get("gridData") or []):
                for r in ((grid or {}).get("assignments") or []):
                    if not isinstance(r, dict):
                        continue
                    aid = str(r.get("assignmentId") or r.get("field") or n)
                    put(aid, name=(r.get("assignmentName") or "").strip() or None,
                        classroom_id=str(r["digitalClassroomId"]) if r.get("digitalClassroomId") else None,
                        classroom_name=r.get("digitalClassroomName"), class_id=r.get("classId"), status=r.get("status"),
                        points_possible=r.get("pointsPossible"), points=r.get("pointsAchieved"),
                        percent=r.get("percentScore"), score_type=r.get("scoreType"),
                        assessment_type=r.get("assessmentType"), published=r.get("isPublished"), src_gradebook=True)
                    n += 1
        if not n:
            files["gradebookGrades.json"] = "ok, but no gridData assignments found"
    step("gradebookGrades.json", f_gradebook)

    # ---- feed.json: assignment cards (extra text) + announcements + "board" posts
    def f_feed():
        fd = ctls_load("feed.json", files)
        if fd is None:
            return
        items = []
        cols = fd.get("collections") if isinstance(fd, dict) else fd if isinstance(fd, list) else None
        if cols is None:
            raise ValueError("no 'collections' list")
        for col in cols:
            if not isinstance(col, dict):
                continue
            for k, v in col.items():
                if re.match(r"collection\d+$", k) and isinstance(v, list):
                    items += [x for x in v if isinstance(x, dict)]
        seen_ids, skipped = set(), 0
        for it in items:
            kind = it.get("type")
            ar = it.get("assignResults") if isinstance(it.get("assignResults"), dict) else None
            if it.get("isDeleted"):
                continue
            if ar or it.get("assignmentId"):          # assignment card: only borrow its text/dates
                aid = str((ar or {}).get("assignmentId") or it.get("assignmentId"))
                if aid in asg:
                    put(aid, description=ctls_text(it.get("description"), 600),
                        classroom_id=str(ar["digitalClassroomId"]) if ar and ar.get("digitalClassroomId") else None,
                        start=ctls_d(it.get("startDate")), due=ctls_d(it.get("endDate")))
                else:
                    au = it.get("author") if isinstance(it.get("author"), dict) else {}
                    put(aid, name=(it.get("name") or "").strip() or None,
                        classroom_id=str(ar["digitalClassroomId"]) if ar and ar.get("digitalClassroomId") else None,
                        status=None, points_possible=it.get("points"), type=kind, created=ctls_d(it.get("dateCreated")),
                        start=ctls_d(it.get("startDate")), due=ctls_d(it.get("endDate")),
                        description=ctls_text(it.get("description"), 600),
                        author=" ".join(x for x in (au.get("firstName"), au.get("lastName")) if x) or None, src_feed=True)
                continue
            body = it.get("content") if it.get("content") is not None else it.get("description")
            if not isinstance(body, (str, type(None))):
                skipped += 1
                continue
            text = ctls_text(body)
            iid = it.get("_id") if isinstance(it.get("_id"), str) else str(it.get("id") or "")
            if iid and iid in seen_ids:
                continue
            seen_ids.add(iid)
            au = it.get("author") if isinstance(it.get("author"), dict) else {}
            c = classroom_of(it.get("digitalClassroomId"))
            dt = ctls_dt(it.get("newDate") or it.get("dateCreated"))
            first = (text or "").split("\n", 1)[0]
            out["announcements"].append({
                "id": iid or None, "kind": kind or "post", "date": dt.isoformat(timespec="seconds") if dt else None,
                "classroom_id": str(it.get("digitalClassroomId")) if it.get("digitalClassroomId") else None,
                "classroom": c["name"] if c else None, "subject": c["subject"] if c else None,
                "period": c["period"] if c else None, "course": c["course"] if c else None,
                "author": " ".join(x for x in (au.get("firstName"), au.get("lastName")) if x) or None,
                "pinned": bool(it.get("pinned")), "title": (first[:90].rsplit(" ", 1)[0] + "…") if len(first) > 90 else (first or None),
                "text": text, "current": bool(dt and dt.date() >= sy_start),
            })
        if skipped:
            out["notes"].append(f"feed.json: {skipped} item(s) with a non-text body were skipped")
        out["announcements"].sort(key=lambda x: x["date"] or "", reverse=True)
    step("feed.json", f_feed)

    # ---- finish assignments: classroom, school year, ParentVUE cross-check
    pv_by_period = {}
    for a in assignments:
        pv_by_period.setdefault(a.get("period"), []).append(a)
    bad_items = 0
    for aid, a in asg.items():
      try:
        for k in ("points", "points_possible", "percent"):
            a[k] = ctls_num(a.get(k))
        c = classroom_of(a.get("classroom_id"), a.get("classroom_name"))
        yr, cur = year_of(a.get("class_id"), c, a.get("activated"), a.get("created"))
        due = a.get("due") or ctls_due_from_text(a.get("description"), sy_start)
        st = a.get("status") or ""
        # a real score: points posted on a finished item (CTLS shows 0 points on unstarted/unscored items)
        scored = (a.get("points") is not None and (a.get("points_possible") or 0) > 0
                  and st not in ("Assigned", "Not Assigned", "Ready to Score", "In Progress"))
        pct = a.get("percent")
        if pct is None and scored:
            pct = 100.0 * a["points"] / a["points_possible"]
        row = {
            "ctls_id": aid, "name": a.get("name"), "classroom": c["name"] if c else a.get("classroom_name"),
            "classroom_id": a.get("classroom_id"), "subject": c["subject"] if c else None,
            "period": c["period"] if c else None, "course": c["course"] if c else None,
            "school_year": yr, "current": cur, "type": a.get("type"), "status": st or None,
            "ui_status": a.get("ui_status"), "missing": bool(a.get("missing_flag")),
            "submitted": a.get("submitted"), "points": a.get("points"), "points_possible": a.get("points_possible"),
            "percent": round(pct, 1) if isinstance(pct, (int, float)) else None, "scored": scored,
            "score_type": a.get("score_type"), "assessment_type": a.get("assessment_type"),
            "created": a.get("created"), "activated": a.get("activated"), "start": a.get("start"), "due": due,
            "closes": a.get("closes"), "author": a.get("author"), "description": a.get("description"),
            "feedback": a.get("feedback"), "synced_score": a.get("synced_score"), "synced_category": a.get("synced_category"),
            "synced_at": a.get("synced_at"),
            "sources": [s for s, k in (("studentAssignments", "src_student_assignments"), ("myGradesData", "src_my_grades"),
                                       ("gradebookGrades", "src_gradebook"), ("feed", "src_feed")) if a.get(k)],
        }
        # ParentVUE match (same period, same normalized name)
        if row["period"]:
            nn = ctls_norm_name(row["name"])
            pm = next((p for p in pv_by_period.get(row["period"], []) if ctls_norm_name(p.get("name")) == nn), None)
            if pm:
                row["parentvue"] = {"name": pm.get("name"), "score_pct": pm.get("score_pct"), "score_display": pm.get("score_display"),
                                    "missing": pm.get("missing"), "gradebook_id": pm.get("gradebook_id")}
                if scored and pm.get("score_pct") is not None and abs((row["percent"] or 0) - pm["score_pct"]) >= 1:
                    out["discrepancies"].append(f"P{row['period']} {row['name']}: CTLS {row['percent']:g}% vs ParentVUE {pm['score_pct']:g}%")
                if scored and pm.get("missing"):
                    out["discrepancies"].append(f"P{row['period']} {row['name']}: scored in CTLS ({row['percent']:g}%) but missing in ParentVUE")
            elif scored and row["current"]:
                out["discrepancies"].append(f"P{row['period']} {row['name']}: CTLS score {row['percent']:g}% isn't in ParentVUE yet")
        if row["scored"]:
            out["gradebook"].append({k: row[k] for k in ("ctls_id", "name", "classroom", "subject", "period", "course", "school_year",
                                                         "current", "points", "points_possible", "percent", "status",
                                                         "assessment_type", "submitted", "synced_score")})
        if row["current"]:
            out["assignments"].append(row)
        elif not row["scored"]:
            out["notes"].append(f"CTLS item '{row['name']}' isn't from a current classroom and has no score; skipped")
      except Exception as e:          # one odd item never sinks the rest
        bad_items += 1
        errors["ctls:assignments"] = f"{bad_items} CTLS assignment item(s) skipped; last: {type(e).__name__}: {str(e)[:120]}"
    out["assignments"].sort(key=lambda r: (int(r["period"]) if str(r["period"] or "").isdigit() else 99, r["due"] or r["activated"] or r["created"] or ""))
    out["gradebook"].sort(key=lambda r: (not r["current"], r["school_year"] or "", r["classroom"] or "", r["name"] or ""), reverse=False)

    # ---- chatContacts.json
    def f_contacts():
        cc = ctls_load("chatContacts.json", files)
        if cc is None:
            return
        if not isinstance(cc, list):
            raise ValueError(f"expected a list, got {type(cc).__name__}")
        pv_mail = {(c.get("teacher_email") or "").lower(): c for c in courses}
        for r in cc:
            if not isinstance(r, dict):
                continue
            first, last = (r.get("firstName") or "").strip(), (r.get("lastName") or "").strip()
            email = (r.get("email") or "").strip() or None
            c = pv_mail.get((email or "").lower())
            subj, role = None, None
            if c:
                subj = next((k for k, v in pv_by_subject.items() if v is c), None); role = "teacher"
            elif last:
                m = next((x for x in out["classrooms"] if x["subject"] and re.search(rf"\b{re.escape(last.lower())}\b", x["name"].lower())), None)
                if m:
                    subj, role = m["subject"], "co-teacher (named on the CTLS classroom)"
            pv = pv_by_subject.get(subj) if subj else None
            out["contacts"].append({"name": " ".join(x for x in (first, last) if x) or None, "email": email,
                                    "staff": bool(r.get("staff")), "subject": subj, "period": pv.get("period") if pv else None,
                                    "course": pv.get("name") if pv else None, "role": role})
    step("chatContacts.json", f_contacts)

    def f_groups():
        g = ctls_load("chatGroups.json", files)
        if g is not None:
            out["chat_groups"] = len(g) if isinstance(g, list) else None
    step("chatGroups.json", f_groups)

    def f_calendar():
        cu = ctls_load("calendarUpcoming.json", files)
        if cu is None:
            return
        evs = cu if isinstance(cu, list) else (cu.get("events") or cu.get("data") or []) if isinstance(cu, dict) else []
        for e in evs:
            if isinstance(e, dict):
                title = e.get("title") or e.get("name") or e.get("text")
                when = e.get("start") or e.get("startDate") or e.get("date")
                out["calendar"].append({"title": ctls_text(str(title), 200) if title else None,
                                        "date": ctls_d(when) if isinstance(when, str) and "T" in when else when})
    step("calendarUpcoming.json", f_calendar)

    def f_welcome():
        w = ctls_load("welcomeData.json", files)
        if not isinstance(w, dict):
            return
        act = [x for x in (w.get("activity") or []) if isinstance(x, dict)]
        out["welcome"] = {"last_active": next((x.get("value") for x in act if (x.get("label") or "").lower() == "last active"), None),
                          "content_coaches": sum(1 for x in act if (x.get("label") or "").lower() == "content coach")}
    step("welcomeData.json", f_welcome)

    def f_widgets():
        w = ctls_load("widgetsHome.json", files)
        if w is not None:
            files["widgetsHome.json"] = "ok (home-page layout only; nothing to show)"
    step("widgetsHome.json", f_widgets)

    cur_cls = [c for c in out["classrooms"] if c["kind"] == "class"]
    out["counts"] = {
        "classrooms": len(out["classrooms"]), "mapped_classes": len(cur_cls),
        "assignments": len(out["assignments"]),
        "gradebook_scores": len(out["gradebook"]),
        "gradebook_scores_current": sum(1 for g in out["gradebook"] if g["current"]),
        "announcements": len(out["announcements"]),
        "announcements_current": sum(1 for a in out["announcements"] if a["current"]),
        "contacts": len(out["contacts"]),
    }
    return out


ctls = {"present": False}
try:
    ctls = parse_ctls(courses, today)
except Exception as e:  # never let CTLS break the ParentVUE parse
    errors["ctls"] = f"CTLS parse failed: {type(e).__name__}: {str(e)[:200]}"
    ctls = {"present": CTLS_DIR.is_dir(), "error": errors["ctls"]}

data = {
    "fetched_at": fetched_at,
    "parsed_at": datetime.now(ET_TZ).isoformat(timespec="seconds"),
    "today": today.isoformat(),
    "student": student,
    "reporting_period": reporting_period,
    "reporting_periods": reporting_periods,
    "gradebook_source": gb_name,
    "courses": courses,
    "schedule": schedule,
    "assignments": assignments,
    "attendance": attendance,
    "messages": messages,
    "calendar": calendar,
    "upcoming_calendar": upcoming_calendar,
    "gmail": gmail,
    "ctls": ctls,
    "errors": errors,
}
(BASE / "data.json").write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"data.json: {len(courses)} courses, {len(assignments)} assignments, {len(messages)} PV messages, "
      f"{len(gmail['threads'])} gmail threads, {len(upcoming_calendar)} upcoming calendar, errors={list(errors)}")
if ctls.get("present"):
    k = ctls.get("counts") or {}
    print(f"CTLS: {k.get('classrooms', 0)} classrooms ({k.get('mapped_classes', 0)} mapped to periods), {k.get('assignments', 0)} current assignments, "
          f"{k.get('gradebook_scores', 0)} scores ({k.get('gradebook_scores_current', 0)} this year), "
          f"{k.get('announcements', 0)} posts ({k.get('announcements_current', 0)} this year), {k.get('contacts', 0)} contacts; "
          f"files not ok: {[f for f, v in (ctls.get('files') or {}).items() if not str(v).startswith(('ok', 'present'))]}")
