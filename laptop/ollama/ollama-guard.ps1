# Crystal Ollama guard: a tiny local proxy so the tunnel never exposes Ollama openly.
# Listens on 127.0.0.1:11435, requires header X-Crystal-Key = the secret in ollama-secret.txt,
# and only forwards POST /api/chat and GET /api/tags to Ollama on 127.0.0.1:11434. Everything else gets 403/404.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$secret = (Get-Content (Join-Path $here "ollama-secret.txt") -Raw).Trim()
if ($secret.Length -lt 32) { throw "ollama-secret.txt must hold a long random secret (run setup-ollama.ps1)" }
$log = Join-Path $here "ollama-guard.log"
$l = [System.Net.HttpListener]::new(); $l.Prefixes.Add("http://127.0.0.1:11435/"); $l.Start()
function Log($m) { Add-Content $log ("{0:s} {1}" -f (Get-Date), $m) }
function SameKey([string]$a, [string]$b) { if ($null -eq $a -or $a.Length -ne $b.Length) { return $false }; $d = 0; for ($i = 0; $i -lt $a.Length; $i++) { $d = $d -bor ([int][char]$a[$i] -bxor [int][char]$b[$i]) }; return $d -eq 0 }
Log "guard started"
$http = [System.Net.Http.HttpClient]::new(); $http.Timeout = [TimeSpan]::FromMinutes(3)
while ($l.IsListening) {
  $ctx = $l.GetContext(); $req = $ctx.Request; $res = $ctx.Response
  try {
    $path = $req.Url.AbsolutePath
    if (-not (SameKey $req.Headers["X-Crystal-Key"] $secret)) { $res.StatusCode = 403; Log "403 $($req.HttpMethod) $path"; continue }
    $ok = ($req.HttpMethod -eq "POST" -and $path -eq "/api/chat") -or ($req.HttpMethod -eq "GET" -and $path -eq "/api/tags")
    if (-not $ok) { $res.StatusCode = 404; continue }
    $msg = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($req.HttpMethod), "http://127.0.0.1:11434$path")
    if ($req.HasEntityBody) { $sr = [IO.StreamReader]::new($req.InputStream); $msg.Content = [System.Net.Http.StringContent]::new($sr.ReadToEnd(), [Text.Encoding]::UTF8, "application/json") }
    $r = $http.SendAsync($msg).GetAwaiter().GetResult(); $bytes = $r.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $res.StatusCode = [int]$r.StatusCode; $res.ContentType = "application/json"; $res.OutputStream.Write($bytes, 0, $bytes.Length)
    Log "$($res.StatusCode) $($req.HttpMethod) $path"
  } catch { $res.StatusCode = 502; Log "error $($_.Exception.Message)" } finally { $res.Close() }
}
