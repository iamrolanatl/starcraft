#!/usr/bin/env python3
"""Mocked end-to-end run on Linux: fake ParentVUE SOAP + fake Supabase on localhost, fake `security`.
Scenarios: good pull (handed off), blank gradebook (rejected, not uploaded), login failure, not-primary skip.
Usage: python3 mock_run.py [fixtures_dir_with_real_raw_xml]"""
import http.server, json, os, re, subprocess, sys, tempfile, threading, zipfile, io, base64
HERE = os.path.dirname(os.path.abspath(__file__)); FIX = sys.argv[1] if len(sys.argv) > 1 else None
GB = '<Gradebook><ReportingPeriods/><Courses><Course Title="Math"><Marks><Mark><Assignments><Assignment GradebookID="1"/><Assignment GradebookID="2"/></Assignments></Mark></Marks></Course><Course Title="Sci"/></Courses></Gradebook>'
PDF = base64.b64encode(b"%PDF-1.4 mock").decode()
STATE = {"mode": "good", "calls": [], "uploads": [], "rpc": []}
def pv(method):
    if STATE["mode"] == "badlogin": return '<RT_ERROR ERROR_MESSAGE="Invalid user id or password"/>'
    fx = FIX and os.path.join(FIX, {"GetPXPMessages": "GetPXPMessages"}.get(method, method) + ".xml")
    if method == "ChildList": return '<ChildList><Child ChildIntID="0"><ChildName>Eli Chowdhury</ChildName></Child></ChildList>'
    if method == "Gradebook": return "<Gradebook><Courses/></Gradebook>" if STATE["mode"] == "blank" else (open(fx).read() if fx and os.path.exists(fx) else GB)
    if method == "GetReportCardInitialData": return '<RCData><RCReportingPeriod ReportingPeriodName="Q1" DocumentGU="ABC-1"/></RCData>'
    if method == "GetReportCardDocumentData": return f'<DocumentData><Base64Code>{PDF}</Base64Code></DocumentData>'
    return f"<{method} ok='1'/>"
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        b = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path.startswith("/pv"):
            s = b.decode(); m = re.search(r"<methodName>(.*?)</methodName>", s).group(1)
            assert "mock-pass&lt;&amp;&gt;" in s, "password not XML-escaped"
            STATE["calls"].append(m)
            from xml.sax.saxutils import escape
            out = f'<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ProcessWebServiceRequestResponse xmlns="http://edupoint.com/webservices/"><ProcessWebServiceRequestResult>{escape(pv(m))}</ProcessWebServiceRequestResult></ProcessWebServiceRequestResponse></soap:Body></soap:Envelope>'
            return self._send(200, out.encode())
        if self.path.startswith("/rest/v1/rpc/"):
            fn = self.path.rsplit("/", 1)[1]; p = json.loads(b); assert p.pop("p_secret").startswith("mock-secret")
            STATE["rpc"].append((fn, p))
            r = {"agent_begin_scheduled": {"id": 7, "kind": "scheduled", "upload_path": "laptop/7.zip"},
                 "agent_claim_sync": {"id": 8, "kind": "manual", "upload_path": "laptop/8.zip", "requested_by": "rolan"},
                 "agent_finish_pull": {"status": "processing"}}.get(fn)
            return self._send(200, json.dumps(r).encode())
        if self.path.startswith("/storage/v1/object/raw/"):
            STATE["uploads"].append(zipfile.ZipFile(io.BytesIO(b)).namelist()); return self._send(200, b"{}")
        self._send(404, b"{}")
    def _send(self, c, b):
        self.send_response(c); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]; tmp = tempfile.mkdtemp()
cfgp = os.path.join(tmp, "cfg.json"); json.dump({"supabase_url": f"http://127.0.0.1:{port}", "publishable_key": "anon"}, open(cfgp, "w"))
env = {**os.environ, "CRYSTAL_HOME": os.path.join(tmp, "home"), "CRYSTAL_LOG_DIR": os.path.join(tmp, "logs"), "CRYSTAL_CONFIG": cfgp,
       "CRYSTAL_PV_URL": f"http://127.0.0.1:{port}/pv", "CRYSTAL_SECRET_CMD": os.path.join(HERE, "mock_security.sh")}
SCRIPT = os.path.join(HERE, "..", "crystal_sync.py")
def run(*a): return subprocess.run([sys.executable, SCRIPT, *a], env=env, capture_output=True, text=True, timeout=120)
def reset(mode): STATE.update(mode=mode, calls=[], uploads=[], rpc=[])
fails = 0
def check(name, cond, extra=""):
    global fails; print(("PASS " if cond else "FAIL ") + name, extra); fails += (not cond)

reset("good"); r = run("pull"); check("not primary -> skip (exit 3), no login", r.returncode == 3 and not STATE["calls"])
os.makedirs(env["CRYSTAL_HOME"], exist_ok=True); open(os.path.join(env["CRYSTAL_HOME"], "PRIMARY_AGENT"), "w").close()
reset("good"); r = run("pull")
check("good scheduled pull -> exit 0", r.returncode == 0, r.stdout[-400:] + r.stderr[-400:])
check("exactly one ChildList (one login) per run", STATE["calls"].count("ChildList") == 1, str(STATE["calls"]))
check("uploaded zip has gradebook + fetch log + report card pdf", STATE["uploads"] and {"Gradebook.xml", "_fetch_log.json", "ReportCard_ABC-1.pdf"} <= set(STATE["uploads"][0]), str(STATE["uploads"]))
check("agent_finish_pull called", any(f == "agent_finish_pull" for f, _ in STATE["rpc"]))
check("agent_log lines sent", sum(f == "agent_log" for f, _ in STATE["rpc"]) >= 4)
reset("blank"); r = run("pull")
check("blank gradebook -> exit 1, NOT uploaded, failed via agent_finish_sync", r.returncode == 1 and not STATE["uploads"] and any(f == "agent_finish_sync" for f, _ in STATE["rpc"]))
check("blank -> err line via agent_log", any(f == "agent_log" and p["p_level"] == "err" for f, p in STATE["rpc"]))
reset("badlogin"); r = run("pull")
check("bad login -> exactly one login attempt, no upload", r.returncode == 1 and STATE["calls"] == ["ChildList"] and not STATE["uploads"], str(STATE["calls"]))
msg = [p for f, p in STATE["rpc"] if f == "agent_finish_sync"]
check("bad login message", msg and "login failed" in msg[0]["p_message"], str(msg))
reset("good"); r = run("watch", "--once")
check("watcher --once claims + hands off", r.returncode == 0 and STATE["uploads"] and any(f == "agent_finish_pull" for f, _ in STATE["rpc"]))
logs = open(os.path.join(env["CRYSTAL_LOG_DIR"], "sync.log")).read()
check("no secrets in local log", "mock-pass" not in logs and "mock-secret" not in logs)
check("no secrets in raw files", not any("mock-pass" in open(os.path.join(dp, f), errors="ignore").read() for dp, _, fs in os.walk(env["CRYSTAL_HOME"]) for f in fs))
srv.shutdown(); print("FAILURES:", fails); sys.exit(1 if fails else 0)
