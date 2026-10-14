#!/usr/bin/env python3
"""crystal_sync.py - macOS port of the Eli/Crystal laptop sync (fetch.ps1 + pull-to-supabase.ps1 + sync-watcher.ps1).
Python 3 standard library only. Secrets live in the macOS login Keychain, never in files:
  service crystal-parentvue      account = ParentVUE username, password = ParentVUE password
  service crystal-agent-secret   account = crystal                password = agent secret (agent_* RPCs)
Commands:
  crystal_sync.py pull           scheduled run (LaunchAgent 05:40 / 17:40). Skips unless this Mac is the primary agent.
  crystal_sync.py watch [--once] on-demand watcher: polls agent_claim_sync every 10 s (LaunchAgent, KeepAlive).
  crystal_sync.py fetch          ParentVUE only -> RAW_DIR (no upload; for testing the login). ONE login attempt.
  crystal_sync.py status         show config, primary flag, Keychain presence (never prints secrets).
Env overrides (tests): CRYSTAL_HOME, CRYSTAL_LOG_DIR, CRYSTAL_PV_URL, CRYSTAL_CONFIG, CRYSTAL_SECRET_CMD (for mocks).
Exit codes (pull): 0 handed off, 1 pull failed (shown on dashboard), 2 could not start, 3 not primary (skipped)."""
import base64, datetime as dt, fcntl, html, json, os, re, shutil, subprocess, sys, tempfile, time, uuid, zipfile
import urllib.request, urllib.error
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.environ.get("CRYSTAL_HOME") or os.path.expanduser("~/Library/Application Support/Crystal")
LOG_DIR = os.environ.get("CRYSTAL_LOG_DIR") or os.path.expanduser("~/Library/Logs/Crystal")
RAW_DIR = os.path.join(HOME, "raw")
PRIMARY_FLAG = os.path.join(HOME, "PRIMARY_AGENT")      # exists => this Mac runs the scheduled pulls
FAIL_MARKER = os.path.join(HOME, "LAST_FAILURE.txt")
PV_URL = os.environ.get("CRYSTAL_PV_URL", "https://parentvue.cobbk12.org/Service/PXPCommunication.asmx")
FETCH_TIMEOUT = 8 * 60
DOT = " \u00b7 "
KC_PV, KC_SECRET = "crystal-parentvue", "crystal-agent-secret"

# ---------- local log (~/Library/Logs/Crystal/sync.log, rotates at ~1 MB, no secrets) ----------
def llog(msg):
    try:
        os.makedirs(LOG_DIR, exist_ok=True); p = os.path.join(LOG_DIR, "sync.log")
        if os.path.exists(p) and os.path.getsize(p) > 1 << 20: os.replace(p, p + ".old")
        line = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S") + "  " + msg
        with open(p, "a", encoding="utf-8") as f: f.write(line + "\n")
        print(line, flush=True)
    except Exception: pass

def set_failure(why):
    try:
        os.makedirs(HOME, exist_ok=True)
        with open(FAIL_MARKER, "w") as f: f.write(dt.datetime.now().isoformat() + "  " + why + "\n")
    except Exception: pass
    llog("FAILURE: " + why)

def clear_failure():
    try: os.remove(FAIL_MARKER)
    except FileNotFoundError: pass

# ---------- Keychain ----------
def _security(*args):
    cmd = os.environ.get("CRYSTAL_SECRET_CMD") or "security"   # tests point this at a mock
    r = subprocess.run([cmd, *args], capture_output=True, text=True, timeout=30)
    return r.returncode, r.stdout, r.stderr

def kc_password(service):
    rc, out, _ = _security("find-generic-password", "-s", service, "-w")
    if rc != 0: raise RuntimeError(f"Keychain item '{service}' missing (run install.sh)")
    return out.rstrip("\n")

