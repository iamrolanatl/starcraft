import json, os, subprocess, sys, time, requests
sys.path.insert(0, "/tmp/e2e"); from jwt import tok
G = "http://127.0.0.1:54321"; ANON = tok({"role": "anon"}); SVC = tok({"role": "service_role"})
OWN = tok({"role": "authenticated", "sub": "11111111-1111-1111-1111-111111111111", "email": "iamrolan@gmail.com"})
BAD = tok({"role": "authenticated", "sub": "22222222-2222-2222-2222-222222222222", "email": "intruder@example.com"})
SECRET = open(os.path.expanduser("~/.config/crystal/agent-secret.txt")).read().strip()
res = []
def ok(name, cond, extra=""): res.append((name, bool(cond))); print(("PASS " if cond else "FAIL ") + name, extra if not cond or os.environ.get("V") else "")
def h(t): return {"apikey": ANON, "Authorization": "Bearer " + t, "Content-Type": "application/json"}
def rpc(fn, t=ANON, **p): return requests.post(f"{G}/rest/v1/rpc/{fn}", headers=h(t), json=p)
def agent(fn, **p): return rpc(fn, p_secret=SECRET, **p)
def get(path, t=SVC, **q): return requests.get(f"{G}/rest/v1/{path}", headers=h(t), params=q)
def sql(s): return subprocess.run(["sudo", "-n", "-u", "postgres", "psql", "-d", "t", "-qAt", "-c", s], capture_output=True, text=True).stdout.strip()
def poll(now=None):
    env = {**os.environ, "CRYSTAL_SUPABASE_URL": G, "CRYSTAL_SUPABASE_SERVICE_ROLE_KEY": SVC, "ELI_DATA_DIR": "/tmp/e2e/eli", "CRYSTAL_STATE_DIR": "/tmp/e2e/state", "HOME": "/tmp/e2e/home"}
    if now: env["CRYSTAL_NOW"] = now
    r = subprocess.run([sys.executable, "/workspace/crystal/sync/poller.py"], env=env, capture_output=True, text=True)
    out = (r.stdout + r.stderr).strip()
    if out: print("   poller: " + out[-700:].replace("\n", "\n   poller: "))
    return r
def upload(path, data): return requests.post(f"{G}/storage/v1/object/raw/{path}", headers={"apikey": ANON, "Authorization": "Bearer " + ANON, "Content-Type": "application/zip"}, data=data)
def alerts(): return get("edu_alerts", order="id").json()
ZIP = open("/workspace/eli-dashboard/raw.zip", "rb").read()

ok("R6 anon cannot read edu_grades/sync_requests", get("edu_grades", ANON).status_code in (401, 403) and get("sync_requests", ANON).status_code in (401, 403))
ok("R6 bad agent secret rejected", "invalid agent secret" in rpc("agent_claim_sync", p_secret="x" * 50).text)
ok("R6 anon cannot call request_sync", rpc("request_sync", ANON).status_code in (401, 403))
ok("R6 intruder cannot request sync", rpc("request_sync", BAD).status_code >= 400)
ok("R6 anon upload without ticket refused", upload("incoming/evil.zip", b"x").status_code == 403)

