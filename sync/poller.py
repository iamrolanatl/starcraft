#!/usr/bin/env python3
"""Crystal box poller (replaces the EliDash pg_net webhook). Run by cron every minute.

Each run (single-instance lock):
  1. heartbeat file (self-check) + sweep stale jobs (running > 20 min, processing > 40 min -> failed)
  2. every 'processing' job: download the laptop's zip (service_role) -> scrub CTLS secrets in memory ->
     ingest_zip.sh (validate, parse.py, build_app.py) -> school_sync.py -> job 'done' + edu_sync_runs row.
     Any error -> job 'failed' with a plain reason + alert.
  3. alerts (edu_alerts, deduped per incident; shown in Crystal; emailed if a mail path is configured):
       laptop_failed  job failed on the laptop (login failure, ParentVUE unreachable, upload failure)
       box_failed     download / parse / build / school_sync failure on the box
       missed_pull    school day (Mon-Fri, minus ~/.config/crystal/no-school-days.txt) and no job finished
                      'done' since 5:30 by 6:00 AM / since 17:30 by 6:00 PM ET  (covers laptop offline / Supabase unreachable)
Env: CRYSTAL_SUPABASE_URL (default prod), CRYSTAL_SUPABASE_SERVICE_ROLE_KEY, ELI_DATA_DIR (default /workspace/eli-dashboard),
     CRYSTAL_STATE_DIR, CRYSTAL_NOW (test override, ISO), optional CRYSTAL_SMTP_* for email.
Secrets are never printed.
"""
import fcntl, json, os, shutil, smtplib, subprocess, sys, traceback, datetime as dt
from email.message import EmailMessage
from pathlib import Path
from zoneinfo import ZoneInfo
import requests

URL = os.environ.get("CRYSTAL_SUPABASE_URL", "https://ogrrjkxkccbywbiikcak.supabase.co").rstrip("/")
KEY = os.environ.get("CRYSTAL_SUPABASE_SERVICE_ROLE_KEY", "")
OWNER = os.environ.get("CRYSTAL_OWNER_EMAIL", "iamrolan@gmail.com").lower()
DATA = Path(os.environ.get("ELI_DATA_DIR", "/workspace/eli-dashboard"))
STATE = Path(os.environ.get("CRYSTAL_STATE_DIR", str(Path.home() / ".local/state/crystal")))
HERE = Path(__file__).resolve().parent
ET = ZoneInfo("America/New_York")
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
sys.path.insert(0, str(DATA))

def now(): return dt.datetime.fromisoformat(os.environ["CRYSTAL_NOW"]) if os.environ.get("CRYSTAL_NOW") else dt.datetime.now(dt.timezone.utc)
def iso(t): return t.astimezone(dt.timezone.utc).isoformat()
def say(m): print(f"[{now().astimezone(ET):%F %T %Z}] {m}", flush=True)

def rest(method, path, body=None, params=None, prefer="return=representation"):
    r = requests.request(method, f"{URL}/rest/v1/{path}", params=params, headers={**H, "Prefer": prefer},
                         data=None if body is None else json.dumps(body), timeout=60)
    if r.status_code >= 300: raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:300]}")
    return r.json() if r.text else None

def jlog(jid, line, level="info"):
    try: rest("POST", "sync_log", {"request_id": jid, "level": level, "line": line[:500]}, prefer="return=minimal")
    except Exception as e: say(f"sync_log write failed: {e}")

_uid = None
def owner():
    global _uid
    if _uid: return _uid
    r = requests.get(f"{URL}/auth/v1/admin/users", params={"per_page": 200}, headers=H, timeout=30); r.raise_for_status()
    _uid = next((u["id"] for u in r.json().get("users", []) if (u.get("email") or "").lower() == OWNER), None)
    return _uid