def kc_account(service):
    rc, out, _ = _security("find-generic-password", "-s", service)
    m = re.search(r'"acct"<blob>="(.*)"', out or "")
    if rc != 0 or not m: raise RuntimeError(f"Keychain item '{service}' missing (run install.sh)")
    return m.group(1)

# ---------- config / Supabase ----------
_cfg = None
def cfg():
    global _cfg
    if _cfg is None:
        p = os.environ.get("CRYSTAL_CONFIG") or os.path.join(HERE, "supabase-agent.json")
        c = json.load(open(p))
        url = c.get("SUPABASE_URL") or c.get("supabase_url"); key = c.get("SUPABASE_ANON_KEY") or c.get("publishable_key") or c.get("anon_key")
        if not url or not key: raise RuntimeError("supabase-agent.json must contain supabase_url and publishable_key")
        _cfg = {"url": url.rstrip("/"), "key": key}
    return _cfg

def agent_secret():
    s = kc_password(KC_SECRET).strip()
    if len(s) < 40: raise RuntimeError("agent secret in Keychain looks wrong (too short)")
    return s

def _http(url, data, headers, timeout):
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try: body = json.loads(body).get("message") or body
        except Exception: pass
        raise RuntimeError(f"HTTP {e.code}: {body[:300]}") from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"network: {e.reason}") from None

def anon_headers():
    k = cfg()["key"]; return {"apikey": k, "Authorization": "Bearer " + k}

def rpc(fn, params=None):
    p = dict(params or {}); p["p_secret"] = agent_secret()
    body = json.dumps(p).encode(); p = None
    try: out = _http(cfg()["url"] + "/rest/v1/rpc/" + fn, body, {**anon_headers(), "Content-Type": "application/json"}, 60)
    except RuntimeError as e: raise RuntimeError(f"{fn}: {e}") from None
    return json.loads(out) if out and out.strip() else None

def protect(line):
    l = re.sub(r"(/Users|/private|/var|/tmp|~)/[^\s'\"]*", "<path>", line)
    l = re.sub(r"\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b", "<ip>", l)
    return re.sub(r"https?://\S+", "<url>", l)

def slog(jid, line, level="info"):
    """Console line on the dashboard (agent_log). Never throws."""
    llog(f"[#{jid}] {level:<4} {line}")
    try: rpc("agent_log", {"p_id": jid, "p_level": level, "p_line": protect(line)})
    except Exception as e: llog(f"  (console line not sent: {e})")

def upload_raw(path, zpath):
    with open(zpath, "rb") as f: data = f.read()
    try: _http(cfg()["url"] + "/storage/v1/object/raw/" + path, data, {**anon_headers(), "Content-Type": "application/zip", "x-upsert": "false"}, 180)
    except RuntimeError as e: raise RuntimeError(f"upload failed: {e}") from None

def fail_sync(jid, msg):
    try: rpc("agent_finish_sync", {"p_id": jid, "p_ok": False, "p_message": msg[:300]})
    except Exception as e: llog(f"could not mark #{jid} failed: {e}")

# ---------- ParentVUE (port of fetch.ps1) ----------
class PXP:
    """Holds the credentials for exactly one fetch run. No retries: one ParentVUE login per run (Cobb lockout)."""
    def __init__(self, user, pw):
        self.u, self.p, self.log = escape(user), escape(pw), []

    def call(self, method, params, save_as=None):
        save_as = save_as or method
        e = {"method": method, "file": save_as + ".xml", "params": params, "ok": False, "error": None, "chars": 0, "at": dt.datetime.now().astimezone().isoformat()}
        result = None
        try:
            body = ('<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
                    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>'
                    '<ProcessWebServiceRequest xmlns="http://edupoint.com/webservices/"><userID>' + self.u + '</userID><password>' + self.p +
                    '</password><skipLoginLog>1</skipLoginLog><parent>1</parent><webServiceHandleName>PXPWebServices</webServiceHandleName>'
                    '<methodName>' + method + '</methodName><paramStr>' + escape(params) + '</paramStr></ProcessWebServiceRequest></soap:Body></soap:Envelope>').encode()
            raw = _http(PV_URL, body, {"Content-Type": "text/xml; charset=utf-8", "SOAPAction": "http://edupoint.com/webservices/ProcessWebServiceRequest"}, 90)
            body = None
            node = ET.fromstring(raw.decode("utf-8-sig")).find(".//{http://edupoint.com/webservices/}ProcessWebServiceRequestResult")
            if node is None: raise RuntimeError("No ProcessWebServiceRequestResult element in SOAP response")
            result = node.text or ""
            with open(os.path.join(RAW_DIR, save_as + ".xml"), "w", encoding="utf-8") as f: f.write(result)
            e["chars"] = len(result)
            m = re.search(r'<RT_ERROR[^>]*ERROR_MESSAGE="([^"]*)"', result)
            if m: e["error"] = "RT_ERROR: " + html.unescape(m.group(1))
            else: e["ok"] = True
        except Exception as ex:
            e["error"] = str(ex)
        self.log.append(e)
        return result if e["ok"] else None

