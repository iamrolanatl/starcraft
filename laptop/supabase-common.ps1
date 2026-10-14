# supabase-common.ps1 - shared helpers for sync-watcher.ps1 and pull-to-supabase.ps1 (dot-sourced, not run directly).
# Windows PowerShell 5.1+, no extra modules. Holds NO service_role key.
#   supabase-agent.json  (next to this file)  SUPABASE URL + publishable/anon key - public by design
#   agent-secret.txt     (next to this file)  the long agent secret - private; never printed, logged, or sent anywhere
#                                              except as p_secret to the agent RPCs over HTTPS
# Paths (override with environment variables if you ever move things):
#   ELIDASH_SYNC_DIR   folder with these scripts   (default: the folder this file is in)
#   ELIDASH_BASE       folder with fetch.ps1, raw\  (default: the parent folder, C:\Users\iamro\EliDashboard)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'   # Invoke-RestMethod / Compress progress bars are slow in 5.1

$script:SyncDir = if ($env:ELIDASH_SYNC_DIR) { $env:ELIDASH_SYNC_DIR } else { $PSScriptRoot }
$script:Base    = if ($env:ELIDASH_BASE)     { $env:ELIDASH_BASE }     else { Split-Path -Parent $script:SyncDir }
$script:FetchScript = Join-Path $script:Base 'fetch.ps1'
$script:RawDir      = Join-Path $script:Base 'raw'
$script:LocalLog    = Join-Path $script:SyncDir 'sync-agent.log'
$script:Utf8        = New-Object System.Text.UTF8Encoding($false)
$script:Dot         = ' ' + [char]0x00B7 + ' '   # the console's middle-dot separator, built here because 5.1 reads .ps1 files as ANSI

# ---------- local log file (no secrets; rotates at ~1 MB) ----------
function Write-LocalLog([string]$Msg) {
  try {
    if ((Test-Path $script:LocalLog) -and (Get-Item $script:LocalLog).Length -gt 1MB) {
      Move-Item $script:LocalLog ($script:LocalLog + '.old') -Force
    }
    $line = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  ' + $Msg
    Add-Content -Path $script:LocalLog -Value $line -Encoding UTF8
    Write-Host $line
  } catch { }   # logging must never break a sync
}

# ---------- local failure marker (req 3): LAST_FAILURE.txt next to these scripts; removed after a good hand-off ----------
$script:FailMarker = Join-Path $script:SyncDir 'LAST_FAILURE.txt'
function Set-FailureMarker([string]$Why) {
  try { [IO.File]::WriteAllText($script:FailMarker, ((Get-Date).ToString('o') + '  ' + $Why + "`r`n"), $script:Utf8) } catch { }
  Write-LocalLog "FAILURE: $Why"
}
function Clear-FailureMarker { try { if (Test-Path $script:FailMarker) { Remove-Item $script:FailMarker -Force } } catch { } }

# ---------- config ----------
function Get-AgentConfig {
  if (-not $script:Cfg) {
    $p = Join-Path $script:SyncDir 'supabase-agent.json'
    if (-not (Test-Path $p)) { throw "supabase-agent.json not found in $script:SyncDir" }
    $c = Get-Content $p -Raw | ConvertFrom-Json
    $url = if ($c.SUPABASE_URL) { $c.SUPABASE_URL } else { $c.supabase_url }
    $key = if ($c.SUPABASE_ANON_KEY) { $c.SUPABASE_ANON_KEY } elseif ($c.publishable_key) { $c.publishable_key } else { $c.anon_key }
    if (-not $url -or -not $key) { throw 'supabase-agent.json must contain supabase_url and publishable_key' }
    $script:Cfg = [pscustomobject]@{ Url = $url.TrimEnd('/'); Key = $key }
  }
  return $script:Cfg
}

function Get-AgentSecret {
  $p = Join-Path $script:SyncDir 'agent-secret.txt'
  if (-not (Test-Path $p)) { throw 'agent-secret.txt is missing (see README step 2)' }
  $s = (Get-Content $p -Raw).Trim()
  if ($s.Length -lt 40) { throw 'agent-secret.txt looks wrong (too short)' }
  return $s
}

