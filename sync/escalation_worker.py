#!/usr/bin/env python3
"""Crystal escalation worker (box daemon). Answers hard chat questions escalated by functions/api/chat.ts.

Loop (every 5 s, single instance via lock file):
  1. Pull up to 10 messages from the Cloudflare Queue "crystal-escalations" (HTTP pull consumer API).
  2. Sweep chat_escalations for rows still 'queued' after 15 s (queue send failed / message lost) and
     'working' rows stuck > 3 min (requeue, max 3 attempts, then 'failed').
  3. For each id: claim (queued -> working, conditional PATCH so only one worker wins), answer with
     Workers AI's largest instruct model over REST using the stored grounded context and strict
     no-invention rules, write answer + 'answered' (or 'failed' + reason), then ack the queue message.
Env (never printed): CRYSTAL_SUPABASE_SERVICE_ROLE_KEY (~/.config/crystal/sync.env),
     CRYSTAL_CLOUDFLARE_API_TOKEN, CRYSTAL_CF_ACCOUNT_ID, CRYSTAL_ESC_QUEUE_ID (~/.config/crystal/escalation.env).
Log: ~/.local/state/crystal/escalations.log   Heartbeat: ~/.local/state/crystal/escalation.heartbeat
"""
import datetime as dt, fcntl, json, os, sys, time, traceback
from pathlib import Path
import requests

SB = os.environ.get("CRYSTAL_SUPABASE_URL", "https://ogrrjkxkccbywbiikcak.supabase.co").rstrip("/")
SKEY = os.environ.get("CRYSTAL_SUPABASE_SERVICE_ROLE_KEY", "")
CFT = os.environ.get("CRYSTAL_CLOUDFLARE_API_TOKEN", "")
ACC = os.environ.get("CRYSTAL_CF_ACCOUNT_ID", "74b54514480f0ab4da30dc3e835e13d2")
QID = os.environ.get("CRYSTAL_ESC_QUEUE_ID", "e7906780605244e2b70c94bd62acc889")
STATE = Path(os.environ.get("CRYSTAL_STATE_DIR", str(Path.home() / ".local/state/crystal")))
MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/meta/llama-3.1-70b-instruct"]
INTERVAL = 5
CF = f"https://api.cloudflare.com/client/v4/accounts/{ACC}"
SYSTEM = """You are Crystal, an upbeat robot co-pilot in a space-cockpit productivity app, answering a question that was escalated because it was hard.
STRICT RULES:
- For anything about the user's own life (student, school, grades, classes, teachers, assignments, tasks, calendar, health, meds, bills, money, credit, stocks, shopping, comms, check-ins, weather), use ONLY the DATA below. If it isn't there, say plainly "I don't have that in your data." Never invent or estimate numbers, grades, names, dates, prices or readings. Cite the source and its "as of" time when you use data. If DATA says demo, say it is demo data.
- For general knowledge, reasoning or planning, think it through step by step and give a clear, correct, well-structured answer. If you are genuinely unsure, say so instead of guessing.
- Be concise: under 250 words unless the question needs a longer step-by-step plan."""

def log(msg):
    STATE.mkdir(parents=True, exist_ok=True)
    with open(STATE / "escalations.log", "a") as f:
        f.write(f"{dt.datetime.now().astimezone().isoformat(timespec='seconds')} {msg}\n")

def now(): return dt.datetime.now(dt.timezone.utc).isoformat()
SH = lambda: {"apikey": SKEY, "authorization": f"Bearer {SKEY}", "content-type": "application/json"}
CH = lambda: {"authorization": f"Bearer {CFT}", "content-type": "application/json"}

def sb_patch(q, body, ret=True):
    h = SH(); h["prefer"] = "return=representation" if ret else "return=minimal"
    r = requests.patch(f"{SB}/rest/v1/chat_escalations?{q}", headers=h, data=json.dumps(body), timeout=15)
    r.raise_for_status(); return r.json() if ret else None

def pull():
    r = requests.post(f"{CF}/queues/{QID}/messages/pull", headers=CH(), json={"batch_size": 10, "visibility_timeout_ms": 60000}, timeout=15)
    r.raise_for_status(); return (r.json().get("result") or {}).get("messages") or []

def ack(leases, retry=()):
    if not leases and not retry: return
    requests.post(f"{CF}/queues/{QID}/messages/ack", headers=CH(), json={"acks": [{"lease_id": l} for l in leases], "retries": [{"lease_id": l, "delay_seconds": 10} for l in retry]}, timeout=15).raise_for_status()

