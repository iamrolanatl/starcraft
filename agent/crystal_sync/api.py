"""Crystal /api/sync client. The device key is sent only as an Authorization header and never logged."""
import requests
from . import __version__

class ApiError(Exception):
    def __init__(self, status, msg): super().__init__(f"{status}: {msg}"); self.status = status

class Api:
    def __init__(self, server, key=None):
        self.server, self.key = server.rstrip("/"), key
    def call(self, op, body=None, timeout=60):
        h = {"content-type": "application/json", "user-agent": f"CrystalSync/{__version__}"}
        if self.key: h["authorization"] = f"Device {self.key}"
        r = requests.post(f"{self.server}/api/sync/{op}", json=body or {}, headers=h, timeout=timeout)
        try: j = r.json()
        except Exception: j = {"error": r.text[:200]}
        if r.status_code >= 300 or (isinstance(j, dict) and j.get("error")): raise ApiError(r.status_code, j.get("error") if isinstance(j, dict) else str(j))
        return j
    def pair(self, code, name, platform): return self.call("pair", {"code": code, "name": name, "platform": platform, "version": __version__})
    def poll(self): return self.call("poll", {"version": __version__}, timeout=30)
    def start(self, child_id, run_id=None, trigger="schedule", slot=None): return self.call("start", {"child_id": child_id, "run_id": run_id, "trigger": trigger, "slot": slot})["run_id"]
    def claim(self, slot): return self.call("claim", {"slot": slot})
    def log(self, run_id, lines): return self.call("log", {"run_id": run_id, "lines": lines})
    def upload(self, run_id, child_id, payload): return self.call("upload", {"run_id": run_id, "child_id": child_id, "payload": payload}, timeout=120)
    def finish(self, run_id, status, counts=None, error=None): return self.call("finish", {"run_id": run_id, "status": status, "counts": counts or {}, "error": error})
    def rotate(self): return self.call("rotate")["device_key"]
