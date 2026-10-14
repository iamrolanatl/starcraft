#!/usr/bin/env python3
"""Crystal external to-do + calendar sync (box). Grounded, non-destructive, two-way for Google.

Sources (each writes public.ext_items for the owner, iamrolan@gmail.com):
  google-cal-feed FILE --from ISO --to ISO   Google Calendar JSON from the parent bot's connector ({"events":[...]})
  google-cal-api   [--days-back 30 --days-ahead 120]   Google Calendar API via the stored refresh token (Connect Google)
  google-tasks-api                                      Google Tasks API via the stored refresh token
  o365-ics  URL|FILE [--days-back 30 --days-ahead 180]  Eli's Outlook published-calendar ICS (env ELI_O365_ICS_URL)
  o365-json FILE                                        Microsoft Graph-shaped JSON from the laptop pull ({"events":[...],"tasks":[...]})
  writeback                                             push Crystal complete/uncomplete/delete to Google (token route)
  pending                                               print Google event deletes that need the connector (no token)
  ack ID [--error MSG]                                  mark a connector write-back done (or failed)
  status                                                last runs per source

Validation (same rules as docs/data-validation-strategy.md / sync/merge.py):
  * rows without an id or title are rejected; >20% rejected -> whole pull quarantined
  * empty pull while Crystal holds >=1 active item in that window -> quarantined (never wipes)
  * pull <40% of the active items in the window (when >=5) -> quarantined
  * a blank field never overwrites a known value; missing rows are marked missing, archived after 3 good pulls, never deleted
Secrets: CRYSTAL_SUPABASE_SERVICE_ROLE_KEY (~/.config/crystal/sync.env), CRYSTAL_GOOGLE_CLIENT_ID/SECRET
(~/.config/crystal/google.env). Never printed.
"""
import argparse, datetime as dt, json, os, re, sys
from pathlib import Path
from zoneinfo import ZoneInfo
import requests

URL = os.environ.get("CRYSTAL_SUPABASE_URL", "https://ogrrjkxkccbywbiikcak.supabase.co").rstrip("/")
KEY = os.environ.get("CRYSTAL_SUPABASE_SERVICE_ROLE_KEY", "")
OWNER = os.environ.get("CRYSTAL_OWNER_EMAIL", "iamrolan@gmail.com").lower()
ET = ZoneInfo("America/New_York")
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
FIELDS = ["list_id", "list_name", "title", "notes", "due_date", "starts_at", "ends_at", "all_day", "location", "url", "done", "ext_updated_at"]
BLANK = {"", "n/a", "na", "-", "—", "null", "none"}
DRY = False

def now(): return dt.datetime.fromisoformat(os.environ["CRYSTAL_NOW"]) if os.environ.get("CRYSTAL_NOW") else dt.datetime.now(dt.timezone.utc)
def iso(t): return t.astimezone(dt.timezone.utc).isoformat() if t else None
def blank(v): return v is None or (isinstance(v, str) and v.strip().lower() in BLANK)
def say(m): print(f"[{now().astimezone(ET):%F %T %Z}] {m}", flush=True)

def rest(method, path, body=None, params=None, prefer="return=representation"):
    if not KEY: sys.exit("CRYSTAL_SUPABASE_SERVICE_ROLE_KEY not set (source ~/.config/crystal/sync.env)")
    r = requests.request(method, f"{URL}/rest/v1/{path}", params=params, headers={**H, "Prefer": prefer},
                         data=None if body is None else json.dumps(body), timeout=60)
    if r.status_code >= 400: raise RuntimeError(f"supabase {method} {path}: {r.status_code} {r.text[:300]}")
    return r.json() if r.text else None

_uid = None
def owner():
    global _uid
    if _uid: return _uid
    page = 1
    while True:
        r = requests.get(f"{URL}/auth/v1/admin/users", params={"page": page, "per_page": 200}, headers=H, timeout=30); r.raise_for_status()
        us = r.json().get("users", [])
        _uid = next((u["id"] for u in us if (u.get("email") or "").lower() == OWNER), None)
        if _uid or len(us) < 200: break
        page += 1
    if not _uid: sys.exit(f"owner {OWNER} has no Supabase account yet (sign in to Crystal once)")
    return _uid

