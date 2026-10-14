<!-- code: CRY-05-NFR | title: Non-Functional Requirements | subtitle: Specifies Crystal's quality attributes as NFR-xxx requirements (security, privacy, performance, availability and reliability, accessibility per WCAG 2.2, usability and mobile, maintainability, operability, compliance) with measurable acceptance criteria and current compliance. -->

## 1. Introduction

Quality attributes are organized by the ISO/IEC 25010 product quality model. Each NFR is measurable, has an acceptance criterion and a verification method (T = test, I = inspection, A = analysis, D = demonstration), and shows its compliance at baseline `588f344`. Evidence references point to 15 Test Plan.

## 2. Security (NFR-001 – NFR-015)

| ID | Requirement | Pri | Acceptance criteria | Verif. | Compliance |
|---|---|---|---|---|---|
| NFR-001 | Row Level Security shall be enabled on every table in the `public` schema that holds user or family data, with deny-by-default | M | Every `create table` in 001–020 is followed by `enable row level security` (direct or via loop); anon reads denied | I, T | [[ok|Met]] (RLS suites; admin reports 64 tables) |
| NFR-002 | No Cloudflare component shall hold a Supabase service-role key; edge code uses the anon key plus the caller's JWT or SECURITY DEFINER RPCs | M | No service-role variable in `functions/` except as noted | I | [[partial|Met except Drive]]: `functions/_lib/google.ts` (Drive browse/preview) reads the Google refresh token through the service-role-only RPC `svc_google_token` and so needs `SUPABASE_SERVICE_ROLE_KEY` in Pages. Whether that variable is configured in production is TBD. All other routes use only `SUPABASE_ANON_KEY` / `SUPABASE_URL`, `SUPPORT_KEY`, `ADMIN_EMAILS`, `GROK_API_KEY` |
| NFR-003 | The service-role key shall exist only on the box in `~/.config/crystal/sync.env` (mode 600) as `CRYSTAL_SUPABASE_SERVICE_ROLE_KEY` | M | File permissions 600; never printed | I | [[ok|Met]] (per `sync/README.md`) |
| NFR-004 | Every SECURITY DEFINER function shall set `search_path = ''` and validate the caller (auth.uid, family membership, admin_guard or device key) | M | Code review of 017–020 | I | [[ok|Met]] (sampled) |
| NFR-005 | Tokens and keys (health ingest `hst_`, device `csd_`, support key, pairing codes) shall be stored only as SHA-256 hashes | M | No plaintext token columns | I, T | [[ok|Met]] |
| NFR-006 | Parent portal passwords shall never be transmitted to Crystal and shall be stored only in the OS credential store | M | No password field in any API or table | I | [[ok|Met]] |
| NFR-007 | Every `/api/*` route shall be rate-limited per IP: chat 20/min, command 40/min, quote 60/min, log 30/min, transcribe 15/min, support 12/min, health/steps 60/min, sync/pair 10/10 min, sync/upload 20/h, sync/poll 90/min, sync/claim 30/min, sync/log 120/min, admin 90/min | M | 429 with `retry-after` beyond the limit | T | [[ok|Met]] (H1: 429 after 20/min on chat) |
| NFR-008 | POST bodies shall be capped (64 KB default; ~4.2 MB transcribe and sync upload) | M | 413 beyond the cap | T | [[ok|Met]] |
| NFR-009 | Responses shall carry security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/geolocation/microphone self), HSTS 1 year with subdomains | M | Headers present on all responses | T | [[ok|Met]] |
| NFR-010 | Admin access shall need two gates: verified JWT email in `ADMIN_EMAILS` at the edge and `admin_guard()` (email in `public.admins`) in the database | M | Non-admin JWT → 403; anon → 403 | T | [[partial|Built; 019 pending]] (live: anon → `forbidden`) |
| NFR-011 | Destructive admin actions shall require typed confirmation and be written to `admin_audit` | M | 019 tests | T | [[partial|Pending 019]] |
| NFR-012 | Logs shall never contain secrets: device-side masking of known secrets, `password=`, long tokens; server-side `sync_mask` | M | Test: password masked in stored log | T | [[partial|Pending 020]] |
| NFR-013 | Report-card and mail files shall be in private buckets, served only via short-lived signed URLs (5 minutes) or owner-folder policies | M | Unsigned access denied | I, T | [[ok|Met]] |
| NFR-014 | Drive previews shall be served with `content-security-policy: sandbox`, `nosniff` and `private, no-store` | S | Headers present | I | [[ok|Met]] |
| NFR-015 | Device keys shall be revocable and rotatable with immediate effect | M | Revoked/rotated key → 28000 | T | [[partial|Pending 020]] |

