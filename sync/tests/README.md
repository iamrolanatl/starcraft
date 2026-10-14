# Sync tests (box)
- `test_merge.py` — unit tests for the reusable merge/validation helper (`python3 sync/tests/test_merge.py`).
- End-to-end: local Postgres 17 + PostgREST 12 + `gw.py` (storage/auth stand-in). Apply `stub2.sql` then migrations 001-007 to db `t`,
  start `postgrest pgrst.conf` and `python3 gw.py`, then `python3 mkzips.py` (builds the replay zips from the real latest raw.zip)
  and `python3 e2e_val.py` (validation matrix, 46 checks) / `python3 e2e.py` (laptop agent + alerts, 30 checks). Paths assume /tmp/e2e.
