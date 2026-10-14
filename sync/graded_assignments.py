#!/usr/bin/env python3
"""Graded assignments + category weights from a laptop raw zip -> edu_graded_assignments / edu_grade_calc.
Sources: GradebookAll_RP<i>.xml (every started quarter, fetch.ps1) + Gradebook.xml (current period).
007-style rules: a file with no courses is ignored; a period whose new pull has < half the stored rows (and >= 6 stored)
is skipped as suspicious; an empty/ungraded value never overwrites a graded one; weights with all-zero points never
overwrite stored non-zero ones. Never deletes. Usage: graded_assignments.py <zip>. Prints 'GRADED {json}'."""
import io, json, re, sys, zipfile, datetime as dt
import xml.etree.ElementTree as ET
import requests

def ck(name): return "".join(c for c in (name or "").lower().split(" q")[0].split("7")[0] if c.isalnum())[:24] or "x"   # = school_sync.ck
def num(s):
    m = re.search(r"-?\d+(?:\.\d+)?", s or ""); return float(m[0]) if m else None
def d(s):
    try: return dt.datetime.strptime((s or "").strip(), "%m/%d/%Y").date().isoformat()
    except ValueError: return None
UNGRADED = re.compile(r"(?i)^\s*(not\s+due|not\s+graded|n/?a|)\s*$")
MISSING = re.compile(r"(?i)missing")

def parse_assignment(a):
    score = (a.get("DisplayScore") or a.get("Score") or "").strip(); pts = (a.get("Points") or "").strip(); notes = (a.get("Notes") or "").strip()
    missing = bool(MISSING.search(score) or MISSING.search(notes))
    earned = possible = pct = None
    m = re.match(r"\s*(-?[\d.]+)\s*/\s*([\d.]+)", pts)
    if m: earned, possible = float(m[1]), float(m[2])
    elif "possible" in pts.lower(): possible = num(pts)
    m2 = re.match(r"\s*(-?[\d.]+)\s*(?:out of|/)\s*([\d.]+)", score)
    if m2 and float(m2[2]): pct = round(float(m2[1]) / float(m2[2]) * 100, 1)
    elif not UNGRADED.match(score) and num(score) is not None and re.search(r"(?i)percent", a.get("ScoreType") or "") : pct = num(score)
    elif earned is not None and possible: pct = round(earned / possible * 100, 1)
    graded = missing or (not UNGRADED.match(score) and (pct is not None or earned is not None))
    return {"score_display": score or None, "points_display": pts or None, "earned": earned, "possible": possible, "percent": pct,
            "notes": notes or None, "graded": bool(graded), "missing": missing}

def parse_file(xml):
    try: r = ET.fromstring(xml)
    except ET.ParseError: return [], []
    rp = r.find(".//ReportingPeriod"); pname = rp.get("GradePeriod") if rp is not None else None
    pidx = next((int(e.get("Index")) for e in r.iter("ReportPeriod") if e.get("GradePeriod") == pname), None)
    courses = list(r.iter("Course"))
    if not pname or not courses: return [], []
    rows, calc = [], []
    for c in courses:
        course = re.sub(r"\s*\([\d.]+\)\s*$", "", c.get("Title") or ""); key = ck(course)
        for g in c.iter("AssignmentGradeCalc"):
            if not g.get("Type"): continue
            calc.append({"period_name": pname, "course_key": key, "category": g.get("Type"), "weight": num(g.get("Weight")),
                         "points": num(g.get("Points")), "points_possible": num(g.get("PointsPossible")),
                         "weighted_pct": num(g.get("WeightedPct")), "calculated_mark": g.get("CalculatedMark")})
        for a in c.iter("Assignment"):
            if not a.get("GradebookID"): continue
            rows.append({"period_name": pname, "period_index": pidx, "course_key": key, "course": course, "teacher": c.get("Staff"),
                         "gradebook_id": a.get("GradebookID"), "name": a.get("Measure"), "category": a.get("Type"),
                         "assigned_date": d(a.get("Date")), "due_date": d(a.get("DueDate")), **parse_assignment(a)})
    return rows, calc

