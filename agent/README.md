# Crystal Sync (agent)

Small cross-platform app a parent installs to pull their child's Cobb ParentVUE data into Crystal.

## Security model (least privilege)
- **Pairing**: a parent creates a pairing code in Crystal → Downloads (`sync_pair_create`). It lasts 15 minutes, works once, and only one code is live per family. Each IP gets 10 bad tries per 15 minutes.
- **Device key** `csd_…` (256-bit) comes back once. Crystal stores only `sha256(key)` and the last 4 characters.
  The key lives in the OS keychain (macOS Keychain, Windows Credential Manager, Secret Service/KWallet on Linux).
- With the key, the device can only:
  - poll its own commands;
  - start, log, and finish its own runs;
  - upload school rows for the `child_ids` it was paired to (`/api/sync/*` → SECURITY DEFINER RPCs in `020_sync_devices.sql`).
- The key **cannot read** any Crystal data and never touches the service-role key.
- **Limits**: 120 calls a minute and 12 uploads an hour per device, plus per-IP edge limits in `functions/_middleware.ts`. Payloads are capped at 4 MB.
- **Revoke** in Crystal → Downloads ("Disconnect") or in /admin → SYNC → CRYSTAL SYNC DEVICES. **Rotate** with `crystal-sync rotate`.
- **Logging**: every run is a `sync_runs` row, and every step goes to `sync_logs`. Logs are masked on the device (known secrets, `password=`, long tokens) and masked again on the server (`sync_mask`).
- **Parent passwords** (ParentVUE / CTLS Parent; optionally StudentVUE, Office 365) are stored only in the local keychain and never sent to Crystal.

## Behaviour
- One ParentVUE login session per run per account, using the same SOAP method set as `eli-dashboard/fetch.ps1`. Parsing reuses `eli-dashboard/parse.py` (vendored as `pv_parse.py`), and rows and quarantine gates reuse `sync/school_sync.py` (`pv_rows.py`).
- Schedule: 5:40 AM and 5:40 PM local time, plus SYNC NOW from Crystal (the daemon polls every 30 s), and it survives reboots:
  - Linux: systemd `--user` `crystal-sync.service` (daemon) + `crystal-sync-run.timer` (`Persistent=true`)
  - macOS: LaunchAgents `com.crystal.sync.daemon` (KeepAlive) + `com.crystal.sync.schedule` (StartCalendarInterval)
  - Windows: Task Scheduler `Crystal Sync Daemon` (at log-on) + `Crystal Sync 0540` / `1740`
- The daemon catches up on a missed slot (if the computer was asleep) within 6 hours. A lock file prevents overlapping runs.
- Local logs are written to the config dir (`logs/sync-YYYYMMDD.log`): `~/.config/crystal-sync`, `~/Library/Application Support/CrystalSync`, or `%APPDATA%\CrystalSync`.

## Commands
`crystal-sync` (setup/status window) · `run [--child ID]` · `daemon` · `status` · `install` / `uninstall` (background jobs) · `rotate` · `forget` (remove keys, config, and jobs) · `selftest` (offline parse of `CRYSTAL_SYNC_FIXTURE=<raw zip>`).

## Build
- Linux: `PY=python3.12 bash packaging/build_linux.sh` → AppImage + .deb (needs a Python built with a shared libpython, e.g. `uv python install 3.12`).
- macOS / Windows: `.github/workflows/crystal-sync.yml` (tag `crystal-sync-vX.Y.Z` or run it manually). Copy the artifacts into `public/downloads/` and deploy Pages, because the repo is private.

## SIGNING TODO (builds are unsigned today)
- **macOS**: Apple Developer Program (~$99/yr) → "Developer ID Application" cert. Then `codesign --options runtime`, `xcrun notarytool submit --wait`, and `stapler staple`. Until then, users right-click → Open.
- **Windows**: OV or EV code-signing cert (~$100–300/yr; EV skips the SmartScreen reputation wait), then `signtool sign /tr <timestamp>`. Until then: SmartScreen → More info → Run anyway.
- **Linux**: optionally sign the AppImage with `--sign` (gpg) and publish `SHA256SUMS.txt` (already generated).

## Migrating Rolan's laptop (Eli) without breaking it
1. Leave the existing laptop pipeline running (`fetch.ps1` → box `school_sync.py`, 5:40 AM/PM). Nothing in 020 changes it, and the status light also counts `edu_students.last_synced_at` from that pipeline.
2. Install Crystal Sync on the laptop and pair it for **Eli only**. It writes into Eli's existing `edu_students` row (`children.edu_student_id`), so the data is the same and both pipelines upsert on the same natural keys.
3. Run both for about a week and compare the `sync_runs` counts with the box's `edu_sync_runs`.
4. Then disable the old Task Scheduler job and box cron. Keep `school_sync.py` for term finals, which Crystal Sync doesn't compute yet, and for the box-side extras (CTLS, report cards, graded assignments).
