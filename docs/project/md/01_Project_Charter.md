<!-- code: CRY-01-CHR | title: Project Charter | subtitle: Formally authorizes the Crystal project, states its purpose, objectives, scope, high-level requirements, milestones, budget, risks, assumptions, constraints and the authority of the project manager. -->

## 1. Project Identification

| Field | Value |
|---|---|
| Project name | Crystal: Family Command Center |
| Project code | CRY |
| Product URL | `https://crystal-7ot.pages.dev` (production), `https://staging.crystal-7ot.pages.dev` (staging) |
| Repository | `iamrolanatl/starcraft` (private, GitHub). Baseline commit `588f344` on branch `sync-agent` |
| Project Sponsor | Rolan Chowdhury |
| Product Owner | Rolan Chowdhury |
| Project Manager / Delivery Lead | Rolan Chowdhury, with delivery executed by Grok Bot engineering agents under his direction |
| Charter date | October 14, 2026 |
| Delivery approach | Hybrid: Waterfall phase gates for governance and data-sensitive platform work; Agile (short, feature-sized sprints) for user-facing modules |

## 2. Purpose and Business Case

### 2.1 Problem statement

A busy parent has to monitor a middle-school student across several disconnected systems: Cobb County School District's ParentVUE gradebook and attendance, CTLS Learn, school email, the district calendar, a personal Google Calendar and Tasks, plus household health, finance and shopping notes. Each system has its own login, its own notification habits and its own data format. Important signals (a missing assignment, an unexcused absence, a grade dipping under 74, a teacher email that needs a reply) are easy to miss, and nothing combines them into one prioritized view.

### 2.2 Purpose

Crystal gives the family one secure, attractive, voice-capable command center that:

1. brings school, calendar, communications, health, finance and shopping data into one place;
2. keeps that data current automatically, twice daily for school data, with failures surfaced quickly;
3. answers questions only from the family's own data (grounded AI, no invented grades);
4. keeps data visible only to the family, with special care for a minor's education records;
5. can be extended to a second family through a least-privilege desktop sync agent.

### 2.3 Business case summary

| Benefit | Mechanism | Measure (see 03 BRD) |
|---|---|---|
| Fewer missed school issues | DEFCON school alerts (new absence, missing work, low score, dip below 90), Missing / Due soon tiles | BO-06 |
| Timely information | ParentVUE pull 5:40 AM/PM, Google Calendar every 15 min, school mail every 5 min | BO-02 |
| Parent time saved on email | Gmail school-mail mirror and Crystal-drafted teacher replies that Rolan reviews and sends | BO-05 |
| Trust and privacy | Row Level Security on every table, least-privilege device keys, owner-only admin | BO-04 |
| Low running cost | Cloudflare Pages + Workers AI and Supabase, no dedicated servers | BO-08 |

## 3. Objectives

The SMART business objectives are defined in 03 BRD §4. In summary:

| ID | Objective | Target |
|---|---|---|
| BO-01 | One family command center | 7 modules plus admin live in production by Oct 14, 2026 |
| BO-02 | Timely school data | Data lands within 5 min of each 5:40 AM/PM pull on ≥ 95% of school-day slots |
| BO-03 | Fail loudly | Every failed or missed sync alerted to Rolan within 15 min |
| BO-04 | Family-only data | 0 cross-family data exposures; RLS on 100% of exposed tables, verified by automated tests |
| BO-05 | Parent email effort | School mail mirrored within 5 min; 0 emails sent without Rolan pressing Send |
| BO-06 | Student outcome support | Missing-work and grade-risk visibility; outcome target TBD |
| BO-07 | Second-family readiness | Second family onboarded through Crystal Sync; date TBD |
| BO-08 | Low cost | Recurring cost within a ceiling of TBD per month |
| BO-09 | Resilience and auditability | Sync survives reboots; 100% of sync runs logged |

## 4. Scope

### 4.1 In scope

| Area | Summary |
|---|---|
| Web application | Next.js 15 static export served by Cloudflare Pages; cockpit HUD window manager, applets, skins, robot mascot, hands-free voice, PWA |
| Modules | Home, Health, Communications, Education (12 tabs), School Hub, Finance, Shopping / Wish Lists, OCR Scanner, Rank & Medals |
| AI | Grounded chat and command parsing on Workers AI (Llama 3.x 8B), Whisper speech-to-text, escalation of hard questions to a 70B model on the box |
| Data pipelines | ParentVUE / CTLS (laptop pull and box ingest, then Crystal Sync agent), Google Calendar / Tasks, Eli's Office 365 calendar (ICS), Gmail school mail, Apple Health steps, Google Drive |
| Sharing | Families, children, child logins, trusted-adult viewers, shared shopping and wish lists (migration 017) |
| Support and admin | Styled error pages with support chat and ticket queue (018); owner-only `/admin` command center with audit log (019) |
| Crystal Sync | Cross-platform agent with pairing codes, device keys, leader lease, Sync Now console (020) |
| Documentation | This documentation set |

### 4.2 Out of scope (this release)

