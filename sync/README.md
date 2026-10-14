# School sync (Education module)

**Flow:** laptop (home network, Windows Task Scheduler 5:40 AM/PM + on-demand watcher) runs `fetch.ps1`
(ParentVUE SOAP `PXPCommunication.asmx` + CTLS Learn export) -> uploads a zip -> box `eli-dashboard`
pipeline builds `/workspace/eli-dashboard/data.json` -> **`school_sync.py`** upserts into Crystal Supabase
`edu_*` tables (migration `002_education.sql`, owner-only RLS).

Cobb's servers block cloud/datacenter IPs (TLS to parentvue.cobbk12.org never completes from the box), so the
pull itself must stay on the home network. The Crystal step runs on the box via cron every 30 min and
no-ops unless the pull's `fetched_at` changed.

- `school_sync.py [--dry-run] [--force]` — exit 0 ok/skip, 2 owner hasn't signed in, 3 migrations not run.
- `run_sync.sh` — cron wrapper; loads `CRYSTAL_SUPABASE_SERVICE_ROLE_KEY` from `~/.config/crystal/sync.env` (chmod 600, box only).
- Cron: `CRON_TZ=America/New_York` / `*/30 * * * * /workspace/crystal/sync/run_sync.sh >> ~/.local/state/crystal/school_sync.log 2>&1`

## Laptop agent + box poller (replaces the deleted EliDash project, migration 003)
- Laptop (`laptop/`): `pull-to-supabase.ps1` (Task Scheduler 5:40 AM/PM) and `sync-watcher.ps1` (at logon, polls every 10 s for Sync presses).
  One ParentVUE attempt per run (no retry). Writes `LAST_FAILURE.txt` next to the scripts on any failure; deleted after the next good hand-off.
  Password stays DPAPI-encrypted in `C:\Users\iamro\EliDashboard\pv-cred.dpapi.json` and is only sent to parentvue.cobbk12.org by fetch.ps1.
- Box: `poller.py` via cron every minute (+ `@reboot`). Processes `processing` jobs -> ingest_zip.sh -> school_sync.py -> done;
  sweeps stuck jobs; raises deduped alerts into `edu_alerts` + `~/.local/state/crystal/alerts-outbox.jsonl` (+ SMTP if `CRYSTAL_SMTP_*` set).
- No systemd on the box: `ensure_cron.sh` (hooked into ~/.bashrc and ~/.profile) restarts cron and warns on a stale heartbeat.
- End-to-end test: local Postgres + PostgREST + a storage/auth stand-in, 30 checks (see report).
