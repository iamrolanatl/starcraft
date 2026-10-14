"""One sync run: ParentVUE (one login session per account per run) -> local parse -> rows -> upload to Crystal.

Rules preserved from Rolan's laptop sync: one login per run per account, passwords only from the OS keychain,
every run logged (locally + streamed to Crystal), quarantine bad pulls instead of writing them.
Fixture mode (CRYSTAL_SYNC_FIXTURE=<raw zip>) replays an archived pull without contacting ParentVUE (tests only)."""
import datetime as dt, html, json, os, re, runpy, shutil, socket, sys, tempfile, time, zipfile
from pathlib import Path
from xml.sax.saxutils import escape
import requests
from . import config, runlog, __version__
from .api import Api, ApiError

PV_URL = os.environ.get("CRYSTAL_PV_URL", "https://parentvue.cobbk12.org/Service/PXPCommunication.asmx")
LOCK = None

def _soap(u, p, method, params):
    body = ('<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" '
            'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ProcessWebServiceRequest xmlns="http://edupoint.com/webservices/">'
            f'<userID>{escape(u)}</userID><password>{escape(p)}</password><skipLoginLog>1</skipLoginLog><parent>1</parent>'
            f'<webServiceHandleName>PXPWebServices</webServiceHandleName><methodName>{method}</methodName><paramStr>{escape(params)}</paramStr>'
            '</ProcessWebServiceRequest></soap:Body></soap:Envelope>')
    r = requests.post(PV_URL, data=body.encode(), timeout=90, headers={"Content-Type": "text/xml; charset=utf-8",
                      "SOAPAction": "http://edupoint.com/webservices/ProcessWebServiceRequest", "User-Agent": f"CrystalSync/{__version__}"})
    m = re.search(r"<ProcessWebServiceRequestResult>(.*)</ProcessWebServiceRequestResult>", r.text, re.S)
    if not m: raise RuntimeError(f"HTTP {r.status_code}: no result element")
    return html.unescape(m.group(1))

def fetch_parentvue(raw: Path, account: dict, child_name: str, log):
    """Writes raw/*.xml + _fetch_log.json like fetch.ps1. Returns fetch_log dict."""
    fx = os.environ.get("CRYSTAL_SYNC_FIXTURE")
    entries = []
    if fx:
        log("fetch", f"FIXTURE MODE: replaying archived pull {Path(fx).name} (ParentVUE not contacted)", "warn")
        with zipfile.ZipFile(fx) as z:
            for n in z.namelist():
                if n.endswith(".xml") and "/" not in n:
                    (raw / n).write_bytes(z.read(n)); txt = z.read(n).decode("utf-8-sig", "replace")
                    ok = "<RT_ERROR" not in txt
                    entries.append({"method": n[:-4].split("_")[0], "file": n, "ok": ok, "chars": len(txt), "error": None if ok else "RT_ERROR"})
                    log("fetch", f"{n[:-4]:<22} {'ok' if ok else 'ERROR'} {len(txt):>7} chars", "info" if ok else "warn")
        return {"fetched_at": dt.datetime.fromtimestamp(Path(fx).stat().st_mtime).astimezone().isoformat(), "requests": len(entries), "log": entries, "fixture": True}
    u = account["username"]; p = config.secret_get(f"parentvue:{u}")
    if not p: raise RuntimeError("ParentVUE password not found in the keychain. Open Crystal Sync setup and re-enter it.")
    runlog.add_secret(p); runlog.add_secret(u)
    def call(method, params, save):
        t = time.time(); e = {"method": method, "file": f"{save}.xml", "ok": False, "chars": 0, "error": None}
        try:
            res = _soap(u, p, method, params); (raw / f"{save}.xml").write_text(res, encoding="utf-8"); e["chars"] = len(res)
            m = re.search(r'<RT_ERROR[^>]*ERROR_MESSAGE="([^"]*)"', res)
            if m: e["error"] = "RT_ERROR: " + html.unescape(m.group(1))
            else: e["ok"] = True
        except Exception as x: e["error"] = str(x)[:200]; res = None
        entries.append(e); log("fetch", f"{save:<22} {'ok' if e['ok'] else 'ERROR ' + (e['error'] or '')} {e['chars']:>7} chars {time.time()-t:.1f}s", "info" if e["ok"] else "warn")
        return res if e["ok"] else None
    log("login", f"ParentVUE sign-in as {u[:2]}*** (one session for this run)")
    cl = call("ChildList", "<Parms></Parms>", "ChildList")
    cid = None
    if cl:
        cands = re.findall(r'<Child\b[^>]*ChildIntID="([^"]+)"[^>]*>(.*?)</Child>', cl, re.S) or [(m, "") for m in re.findall(r'ChildIntID="([^"]+)"', cl)]
        pick = next((c for c in cands if re.search(rf"\b{re.escape(child_name)}", c[1] + cl[cl.find(c[0]) - 400: cl.find(c[0]) + 400], re.I)), None) if child_name else None
        cid = (pick or (cands[0] if cands else (None,)))[0]
        log("login", f"ChildList ok: {len(cands)} child(ren); matched {child_name!r}: {bool(pick)}", "ok" if cid else "error")
    if cid:
        cp = f"<Parms><ChildIntID>{cid}</ChildIntID></Parms>"
        call("StudentInfo", cp, "StudentInfo")
        gb = call("Gradebook", cp, "Gradebook")
        if not (gb and "<Course" in gb):
            for i in (0, 1):
                g2 = call("Gradebook", f"<Parms><ChildIntID>{cid}</ChildIntID><ReportPeriod>{i}</ReportPeriod></Parms>", f"Gradebook_RP{i}")
                if g2 and "<Course" in g2: break
        for m in ("Attendance", "StudentClassList", "StudentSchoolInfo", "GetPXPMessages"): call(m, cp, m)
        d0 = dt.date.today(); d1 = (d0.replace(day=1) + dt.timedelta(days=32)).replace(day=1)
        call("StudentCalendar", f"<Parms><ChildIntID>{cid}</ChildIntID><RequestDate>{d0}</RequestDate></Parms>", "StudentCalendar")
        call("StudentCalendar", f"<Parms><ChildIntID>{cid}</ChildIntID><RequestDate>{d1}</RequestDate></Parms>", "StudentCalendar_next")
    p = None
    return {"fetched_at": dt.datetime.now().astimezone().isoformat(), "requests": len(entries), "log": entries}

