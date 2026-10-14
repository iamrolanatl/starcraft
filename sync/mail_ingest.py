#!/usr/bin/env python3
"""Ingest school-related Gmail messages into Crystal (mail_messages / mail_attachments / storage bucket `mail`).

Usage:  mail_ingest.py FILE.json [--dry-run] [--no-drafts]
        (FILE may be '-' for stdin). Prints a JSON summary on stdout. Exit 0 ok, 2 owner not signed up, 3 migration 012 missing.

Input: {"messages": [ <Gmail connector get_message(FULL_CONTENT) object, plus attachments[].data_base64> , ... ]}
       (a bare list of messages is accepted too). See sync/README-mail.md for the exact field list.

Rules: idempotent upsert by gmail_id; a blank incoming field never overwrites a stored non-blank one
(merge.is_blank / merge.merge_fields); is_read is only ever moved unread->read by Gmail, never reset by a re-pull;
attachments go to mail/<user_id>/<gmail_id>/<key>-<filename>; HTML is sanitized with nh3 (no scripts, styles,
event handlers, remote images); non-school messages are skipped. New teacher messages get a Crystal draft reply
(mail_draft.py) unless --no-drafts.
"""
import argparse, base64, hashlib, json, re, sys, os, datetime as dt
from email.utils import parsedate_to_datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mail_common as C
try:
    import merge as M
    is_blank, merge_fields = M.is_blank, M.merge_fields
except Exception:  # data-validation helper not present: same rules inline
    def is_blank(v): return v is None or (isinstance(v, str) and v.strip().lower() in {"", "n/a", "-", "null", "none"}) or (isinstance(v, (list, dict)) and not v)
    def merge_fields(old, new, fields, allow_blank=()):
        out = dict(old or {}); ch = False
        for f in fields:
            if not is_blank(new.get(f)) and new.get(f) != out.get(f): out[f] = new[f]; ch = True
            elif f not in out: out[f] = new.get(f)
        return out, None, ch

FIELDS = ["thread_id", "rfc_message_id", "from", "to", "cc", "subject", "date", "snippet", "body_text", "body_html", "labels", "school_tag", "has_attachments"]
MAX_ATT = 25 * 1024 * 1024

# ---------- school classification ----------
STAFF_NOT = re.compile(r"^(no-?reply|do-?not-?reply|donotreply|news|newsletter|communications?|info|notifications?|alerts?|support|webmaster|ctls|itslearning|superintendent|board)", re.I)
def school_tag(m, teachers=()):
    frm = C.addrs(m.get("from")); to = C.addrs(f'{m.get("to","")} {m.get("cc","")}')
    text = f'{m.get("subject","")} {m.get("snippet","")} {(m.get("body_text") or "")[:4000]}'.lower()
    f = frm[0] if frm else ""
    dom = f.split("@")[-1]
    if f in teachers: return "teacher"
    if re.search(r"itslearning|ctls", f) or (dom.endswith("cobbk12.org") and re.search(r"\bctls\b|itslearning", text)): return "CTLS"
    if dom.endswith("cobbk12.org"):
        return "district" if STAFF_NOT.match(f.split("@")[0]) else "teacher"
    if re.search(r"parentvue|studentvue|synergy|edupoint", f + " " + text[:300]): return "school"
    if "remind.com" in dom or dom.endswith("remind.com"): return "school"
    if "signupgenius" in dom and re.search(r"school|dickerson|pto|class|teacher|cobb", text): return "school"
    if any(a.endswith("cobbk12.org") for a in to): return "teacher" if any(a.endswith("@cobbk12.org") and not STAFF_NOT.match(a.split("@")[0]) for a in to) else "school"
    if "dickerson" in text: return "school"
    return None

