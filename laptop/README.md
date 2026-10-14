# Eli dashboard: laptop sync (install guide)

**What this does:** when someone presses **Sync** on the dashboard, Eli's laptop pulls the latest grades from
ParentVUE and uploads them. The cloud box then builds the dashboard and publishes it. You can watch every step in the
dashboard's console. The laptop also does this on its own at **5:40 AM and 5:40 PM**.

The laptop never connects *in* to anything. It only reaches out to Supabase (the dashboard's database) over HTTPS.

## Files in this folder

| file | what it does |
|---|---|
| `sync-watcher.ps1` | Runs in the background. Every 10 seconds it checks whether someone pressed **Sync**. If so, it pulls ParentVUE, uploads the data, and hands off to the cloud box. |
| `pull-to-supabase.ps1` | The same pull, run once by the 5:40 AM / 5:40 PM scheduled task. It runs even if nobody pressed Sync. |
| `supabase-common.ps1` | Shared code for the two scripts above. You never run it directly. |
| `supabase-agent.json` | The dashboard's address and its *public* key. This key is safe to share. |
| `agent-secret.txt` | **You create this file in step 2.** It holds the laptop's private password for the dashboard. |
| `sync-agent.log` | Created automatically. A plain-text diary of what the laptop did. It contains no passwords. |

The scripts use the existing `C:\Users\iamro\EliDashboard\fetch.ps1` (the ParentVUE pull) and its saved ParentVUE login.

---

## 1. Copy the folder

Copy this whole `laptop` folder to the laptop as:

```
C:\Users\iamro\EliDashboard\sync\
```

Afterwards you should have `C:\Users\iamro\EliDashboard\sync\sync-watcher.ps1` and the other files. `fetch.ps1` stays
where it already is, one folder up.

Open **PowerShell** (Start menu, type *PowerShell*, then Enter; you don't need *Run as administrator*) and run:

```powershell
Get-ChildItem C:\Users\iamro\EliDashboard\sync | Unblock-File
```

## 2. Add the laptop's secret (`agent-secret.txt`)

The secret is a long random password. It lets the laptop write to the dashboard and nothing else.
**You'll get it from me through a secure box. Never email it, text it, or paste it into a chat**, including this one.

When you have it:

1. Open **Notepad** and paste the secret on a single line, with nothing else in the file.
2. **File > Save As**. Go to `C:\Users\iamro\EliDashboard\sync\`, set *Save as type* to **All files (\*.\*)**,
   type the name `agent-secret.txt`, choose *Encoding* **UTF-8**, and click Save.
   (If *Save as type* stays on *Text documents*, Notepad saves the file as `agent-secret.txt.txt` and the scripts won't find it.)
3. Lock the file so only your Windows account can read it. In PowerShell:

```powershell
icacls C:\Users\iamro\EliDashboard\sync\agent-secret.txt /inheritance:r /grant:r "${env:USERNAME}:(R,W)" "SYSTEM:(F)"
```

Don't copy this file anywhere else. To replace the secret later, just overwrite the file.

## 3. Check that the ParentVUE pull still works

The ParentVUE login is already saved on this laptop in `pv-cred.dpapi.json`, and `fetch.ps1` uses it. To confirm:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\iamro\EliDashboard\fetch.ps1
```

You should see a table where most rows say `True`. Seven of nine is normal: `StudentInfo` and `StudentSchoolInfo`
always fail on Cobb's side. You should also see a line like `zip: ...raw.zip (27000 bytes)`. If every row fails, the saved
ParentVUE login needs updating. Fix that before you continue.

`fetch.ps1` must stay at `C:\Users\iamro\EliDashboard\fetch.ps1`, one folder above the `sync` folder.

## 4. Set up the scheduled tasks

Paste this whole block into the **same, non-administrator** PowerShell window (signed in as iamro):

```powershell
$me   = "$env:USERDOMAIN\$env:USERNAME"
$sync = 'C:\Users\iamro\EliDashboard\sync'
$who  = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited

# (a) Sync watcher: starts at logon. A 5-minute safety trigger restarts it if it ever stops
#     (IgnoreNew = never two copies). Runs hidden, no time limit.
$a = New-ScheduledTaskAction -Execute 'powershell.exe' `
       -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$sync\sync-watcher.ps1`""
$t = @( (New-ScheduledTaskTrigger -AtLogOn -User $me),
        (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)) )
$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
       -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable `
       -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'EliDashboard SyncWatcher' -Action $a -Trigger $t -Settings $s -Principal $who -Force
Start-ScheduledTask -TaskName 'EliDashboard SyncWatcher'

# (b) 5:40 AM / 5:40 PM pull: wakes the laptop and uploads straight to the dashboard.
#     This replaces the old "EliDashboard Pull" task that emailed raw.zip.
$a = New-ScheduledTaskAction -Execute 'powershell.exe' `
       -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$sync\pull-to-supabase.ps1`""
$t = @( (New-ScheduledTaskTrigger -Daily -At '5:40 AM'), (New-ScheduledTaskTrigger -Daily -At '5:40 PM') )
$s = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
       -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'EliDashboard Pull' -Action $a -Trigger $t -Settings $s -Principal $who -Force

Get-ScheduledTask 'EliDashboard SyncWatcher','EliDashboard Pull' | Select-Object TaskName, State
```

The last line should show `EliDashboard SyncWatcher  Running` and `EliDashboard Pull  Ready`.

Notes:
- Both tasks run only while **iamro is signed in**. A locked screen is fine; *signed out* is not, because Windows only
  unlocks the saved ParentVUE login for a signed-in user.
- A PowerShell window may flash for a moment at logon. That's normal.
- To stop syncing: `Disable-ScheduledTask 'EliDashboard SyncWatcher'` (and `Enable-ScheduledTask` to resume).

## 5. Test it

1. On the dashboard, press **Sync** and keep the console open.
2. Within about 10 seconds you should see `> pull requested · starting`, then `> ParentVUE: pulling gradebook`,
   `> 7 courses, 84 assignments` (with the real numbers), `> zipping + uploading`, and `> handing off to server for processing`.
   Then the cloud box adds `> parsing + building model`, `> publishing`, and `> sync complete`, and the dashboard reloads.
   The whole run usually takes under a minute.
3. If the console turns red, the reason is shown in the red box. The laptop's diary is
   `C:\Users\iamro\EliDashboard\sync\sync-agent.log`.
4. Optional, to test the scheduled pull right away: `Start-ScheduledTask 'EliDashboard Pull'`. A *scheduled* sync
   shows up on the dashboard within about 30 seconds.

If the console only shows *AWAITING ELI-LAPTOP*, the laptop is asleep, signed out, offline, or the watcher isn't
running. Check with `Get-ScheduledTask 'EliDashboard SyncWatcher'` and look at `sync-agent.log`.

## Power settings (important)

- **Pressing Sync only works while the laptop is awake** and iamro is signed in. If you press Sync while it's asleep,
  the request waits in the queue (the console says so) and runs as soon as the laptop wakes. If you want Sync to work anytime, go to
  Settings > System > Power & battery > Screen and sleep, and set *When plugged in, put my device to sleep after* to **Never**.
  The screen can still turn off.
- **The 5:40 pulls wake the laptop by themselves** (WakeToRun). For that to work, wake timers must be allowed:
  Control Panel > Power Options > Change plan settings > Change advanced power settings > Sleep > **Allow wake timers: Enable**.
  The laptop also has to be asleep, not shut down. If it was off, the pull runs as soon as it's turned on and signed in.

## How it works (for reference)

```
Dashboard Sync -> request "pending"
laptop sync-watcher (every 10 s): agent_claim_sync -> "running" + one-time upload slot
   agent_log ...console lines...  ->  fetch.ps1  ->  zip raw\  ->  upload to the private 'raw' bucket
   agent_finish_pull -> "processing"  ==> Supabase wakes the cloud box (webhook)
cloud box: download -> parse -> build -> publish -> console tail lines -> "done" (SYNC COMPLETE)
any laptop error: agent_log err line + agent_finish_sync(ok=false) -> "failed" (red console)
```

The laptop holds only the public key and its own secret, never the database's admin key. The secret can only claim
sync requests, write console lines, and upload into a one-time slot. It can't read any data. If the laptop is ever lost,
tell me and I'll revoke the secret in one step.
