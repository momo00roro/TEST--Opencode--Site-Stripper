# UI Cinematic Overhaul — Design (2026-09-26)

Approved approach A. Full visual overhaul of the Site Stripper Pages UI;
all panels keep their functions. Presentation-layer only: worker untouched.

## Brief

- Scope: full visual overhaul (replace visual world, keep product truth + functions).
- Vibe: dark cinematic showcase. Operate core, Persuade first impression.
- Constraints: static files + CDN libraries allowed (fonts, GSAP). No build step.
- Flagship zones: hero + live analysis theater + results showcase.
- Taste v2 design read: devtool with portfolio-grade soul, cinematic dark,
  near-black canvas, one electric accent, big display type, GSAP reveals.

## Section 1 — Visual world

- Palette: near-black `#08090d` canvas; aurora washes (accent + deep violet,
  <12% opacity). One locked electric accent (blue lineage, ~85% saturation);
  success green for budget/complete only.
- Type: Space Grotesk (Google Fonts CDN) for display; system sans body;
  mono for stats/bytes/JSON. Hero `clamp(3rem, 8vw, 6rem)`, tight tracking.
- Texture: SVG-noise film grain at 3%; glassmorphic result cards.
- Bans: no AI-purple slop, no glass-everywhere, no Inter default.

## Section 2 — Hero + form

- Full-viewport opener: eyebrow, giant two-line headline, monster logo
  restaged as glowing mark (copy TBD at implementation).
- Analyze form as floating glass command-bar: dominant URL field, inline
  max-pages + mobile toggle, accent CTA submit. Scroll cue onward.
- GSAP staggered entrance, aurora drift, magnetic CTA hover.

## Section 3 — Live analysis theater

- Phased timeline (Validate → Capture → Discover → Document → Package)
  driven by NDJSON progress events; elapsed timer; live page counter.
- Budget meter as depleting energy bar with readout.
- Kinetic status text; skeleton shimmer cards pre-lay results zones.
- Reduced-motion collapses to instant state changes.

## Section 4 — Results showcase

- Featured desktop shot + filmstrip + click-to-view overlay with keyboard
  nav; mobile shots in device frame. Designed empty state for hosted
  metadata-only runs.
- Page cards with token chips + coverage bars; download panel as the
  deliverable moment; raw JSON in a collapsed details drawer.
- ScrollTrigger reveals, staggered, single batch.

## Section 5 — Guardrails

- Unchanged contracts: element IDs, `api-base` same-origin logic, NDJSON
  consumption, ZIP assembly, panel show/hide. Worker untouched; 230/230 green.
- A11y: focus-visible, aria-live kept, ≥4.5:1 body contrast, reduced-motion,
  no viewport traps.
- Perf: added CDN weight target <120 KB; fonts `display=swap`, GSAP deferred.

## Alternatives rejected

- B (type-led brutalist): cheaper but starves theater/showcase goals.
- C (token reskin): safe but not radical; fails the stated goal.