def build_payload(work: Path, log):
    os.environ["CRYSTAL_SYNC_WORK"] = str(work)
    import contextlib, io
    out = io.StringIO()
    with contextlib.redirect_stdout(out): runpy.run_module("crystal_sync.pv_parse", run_name="__pv__")
    for ln in out.getvalue().splitlines(): log("parse", ln)
    data = json.loads((work / "data.json").read_text())
    from . import pv_rows as R
    g, asg, att, msgs, cal = R.build(data, {}, "UID", "SID")
    vlog = []; g, asg, att, msgs, cal, bad = R.validate(g, asg, att, msgs, cal, vlog)
    for v in vlog[:20]: log("validate", v, "warn")
    fetch_log = json.loads((work / "raw/_fetch_log.json").read_text())
    live = [x for x in g if not x["is_final"]]
    reasons = R.gates(data, None if fetch_log.get("fixture") else fetch_log, {}, live, len([a for a in asg if a["source"] == "ParentVUE"]))
    strip = lambda rows: [{k: v for k, v in r.items() if k not in ("user_id", "student_id")} for r in rows]
    s = data.get("student") or {}
    payload = {"fetched_at": data.get("fetched_at"), "student": {"name": s.get("first_name") or s.get("name"), "grade": s.get("grade"), "school": s.get("school"),
               "district": s.get("district"), "attendance_totals": (data.get("attendance") or {}).get("totals"), "reporting_period": data.get("reporting_period")},
               "grades": strip(g), "assignments": strip(asg), "attendance": strip(att), "messages": strip(msgs), "calendar": strip(cal)}
    counts = {k: len(payload[k]) for k in ("grades", "assignments", "attendance", "messages", "calendar")}; counts["fields_rejected"] = bad
    log("parse", "rows built: " + ", ".join(f"{v} {k}" for k, v in counts.items()), "ok")
    return payload, counts, reasons

def _lock():
    global LOCK
    p = config.base_dir() / "sync.lock"
    try:
        if p.exists() and time.time() - p.stat().st_mtime > 1800: p.unlink()
        fd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY); os.write(fd, str(os.getpid()).encode()); os.close(fd); LOCK = p; return True
    except FileExistsError: return False

def _unlock():
    global LOCK
    if LOCK:
        try: LOCK.unlink()
        except Exception: pass
        LOCK = None

