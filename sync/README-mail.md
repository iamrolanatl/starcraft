# Comm › Email school inbox (Gmail → Crystal)

Run `supabase/migrations/012_mail.sql` once. A 5-minute Grok Bot routine moves the Gmail data. It calls these box scripts through `sync/run_mail.sh`, which loads `~/.config/crystal/sync.env` and `escalation.env`.

## 1. Pull (every 5 min)
Gmail search query (connector `search_threads`), limited to recent mail with `newer_than:2d` (use `newer_than:365d` once for the backfill):

    (from:cobbk12.org OR to:cobbk12.org OR cc:cobbk12.org OR from:(parentvue OR synergy OR edupoint OR itslearning OR ctls OR remind.com) OR (from:signupgenius.com (school OR Dickerson OR PTO)) OR "Dickerson Middle" OR "Dickerson MS") -in:spam -in:trash newer_than:2d

Then, for each message: call `get_message(messageFormat=FULL_CONTENT)`, fetch the bytes of each attachment (Gmail DownloadFile `<message id>/<attachment id>`), base64 them, and write one file:

```json
{"messages": [{
  "id": "18f0aa01", "threadId": "18f0aa01", "rfc_message_id": "<abc@cobbk12.org>",
  "sender": "Ms. Jane Sparks <jane.sparks@cobbk12.org>", "to_recipients": ["iamrolan@gmail.com"], "cc_recipients": [],
  "subject": "...", "date": "2026-10-13T19:05:00Z", "snippet": "...",
  "plaintext_body": "...", "html_body": "<p>...</p>", "label_ids": ["INBOX", "UNREAD"],
  "attachments": [{"filename": "Study Guide.pdf", "mime_type": "application/pdf", "size": 12345,
                   "attachment_id": "ANGjdJ_1", "data_base64": "JVBERi0..."}]
}]}
```
The get_message fields pass through unchanged. Camel-case variants such as `threadId`/`thread_id` and `labelIds`/`label_ids` are accepted, and the date may be ISO, RFC 2822 or epoch ms. Only `id` is required. `rfc_message_id` is optional; if present it is used for In-Reply-To. Attachments without `data_base64` are recorded nowhere and are retried on the next pull. Each attachment is capped at 25 MB.

    sync/run_mail.sh ingest /tmp/mail.json      # stdout: {"ok":..,"inserted","updated","unchanged","skipped_not_school","attachments_uploaded","drafts":[..],"errors":[..]}

Ingest is idempotent by gmail_id. A blank field never overwrites a stored one. HTML is sanitized with nh3, and non-school mail is skipped. New **teacher** emails get a Crystal draft reply with status `draft`, which is never sent automatically. Exit codes: 0 ok, 1 per-message errors, 2 owner not signed up, 3 migration missing.

## 2. Drafts
Crystal drafts only when `mail_common.reply_gate` passes: an individual `first.last@cobbk12.org` sender (no noreply/role/`+` addresses such as `CCSD.Schoolinfo+…` or `FieldTrips@`), not Rolan's own or SENT mail, no `List-Unsubscribe`/`List-Id`/`Precedence: bulk` headers (pass get_message `headers` through if available), no SmorePages/ParentSquare/SchoolMessenger-style senders or unsubscribe footers, Rolan in To/Cc (otherwise it was BCC'd), at most 4 other recipients, and Rolan hasn't already replied later in the thread. Then a cheap yes/no Workers AI check (`llama-3.1-8b`, `CRYSTAL_MAIL_LLM_GATE=0` disables it) must not say NO.

    sync/run_mail.sh draft --prune [--apply]    # list / delete unedited Crystal drafts that no longer qualify (edited drafts and queued/sent rows are never touched)
    sync/run_mail.sh draft --pending            # redraft rows where the user pressed ↻ Regenerate

## 3. Send (every 5 min)
    sync/run_mail.sh outbox list                # atomically claims queued -> sending, prints a JSON array
    # for each row: send with the Gmail connector (reply in thread_id; to/cc/subject/body; reply_headers if given)
    sync/run_mail.sh outbox mark <id> sent <sent_gmail_id>
    sync/run_mail.sh outbox mark <id> failed "<error>"
Rows are claimed once, so nothing is sent twice. A row left in `sending` for more than 30 minutes is marked failed and is not resent. Drafts are never listed.

## Style learning
When a Crystal draft is sent, a DB trigger stores (original, final) in `mail_style_edits`. `mail_draft.py` builds a profile from those pairs (greeting, sign-off, length, words removed and added) and adds it, plus the 3 latest pairs, to the prompt (`run_mail.sh draft --profile` shows it).

Tests: `sync/tests/test_mail_sql.sh` runs the migration and RLS checks on a local Postgres. `python3 sync/tests/test_mail_py.py` covers ingest, the outbox and drafting. `npx tsx scripts/test-mail.mts` covers Crystal's grounding.