t0 = time.time()
r = rpc("request_sync", OWN); ok("R1 Sync button (request_sync) creates pending job", r.ok and r.json()["status"] == "pending", r.text[:200])
job = agent("agent_claim_sync").json(); ok("R1 laptop claims job + one-time upload path", job and job.get("upload_path"), job)
agent("agent_log", p_id=job["id"], p_level="step", p_line="> ParentVUE: pulling gradebook")
ok("R2 laptop upload with ticket", upload(job["upload_path"], ZIP).status_code == 200)
ok("R6 anon cannot download the zip", requests.get(f"{G}/storage/v1/object/raw/{job['upload_path']}", headers=h(ANON)).status_code != 200)
fp = agent("agent_finish_pull", p_id=job["id"], p_upload_path=job["upload_path"]); ok("R2 agent_finish_pull -> processing", fp.ok and fp.json()["status"] == "processing", fp.text[:200])
ok("R6 used ticket cannot be reused", upload(job["upload_path"], b"y").status_code == 403)
poll()
j = get("sync_requests", id=f"eq.{job['id']}").json()[0]
ok("R2 job done by box poller", j["status"] == "done", j)
ok("R2 processing time", time.time() - t0 < 240, f"{time.time() - t0:.1f}s")
print(f"   hand-off->done: {time.time() - t0:.1f}s")
cnt = {t: len(get(t).json()) for t in ("edu_grades", "edu_assignments", "edu_attendance", "edu_messages", "edu_calendar")}
ok("R2 school_sync filled all edu tables", all(cnt.values()), cnt); print("   ", cnt)
runs = get("edu_sync_runs", order="id").json(); ok("R7 run logged with time/source/status/counts", runs and runs[-1]["status"] == "ok" and runs[-1]["counts"] and runs[-1]["source"] and runs[-1]["ran_at"], runs)
ok("R7 console lines in sync_log", len(get("sync_log", request_id=f"eq.{job['id']}").json()) >= 4)
ok("R6 owner reads own grades", len(get("edu_grades", OWN).json()) == cnt["edu_grades"])
ok("R6 intruder reads 0 grades/runs/alerts/jobs", get("edu_grades", BAD).json() == [] and get("edu_sync_runs", BAD).json() == [] and get("edu_alerts", BAD).json() == [] and get("sync_requests", BAD).json() == [])
ok("R7 owner can read sync_requests + runs", len(get("sync_requests", OWN).json()) >= 1 and len(get("edu_sync_runs", OWN).json()) >= 1)

s = agent("agent_begin_scheduled").json()
agent("agent_finish_sync", p_id=s["id"], p_ok=False, p_message="ParentVUE login failed: Invalid user ID or password")
poll(); a = alerts()
ok("R3 login failure alerted with plain reason", any(x["kind"] == "laptop_failed" and "login failed" in x["message"] for x in a), a)
n = len(alerts()); poll(); ok("R3 alerts dedupe (no repeat on next poll)", len(alerts()) == n)
s = agent("agent_begin_scheduled").json(); agent("agent_finish_sync", p_id=s["id"], p_ok=False, p_message="upload failed: (413) Payload Too Large")
poll(); ok("R3 upload failure alerted", any("upload failed" in x["message"] for x in alerts()))
s = agent("agent_begin_scheduled").json(); upload(s["upload_path"], b"not a zip"); agent("agent_finish_pull", p_id=s["id"], p_upload_path=s["upload_path"])
poll(); jj = get("sync_requests", id=f"eq.{s['id']}").json()[0]
ok("R3 box parse failure -> job failed + alert", jj["status"] == "failed" and any(x["kind"] == "box_failed" and x["job_id"] == s["id"] for x in alerts()), jj)
s = agent("agent_begin_scheduled").json(); sql(f"update sync_requests set started_at = now() - interval '25 minutes' where id={s['id']}")
poll(); ok("R3 stuck laptop job (20 min) swept + alerted", get("sync_requests", id=f"eq.{s['id']}").json()[0]["status"] == "failed" and any(x["job_id"] == s["id"] for x in alerts()))
poll("2026-10-19T06:05:00-04:00"); ok("R3 missed AM pull alerted (Mon 6:05 AM)", any(x["dedupe_key"] == "missed:2026-10-19:AM" for x in alerts()))
poll("2026-10-19T18:03:00-04:00"); ok("R3 missed PM pull alerted (Mon 6:03 PM)", any(x["dedupe_key"] == "missed:2026-10-19:PM" for x in alerts()))
poll("2026-10-18T06:05:00-04:00"); ok("R3 no missed-pull alert on Sunday", not any("2026-10-18" in x["dedupe_key"] for x in alerts()))
ob = "/tmp/e2e/state/alerts-outbox.jsonl"
ok("R3 every alert queued in outbox for email", os.path.exists(ob) and len(open(ob).read().splitlines()) == len(alerts()))
ok("R3 owner reads alerts (Crystal feed)", len(get("edu_alerts", OWN).json()) == len(alerts()))
s = agent("agent_begin_scheduled").json(); r2 = agent("agent_begin_scheduled"); ok("R8 concurrent pull refused while one runs", r2.status_code >= 400 and "already running" in r2.text, r2.text)
agent("agent_finish_sync", p_id=s["id"], p_ok=False, p_message="test cleanup")
for x in alerts(): print("   alert:", x["kind"], "|", x["message"][:150])
print("\nSUMMARY", sum(c for _, c in res), "/", len(res))
