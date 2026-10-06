# CF30 — Chromium-native base64 (Trap 4) + orphan guard (2026-10-04)

Status: implemented; `npm run typecheck -w worker` clean, **352/352** tests
(each spec file run separately — the full suite OOMs locally). Production
confirmation pending a fresh meter (see "Production confirmation" below).

## Context — the 2026-10-03 CPU-1102 incident, re-tested

Production higgsfield runs on CF29 failed with Error 1102 (`Worker exceeded
CPU time limit`) and orphaned their browser sessions (~8 min). Production was
rolled back to pre-CF29 `9b427660`; the repo stayed on CF29.

The planned next-morning A/B was run on a fresh meter (2026-10-04). **Run A
(live pre-CF29 build)** reproduced the failure:

- `POST /api/analyze` (higgsfield.ai, maxPages 1, mobile) → **HTTP 200 but a
  truncated NDJSON stream**: only the `launching` + `homepage` progress lines,
  no `result`, no `error`, after **133.3 s**. That is the 1102 isolate-kill
  signature.
- The killed isolate never closed its session, which then **idled the entire
  daily meter — 10:01 burned** (`2026-10-04 14:03:26 UTC`, duration `00:10:01`
  in the dashboard).

Conclusion: the 1102 is **not CF29-specific** — the pre-CF29 build fails on the
same page too. Combined with the fact that the CF29 isolate-side diff has no
CPU hotspot, this is the free-plan CPU ceiling / content variance, not our
code. The A/B is moot (A does not pass either); no bisect needed. The paid
plan ($5/mo, 30 s CPU) is explicitly **out of scope** for this project.

Two independent defects were fixed instead.

## Fix 1 — Orphan guard: cap the browser session idle timeout

`LIMITS.browserKeepAliveMs` was pinned to the Cloudflare maximum, `600_000`
ms. `keep_alive` is an **idle** timeout (sent to the session-acquire API;
Cloudflare default 60 s, max 600 s), so a CPU-killed isolate leaves the
session alive for the full window — exactly the 10:01 orphan observed.

- `worker/src/config/limits.ts`: `browserKeepAliveMs` **600_000 → 90_000**.
- 90 s clears the longest single in-flight browser command (the 45 s
  `ensureLazyMediaLoaded` sweep) with 2× margin, but caps an orphan's waste at
  90 s (~15 % of the daily meter) instead of 600 s.
- Verified semantics against `@cloudflare/puppeteer` 1.4.0
  (`cloudflare/PuppeteerWorkers.js`: `keep_alive` → session-acquire query
  param) — it is idle-after-last-command, **not** a hard session lifetime, so
  a live 150 s analysis is unaffected.

## Fix 2 — Trap 4: Chromium-native base64 (no Worker encoding)

The PRD (Trap 4, §285-294) mandates encoding screenshots inside Chromium so
the Worker only passes bytes through. CF26 had instead added a pure-JS
`workerBase64` and shipped binaries through it by default. Benchmarked cost
(Node, same V8 engine):

| bytes | `workerBase64` CPU |
| --- | --- |
| 1.68 MB (the morning success) | ~133 ms |
| 10 MB (the 10 MB cap) | ~1.3 s |

That is the dominant isolate-side CPU cost and the most plausible 1102
trigger. Both real backends expose the fix directly:

- `@cloudflare/puppeteer` 1.4.0 `Page.js:1037` — `options.encoding === "base64"`
  returns the raw CDP base64 `data` string.
- local `puppeteer-core` 24.43.1 `Page.js:1084` — same behavior.

So capture now always requests `encoding: "base64"` and carries the string
end-to-end; the Worker never re-encodes screenshots.

### Implementation

- `worker/src/browser/types.ts`: `BrowserPage.screenshot` may resolve to
  `Uint8Array | ArrayBuffer | string`; `encoding` doc updated.
- `worker/src/browser/capture.ts`:
  - New `ShotPayload { bytes; base64?; data? }`. `SectionShot` and
    `IsolatedVideoShot` extend it; `CaptureResult.screenshot` is
    `ShotPayload | null`. `data` remains only for test doubles that return raw
    bytes.
  - `base64ByteLength()`, `toShotPayload()`, `snapShot()` (requests
    `encoding: "base64"`), and `payloadsEqual()` (compares base64 when present,
    bytes otherwise — backs the motion poll and the CF28 duplicate guard).
  - All five screenshot call sites (full-page, section clip, facade clip,
    isolated motion poll ×2) go through `snapShot`.