def _xml(s):
    try: return ET.fromstring(s)
    except Exception: return None

def _attr_nodes(root, name):
    return [n for n in root.iter() if name in n.attrib]

# Extra pulls after the core set. Each is f(pxp, child_param_xml, child_id). Add new ones here (see README "Adding a pull").
def pull_report_cards(px, cp, cid):
    """Report cards (consumed by sync/report_cards.py): ReportCardInitialData.xml + ReportCard_<GU>.pdf."""
    x = _xml(px.call("GetReportCardInitialData", cp, "ReportCardInitialData") or "")
    if x is None: return
    for i, n in enumerate(_attr_nodes(x, "DocumentGU"), 1):
        gu = n.attrib["DocumentGU"]
        d = _xml(px.call("GetReportCardDocumentData", f"<Parms><ChildIntID>{cid}</ChildIntID><DocumentGU>{gu}</DocumentGU></Parms>", f"ReportCardDoc_{i}") or "")
        _save_pdf(d, f"ReportCard_{gu}.pdf")

def pull_student_documents(px, cp, cid):
    x = _xml(px.call("GetStudentDocumentInitialData", cp, "StudentDocuments") or "")
    if x is None: return
    for i, n in enumerate(_attr_nodes(x, "DocumentGU"), 1):
        gu = n.attrib["DocumentGU"]
        d = _xml(px.call("GetContentOfAttachedDoc", f"<Parms><DocumentGU>{gu}</DocumentGU></Parms>", f"StudentDoc_{i}") or "")
        _save_pdf(d, f"StudentDoc_{gu}.pdf")

def _save_pdf(doc, name):
    if doc is None: return
    for n in doc.iter():
        b64 = n.attrib.get("Base64Code") or (n.text if n.tag.endswith("Base64Code") else None)
        if b64:
            try:
                pdf = base64.b64decode(b64)
                if pdf.startswith(b"%PDF"):
                    with open(os.path.join(RAW_DIR, name), "wb") as f: f.write(pdf)
                    return
            except Exception: pass

EXTRA_PULLS = [pull_report_cards, pull_student_documents]