# ---------- time helpers ----------
def parse_dt(v, tz=None):
    """ISO date or datetime (with or without offset) -> (aware datetime, all_day)."""
    if blank(v): return None, False
    v = str(v).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v): return dt.datetime.fromisoformat(v).replace(tzinfo=ET), True
    v = re.sub(r"\.(\d{6})\d+", r".\1", v.replace("Z", "+00:00"))
    t = dt.datetime.fromisoformat(v)
    if t.tzinfo is None: t = t.replace(tzinfo=ZoneInfo(tz) if tz and tz in _zones() else (dt.timezone.utc if tz == "UTC" else ET))
    return t, False
def _zones():
    import zoneinfo; return zoneinfo.available_timezones()
def day(t): return t.astimezone(ET).date().isoformat() if t else None

def row(source, kind, ext_id, title, **kw):
    r = {"source": source, "kind": kind, "ext_id": None if blank(ext_id) else str(ext_id)[:300], "title": None if blank(title) else str(title).strip()[:500]}
    for f in FIELDS:
        if f != "title": r[f] = kw.get(f)
    r["all_day"] = bool(r["all_day"]); r["done"] = bool(r["done"])
    for f in ("notes", "location"):
        if isinstance(r[f], str): r[f] = r[f].strip()[:4000] or None
    return r

# ---------- normalizers ----------
def norm_google_event(e):
    """Accepts the connector shape (event_id/summary/start_time) or Google API shape (id/summary/start.dateTime)."""
    if e.get("status") == "cancelled": return None
    st = e.get("start_time") or (e.get("start") or {}).get("dateTime") or (e.get("start") or {}).get("date")
    en = e.get("end_time") or (e.get("end") or {}).get("dateTime") or (e.get("end") or {}).get("date")
    s, ad = parse_dt(st); en_t, _ = parse_dt(en)
    if ad and en_t: en_t = en_t - dt.timedelta(days=1)  # Google all-day end is exclusive
    return row("google", "event", e.get("event_id") or e.get("id"), e.get("summary"), notes=e.get("description"),
               starts_at=iso(s), ends_at=iso(en_t), due_date=day(s), all_day=ad, location=e.get("location"),
               url=e.get("html_link") or e.get("htmlLink"), ext_updated_at=e.get("updated"), list_id="primary", list_name="Google Calendar")

def norm_google_task(t, lst):
    if t.get("deleted"): return None
    due, _ = parse_dt((t.get("due") or "")[:10] or None)
    return row("google", "task", t.get("id"), t.get("title"), notes=t.get("notes"), due_date=day(due), all_day=True,
               done=t.get("status") == "completed", url=t.get("webViewLink"), ext_updated_at=t.get("updated"),
               list_id=lst.get("id"), list_name=lst.get("title"))

def norm_graph_event(e):
    if e.get("isCancelled"): return None
    s, _ = parse_dt((e.get("start") or {}).get("dateTime"), (e.get("start") or {}).get("timeZone"))
    en, _ = parse_dt((e.get("end") or {}).get("dateTime"), (e.get("end") or {}).get("timeZone"))
    ad = bool(e.get("isAllDay"))
    if ad and s: s = dt.datetime.combine(s.date(), dt.time(), ET); en = en and dt.datetime.combine(en.date() - dt.timedelta(days=1), dt.time(), ET)
    return row("o365", "event", e.get("id"), e.get("subject"), notes=e.get("bodyPreview"), starts_at=iso(s), ends_at=iso(en),
               due_date=day(s), all_day=ad, location=(e.get("location") or {}).get("displayName"), url=e.get("webLink"),
               ext_updated_at=e.get("lastModifiedDateTime"), list_id="calendar", list_name="Eli · Outlook")

def norm_graph_task(t):
    d = t.get("dueDateTime") or {}
    due, _ = parse_dt(d.get("dateTime"), d.get("timeZone"))
    return row("o365", "task", t.get("id"), t.get("title"), notes=(t.get("body") or {}).get("content"),
               due_date=due.date().isoformat() if due else None, all_day=True, done=t.get("status") == "completed",
               ext_updated_at=t.get("lastModifiedDateTime"), list_id=t.get("listId"), list_name=t.get("listName") or "Eli · To Do")