## 3. Privacy (NFR-016 – NFR-019)

| ID | Requirement | Pri | Acceptance criteria | Verif. | Compliance |
|---|---|---|---|---|---|
| NFR-016 | Family data shall be visible only to the owner, ACTIVE family members and scoped viewers | M | Other users see 0 rows (017 and 020 RLS tests) | T | [[ok|Met locally]]; production after 017/020 |
| NFR-017 | The public JavaScript bundle shall contain no student data | M | Bundle inspection | I | [[ok|Met]] (`650da76`) |
| NFR-018 | Audio sent for transcription shall be processed in memory and never stored or logged | M | Code inspection of `transcribe.ts` | I | [[ok|Met]] |
| NFR-019 | Data minimization for the minor: only data needed for the family's purposes is kept; retention periods are defined | S | Retention schedule documented | I | [[partial|Raw pulls 30 days; others TBD]] |

## 4. Performance (NFR-020 – NFR-026)

| ID | Requirement | Pri | Acceptance criteria | Verif. | Compliance |
|---|---|---|---|---|---|
| NFR-020 | A scheduled school sync shall land in Crystal within 5 minutes of the pull starting | M | `finished_at − started_at ≤ 5 min` (Crystal Sync); laptop hand-off to `edu_sync_runs` done ≤ 5 min (poller every minute) | A, T | [[partial|Designed to meet; measurement TBD]] |
| NFR-021 | A failed or missed sync shall be alerted to Rolan within 15 minutes | M | Failure: alert on next poller minute. Missed pull: alert by 6:00 for a 5:40 slot | A, T | [[partial|Failures met; missed-pull check fires at 6:00 = 20 min after 5:40 — gap]] |
| NFR-022 | Calendar sync shall run every 15 minutes; school mail pull and outbox every 5 minutes | M | cron `*/15` for ext sync; routine every 5 min | I | [[ok|Met]] |
| NFR-023 | Chat answers shall return within 20 s per model attempt; Whisper within 25 s | S | Router and transcribe timeouts | I | [[ok|Met]] |
| NFR-024 | Lighthouse mobile performance on `/app/?demo=1` shall be ≥ 80; landing ≥ 90 | S | Lighthouse runs | T | [[partial|Landing 93; app 96/81/82 on staging after progressive mount]] |
| NFR-025 | The command bar shall be usable within 6 s on slow 3G | S | Chaos suite | T | [[ok|Met]] (5.2 s) |
| NFR-026 | Memory shall be stable in long sessions | S | 10 min, 1,620 applet opens: heap 8.3 → 8.3 MB | T | [[ok|Met]] |

## 5. Availability and Reliability (NFR-027 – NFR-036)

