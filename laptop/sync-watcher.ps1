# sync-watcher.ps1 - ELI-LAPTOP side of the dashboard "Sync" button. Runs hidden at logon (Scheduled Task).
# Every IntervalSec (default 10 s) it asks Supabase for a pending sync request (agent_claim_sync). When it gets one:
#   console lines -> fetch.ps1 (ParentVUE) -> zip raw\ -> upload to the one-time path -> agent_finish_pull
#   (status 'processing'; the cloud box then builds the dashboard, writes the last console lines, and marks it done).
# On any error: an 'err' console line + agent_finish_sync(ok=false) -> the dashboard shows SYNC FAILED.
# The loop never exits on errors; it logs and keeps going. Manual and scheduled requests are pulled the same way.
#   powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\Users\iamro\EliDashboard\sync\sync-watcher.ps1
#   -Once            poll a single time and exit (testing)
#   -IntervalSec N   poll interval in seconds (default 10)
param([switch]$Once, [int]$IntervalSec = 10)
. (Join-Path $PSScriptRoot 'supabase-common.ps1')
if ($IntervalSec -lt 5) { $IntervalSec = 5 }

# only one watcher at a time (the task may be started twice: logon + manual start)
$inst = New-Object System.Threading.Mutex($false, 'Local\EliDashboardSyncWatcher')
$owned = $false
try { $owned = $inst.WaitOne(0) } catch { $owned = $true }   # abandoned by a crashed watcher -> ours now
if (-not $owned) { Write-LocalLog 'watcher already running; exiting'; exit 0 }

try {
  Write-LocalLog "watcher started (every ${IntervalSec}s)"
  $errStreak = 0
  while ($true) {
    try {
      $job = Claim-Sync
      if ($errStreak -gt 0) { Write-LocalLog "connection ok again after $errStreak error(s)"; if ($errStreak -ge 6) { Clear-FailureMarker } }
      $errStreak = 0
      if ($job -and $job.id) {
        Write-LocalLog ("claimed request #{0} ({1}, by {2})" -f $job.id, $job.kind, $job.requested_by)
        [void](Complete-SyncJob $job)   # never throws; writes its own console lines and final status
      }
    } catch {
      $errStreak++
      # log the first few errors, then one every ~5 min, so an offline laptop doesn't fill the disk
      if ($errStreak -le 3 -or ($errStreak % 30) -eq 0) { Write-LocalLog "poll error ($errStreak): $($_.Exception.Message)" }
      if ($errStreak -eq 6) { Set-FailureMarker "cannot reach Supabase: $($_.Exception.Message)" }
    }
    if ($Once) { break }
    # offline / Supabase unreachable for a while: back off to 60 s, otherwise the normal interval
    $sleep = if ($errStreak -ge 6) { 60 } else { $IntervalSec }
    Start-Sleep -Seconds $sleep
  }
} finally {
  try { $inst.ReleaseMutex() } catch { }
  $inst.Dispose()
}