def run_row(job, status, error=None, counts=None, fetched_at=None, extra=None):
    uid = owner()
    if not uid: return
    try: rest("POST", "edu_sync_runs", {"user_id": uid, "job_id": job["id"], "kind": job.get("kind"), "status": status,
              "source": f"laptop:{job.get('kind')}", "error": error, "counts": counts or {}, "fetched_at": fetched_at, **(extra or {})}, prefer="return=minimal")
    except Exception as e: say(f"edu_sync_runs write failed: {e}")

def email(subject, body):
    host = os.environ.get("CRYSTAL_SMTP_HOST")
    if not host: return False
    m = EmailMessage(); m["From"] = os.environ.get("CRYSTAL_SMTP_FROM", os.environ.get("CRYSTAL_SMTP_USER", "")); m["To"] = OWNER
    m["Subject"] = subject; m.set_content(body)
    with smtplib.SMTP_SSL(host, int(os.environ.get("CRYSTAL_SMTP_PORT", "465")), timeout=30) as s:
        s.login(os.environ["CRYSTAL_SMTP_USER"], os.environ["CRYSTAL_SMTP_PASSWORD"]); s.send_message(m)
    return True

def alert(kind, key, message, job_id=None):
    uid = owner()
    row = {"kind": kind, "dedupe_key": key, "message": message, "job_id": job_id, "created_at": iso(now())}
    new = True
    if uid:
        ins = rest("POST", "edu_alerts", {**row, "user_id": uid}, {"on_conflict": "user_id,dedupe_key"}, "resolution=ignore-duplicates,return=representation")
        new = bool(ins)
    else:
        seen = STATE / "alerts-seen.txt"; ks = seen.read_text().split() if seen.exists() else []
        new = key not in ks
        if new: seen.write_text("\n".join(ks + [key]))
    if not new: return False
    say(f"ALERT {kind}: {message}")
    with open(STATE / "alerts-outbox.jsonl", "a") as f: f.write(json.dumps({**row, "to": OWNER, "emailed": False}) + "\n")
    try:
        if email(f"Crystal alert: {kind.replace('_', ' ')}", message + "\n\nOpen Crystal > Education for details.") and uid:
            rest("PATCH", "edu_alerts", {"emailed_at": iso(now())}, {"user_id": f"eq.{uid}", "dedupe_key": f"eq.{key}"}, "return=minimal")
    except Exception as e: say(f"email failed: {type(e).__name__}")
    return True

def sweep():
    t = now()
    for st, mins, why in (("running", 20, "timed out: the laptop did not finish within 20 min"), ("processing", 40, "timed out: the box did not finish processing within 40 min")):
        rest("PATCH", "sync_requests", {"status": "failed", "finished_at": iso(t), "message": why},
             {"status": f"eq.{st}", "started_at": f"lt.{iso(t - dt.timedelta(minutes=mins))}"}, "return=minimal")

