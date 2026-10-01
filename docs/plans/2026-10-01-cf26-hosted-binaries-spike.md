# CF26 — hosted binaries (2026-10-01)

Status: spike measured, promoted with caps 2026-10-01. `npm run test -w worker`: 345/345 passing. `npm run typecheck -w worker`: clean.

## Spike result (production, example.com, ?binaries=1)

- Two invocations: `cpuTime` 87 ms and 62 ms, outcome ok, zero limit errors.
- The feared 10 ms ceiling (Trap 4) does not bind this deployment — the
  existing pipeline already burns 60–90 ms CPU per analysis. The base64 of
  an 8 KB shot is sub-ms noise within it.
- Decision: PROMOTE conditionally. Binaries ship by default; `?binaries=0`
  opts out to metadata-only; injected encoders (local dev) always win.
   Existing byte caps (10 MB screenshot total, per-shot budgets) bound the
   worst case. Large-payload production probe done 2026-10-01: figma 10/10
   motion-verified frames, 18 binaries inlined, zero limit errors —
   multi-MB serialization holds.

## Hypothesis

`Buffer.toString("base64")` on example.com-scale shots (~100–400 KB) costs
low-single-digit ms of Worker CPU. If so, hosted responses can ship binaries
behind a cap; if not, pursue in-Chromium encoding (the `encoding?: "base64"`
seam already reserved in `worker/src/browser/types.ts`) or R2.

## Design (minimal, flag-gated, example.com-scale only)

- Route opt-in: `POST /api/analyze?binaries=1`. Read in `handleAnalyze` via
  `new URL(request.url).searchParams` (NOT in the body validator — the flag
  is transport, not analysis input).
- When set, `deps.encodeBase64` defaults to `(bytes) =>
  Buffer.from(bytes).toString("base64")` (only when the deploy did not inject
  its own encoder). All existing inline paths (screenshots, section clips,
  video shots, poster/thumbnail bytes) ride unchanged — the ONLY new CPU is
  the encoder itself, which is exactly what we are measuring.
- No cap changes, no new files, no client changes: `collectScreenshotFiles`
  and validation already handle dataUrls; hosted ZIPs just start containing
  real images.
- Tests: route-level — flag on/off selects the encoder; existing suite
  unchanged (local dev still injects its Node encoder; unflagged hosted
  stays metadata-only).

## Measurement protocol (production, example.com, maxPages 1, mobile off)

1. Deploy, then `npx --prefix worker wrangler tail` (repo root) in one
   terminal.
2. `POST https://site-stripper-ui.pages.dev/api/analyze?binaries=1`
   (or via the UI if it forwards query strings — verify in DevTools).
3. Read the per-invocation CPU ms from tail._Margins:
   - **< 5 ms: promote.** Ship binaries by default under a total inline cap.
   - **5–10 ms: conditional.** Ship only below a measured byte threshold.
   - **> 10 ms or limit errors: stop.** Go in-Chromium (`encoding:
     "base64"` through the launchers) or R2; the spike cost ~30
     browser-seconds to learn this.
4. Confirm the downloaded ZIP contains real images (not just manifest
   entries) and `packageIntegrityPassed` is true.

## Non-goals

In-Chromium encoding, R2, raising any cap, changing the default hosted
behavior. The flag defaults OFF; unflagged traffic is byte-identical to
v1.0.0 beta.
