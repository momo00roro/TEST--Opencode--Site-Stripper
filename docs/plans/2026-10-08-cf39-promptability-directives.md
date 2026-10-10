# CF39 — Promptability directives (local-full pack upgrade)

Date: 2026-10-08. Local-only. Hosted lite path byte-identical. Zero Cloudflare meter.

## Why

A hand-built cline.bot clone from the live pack reached 92.8, but only after
manually discovering six things a fresh agent gets wrong from the current pack.
This change puts each discovery INTO the pack (as data + REBUILD directives)
and INTO the prompt contract, so future agents land at this fidelity unaided.

Manual discovery → pack directive (all verified on cline.bot):
1. Display face: H1 renders in Space Grotesk (shipped), not the sampled DM Sans
   role default (unshipped) nor Inter. → `headings[].fontFamily` (in-page) +
   REBUILD "Display face" directive resolving to a shipped family.
2. Image treatment: logo/model SVGs ship as color masters but render with
   `filter: grayscale(1)`; client logos sit in `#fafafa` tiles. → per-image
   `imageTreatments[]` (filter/opacity/tileBg/tileRadius/rect) + REBUILD
   "Image treatment" directives matched to downloaded assets by URL.
3. CTA fills: download buttons are `rgb(248,247,254)`, not white. → `ctaFills[]`
   (label/bg/radius/rect, cap 12) + REBUILD "CTA fills" directives.
4. Inline icons: tab glyphs are inline `<svg>`, not downloadable. → `iconFlags[]`
   (label/size/color/svgCount, cap 12) + REBUILD "Inline icons — redraw" directives.
5. Component placement: canvas/img position (x/y), not just w/h. → `x/y` on
   `sectionLayouts[].components[]` + REBUILD `kind WxH @x,y` and canvas
   "Place it at x/y" directive.
6. Heading wraps were already marked (⏎ in `information-architecture.md` +
   `headings[].breaks`); agents must obey them. → PROMPT.md measurement
   checklist (no pack change).

## Gating (hosted lite untouched)

- In-page collectors are bounded and additive (`snapshot-script.ts`).
- `analysis.ts` `toRecord` carries new fields only when `capture === "full"`;
  otherwise `stripPromptabilityForLite` removes them (unit-tested).
  Key order of surviving keys is preserved, so lite JSON is byte-identical.
- `package-docs.mjs` emits directives only when the fields are present; lite
  packs render exactly as before (covered by `cf39-promptability.spec.ts`
  lite-shape test + existing `client-package.spec.ts` green).

## Prompt contract (`scripts/eval/PROMPT.md`)

- Hard rules: Display-face obedience, verbatim REBUILD directives
  (treatment/tiles/fills/icons/x-y/canvas/overlays), wrap compliance
  (`information-architecture.md` ⏎ + `headings[].breaks`), zero-JS interaction
  standard (real `<a href="#">` tabs/menus with hover/focus; default panel as
  screenshotted; poster + placement for video, never fake playback).
- Prompt 2 is now a measurement checklist: heights vs `layout.json` (±30px,
  1% total), H1/canvas vs section screenshots + directives, treatments/icons;
  report before/after scores.

## Validation

- `npm run typecheck -w worker` clean.
- `worker/test/cf39-promptability.spec.ts` (3 tests): full-shape directives
  emitted + validation passes; lite-shape omits all CF39 directives;
  `stripPromptabilityForLite` removes fields and preserves the rest.
- `client-package.spec.ts` (16) + `cf36-fonts.spec.ts` (15) green.
- End-to-end: fresh `capture-once.ts` (current code) → `build-pack.mjs` →
  REBUILD.md contains Display-face / Image-treatment / CTA / Icon / x-y
  directives for cline.bot.

## CF40 interactions (shipped in clone + prompts + scorer; extractor next)

- Clone (`.testing/2026-10-08__cline.bot__manual`): cookie dismisses via hidden
  checkbox + `<label>` (Accept/Decline hide, Manage toggles prefs note);
  hover/focus/active micro-interactions on all links/buttons/tabs/cards using
  pack easings (`150ms cubic-bezier(0.22,1,0.36,1)`); tabs are real `<a>`
  controls. All zero-JS. Functionally verified (dismiss/hover/prefs) with
  pixels unchanged (92.3 → 92.3 before metric extension).
