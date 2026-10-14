#!/usr/bin/env python3
"""Crystal mail outbox for the 5-minute Gmail send routine.

  mail_outbox.py list [--max N]          Atomically CLAIM queued rows (queued -> sending, via rpc mail_outbox_claim,
                                         FOR UPDATE SKIP LOCKED) and print them as a JSON array. A claimed row is never
                                         returned again, so nothing is sent twice. Drafts (status 'draft') are NEVER listed.
  mail_outbox.py peek                    Print queued rows WITHOUT claiming (read-only, for debugging).
  mail_outbox.py mark <id> sent <sent_gmail_id>
  mail_outbox.py mark <id> failed <error text...>
                                         Only rows in 'sending' can be marked. Prints {"ok":true,...}.
Rows stuck in 'sending' over 30 min are marked failed by the next claim (not retried, to avoid a duplicate send).
Each listed row: id, thread_id, in_reply_to (gmail_id), reply_headers {In-Reply-To, References} (RFC Message-ID of the
original if known), to, cc, subject, body, queued_at.
"""
import json, sys, os, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mail_common as C

def _reply_headers(rows):
    ids = [r["in_reply_to"] for r in rows if r.get("in_reply_to")]
    if not ids: return {}
    got = C.rest("GET", "mail_messages", params={"gmail_id": f"in.({','.join(ids)})", "select": "gmail_id,rfc_message_id"})
    return {x["gmail_id"]: x.get("rfc_message_id") for x in got}

def shape(rows):
    rh = _reply_headers(rows)
    return [{"id": r["id"], "thread_id": r.get("thread_id"), "in_reply_to": r.get("in_reply_to"),
             "reply_headers": ({"In-Reply-To": rh[r["in_reply_to"]], "References": rh[r["in_reply_to"]]} if rh.get(r.get("in_reply_to")) else {}),
             "to": r["to"], "cc": r.get("cc"), "subject": r["subject"], "body": r["body"], "queued_at": r["queued_at"]} for r in rows]

def main(argv):
    if not argv: print(__doc__); return 64
    try:
        if argv[0] == "list":
            n = int(argv[argv.index("--max") + 1]) if "--max" in argv else 10
            print(json.dumps(shape(C.rest("POST", "rpc/mail_outbox_claim", {"max_rows": n})))); return 0
        if argv[0] == "peek":
            print(json.dumps(shape(C.rest("GET", "mail_outbox", params={"status": "eq.queued", "select": "*", "order": "queued_at"})))); return 0
        if argv[0] == "mark" and len(argv) >= 4 and argv[2] in ("sent", "failed"):
            rid, st, rest = argv[1], argv[2], " ".join(argv[3:])
            patch = {"status": st, "sent_gmail_id": rest, "sent_at": dt.datetime.now(dt.timezone.utc).isoformat(), "error": None} if st == "sent" else {"status": "failed", "error": rest[:2000]}
            out = C.rest("PATCH", "mail_outbox", patch, {"id": f"eq.{rid}", "status": "eq.sending", "select": "id,status"}, "return=representation")
            if not out: print(json.dumps({"ok": False, "error": f"row {rid} is not in 'sending' (already marked, cancelled, or unknown)"})); return 1
            print(json.dumps({"ok": True, **out[0]})); return 0
    except C.Missing as e: print(json.dumps({"ok": False, "error": f"missing {e}; run migration 012_mail.sql"})); return 3
    print(__doc__); return 64

if __name__ == "__main__": sys.exit(main(sys.argv[1:]))