# ---------- HTML sanitize ----------
def sanitize_html(h):
    if is_blank(h): return None
    import nh3
    tags = {"a","b","i","u","em","strong","p","br","div","span","ul","ol","li","table","thead","tbody","tr","td","th","h1","h2","h3","h4","h5","h6","blockquote","pre","code","hr","img","font","center","small","sub","sup"}
    out = nh3.clean(h, tags=tags, attributes={"a": {"href", "title"}, "img": {"alt", "width", "height"}, "td": {"colspan", "rowspan"}, "th": {"colspan", "rowspan"}, "*": set()},
                    url_schemes={"http", "https", "mailto"}, link_rel="noopener noreferrer nofollow", strip_comments=True)
    return out.strip() or None

def strip_html(h): return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h or "")).strip()

# ---------- normalize connector output ----------
def g(m, *ks):
    for k in ks:
        if m.get(k) not in (None, ""): return m[k]
    return None
def joinaddr(v):
    if isinstance(v, list): return ", ".join(x if isinstance(x, str) else (x.get("email") or x.get("address") or "") for x in v) or None
    return v
def iso(v):
    if v in (None, ""): return None
    if isinstance(v, (int, float)) or (isinstance(v, str) and v.isdigit()):
        n = int(v); return dt.datetime.fromtimestamp(n / 1000 if n > 1e11 else n, dt.timezone.utc).isoformat()
    try: return dt.datetime.fromisoformat(v.replace("Z", "+00:00")).isoformat()
    except ValueError:
        try: return parsedate_to_datetime(v).isoformat()
        except Exception: return None

def normalize(m):
    gid = g(m, "id", "message_id", "messageId", "gmail_id")
    if not gid: raise ValueError("message without id")
    html = g(m, "html_body", "htmlBody", "body_html")
    labels = g(m, "label_ids", "labelIds", "labels") or []
    n = {"gmail_id": str(gid), "thread_id": str(g(m, "thread_id", "threadId") or gid), "rfc_message_id": g(m, "rfc_message_id", "rfcMessageId", "message_id_header"),
         "from": joinaddr(g(m, "sender", "from")), "to": joinaddr(g(m, "to_recipients", "toRecipients", "to")), "cc": joinaddr(g(m, "cc_recipients", "ccRecipients", "cc")),
         "subject": g(m, "subject"), "date": iso(g(m, "date", "internalDate", "internal_date")), "snippet": g(m, "snippet"),
         "body_html": sanitize_html(html), "labels": list(labels)}
    n["body_text"] = g(m, "plaintext_body", "plaintextBody", "body_text") or (strip_html(n["body_html"]) if n["body_html"] else None)
    n["_unread"] = "UNREAD" in labels if labels else None
    atts = []
    for i, a in enumerate(g(m, "attachments") or []):
        fn = re.sub(r"[^\w.\- ]+", "_", a.get("filename") or a.get("name") or f"attachment-{i}").strip()[:150] or f"attachment-{i}"
        b64 = a.get("data_base64") or a.get("data")
        data = base64.urlsafe_b64decode(b64 + "=" * (-len(b64) % 4)) if b64 else None
        key = re.sub(r"[^\w\-]", "", str(a.get("attachment_id") or a.get("attachmentId") or ""))[:40] or f"{i}-{hashlib.sha1(fn.encode()).hexdigest()[:8]}"
        atts.append({"attachment_key": key, "filename": fn, "mime_type": a.get("mime_type") or a.get("mimeType") or "application/octet-stream",
                     "size": len(data) if data is not None else a.get("size"), "_data": data})
    n["has_attachments"] = bool(atts); n["_atts"] = atts
    return n

def load(path):
    raw = json.load(sys.stdin if path == "-" else open(path))
    return raw["messages"] if isinstance(raw, dict) else raw

def known_teachers(uid):
    try: rows = C.rest("GET", "edu_messages", params={"user_id": f"eq.{uid}", "select": "*", "limit": "500"})
    except Exception: return set()
    return {a for r in rows for k, v in r.items() if isinstance(v, str) and ("from" in k or "email" in k or "sender" in k) for a in C.addrs(v)} - {C.OWNER}

