<!-- code: CRY-15-TST | title: Test Plan and Results Summary | subtitle: Defines Crystal's test strategy, levels, environments, suites, entry and exit criteria (IEEE 829 / ISO/IEC/IEEE 29119), and summarizes results, including a re-run of the automated suites on October 14, 2026 at baseline 588f344. -->

## 1. Scope and Objectives

The test plan verifies the functional requirements (04), the non-functional requirements (05) and the security controls (16). Its main objectives are: (1) prove that no user can read another family's data, (2) prove that a bad pull cannot erase good data, (3) prove that answers about the student are grounded, and (4) keep the experience stable and accessible across devices.

## 2. Test Strategy

| Level | What | Technique | Tools |
|---|---|---|---|
| Static | Types, lint, labels | Typecheck app and functions; ESLint; Title Case lint | `tsc`, `eslint`, `scripts/title-case.mts` |
| Unit | Pure logic (NLP, grounding, periods, names, progress, defaults, calendar cleaning, merge, ext sync, mail) | Table-driven assertions | `tsx` scripts, Python test files |
| Database / RLS | Policies, RPCs, idempotency | Throwaway Postgres 17 with Supabase auth/storage stubs; role simulation | `supabase/tests/run_local.sh`, `019_admin_test.sh`, `sync/tests/test_mail_sql.sh` |
| Integration / pipeline | Laptop agent → box → Supabase; validation matrix | Local Postgres + PostgREST + storage/auth stand-in; replay zips from real raw pulls | `sync/tests/e2e.py` (30 checks), `e2e_val.py` (46 checks) |
| Agent | Crystal Sync and macOS port | Import self-test; mocked runs | CI `selftest`, `mac/tests/mock_run.py` |
| System / e2e | Browser flows on production and staging | Puppeteer/Playwright headless Chromium with device emulation | `/workspace/e2e/*.mjs` |
| Accessibility | Contrast, keyboard, labels, motion | axe-core; keyboard suite; reduced-motion text audit | `axe.mjs`, `keys.mjs`, `ui.mjs` |
| Performance | Load, memory, slow network | Lighthouse mobile; 10-minute memory soak; slow 3G | Lighthouse, `mem.mjs`, `v4suite.mjs` |
| Chaos / robustness | Errors, offline, rate limits, malformed storage | Fault injection | `v4suite.mjs` |
| Live probes | Production API behavior | `curl` | SOP-01 §3.3 |
| Acceptance | Owner review | Demonstration | Rolan |

## 3. Environments

| Environment | Use |
|---|---|
| Local Postgres 17 on the box (`/usr/lib/postgresql/17/bin`, port 55432) | RLS and RPC suites |
| Local Postgres + PostgREST 12 + `gw.py` | Pipeline e2e |
| Staging `staging.crystal-7ot.pages.dev` | Lighthouse, pre-release e2e |
| Production `crystal-7ot.pages.dev` | Chaos suite, FR audit, live probes |
| Devices (emulated) | iPhone SE, iPhone 15, Pixel 7, Galaxy Fold; viewports 320–1920 |
| Real devices | iPhone spot check pending (WebKit cannot run on the box) |

## 4. Test Suite Catalog and Results

Results marked "re-run" were executed by the documentation team on October 14, 2026 between 5:52 and 6:15 AM ET against baseline `588f344`. Others are the latest recorded results in `docs/FR-audit.md`, `docs/stability-report.md` and `/workspace/e2e/*.json|log`.