def ics_rows(text, start, end):
    import icalendar, recurring_ical_events
    cal = icalendar.Calendar.from_ical(text); out = []
    for ev in recurring_ical_events.of(cal).between(start, end):
        s = ev.get("DTSTART").dt; e = ev.get("DTEND").dt if ev.get("DTEND") else s
        ad = not isinstance(s, dt.datetime)
        if ad: s = dt.datetime.combine(s, dt.time(), ET); e = dt.datetime.combine(e, dt.time(), ET) - dt.timedelta(days=1)
        else:
            s = s if s.tzinfo else s.replace(tzinfo=ET); e = e if e.tzinfo else e.replace(tzinfo=ET)
        uid = str(ev.get("UID") or ""); rid = ev.get("RECURRENCE-ID")
        occ = f"{uid}@{s.isoformat()}" if (ev.get("RRULE") or rid) else uid
        out.append(row("o365", "event", occ if uid else None, str(ev.get("SUMMARY") or ""), notes=str(ev.get("DESCRIPTION") or "") or None,
                       starts_at=iso(s), ends_at=iso(e), due_date=day(s), all_day=ad, location=str(ev.get("LOCATION") or "") or None,
                       list_id="ics", list_name="Eli · Outlook"))
    return out

# ---------- merge with validation ----------
def merge(source, kind, pulled, window=None, raw=None):
    """window=(start,end) for events: only items starting inside it can go missing. Returns status."""
    uid = owner(); t = iso(now())
    good = [r for r in pulled if r and r["ext_id"] and r["title"]]
    rejected = len([r for r in pulled if r]) - len(good)
    params = {"user_id": f"eq.{uid}", "source": f"eq.{source}", "kind": f"eq.{kind}", "select": "*"}
    old = {o["ext_id"]: o for o in rest("GET", "ext_items", params=params) or []}
    def in_win(o):
        if not window: return True
        s = o.get("starts_at"); return bool(s) and window[0] <= dt.datetime.fromisoformat(s) < window[1]
    active = [o for o in old.values() if not o.get("archived_at") and in_win(o)]
    reason = None
    if pulled and rejected / max(1, len(pulled)) > 0.2: reason = f"{rejected} of {len(pulled)} rows had no id/title"
    elif not good and active: reason = f"blank pull: 0 items but Crystal holds {len(active)} active"
    elif len(active) >= 5 and len(good) < 0.4 * len(active): reason = f"suspicious drop: {len(good)} pulled vs {len(active)} active"
    if reason:
        say(f"QUARANTINED {source}/{kind}: {reason}")
        if not DRY:
            rest("POST", "ext_quarantine", {"user_id": uid, "source": source, "kind": kind, "reason": reason, "payload": raw if raw is not None else pulled[:500]}, prefer="return=minimal")
            rest("POST", "ext_sync_runs", {"user_id": uid, "source": source, "kind": kind, "status": "quarantined", "pulled": len(pulled), "reason": reason}, prefer="return=minimal")
        return "quarantined"
    seen, ups, c = set(), [], {"accepted": 0, "kept_old": 0, "missing": 0, "archived": 0}
    for n in good:
        if n["ext_id"] in seen: continue
        seen.add(n["ext_id"]); o = old.get(n["ext_id"]) or {}; m = {}; changed = not o
        for f in FIELDS:
            nv, ov = n.get(f), o.get(f)
            if blank(nv) and not blank(ov) and f not in ("done", "all_day"): m[f] = ov; c["kept_old"] += 1
            else:
                m[f] = nv
                if o and _norm(nv) != _norm(ov): changed = True
        if changed: c["accepted"] += 1
        ups.append({"user_id": uid, "source": source, "kind": kind, "ext_id": n["ext_id"], **m, "last_seen_at": t,
                    "last_changed_at": t if changed else (o.get("last_changed_at") or t), "missing_since": None, "missing_count": 0, "archived_at": None})
    for o in active:
        if o["ext_id"] in seen: continue
        mc = (o.get("missing_count") or 0) + 1; c["missing"] += 1
        p = {"missing_since": o.get("missing_since") or t, "missing_count": mc}
        if mc >= 3: p["archived_at"] = t; c["archived"] += 1
        if not DRY: rest("PATCH", "ext_items", p, {"id": f"eq.{o['id']}"}, "return=minimal")
    if not DRY:
        for i in range(0, len(ups), 200):
            rest("POST", "ext_items", ups[i:i + 200], {"on_conflict": "user_id,source,kind,ext_id"}, "resolution=merge-duplicates,return=minimal")
        rest("POST", "ext_sync_runs", {"user_id": uid, "source": source, "kind": kind, "status": "ok", "pulled": len(good), **c}, prefer="return=minimal")
    say(f"ok {source}/{kind}: pulled {len(good)} (rejected {rejected}), changed {c['accepted']}, kept-old fields {c['kept_old']}, missing {c['missing']}, archived {c['archived']}")
    return "ok"

def _norm(v):
    if isinstance(v, str) and re.match(r"\d{4}-\d{2}-\d{2}T", v):
        try: return dt.datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
        except ValueError: return v
    return v

