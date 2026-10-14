"""First-run setup + status window: a tiny local web page on 127.0.0.1 (works on macOS/Windows/Linux without extra GUI toolkits).
A random per-launch token in the URL blocks other web pages from posting to it. Passwords go straight into the OS keychain."""
import html, json, platform, secrets, socket, threading, time, webbrowser, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from . import config, engine, schedule, __version__
from .api import Api, ApiError

TOKEN = secrets.token_urlsafe(16)
CSS = """body{margin:0;font:15px system-ui,sans-serif;background:radial-gradient(circle at 30% 0,#0e2a3a,#04121a 60%);color:#cfe8ff;min-height:100vh}
main{max-width:720px;margin:0 auto;padding:28px}h1{font:700 20px ui-monospace,monospace;letter-spacing:.2em;color:#3ef2e0;text-shadow:0 0 12px #3ef2e088}
.card{background:#0b1d2acc;border:1px solid #3ef2e040;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 0 30px #3ef2e014}
label{display:block;margin:10px 0 4px;color:#9fb7cc;font-size:13px}input{width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid #3ef2e055;background:#04121a;color:#fff;font-size:15px}
.code{font:700 22px ui-monospace,monospace;letter-spacing:.25em;text-transform:uppercase}h2{font:700 13px ui-monospace,monospace;letter-spacing:.15em;color:#ffd166;margin:0 0 6px}
button{margin-top:16px;padding:12px 22px;border:0;border-radius:10px;background:#3ef2e0;color:#04121a;font-weight:800;letter-spacing:.1em;cursor:pointer}
.muted{color:#7a8aa6;font-size:13px}.err{color:#ff3b5c}.ok{color:#7dffc8}pre{background:#000a;padding:10px;border-radius:10px;max-height:320px;overflow:auto;font-size:12px}
details summary{cursor:pointer;color:#7dd3fc}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}"""

def page(body): return f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>Crystal Sync</title><style>{CSS}</style><main><h1>CRYSTAL SYNC</h1>{body}</main>"

def setup_form(err=""):
    c = config.load(); pv = ((c.get("accounts") or {}).get("parentvue") or {}).get("username", "")
    return page(f"""{f'<p class=err>{html.escape(err)}</p>' if err else ''}
<form method=post action="/pair?t={TOKEN}">
<div class=card><h2>1 · PAIRING CODE</h2><p class=muted>In Crystal, open <b>Downloads</b> and press CREATE PAIRING CODE (valid 15 minutes, single use).</p>
<input name=code class=code placeholder="ABCD-EFGH" required autocomplete=off maxlength=12></div>
<div class=card><h2>2 · PARENT LOGIN (PARENTVUE / CTLS PARENT)</h2><p class=muted>Stored only in this computer's keychain. Never sent to Crystal.</p>
<label>ParentVUE username</label><input name=pv_user value="{html.escape(pv)}" required autocomplete=off>
<label>ParentVUE password</label><input name=pv_pass type=password required autocomplete=off></div>
<div class=card><details><summary>3 · Optional: student logins (StudentVUE, CTLS Learn, Office 365)</summary><p class=muted>Saved in the keychain for upcoming student-side pulls. Leave blank to skip.</p>
<label>StudentVUE username</label><input name=sv_user autocomplete=off><label>StudentVUE password</label><input name=sv_pass type=password autocomplete=off>
<label>CTLS Learn / Office 365 email</label><input name=o365_user autocomplete=off><label>Office 365 password</label><input name=o365_pass type=password autocomplete=off></details></div>
<label>Name for this computer</label><input name=name value="{html.escape(socket.gethostname()[:60])}">
<button>PAIR &amp; TEST</button><p class=muted>Crystal Sync {__version__} · server {html.escape(c.get('server', config.DEFAULT_SERVER))}</p></form>""")

