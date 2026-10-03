# CF29 — capture budget optimization (2026-10-03)

Status: **investigation opened, no code changed.** Baseline evidence
recorded below. Optimize only after Phase 0 instrumentation says where
the seconds actually go.

## Problem

Production video-heavy runs cost ~3 min of the 600 s shared browser
budget:

| Run | Date | Captured | browserSeconds |
| :-- | :-- | :-- | :-- |
| figma.com | 2026-10-01 | 10 facades | ~180 s |
| affinity.studio | 2026-10-02 | 4 natives | 160.1 s |
| higgsfield.ai | 2026-10-03 | 12 natives (25 videos) | 186.8 s (dashboard 3:04) |

PRD predicted "3–4 heavy analyses/day (figma-class ≈ 3 min)", so this
is *within envelope* — not a regression. But the runtime is dominated
by the video pass and we have **no per-phase breakdown**: one
`browserSecondsUsed` number and guesswork. We are optimizing blind.

## Goal

Cut per-run browser-seconds for video-heavy pages by **~20–30%**
without weakening capture fidelity or honesty (stale-clip guard,
start verification, stream dedupe, unstarted disclosure all stay).

## Non-goals

- Weakening/removing the **stale-clip re-measure guard** — it is why
  frames land correctly (proven by affinity + higgsfield).
- Dropping unstarted attempts at the cost of cover-art disclosure.
- Paid-tier decision (separate; see README open option).

## Phase 0 — instrument first (measure before optimize)

Add per-phase timing to the run report (localhost-only or behind a
flag is fine). Phases to attribute:

- navigation + wait (split out the `networkidle2` → `domcontentloaded`
  retry explicitly)
- lazy-media sweep
- facade pass (per tier)
- native pass, per index: scroll/settle, force-play poll, screenshot,
  and **re-measures counted separately**
- section shots / full-page / mobile
- reconciliation vs `browserSecondsUsed` (should account for ≥90%)

Phase 0 must be behavior-neutral: timing only, no capture change.

### Phase 0 result — higgsfield.ai localhost (2026-10-03)

Instrumented `capturePage` + `captureOne`; `timings` now rides
`AnalysisResult` and `data/report.json`. Run: higgsfield.ai, max pages
1 + mobile, local backend, `browserSecondsUsed` 221.11 s.

| Phase | ms | share |
| :-- | --: | --: |
| **native video pass** | **151,664** | **~70%** |
| pre-capture settle (paced scroll) | 21,779 | 10% |
| section screenshots | 17,424 | 8% |
| navigation (12 s timeout + retry) | 13,086 | 6% |
| full-page screenshot | 7,345 | 3% |
| rotation re-sample | 5,017 | 2% |
| lazy-media sweep | 1,052 | <1% |
| snapshot | 193 | <1% |
| facade video pass | 31 | ~0% |
| **capturePage total** | **217,596** | **98% of the run** |

Findings that re-rank the hypotheses:

- **H2 is far larger than estimated.** The native pass is ~70% of the
  run and **11 of 12 natives re-measured** — the stale-clip guard fires
  on nearly every clip. Even if each re-measure is only a fraction of a
  full cycle, this is the single biggest lever by an order of magnitude.
- **H1 confirmed exactly.** nav = 13.086 s ≈ the 12 s `networkidle2`
  timeout + 1 s retry. Cheap ~6% win.
- **H3 material.** 15 natives went unstarted here (localhost), each
  polling before giving up — folded into the 70%.
- **Settle + section shots ≈ 18%** combined and are fidelity-critical;
  treat as last. Facade pass is negligible on native-only pages.

Verdict: optimize the native pass first (H2 then H3), then H1.

### H2 diagnostic — the re-measures are REAL, not false positives

Added `nativeRemasureMaxPx` (largest |scrollY delta| that tripped the
guard). Re-ran higgsfield localhost:

- `nativeRemasures` 9, **`nativeRemasureMaxPx` = 517 px**.

A 517 px move is most of a video band — that clip *would* have been
mis-framed. So the guard is doing its job; the movement is real
(almost certainly site scroll-on-play / smooth-scroll glide after the
measure). This **inverts the plan's H2 premise**: we must NOT simply
loosen the guard threshold, or the CF28 wrong-band bug returns.

Revised H2 direction (correctness-preserving, needs a decision):

1. **Cheapen the retry, don't remove it.** On retry the video is
   already playing; re-running the full `nativeVideoTarget` (re-play +
   800 ms clock poll + 1500 ms fade pause + settle) is wasted. A
   lightweight "re-anchor + re-measure rect only" probe would keep the
   guard's correctness at a fraction of the cost.
2. **Prevent the post-measure move.** The post-play quiescence loop
   breaks on the *first* calm 250 ms sample (next to the stricter
   pre-play loop, which needs two). Requiring a longer stable window
   before measuring may stop the page gliding under the screenshot in
   the first place — but risks a page that never fully settles.
3. Leave the 2 px detection threshold alone.

Open decision for the next session: pursue (1) or (2) first. Both
touch the guard's timing, so each needs an outcome check (12 distinct
placed frames) on the higgsfield baseline, not just a seconds number.

### H2 fix result — lightweight retry (2026-10-03)

Implemented option (1): the stale-clip retry now calls a new
`nativeVideoRemeasure(index)` (re-enumerate + re-anchor + three-stable-
sample quiescence + fresh rects) instead of the full
`nativeVideoTarget` — no re-play, no 800ms clock poll, no 1500ms fade
pause. `nativeVideoRemeasureScript` is mock-routed via the same
`nativeVideoAt` fixtures.

Higgsfield localhost, same request:

