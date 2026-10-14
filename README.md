# Crystal — Phase 1 (proof of concept)

Personal productivity cockpit. Next.js 15 (static export) on **Cloudflare Pages**, API in **Pages Functions** (`functions/api/*`), AI via **Workers AI** (`functions/_lib/router.ts`, Grok fallback stubbed), auth + Postgres via **Supabase** with RLS.

- `src/contracts/api.ts` — typed request/response contracts (Connect-RPC-ready shapes)
- `supabase/migrations/001_tasks.sql` — `profiles` + `tasks` with row-level security
- `scripts/gen_nebula.py` — generates the original looping nebula background video

## Develop
```
cp .env.example .env.local   # add anon key
npm i && npm run dev
```
## Deploy (needs Node 22 for wrangler)
```
NEXT_PUBLIC_SUPABASE_ANON_KEY=... npm run build
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npx wrangler pages deploy out --project-name crystal --branch main
```
`/app/?demo=1` opens the cockpit without signing in (tasks stored on-device).
