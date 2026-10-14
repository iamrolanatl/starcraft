<!-- code: CRY-02-SOW | title: Statement of Work | subtitle: Defines the work to be performed on Crystal, the deliverables, the place and period of performance, standards, acceptance criteria and the change-control terms between the Product Owner and the delivery team. -->

## 1. Introduction

This Statement of Work (SOW) defines the work performed by the delivery team (Grok Bot engineering agents working on the shared build box under Rolan Chowdhury's direction) for the Crystal project. It derives from the Project Charter (01) and is decomposed in the WBS (11). There is no commercial contract: this SOW is an internal agreement that sets expectations and acceptance terms.

## 2. Parties and Roles

| Party | Role in this SOW |
|---|---|
| Rolan Chowdhury | Sponsor, Product Owner, acceptor of deliverables, sole operator of production database migrations and paid accounts |
| Delivery team (Grok Bot agents) | Design, code, test, document, build and deploy within delegated authority |
| Service providers (Cloudflare, Supabase, Google, Microsoft, GitHub, Apple) | Platforms the work depends on; no contractual obligations under this SOW |

## 3. Background and Objectives

See Charter §2–3. The work delivers a family command-center web application with automated, privacy-preserving data pipelines (especially the Cobb ParentVUE school pipeline for Eli, 7th grade, Dickerson Middle School), and prepares the platform for a second family.

## 4. Scope of Work

### 4.1 Work areas

| # | Work area | Description | WBS |
|---|---|---|---|
| SW-1 | Project management | Charter, planning, risk and issue management, documentation set | 1.1 |
| SW-2 | Platform foundation | Next.js app, Cloudflare Pages/Functions, Supabase auth and RLS, CI workflow, rate limiting, error capture | 1.2 |
| SW-3 | Experience layer | Cockpit HUD, window manager, skins, glass, robot mascot, voice, accessibility, PWA | 1.3 |
| SW-4 | Modules | Home, Health, Communications, Education, School Hub, Finance, Shopping/Wish, OCR, Rank & Medals | 1.4 |
| SW-5 | Data pipelines | ParentVUE/CTLS (laptop + box), data validation, Google/O365 ext sync, Gmail mail mirror and outbox, Apple Health ingest, Drive | 1.5 |
| SW-6 | AI services | Grounded chat, command parsing, Whisper transcription, escalation queue | 1.6 |
| SW-7 | Sharing, support, admin | Families/children/viewers/list sharing (017), support queue (018), admin command center (019) | 1.7 |
| SW-8 | Crystal Sync | Device pairing, keys, runs/logs, leader lease (020), Python agent, installers, downloads page | 1.8 |
| SW-9 | Quality | Unit, RLS, e2e, accessibility, performance and chaos test suites | 1.9 |
| SW-10 | Operations | Cron jobs, poller, alerts, runbooks, deploys | 1.10 |

### 4.2 Exclusions

As listed in Charter §4.2. In addition, the delivery team does not: apply production migrations, enter or store any parent password, purchase certificates or services, send email on Rolan's behalf without his Send press, or push to GitHub while authentication on the build box is unavailable.

## 5. Deliverables

| ID | Deliverable | Format / location | Acceptance criteria | Status |
|---|---|---|---|---|
| DL-01 | Crystal web app (production) | `https://crystal-7ot.pages.dev`, build `bmv7xg9th` (09:48:32Z = 5:48 AM ET Oct 14, 2026) | All Must FRs pass per 14 RTM; Lighthouse accessibility ≥ 95 | [[ok|Delivered]] |
| DL-02 | Staging environment | `staging.crystal-7ot.pages.dev` (branch `staging`) | Deploys from `staging`; noindex | [[ok|Delivered]] |
| DL-03 | Database migrations 001–020 | `supabase/migrations/*.sql` | Idempotent; RLS on all tables; local tests pass | [[partial|Delivered; 018–020 pending application]] |
| DL-04 | Pages Functions API | `functions/api/*` | Contracts in 07 §2; rate limits per NFR-030 | [[ok|Delivered]] |
| DL-05 | Box sync services | `sync/*.py`, cron | Runs logged; alerts raised | [[ok|Delivered]] |
| DL-06 | Laptop / macOS pull scripts | `laptop/`, `mac/` | 5:40 AM/PM; one login per run | [[ok|Delivered]] |
| DL-07 | Crystal Sync agent 0.1.0 | `agent/`; Linux AppImage + .deb in `public/downloads/` with `SHA256SUMS.txt` | Pair, run, upload, rotate, revoke; selftest | [[partial|Linux built; macOS/Windows unbuilt, unsigned]] |
| DL-08 | CI workflow | `.github/workflows/deploy.yml`, `crystal-sync.yml` | Typecheck, lint, tests, build, deploy | [[partial|Defined; secrets and GitHub auth pending]] |
| DL-09 | Test suites and reports | `scripts/test-*`, `supabase/tests`, `sync/tests`, `mac/tests`, `/workspace/e2e`, `docs/stability-report.md` | See 15 | [[ok|Delivered]] |
| DL-10 | Technical docs (in repo) | `docs/*.md`, `sync/README*.md`, `agent/README.md` | Current with code | [[ok|Delivered]] |
| DL-11 | Project documentation set | `docs/` (md + build) and PDFs | 20 documents + combined volume, consistent format | [[ok|This delivery]] |

## 6. Period and Place of Performance

| Item | Value |
|---|---|
| Period | Predecessor work from at least Oct 6, 2026; the Crystal repository history spans Oct 14, 2026 02:06–05:48 ET (102 commits). Ongoing work continues per 17 Roadmap. End date TBD. |
| Place | Shared Linux build box (`/workspace/crystal-*` git worktrees), Cloudflare and Supabase cloud services, and Rolan's home computers for ParentVUE pulls |

## 7. Standards and Methods

| Area | Standard / practice applied |
|---|---|
| Project management | PMBOK-aligned artifacts; hybrid delivery (10) |
| Requirements | IEEE 29148 attributes: ID, statement, rationale, priority, acceptance criteria, source, verification method |
| Architecture | C4 model views, architecture decision records (06 §9) |
| Code | TypeScript strict typecheck, ESLint (`eslint-config-next`), Title Case label lint (`scripts/title-case.mts`) |
| Database | Idempotent migrations (`create … if not exists`, `create or replace`), RLS by default, SECURITY DEFINER RPCs with `search_path = ''` |
| Accessibility | WCAG 2.2 AA target; axe-core checks; reduced-motion support |
| Security | Least privilege, hashed tokens, no service-role key at the edge, secret masking in logs |
| Privacy | Data minimization for the minor's records; family-only visibility |

## 8. Delivery Schedule

See 10 Project Plan §5 for the milestone list and the done-versus-planned view. Deliverable dates for open items are TBD and depend on Rolan's actions (migrations, certificates, GitHub auth, OAuth).

## 9. Acceptance Process

1. The delivery team marks a deliverable "ready for acceptance" with evidence (commit, test output, screenshot or URL).
2. Rolan reviews it in staging or production within a review window of TBD days.
3. Rolan records Accept / Accept with conditions / Reject in the table below. A rejection becomes an issue in 13.
4. Accepted deliverables are listed in 18 Release Notes.

| Deliverable | Decision | Conditions | Accepted by | Date |
|---|---|---|---|---|
| DL-01 … DL-11 | TBD | | Rolan Chowdhury | TBD |

## 10. Change Control

| Step | Rule |
|---|---|
| Request | Any party raises a change (scope, schedule, privacy posture, cost) in chat or as a backlog item |
| Impact analysis | The delivery team states the effect on FR/NFR, schema, security, schedule and cost |
| Decision | Rolan approves. Changes that touch privacy, sharing, external messaging or spending always need explicit approval |
| Record | The change is recorded in 18 Change Log and the affected documents are re-versioned |

## 11. Assumptions and Dependencies

As listed in Charter §8 (A-01…A-06, C-01…C-08, D-01…D-09).

## 12. Sign-off

| Role | Name | Signature | Date |
|---|---|---|---|
| Sponsor / Product Owner | Rolan Chowdhury | | TBD |
| Delivery Lead | Rolan Chowdhury for the Grok Bot delivery team | | TBD |