def process(job):
    jid = job["id"]; say(f"processing job {jid} ({job['kind']}): {job['raw_path']}")
    def fail(short, detail=""):
        say(f"job {jid} failed: {short} {detail[-400:]}")
        jlog(jid, f"> server: {short}", "err")
        rest("PATCH", "sync_requests", {"status": "failed", "finished_at": iso(now()), "processed_at": iso(now()), "process_message": f"{short} {detail[-1500:]}".strip()}, {"id": f"eq.{jid}"}, "return=minimal")
        run_row(job, "failed", short)
        alert("box_failed", f"job:{jid}", f"Sync #{jid} ({job['kind']}) failed on the box: {short}.", jid)
        return False
    jlog(jid, "> server: payload received · downloading", "step")
    try:
        r = requests.get(f"{URL}/storage/v1/object/raw/{job['raw_path']}", headers=H, timeout=120)
    except requests.RequestException as e: return fail("couldn't download the upload", str(e))
    if r.status_code != 200 or not r.content: return fail(f"couldn't download the upload (HTTP {r.status_code})")
    try:
        from scrub_ctls_secrets import scrub_zip_bytes
        body, _ = scrub_zip_bytes(r.content)
    except Exception as e: return fail("bad upload: unreadable zip", type(e).__name__)
    # archive the (scrubbed) zip for 30-day replay, then ingest into a STAGING copy so a bad pull can't touch live files
    arch = STATE / "raw-archive"; arch.mkdir(parents=True, exist_ok=True)
    zname = f"{now().astimezone(ET):%Y%m%dT%H%M%S}_job{jid}.zip"; (arch / zname).write_bytes(body)
    try:   # report cards: independent of the gradebook gate, never fails the job
        from report_cards import store as rc_store
        rc = rc_store(body, URL, KEY, owner()) if owner() else None
        if rc and rc["added"]: jlog(jid, f"> report cards: {len(rc['added'])} new", "ok")
    except Exception as e: say(f"report cards skipped: {type(e).__name__}: {str(e)[:200]}")
    try:   # graded assignments history + category weights (all quarters): permanent upsert, never fails the job
        from graded_assignments import store as ga_store
        ga = ga_store(body, URL, KEY, owner()) if owner() else None
        job["_ga"] = ga
        if ga and (ga["upserted"] or ga["weights"]): jlog(jid, f"> graded assignments: {ga['upserted']} new/updated, {ga['weights']} weight rows", "ok")
        if ga and ga["skipped_periods"]: jlog(jid, f"> graded assignments: suspicious pull kept out for {', '.join(ga['skipped_periods'])}", "warn")
    except Exception as e: say(f"graded assignments skipped: {type(e).__name__}: {str(e)[:200]}")
    try:   # schedule, per-period attendance, cockpit alerts (absence, missing, low score, dip below 90)
        from school_extras import store as ex_store
        ex = ex_store(body, URL, KEY, owner(), alert=lambda k, key, msg: alert(k, key, msg, jid), state_dir=STATE, graded=job.get("_ga")) if owner() else None
        if ex and ex.get("alerts"): jlog(jid, f"> school alerts: {ex['alerts']} new", "warn")
        if ex and ex.get("error"): say(f"school extras: {ex['error']}")
    except Exception as e: say(f"school extras skipped: {type(e).__name__}: {str(e)[:200]}")
    stage = stage_copy(); z = stage / "incoming" / "raw.zip"; z.write_bytes(body)
    jlog(jid, "> parsing + building model (staging)", "step")
    ing = subprocess.run(["bash", str(stage / "ingest_zip.sh"), str(z)], cwd=stage, capture_output=True, text=True)
    if ing.returncode not in (0, 3):
        last = ((ing.stderr or ing.stdout).strip().splitlines() or ["unknown error"])[-1]
        return fail(f"parse failed: {last[:150]}", ing.stderr or ing.stdout)
    try: d = json.loads((stage / "data.json").read_text()); fetched = d.get("fetched_at")
    except Exception as e: return fail("parse produced no data.json", str(e))
    ss = subprocess.run([sys.executable, str(HERE / "school_sync.py"), "--force", "--no-run-log"], capture_output=True, text=True, env={**os.environ, "ELI_DATA_DIR": str(stage)})
    if ss.returncode == 4:   # validation gate rejected the pull: quarantine, live tables + live files untouched
        q = next((json.loads(l[11:]) for l in ss.stdout.splitlines() if l.startswith("QUARANTINE ")), {"reasons": ["unknown"]})
        qd = STATE / "quarantine" / zname[:-4]; qd.mkdir(parents=True, exist_ok=True)
        (qd / "raw.zip").write_bytes(body); shutil.copy(stage / "data.json", qd / "data.json"); (qd / "reasons.json").write_text(json.dumps(q, indent=1))
        why = "; ".join(q["reasons"])
        jlog(jid, f"> quarantined: {why}"[:500], "err")
        rest("PATCH", "sync_requests", {"status": "failed", "finished_at": iso(now()), "processed_at": iso(now()), "process_message": f"quarantined: {why}"[:2000]}, {"id": f"eq.{jid}"}, "return=minimal")
        run_row(job, "quarantined", why, {"fields_rejected": q.get("fields_rejected", 0)}, fetched, extra={"reason": why, "raw_path": job.get("raw_path"), "fields_accepted": 0, "fields_kept": 0, "fields_rejected": q.get("fields_rejected", 0)})
        alert("quarantined", f"job:{jid}", f"Sync #{jid} ({job['kind']}) was QUARANTINED, existing data kept: {why}. Raw pull saved on the box at {qd}.", jid)
        return False
    if ss.returncode != 0:
        return fail({2: "Rolan hasn't signed in to Crystal yet", 3: "Crystal tables missing (run migrations)"}.get(ss.returncode, "school_sync failed"), ss.stdout + ss.stderr)
    counts = next((json.loads(l[7:]) for l in ss.stdout.splitlines() if l.startswith("COUNTS ")), {})
    promote(stage)
    summary = f"{len(d.get('courses') or [])} courses, {len(d.get('assignments') or [])} assignments"
    jlog(jid, f"> model built · {summary}", "info"); jlog(jid, "> sync complete", "ok")
    rest("PATCH", "sync_requests", {"status": "done", "finished_at": iso(now()), "processed_at": iso(now()), "process_message": "ok; " + summary}, {"id": f"eq.{jid}"}, "return=minimal")
    run_row(job, "ok", None, {k: v for k, v in counts.items() if k != "validation"}, fetched,
            extra={"fields_accepted": counts.get("fields_accepted"), "fields_kept": counts.get("fields_kept_old"), "fields_rejected": counts.get("fields_rejected"),
                   "reason": "; ".join(counts.get("validation") or [])[:2000] or None, "raw_path": job.get("raw_path")})
    say(f"job {jid} done: {summary}"); return True

