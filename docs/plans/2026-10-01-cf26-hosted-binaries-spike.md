# CF26 spike — hosted binaries via flag-gated Worker encoding (2026-10-01)

Status: specified 2026-10-01. Question: does base64-encoding real screenshot
payloads inside the Worker break the 10 ms Free-tier CPU budget, or clear it
with headroom? Answer with numbers, not theory.

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
