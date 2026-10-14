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
import fcntl, json, os, smtplib, subprocess, sys, traceback, datetime as dt
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

def run_row(job, status, error=None, counts=None, fetched_at=None):
    uid = owner()
    if not uid: return
    try: rest("POST", "edu_sync_runs", {"user_id": uid, "job_id": job["id"], "kind": job.get("kind"), "status": status,
              "source": f"laptop:{job.get('kind')}", "error": error, "counts": counts or {}, "fetched_at": fetched_at}, prefer="return=minimal")
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
    (DATA / "incoming").mkdir(exist_ok=True); z = DATA / "incoming" / "raw.zip"; z.write_bytes(body)
    jlog(jid, "> parsing + building model", "step")
    ing = subprocess.run(["bash", str(DATA / "ingest_zip.sh"), str(z)], cwd=DATA, capture_output=True, text=True)
    if ing.returncode not in (0, 3):
        last = ((ing.stderr or ing.stdout).strip().splitlines() or ["unknown error"])[-1]
        return fail(f"parse failed: {last[:150]}", ing.stderr or ing.stdout)
    try: d = json.loads((DATA / "data.json").read_text()); fetched = d.get("fetched_at")
    except Exception as e: return fail("parse produced no data.json", str(e))
    ss = subprocess.run([sys.executable, str(HERE / "school_sync.py"), "--force", "--no-run-log"], capture_output=True, text=True, env={**os.environ, "ELI_DATA_DIR": str(DATA)})
    if ss.returncode != 0:
        return fail({2: "Rolan hasn't signed in to Crystal yet", 3: "Crystal tables missing (run migrations)"}.get(ss.returncode, "school_sync failed"), ss.stdout + ss.stderr)
    counts = next((json.loads(l[7:]) for l in ss.stdout.splitlines() if l.startswith("COUNTS ")), {})
    summary = f"{len(d.get('courses') or [])} courses, {len(d.get('assignments') or [])} assignments"
    jlog(jid, f"> model built · {summary}", "info"); jlog(jid, "> sync complete", "ok")
    rest("PATCH", "sync_requests", {"status": "done", "finished_at": iso(now()), "processed_at": iso(now()), "process_message": "ok; " + summary}, {"id": f"eq.{jid}"}, "return=minimal")
    run_row(job, "ok", None, counts, fetched)
    say(f"job {jid} done: {summary} {counts}"); return True

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
    except requests.RequestException as e:
        say(f"Supabase unreachable from the box: {type(e).__name__}"); return 1
    except RuntimeError as e:
        if "PGRST205" in str(e): say("Crystal tables missing: run supabase/migrations 001-003 in the SQL Editor"); return 3
        say(str(e)); return 3 if "PGRST205" in str(e) or "404" in str(e) else 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