function Get-AnonHeaders {
  $c = Get-AgentConfig
  return @{ apikey = $c.Key; Authorization = 'Bearer ' + $c.Key }
}

# Readable error text from an Invoke-RestMethod failure (Supabase returns JSON {message: ...}).
function Get-HttpErrorText($Err) {
  $detail = $null
  try { if ($Err.ErrorDetails -and $Err.ErrorDetails.Message) { $detail = $Err.ErrorDetails.Message } } catch { }
  if ($detail) {
    try { $j = $detail | ConvertFrom-Json; if ($j.message) { $detail = $j.message } } catch { }
  } else { $detail = $Err.Exception.Message }
  if ($detail.Length -gt 300) { $detail = $detail.Substring(0, 300) }
  return $detail
}

# ---------- REST ----------
# POST {url}/rest/v1/rpc/<fn>; the agent secret is added as p_secret. Returns parsed JSON ($null for SQL null).
function Invoke-AgentRpc([string]$Fn, [hashtable]$Params = @{}) {
  $c = Get-AgentConfig
  $p = @{} + $Params
  $p['p_secret'] = Get-AgentSecret
  $body = $script:Utf8.GetBytes(($p | ConvertTo-Json -Compress -Depth 5))
  $p = $null
  try {
    return Invoke-RestMethod -Uri ($c.Url + '/rest/v1/rpc/' + $Fn) -Method Post -Body $body `
      -ContentType 'application/json; charset=utf-8' -Headers (Get-AnonHeaders) -UseBasicParsing -TimeoutSec 60
  } catch {
    throw ("{0}: {1}" -f $Fn, (Get-HttpErrorText $_))
  } finally { $body = $null }
}

# Console lines are visible to the whole family: strip anything that looks like a laptop path, IP address, or URL.
function Protect-Line([string]$Line) {
  $l = $Line -replace '[A-Za-z]:\\[^\s''"]*', '<path>' -replace '\\\\[^\s''"]+', '<path>'
  $l = $l -replace '\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b', '<ip>' -replace 'https?://\S+', '<url>'
  return $l
}

# One console line on the dashboard (public.sync_log via agent_log). Never throws: a missed line must not fail a sync.
# Level: info | step | ok | warn | err. Keep lines short; never put passwords, IPs, or laptop file paths in them.
function Write-SyncLog([long]$Id, [string]$Line, [string]$Level = 'info') {
  Write-LocalLog ("[#{0}] {1,-4} {2}" -f $Id, $Level, $Line)
  try { [void](Invoke-AgentRpc 'agent_log' @{ p_id = $Id; p_level = $Level; p_line = (Protect-Line $Line) }) }
  catch { Write-LocalLog ("  (console line not sent: {0})" -f $_.Exception.Message) }
}

# Upload the zip to the one-time ticket path in the private 'raw' bucket.
# POST = create. (PUT means "replace existing" in Supabase Storage and is refused for the anon role by design:
# the ticket policy only allows creating that one object, never overwriting or reading it.)
function Upload-Raw([string]$UploadPath, [string]$ZipPath) {
  $c = Get-AgentConfig
  $h = Get-AnonHeaders; $h['x-upsert'] = 'false'
  try {
    [void](Invoke-RestMethod -Uri ($c.Url + '/storage/v1/object/raw/' + $UploadPath) -Method Post -InFile $ZipPath `
      -ContentType 'application/zip' -Headers $h -UseBasicParsing -TimeoutSec 180)
  } catch { throw ('upload failed: ' + (Get-HttpErrorText $_)) }
}

