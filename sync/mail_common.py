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

# ---------- reply gate: which messages deserve a Crystal draft ----------
# Only an individual Cobb staff member writing personally to Rolan, where a reply is plausibly expected.
ROLE = re.compile(r"^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|news|newsletter|communications?|info|notifications?|"
                  r"alerts?|support|help|webmaster|ctls|itslearning|superintendent|board|ccsd|schoolinfo|fieldtrips?|attendance|"
                  r"admissions?|registrar|counseling|office|frontoffice|media|pto|pta|events?|digest|announcements?|district|"
                  r"principal|admin|hr|payroll|transportation|nutrition|athletics|chorus|band|clinic|it|tech)\b", re.I)
BULK_DOM = re.compile(r"(smore|smorepages|parentsquare|schoolmessenger|remind\.com|signupgenius|mailchimp|constantcontact|"
                      r"blackboard|finalsite|peachjar|sendgrid|mcsv\.net|campaign|bulletin|list-manage)", re.I)
BULK_TEXT = re.compile(r"unsubscribe|view (this|in) (email )?(in )?(your )?browser|parentsquare|smore\.com|schoolmessenger|"
                       r"you are receiving this|manage (your )?(notification|subscription)|this (message|email) was sent to all", re.I)
INDIVIDUAL = re.compile(r"^[a-z]+(?:[.'-][a-z]+)+\d*$", re.I)   # first.last / first.m.last style
MAX_RECIPIENTS = 4

def header(m, name):
    h = m.get("headers") or m.get("payload_headers") or {}
    if isinstance(h, list): h = {(x.get("name") or "").lower(): x.get("value") for x in h if isinstance(x, dict)}
    else: h = {str(k).lower(): v for k, v in h.items()}
    return h.get(name.lower())

def reply_gate(m, owner=None, rolan_replied_after=False):
    """Pure rule check. Returns (ok, reason). m: normalized message (from/to/cc/subject/body_text/labels, optional headers)."""
    owner = (owner or OWNER).lower()
    frm = (addrs(m.get("from")) or [""])[0]
    to, cc = addrs(m.get("to")), addrs(m.get("cc"))
    local, _, dom = frm.partition("@")
    if not frm: return False, "no sender"
    if frm == owner or "SENT" in (m.get("labels") or []): return False, "from self"
    if ROLE.match(local) or "+" in local: return False, "role/noreply sender"
    if header(m, "list-unsubscribe") or header(m, "list-id") or (header(m, "precedence") or "").lower() in ("bulk", "list", "junk"):
        return False, "bulk headers"
    if BULK_DOM.search(dom): return False, "bulk sender domain"
    if dom != "cobbk12.org": return False, "not an @cobbk12.org sender"
    if not INDIVIDUAL.match(local): return False, "not an individual sender"
    if owner not in to + cc: return False, "bcc/not addressed to owner"
    if len(set(to + cc) - {frm}) > MAX_RECIPIENTS: return False, "broadcast (many recipients)"
    text = f"{m.get('subject') or ''}\n{(m.get('body_text') or m.get('snippet') or '')[:6000]}"
    if BULK_TEXT.search(text): return False, "newsletter content"
    if rolan_replied_after: return False, "already replied"
    return True, "personal staff email"
