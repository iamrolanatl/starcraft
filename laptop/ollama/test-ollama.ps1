param([Parameter(Mandatory = $true)][string]$Hostname)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path; $key = (Get-Content (Join-Path $here "ollama-secret.txt") -Raw).Trim()
Write-Host "Local Ollama:"; try { (Invoke-RestMethod http://127.0.0.1:11434/api/tags).models.name } catch { Write-Host "  not running: start the Ollama app" -ForegroundColor Red }
Write-Host "Through tunnel:"; try { $b = @{ model = "llama3.1:8b"; stream = $false; messages = @(@{ role = "user"; content = "Say hi in five words." }) } | ConvertTo-Json -Depth 4; (Invoke-RestMethod "https://$Hostname/api/chat" -Method Post -Body $b -ContentType "application/json" -Headers @{ "X-Crystal-Key" = $key } -TimeoutSec 90).message.content } catch { Write-Host "  failed: $($_.Exception.Message)" -ForegroundColor Red }