function Claim-Sync            { return Invoke-AgentRpc 'agent_claim_sync' }        # pending -> running; $null if none
function Begin-ScheduledSync   { return Invoke-AgentRpc 'agent_begin_scheduled' }   # claim pending, else new 'scheduled' run
function Finish-Pull([long]$Id, [string]$UploadPath) {                               # running -> processing (box takes over)
  return Invoke-AgentRpc 'agent_finish_pull' @{ p_id = $Id; p_upload_path = $UploadPath }
}
function Fail-Sync([long]$Id, [string]$Message) {                                    # running -> failed (console turns red)
  if ($Message.Length -gt 300) { $Message = $Message.Substring(0, 300) }
  try { return Invoke-AgentRpc 'agent_finish_sync' @{ p_id = $Id; p_ok = $false; p_message = $Message } }
  catch { Write-LocalLog ("could not mark #{0} failed: {1}" -f $Id, $_.Exception.Message) }
}

# ---------- the pull ----------
# Counts from raw\Gradebook.xml (or Gradebook_RP*.xml), deduping repeated assignments like parse.py does.
function Get-GradebookCounts {
  $files = @(Get-Item (Join-Path $script:RawDir 'Gradebook.xml') -ErrorAction SilentlyContinue) +
           @(Get-ChildItem (Join-Path $script:RawDir 'Gradebook_RP*.xml') -ErrorAction SilentlyContinue | Sort-Object Name)
  foreach ($f in $files) {
    if (-not $f) { continue }
    try {
      $x = New-Object System.Xml.XmlDocument
      $x.LoadXml([IO.File]::ReadAllText($f.FullName, $script:Utf8).TrimStart([char]0xFEFF))
      $courses = $x.SelectNodes('//Course')
      if ($courses.Count -eq 0) { continue }
      $n = 0
      foreach ($c in $courses) {
        $seen = @{}
        foreach ($a in $c.SelectNodes('.//Assignment')) {
          $gid = $a.GetAttribute('GradebookID')
          if ($gid -and $seen.ContainsKey($gid)) { continue }
          if ($gid) { $seen[$gid] = $true }
          $n++
        }
      }
      return @{ courses = $courses.Count; assignments = $n }
    } catch { }
  }
  return $null
}

