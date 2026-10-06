# CF34-local — Homepage-fidelity extraction (design)

Date: 2026-10-06. Local-only. Hosted lite path untouched. Zero Cloudflare meter.

## §1 Goal & measurement

Goal: localhost pack lets an AI agent rebuild the HOMEPAGE ONLY (1 page each,
no inner pages) of cline.bot and higgsfield.ai to ≥92% fidelity without
viewing the live site — pack only.

- Benchmark pair: Site A cline.bot (content/marketing, prior rebuild ~85–90%),
  Site B higgsfield.ai (interactive/media, video facades, motion).
- Score = 40% layout/section order + 25% tokens (palette/type/spacing/radii/
  shadows) + 20% copy/structure + 15% motion/interactions (video = poster +
  placement, never fake playback).
- Pass = ≥92% on cline.bot; higgsfield ≥90% accepted (video-heavy) with all
  gaps listed in report.json.limitations.
- Rebuild outputs live in `.testing/2026-10-06__cline.bot/` and
  `.testing/2026-10-06__higgsfield.ai/` (homepage only).
- Gate: everything new runs under capture:"full" or ?pack=v2.

## §2 Extractor deepening (local-only)

In worker/src/browser/snapshot-script.ts (in-page) + worker/src/browser/
capture.ts full-profile only:

- Per-section computed-style samples: attach top-5 props per section (bg,
  type, spacing, radius, border) to existing section boxes + semantic roles.
- Token aliasing: cluster raw values → semantic names (brand/primary,
  surface/sunken); keep raw map for traceability. Dark/light pairing where
  body scheme props differ from :root.
- Motion dump: full keyframes + per-element duration/easing/delay +
  scroll-reveal map (record which sections change opacity/transform during
  the existing 0.8-band scroll).
- Event-listener inventory via local Chrome CDP (never hosted): trigger →
  effect pairs for menus/tabs/carousels.
- All new fields optional + capped (350KB warn / 512KB hard payload budget).
  Hosted lite never sees them.

## §3 Pack outputs (client-render, web/package-docs.mjs)

New/upgraded files in the ZIP, homepage-only:

- REBUILD.md — dependency-ordered build spec: tokens → layout shell →
  section-by-section (screenshot ref + token refs + copy block + acceptance
  checkbox each).
- data/motion.json + motion-and-interactions.md — timeline table (element,
  keyframes, duration/easing/delay, scroll-trigger) + GSAP transcription
  snippet per animated block.
- data/components.json + components.md — inventory from fingerprint repeats
  (hero, nav, card, grid) with variant props.
- theme.v2.css (@layer tokens/base/components, clamp() type) +
  tailwind.theme.mjs (v4 @theme) alongside existing files — additive.
- screenshots/annotated/ (section boxes + heading order, Node-canvas local
  render) + responsive-pairs/ (desktop/mobile homepage side-by-side).

## §4 Testing & acceptance

- npm run typecheck -w worker from root (zero errors); spec files run
  separately (full suite OOMs) — new worker/test/cf34-local-pack.spec.ts for
  aliasing + motion timeline + REBUILD ordering.
- Local proof, no CF meter: maxPages 1, homepage only; captures to
  C:\Users\Admin\AppData\Local\Temp\opencode\ab\; packs in gitignored
  .examples/.
- Rebuild trial: agent builds homepage-only from pack alone into the two
  .testing/ folders above, scored by the §1 rubric. Gaps →
  report.json.limitations, never silent.
- Failure modes: payload over budget → prune + limit note; unplayable video
  → poster + placement (honest thumbnail: label); missing font → system
  stack + limitation entry.

Next: CF35-local (HiDPI heroes, expanded SVG set, font refs, interaction
state machines, storyboard UI) only if higgsfield still gaps after CF34.