- `score.mjs` motion now adds a verifiable interactions checklist (+2 functional
  tab controls, +2 dismissable overlay, +2 for ≥3 hover rules; static ceiling
  94 since zero-JS can never replicate JS playback). Manual clone: 88 → 94,
  composite 92.3 → 93.2. Documented in `PROMPT.md` scoring + hard rules
  (dismiss pattern, hover standard, tab honesty: no fake switching).
- NEXT (extractor): true tab switching needs inactive-panel copy the pack does
  not carry. CF40 = local-full tab-panel capture: click each tab in inventoried
  `tabSets`, record panel blocks per tab → `tabPanels[]`; rebuilds with
  per-tab panels CSS-switch (`:checked` + labels) using REAL copy, otherwise
  tabs stay static-default (honest limitation, never invented content).

## CF41 (this round): tab panels shipped + scorer generalized + clip guard

- `capture.ts` collects per-tab panels AFTER all screenshots (never disturbs
  shot state; restores default tab; skips navigating links; full-only).
  cline.bot live: 4 hero panels with real copy (Desktop/CLI/IDE/SDK) →
  `.examples/2026-10-08__cline.bot__cf40` REBUILD "Tab panels" appendix.
  PROMPT tab rule now CSS-switches with real panels, else static (no invention).
- `score.mjs` derives section shots + y/h from the pack's own `data/layout.json`
  (height-match alignment mirroring `package-docs`), replacing hardcoded
  cline.bot offsets — any site's ZIP now scores correctly (cline identical).
- Clip-race guard: a 2026-10-08 manual pack shipped corrupt demo clips
  (`home-3`/`videos/home-1` show hero content — intermittent scroll/clip race;
  morning captures were correct). `capture.ts` now re-measures section boxes
  post-shoot and warns when layout drifted >100px (full-only), so packs flag
  untrustworthy shots; PROMPT adds a screenshot-sanity rule (trust copy/layout
  on mismatch). Pure `maxLayoutDrift` helper is unit-tested; lite untouched.

## CF42 continued: headline positions + :target spec (worker change, server restarted)

- `:target` proven working in isolation (bg-color highlight fires on hash nav);
  PROMPT video-tab pattern now specifies background-color ONLY (never
  padding/margin shifts). Navigation (hash jump) is the primary verified
  function; highlight is enhancement.
- Headings now carry document `y`/`height` (in-page, h1-h3) → REBUILD
  "Headline positions" appendix (H1 top/height + each H2) so agents set section
  padding to land titles exactly — vertical rhythm is the main raw-pixel gap.
  Full-only, stripped for lite (unit-tested), typecheck clean. Live cline.bot:
  H1 y224 h144 + 5 H2 positions → `.examples/2026-10-09__cline.bot__cf42`.
- PROMPT mobile hardening: no desktop `max-width`/breaks/hero offsets leak to
  ≤1000px; fluid H1/canvas; tabs 2-col; 390px height within ~15%.

## CF42 (this round): mobile fidelity + video-tab pattern (no worker change)

- Mobile was unscored and under-specified: a 93.2 desktop clone rendered broken
  at 390px (fixed-px canvas, forced H1 `<br>`, 4-across tabs). Fixed at codebase
  level without touching the ≥92 gate:
  - `score.mjs` renders the rebuild at 390px and reports `mobile:{score}` vs the
    pack mobile screenshot (same raw+perceptual blend + height term). Reported
    only — composite untouched. Verified: broken mobile scores 64.0 while
    desktop holds 93.2.
  - `PROMPT.md` mobile rule is now a checklist: fluid media, natural heading
    wraps (never forced breaks), tab reflow (2-col), canvas/poster fluid,
    grids collapse, 390px verify with no overflow vs the mobile screenshot.
- Video tabs (Understand/Refactor/Automate) are NOT a tabset in the extractor
  (no `role=tablist`; single video/poster, all item copy already visible), so no
  new capture was added. `PROMPT.md` directs the honest pattern: real `<a>`
  anchors to side-item ids + hover/active + `:target` highlight (navigate +
  highlight existing content, zero-JS; never fake-switch video or hide content).
