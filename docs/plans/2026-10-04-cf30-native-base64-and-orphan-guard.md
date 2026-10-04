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

## Production confirmation (pending)

The repo is still 1 commit ahead of `origin/master`; a push redeploys CF29
(via CI) and undoes the production rollback. To confirm CF30 on a fresh meter:

1. Push (redeploys CF30 Worker + Pages).
2. `wrangler tail` and run higgsfield.ai from the UI, maxPages 1 + mobile.
3. Expect: no 1102, `cpuTime` far below the CF29 runs (native base64 removes
   the ~1.3 s encode), and — if anything still crashes — the orphan self-closes
   within 90 s instead of burning the day.
4. Record CPU ms from `tail._Margins`.

## Follow-ups

- Asset poster rehydration still routes downloaded `<svg>` bytes through
  `options.encodeBase64` (workerBase64). Bounded by
  `maxAssetDownloadBytesTotal` 512 KB (~0.7 MB base64 ≈ ~60 ms CPU), so it is
  not the hotspot; a future change can fetch/render those natively too.
- If higgsfield still trips 1102 after CF30, the residual isolate cost is the
  per-page JSON serialization of the bounded observation records (streamed one
  page at a time) — trim that next, still no paid plan.
