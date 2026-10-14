#!/usr/bin/env python3
"""Education › Learn refresh.

Reads the latest ParentVUE pull (raw archive zip), detects the current classes, recent/upcoming
assignments and unit changes, and prints which classes need research. Optionally:
  --load     upsert sync/learn/seed.json (units) + sync/learn/resources.json (links) into Supabase
  --verify   re-check every resource URL; failing links are marked active=false (never deleted)
Never invents data: it only reports what the pull shows; unit research is done by a person/agent
who edits seed.json/resources.json (see docs/learn.md).
Env (never printed): CRYSTAL_SUPABASE_SERVICE_ROLE_KEY from ~/.config/crystal/sync.env.
"""
import argparse, html, io, json, os, re, sys, zipfile, datetime as dt
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARCH = Path(os.environ.get("CRYSTAL_RAW_ARCHIVE", Path.home() / ".local/state/crystal/raw-archive"))
SEED, RES = HERE / "learn/seed.json", HERE / "learn/resources.json"
CANON = [("Soc Stdy", "Social Studies 7"), ("Reading", "Reading 7"), ("Science", "Science 7"), ("Phys Ed", "Phys Ed 7"),
         ("Chorus", "Chorus 7"), ("Math", "Math 7"), ("Language Arts", "Language Arts 7"), ("PLTW", "PLTW Design & Modeling")]

def canon(title):
    for k, v in CANON:
        if k.lower() in title.lower(): return v
    return re.sub(r"\s*\(.*$", "", title).strip()

def pdate(s):
    try: return dt.datetime.strptime(s, "%m/%d/%Y").date()
    except Exception: return None

def latest_zip():
    zs = sorted(ARCH.glob("*.zip"))
    return zs[-1] if zs else None

def read_pull(zpath):
    out = {}
    with zipfile.ZipFile(zpath) as z:
        names = {n.replace("\\", "/").split("/")[-1]: n for n in z.namelist()}
        for fname in ("GradebookAll_RP1.xml", "Gradebook.xml"):  # Q1 history, then current period overrides
            if fname not in names: continue
            root = ET.fromstring(z.read(names[fname]))
            for c in root.iter("Course"):
                if c.get("Title", "").startswith("Homeroom"): continue
                k = canon(c.get("Title", ""))
                d = out.setdefault(k, {"class": k, "teacher": c.get("Staff"), "current": False, "assignments": []})
                if fname == "Gradebook.xml": d["current"] = True; d["teacher"] = c.get("Staff")
                seen = {(a["name"], a["due"]) for a in d["assignments"]}
                for a in c.iter("Assignment"):
                    nm = html.unescape(html.unescape(a.get("Measure") or "")).strip(); due = pdate(a.get("DueDate") or a.get("Date") or "")
                    if (nm, due) in seen: continue
                    seen.add((nm, due)); d["assignments"].append({"name": nm, "due": due, "type": (a.get("Type") or "").strip(), "score": a.get("Score")})
    return out

def analyse(pull, seed, today, horizon=14):
    units = {u["class"]: u for u in seed.get("units", [])}
    researched = dt.date.fromisoformat(seed.get("generated", "1970-01-01"))
    report = []
    for k, d in sorted(pull.items()):
        u = units.get(k); reasons = []
        known = set((u or {}).get("seen_assignments", []))
        new = [a for a in d["assignments"] if a["name"] not in known]
        upcoming = sorted([a for a in d["assignments"] if a["due"] and today <= a["due"] <= today + dt.timedelta(days=horizon)], key=lambda a: a["due"])
        tests = [a for a in new if re.search(r"\b(test|unit|exam|project)\b", a["name"], re.I)]
        if not d["current"]: reasons.append("not on current schedule")
        elif not u: reasons.append("no unit researched yet")
        elif u.get("status") == "unknown": reasons.append("current unit unknown")
        if tests: reasons.append("new unit/test signal: " + "; ".join(a["name"] for a in tests[:3]))
        if new and d["current"]: reasons.append(f"{len(new)} new assignment(s) since research on {researched}: " + "; ".join(a["name"] for a in new[:4]))
        if u and (today - researched).days >= 7 and d["current"]: reasons.append("research older than 7 days")
        report.append({"class": k, "teacher": d["teacher"], "current": d["current"], "unit": u and u["unit"],
                       "needs_research": bool(d["current"] and reasons), "reasons": reasons,
                       "upcoming": [{"name": a["name"], "due": a["due"].isoformat()} for a in upcoming]})
    return report

def supa():
    sys.path.insert(0, str(HERE)); import school_sync as S  # reuses its env loading + owner lookup
    return S