def fail_run(source, kind, msg):
    say(f"FAILED {source}/{kind}: {msg}")
    if not DRY:
        try: rest("POST", "ext_sync_runs", {"user_id": owner(), "source": source, "kind": kind, "status": "failed", "reason": msg[:500]}, prefer="return=minimal")
        except Exception: pass

# ---------- Google token route ----------
def google_token():
    cid, sec = os.environ.get("CRYSTAL_GOOGLE_CLIENT_ID"), os.environ.get("CRYSTAL_GOOGLE_CLIENT_SECRET")
    if not (cid and sec): raise RuntimeError("CRYSTAL_GOOGLE_CLIENT_ID/SECRET not set (~/.config/crystal/google.env)")
    rt = rest("POST", "rpc/svc_google_token", {"p_user": owner()})
    if not rt: raise RuntimeError("Google not connected yet: press 'Connect Google' in Crystal (To-Do applet)")
    r = requests.post("https://oauth2.googleapis.com/token", data={"client_id": cid, "client_secret": sec, "refresh_token": rt, "grant_type": "refresh_token"}, timeout=30)
    if r.status_code != 200: raise RuntimeError(f"Google token refresh failed ({r.status_code}): reconnect Google in Crystal")
    return r.json()["access_token"]

def gget(tok, url, params=None):
    items, params = [], dict(params or {})
    while True:
        r = requests.get(url, headers={"Authorization": f"Bearer {tok}"}, params=params, timeout=60)
        if r.status_code >= 400: raise RuntimeError(f"Google API {r.status_code}: {r.text[:200]}")
        j = r.json(); items += j.get("items", [])
        if not j.get("nextPageToken"): return items
        params["pageToken"] = j["nextPageToken"]

def window_args(a):
    n = now(); return n - dt.timedelta(days=a.days_back), n + dt.timedelta(days=a.days_ahead)

def cmd_google_cal_api(a):
    s, e = window_args(a); tok = google_token()
    ev = gget(tok, "https://www.googleapis.com/calendar/v3/calendars/primary/events", {"timeMin": iso(s), "timeMax": iso(e), "singleEvents": "true", "maxResults": 250})
    return merge("google", "event", [norm_google_event(x) for x in ev], (s, e), ev)

def cmd_google_tasks_api(a):
    tok = google_token(); out = []
    for lst in gget(tok, "https://tasks.googleapis.com/tasks/v1/users/@me/lists", {"maxResults": 100}):
        for t in gget(tok, f"https://tasks.googleapis.com/tasks/v1/lists/{lst['id']}/tasks", {"showCompleted": "true", "showHidden": "true", "maxResults": 100}):
            out.append(norm_google_task(t, lst))
    return merge("google", "task", out, None, out)

def cmd_google_cal_feed(a):
    j = json.loads(Path(a.file).read_text()); ev = j.get("events", j if isinstance(j, list) else [])
    s, e = parse_dt(a.frm)[0], parse_dt(a.to)[0]
    return merge("google", "event", [norm_google_event(x) for x in ev], (s, e), ev)

def cmd_o365_ics(a):
    src = a.src or os.environ.get("ELI_O365_ICS_URL")
    if not src: raise RuntimeError("no ICS URL: set ELI_O365_ICS_URL in ~/.config/crystal/o365.env")
    if re.match(r"https?://|webcal://", src):
        r = requests.get(src.replace("webcal://", "https://"), timeout=60); r.raise_for_status(); text = r.text
    else: text = Path(src).read_text()
    if "BEGIN:VCALENDAR" not in text: raise RuntimeError("ICS fetch did not return a calendar (sign-in page or blocked link?)")
    s, e = window_args(a); return merge("o365", "event", ics_rows(text, s, e), (s, e), None)

def cmd_o365_json(a):
    j = json.loads(Path(a.file).read_text()); st = []
    if "events" in j:
        s, e = window_args(a); st.append(merge("o365", "event", [norm_graph_event(x) for x in j["events"]], (s, e), j["events"]))
    if "tasks" in j: st.append(merge("o365", "task", [norm_graph_task(x) for x in j["tasks"]], None, j["tasks"]))
    return "quarantined" if "quarantined" in st else "ok"

# ---------- write-back ----------
def pending_rows():
    return rest("GET", "ext_items", params={"user_id": f"eq.{owner()}", "pending_action": "not.is.null", "pending_at": f"lt.{iso(now() - dt.timedelta(seconds=60))}", "select": "id,source,kind,ext_id,list_id,title,pending_action,done"}) or []

