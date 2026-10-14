# One-time setup for Crystal Tutor on Rolan-Laptop (Windows). Run in PowerShell (not as admin unless winget asks).
#   powershell -ExecutionPolicy Bypass -File .\setup-ollama.ps1 -Hostname tutor.<your-domain>
# Never prints the secret. It's saved to ollama-secret.txt (keep it private, do not commit it).
param([Parameter(Mandatory = $true)][string]$Hostname, [string]$Model = "llama3.1:8b", [string]$TunnelName = "crystal-ollama")
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "1/6 Installing Ollama and cloudflared (skips if present)..."
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) { winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements }
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements }
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
# Keep Ollama bound to localhost only (its default). Never set OLLAMA_HOST=0.0.0.0.
[Environment]::SetEnvironmentVariable("OLLAMA_HOST", "127.0.0.1:11434", "User")
Write-Host "2/6 Pulling $Model (about 4.7 GB, one time)..."
ollama pull $Model
Write-Host "3/6 Creating the shared secret..."
$sf = Join-Path $here "ollama-secret.txt"
if (-not (Test-Path $sf)) { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ([BitConverter]::ToString($b) -replace "-", "").ToLower() | Set-Content $sf -NoNewline }
icacls $sf /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
Write-Host "   Saved to $sf (not shown here)."
Write-Host "4/6 Cloudflare login + tunnel (a browser opens; pick the domain for $Hostname)..."
$cfdir = Join-Path $env:USERPROFILE ".cloudflared"
if (-not (Test-Path (Join-Path $cfdir "cert.pem"))) { cloudflared tunnel login }
$existing = cloudflared tunnel list -o json | ConvertFrom-Json | Where-Object { $_.name -eq $TunnelName }
if (-not $existing) { cloudflared tunnel create $TunnelName | Out-Null; $existing = cloudflared tunnel list -o json | ConvertFrom-Json | Where-Object { $_.name -eq $TunnelName } }
$id = $existing.id
cloudflared tunnel route dns $TunnelName $Hostname
@"
tunnel: $id
credentials-file: $cfdir\$id.json
ingress:
  - hostname: $Hostname
    service: http://127.0.0.1:11435
  - service: http_status:404
"@ | Set-Content (Join-Path $cfdir "config-crystal-ollama.yml")
Write-Host "5/6 Auto-start at login: guard + tunnel (scheduled tasks)..."
$guard = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$here\ollama-guard.ps1`""
$tun = New-ScheduledTaskAction -Execute (Get-Command cloudflared).Source -Argument "tunnel --config `"$cfdir\config-crystal-ollama.yml`" run $TunnelName"
$trig = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "Crystal Ollama Guard" -Action $guard -Trigger $trig -Settings $set -Force | Out-Null
Register-ScheduledTask -TaskName "Crystal Ollama Tunnel" -Action $tun -Trigger $trig -Settings $set -Force | Out-Null
Start-ScheduledTask "Crystal Ollama Guard"; Start-ScheduledTask "Crystal Ollama Tunnel"; Start-Sleep 6
Write-Host "6/6 Self-test..."
$key = (Get-Content $sf -Raw).Trim()
try { Invoke-WebRequest "https://$Hostname/api/tags" -UseBasicParsing -TimeoutSec 15 | Out-Null; Write-Host "   WARNING: request WITHOUT the key succeeded; stop and check the guard." -ForegroundColor Red } catch { Write-Host "   OK: blocked without the key." }
try { $t = Invoke-RestMethod "https://$Hostname/api/tags" -Headers @{ "X-Crystal-Key" = $key } -TimeoutSec 20; Write-Host "   OK: tunnel reaches Ollama. Models: $(($t.models | ForEach-Object name) -join ', ')" -ForegroundColor Green } catch { Write-Host "   Tunnel not answering yet ($($_.Exception.Message)). Wait a minute and run test-ollama.ps1." -ForegroundColor Yellow }
Write-Host "`nLast step: run  .\set-crystal-secret.ps1 -Hostname $Hostname  to hand the URL + secret to Crystal (Cloudflare Pages)."
