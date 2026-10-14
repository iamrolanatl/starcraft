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
