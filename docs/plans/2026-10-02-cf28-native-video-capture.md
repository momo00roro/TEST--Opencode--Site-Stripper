# CF28 — native video capture (2026-10-02)

Status: implemented and verified 2026-10-02. `npm run test -w worker`: 350/350 passing. `npm run typecheck -w worker`: clean.

## Verification (affinity.studio, localhost + production)

Stable across runs: 3–4 playing-state natives per run (media clocks
verified advancing), 1 honest unstarted (Fast-AF hero duplicate), zero
facades (correct — none exist). Follow-up hardening from the
investigation, all shipped: extended post-start settle (fade-from-black),
paint + reachability filters (hidden/track duplicates), re-anchor +
scroll quiescence, stale-clip guard with retry, top-left clip origin
(center was shifting every clip by half size).

Known limitation, closed as best-effort: the y4023–4781 band is a
ROTATING carousel — crop-vs-clip comparison at identical rects showed
different slides seconds apart. No screenshot pipeline can freeze a
rotating showcase deterministically; stills are correctly framed
captures of a moving target, and warnings disclose exactly this.

## Problem

The capture loop is facade-only (`vimeo-video`, `[data-video]`, lite
embeds). Bare native `<video>` elements never enter the autoplay poll,
click path, or isolated tier. affinity.studio (Canva SPA, self-hosted
h264 MP4s on `<source>` children): 6 laid-out videos, CF27 records carry
real URLs, yet 0 facades → 0 shots. Proven by localhost probe
(`affinity-local2.json`): records resolved, shots zero.

## Design

New pass AFTER the facade while-loop, inside the existing
`screenshotKind && videoCap > 0` gate, sharing `videoBudget`,
`seenStreams`, `clipPlayer`, and the `vi` warning counter:

- In-page `nativeVideoTarget(index)` (Trap-5-shimmed, mock-routed by
  function-name marker like the other passes): enumerate
  `document.querySelectorAll("video")` + open shadow roots of custom
  hosts; keep rect >= 120x120; resolve src via
  `currentSrc || src attr || first <source> child`; scroll into view +
  stabilize; force `muted = true` + `play()` (muted, so the
  ensureLazyMediaLoaded audio concern does not apply); poll clock
  advancement (`readyState >= 2`, `currentTime` advances, ~2s bound);
  return viewport + page rects, label, streamUrl, started flag.
- Node loop over indices until `status: "none"`, cap/guard bounded:
  skip empty/unstarted (count into existing `unstarted`), skip
  `seenStreams` duplicates (facade already deferred the same file),
  screenshot started players via the EXISTING `clipPlayer` with a
  synthesized FacadeClickTarget. Distinct warning on native takes.
- Honesty preserved: nothing found → no new warnings, no behavior
  change for facade-only pages (one fast `status: "none"` evaluate).

## Tests

- Fake backend routes `nativeVideoTarget` by trailing index literal to
  a new `nativeVideoAt` fixture map (default: `status: "none"` so all
  46 existing browser-capture tests gain exactly one fast no-op).
- New specs: muted force-play natives become `video:` shots with
  placement; same-stream-as-facade dedup; silence when absent.

## Out of scope

Canvas-drawn motion (still single-static-frame by design); YouTube
non-embed URLs; audible autoplay (never attempted).

## Victory lap (production, fresh meter, 2026-10-02 ~14:10 UTC)

`POST site-stripper-api.momo00roro.workers.dev/api/analyze`
`{"url":"https://affinity.studio"}` → 8 pages, 19 screenshots,
2.34MB screenshot bytes, 160.1 browser-seconds, integrity passed.
Homepage: 4 `videoShots`, all distinct frames with placement, 6
sectionShots. Stale-clip guard fired exactly 4× ("moved during
capture; re-measured once" — one per native), confirming the CF28
guard works in production, not just localhost. Raw pack archived at
gitignored `.examples/2026-10-02__affinity.studio__cf-victory.json`.
