# Crystal Tutor on Ollama (Rolan-Laptop)

Kids talk to **Education › Tutor**. Crystal's server calls Ollama on this laptop through a Cloudflare Tunnel.
If the laptop is off or asleep, Crystal waits about 12 seconds, then answers with Cloudflare's Llama instead,
and each reply says which model answered. Later, Grok is just `CHAT_PROVIDER=grok` plus an `XAI_API_KEY` secret.

## Security
- Ollama stays bound to `127.0.0.1` (never `0.0.0.0`). Nothing on your router is opened.
- The tunnel points at `ollama-guard.ps1` (port 11435), not at Ollama. The guard rejects any request without the
  `X-Crystal-Key` secret and only allows chat and model-list calls (no pulling or deleting models).
- The secret lives in `ollama-secret.txt` (readable only by your Windows user) and in Cloudflare Pages as an encrypted secret. It's never printed.
- Optional extra layer: a Cloudflare Access application on the hostname with a **service token**; set
  `OLLAMA_ACCESS_CLIENT_ID` / `OLLAMA_ACCESS_CLIENT_SECRET` as Pages secrets and Crystal sends them automatically.

## Needs
- A domain on your Cloudflare account for a stable hostname (e.g. `tutor.yourdomain.com`). `pages.dev` can't be used for tunnels.
- About 6 GB of free disk and 8 GB+ RAM. A GPU helps but isn't required.

## Steps
1. Copy this `ollama` folder to `C:\Users\iamro\CrystalOllama`.
2. PowerShell: `cd C:\Users\iamro\CrystalOllama` then `powershell -ExecutionPolicy Bypass -File .\setup-ollama.ps1 -Hostname tutor.yourdomain.com`
   (installs Ollama + cloudflared, pulls llama3.1:8b, makes the secret, creates the tunnel, auto-starts at login, self-tests).
3. `npx wrangler login` (once), then `.\set-crystal-secret.ps1 -Hostname tutor.yourdomain.com`.
4. Open Crystal › Education › Tutor and ask a question. It should say **Answered by Ollama (laptop)**.
5. Keep the laptop plugged in with sleep set to Never while the kids use it.

Check it any time: `.\test-ollama.ps1 -Hostname tutor.yourdomain.com`. Logs: `ollama-guard.log` (no secrets in it).
Turn it off: disable the two "Crystal Ollama" scheduled tasks. Crystal falls back to Cloudflare automatically.
