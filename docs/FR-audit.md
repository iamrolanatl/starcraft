# Crystal: Functional Requirements Audit
Audited and re-tested on Oct 14, 2026, around 3:30 AM ET, against https://crystal-7ot.pages.dev (production) and staging.crystal-7ot.pages.dev.
Evidence comes from automated browser e2e runs (`/workspace/e2e/e2e2.mjs`, puppeteer), API curl tests, `scripts/test-nlp.ts` (13/13) and `scripts/test-grounding.mts` (11/11 including live tests). Screenshots are in `shots/after/` (v3) and `shots/` (Phase 1 "before").

Status before this pass is shown as **Was**.

| # | FR | Was | Now | Evidence |
|---|----|-----|-----|----------|
| P1 | Hero with looping video | Done | **Done** | e2e: `video[loop]` with a src (randomized bg pool) |
| P2 | Features + sales pitch | Partial ("coming soon") | **Done** | Landing "Modules online" grid; e2e pass |
| P3 | Google OIDC sign-up | Partial | **Blocked (account)** | Button wired (`signInWithOAuth`). Supabase reports "provider is not enabled" until Rolan enables it |
| P4 | Email OTP sign-up/login | Done | **Done** | `#email` form → `signInWithOtp` / `verifyOtp` |
| P5 | AI sales chat | Done | **Done** | Workers AI `/api/chat` mode=sales; prompt updated with real modules |
| P6 | Terms/Privacy/Cookies/Accessibility/Do Not Sell | Done | **Done** | All 5 return 200 (e2e) |
| A1 | Log out + Home from anywhere | Done | **Done** | Header ⌂ and Log out, HUD ⌂/⏻, `H` key, palette |
| A2 | Applets minimize/close | Done (basic) | **Done** | Spring open, minimize, close animations; minimized tray in HUD; e2e |
| A3 | OCR | Missing | **Done** | Tesseract.js on-device; live e2e read "Field trip permission slip\nReturn signed by Friday" |
| A4 | Natural-language input | Partial (tasks only) | **Done** | Cross-module NL (health, meds, bills, stocks, credit, shopping/wish, comms, check-ins, tasks, open app); Cmd-K free text |
| A5 | Bottom edge-to-edge HUD (desktop+mobile) | Partial | **Done** | e2e mobile: left=0, right=viewport, bottom=viewport; swipeable panels |
| A6 | Pilot view | Missing | **Done** | `[aria-label="Pilot view"]` |
| A7 | 3x3 ability grid + cooldowns | Done | **Done** | 9 abilities, keys 1-9, cooldown overlay (e2e) |
| A8 | 360 + tactical radar | Partial (360 only) | **Done** | 360 radar blips = real tasks (distance = days to due, red = overdue) + sweep pulse; tactical radar by module sector |
| A9 | Squad status | Missing | **Done** | Per-module status from real data |
| A10 | Tactical + comm feeds | Partial | **Done** | Separate tactical feed (hostiles/meds/bills) and comm feed |
| A11 | Red Alert (DEFCON 1) | Done | **Done+** | Manual alert plus computed DEFCON 5→1 meter driving theme and ambient sound |
| A12 | Web Audio synth | Done | **Done+** | Hover/press/whoosh/palette SFX, DEFCON ambient hum, mute |
| A13 | Crystal robot (snow white, neon, big blue eyes, movement, AI) | Partial | **Done** | Idle look-around, antenna, hop on poke, speech bubbles, mood reactions; grounded AI |
| M1 | Home: priorities, weather, calendar, to-do | Done | **Done** | + holo globe |
| M2 | Health: steps, glucose, meds | Missing | **Done** | Supabase CRUD, gauges + sparklines, med "take" check-off. Auto-import **blocked** (Apple Health/Google Fit/Dexcom) |
| M3 | Comms: mail, email, drive | Missing | **Partial (account)** | Follow-up notes CRUD per channel + deep links. Inbox/Drive sync **blocked** on Gmail/Drive API consent |
| M4 | Education: ParentVUE, CTLS | Done (other worker) | **Done** | Laptop sync → edu_* tables |
| M5 | Education: StudentVUE, O365, Learn | Missing | **Partial (account)** | Portal links in School Hub; direct pulls need Eli's student credentials/SSO |
| M6 | Check-ins with handout upload | Missing | **Done** | `edu_checkins` + private `handouts` bucket (per-user folder RLS); demo upload e2e pass |
| M7 | School calendars | Missing | **Done** | CCSD 2026-27 dates in School Hub + edu calendar |
| M8 | Bell schedules (Dickerson MS) | Missing | **Done** | Master/Flex/Early-release for grades 6-8, live period highlight |
| M9 | Finance: bills | Missing | **Done** | CRUD, overdue radar, budget gauge |
| M10 | Finance: credit monitoring | Missing | **Partial (account)** | Manual score log + gauge/trend. Bureau monitoring **blocked** (Plaid/Array) |
| M11 | Finance: stocks | Missing | **Done** | `/api/quote` edge proxy (live AAPL/MSFT quotes verified) |
| M12 | Shopping list + wish list | Missing | **Done** | CRUD, wish→cart, estimates |
| AI1 | Workers AI only (POC) | Done | **Done** | Llama 3.x on Workers AI; Grok stub unused |
| AI2 | No hallucinated personal data | **Bug** | **Done** | Grounded: user JWT → RLS queries; deterministic grade/class/missing/sync answers; DATA-only prompt; tests |
| T1 | Theme: cockpit, nebula, glass, neon, sparks, palette | Partial | **Done** | Layered glass, animated neon frames, particles, sparks, warp, DEFCON/night themes |
| H1 | Rate limits | Missing | **Done** | Durable Object limiter per route+IP (429 after 20/min on /api/chat, verified) |
| H2 | Error tracking | Missing | **Done** | Client errors → `/api/log` → Workers logs; server errors caught in middleware |
| H3 | Staging | Missing | **Done** | staging.crystal-7ot.pages.dev |
| H4 | CI deploy from GitHub | Missing | **Partial (account)** | `.github/workflows/deploy.yml` runs typecheck, lint, tests and build; deploy needs repo secrets |
| D1 | User data only in Supabase | Bug (local fallback) | **Done** | localStorage only in demo (seeded fake data) + UI prefs; signed-in users get sign-in/migration errors |

## Migrations Rolan must run (Supabase SQL editor)
- `supabase/migrations/004_modules.sql`: health_logs, meds, bills, credit_scores, stocks, shop_items, comms_notes, edu_checkins (RLS owner-only) + private `handouts` storage bucket and policies.

## Blocked on Rolan's accounts
Google OAuth provider (Supabase + Google Cloud), Gmail/Drive API consent, Plaid or credit-bureau provider, Apple Health/Google Fit/Dexcom, StudentVUE/O365 student credentials, and GitHub Actions secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