def ai(messages):
    last = None
    for m in MODELS:
        try:
            r = requests.post(f"{CF}/ai/run/{m}", headers=CH(), json={"messages": messages, "max_tokens": 900, "temperature": 0.2}, timeout=60)
            if r.status_code != 200: last = f"{m}: HTTP {r.status_code}"; continue
            res = r.json().get("result") or {}
            t = res.get("response") or ((res.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            if isinstance(t, str) and t.strip(): return t.strip(), m
            last = f"{m}: empty"
        except Exception as e: last = f"{m}: {type(e).__name__}"
    raise RuntimeError(f"no model answered ({last})")

def answer(eid):
    """Claim + answer one row. Returns True when the queue message can be acked."""
    rows = sb_patch(f"id=eq.{eid}&status=eq.queued", {"status": "working", "claimed_at": now(), "updated_at": now()})
    if not rows: return True  # already claimed/answered by an earlier pass, or unknown id
    row = rows[0]; t0 = time.time()
    try:
        hist = [{"role": m.get("role"), "content": str(m.get("content", ""))[:2000]} for m in (row.get("history") or []) if m.get("role") in ("user", "assistant")]
        if not hist or hist[-1]["role"] != "user" or hist[-1]["content"] != row["question"]: hist.append({"role": "user", "content": row["question"]})
        text, model = ai([{"role": "system", "content": f"{SYSTEM}\n\nDATA (snapshot when asked, {row['created_at']}):\n{row.get('context') or '(none)'}"}] + hist[-8:])
        sb_patch(f"id=eq.{eid}", {"status": "answered", "answer": text[:8000], "model": model, "answered_at": now(), "updated_at": now(), "attempts": (row.get("attempts") or 0) + 1}, ret=False)
        lat = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))).total_seconds()
        log(f"answered {eid} model={model} answer_s={time.time()-t0:.1f} end_to_end_s={lat:.1f} reason={row.get('reason')}")
    except Exception as e:
        att = (row.get("attempts") or 0) + 1
        sb_patch(f"id=eq.{eid}", {"status": "queued" if att < 3 else "failed", "error": str(e)[:300], "attempts": att, "updated_at": now()}, ret=False)
        log(f"error {eid} attempt={att}: {str(e)[:200]}")
    return True

def sweep():
    old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=15)).isoformat()
    stuck = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=3)).isoformat()
    r = requests.get(f"{SB}/rest/v1/chat_escalations?select=id&status=eq.queued&created_at=lt.{old}&order=created_at&limit=10", headers=SH(), timeout=15)
    if r.status_code == 404 or (r.status_code >= 400 and "chat_escalations" in r.text):
        raise LookupError("table chat_escalations missing (run 006_chat_escalations.sql)")
    r.raise_for_status(); ids = [x["id"] for x in r.json()]
    for x in sb_patch(f"status=eq.working&claimed_at=lt.{stuck}&attempts=lt.3", {"status": "queued", "updated_at": now()}): log(f"requeued stuck {x['id']}")
    sb_patch(f"status=eq.working&claimed_at=lt.{stuck}&attempts=gte.3", {"status": "failed", "error": "worker timed out", "updated_at": now()}, ret=False)
    return ids

def tick():
    worked = False; leases, retry = [], []
    for m in pull():
        try: body = m.get("body"); body = json.loads(body) if isinstance(body, str) else body; eid = str((body or {}).get("id") or "")
        except Exception: eid = ""
        if not eid or len(eid) != 36: leases.append(m["lease_id"]); log("acked malformed message"); continue
        (leases if answer(eid) else retry).append(m["lease_id"]); worked = True
    ack(leases, retry)
    for eid in sweep():
        log(f"sweep picked {eid}"); answer(eid); worked = True
    return worked

def main():
    if not (SKEY and CFT): print("escalation_worker: missing credentials env", file=sys.stderr); sys.exit(2)
    STATE.mkdir(parents=True, exist_ok=True)
    lock = open(STATE / "escalation.lock", "w")
    try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError: sys.exit(0)  # already running
    log(f"started pid={os.getpid()}"); last_err = ""
    while True:
        (STATE / "escalation.heartbeat").touch(); busy = False
        try: busy = tick(); last_err = ""
        except Exception as e:
            msg = f"{type(e).__name__}: {str(e)[:200]}"
            if msg != last_err: log(f"tick error {msg}"); last_err = msg
        if "--once" in sys.argv: return
        if not busy: time.sleep(INTERVAL)

if __name__ == "__main__":
    try: main()
    except KeyboardInterrupt: pass
    except Exception: log("fatal " + traceback.format_exc().replace("\n", " | ")[:800]); raise
