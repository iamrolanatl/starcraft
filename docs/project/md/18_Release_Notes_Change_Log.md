<!-- code: CRY-18-REL | title: Release Notes and Change Log | subtitle: What shipped in each increment, the current production build, schema changes by migration, known issues, and the complete commit-level change log generated from git. -->

## 1. Versioning and Release Identification

| Item | Identifier | Source |
|---|---|---|
| Web application version | `0.1.0` (`package.json`) | Repository |
| Production build | `bmv7xg9th`, built 2026-10-14 05:48 ET (09:48:32Z) | `public/version.json` |
| Source of production build | Branch `sync-agent` at `588f344` (includes `main`) | Build output comparison |
| Crystal Sync agent | `0.1.0` (Linux AppImage and `.deb` with `SHA256SUMS.txt`; macOS and Windows TBD, PB-007) | `public/downloads` |
| Database schema | Migrations 001–017 applied; 018, 019, 020_family_invites_grant, 020_sync_devices pending (PB-001); 008 unused | `supabase/migrations`, 07 §9 |
| Git tags | None. Releases are identified by build ID and commit. Tagging convention TBD (proposal: `web-v0.1.0+bmv7xg9th`, `sync-v0.1.0`) | — |

The web app is deployed with each increment through `/workspace/deploy.sh` (SOP-01). The client polls `version.json` and shows "Crystal Updated — Tap to Reload" when a newer build is live (FR-125).

## 2. Release Notes by Increment

All times are ET on October 14, 2026. Increments are described in 10 §4.

### 2.1 S1 — Foundation (02:06–02:59)

- **New:** Landing page, sign-in and sign-up (Supabase Auth), cockpit HUD, Crystal assistant with the Workers AI model router, Home applets (`af3ad4e`).
- **New:** Education module with `edu_*` tables under RLS, box school sync, grade trends, work, messages and calendar (`9f622da`, migration 002).
- **New:** Health, Comms, Finance and Shopping CRUD; School Hub (bells, calendar, check-ins, handout upload); OCR; cross-module natural language (`3799989`, migration 004).
- **New:** Global per-IP rate limits through the `crystal-ratelimiter` Durable Object with `x-ratelimit` headers (`5a91bcb`, `b5619dc`).
- **New:** Laptop agent integration: commands, poller with alerts and run log, Sync button (`f1e3156`, migration 003).

### 2.2 S2 — Premium HUD and grounded assistant (03:00–03:46)

- **New:** Window manager (drag, resize, spring), bottom sheets, Cmd-K palette, keyboard shortcuts, toasts, skeletons, guided tour, DEFCON readiness (`69ef54f`).
- **New:** Grounded Crystal: school and task answers come only from the user's RLS-scoped data, with deterministic handlers for grades, classes, missing work and sync (`5d0625c`).
- **New:** v4: stability hardening, grounding for all modules, voice (Web Speech + Whisper), undoable deletes, gestures, code-splitting (`272c6dc`); CCSD 2026–27 calendar and PWA (`629cefd`).
- **New:** Chat escalation: hard questions go to the `crystal-escalations` queue and the box worker (Llama 3.3 70B), with the answer delivered to chat (`8f765bd`, migration 006).
- **Fixed:** Education grades show every current class (latest snapshot joined to Q1 finals) (`4ec45c7`).

### 2.3 S3 — Integrations (03:47–04:08)

- **New:** Data validation: pull gates, quarantine, non-destructive merge, immutable grades, audit counts, 30-day raw retention (`16a1197`, migration 007).
- **New:** External sync: Google Calendar/Tasks and Eli's O365 calendar in a unified To-Do/Calendar with source badges (`c9ca7ec`, migration 009). Live use waits on PB-011/PB-013.
- **New:** Apple Health step ingest with hashed token and Steps applet v2 (`2b6daaf`, migration 010). Shortcut setup waits on PB-012.
- **New:** Drive browse, search, preview and pin to School Hub (`ebf5a28`, migration 011). See I-008.
- **New:** School inbox: Gmail mirror, 5-minute reply outbox with atomic claim, auto-drafted teacher replies (`8733268`, migration 012).
- **New:** Report cards viewer (`cea159b`, migration 013); grading periods and countdowns (`1ea0677`); full-screen applets saved in preferences.

### 2.4 S4 — Education depth (04:09–04:35)

- **New:** Graded assignments per class with category weights, impact chart and what-if (`cb8f34e`).
- **New:** macOS port of the laptop school sync with Keychain secrets and launchd (`f76d474`).
- **New:** Schedule with live current class, attendance with excused/unexcused codes and DEFCON alerts, excuse letters (`7e61772`, `2c518e3`, migration 014).
- **New:** Learn tab with current unit per class and verified study links (`39a68be`, migration 015); Eli data removed from the public bundle (`650da76`).
- **New:** Stale-deploy recovery (`140416f`).
- **Fixed:** Raw bucket accepts PDF uploads (`74bff53`, migration 013 update).

### 2.5 S5 — Readability and kid-friendly UX (04:36–05:17)

