# CF43 + CF44 — drift surfacing, rendered heading families, expansion kit

## CF43: capture warnings reach the agent + H1 family fix (2026-10-09)

**Bugs found via fresh capture-once on cline.bot:**
1. H1 `fontFamily` recorded as "DM Sans" (wrong — renders Space Grotesk). Root cause: extractor read the heading element's own computed stack (inherited body stack) while the glyphs render in an inner SPAN's face. Proved live via probe (H1 own `"DM Sans", ...` vs leaf SPAN `"Space Grotesk", ...`).
2. CF41 `maxLayoutDrift` computed but discarded; drift `warnings.push` never reached REBUILD.md Known gaps (only `limitations` render there). The 09-manual-2 user ZIP also proved packs can ship with zero tabPanels data while the template still prints the section header.

**Changes (local-full only, lite byte-identical):**
- `worker/src/browser/snapshot-script.ts` — heading family resolved from the deepest rendered text leaf (TreeWalker SHOW_TEXT → parentElement), falls back to the heading itself.
- `worker/src/browser/capture.ts` — `CaptureResult.layoutDriftPx?: number` (rounded; present only when the CF41 guard ran).
- `worker/src/pipeline/analysis.ts` — threaded onto the page record; stripped by `stripPromptabilityForLite`.
- `web/package-docs.mjs` — Known gaps now emits page warnings + `Layout drift Npx` lines (bounded 6, raw-text deduped across page/analysis levels).
- `worker/test/cf40-tabpanels.spec.ts` — new `CF43 drift surfacing` describe (emit on shift / quiet when clean / lite-strip).

**Verified:** fresh capture H1 = Space Grotesk y224 h144; drift 0 on clean run; cf43 pack carries display-face + headline positions + tab panels + warnings; typecheck clean; cf40 6/6.

## CF44: expansion kit — new sections/pages in the same UI system (2026-10-09)

**Goal:** an agent given only the pack extends the site (new sections, new pages) without drifting off art direction.

**Changes:**
- `web/package-docs.mjs` — new `buildDesignSystemMd()` → `design-system.md` in every pack (automatic via docs map; additive, validation untouched). Sections: palette roles+aliases, display/body faces + scale, spacing/radii/shadow scales, component recipes (buttons/tiles/tabs/icons/shell), motion timings, grid+observed reflow, imagery rules, voice + 5-step section / new-page recipes + Constraints. Every rule marked Observed (with source) or House rule (pack-wide zero-JS/mobile standards). Degrades honestly on lite-shaped data (tested).
- `scripts/eval/PROMPT.md` — Prompt 3 (expand) + expansion scoring; title now 1–3 prompts.
- `scripts/eval/expand-check.mjs` — adherence gate: anti-cheat + fonts ⊆ shipped + colors within Δ36 of observed palette (aliases + token colors + role/CTA/tile/icon colors) + radii ∈ observed scale or pill/circle tokens + 1440px error-free + 390px zero-overflow renders. `--base` diffs so only NEW violations fail (base approximations grandfathered).
- `worker/test/cf44-design-system.spec.ts` — 3 tests (full emit / lite degrade / empty fallback).