def finish(r, ok, err=None):
    p = {"pending_action": None, "pending_at": None, "writeback_error": None}
    if not ok: p = {"pending_action": None, "writeback_error": (err or "failed")[:300]}
    elif r["pending_action"] == "delete": p.update(archived_at=iso(now()), hidden=True)
    else: p["done"] = r["pending_action"] == "complete"
    rest("PATCH", "ext_items", p, {"id": f"eq.{r['id']}"}, "return=minimal")

def cmd_writeback(a):
    rows = pending_rows(); tok = None; n = 0
    for r in rows:
        if r["source"] != "google": finish(r, False, "Eli's school account is read-only from Crystal"); continue
        if tok is None:
            try: tok = google_token()
            except RuntimeError as e: say(f"writeback waiting: {e}"); tok = False
        if tok is False: continue  # connector route: parent handles via `pending`
        H2 = {"Authorization": f"Bearer {tok}"}
        if r["kind"] == "task":
            u = f"https://tasks.googleapis.com/tasks/v1/lists/{r['list_id']}/tasks/{r['ext_id']}"
            if r["pending_action"] == "delete": resp = requests.delete(u, headers=H2, timeout=30)
            else: resp = requests.patch(u, headers=H2, json={"status": "completed"} if r["pending_action"] == "complete" else {"status": "needsAction", "completed": None}, timeout=30)
        else:
            if r["pending_action"] != "delete": finish(r, False, "events can't be completed"); continue
            resp = requests.delete(f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{r['ext_id']}", headers=H2, timeout=30)
        ok = resp.status_code < 300 or (r["pending_action"] == "delete" and resp.status_code in (404, 410))
        finish(r, ok, None if ok else f"Google {resp.status_code}"); n += ok
        say(f"writeback {r['kind']} {r['pending_action']}: {'ok' if ok else resp.status_code}")
    say(f"writeback done: {n} applied, {len(rows)} pending seen")

def cmd_pending(a):
    print(json.dumps([r for r in pending_rows() if r["source"] == "google"], indent=1))

def cmd_ack(a):
    r = rest("GET", "ext_items", params={"id": f"eq.{a.id}", "user_id": f"eq.{owner()}", "select": "*"})
    if not r: sys.exit("no such item")
    finish(r[0], not a.error, a.error); say(f"acked {a.id}")

def cmd_status(a):
    for r in rest("GET", "ext_sync_runs", params={"user_id": f"eq.{owner()}", "order": "created_at.desc", "limit": "12", "select": "created_at,source,kind,status,pulled,reason"}) or []:
        print(r)

def main():
    global DRY
    p = argparse.ArgumentParser(); p.add_argument("--dry-run", action="store_true"); sp = p.add_subparsers(dest="cmd", required=True)
    def win(x, back=30, ahead=120): x.add_argument("--days-back", type=int, default=back); x.add_argument("--days-ahead", type=int, default=ahead); return x
    x = sp.add_parser("google-cal-feed"); x.add_argument("file"); x.add_argument("--from", dest="frm", required=True); x.add_argument("--to", required=True)
    win(sp.add_parser("google-cal-api")); sp.add_parser("google-tasks-api")
    x = win(sp.add_parser("o365-ics"), 30, 180); x.add_argument("src", nargs="?")
    x = win(sp.add_parser("o365-json"), 30, 180); x.add_argument("file")
    sp.add_parser("writeback"); sp.add_parser("pending"); x = sp.add_parser("ack"); x.add_argument("id"); x.add_argument("--error")
    sp.add_parser("status")
    a = p.parse_args(); DRY = a.dry_run
    fn = {"google-cal-feed": cmd_google_cal_feed, "google-cal-api": cmd_google_cal_api, "google-tasks-api": cmd_google_tasks_api, "o365-ics": cmd_o365_ics,
          "o365-json": cmd_o365_json, "writeback": cmd_writeback, "pending": cmd_pending, "ack": cmd_ack, "status": cmd_status}[a.cmd]
    src = {"google-cal-feed": ("google", "event"), "google-cal-api": ("google", "event"), "google-tasks-api": ("google", "task"), "o365-ics": ("o365", "event"), "o365-json": ("o365", "event")}.get(a.cmd)
    try: st = fn(a)
    except (RuntimeError, requests.RequestException, ValueError) as e:
        if src: fail_run(*src, str(e)); sys.exit(2)
        raise
    sys.exit(3 if st == "quarantined" else 0)

if __name__ == "__main__": main()
