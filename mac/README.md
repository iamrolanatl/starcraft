# Crystal school sync on a MacBook Air

This folder does on a Mac what `laptop/` does on the Windows laptop. Twice a day, and whenever you press **Sync** in Crystal, it logs in to ParentVUE once, gets Eli's school data and uploads it to Crystal.

## What gets installed
| Thing | Where |
|---|---|
| The program (`crystal_sync.py`, built-in Python only) | `~/Library/Application Support/Crystal/bin/` |
| ParentVUE login and agent secret | **macOS Keychain**, under `crystal-parentvue` and `crystal-agent-secret`. They are never saved in a file. |
| Scheduled pull, 5:40 AM and 5:40 PM | LaunchAgent `com.crystal.pull` |
| Watcher for the Sync button (checks every 10 s, restarts itself) | LaunchAgent `com.crystal.watcher` |
| Logs | `~/Library/Logs/Crystal/` (`sync.log`, plus `*.out.log` and `*.err.log`) |
| Last error, if any | `~/Library/Application Support/Crystal/LAST_FAILURE.txt` |

## Install (about 5 minutes)
1. If Terminal says python3 is missing, run `xcode-select --install` first.
2. Get the repo onto the Mac, open Terminal in the `mac` folder and run:
   ```
   ./install.sh
   ```
3. When it asks, type:
   - your ParentVUE username and password (what you type stays hidden);
   - the agent secret. It's the same text as `agent-secret.txt` on the Windows laptop.
4. When it asks **Primary?**, answer **n** unless you've already turned off the Windows laptop (see below).
5. The installer finishes with one test ParentVUE login. If macOS asks whether Python can use the Keychain, click **Always Allow**.
6. To wake the Mac for the morning pull, run this once (it asks for your Mac password):
   ```
   sudo pmset repeat wakeorpoweron MTWRFSU 05:35:00
   ```
   macOS only allows one repeating wake time. For the 5:40 PM pull, the Mac just needs to be awake and plugged in, which is normal at that hour. A Mac with the lid closed and no power won't wake up at all. If a pull is missed, launchd runs it as soon as the Mac wakes up.

Run `/usr/bin/python3 ~/Library/Application\ Support/Crystal/bin/crystal_sync.py status` at any time to check the setup. It never shows the secrets.

## Primary agent: only ONE computer pulls
Cobb locks the account after repeated logins, so the Mac and the Windows laptop must never both pull. Only the computer marked **primary** runs the scheduled pulls and answers the Sync button. On the Mac, the marker is the file `~/Library/Application Support/Crystal/PRIMARY_AGENT`. A Mac without it does nothing.

**Switch from Windows to the Mac**
1. On the Windows laptop, open PowerShell as admin and run:
   `Disable-ScheduledTask "EliDashboard Pull"; Disable-ScheduledTask "EliDashboard SyncWatcher"; Stop-ScheduledTask "EliDashboard SyncWatcher"`
2. On the Mac, run: `touch ~/Library/Application\ Support/Crystal/PRIMARY_AGENT`. You can also re-run `./install.sh` and answer **y**.

**Switch back to Windows**
1. On the Mac, run: `rm ~/Library/Application\ Support/Crystal/PRIMARY_AGENT`
2. On Windows, run: `Enable-ScheduledTask "EliDashboard Pull"; Enable-ScheduledTask "EliDashboard SyncWatcher"; Start-ScheduledTask "EliDashboard SyncWatcher"`

Even if both computers were left on by mistake, a Sync button press is claimed by only one of them, because Supabase hands each request out once. The scheduled pulls are what would double up, which is why the marker exists.

## Safety features (same as Windows)
- **One ParentVUE login per run, never retried.** A wrong password fails right away and shows **SYNC FAILED** in Crystal with the reason.
- **Blank pulls are never uploaded.** A pull is rejected if:
  - the login fails;
  - fewer than 3 requests succeed;
  - the gradebook isn't there;
  - the gradebook has 0 courses.

  The server then runs its own checks from migration 007, which quarantine suspicious pulls, so existing data is never overwritten by an empty pull.
- **Failures show up in Crystal's console** (through `agent_log` and `agent_finish_sync`) and are also written to the local log and `LAST_FAILURE.txt`.
- **Uploads go to the private `raw` bucket** through a one-time path that can't overwrite anything.

## What it pulls
ChildList, StudentInfo, Gradebook (it falls back to the current reporting period), Attendance, StudentClassList, StudentSchoolInfo, messages, the calendar for this month and next, **report cards** (as PDFs) and **student documents**. The file names match the Windows `fetch.ps1`, so the server treats a pull from either computer the same way.

**Not ported:** the CTLS Learn export (`raw/ctls`). It's done by a separate tool on Windows. Until it's added, Mac pulls carry ParentVUE data only, and CTLS keeps whatever was last synced.

### Adding a pull
In `crystal_sync.py`, write a function `def pull_x(px, cp, child_id)` that calls `px.call("MethodName", cp, "FileName")`, and add it to `EXTRA_PULLS`. Each extra pull is isolated: if it fails, it's logged and the core pull still goes ahead.

## Uninstall
`./uninstall.sh`, or `./uninstall.sh --keep-secrets` to keep the Keychain items. If you set a wake schedule, also run `sudo pmset repeat cancel`.

## Tests (no Mac needed)
`python3 tests/mock_run.py` runs the program against a fake ParentVUE and a fake Supabase, with a fake `security` command.
