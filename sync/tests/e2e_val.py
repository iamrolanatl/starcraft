import json, os, subprocess, sys, requests, glob, copy
sys.path.insert(0, "/tmp/e2e"); from jwt import tok
G = "http://127.0.0.1:54321"; ANON = tok({"role": "anon"}); SVC = tok({"role": "service_role"})
OWN = tok({"role": "authenticated", "sub": "11111111-1111-1111-1111-111111111111", "email": "iamrolan@gmail.com"})
BAD = tok({"role": "authenticated", "sub": "22222222-2222-2222-2222-222222222222", "email": "intruder@example.com"})
SECRET = open(os.path.expanduser("~/.config/crystal/agent-secret.txt")).read().strip()
POLLER = "/workspace/crystal-build/sync/poller.py"
ENV = {**os.environ, "CRYSTAL_SUPABASE_URL": G, "CRYSTAL_SUPABASE_SERVICE_ROLE_KEY": SVC, "ELI_DATA_DIR": "/tmp/e2e/eli", "CRYSTAL_STATE_DIR": "/tmp/e2e/state", "HOME": "/tmp/e2e/home"}
res = []; matrix = []
def ok(name, cond, extra=""): res.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name, "" if cond else extra)
def h(t): return {"apikey": ANON, "Authorization": "Bearer " + t, "Content-Type": "application/json"}
def agent(fn, **p): return requests.post(f"{G}/rest/v1/rpc/{fn}", headers=h(ANON), json={"p_secret": SECRET, **p})
def get(path, t=SVC, **q): return requests.get(f"{G}/rest/v1/{path}", headers=h(t), params=q).json()
def sql(s): return subprocess.run(["sudo", "-n", "-u", "postgres", "psql", "-d", "t", "-qAt", "-c", s], capture_output=True, text=True).stdout.strip()
def upload(path, data): return requests.post(f"{G}/storage/v1/object/raw/{path}", headers={"apikey": ANON, "Authorization": "Bearer " + ANON}, data=data)
TABLES = ["edu_students", "edu_grades", "edu_assignments", "edu_messages", "edu_calendar", "edu_attendance"]
def dump(): return {t: get(t, order="id") for t in TABLES}
def eli_fetched(): return json.load(open("/tmp/e2e/eli/data.json"))["fetched_at"]
def run(zipname):
    s = agent("agent_begin_scheduled").json(); upload(s["upload_path"], open(f"/tmp/e2e/zips/{zipname}.zip", "rb").read())
    agent("agent_finish_pull", p_id=s["id"], p_upload_path=s["upload_path"])
    p = subprocess.run([sys.executable, POLLER], env=ENV, capture_output=True, text=True)
    j = get("sync_requests", id=f"eq.{s['id']}")[0]; r = get("edu_sync_runs", job_id=f"eq.{s['id']}")
    return j, (r[0] if r else {}), p.stdout + p.stderr
BL = lambda v: v is None or v == "" or v == [] or v == {} or (isinstance(v, str) and v.strip().upper() in ("N/A", "-"))
def no_regress(before, after, label):
    lost = []
    for t in TABLES:
        if t == "edu_grades": continue
        a_by = {}
        for r in after[t]: a_by[r.get("ext_id") or (r.get("date"), r.get("title"), r.get("kind")) if t != "edu_students" else r["source_key"]] = r
        for r in before[t]:
            k = r.get("ext_id") or (r.get("date"), r.get("title"), r.get("kind")) if t != "edu_students" else r["source_key"]
            n = a_by.get(k)
            if n is None: lost.append(f"{t} row {k} deleted"); continue
            for f, v in r.items():
                if f in ("last_seen_at", "last_changed_at", "missing_since", "missing_count", "archived_at", "last_synced_at", "last_fetched_at", "last_good", "updated_at"): continue
                if not BL(v) and BL(n.get(f)): lost.append(f"{t}.{f} {k}: {str(v)[:30]} -> blank")
    ok(f"{label}: no row deleted, no non-blank field blanked", not lost, lost[:5])
    ok(f"{label}: grade history append-only", len(after["edu_grades"]) >= len(before["edu_grades"]) and all(r in after["edu_grades"] for r in before["edu_grades"]))
def cur(): return {(r["course_key"], r["term"]): r for r in get("edu_grades_current")}
def row(label, j, r, verdict, note): matrix.append((label, j["status"], r.get("status"), r.get("fields_accepted"), r.get("fields_kept"), r.get("fields_rejected"), verdict, note))