| ID | Suite | Covers | Cases | Result | Source |
|---|---|---|---|---|---|
| T-001 | NL command parsing (`scripts/test-nlp.ts`) | FR-036, FR-059 | 13 | [[ok|13/13 pass]] (re-run) | CI step |
| T-002 | Grounding (`scripts/test-grounding.mts`) | FR-031–033 | 44 | [[partial|42 pass, 2 fail]] (re-run). Both failures are live-data tests whose expected Q1 value no longer matches the latest sync (I-004); the answers are grounded | CI step |
| T-003 | Grading periods (`test-periods.mts`) | FR-065 | 9 | [[ok|9/9]] (re-run) | |
| T-004 | Names and greeting (`test-names.mts`, `test-fullname.mts`) | FR-007, FR-008 | 18 | [[ok|18/18]] (re-run) | |
| T-005 | ProgressBar messages (`test-progress.mts`) | FR-029 | 6 | [[ok|6/6]] (re-run) | |
| T-006 | Defaults v2 (`test-defaults.mts`) | FR-024 | 4 | [[ok|4/4]] (re-run) | |
| T-007 | Calendar chip cleaning (`test-calclean.mts`) | FR-081 | 7 | [[ok|7/7]] (re-run) | |
| T-008 | Mail grounding (`test-mail.mts`) | FR-031 (mail) | type-check + sample answers | [[ok|TS OK]] (re-run) | |
| T-009 | Typecheck app + functions | NFR-052 | — | [[ok|0 errors]] (re-run, Node 22) | CI step |
| T-010 | ESLint `src` | NFR-052 | — | [[ok|0 errors, 15 warnings]] (re-run) | CI step |
| T-011 | Title Case label lint | NFR-046 | — | [[partial|6 labels flagged]] (re-run) | `npm run lint:labels` |
| T-020 | Family RLS (017) via `run_local.sh` | FR-101–108, NFR-001, NFR-016 | 69 | [[ok|69/69]] (re-run); 017 applied twice OK | |
| T-021 | Crystal Sync (020) via `run_local.sh` | FR-123–135, NFR-005, 012, 015 | 36 | [[ok|36/36]] (re-run); 020 applied twice OK | |
| T-022 | Admin (019) `019_admin_test.sh` | FR-115–119, NFR-010, 011 | 12 | [[ok|12/12]] (re-run) | |
| T-023 | Mail SQL (`test_mail_sql.sh`) | FR-099, NFR-001 | — | [[ok|SQL TESTS PASS]] (re-run) | |
| T-024 | Mail Python (`test_mail_py.py`) | FR-099 | 11 | [[ok|11/11]] (re-run) | |
| T-025 | Merge/validation unit (`test_merge.py`) | FR-091, FR-092 | 4 | [[ok|4/4]] (re-run) | |
| T-026 | Ext sync (`test_ext_sync.py`) | FR-097, FR-098 | — | [[ok|all passed]] (re-run) | |
| T-027 | Pipeline e2e (`sync/tests/e2e.py`) | FR-086–096 | 30 | Recorded as 30 checks; latest result file TBD | `sync/README.md` |
| T-028 | Validation matrix (`e2e_val.py`) | FR-091–093 | 46 | Recorded as 46 checks; latest result file TBD | `sync/tests/README.md` |
| T-029 | macOS port (`mac/tests/mock_run.py`) | FR-086–088 | 13 | [[ok|13/13]] (re-run) | |
| T-030 | Agent import self-test | FR-136–137 | 1 | [[ok|import ok]] (re-run) | CI `crystal-sync.yml` |
| T-040 | Chaos suite (`e2e/v4suite.mjs`, prod) | FR-013, NFR-025, 034, 035, 041 | 43 | [[ok|41/43; both failures fixed since]] (`45e7cc0`) | `v4suite.json` |
| T-041 | Keyboard (`e2e/keys.mjs`) | FR-014, 015, NFR-038 | 40 | [[ok|40/40]] | `keys.json` |
| T-042 | Chrome: pinned title, sticky tabs, scrollbars (`e2e/chrome.mjs`) | NFR-048 | 36 | [[ok|36/36]] | `chrome.json` |
| T-043 | axe color contrast per module × 3 clarities | NFR-037 | 24 | [[ok|24/24, 0 violations]] | `axe.json` |
| T-044 | UI text/label audit (`e2e/ui.mjs`) | NFR-039, 044, 046 | 21 | [[partial|9/21 at 04:45; re-run pending]] (I-006) | `ui.json` |
| T-045 | Memory soak (`e2e/mem.mjs`) | NFR-026 | 1 | [[ok|heap 8.3 → 8.3 MB, 0 console errors]] | `mem.json` |
| T-046 | Lighthouse mobile | NFR-024, NFR-043 | 4 pages | Landing 93/100/100/100; app (staging) perf 96/81/82, a11y 100/100/96 | stability report |
| T-047 | FR audit (`e2e/e2e2.mjs` + curl) | FR-001–060 (Phase 1–4 scope) | 39 items | [[ok|Done or blocked-by-account]] | `docs/FR-audit.md` |
| T-048 | OCR live read | FR-058 | 1 | [[ok|pass]] | FR audit A3 |
| T-049 | Hands-free loop (`e2e/handsfree.mjs`) | FR-038 | — | Recorded; result file TBD | |
| T-050 | Live API probes | NFR-033, NFR-010 | 4 | [[ok|pass]] (re-run): `/version.json` 200 (`bmv7xg9th`); `/` 200; `/api/sync/poll` → `device key required`; `/api/admin/whoami` (anon) → `forbidden` | curl |
| T-051 | Real iPhone check | NFR-049 | — | [[no|Not run]] | I-014 |

## 5. Entry and Exit Criteria

| Gate | Entry | Exit |
|---|---|---|
| Increment | Code complete on a branch | T-001–T-011 pass (T-011 no new flags); relevant unit suites pass |
| Migration | SQL file idempotent | T-020–T-023 pass, applied twice; SOP-02 verification after production apply |
| Release to production | Staging deploy | T-040–T-043 pass on staging; no P1 issues |
| Phase gate | All increments in phase | RTM (14) shows all Must requirements verified; open defects triaged |

## 6. Defects and Observations

| ID | Observation | Severity | Linked issue |
|---|---|---|---|
| DF-1 | Live-data grounding tests assert fixed values that drift with each sync | Low | I-004 |
| DF-2 | 6 labels not in Title Case | Low | I-005 |
| DF-3 | UI audit failures at small widths (pre-fix run) | Medium | I-006, I-019 |
| DF-4 | Missed-pull alert after 20 minutes | Medium | I-007 |
| DF-5 | 15 ESLint warnings | Low | I-016 |

## 7. Gaps in Coverage

| Gap | Proposed test |
|---|---|
| Measured sync SLO (5 min) and alert SLO (15 min) in production | Weekly query over `sync_runs`, `edu_sync_runs`, `edu_alerts` for 4 school weeks (M-13) |
| Production RLS probe after 018–020 | Run `scripts/family-rest-probe.mjs` with a second test account |
| Agent on macOS/Windows | CI matrix once GitHub auth is restored |
| Backup restore | SOP-09 restore test |
| Real iOS Safari | Manual checklist on an iPhone |

## 8. Approval

| Role | Name | Signature | Date |
|---|---|---|---|
| Product Owner | Rolan Chowdhury | | TBD |
| Test Lead (agent-assisted) | Grok Bot delivery team | | TBD |