def fetch_parentvue():
    """One full ParentVUE pull into RAW_DIR + _fetch_log.json. Reads the Keychain once."""
    os.makedirs(RAW_DIR, exist_ok=True)
    for f in os.listdir(RAW_DIR):
        p = os.path.join(RAW_DIR, f)
        if os.path.isfile(p): os.remove(p)
        elif os.path.isdir(p): shutil.rmtree(p)
    px = PXP(kc_account(KC_PV), kc_password(KC_PV))
    child, note = None, ""
    cl = px.call("ChildList", "<Parms></Parms>")
    if cl:
        x = _xml(cl)
        if x is None: note = "ChildList parse error"
        else:
            cands = [(n.attrib["ChildIntID"], ET.tostring(n, "unicode")) for n in _attr_nodes(x, "ChildIntID")]
            cands += [(n.text or "", ET.tostring(par, "unicode")) for par in x.iter() for n in par if n.tag.split("}")[-1] == "ChildIntID"]
            pick = next((c for c in cands if re.search(r"(?i)\bEli", c[1])), None)
            note = f"children={len(cands)}; matchedEli={bool(pick)}"
            pick = pick or (cands[0] if cands else None)
            if pick: child = pick[0]
    if child not in (None, ""):
        cp = f"<Parms><ChildIntID>{child}</ChildIntID></Parms>"
        px.call("StudentInfo", cp)
        gb = px.call("Gradebook", cp)
        if not (gb and "<Course" in gb):
            idx = None
            g = _xml(gb or "")
            if g is not None:
                today = dt.date.today()
                for rp in g.iter():
                    if rp.tag.split("}")[-1] != "ReportPeriod": continue
                    try:
                        s = dt.datetime.strptime(rp.attrib["StartDate"], "%m/%d/%Y").date(); e = dt.datetime.strptime(rp.attrib["EndDate"], "%m/%d/%Y").date()
                        if s <= today <= e + dt.timedelta(days=1): idx = rp.attrib.get("Index")
                    except Exception: pass
            for i in ([idx] if idx is not None else [0, 1]):
                g2 = px.call("Gradebook", f"<Parms><ChildIntID>{child}</ChildIntID><ReportPeriod>{i}</ReportPeriod></Parms>", f"Gradebook_RP{i}")
                if g2 and "<Course" in g2: break
        for m in ("Attendance", "StudentClassList", "StudentSchoolInfo", "GetPXPMessages"): px.call(m, cp)
        d0 = dt.date.today(); d1 = (d0.replace(day=1) + dt.timedelta(days=32)).replace(day=1)
        px.call("StudentCalendar", f"<Parms><ChildIntID>{child}</ChildIntID><RequestDate>{d0.isoformat()}</RequestDate></Parms>")
        px.call("StudentCalendar", f"<Parms><ChildIntID>{child}</ChildIntID><RequestDate>{d1.isoformat()}</RequestDate></Parms>", "StudentCalendar_next")
        for extra in EXTRA_PULLS:
            try: extra(px, cp, child)
            except Exception as ex: llog(f"extra pull {extra.__name__} failed: {ex}")
    else:
        px.log.append({"method": "ChildList", "file": "", "params": "", "ok": False, "error": f"No ChildIntID found. {note}", "chars": 0, "at": dt.datetime.now().astimezone().isoformat()})
    px.u = px.p = None
    meta = {"fetched_at": dt.datetime.now().astimezone().isoformat(), "child_note": note, "requests": len(px.log), "log": px.log, "agent": "mac"}
    with open(os.path.join(RAW_DIR, "_fetch_log.json"), "w", encoding="utf-8") as f: json.dump(meta, f, indent=1)
    return meta

def gradebook_counts():
    files = [os.path.join(RAW_DIR, "Gradebook.xml")] + sorted(os.path.join(RAW_DIR, f) for f in os.listdir(RAW_DIR) if re.match(r"Gradebook_RP.*\.xml$", f))
    for p in files:
        if not os.path.exists(p): continue
        x = _xml(open(p, encoding="utf-8-sig").read())
        if x is None: continue
        courses = [n for n in x.iter() if n.tag == "Course"]
        if not courses: continue
        n = 0
        for c in courses:
            seen = set()
            for a in c.iter("Assignment"):
                gid = a.attrib.get("GradebookID")
                if gid and gid in seen: continue
                if gid: seen.add(gid)
                n += 1
        return len(courses), n
    return None

class Lock:
    """Cross-process lock (replaces the Windows named mutex). Freed automatically if the process dies."""
    def __init__(self, name): self.p = os.path.join(HOME, name + ".lock"); self.f = None
    def acquire(self, wait):
        os.makedirs(HOME, exist_ok=True); self.f = open(self.p, "w"); t = time.time()
        while True:
            try: fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB); return True
            except BlockingIOError:
                if time.time() - t >= wait: return False
                time.sleep(1)
    def release(self):
        if self.f: fcntl.flock(self.f, fcntl.LOCK_UN); self.f.close(); self.f = None