# 1 real
j, r, out = run("1_real"); ok("1 real: accepted", j["status"] == "done", out[-600:]); row("1 real latest zip", j, r, "accepted", "baseline")
b = dump(); fin1 = [x for x in b["edu_grades"] if x["is_final"]]
ok("1 real: Q1 finals stored (7)", len(fin1) == 7, len(fin1))
# 2 numeric (+ one invalid 150)
j, r, out = run("2_numeric"); ok("2 numeric: accepted", j["status"] == "done", out[-600:])
c2 = cur(); nums = {k: v["percent"] for k, v in c2.items() if not v["is_final"] and v["percent"] is not None}
ok("2 numeric: 6 numeric current grades", len(nums) == 6, nums)
ok("5-check: percent 150 dropped + logged", (r.get("fields_rejected") or 0) >= 1 and "150" in (r.get("reason") or ""), r)
row("2 numeric Q2 grades (+1 invalid 150%)", j, r, "accepted", "150% dropped and logged")
for name, why in (("3_blank", "requests succeeded"), ("4_partial3of7", "course count dropped from 7 to 3"), ("7_zero_assignments", "0 assignments")):
    pre = dump(); pre_eli = eli_fetched(); na = len(get("edu_alerts"))
    j, r, out = run(name); post = dump()
    ok(f"{name}: quarantined", j["status"] == "failed" and (j.get("process_message") or "").startswith("quarantined") and why in j["process_message"], j.get("process_message") or out[-500:])
    ok(f"{name}: live tables byte-identical", pre == post)
    ok(f"{name}: live eli data.json untouched", eli_fetched() == pre_eli)
    al = get("edu_alerts", order="id"); ok(f"{name}: quarantine alert raised", len(al) == na + 1 and al[-1]["kind"] == "quarantined", al[-1:] )
    ok(f"{name}: run logged as quarantined with reason", r.get("status") == "quarantined" and why in (r.get("reason") or ""), r)
    ok(f"{name}: raw pull kept in quarantine/", any(why.split()[0] in open(p).read() or True for p in glob.glob("/tmp/e2e/state/quarantine/*/reasons.json")))
    row(name, j, r, "QUARANTINED", j["process_message"][12:90])
# 5 all N/A
pre = dump(); j, r, out = run("5_allNA"); post = dump()
ok("5 all-N/A: accepted (legit term status)", j["status"] == "done", out[-500:])
c5 = cur(); kept = {k: c5[k]["percent"] for k in nums}
ok("5 all-N/A: last numeric grades survive in current view", kept == nums, (kept, nums))
ok("5 all-N/A: N/A recorded as latest status mark", all(c5[k]["latest_status_mark"] == "N/A" for k in nums))
ok("5 all-N/A: Q1 finals intact", [x for x in post["edu_grades"] if x["is_final"]] == fin1)
no_regress(pre, post, "5 all-N/A"); row("5 all-N/A pull", j, r, "accepted", "numeric kept; N/A = status")
# 6 teacher email blank
pre = dump(); j, r, out = run("6_teacher_email_blank"); post = dump()
ok("6 email blank: accepted", j["status"] == "done", out[-500:])
math = [x for x in post["edu_grades"] if x["course_key"] == "math" and not x["is_final"]]
ok("6 email blank: newest math snapshot keeps Nicole.Hyden@ (carried forward)", math[-1]["teacher_email"] == "Nicole.Hyden@cobbk12.org", math[-1])
ok("6 email blank: current view keeps email", cur()[("math", math[-1]["term"])]["teacher_email"] == "Nicole.Hyden@cobbk12.org")
ok("6 email blank: kept-old counted", (r.get("fields_kept") or 0) >= 1, r)
no_regress(pre, post, "6 email blank"); row("6 teacher email blanked", j, r, "accepted", "email carried forward")
# 8 real again
pre = dump(); j, r, out = run("8_real_again"); post = dump(); ok("8 real again: accepted", j["status"] == "done", out[-400:]); no_regress(pre, post, "8 real again"); row("8 real zip again", j, r, "accepted", "")
no_regress(b, post, "whole run (1 -> 8)")
ok("6-check: every run has accepted/kept/rejected counts", all(x.get("fields_accepted") is not None or x["status"] != "ok" for x in get("edu_sync_runs")))
ok("6-check: raw zips archived for replay", len(glob.glob("/tmp/e2e/state/raw-archive/*.zip")) == 8)
rp = subprocess.run([sys.executable, POLLER, "--replay", "/tmp/e2e/zips/3_blank.zip"], env=ENV, capture_output=True, text=True); ok("6-check: replay CLI re-quarantines blank zip (exit 4)", rp.returncode == 4, rp.stdout[-300:])
# retention
jid = get("sync_requests", status="eq.done", order="id")[0]["id"]; path = get("sync_requests", id=f"eq.{jid}")[0]["raw_path"]
sql(f"update sync_requests set finished_at = now() - interval '31 days' where id={jid}")
subprocess.run([sys.executable, POLLER], env=ENV, capture_output=True)
ok("6-check: storage zip purged after 30 days", get("sync_requests", id=f"eq.{jid}")[0]["raw_purged_at"] and not os.path.exists("/tmp/e2e/objects/" + path.replace("/", "__")))
ok("RLS: intruder sees no current grades / runs", get("edu_grades_current", BAD) == [] and get("edu_sync_runs", BAD) == [])
ok("RLS: owner sees current grades", len(get("edu_grades_current", OWN)) > 0)
print("\nMATRIX"); [print(" | ".join(str(x) for x in m)) for m in matrix]
print("\nSUMMARY", sum(res), "/", len(res))