def extract(zbytes):
    z = zipfile.ZipFile(io.BytesIO(zbytes)); rows, calc = {}, {}
    names = sorted(n for n in z.namelist() if re.fullmatch(r"(GradebookAll_RP\d+|Gradebook)\.xml", n))
    for n in names:
        rs, cs = parse_file(z.read(n).decode("utf-8", "replace"))
        for r in rs: rows[(r["course_key"], r["period_name"], r["gradebook_id"])] = r
        for c in cs: calc[(c["course_key"], c["period_name"], c["category"])] = c
    return list(rows.values()), list(calc.values())

KEEP = ["score_display", "points_display", "earned", "possible", "percent", "notes"]
def _same(a, b):
    if isinstance(b, (int, float)) and a is not None:
        try: return float(a) == float(b)
        except (TypeError, ValueError): return False
    return a == b

def _post(url, H, table, conflict, rows):
    for i in range(0, len(rows), 200):
        x = requests.post(f"{url}/rest/v1/{table}", params={"on_conflict": conflict}, data=json.dumps(rows[i:i + 200]),
                          headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"}, timeout=60)
        if x.status_code >= 300: raise RuntimeError(f"{table} upsert -> {x.status_code}: {x.text[:200]}")

def store(zbytes, url, key, uid):
    H = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    new, calc = extract(zbytes); res = {"parsed": len(new), "upserted": 0, "weights": 0, "skipped_periods": []}
    if not new and not calc: return res
    get = lambda t: requests.get(f"{url}/rest/v1/{t}", params={"select": "*", "user_id": f"eq.{uid}"}, headers=H, timeout=60)
    o1 = get("edu_graded_assignments"); o1.raise_for_status(); om = {(o["course_key"], o["period_name"], o["gradebook_id"]): o for o in o1.json()}
    for p in {r["period_name"] for r in new}:
        n_old = sum(1 for k in om if k[1] == p); n_new = sum(1 for r in new if r["period_name"] == p)
        if n_old >= 6 and n_new < n_old / 2: res["skipped_periods"].append(p); new = [r for r in new if r["period_name"] != p]
    now = dt.datetime.now(dt.timezone.utc).isoformat(); rows = []
    for r in new:
        o = om.get((r["course_key"], r["period_name"], r["gradebook_id"]))
        if o and o.get("graded") and not r["graded"]:
            r = {**r, **{k: o[k] for k in KEEP}, "graded": True, "missing": bool(o["missing"] or r["missing"])}
        elif o:
            for k in KEEP:
                if r[k] in (None, "") and o.get(k) not in (None, ""): r[k] = o[k]
        if o and all(_same(r[k], o.get(k)) for k in r): continue
        rows.append({**r, "user_id": uid, "updated_at": now})
    _post(url, H, "edu_graded_assignments", "user_id,course_key,period_name,gradebook_id", rows); res["upserted"] = len(rows)
    o2 = get("edu_grade_calc"); o2.raise_for_status(); cm = {(o["course_key"], o["period_name"], o["category"]): o for o in o2.json()}
    crow = []
    for c in calc:
        o = cm.get((c["course_key"], c["period_name"], c["category"]))
        if o and not c["points_possible"] and o.get("points_possible"): continue   # blank pull never overwrites real totals
        if o and all(_same(c[k], o.get(k)) for k in c): continue
        crow.append({**c, "user_id": uid, "updated_at": now})
    _post(url, H, "edu_grade_calc", "user_id,course_key,period_name,category", crow); res["weights"] = len(crow)
    return res

if __name__ == "__main__":
    import os
    sys.path.insert(0, os.path.dirname(__file__)); import poller
    print("GRADED " + json.dumps(store(open(sys.argv[1], "rb").read(), poller.URL, poller.KEY, poller.owner())))