SKIP = {"backups", "web", "incoming", ".venv", "__pycache__", "node_modules"}
PROMOTE = ["data.json", "model.json", "plan.json", "term_finals.json", "raw.zip", "raw", "app", "dashboard.html"]
def stage_copy():
    st = STATE / "stage"
    if st.exists(): shutil.rmtree(st)
    shutil.copytree(DATA, st, ignore=lambda d, names: [n for n in names if d == str(DATA) and n in SKIP], symlinks=True)
    (st / "incoming").mkdir(exist_ok=True)
    return st

def promote(stage):
    """Accepted pull: copy the staged outputs over the live eli-dashboard files (old ones backed up first)."""
    bk = DATA / "backups" / f"pre-promote-{now().astimezone(ET):%Y%m%d-%H%M%S}"; bk.mkdir(parents=True, exist_ok=True)
    for n in PROMOTE:
        src, dst = stage / n, DATA / n
        if not src.exists(): continue
        if dst.exists(): (shutil.copytree if dst.is_dir() else shutil.copy2)(dst, bk / n)
        if src.is_dir():
            if dst.exists(): shutil.rmtree(dst)
            shutil.copytree(src, dst)
        else: shutil.copy2(src, dst)

def retention(days=30):
    """Raw zips are kept 30 days for replay (box archive + Supabase storage), then removed."""
    cut = now() - dt.timedelta(days=days)
    for d in ("raw-archive", "quarantine"):
        for p in (STATE / d).glob("*") if (STATE / d).exists() else []:
            if dt.datetime.fromtimestamp(p.stat().st_mtime, dt.timezone.utc) < cut: (shutil.rmtree if p.is_dir() else os.remove)(p)
    old = rest("GET", "sync_requests", params={"select": "id,raw_path", "raw_path": "not.is.null", "raw_purged_at": "is.null", "finished_at": f"lt.{iso(cut)}"}) or []
    for j in old:
        r = requests.delete(f"{URL}/storage/v1/object/raw/{j['raw_path']}", headers=H, timeout=30)
        if r.status_code in (200, 204, 404, 400):
            rest("PATCH", "sync_requests", {"raw_purged_at": iso(now())}, {"id": f"eq.{j['id']}"}, "return=minimal")

