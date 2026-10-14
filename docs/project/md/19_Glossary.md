<!-- code: CRY-19-GLO | title: Glossary | subtitle: Terms, acronyms, identifier schemes and status conventions used across the Crystal documentation set. -->

## 1. Identifier Schemes

| Prefix | Meaning | Defined in |
|---|---|---|
| AD-nn | Architecture decision | 06 |
| A-nn / C-nn / D-nn | Assumption / constraint / dependency | 01, 02, 03 |
| BO-nn | Business objective (SMART) | 03 |
| BR-nnn | Business requirement | 03 |
| RULE-nn | Business rule | 03 |
| FR-nnn | Functional requirement | 04 |
| NFR-nnn | Non-functional requirement | 05 |
| F-nnn | Feature (catalog entry) | 08 |
| SOP-nn | Standard operating procedure | 09 |
| M-nn | Milestone | 10 |
| S1–S12 | Increment (sprint); S1–S7 complete, S8–S12 planned | 10, 17 |
| P0–P7 | Project phase | 10 |
| WBS x.y.z | Work package | 11 |
| SH-nn | Stakeholder | 12 |
| R-nnn / O-nnn / I-nnn | Risk / opportunity / issue | 13 |
| T-nnn | Test case or suite | 15 |
| TM-nn | Threat model entry (STRIDE) | 16 |
| PB-nnn | Product backlog item | 17 |
| CRY-NN-XXX | Document code | 00 |

## 2. Status Conventions

| Mark | Meaning |
|---|---|
| [[ok|Live]] / [[ok|Done]] / [[ok|Applied]] / [[ok|Pass]] | Built and confirmed from code, test output or deployment |
| [[partial|Partial]] | Built but waiting on a configuration, migration or owner action, or covered only in part |
| [[no|Open]] / [[no|Pending]] / [[no|Planned]] | Not done |
| <span class="tbd">TBD</span> | Not known from the sources; must be confirmed by the owner |

## 3. Terms and Acronyms

| Term | Definition |
|---|---|
| Admin command center | Owner-only page `/admin` for users, families, data explorer, sync and audit (migration 019). |
| Agent (laptop agent) | Legacy PowerShell pipeline on Rolan's laptop that logs in to ParentVUE at 5:40 and 17:40 ET and uploads data. |
| AI Gateway / Workers AI | Cloudflare's hosted AI models used for chat, OCR and transcription. |
| Anon key | Supabase public client key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`); safe in the browser only because RLS restricts every table. |
| Applet | A movable, resizable window in the Crystal HUD showing one module. |
| Box | The always-on Linux machine that runs cron jobs (school sync, poller, escalation worker, external sync) and the build tools. |
| BABOK | Business Analysis Body of Knowledge (IIBA). |
| CCSD | Cobb County School District. |
| Child | A minor whose school data the family tracks (currently Eli). Child data is sensitive. |
| Cockpit HUD | Crystal's main screen: header, module toolbar, applets, dock, Crystal assistant. |
| COPPA | Children's Online Privacy Protection Act (US), rules for online services that collect data from children under 13. |
| Crystal | The family command-center web app; also the name of the assistant and robot character. |
| Crystal Sync | The cross-platform desktop agent (v0.1.0) that pulls ParentVUE data on a family's own computer and uploads it with a device key. |
| DEFCON | Crystal's readiness indicator (levels driven by school alerts such as missing work and unexcused absences). |
| Device key | Per-device secret with prefix `csd_` issued at pairing; only its SHA-256 hash is stored. |
| Durable Object (DO) | Cloudflare stateful object; `crystal-ratelimiter` counts requests per IP. |
| Escalation | Routing a hard chat question to the `crystal-escalations` queue and the larger model on the box. |
| FERPA | Family Educational Rights and Privacy Act (US), which protects student education records. |
| Grounding | Answering only from the user's own RLS-scoped data, with deterministic handlers for facts like grades. |
| IHA-R | Cobb County grading administrative rule cited in the Grading Rules tab. |
| Leader lease | A per-family, per-slot lock so only one computer logs in to ParentVUE; another can take over after 10 minutes. |
| Migration | A numbered SQL file in `supabase/migrations` that changes the database schema. |
| Missed pull | A scheduled school sync slot that produced no successful upload; raises an alert. |
| Module | A functional area: Education, School Hub, Health, Comms, Finance, Shopping, Home. |
| NFR | Non-functional requirement (quality attribute). |
| Pages Functions | Cloudflare serverless functions under `/api/*` deployed with the static site. |
| Pairing code | Short-lived code shown on `/downloads` that a Crystal Sync install exchanges for a device key. |
| ParentVUE | Edupoint's parent portal used by Cobb County; the source of grades, assignments, attendance and report cards. |
| PMBOK | Project Management Body of Knowledge (PMI). |
| Primary / standby | Crystal Sync device roles; the primary runs scheduled pulls and Sync Now, standbys take over when the primary is silent. |
| PWA | Progressive Web App; Crystal can be installed to the home screen. |
| Q1 / Q2 | Grading quarters of the school year. |
| Quarantine | Holding area for incoming rows that fail validation, so bad pulls do not overwrite good data. |
| RACI | Responsible, Accountable, Consulted, Informed. |
| RLS | Row Level Security in Postgres/Supabase; every table restricts rows to their owner or family. |
| RPC | A Postgres function called through Supabase; sensitive ones are `SECURITY DEFINER` with `search_path=''`. |
| RTM | Requirements Traceability Matrix (14). |
| Service-role key | Supabase key that bypasses RLS (`SUPABASE_SERVICE_ROLE_KEY`); must stay server-side. |
| Skin | A visual theme for the HUD. |
| SMART | Specific, Measurable, Achievable, Relevant, Time-bound. |
| SOW | Statement of Work (02). |
| Status light | Per-child sync indicator; OK when the last successful pull is under 13 hours old. |
| STRIDE | Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege. |
| Support queue | Tickets created from error pages through `/api/support` (migration 018). |
| Trusted adult | A viewer granted read access to a child's education data (017). |
| WBS | Work Breakdown Structure (11). |
| Whisper | Speech-to-text model used for voice when the browser cannot transcribe. |
| WSJF | Weighted Shortest Job First, a backlog ordering method. |
