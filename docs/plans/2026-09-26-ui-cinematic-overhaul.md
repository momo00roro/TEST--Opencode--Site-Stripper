# UI cinematic overhaul — archived (2026-09-26, SUPERSEDED)

> **Superseded on 2026-09-27:** the dark cinematic theme shipped below was
> judged "AI-generated slop" during testing and replaced by the light-first
> `cline.bot` design system. See `2026-09-27-cline-reskin.md` and
> `docs/01-PRD.md § CF11`. This file merges the original design RFC and
> implementation plan (both historical record; originals removed 2026-09-30,
> full text in git history).

## Design brief (from the RFC)

Approved approach A: full visual overhaul of the Pages UI, presentation-layer
only (worker untouched), all panels keep their functions.

- Vibe: dark cinematic showcase. Near-black `#08090d` canvas, aurora washes
  (accent + deep violet, <12% opacity), one locked electric accent (blue
  lineage), success green for budget/complete only.
- Type: Space Grotesk display (Google Fonts CDN), system sans body, mono for
  stats/bytes/JSON. Hero `clamp(3rem, 8vw, 6rem)`, tight tracking.
- Texture: SVG-noise film grain at 3%; glassmorphic result cards.
- Bans: no AI-purple slop, no glass-everywhere, no Inter default.
- Zones: full-viewport hero + glass command-bar form; live analysis theater
  (Validate → Capture → Discover → Document → Package timeline, energy budget
  bar, skeleton shimmers); results showcase (featured shot + filmstrip +
  overlay viewer with keyboard nav, token chips, deliverable panel, raw JSON
  in `<details>`).
- Guardrails: element IDs, `api-base` logic, NDJSON protocol, ZIP assembly
  unchanged; a11y (focus-visible, aria-live, ≥4.5:1, reduced-motion
  collapses to instant changes); CDN weight <120 KB, fonts `display=swap`,
  GSAP deferred with no-CDN fallback.
- Rejected: B (type-led brutalist, starves theater/showcase), C (token
  reskin, not radical enough).

## What was implemented (from the plan, then replaced)

1. Cinematic tokens + CDN wiring (Space Grotesk, GSAP + ScrollTrigger).
2. Hero + glass command-bar form (same input IDs).
3. GSAP entrance motion, gated on `window.gsap` + `prefers-reduced-motion`.
4. Analysis theater: phased timeline + energy budget wired to NDJSON.
5. Results showcase: gallery viewer, page cards, deliverable panel.
6. Scroll reveals + a11y/weight audit; typecheck clean, 230/230 tests.

All six commits landed on `master` 2026-09-26, then the reskin (commits
`327cb51`–`ebef205`) painted over them 2026-09-27. Theater/showcase
*structures* (phase timeline, gallery, deliverable panel) survived; the dark
cinematic *visual world* did not.