def check_fetch(meta):
    """Same gates as the Windows side + the 007 validation thresholds, so a blank pull is never uploaded."""
    log = meta.get("log", []); okn = sum(1 for x in log if x.get("ok"))
    cl = next((x for x in log if x.get("method") == "ChildList"), None)
    if cl and not cl.get("ok"):
        err = str(cl.get("error") or "")
        if "RT_ERROR" in err: raise RuntimeError("ParentVUE login failed: " + re.sub(r"^RT_ERROR:\s*", "", err))
        raise RuntimeError("ParentVUE unreachable: " + err)
    if not os.path.exists(os.path.join(RAW_DIR, "ChildList.xml")): raise RuntimeError("ParentVUE login failed (no ChildList)")
    gb_ok = any(x.get("ok") and x.get("method") == "Gradebook" for x in log)
    if not gb_ok or okn < 3:
        bad = next((x for x in log if not x.get("ok")), None)
        raise RuntimeError(f"ParentVUE: {(bad['method'] + ' failed') if bad else 'too few requests succeeded'} ({okn} of {meta.get('requests')} ok)")
    cnt = gradebook_counts()
    if not cnt: raise RuntimeError("ParentVUE: gradebook has 0 courses (blank pull not uploaded)")
    return okn, cnt

def pull_and_zip(jid):
    """fetch (in a child process, 8-min limit, no retry) -> checks -> zip. Returns zip path."""
    lk = Lock("fetch")
    if not lk.acquire(300): raise RuntimeError("another ParentVUE pull is still running")
    try:
        slog(jid, "> ParentVUE: pulling gradebook", "step")
        try:
            r = subprocess.run([sys.executable, os.path.abspath(__file__), "fetch", "--quiet"], timeout=FETCH_TIMEOUT, capture_output=True, text=True)
        except subprocess.TimeoutExpired: raise RuntimeError("ParentVUE pull took longer than 8 min") from None
        if r.returncode not in (0, 1) and r.stderr: llog("fetch stderr: " + r.stderr.strip()[-300:])
        lp = os.path.join(RAW_DIR, "_fetch_log.json")
        if not os.path.exists(lp) or os.path.getmtime(lp) < time.time() - FETCH_TIMEOUT - 30:
            raise RuntimeError("fetch wrote no new data" + (f": {r.stderr.strip().splitlines()[-1][:200]}" if r.stderr.strip() else ""))
        meta = json.load(open(lp, encoding="utf-8"))
        okn, (nc, na) = check_fetch(meta)
        slog(jid, f"> {nc} courses, {na} assignments", "ok")
        slog(jid, f"> ParentVUE: {okn} of {meta.get('requests')} requests ok", "info")
        slog(jid, "> zipping + uploading", "step")
        zp = os.path.join(tempfile.gettempdir(), f"eli-raw-{uuid.uuid4().hex}.zip")
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:      # flat-ish: files at root, subfolders kept
            for root, _, files in os.walk(RAW_DIR):
                for f in files:
                    full = os.path.join(root, f); z.write(full, os.path.relpath(full, RAW_DIR))
        return zp
    finally: lk.release()