def replay(zpath):
    """Re-run an archived zip through the same staging + validation path (no laptop job). Prints the result."""
    stage = stage_copy(); z = stage / "incoming" / "raw.zip"; shutil.copy(zpath, z)
    ing = subprocess.run(["bash", str(stage / "ingest_zip.sh"), str(z)], cwd=stage, capture_output=True, text=True)
    if ing.returncode not in (0, 3): say("replay: parse failed"); return 2
    ss = subprocess.run([sys.executable, str(HERE / "school_sync.py"), "--force"], capture_output=True, text=True, env={**os.environ, "ELI_DATA_DIR": str(stage)})
    print(ss.stdout + ss.stderr)
    if ss.returncode == 0: promote(stage)
    return ss.returncode

def school_day(day):
    if day.weekday() >= 5: return False
    f = Path.home() / ".config/crystal/no-school-days.txt"
    return not (f.exists() and day.isoformat() in f.read_text())

def check_missed():
    t = now().astimezone(ET); day = t.date()
    if not school_day(day): return
    for slot, start, due in (("AM", (5, 30), (6, 0)), ("PM", (17, 30), (18, 0))):
        s = t.replace(hour=start[0], minute=start[1], second=0, microsecond=0); dl = t.replace(hour=due[0], minute=due[1], second=0, microsecond=0)
        nxt = t.replace(hour=17, minute=30, second=0, microsecond=0) if slot == "AM" else (t.replace(hour=23, minute=59))
        if not (dl <= t <= nxt): continue
        ok = rest("GET", "sync_requests", params={"select": "id", "status": "eq.done", "finished_at": f"gte.{iso(s)}", "limit": "1"})
        if not ok:
            last = rest("GET", "sync_requests", params={"select": "id,status,message,finished_at", "order": "id.desc", "limit": "1"})
            why = f" Last job: #{last[0]['id']} {last[0]['status']} ({(last[0].get('message') or '')[:160]})." if last else " No jobs at all."
            alert("missed_pull", f"missed:{day}:{slot}", f"No successful {slot} school pull by {due[0] % 12 or 12}:00 {'AM' if slot == 'AM' else 'PM'} on {day:%a %b %-d}. "
                  f"The laptop may be off/asleep, offline, or unable to reach Supabase (check C:\\Users\\iamro\\EliDashboard\\sync\\LAST_FAILURE.txt).{why}")

def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--replay":
        STATE.mkdir(parents=True, exist_ok=True); return replay(sys.argv[2])
    if not KEY: say("CRYSTAL_SUPABASE_SERVICE_ROLE_KEY not set"); return 1
    STATE.mkdir(parents=True, exist_ok=True)
    lock = open(STATE / "poller.lock", "w")
    try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: return 0
    (STATE / "poller.heartbeat").write_text(iso(now()))
    try:
        sweep()
        for job in rest("GET", "sync_requests", params={"select": "*", "status": "eq.processing", "raw_path": "not.is.null", "order": "id"}) or []:
            try: process(job)
            except Exception as e: traceback.print_exc(); alert("box_failed", f"job:{job['id']}", f"Sync #{job['id']} crashed on the box: {type(e).__name__}: {str(e)[:200]}", job["id"])
        since = iso(now() - dt.timedelta(hours=24))
        for j in rest("GET", "sync_requests", params={"select": "id,kind,message,process_message,finished_at", "status": "eq.failed", "finished_at": f"gte.{since}"}) or []:
            if j.get("process_message"): continue        # box-side failure: already alerted in process()
            reason = (j.get("message") or "unknown").split(" | ")[-1]
            if alert("laptop_failed", f"job:{j['id']}", f"Sync #{j['id']} ({j['kind']}) failed: {reason}", j["id"]):
                run_row(j, "failed", reason)
        check_missed()
        try: retention()
        except Exception as e: say(f"retention skipped: {type(e).__name__}")
    except requests.RequestException as e:
        say(f"Supabase unreachable from the box: {type(e).__name__}"); return 1
    except RuntimeError as e:
        if "PGRST205" in str(e): say("Crystal tables missing: run supabase/migrations 001-003 in the SQL Editor"); return 3
        say(str(e)); return 3 if "PGRST205" in str(e) or "404" in str(e) else 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