- `worker/src/pipeline/analysis.ts`: `shotPayloadDataUrl()` prefers
  `payload.base64` (no encoder needed) and falls back to a supplied
  `encodeBase64` for doubles. `toRecord`, homepage section/video inline, mobile
  inline, and the isolated-shot hand-off all use it; byte-budget math uses
  `payload.bytes`.
- `worker/test/helpers.ts`: new `base64Shots` fake option returns native
  base64 (models both real backends).
- `worker/test/analyze-endpoint.spec.ts`: new test — with a base64 backend and
  **no** injected encoder, `pages[0].screenshot.dataUrl` is the backend's
  base64 verbatim, and capture requested `encoding: "base64"`.

### Verification

- `npm run typecheck -w worker`: clean.
- Every spec file green individually: browser-capture 51, pipeline-analysis 31,
  analyze-endpoint 15, snapshot-script 56, rehydrate-assets 47, validation-ip
  35, validation-url 26, client-package 14, composite-video 13,
  ranking-key-pages 13, acceptance 12, discovery-sitemap 9, health 7,
  discovery-discover 7, zip-store 4, discovery-paths 4, discovery-robots 3,
  validation-doh 3, local-launcher 2 → **352**.
- Real local run (`localhost:8917`, actual `puppeteer-core` + local Chrome,
  `https://example.com`, maxPages 1 + mobile): desktop and mobile dataUrls
  returned as native base64 (`UklGR…`, WebP RIFF header), 65,406 screenshot
  bytes, zero issues. Confirms the real backend path, not just doubles.

## Production confirmation outcome (2026-10-05, fresh meter)

Pushed `04870be`; CI redeployed the CF30 Worker + Pages (live version
`2794f3e8-64b4-47fc-981e-bd3689083f89`). `/health` ok, Browser Rendering on.
Both production runs below went through the Worker API directly (no UI).

- **higgsfield.ai, maxPages 1 + mobile:** HTTP 200 but a **truncated NDJSON
  stream after 72.6 s** (only the `launching` + `homepage` progress lines, no
  `result`, no `error`; 189 bytes) — the same 1102-style isolate-kill
  signature as the CF29/pre-CF29 higgsfield failures. Raw capture at
  `C:\Users\Admin\AppData\Local\Temp\opencode\ab\PROD-CF30-higgsfield.ndjson`
  (temp, not committed).
- **example.com, maxPages 1, no mobile:** HTTP 200, full
  progress → page → result in 16.8 s wall / 16.46 browser-s, desktop `dataUrl`
  present as native base64 (`UklGR…`), `screenshotBytesTotal` 33,166, zero
  issues, `integrityPassed: true`.

Reading: CF30 is **correct in production** (Trap-4 passthrough holds live),
but removing the Worker-side re-encode was **necessary, not sufficient** —
higgsfield scale still kills the isolate. The remaining cost is most likely
receiving/holding/serializing the multi-MB CDP base64 payloads plus the
bounded observation JSON, all inside the free isolate budget. The orphan
guard held by design (any orphan from this run self-closes within 90 s
instead of the previous 10:01 day-burner). Meter used ≈ 1.2 min failed run +
capped 90 s orphan + ≈ 0.3 min smoke; no further heavy runs were fired.

### Second production run (2026-10-05 ~14:40 SGT, tail-measured)

- higgsfield.ai, maxPages 1 + mobile via API: HTTP 200 after **227.0 s** wall,
  and `wrangler tail` shows the confirmation:
  `POST …/api/analyze - Exceeded CPU Limit` + `Error: Worker exceeded CPU
  time limit`. Kill point varies run to run (72.6 s vs 227.0 s) —
  content-dependent weight, not a fixed phase.
- Dashboard: new session `2026-10-05 06:40:33 UTC`, duration **5:19**,
  "Browser Idle" (≈ 227 s work + ≈ 92 s idle) — the 90 s `keep_alive` guard
  held again.
- Meter: Browser Hours reads **0.14 h (≈ 8.4 min)** for the day
  (≈ 2:48 + 0:15 + 5:19 across the three runs). ≈ 1.6 min remains — **no more
  production runs today**.

### CF31 — extract-only diagnostic mode (`?screenshots=0`)

### CF32 — two-tier capture profiles (local full, hosted lite)