| ID | Requirement | Pri | Acceptance criteria | Verif. | Compliance |
|---|---|---|---|---|---|
| NFR-027 | Sync agents shall survive reboots: cron `@reboot` for the box poller and escalation worker; systemd `Persistent=true` timer; LaunchAgent KeepAlive; Task Scheduler at log-on | M | After reboot the next slot runs | D | [[ok|Met]] (configured) |
| NFR-028 | A missed slot (computer asleep) shall be caught up within 6 hours | S | Daemon catch-up logic | T | [[ok|Met]] (agent) |
| NFR-029 | Overlapping runs shall be prevented (lock file; single-instance poller lock) | M | Second run exits | T | [[ok|Met]] |
| NFR-030 | Every sync run shall be logged (100%) with status and counts | M | `edu_sync_runs` / `sync_runs` row for each run | T | [[ok|Met]] |
| NFR-031 | A bad pull shall never erase good data (gates, quarantine, non-destructive merge) | M | Merge and validation tests | T | [[ok|Met]] |
| NFR-032 | Stuck jobs shall be swept: running > 20 min, processing > 40 min → failed | S | Poller sweep | T | [[ok|Met]] |
| NFR-033 | Features whose migration is not applied shall degrade gracefully with a clear message (e.g., "Crystal Sync is not enabled yet (migration 020 pending)") | M | 503 with pending message | T | [[ok|Met]] (live API) |
| NFR-034 | Every applet, the HUD and overlays shall be wrapped in error boundaries with retry; malformed localStorage shall not crash boot | M | Chaos suite | T | [[ok|Met]] |
| NFR-035 | Network calls shall time out with exponential back-off and friendly 429 handling | S | Chaos suite (429 toast "17s") | T | [[ok|Met]] |
| NFR-036 | Target service availability for the web app follows Cloudflare Pages; recovery objectives RTO TBD, RPO TBD | S | Agreed objectives | A | [[partial|TBD]] |

## 6. Accessibility (NFR-037 – NFR-043), target WCAG 2.2 AA

| ID | Requirement | Pri | Acceptance criteria | Verif. | Compliance |
|---|---|---|---|---|---|
| NFR-037 | Text and UI contrast shall meet WCAG AA (1.4.3, 1.4.11) in all modules and glass clarities | M | axe color-contrast 0 violations per module × 3 clarities | T | [[ok|Met]] (24/24) |
| NFR-038 | All functionality shall be operable by keyboard (2.1.1) with visible focus | M | keys suite 40/40 | T | [[ok|Met]] |
| NFR-039 | Icon-only buttons shall have accessible names (4.1.2) | M | Every icon-only button has `aria-label` | T | [[partial|Last UI audit flagged gaps at 360 px; fixes followed — re-run TBD]] |
| NFR-040 | Motion shall respect `prefers-reduced-motion` and in-app motion settings (2.3.3); flashing grade alert shall be ~1 Hz (below the 3-flashes-per-second threshold, 2.3.1) and replaced by outline + icon under reduced motion | M | Reduced-motion audit | T, I | [[ok|Met]] |
| NFR-041 | Touch targets shall be ≥ 44 px on mobile (2.5.8 exceeds AA minimum 24 px) | S | Chaos suite device emulation | T | [[ok|Met]] |
| NFR-042 | Text size S–XL, high contrast and reading mode shall be available | S | Settings | D | [[ok|Met]] |
| NFR-043 | Lighthouse accessibility ≥ 95 | S | Lighthouse | T | [[ok|Met]] (96–100) |

## 7. Usability and Mobile (NFR-044 – NFR-050)

| ID | Requirement | Pri | Acceptance criteria | Verif. | Compliance |
|---|---|---|---|---|---|
| NFR-044 | No horizontal scroll, overflow or mid-word breaks at 320, 360, 390, 768, 1280, 1920 px | M | UI audit passes | T | [[partial|Chaos suite passes at 4 devices; last UI audit (04:45) failed — re-run after mobile redesign TBD]] |
| NFR-045 | Phone readability: body text legible without zoom on 390 px screens | M | Mobile readability pass | T, D | [[partial|In progress (branch `mobile`)]] |
| NFR-046 | Visible button/tab labels shall be Title Case or UPPERCASE consistently (label lint) | S | `npm run lint:labels` passes | T | [[partial|Lint exists; UI audit pending re-run]] |
| NFR-047 | Copy shall be plain language; kid-friendly messages for the student; no abbreviations in module tabs | S | Review | I | [[ok|Met]] (`976ea27`) |
| NFR-048 | Applet title bars stay pinned and only the body scrolls; module tabs are sticky and never overlap the first row | S | chrome suite 36/36 | T | [[ok|Met]] |
| NFR-049 | Hands-free voice shall work on Chromium desktop/Android and iOS Safari | S | Real-device spot check on iPhone | D | [[partial|Chromium emulation only; real iPhone check TBD]] |
| NFR-050 | Installers shall be easy for a non-technical parent (signed, no security warnings) | S | Signed + notarized builds | D | [[no|Open (unsigned)]] |