def load(S):
    import requests
    uid = S.owner_id(); assert uid, "owner account not found"
    H = {**S.H, "Prefer": "resolution=merge-duplicates,return=minimal", "Content-Type": "application/json"}
    seed = json.loads(SEED.read_text()); res = json.loads(RES.read_text()); now = dt.datetime.now(dt.timezone.utc).isoformat()
    rows = [{"user_id": uid, "class_name": u["class"], "teacher": u.get("teacher"), "unit": u["unit"], "topic": u.get("topic"), "book": u.get("book"),
             "pattern": u.get("pattern"), "status": u["status"], "source": u["source"], "confidence": u["confidence"], "evidence": u["evidence"],
             "timeline": u.get("timeline", []), "researched_at": now} for u in seed["units"]]
    # units for a class that are no longer in seed become 'past' (kept)
    cur = requests.get(f"{S.URL}/rest/v1/learn_units", params={"select": "class_name,unit,status", "user_id": f"eq.{uid}"}, headers=S.H, timeout=30); cur.raise_for_status()
    keep = {(r["class_name"], r["unit"]) for r in rows}
    for r in cur.json():
        if (r["class_name"], r["unit"]) not in keep and r["status"] in ("current", "upcoming"):
            requests.patch(f"{S.URL}/rest/v1/learn_units", params={"user_id": f"eq.{uid}", "class_name": f"eq.{r['class_name']}", "unit": f"eq.{r['unit']}"},
                           headers=H, json={"status": "past"}, timeout=30).raise_for_status()
    r = requests.post(f"{S.URL}/rest/v1/learn_units?on_conflict=user_id,class_name,unit", headers=H, json=rows, timeout=30); r.raise_for_status()
    unit_of = {u["class"]: u["unit"] for u in seed["units"]}
    rr = [{"user_id": uid, "class_name": x["class_name"], "unit": unit_of.get(x["class_name"]), "title": x["title"], "url": x["url"], "type": x["type"],
           "source": x["source"], "for_assignment": x.get("for_assignment"), "verified_at": x["verified_at"], "active": True} for x in res]
    r = requests.post(f"{S.URL}/rest/v1/learn_resources?on_conflict=user_id,class_name,url", headers=H, json=rr, timeout=30); r.raise_for_status()
    print(f"loaded {len(rows)} units, {len(rr)} resources")

def verify(S):
    import requests
    uid = S.owner_id(); H = {**S.H, "Content-Type": "application/json", "Prefer": "return=minimal"}
    rows = requests.get(f"{S.URL}/rest/v1/learn_resources", params={"select": "id,url", "user_id": f"eq.{uid}"}, headers=S.H, timeout=30).json()
    bad = 0
    for x in rows:
        try: ok = requests.get(x["url"], timeout=20, headers={"User-Agent": "Mozilla/5.0"}, allow_redirects=True).status_code < 400
        except Exception: ok = False
        patch = {"active": ok, **({"verified_at": dt.datetime.now(dt.timezone.utc).isoformat()} if ok else {})}
        requests.patch(f"{S.URL}/rest/v1/learn_resources", params={"id": f"eq.{x['id']}"}, headers=H, json=patch, timeout=30)
        bad += not ok
    print(f"verified {len(rows)} links, {bad} failing (marked inactive)")

def stamp(pull):
    """After research: record the assignment names the research saw, so later pulls flag only new ones."""
    seed = json.loads(SEED.read_text())
    for u in seed["units"]:
        if u["class"] in pull: u["seen_assignments"] = sorted({a["name"] for a in pull[u["class"]]["assignments"]})
    SEED.write_text(json.dumps(seed, indent=1, ensure_ascii=False)); print("seed stamped")

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--zip"); ap.add_argument("--today"); ap.add_argument("--json", action="store_true")
    ap.add_argument("--load", action="store_true"); ap.add_argument("--verify", action="store_true"); ap.add_argument("--stamp", action="store_true")
    a = ap.parse_args()
    z = Path(a.zip) if a.zip else latest_zip()
    if not z: sys.exit("no pull archive found")
    pull = read_pull(z)
    if not any(d["current"] for d in pull.values()):
        sys.exit(f"{z.name}: no current-period gradebook in pull; refusing to judge (blank pull)")
    if a.stamp: stamp(pull)
    today = dt.date.fromisoformat(a.today) if a.today else dt.date.today()
    rep = analyse(pull, json.loads(SEED.read_text()), today)
    if a.json: print(json.dumps({"pull": z.name, "classes": rep}, indent=1))
    else:
        print(f"pull {z.name} · {today}")
        for r in rep:
            flag = "RESEARCH" if r["needs_research"] else ("ok" if r["current"] else "inactive")
            print(f"[{flag:8}] {r['class']} ({r['teacher']}) — unit: {r['unit'] or '?'}")
            for x in r["reasons"]: print(f"            · {x}")
            for u in r["upcoming"]: print(f"            ↳ due {u['due']}: {u['name']}")
    if a.load or a.verify:
        S = supa()
        if a.load: load(S)
        if a.verify: verify(S)

if __name__ == "__main__": main()