| Metric | before (Phase 0) | after (H2) |
| :-- | --: | --: |
| `browserSecondsUsed` | 221.11 s | **173.79 s (−21%)** |
| native pass | 151,664 ms | **101,323 ms (−33%)** |
| videoShots | 12 | 12 (all placed) |
| guard fires / max px | 11 / 517 | 8 / 516 |

The guard still fires (movement is real) and still re-measures, so
framing correctness is preserved; only the retry got cheap.

Caveat: distinct frames were 10/12 this sample (two identical-byte
duplicate pairs), i.e. the **pre-existing intermittent duplicate-
capture issue** (CF28 follow-up), not new mis-framing — the same
`nativeVideoTarget` lives in the first pass only. Worth fixing next;
it also costs wasted seconds and pollutes the distinctness metric.

### H1 — tried, reverted; and a measurement-validity warning

H1 (cap the first `networkidle2` attempt at 6 s) was implemented and
looked like a clean ~6% win (`navMs` 13.2 s → 7.0 s). But the run that
included it also captured only 9 shots with 32 unloaded images.

Crucially, reverting H1 did **not** restore the baseline: the clean
H2-only re-run gave **8 shots / 58 unloaded images** (navMs back to
13.2 s). Across today's successive runs the same IP degraded steadily:

| run | shots | images unloaded |
| :-- | --: | --: |
| Phase 0 | 12 | 11 |
| H2 | 12 | (clean) |
| H2+H1 | 9 | 32 |
| H2-only re-run | 8 | 58 |

This is the CF28-documented IP-throttling pattern (figma returned zero
video on a later same-IP run). **Conclusion: H1's effect is
unmeasurable today — the baseline itself decayed.** H1 stays reverted
(its ceiling is only ~6% and it risks under-hydrating SPAs), but the
decision is provisional, not proven.

**H2 is the one validated result** because it was measured while the
baseline was still healthy (12 shots, both before/after runs).

Operational note for next session: do optimization measurement on a
**fresh IP / fresh day**, and treat capture-count as the primary
signal — a declining shot count means the environment, not the code.

### Duplicate-capture follow-up — provenance added, not reproduced

Added `streamUrl` provenance to every playing-state clip (`SectionShot`
→ `AnalysisScreenshot` → `pages.json`) so any duplicate is auditable
(which file each frame came from).

Re-ran higgsfield localhost with provenance: **12 videoShots, 12
distinct, zero byte-duplicates, zero stream-duplicates** — all 12
streams resolved and unique. The duplicate did **not** reproduce; it is
intermittent, matching the CF28 note. (This run still showed 54
unloaded images / 226.86 s — the same-IP throttle persists, so timing
is not comparable.)

Candidate root causes (unconfirmed, since no repro): (a) an unresolved
(`""`) stream on one of a duplicate pair, which `seenStreams` cannot
key; or (b) the same video served under two different URLs (e.g. CDN
format variants), so distinct stream keys map to identical frames.

A content-hash dedup would catch byte-identical pairs but the fake
test backend returns identical bytes for multi-shot captures, so it
needs test-fixture rework (or native-scoped dedup + ~4 specs). Deferred
until the duplicate reproduces **with provenance**, so the dedup key is
chosen from evidence rather than guessed.

#### Resolved — native byte-duplicate guard (2026-10-03)

Reproduced with provenance: the duplicate pairs carried **different
stream URLs but byte-identical frames** (real, detailed images — not
blanks). So it was never the same video twice; two different natives
resolved to the *same captured image* after page churn, and
`seenStreams` (which keys on URL) could not catch it.

Fix: a native-pass guard that compares each new clip's bytes against
the existing native shots and **drops a byte-identical repeat** —
refunding the byte budget, recording the stream, and continuing so the
`maxVideoShots` cap funds distinct content instead of a repeat. Scoped
to the native pass (facades never showed the problem). New spec:
duplicate-natives fixture → expects 1 shot.

Higgsfield localhost re-run: **12 videoShots, 12/12 distinct, zero
byte-duplicates** (was 10/12). Suite **351/351**, typecheck clean.

## Hypotheses (ranked by expected saving)

- **H1 — nav wait waste (~6%).** Every higgsfield run logs
  "Navigation with networkidle2 timed out after 12000ms; retried with
  domcontentloaded" → ~12 s pure loss on never-idle SPAs. Fix: bounded
  race (networkidle2 vs a shorter quiet window) keeping the retry as a
  safety net.
- **H2 — stale-clip re-measures (~20%).** 8 fired in the higgsfield
  production run; each ≈ a second capture cycle. Investigate whether
  the movement is caused by *our own* scroll/settle/lazy reflow rather
  than the target; if so, add pre-measure quiescence so the guard stops
  firing on false positives (guard stays in place).
- **H3 — unstarted poll cost.** Each native polls up to ~2 s before
  giving up (4 prod / 13 localhost). Fast-reject when autoplay is off,
  the element is muted, and there is no click affordance.
- **H4 — sequential scroll/settle** over a ~13 k px page × 25 videos.
  Consider per-band batching / reusing scroll positions.

## Candidate fixes (provisional — only after Phase 0)

- H1: shorten/replace the `networkidle2` wait; keep retry fallback.
- H2: quiesce layout before measuring; re-measure only on real movement.
- H3: early-exit the start poll.
- H4: cluster capture targets by scroll band.

## Success criteria

- ≥20% reduction in `browserSecondsUsed` on the higgsfield baseline
  with an **identical or better** capture set (12 videoShots,
  distinctness, unstarted disclosure unchanged).
- Suite green (`npm run test -w worker`: 350/350), typecheck clean.
- Verified localhost first, then one production confirm on a fresh
  meter.

## Out of scope / open decision

If micro-optimization still binds after Phase 0, the **$5/mo Paid
tier** removes the 600 s cap entirely and makes this whole problem
moot — revisit then.