# Runs fetch.ps1 ONCE (8-min limit, no retry: one ParentVUE login per run, Cobb lockout protection), checks the result, zips raw\ into a fresh temp zip. Returns the zip path.
# Writes console lines as it goes. Throws a short readable message on failure.
$script:FetchMutexName = 'Local\EliDashboardFetch'
function Invoke-ParentVuePull([long]$Id) {
  if (-not (Test-Path $script:FetchScript)) { throw 'fetch.ps1 not found on ELI-LAPTOP (see README step 3)' }
  $mutex = New-Object System.Threading.Mutex($false, $script:FetchMutexName)
  $have = $false
  try {
    try { $have = $mutex.WaitOne([TimeSpan]::FromMinutes(5)) }
    catch {   # a previous run died while holding it: we own it now
      if ($_.Exception -is [Threading.AbandonedMutexException] -or $_.Exception.InnerException -is [Threading.AbandonedMutexException]) { $have = $true } else { throw }
    }
    if (-not $have) { throw 'another ParentVUE pull is still running' }
    $logPath = Join-Path $script:RawDir '_fetch_log.json'
    $last = ''
    foreach ($attempt in 1) {
      Write-SyncLog $Id '> ParentVUE: pulling gradebook' 'step'
      $t0 = Get-Date
      try {
        # separate process with a time limit (fetch.ps1 prints its own table; we only read raw\_fetch_log.json)
        $sp = @{ FilePath = 'powershell.exe'; PassThru = $true
                 ArgumentList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $script:FetchScript + '"')) }
        if ($env:OS -eq 'Windows_NT') { $sp['WindowStyle'] = 'Hidden' }
        $proc = Start-Process @sp
        if (-not $proc.WaitForExit(8 * 60 * 1000)) {
          try { $proc.Kill() } catch { }
          throw 'ParentVUE pull took longer than 8 min'
        }
        if (-not (Test-Path $logPath) -or (Get-Item $logPath).LastWriteTime -lt $t0.AddSeconds(-2)) { throw 'fetch.ps1 wrote no new data' }
        $fl = Get-Content $logPath -Raw | ConvertFrom-Json
        $okN  = @($fl.log | Where-Object { $_.ok }).Count
        $gbOk = @($fl.log | Where-Object { $_.ok -and $_.method -eq 'Gradebook' }).Count -gt 0
        $cl = @($fl.log | Where-Object { $_.method -eq 'ChildList' } | Select-Object -First 1)
        if ($cl -and -not $cl[0].ok) {
          if ("$($cl[0].error)" -match 'RT_ERROR') { throw ('ParentVUE login failed: ' + ("$($cl[0].error)" -replace '^RT_ERROR:\s*','')) }
          throw ('ParentVUE unreachable: ' + "$($cl[0].error)")
        }
        if (-not (Test-Path (Join-Path $script:RawDir 'ChildList.xml'))) { throw 'ParentVUE login failed (no ChildList)' }
        if (-not $gbOk -or $okN -lt 3) {
          $bad = @($fl.log | Where-Object { -not $_.ok } | Select-Object -First 1)
          $why = if ($bad) { "$($bad[0].method) failed" } else { 'too few requests succeeded' }
          throw "ParentVUE: $why ($okN of $($fl.requests) ok)"
        }
        $cnt = Get-GradebookCounts
        if ($cnt) { Write-SyncLog $Id ("> {0} courses, {1} assignments" -f $cnt.courses, $cnt.assignments) 'ok' }
        else      { Write-SyncLog $Id '> gradebook pulled' 'ok' }
        Write-SyncLog $Id ("> ParentVUE: {0} of {1} requests ok" -f $okN, $fl.requests) 'info'

        Write-SyncLog $Id '> zipping + uploading' 'step'
        $zip = Join-Path ([IO.Path]::GetTempPath()) ('eli-raw-' + [guid]::NewGuid().ToString('N') + '.zip')
        Add-Type -AssemblyName System.IO.Compression
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::CreateFromDirectory($script:RawDir, $zip)   # flat: files at the zip root
        return $zip
      } catch {
        $last = $_.Exception.Message
        Write-LocalLog "pull attempt $attempt failed: $last"
      }
    }
    throw $last
  } finally {
    if ($have) { try { $mutex.ReleaseMutex() } catch { } }
    $mutex.Dispose()
  }
}

# Full run for a claimed job ({id, kind, upload_path} from Claim-Sync / Begin-ScheduledSync):
# pull -> zip -> upload -> Finish-Pull (status 'processing'; the box builds + publishes and writes the rest).
# Never throws. Returns $true when handed off to the server.
function Complete-SyncJob($Job) {
  $id = [long]$Job.id
  $zip = $null
  try {
    $what = if ($Job.kind -eq 'scheduled') { 'scheduled pull' } else { 'pull requested' }
    Write-SyncLog $id ("> $what" + $script:Dot + 'starting') 'step'
    $zip = Invoke-ParentVuePull $id
    $kb = [math]::Round((Get-Item $zip).Length / 1KB)
    Upload-Raw $Job.upload_path $zip
    Write-SyncLog $id (("> upload complete{0}{1} KB") -f $script:Dot, $kb) 'ok'
    Write-SyncLog $id '> handing off to server for processing' 'step'
    $r = Finish-Pull $id $Job.upload_path
    Write-LocalLog ("job #{0} handed off: {1}" -f $id, $r.status)
    Clear-FailureMarker
    return $true
  } catch {
    $msg = $_.Exception.Message
    if (-not $msg) { $msg = 'unknown error on ELI-LAPTOP' }
    Set-FailureMarker ("job #{0}: {1}" -f $id, $msg)
    Write-SyncLog $id ("> {0}" -f $msg) 'err'
    [void](Fail-Sync $id (Protect-Line $msg))
    return $false
  } finally {
    if ($zip -and (Test-Path $zip)) { Remove-Item $zip -Force -ErrorAction SilentlyContinue }
  }
}