`AnalysisOptions.capture`: `"full"` is the most capable build (opened-up
wall 600 s / 25 MB budgets, full 12-clip video cap); `"lite"` is the
compromised hosted build (free-tier 150 s / 10 MB discipline, 6-clip video
diet, honest limitations). The Worker route passes `"lite"`, the local
server passes `"full"`; direct pipeline callers default to full so the
existing suite is unaffected (budget-exhaustion specs pin `"lite"`
explicitly). Fixed en route: the route initially hardcoded lite and ignored
the local `"full"` (caught by a local run showing the lite note; regression
test locks the deps wiring). Local verification: example.com full mode —
2 shots, both native-base64 dataUrls, no lite note, 0 issues.

`POST /api/analyze?screenshots=0` now runs the full pipeline with zero
binaries: no screenshots, video clips, mobile captures, or asset downloads —
observations, tokens, and DOM-only comparisons still run, all shortfalls
recorded as limitations. Transport flag like `?binaries=0` (read in the route,
never the validator). Purpose: the decisive experiment — if higgsfield
succeeds extract-only, the kill is screenshot-ingress and the fix stays
screenshot-scoped; if it still dies, it is the evaluates/snapshot path.
Doubles as a permanent fallback so heavy sites still strip (docs/tokens)
when screenshots cannot fit the free CPU.
Local verification (real `puppeteer-core`, no meter): example.com
extract-only → 11.5 browser-s, 0 shots/bytes, integrity true; higgsfield.ai
extract-only → **46.1 s** (vs 193 s full), 51 headings / 20 sections /
6 videos / 100 assets observed, 0 issues, all video phases 0 ms in timings.
Unit cover: route test (`?screenshots=0` → zero `screenshot()` calls) and
pipeline test (throwing encoder never invoked).

### CF33 — hosted-lite domcontentloaded-first navigation (built 2026-10-06, unpushed)

Tail-measured higgsfield full-lite run died at 45 s wall with **cpuTime 2020 ms
(`outcome: exceededCpu`)** — the effective free budget is ≈ 2 s CPU per
invocation, and capture-phase ingress blows past it. Biggest early cost is
the 12 s `networkidle2` firehose-track (plus the domcontentloaded retry =
double navigation) on media-heavy pages. CF33: hosted-lite navigates on
`domcontentloaded` (no idle wait, no retry); full capture keeps
networkidle2+retry. Threaded as `waitUntil` through `captureOne` for all
five capture sites; lite limitation discloses it. Known trade-off (H1
lesson): less-settled pages may report more unloaded media; the settle +
lazy-sweep passes still run deterministically afterwards.

### Decisive extract-only production run (2026-10-06, fresh meter)

CF32 live (`41eb9792`). higgsfield.ai extract-only (`?screenshots=0`,
maxPages 1 + mobile) via API: HTTP 200 but **truncated after 30.6 s** (same
2-line signature, 189 bytes). So the killer is **not screenshot-ingress**:
with zero screenshots, zero video passes, and zero asset downloads, the
isolate still died ~30 s into the homepage capture. Snapshot ruled out as
the weapon (local extractionBytes: 153 KB). Remaining prime suspect is the
first-30 s window itself — `networkidle2` navigation tracking every request
of a 290-image autoplaying-video firehose, plus the settle/snapshot
evaluates — i.e. capture-phase protocol ingress, variably over the free CPU
ceiling. Meter used ≈ 0.5 min + ≤90 s orphan. Next: either rerun with tail
to capture the exact error + cpuTime, or operate on the navigation
hypothesis (domcontentloaded-first / request filtering, trading hydration
per the H1 lesson).

## Follow-ups

- Asset poster rehydration still routes downloaded `<svg>` bytes through
  `options.encodeBase64` (workerBase64). Bounded by
  `maxAssetDownloadBytesTotal` 512 KB (~0.7 MB base64 ≈ ~60 ms CPU), so it is
  not the hotspot; a future change can fetch/render those natively too.
- 2026-10-05 update: production higgsfield still truncates on CF30 (72.6 s),
  while production example.com succeeds — so CF30 is correct live but
  insufficient at higgsfield scale. Local measurement rules out final
  serialization: stringifying the 2.2 MB homepage page-record costs ~8 ms.
  Remaining suspects are CDP receive/protocol CPU *during capture* (large
  base64 screenshot messages, dozens of poll/evaluate round-trips), not the
  final JSON. Next: one tail-measured production run (`wrangler tail`,
  read `cpuTime`/`_Margins`) before trimming anything blindly — do not cut
  screenshot fidelity on an unconfirmed threshold. Paid plan stays out of
  scope.