def status_page(msg=""):
    c = config.load(); rows = ""
    for k in c.get("children", []):
        l = (c.get("last") or {}).get(k["id"]) or {}; st = l.get("status") or "never"
        hue = "#7dffc8" if st == "ok" else "#ffd166" if st in ("running", "never") else "#ff3b5c"
        rows += f"<p><span class=dot style='background:{hue};box-shadow:0 0 8px {hue}'></span><b>{html.escape(k['name'])}</b> · {html.escape(st.upper())} {html.escape(l.get('at','')[:16].replace('T',' '))} <span class=err>{html.escape(l.get('error') or '')}</span></p>"
    logs = sorted(config.log_dir().glob("sync-*.log"))
    tail = html.escape("".join(logs[-1].read_text(encoding="utf-8", errors="replace").splitlines(True)[-60:])) if logs else "no runs yet"
    return page(f"""{f'<p class=ok>{html.escape(msg)}</p>' if msg else ''}<div class=card><h2>PAIRED · {html.escape(c.get('device_name',''))}</h2>{rows or '<p class=muted>No children.</p>'}
<p class=muted>Syncs at 5:40 AM and 5:40 PM, and when you press SYNC NOW in Crystal. Keeps running after restarts.</p>
<form method=post action="/run?t={TOKEN}"><button>SYNC NOW</button></form></div>
<div class=card><h2>LAST LOG</h2><pre id=log>{tail}</pre></div><script>setTimeout(()=>location.reload(),5000)</script>
<p class=muted><a style=color:#7dd3fc href="/setup?t={TOKEN}">Re-pair or change logins</a></p>""")

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _ok(self, q): return q.get("t", [""])[0] == TOKEN
    def send(self, body, code=200):
        b = body.encode(); self.send_response(code); self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if not self._ok(q): return self.send(page("<p class=err>Open Crystal Sync from its app icon.</p>"), 403)
        if u.path == "/setup" or not config.load().get("device_id"): return self.send(setup_form())
        self.send(status_page())
    def do_POST(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if not self._ok(q) or self.headers.get("origin", f"http://{self.headers.get('host')}") != f"http://{self.headers.get('host')}": return self.send("forbidden", 403)
        f = {k: v[0].strip() for k, v in parse_qs(self.rfile.read(int(self.headers.get("content-length", 0) or 0)).decode()).items()}
        if u.path == "/run":
            threading.Thread(target=engine.run, kwargs={"trigger": "schedule", "echo": False}, daemon=True).start(); return self.send(status_page("Sync started. Watch it live in Crystal or below."))
        if u.path != "/pair": return self.send("not found", 404)
        try: self.send(pair_and_setup(f))
        except ApiError as e: self.send(setup_form(str(e).split(": ", 1)[-1]))
        except Exception as e: self.send(setup_form(f"Setup failed: {type(e).__name__}"))

def pair_and_setup(f):
    c = config.load(); server = c.get("server", config.DEFAULT_SERVER)
    j = Api(server).pair(f.get("code", ""), f.get("name") or socket.gethostname(), f"{platform.system()} {platform.machine()}")
    config.secret_set("device_key", j["device_key"])
    config.secret_set(f"parentvue:{f['pv_user']}", f["pv_pass"])
    acc = {"parentvue": {"username": f["pv_user"]}}
    if f.get("sv_user") and f.get("sv_pass"): config.secret_set(f"studentvue:{f['sv_user']}", f["sv_pass"]); acc["studentvue"] = {"username": f["sv_user"]}
    if f.get("o365_user") and f.get("o365_pass"): config.secret_set(f"o365:{f['o365_user']}", f["o365_pass"]); acc["o365"] = {"username": f["o365_user"]}
    c.update({"server": server, "device_id": j["device_id"], "device_name": f.get("name"), "children": j.get("children") or [], "accounts": acc, "paired_at": time.time()}); config.save(c)
    try: schedule.install()
    except Exception as e: print(f"schedule install: {e}")
    threading.Thread(target=engine.run, kwargs={"trigger": "first_run", "echo": False}, daemon=True).start()
    return status_page(f"Paired for {', '.join(k['name'] for k in c['children'])}. First sync is running now.")

def serve(open_browser=True, port=0):
    srv = ThreadingHTTPServer(("127.0.0.1", port), H); url = f"http://127.0.0.1:{srv.server_address[1]}/?t={TOKEN}"
    print(f"Crystal Sync setup: {url}", flush=True)
    if open_browser: threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    srv.serve_forever()