def complete_job(job):
    """Pull -> upload -> agent_finish_pull. Never throws. True when handed to the server."""
    jid, zp = int(job["id"]), None
    try:
        slog(jid, ("> scheduled pull" if job.get("kind") == "scheduled" else "> pull requested") + DOT + "starting (Mac)", "step")
        zp = pull_and_zip(jid)
        kb = round(os.path.getsize(zp) / 1024)
        upload_raw(job["upload_path"], zp)
        slog(jid, f"> upload complete{DOT}{kb} KB", "ok")
        slog(jid, "> handing off to server for processing", "step")
        r = rpc("agent_finish_pull", {"p_id": jid, "p_upload_path": job["upload_path"]})
        llog(f"job #{jid} handed off: {(r or {}).get('status') if isinstance(r, dict) else r}")
        clear_failure(); return True
    except Exception as e:
        msg = str(e) or "unknown error on Mac"
        set_failure(f"job #{jid}: {msg}"); slog(jid, "> " + msg, "err"); fail_sync(jid, protect(msg)); return False
    finally:
        if zp and os.path.exists(zp): os.remove(zp)

def is_primary(): return os.path.exists(PRIMARY_FLAG)

# ---------- commands ----------
def cmd_pull():
    if not is_primary():
        llog("scheduled pull skipped: this Mac is not the primary agent (see README 'Primary agent')"); return 3
    try:
        job = None
        for i in range(3):
            try: job = rpc("agent_begin_scheduled"); break
            except RuntimeError as e:
                if "already running" in str(e) and i < 2: llog("another sync is in progress; retrying in 2 min"); time.sleep(120)
                else: raise
        if isinstance(job, list): job = job[0] if job else None
        if not job or not job.get("id"): raise RuntimeError("no sync request returned")
        llog(f"scheduled run: request #{job['id']} ({job.get('kind')})")
        return 0 if complete_job(job) else 1
    except Exception as e:
        set_failure(f"scheduled pull could not start (Supabase unreachable?): {e}"); return 2

def cmd_watch(once=False, interval=10):
    interval = max(5, interval)
    lk = Lock("watcher")
    if not lk.acquire(0): llog("watcher already running; exiting"); return 0
    llog(f"watcher started (every {interval}s, primary={is_primary()})")
    streak = 0
    try:
        while True:
            try:
                job = rpc("agent_claim_sync") if (is_primary() or os.environ.get("CRYSTAL_WATCH_ANY")) else None
                if isinstance(job, list): job = job[0] if job else None
                if streak: llog(f"connection ok again after {streak} error(s)"); streak >= 6 and clear_failure()
                streak = 0
                if job and job.get("id"):
                    llog(f"claimed request #{job['id']} ({job.get('kind')}, by {job.get('requested_by')})"); complete_job(job)
            except Exception as e:
                streak += 1
                if streak <= 3 or streak % 30 == 0: llog(f"poll error ({streak}): {e}")
                if streak == 6: set_failure(f"cannot reach Supabase: {e}")
            if once: return 0
            time.sleep(60 if streak >= 6 else interval)
    finally: lk.release()

def cmd_fetch(quiet=False):
    meta = fetch_parentvue()
    if not quiet:
        print(f"ChildIntID found: {meta['child_note']}  requests: {meta['requests']}")
        for x in meta["log"]: print(f"  {x['method']:<30} {'ok ' if x['ok'] else 'ERR'} {x['chars']:>7}  {x['error'] or ''}")
    return 0 if any(x["ok"] and x["method"] == "Gradebook" for x in meta["log"]) else 1

def cmd_status():
    print("home:", HOME); print("logs:", LOG_DIR); print("primary agent:", is_primary())
    for s in (KC_PV, KC_SECRET):
        try: kc_password(s); print(f"keychain {s}: present")
        except Exception: print(f"keychain {s}: MISSING")
    try: print("supabase:", cfg()["url"])
    except Exception as e: print("config:", e)
    if os.path.exists(FAIL_MARKER): print("last failure:", open(FAIL_MARKER).read().strip())
    return 0

def main(argv):
    if not argv: print(__doc__); return 2
    c, rest = argv[0], argv[1:]
    if c == "pull": return cmd_pull()
    if c == "watch": return cmd_watch("--once" in rest)
    if c == "fetch": return cmd_fetch("--quiet" in rest)
    if c == "status": return cmd_status()
    print(__doc__); return 2

if __name__ == "__main__": sys.exit(main(sys.argv[1:]))
