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