- Bank, credit bureau, Plaid or brokerage account aggregation (manual entry only).
- Direct StudentVUE or Office 365 student logins with Eli's credentials (portal links only).
- Automatic sending of any email without Rolan's explicit Send press.
- Native iOS or Android apps (Crystal is a PWA).
- Public, multi-tenant commercial launch (Crystal is a family product; the landing page describes a free proof of concept).
- Code-signed macOS and Windows installers until certificates are purchased (see R-004).

## 5. High-Level Requirements

1. Users sign in with an email one-time code (Google sign-in when the provider is enabled).
2. Every row of family data is protected by Row Level Security tied to the signed-in user or family membership.
3. School data for each child is pulled from ParentVUE at 5:40 AM and 5:40 PM local time, using one login per run, with the parent password stored only on the parent's computer.
4. Sync results land in Crystal within 5 minutes; failures are alerted within 15 minutes; every run is logged.
5. Crystal's AI answers personal questions only from the user's data and says "I don't know" otherwise.
6. Draft emails are never sent without Rolan pressing Send; school emails go out only between 7 AM and 7 PM.
7. The owner can administer users, families, data and devices from `/admin` with typed confirmations and an audit trail.

## 6. Summary Milestone Schedule

| ID | Milestone | Evidence | Date | Status |
|---|---|---|---|---|
| M-00 | Predecessor "EliDash" dashboard and laptop pull in use | `/workspace/eli-dashboard` backups dated 2026-10-06 | Oct 6, 2026 (earliest evidence) | [[ok|Done]] |
| M-01 | Phase 1 proof of concept live (landing, auth, cockpit, Workers AI) | commit `af3ad4e` 02:06 | Oct 14, 2026 | [[ok|Done]] |
| M-02 | Education module + school sync | `9f622da`, `f1e3156` | Oct 14, 2026 | [[ok|Done]] |
| M-03 | All modules functional (FR build + audit) | `3799989`, `9b6f472` | Oct 14, 2026 | [[ok|Done]] |
| M-04 | v4 stability, voice, district calendar, PWA | `272c6dc`, `629cefd` | Oct 14, 2026 | [[ok|Done]] |
| M-05 | Integrations: data validation, ext sync, health, drive, mail | `16a1197` … `8733268` | Oct 14, 2026 | [[ok|Done]] |
| M-06 | Education depth (report cards, graded assignments, schedule, attendance, Learn, Grading Rules) | `cea159b` … `5cd0ede` | Oct 14, 2026 | [[ok|Done]] |
| M-07 | Family sharing (017) | `9aee962` | Oct 14, 2026 | [[ok|Done]] |
| M-08 | Error pages + support queue (018), admin (019) | `a01d548`, `048024f` | Oct 14, 2026 | [[partial|Built; migrations pending]] |
| M-09 | Crystal Sync 0.1.0 with leader lease (020) | `4eaa2ca`, `21f38e6`, `588f344` | Oct 14, 2026 | [[partial|Built; migration pending; Linux only]] |
| M-10 | Signed Mac/Windows installers | — | TBD | [[no|Open]] |
| M-11 | Mobile readability redesign | branch `mobile` (`717441b`) | TBD | [[partial|In progress]] |
| M-12 | Second family onboarded | — | TBD | [[no|Open]] |

## 7. Summary Budget

| Item | Basis | Amount |
|---|---|---|
| Cloudflare Pages, Pages Functions, Workers AI, Durable Objects, Queues | Account plan in use | TBD (plan tier not recorded in sources) |
| Supabase project `ogrrjkxkccbywbiikcak` | Plan in use | TBD |
| Apple Developer Program (macOS signing and notarization) | Quoted in `agent/README.md` | ~$99 per year (not yet purchased) |
| Windows OV/EV code-signing certificate | Quoted in `agent/README.md` | ~$100–300 per year (not yet purchased) |
| Labor | Owner time plus AI engineering agents | Not tracked |
| Budget ceiling | — | TBD |

## 8. Assumptions, Constraints and Dependencies

### 8.1 Assumptions

| ID | Assumption | Impact if false |
|---|---|---|
| A-01 | Cobb's ParentVUE SOAP endpoint (`PXPCommunication.asmx`) keeps its current method set and XML shape | Parser (`parse.py` / `pv_parse.py`) must change; pulls quarantine |
| A-02 | A family computer on a home network is on at 5:40 AM/PM (or within 6 hours for catch-up) | Missed pull alert; data stale until next slot |
| A-03 | Rolan runs pending migrations in the Supabase SQL editor | Features degrade gracefully ("migration pending" messages) |
| A-04 | Workers AI model catalog keeps an 8B Llama model and Whisper available | Router falls through its model list; then a friendly fallback message |
| A-05 | Family members have email addresses for one-time-code sign-in | Child logins need an alternative (TBD) |
| A-06 | The family accepts unsigned installers (right-click Open / SmartScreen "Run anyway") until certificates are bought | Second-family onboarding slows |

### 8.2 Constraints

