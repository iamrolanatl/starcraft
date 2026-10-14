# pull-to-supabase.ps1 - one-shot pull for the 5:40 AM / 5:40 PM Scheduled Task ("EliDashboard Pull").
# agent_begin_scheduled: claims a pending "Sync" request if there is one, otherwise creates a 'scheduled' request,
# so a scheduled pull runs even when nobody pressed Sync. Then the same steps as the watcher:
#   fetch.ps1 -> zip raw\ -> upload -> agent_finish_pull ('processing'; the cloud box builds + publishes).
# If a sync is already in progress it waits (up to 3 tries, 2 min apart) instead of failing.
#   powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\Users\iamro\EliDashboard\sync\pull-to-supabase.ps1
# Exit codes: 0 handed off to the server, 1 the pull failed (shown on the dashboard), 2 could not start.
. (Join-Path $PSScriptRoot 'supabase-common.ps1')
try {
  $job = $null
  foreach ($i in 1..3) {
    try { $job = Begin-ScheduledSync; break }
    catch {
      if ($_.Exception.Message -match 'already running' -and $i -lt 3) {
        Write-LocalLog 'another sync is in progress; retrying in 2 min'
        Start-Sleep -Seconds 120
      } else { throw }
    }
  }
  if (-not $job -or -not $job.id) { throw 'no sync request returned' }
  Write-LocalLog ("scheduled run: request #{0} ({1})" -f $job.id, $job.kind)
  if (Complete-SyncJob $job) { exit 0 } else { exit 1 }
} catch {
  Set-FailureMarker "scheduled pull could not start (Supabase unreachable?): $($_.Exception.Message)"
  exit 2
}