- **Changed:** Dark translucent glass for every skin; Title Case labels with a label linter; shared tooltips; profile names from Google identity (`5401c8c`, `5f39d69`, migration 016).
- **New:** Hands-free voice loop with Whisper fallback for iPhone and Firefox (`6aa6c12`).
- **New:** Grading Rules tab citing the Cobb IHA-R rule (`5cd0ede`); grade colors with flashing below 74 and a reduced-motion alternative (`445a76f`).
- **Changed:** Mail drafts only for personal staff emails (`6865912`); Defaults v2 (`8e17281`); School Hub calendar redesign (`a051080`); shared ProgressBar (`b445cc2`).
- **New:** Family sharing: children, child logins, trusted adults, shared lists with code + 6-digit match + approval (`9aee962`, migration 017).

### 2.6 S6 — Robot, errors, admin (05:18–05:32)

- **New:** Robot buddy with poses and kid-safe teases (`340a472`).
- **New:** Styled error pages with "Talk to support" chat and support queue (`a01d548`, migration 018 — pending).
- **New:** Resizable applets and a fixed-height header (`55c1995`).
- **New:** Admin command center `/admin` for owners (`048024f`, migration 019 — pending).

### 2.7 S7 — Crystal Sync (05:33–05:48)

- **New:** Pairing codes, scoped device keys, sync runs/logs and upload RPC (`4eaa2ca`, migration 020_sync_devices — pending).
- **New:** Per-child status lights, SYNC NOW and live console, `/downloads` with pairing codes (`6ec692b`).
- **New:** Crystal Sync agent 0.1.0: setup wizard, keychain credentials, ParentVUE pull, masked logs, daemon and schedule (`21f38e6`).
- **New:** Leader lease per family and slot with 10-minute takeover; Sync Now routed to the primary device (`588f344`).
- **Fixed:** Family settings load children even when another section fails; `family_invites.child_id` grant gap (`852fb0c`, migration 020_family_invites_grant — pending).

## 3. Schema Change Log

| Migration | Increment | Change summary | Production |
|---|---|---|---|
| 001_tasks | S1 | Profiles and tasks with RLS | [[ok|Applied]] |
| 002_education | S1 | `edu_*` tables, RLS | [[ok|Applied]] |
| 003_laptop_agent | S1 | Sync requests, sync log, alerts, upload tickets | [[ok|Applied]] |
| 004_modules | S1 | Health, finance, shopping, comms, check-ins | [[ok|Applied]] |
| 005_user_prefs | S2 | User preferences | [[ok|Applied]] |
| 006_chat_escalations | S2 | Escalation table and realtime | [[ok|Applied]] |
| 007_data_validation | S3 | Last-good state, row tracking, immutable grades, current view | [[ok|Applied]] |
| 008 | — | Number not used | — |
| 009_external_sync | S3 | Google/O365 items, quarantine, tokens | [[ok|Applied]] |
| 010_health_ingest | S3 | Step tokens and ingest log | [[ok|Applied]] |
| 011_drive_pins | S3 | Drive pins | [[ok|Applied]] |
| 012_mail | S3 | Mail mirror, outbox, private bucket | [[ok|Applied]] |
| 013_report_cards | S3/S4 | Report cards, graded assignments, grade calc; PDF MIME on raw bucket | [[ok|Applied]] |
| 014_school_extras | S4 | Schedule, attendance periods, excuses | [[ok|Applied]] |
| 015_learn | S4 | Learn units, resources, history | [[ok|Applied]] |
| 016_profiles | S5 | Names from Google identity (`handle_new_user` replaced) | [[ok|Applied]] |
| 017_family | S5 | Families, children, viewers, list sharing | [[ok|Applied]] |
| 018_support | S6 | Support tickets and config | [[no|Pending]] |
| 019_admin | S6 | Admins, audit, rate, flags, `admin_*` RPCs, owner seed | [[no|Pending]] |
| 020_family_invites_grant | S7 | Column grant `family_invites.child_id` | [[no|Pending]] |
| 020_sync_devices | S7 | Devices, pairing, runs, logs, leases | [[no|Pending]] |

## 4. Known Issues in This Release

| ID | Summary | Workaround / plan |
|---|---|---|
| I-001 | GitHub authentication unavailable; work is not pushed; macOS/Windows installers cannot be built | PB-003 |
| I-002 | Migrations 018–020 not applied; support, admin and Crystal Sync are not functional in production | PB-001 (SOP-02) |
| I-004 | 2 live grounding tests fail because live data changed | PB-019 |
| I-007 | Missed-pull alert fires at 6:00 (20 min), longer than the NFR-021 15-minute target | PB-004 |
| I-008 | Drive routes use the service-role key at the edge | PB-010 |
| I-009 | Deploy scripts contain inline credentials | PB-009 |

The full list is in 13 §4.

## 5. Complete Change Log (generated)

Generated by `build/gen_changelog.py` from the repository history at `588f344`. Each row is one commit; the hash points to the full diff in git.

<!-- include: _changelog.md -->