def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument("file"); ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--no-drafts", action="store_true")
    a = ap.parse_args(argv)
    msgs = load(a.file); uid = "00000000-0000-0000-0000-000000000000" if a.dry_run else C.owner_id()
    if not uid: print(json.dumps({"ok": False, "error": "owner not signed up"})); return 2
    teachers = set() if a.dry_run else known_teachers(uid)
    s = {"ok": True, "seen": len(msgs), "inserted": 0, "updated": 0, "unchanged": 0, "skipped_not_school": 0, "errors": [], "attachments_uploaded": 0, "drafts": [], "new_teacher_ids": []}
    for raw in msgs:
        try:
            n = normalize(raw); tag = school_tag(n, teachers)
            if not tag or (C.addrs(n["from"]) or [""])[0] == C.OWNER and not any(x.endswith("cobbk12.org") for x in C.addrs(n["to"])):
                s["skipped_not_school"] += 1; continue
            n["school_tag"] = tag
            old = None if a.dry_run else (C.rest("GET", "mail_messages", params={"gmail_id": f"eq.{n['gmail_id']}", "select": "*"}) or [None])[0]
            merged, _, changed = merge_fields(old or {}, n, FIELDS)
            row = {k: merged.get(k) for k in FIELDS}; row.update({"gmail_id": n["gmail_id"], "user_id": uid})
            if old is None: row["is_read"] = n["_unread"] is False
            elif n["_unread"] is False and not old.get("is_read"): row["is_read"] = True; changed = True
            if old is not None and not changed: s["unchanged"] += 1
            if a.dry_run: s["inserted" if old is None else "updated"] += 1; s.setdefault("rows", []).append({**row, "attachments": [{k: v for k, v in x.items() if k != "_data"} for x in n["_atts"]]}); continue
            if old is None or changed:
                rec = C.rest("POST", "mail_messages", [row], {"on_conflict": "gmail_id", "select": "id"}, "resolution=merge-duplicates,return=representation")[0]
                s["inserted" if old is None else "updated"] += 1
            else: rec = old
            have = {x["attachment_key"] for x in C.rest("GET", "mail_attachments", params={"message_id": f"eq.{rec['id']}", "select": "attachment_key"})}
            for at in n["_atts"]:
                if at["attachment_key"] in have or at["_data"] is None: continue
                if len(at["_data"]) > MAX_ATT: s["errors"].append(f"{n['gmail_id']}: {at['filename']} over 25 MB, skipped"); continue
                sp = f"{uid}/{n['gmail_id']}/{at['attachment_key']}-{at['filename']}"
                C.storage_put(sp, at["_data"], at["mime_type"])
                C.rest("POST", "mail_attachments", [{"user_id": uid, "message_id": rec["id"], "gmail_id": n["gmail_id"], "attachment_key": at["attachment_key"], "filename": at["filename"],
                        "mime_type": at["mime_type"], "size": at["size"], "storage_path": sp}], {"on_conflict": "gmail_id,attachment_key"}, "resolution=ignore-duplicates,return=minimal")
                s["attachments_uploaded"] += 1
            if old is None and tag == "teacher": s["new_teacher_ids"].append(n["gmail_id"])
        except C.Missing as e: print(json.dumps({"ok": False, "error": f"table missing: {e}; run migration 012_mail.sql"})); return 3
        except Exception as e: s["errors"].append(f"{raw.get('id', '?')}: {e}"[:300])
    if s["new_teacher_ids"] and not a.no_drafts and not a.dry_run:
        import mail_draft
        for gid in s["new_teacher_ids"]:
            try: s["drafts"].append(mail_draft.draft_for(gid))
            except Exception as e: s["errors"].append(f"draft {gid}: {e}"[:300])
    s["ok"] = not s["errors"]; print(json.dumps(s, default=str)); return 0 if s["ok"] else 1

if __name__ == "__main__": sys.exit(main())
