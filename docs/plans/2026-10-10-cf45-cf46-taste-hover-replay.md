# CF45 + CF46 — taste capture & observed hover replay (2026-10-09/10)

## CF45: taste capture — measure the micro-decisions
Thesis: "taste" gaps are unmeasured micro-decisions. Six additions, all
local-full + lite-stripped (`stripPromptabilityForLite`, incl. tabSets
separator key and heading margin keys):
- `SnapshotCtaFill` += padding/fontSize/fontWeight → REBUILD CTA lines.
- `SnapshotImageTreatment` += tilePadding (wrapper padding) → treatment lines.
- `SnapshotTabSet` += separators (majority vote of tab border-sides; boxed
  tabs excluded) → section Tabs lines + design-system dividers rule.
- `SnapshotHoverState` += changedValues ("prop: value", capped) → motion doc
  + design-system micro-motion example (prefers transform-bearing rules).
- New `SnapshotEyebrow[]` (short tracked uppercase labels near headings;
  textTransform-aware) → REBUILD type-scale eyebrow line + design-system rule.
- `RawHeading` += marginTop/marginBottom (non-zero only) → headline positions
  + design-system title rhythm.
- Spec: `worker/test/cf45-design-taste.spec.ts` (3 tests).
- Verified live on cline.bot: eyebrow "WHAT CLINE DOES" (SG 11px/400, ls
  1.98px, purple), Download buttons padding 12px 18px/400, tile padding
  24px 32px, dividers `1px solid rgba(21,21,22,0.06)`, H2 margin-top 18px.

## CF46: observed hover replay
Trigger: base44 use-case cards flip to orange (#ff6a00, links → white) on
hover via JS — invisible to static CSS parsing (all 12 hoverStates were
`.br-` runtime rules; the cap filled before marketing rules). Fix: after
screenshots, hover candidates with a trusted pointer (synthetic-event
fallback) and record computed-style deltas.
- `capture.ts`: `collectObservedHovers` (candidates = links/buttons/ARIA,
  cap 8, + container DIVs pointer-cursor/link-wrapping mid-size largest-first;
  scroll-into-view nearest + settle; 650ms settle; mouse-away + Escape
  restore). Records bg/color/border/transform/opacity + nested-link color
  (`linkColor`). Gated by `collectHoverEffects: !liteCapture`.
- Traps fixed during validation: innermost-first picked transparent wrappers;
  ancestor-skip killed link-wrapping cards; smooth-scroll stale coords;
  descendant white needed explicit nested-link reads.
- `snapshot-script.ts`: h3→heading-3, h4→heading-4 roles; semanticStyles
  cap 8→12 (card titles 36px/600 now in type scale).
- Docs: REBUILD "Observed hover effects" + design-system §5 replay lines
  (`linkColor` rendered as "nested links/buttons color"); PROMPT.md Prompt-1
  prioritizes observed effects verbatim.
- Spec: `worker/test/cf46-hover-replay.spec.ts` (4 tests).
- Verified live on base44.com (4 captures): `"Apps…": bg #f9f7f4 → #ff6a00`;
  rebuild replays it exactly (computed match). Named custom properties
  (`--orange`, `--sand`, …) were already preserved via extensions + theme.css.
- Texture verdict (measured): blue panel is flat rgb(57,80,230); paper dot
  grid re-measured (pitch ~13.5px after bad samples hit white UI elements).

## Validation state (2026-10-10)
- cline.bot 1-prompt: 93.1–93.2 composite (layout ~85 / tokens ~99 /
  copy ~100 / motion 94). Expansion (pricing + table + FAQ + pass.html):
  expand-check PASS.
- base44.com 1-prompt: 83.0–83.7 (layout ~72 / tokens ~93 / copy 100 /
  motion 72) + About page (expand-check PASS). Bounded by dynamic content
  (rotating prompt, marquee strip states, photo band) + Dazzed cut shear —
  see session notes; honest ceiling ~85 pending dynamic-region strategy.
- Showcase: 15 rebuilds published at `https://site-stripper-tests.pages.dev`
  (separate Pages project; main `site-stripper-ui` untouched).
