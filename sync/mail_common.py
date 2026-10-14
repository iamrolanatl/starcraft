"""Shared helpers for Crystal's Comm > Email pipeline (mail_ingest / mail_outbox / mail_draft).
Env (never printed): CRYSTAL_SUPABASE_SERVICE_ROLE_KEY, optional CRYSTAL_SUPABASE_URL, CRYSTAL_OWNER_EMAIL.
"""
import json, os, re, datetime as dt
import requests

URL = os.environ.get("CRYSTAL_SUPABASE_URL", "https://ogrrjkxkccbywbiikcak.supabase.co").rstrip("/")
KEY = os.environ.get("CRYSTAL_SUPABASE_SERVICE_ROLE_KEY", "")
OWNER = os.environ.get("CRYSTAL_OWNER_EMAIL", "iamrolan@gmail.com").lower()
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def log(m): print(f"[{dt.datetime.now().astimezone():%F %T %Z}] {m}", flush=True, file=__import__("sys").stderr)

class Missing(LookupError): pass

def rest(method, path, body=None, params=None, prefer="return=minimal"):
    r = requests.request(method, f"{URL}/rest/v1/{path}", params=params, timeout=60,
                         headers={**H, "Content-Type": "application/json", "Prefer": prefer},
                         data=None if body is None else json.dumps(body))
    if r.status_code == 404 or "PGRST205" in r.text or "PGRST202" in r.text: raise Missing(path)
    if r.status_code >= 300: raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:300]}")
    return r.json() if r.text and (method == "GET" or "representation" in prefer or path.startswith("rpc/")) else None

def storage_put(path, data, mime):
    r = requests.post(f"{URL}/storage/v1/object/mail/{path}", data=data, timeout=120,
                      headers={**H, "Content-Type": mime or "application/octet-stream", "x-upsert": "true"})
    if r.status_code >= 300: raise RuntimeError(f"storage {path} -> {r.status_code}: {r.text[:200]}")

_owner = None
def owner_id():
    global _owner
    if _owner: return _owner
    page = 1
    while True:
        r = requests.get(f"{URL}/auth/v1/admin/users", params={"page": page, "per_page": 200}, headers=H, timeout=30)
        r.raise_for_status(); us = r.json().get("users", [])
        for u in us:
            if (u.get("email") or "").lower() == OWNER: _owner = u["id"]; return _owner
        if len(us) < 200: return None
        page += 1

ADDR = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
def addrs(s): return [a.lower() for a in ADDR.findall(s or "")]