| ID | Constraint | Source |
|---|---|---|
| C-01 | Cobb blocks cloud/datacenter IPs: the ParentVUE pull must run on a home network | `sync/README.md` |
| C-02 | One ParentVUE login per run per account; no retries | `agent/README.md`, `laptop/` scripts |
| C-03 | Parent passwords must never leave the parent's computer (DPAPI / Keychain / OS keyring) | `agent/README.md` |
| C-04 | No service-role key in Cloudflare; Pages Functions use the anon key plus SECURITY DEFINER RPCs or the caller's JWT (current exception: Drive routes, see 05 NFR-002) | 010, 018, 019, 020 headers; `functions/_lib/google.ts` |
| C-05 | Emails are drafted only; sending requires Rolan's Send press; school emails 7 AM–7 PM | Owner requirement; `sync/README-mail.md` |
| C-06 | Eli is a minor: education records are sensitive (FERPA-derived data, COPPA considerations for any child account) | Owner requirement |
| C-07 | Static export (no server-side rendering): all dynamic behavior is client-side or in Pages Functions | `next.config.ts`, `wrangler.toml` |
| C-08 | GitHub authentication on the build box is currently lost: no pushes, no GitHub Actions builds of installers | Owner context |

### 8.3 Dependencies

| ID | Dependency | Type | Used by |
|---|---|---|---|
| D-01 | Cloudflare (Pages, Functions, Workers AI, Durable Objects, Queues) | External service | Hosting, API, AI, rate limits, escalations |
| D-02 | Supabase (Postgres, Auth, Storage, PostgREST) | External service | All data |
| D-03 | Cobb County School District ParentVUE (Edupoint Synergy) and CTLS | External data source | Education |
| D-04 | Google (Calendar, Tasks, Drive, Gmail via connector) | External service | Ext sync, Drive, Mail |
| D-05 | Microsoft Office 365 (Eli's calendar ICS) | External service | Ext sync (pending ICS URL) |
| D-06 | Apple Health via iOS Shortcuts | External / device | Health steps (pending Shortcut) |
| D-07 | The box (Linux automation host) with cron | Internal infrastructure | School ingest, poller, escalations, ext sync, mail |
| D-08 | Rolan's three computers (Windows laptop and others) | Internal devices | ParentVUE pulls, Crystal Sync |
| D-09 | GitHub (repository, Actions) | External service | Source control, CI, installer builds |

## 9. High-Level Risks

The full register is in 13. The top risks at charter time:

| ID | Risk | Rating |
|---|---|---|
| R-001 | Exposure of a minor's education records through misconfigured access | High impact, low likelihood |
| R-002 | Pending migrations (018/019/020) not applied, leaving features in "pending" state | Medium / high |
| R-003 | ParentVUE format or access change breaks pulls | High / medium |
| R-004 | Unsigned installers block or scare the second family | Medium / high |
| R-005 | Lost GitHub auth delays pushes, CI and installer builds | Medium / certain (current issue) |
| R-006 | Home computer asleep or offline at pull time | Medium / medium |

## 10. Success Criteria and Exit Criteria

| Criterion | Measure |
|---|---|
| Functional completeness | All Must FRs in 04 implemented and verified (see 14 RTM) |
| Privacy | All RLS suites pass (T-020/T-021/T-022) and no anonymous read of family data in production probes |
| Reliability | 4 consecutive school weeks with ≥ 95% of sync slots landing within 5 minutes and every failure alerted within 15 minutes (measurement window TBD) |
| Operability | Runbook SOPs 01–10 executed at least once successfully |
| Acceptance | Rolan signs the acceptance block in 02 SOW §9 |

## 11. Project Manager Authority

| Area | Authority |
|---|---|
| Scope | The Product Owner may add, remove or reprioritize backlog items. Changes to privacy posture, data sharing or anything that sends messages externally need explicit Sponsor approval. |
| Schedule | The delivery team may reorder sprint work. Phase gates (§12) need Sponsor sign-off. |
| Budget | Any paid service or certificate needs Sponsor approval. |
| Technical decisions | The delivery team decides within the architecture principles in 06; decisions that weaken least privilege need Sponsor approval. |
| Production changes | Database migrations are applied only by Rolan (SQL editor). Deploys to production go through Cloudflare Pages from `main`. |

## 12. Governance and Phase Gates

| Gate | Entry | Exit | Approver |
|---|---|---|---|
| G0 Initiation | Problem identified (EliDash predecessor) | Charter approved | Sponsor |
| G1 Foundation | Charter | Auth, RLS, cockpit live (Phase 1) | Sponsor |
| G2 Core modules | G1 | All modules live, FR audit passed | Sponsor |
| G3 Integrations | G2 | Pipelines validated (data validation strategy, quarantine) | Sponsor |
| G4 Sharing and administration | G3 | 017–019 applied and tested in production | Sponsor |
| G5 Distribution | G4 | 020 applied, Crystal Sync signed builds, second family onboarded | Sponsor |

## 13. Approval and Sign-off

By signing, the Sponsor authorizes the project and the use of family resources described in this charter.

| Role | Name | Signature | Date |
|---|---|---|---|
| Project Sponsor | Rolan Chowdhury | | TBD |
| Product Owner | Rolan Chowdhury | | TBD |
| Delivery Lead (agent-assisted) | Rolan Chowdhury for the Grok Bot delivery team | | TBD |
