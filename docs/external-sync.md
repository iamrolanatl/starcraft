# External to-do + calendar sync (Google + Eli's school O365)

Data: `public.ext_items` (migration 009). RLS: only the owner (signed-in Rolan) can read; the only columns
he can change are `pending_action`/`pending_at`/`hidden` (complete / reopen / delete requests). Titles and
dates are written only by the box from the real source (grounded).

Sources and colors (shown as badges in To-Do, the Calendar applet and the School Hub legend):
| Badge | Source | Route |
|---|---|---|
| Google (gold) | Rolan's Google Calendar + Google Tasks | token route (Connect Google) every 15 min via cron; or the parent bot's Calendar connector -> `ext_sync.py google-cal-feed` |
| Eli O365 (periwinkle) | Eli's Outlook calendar + Microsoft To Do | Outlook "Publish calendar" ICS URL (`ELI_O365_ICS_URL`), or Graph-shaped JSON dropped in `~/.local/state/crystal/o365-inbox/` |
| Crystal (cyan) | local Crystal tasks | Supabase `tasks` |

Validation (matches docs/data-validation-strategy.md): bad rows >20%, empty pulls while data exists, and pulls
<40% of the current items are quarantined in `ext_quarantine` (old data untouched, run shown as "held back").
Blank fields never overwrite; missing items are marked and archived after 3 good pulls, never deleted.

Write-back: Crystal sets `pending_action`; after a 60 s undo window `ext_sync.py writeback` applies it to Google
Tasks (complete / reopen / delete) and Google Calendar (delete). Without a Google token, the parent bot runs
`ext_sync.py pending`, applies each via its Calendar connector, then `ext_sync.py ack <id>`.
Eli's school items are read-only.

Connector feed (parent routine):
```
python3 sync/ext_sync.py google-cal-feed /tmp/gcal.json --from 2026-09-14T00:00:00-04:00 --to 2027-02-11T00:00:00-05:00
```
where gcal.json is the connector's `search` result (`{"events":[...]}`) for exactly that window (max 100 per call: merge pages first).