def run(child_id=None, run_id=None, trigger="schedule", echo=True):
    """Sync one child (child_id) or every paired child. Returns overall status string."""
    c = config.load(); key = config.secret_get("device_key")
    if not c.get("device_id") or not key: print("Crystal Sync is not paired yet. Run setup."); return "unpaired"
    api = Api(c.get("server", config.DEFAULT_SERVER), key)
    if not _lock(): print("another sync is already running"); return "busy"
    status_all = "ok"
    try:
        kids = [k for k in c.get("children", []) if not child_id or k["id"] == child_id]
        for kid in kids:
            try: rid = api.start(kid["id"], run_id if child_id else None, trigger)
            except ApiError as e: print(f"could not start run: {e}"); status_all = "failed"; continue
            log = runlog.RunLog(api, rid, echo); t0 = time.time(); status, counts, err = "failed", {}, None
            work = Path(tempfile.mkdtemp(prefix="crystal-sync-")); raw = work / "raw"; raw.mkdir()
            try:
                log("start", f"Crystal Sync {__version__} on {socket.gethostname()} ({sys.platform}) · {kid['name']} · trigger={trigger}")
                acct = (c.get("accounts") or {}).get("parentvue") or {}
                if not acct.get("username") and not os.environ.get("CRYSTAL_SYNC_FIXTURE"): raise RuntimeError("no ParentVUE account configured")
                fl = fetch_parentvue(raw, acct, kid.get("name", ""), log)
                (raw / "_fetch_log.json").write_text(json.dumps(fl))
                okn = sum(1 for x in fl["log"] if x.get("ok")); log("fetch", f"{okn}/{fl['requests']} ParentVUE requests ok", "ok" if okn else "error")
                payload, counts, reasons = build_payload(work, log)
                if reasons:
                    status, err = "quarantined", "; ".join(reasons); log("validate", "QUARANTINED, nothing uploaded: " + err, "error")
                else:
                    log("upload", f"uploading {sum(len(payload[k]) for k in ('grades','assignments','attendance','messages','calendar'))} rows ({len(json.dumps(payload))//1024} KB)")
                    log.flush(); res = api.upload(rid, kid["id"], payload); log("upload", f"server accepted: {json.dumps(res.get('counts'))}", "ok")
                    counts["stored"] = res.get("counts"); status = "ok"
            except Exception as e:
                err = runlog.mask(f"{type(e).__name__}: {e}"); log("error", err, "error")
            finally:
                shutil.rmtree(work, ignore_errors=True)
                counts["seconds"] = round(time.time() - t0, 1); log("done", f"{status.upper()} in {counts['seconds']}s", "ok" if status == "ok" else "error"); log.flush()
                try: api.finish(rid, status, counts, err)
                except Exception as e: print(f"finish failed: {runlog.mask(e)}")
                log.close()
                c2 = config.load(); c2.setdefault("last", {})[kid["id"]] = {"status": status, "at": dt.datetime.now().astimezone().isoformat(), "error": err}; config.save(c2)
            if status != "ok": status_all = status
    finally: _unlock()
    return status_all

def daemon(interval=30):
    """Long-running: poll for SYNC NOW commands, and run the 5:40 AM/PM schedule if the OS timer missed it (sleep/off)."""
    c = config.load(); api = Api(c.get("server", config.DEFAULT_SERVER), config.secret_get("device_key")); backoff = interval
    print(f"Crystal Sync daemon {__version__} polling every {interval}s", flush=True)
    while True:
        try:
            j = api.poll(); backoff = interval
            for cmd in j.get("commands", []): run(cmd["child_id"], cmd["run_id"], "manual")
            if j.get("children"):
                c = config.load(); c["children"] = j["children"]; config.save(c)
            catch_up()
        except ApiError as e:
            print(f"poll: {e}", flush=True)
            if e.status == 401: print("device key revoked or invalid; re-pair in Crystal > Downloads", flush=True); time.sleep(600)
            backoff = min(backoff * 2, 600)
        except Exception as e: print(f"poll error: {runlog.mask(e)}", flush=True); backoff = min(backoff * 2, 600)
        time.sleep(backoff)

def slot_due(now=None):
    """Most recent 05:40 / 17:40 slot (local time)."""
    now = now or dt.datetime.now()
    slots = [now.replace(hour=h, minute=40, second=0, microsecond=0) for h in (5, 17)]
    past = [s for s in slots if s <= now]
    return max(past) if past else slots[1] - dt.timedelta(days=1)

def catch_up():
    c = config.load(); s = slot_due().isoformat()
    if c.get("last_slot") != s and dt.datetime.now() - slot_due() < dt.timedelta(hours=6):
        c["last_slot"] = s; config.save(c); run(trigger="schedule")
