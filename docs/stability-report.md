# Crystal v4 — Stability Report (Oct 14, 2026)

All tests run against production (`crystal-7ot.pages.dev`) or staging with headless Chromium 1xx (Playwright).
WebKit could not run on the build box (missing system libraries, unsigned apt repo); Safari/iOS coverage is via Chromium
device emulation (iPhone SE, iPhone 15, Pixel 7, Galaxy Fold) and should be spot-checked on a real iPhone.

## Crash / robustness fixes
| Area | Fix |
|---|---|
| Rendering | `Boundary` error boundaries around every applet, HUD and overlays (retry button); `app/error.tsx` + `global-error.tsx` |
| Global errors | `useGlobalErrorHooks` (window `error` / `unhandledrejection`) → `reportError` beacon to `/api/log` |
| Storage | `safeJSON` / `lsGet` / `lsSet` everywhere: malformed localStorage can no longer crash boot |
| Network | `fetchJSON`: timeout, exponential back-off, friendly 429 "Easy there, pilot! Rate limit hit. Try again in Ns." |
| Auth | Supabase client: 15 s timed fetch + `autoRefreshToken`; expired session mapped to a friendly message |
| Offline | `OfflineBanner`, offline commands fail with a clear message (no spinner hang) |
| Leaks | Applet drag listeners cleaned on unmount; OCR object URLs revoked; AudioContext suspended when hidden |
| OCR | 15 MB / type limits, downscale to 2000 px, 30 s load timeout, unmount guard |
| API | AI router 20 s timeout; Whisper 4 MB / 25 s; body limits per route |
| Haptics | `navigator.vibrate` only after user activation (removed console errors on mobile) |
| Build | CSS attribute selectors fixed after a minifier crash (`aria-label^="Rank & Medals "`) |

## Chaos suite (`e2e/v4suite.mjs`, prod) — 41/43, both failures fixed since (vibrate console error)
Window manager at 1280×800 / 1920×1080 / 390×844 / 320×640: one applet visible, no overlap, full screen between greeting row
and dock with 8 px gutters, centered (dx = 0). Delete → undo → reload persistence, NL "remove milk", offline banner,
API 500, 429 toast ("17s"), malformed quote JSON, 40 rapid ability presses, 50× open/close (heap 10.2 → 12.0 MB),
malformed localStorage boot, 320 px + reduced motion text audit, landing/legal console clean, slow 3G (5.2 s to command bar),
4 emulated devices: no horizontal scroll, touch targets ≥ 44 px.

## Other suites
- Keyboard shortcuts (`e2e/keys.mjs`): 40/40 at 4 sizes (Alt+1–9, digits, Alt+←/→, Esc / Shift+Esc / Alt+0, ignored while typing, `?`, F toggle + persistence, title double-click).
- Pinned title bar / sticky tabs / neon scrollbars (`e2e/chrome.mjs`): 36/36.
- axe color-contrast per module × 3 glass clarities: 24/24, 0 violations.
- Memory: 10 min, 1,620 applet opens: heap 8.3 → 8.3 MB after warm-up, DOM 614 → 564 nodes, 0 console errors.
- Grounding tests (`scripts/test-grounding.mts`), grading periods (`scripts/test-periods.mts`), names (`scripts/test-names.mts`), Title Case lint (`npm run lint:labels`).

## Lighthouse (mobile, `/app/?demo=1`)
| Build | Perf | A11y | Best practices | SEO |
|---|---|---|---|---|
| Before (v4 start) | 65 | 96 | 93 | 100 |
| After progressive mount (staging, 3 runs) | 96 / 81 / 82 | 100 / 100 / 96 | 96 / 93 / 93 | (staging is noindex) |
Landing: 93 / 100 / 100 / 100.

## Known limitations
- WebKit not runnable on the box (see above).
- `user_prefs` persistence verified for the table and RLS; per-user DB writes need a real signed-in session to verify end to end.
