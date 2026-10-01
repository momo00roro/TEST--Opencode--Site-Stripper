# Video capture (CF21–CF24) — playing frames for facades, not blank bands

Status: implemented 2026-09-30, extended CF25 2026-10-01. `npm run test -w worker`: 343/343 passing.
`npm run typecheck -w worker`: clean. Verified live (w3schools native
`<video>` renders; figma.com Vimeo grid fully covered — see CF25 + Resolution).

## Problem (proven by dogfood)

CF14 shipped poster binaries, but video *regions* still captured as blank
bands: facades (click-to-play shells like `vimeo-video`, `lite-embed`) render
nothing until played, and the section screenshots showed empty rectangles.
The DOWNLOAD ZIP button also died on poster bytes (binary died in JSON
transit), and lazy images captured blank.

## CF21 — capture foundations

- **Poster re-encode:** poster bytes re-encoded as `dataUrl` locally before
  JSON transit (`worker/test/rehydrate-assets.spec.ts`).
- **Lazy sweep:** `ensureLazyMediaLoaded` in `worker/src/browser/capture.ts` —
  scroll into view, eager + high-priority, poll; honest warnings. Pierces
  `vimeo-video` / `lite-embed` shadow roots for `<video>` (figma players
  live there).
- **Native `<video>` force-play:** muted → data-wait → seek 0.5s → hold
  paused. Proven live on w3schools.
- **Local Chrome flags** in `worker/local/launcher.ts`
  (`LOCAL_CHROME_ARGS` incl. `--autoplay-policy=no-user-gesture-required`,
  `--mute-audio`; `worker/test/local-launcher.spec.ts`). Cloudflare launcher
  untouched (controls its own flags).

## CF22 — three-tier capture (runs LAST in `capture.ts`)

1. **Autoplay-first `awaitAutoplayVideo`:** scroll + muted nudge +
   clock-advance check, viewport-coord clip; quick-probe variant for
   stream-known facades to save wall.
2. **Isolated render `renderIsolatedVideoShot`:** one clean player page per
   stream, adaptive motion-poll dwell up to ~10s, two-frame diff rejects
   gated/static frames, always closes its tab (sequential, Trap 3).
3. **Click fallback ONLY for streamless facades** (trusted CDP click —
   synthetic in-page `.click()` carries no user activation, never regress).
   `FacadeClickTarget` carries streamUrl + doc-rect + per-element uid.

In-page functions stay zero-import / self-contained (Trap 5, shipped as
shimmed strings); never reference module scope. `scrollIntoView` literal
stays OUT of facade/pager scripts; `evaluateWithTimeout` accepts string
scripts. Mock-routing markers in `worker/test/helpers.ts` stay unique per
script (branch order: maxHeadings → collectHeadingTexts → facadeClickTarget
→ awaitVideoPlayer → awaitAutoplayVideo → pageVideoCarousel →
scrollIntoView).

## CF23 — placement + compositing

`videoShots` carry facade doc-rects (placement), plumbed through
`analysis.ts` (`AnalysisScreenshot.y` / `placement` / `composited`) into
JSON. `web/composite-video.mjs` (`planComposites` / `coverRect` pure +
`compositeSectionStills` canvas patch, idempotent, honest skips) runs in the
visitor browser after render AND before ZIP assembly — section cards and ZIP
sections get playing frames baked in. Viewer VIDEO cards tagged → section N
(`sectionTagForShot` in `web/app.js`); `imagery-and-video.md` lines say which
section each video belongs in. Tested in
`worker/test/composite-video.spec.ts` (fake canvas asserts exact draw
coords) + `client-package.spec.ts`.

## CF24 — carousel pager + caps + observability

`pageVideoCarousel` pages next-arrows serving video grids (Node
trusted-clicks, re-scans; max 3 turns; loop-back stop — a rescan with
nothing unseen refuses further turns). Dedup by uid AND stream URL
(re-renders mint fresh uids; element identity alone re-deferred the same 6
streams 11×, throttling Vimeo and blowing the wall — stream dedup caps CDN
hammering at 1 load/URL). Caps: `LIMITS.maxVideoShots: 12`, facade discovery
slices 12 (snapshot doc records stay 6 — display only).

Observability (no silent gaps by design): per-facade isolated outcome
warnings, wall/byte skips enumerating the remainder, pager telemetry
(`Paged the video carousel N time(s); M facades processed`), beyond-cap
probe warning.

## CF25 — fetched thumbnail fallback (2026-10-01)

Uncaptured facades with no poster left genuinely blank bands (and the old
"its cover art stands in" warning was dishonest for them). `captureOne` now
returns `videoPlaceholders` (label/streamUrl/facade rect/reason) for every
deferred stream that never became a clip; `runAnalysis` resolves posterless
Vimeo placeholders via oEmbed (`fetchVimeoThumbnailUrl`, one tiny JSON fetch
each, zero browser-minutes) and rides the existing poster pipeline as
synthetic assets (shared caps, lowest priority). Downloaded thumbnails become
`page.videoThumbnails` (label `thumbnail:`, never `video:`), composited over
blank bands by `composite-video.mjs` (plans marked `thumb`, `stats.thumbnails`
reported), shown as viewer VIDEO cards, and listed under a new `## Fallback
thumbnails` docs section. Warnings now say "packaging substitutes a fetched
thumbnail where one resolves"; the rehydration limitation reports the actual
fetched/unresolved counts. `wallBudgetMs` override added for deterministic
tests. Live-verified on figma.com: 6 fetched thumbnails for 6 uncaptured
facades, 343/343 tests, typecheck clean.

## Resolution — figma.com section-6 grid (2026-10-01, CF25 live run)

10/10 facades covered: 4 motion-verified playing frames (autoplay tier) + 6
fetched Vimeo thumbnails composited into section 6. The pager turned once
(10 facades processed, dedup clean); the remainder were honest wall-budget
skips with thumbnails standing in. Original diagnostic notes preserved below.

4/6 discovered cards render + composite; the grid holds 7+ `vimeo-video`
cards (inspected: id 1202189218 "Variable type", declarative shadow DOM,
ready player iframe, muted/loop/playsinline, `data-ready="true"`) but only
~6 match discovery per DOM state (carousel paginates). Streams CAN render
isolated (6/6 succeeded once); failures correlate with wall exhaustion
(95–108 s runs) and post-burst Vimeo throttling. Next run's warnings
(motion vs load-failure vs wall-skip vs loop-back) distinguish a dedup leak
(mine) from gated streams (throttle) from an arrow-selector miss (pager
never turns). Baseline set 2026-09-30: a later figma run returned zero video
shots AND blank section stills — sections capture BEFORE the video pass, so
the video code cannot cause that; suspect figma/Vimeo throttling this IP
after repeated runs. Control test (unrelated site) distinguishes a
target-side block (wait ~1h, retest) from a browser-side fault.