## 8. Maintainability, Portability, Operability (NFR-051 – NFR-058)

| ID | Requirement | Pri | Acceptance criteria | Verif. | Compliance |
|---|---|---|---|---|---|
| NFR-051 | Migrations shall be idempotent (safe to re-run) | M | Tests apply 017 and 020 twice | T | [[ok|Met]] |
| NFR-052 | CI shall typecheck (app + functions), lint, run NL and grounding tests and build on every push/PR | M | `deploy.yml` steps | I | [[partial|Defined; secrets/auth pending]] |
| NFR-053 | Typed API contracts shall be shared between client and functions (`src/contracts/api.ts`) | S | Typecheck passes | I | [[ok|Met]] |
| NFR-054 | The agent shall run on Linux, macOS and Windows (Python 3.12 + PyInstaller) | M | Builds per OS | T | [[partial|Linux built]] |
| NFR-055 | Releases shall publish SHA-256 checksums | S | `SHA256SUMS.txt` | I | [[ok|Met]] |
| NFR-056 | Operations shall have documented runbooks | M | 09 Runbook | I | [[ok|Met]] (this set) |
| NFR-057 | Server errors shall be captured with Cloudflare ray ID; client errors beaconed | S | Workers logs | I | [[ok|Met]] |
| NFR-058 | Staging shall mirror production (branch `staging`) | S | Staging deploys | D | [[ok|Met]] |

## 9. Compliance (NFR-059 – NFR-061)

| ID | Requirement | Pri | Acceptance criteria | Verif. | Compliance |
|---|---|---|---|---|---|
| NFR-059 | Handling of the minor's education data shall follow FERPA-derived sensitivity and COPPA considerations: parent-controlled child accounts, no third-party sharing beyond processors (Cloudflare, Supabase, Google), no advertising | M | Privacy review | I | [[partial|Design meets; formal legal review TBD]] |
| NFR-060 | Legal pages (Terms, Privacy, Cookies, Accessibility, Do Not Sell) shall be published | M | 200 on each | T | [[ok|Met]] |
| NFR-061 | Third-party assets shall be credited and original art used for skins | S | `CREDITS.md` | I | [[ok|Met]] |

## 10. Gaps Summary

| NFR | Gap | Action |
|---|---|---|
| NFR-021 | Missed-pull alert fires at 6:00 (20 minutes after a 5:40 slot), not 15 | Move the check to 5:55 (and 17:55) or alert on lease/slot timeout in 020 |
| NFR-020 | No measured evidence over a window | Collect 4 weeks of `sync_runs` timing |
| NFR-036 | RTO/RPO not agreed | Decide with Rolan; see 09 SOP-09 |
| NFR-002 | Drive routes need a service-role key at the edge | Move Drive token access to a scoped SECURITY DEFINER RPC callable with the owner's JWT, then remove `SUPABASE_SERVICE_ROLE_KEY` from Pages |
| NFR-039, 044, 046 | UI audit not re-run after fixes | Re-run `e2e/ui.mjs` after the mobile redesign |
| NFR-050, 054 | Unsigned, macOS/Windows not built | Restore GitHub auth; buy certificates |

## 11. Approval

| Role | Name | Signature | Date |
|---|---|---|---|
| Product Owner | Rolan Chowdhury | | TBD |