**Validation (cline.bot cf43 pack):**
- 1-prompt clone `.testing/2026-10-09__cline.bot__cf43` → **93.1 composite** (layout 85.7 / tokens 99.3 / copy 99.5 / motion 94); geometry within 6px all sections, headlines within 4px; mobile H1 wraps unclipped (max-width ban verified visually). Tightness round ported from the manual-1 reference (H1 weight 500, Display-face buttons, tab dividers, width-based logo sizing, bigger CTA, taller cookie bar) — each verified by re-score.
- Expansion sandbox `.testing/2026-10-09__cline.bot__expand` (clone + Pricing cards + Compare-plans table + FAQ accordion + new `pass.html` ClinePass page, built from design-system.md only): **expand-check PASS** — zero new font/color/radius violations, both pages error-free, zero overflow at 390px. Negative control (Comic Sans + #ff2fb3 + 13px) correctly fails.
- Checker calibration notes: skips `var()` font indirection + system-font fallbacks; pill/circle radii (999px/50%/100%) always allowed; observed 9999px present on cline.bot. Base clone carries 22 color + 4 radii grandfathered approximations (eyeballed grays, 12/14/9/7px radii) — future extractor work (measured gray roles, tileRadius), not checker loosening.

## Open
- higgsfield.ai never run through the loop. Commit only if asked.

## CF45: taste capture — measure the micro-decisions (2026-10-09)

**Thesis:** "taste" gaps are unmeasured micro-decisions (button padding, tile padding, eyebrow spec, tab dividers, hover values, title margins). CF45 captures six, all local-full + lite-stripped:
- `SnapshotCtaFill` += padding/fontSize/fontWeight → REBUILD CTA lines carry box metrics.
- `SnapshotImageTreatment` += tilePadding (wrapper padding) → treatment lines.
- `SnapshotTabSet` += separators (majority vote of tab border-sides; boxed tabs excluded) → section Tabs lines + design-system dividers rule. Separators stripped from `content.tabSets` for lite.
- `SnapshotHoverState` += changedValues ("prop: value", capped) → motion doc + design-system micro-motion example (prefers transform-bearing rules).
- New `SnapshotEyebrow[]` (short tracked uppercase labels near headings; textTransform-aware) → REBUILD type-scale eyebrow line + design-system kicker rule.
- `RawHeading` += marginTop/marginBottom (non-zero only) → headline positions + design-system title rhythm.

**Live proof (cline.bot):** eyebrow "WHAT CLINE DOES" SG 11px/400 ls 1.98px purple; Download buttons padding 12px 18px/400 166×48; tile padding 24px 32px; dividers `1px solid rgba(21,21,22,0.06)`; H2 margin-top 18px. Clone retuned to all six (tiles/dividers/buttons/eyebrow) — geometry exact (all sections ±1px), score holds **93.1**.
- `worker/test/cf45-design-taste.spec.ts` (3 tests: REBUILD directives / design-system rules / lite-strip).
- `expand-check.mjs`: new non-failing `typeScale.advisoryUnobserved` (font sizes outside observed scale; dogfooded — pass.html H1 56→48px).
- cf45 pack (91 files) carries every directive; verified in REBUILD + design-system.md.

## CF46: observed hover replay + h3/h4 roles + named customs (2026-10-09)

**Trigger:** base44 use-case cards flip to orange (#ff6a00, links → white) on hover via JS — invisible to static CSS parsing (all 12 hoverStates were `.br-` runtime rules; the 12-cap filled before marketing rules).

**Changes:**
- `capture.ts`: `collectObservedHovers` (node-side, post-screenshots): candidates = links/buttons/ARIA (cap 8) + container DIVs (pointer-cursor or link-wrapping, mid-size, largest-first); per candidate scroll-into-view (nearest + settle) → trusted `mouse.move` (synthetic-event fallback) → 650ms settle → diff bg/color/border/transform/opacity + nested-link color → restore (mouse-away + Escape). Gated by `collectHoverEffects: !liteCapture` (plumbed through analysis call sites). Returns `hoverEffects[]`.
- Lessons encoded: innermost-first picked transparent wrappers (fix: largest-first); ancestor-skip killed cards wrapping CTAs (removed); smooth-scroll stale coords (fix: nearest + settle + fresh read); missed link-white (descendant color now recorded as `linkColor`).
- `snapshot-script.ts`: h3→heading-3, h4→heading-4 role mapping; semanticStyles cap 8→12.
- `analysis.ts`: `hoverEffects` record + lite-strip (incl. tabSets separators from CF45).
- `package-docs.mjs`: REBUILD "Observed hover effects" section + design-system §5 replay lines + `linkColor` rendered as "nested links/buttons color".
- `PROMPT.md`: Prompt-1 hover rule now prioritizes observed effects verbatim.
- `worker/test/cf46-hover-replay.spec.ts` (4 tests).
- Verified live on base44 (3 captures): `"Apps…": bg #f9f7f4 → #ff6a00` (+ heading-3 36px/600); clone replays it EXACTLY (computed match). cf46 example pack (92 files) carries the directive.
- Named custom properties were already preserved (extensions + theme.css) — no fix needed; agents must consult theme.css/design-tokens.md.
- Texture verdict (measured): blue panel is FLAT rgb(57,80,230) (no image, no grain overlay, no pseudo-elements) — clone already matches; paper dot grid re-measured (pitch ~13.5px, dots ~rgb(222) on ~rgb(237)) after bad samples hit white UI elements; clone reverted to #edebea + staggered dots.
