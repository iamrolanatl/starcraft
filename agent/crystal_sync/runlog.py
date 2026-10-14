"""Verbose step log: masked, written locally and streamed to Crystal's Sync console in batches."""
import datetime as dt, re, threading
from .config import log_dir

MASKS = [re.compile(r"(?i)((?:password|passwd|pwd|secret|token|apikey|api_key|authorization|cookie|key)[\"']?\s*[:=]\s*[\"']?)[^\s\"'&,;}]+"),
         re.compile(r"(?i)<password>[^<]*</password>"), re.compile(r"csd_[0-9a-f]{8,}"), re.compile(r"[A-Za-z0-9_\-]{32,}")]
_secrets: set = set()

def add_secret(s):
    if s and len(s) >= 3: _secrets.add(s)

def mask(s: str) -> str:
    s = str(s)
    for x in sorted(_secrets, key=len, reverse=True): s = s.replace(x, "****")
    s = MASKS[0].sub(r"\1****", s); s = MASKS[1].sub("<password>****</password>", s)
    s = MASKS[2].sub("csd_****", s); return MASKS[3].sub("****", s)[:1000]

class RunLog:
    def __init__(self, api=None, run_id=None, echo=True):
        self.api, self.run_id, self.echo, self.buf, self.lock = api, run_id, echo, [], threading.Lock()
        self.file = (log_dir() / f"sync-{dt.date.today():%Y%m%d}.log").open("a", encoding="utf-8")
    def __call__(self, step, msg, level="info"):
        m = mask(msg); ts = dt.datetime.now().astimezone()
        line = f"[{ts:%F %T %Z}] {level.upper():5} {step:8} {m}"
        self.file.write(line + "\n"); self.file.flush()
        if self.echo: print(line, flush=True)
        with self.lock: self.buf.append({"level": level, "step": step, "msg": m})
        if len(self.buf) >= 15: self.flush()
    def flush(self):
        with self.lock: lines, self.buf = self.buf, []
        if lines and self.api and self.run_id:
            try: self.api.log(self.run_id, lines)
            except Exception as e: self.file.write(f"(could not stream log: {mask(e)})\n")
    def close(self): self.flush(); self.file.close()
