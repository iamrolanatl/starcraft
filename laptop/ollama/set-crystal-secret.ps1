# Copies the tunnel URL + shared secret into Crystal's Cloudflare Pages settings without showing the secret.
# Needs Node (npx wrangler) and a one-time `npx wrangler login` with the Cloudflare account that owns the "crystal" Pages project.
param([Parameter(Mandatory = $true)][string]$Hostname)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
(Get-Content (Join-Path $here "ollama-secret.txt") -Raw).Trim() | npx wrangler pages secret put OLLAMA_SHARED_SECRET --project-name crystal
"https://$Hostname" | npx wrangler pages secret put OLLAMA_URL --project-name crystal
"ollama" | npx wrangler pages secret put CHAT_PROVIDER --project-name crystal
Write-Host "Done. Crystal uses Ollama on the next deploy. Open Education > Tutor: replies should say 'Answered by Ollama (laptop)'."
