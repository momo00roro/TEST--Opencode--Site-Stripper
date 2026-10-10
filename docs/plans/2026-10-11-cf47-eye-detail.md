# CF47 — eye-comparison detail capture (softr.io lessons)

Date: 2026-10-11. Local-full only; hosted lite byte-identical (all fields stripped).

## Why

Side-by-side of live softr.io vs the 86.1 clone surfaced details the pack
never evidenced, each fixed by hand in the rebuild:

| # | Live truth | Pack said | Fix |
|---|---|---|---|
| 1 | H1 renders weight 800 | role sample 700 | record rendered leaf weight |
| 2 | Sign-in is borderless text | CTA fills have no border field | record `border` per CTA fill |
| 3 | Logo = inline-SVG mark; nav triggers have chevrons | neither evidenced (0-size SVGs skipped, 12-cap) | nav-chrome record: brandMark + dropdown labels |
| 4 | Chips + integrations are horizontal scroll strips | no overflow evidence (rebuilt as wrap/grid) | scroll-strip records (visible vs scroll width) |
| 5 | Body prose contains underlined links | no evidence | first-prose-link style record |
| 6 | Prompt placeholder rotates | single-read placeholder only | second-read placeholders in rotation block |
| 7 | Live changed days after capture (CTA panel) | no capture timestamp | `capturedAt` + recency rule |

Not pack gaps (already covered, rebuild-side misses): mini icon tiles
(iconFlags), hover values (CF46), tab panels (CF40).

## Capture (snapshot-script.ts, full-profile only, capped)

- `RawHeading.fontWeight` — same deepest-text-leaf target as CF43 family.
- `SnapshotCtaFill.border` — "none" or `"1px solid rgb(...)"` (style/width/color).
- `SnapshotNavChrome { brandMark: "svg"\|"img"\|"text"; dropdowns: string[≤6] }` —
  first header/nav; brand = first link with svg/img else text; dropdowns =
  links with a non-zero svg glyph or aria-haspopup/expanded (label slice 40).
- `SnapshotScrollStrip { label, visibleW, scrollW }[≤6]` — div/ul/section with
  scrollWidth > clientWidth + 8 and clientWidth > 200; label = aria-label or
  nearest preceding heading slice 60.
- `SnapshotProseLink { underline: boolean; color: string }` — first p > 40
  chars containing an <a>; first link's decoration + color.
- `collectPlaceholderTexts()` — inputs/textareas with placeholder (cap 6,
  label `input[i]`); capture.ts diffs before (snapshot.controls) vs after
  with existing `diffRotatingText` → `rotatingPlaceholders`.

## Wire-through

- capture.ts rotation block: placeholder before/after + `rotatingPlaceholders`
  on the capture result (same shape as rotatingText).
- analysis.ts: AnalysisPage += 5 fields + pass-through; lite-strip deletes
  them (+ headings.fontWeight); response root += `capturedAt` ISO.
- package-docs.mjs: display-face line += weight; CTA fills += border;
  §2 nav += brand mark + dropdowns; new REBUILD "Scroll strips" subsection +
  design-system idiom line; prose-link note; placeholder-rotation Known-gap
  line; README + report.json += capturedAt.
- PROMPT.md measurement checklist: display weight, CTA border, scroll-strip,
  recency rule (re-capture if pack older than ~14 days; verify nav/CTA live).

## Acceptance

- `worker/test/cf47-eye-detail.spec.ts`: weight/border/nav/strip/prose/
  placeholder units + lite-strip byte-identity (new fields gone, headings
  pruned) — green, one file at a time.
- `npm run typecheck -w worker` clean; server restarted (tsx-at-boot);
  fresh small capture shows the new fields end-to-end.

## Validation (2026-10-11, live softr.io via :8917)

- `capturedAt` stamped; H1 `{Satoshi Variable, 700}`; navChrome
  `{img, [Product, Solutions, Resources], [Pricing, Sign in, Book a demo,
  Start for free]}` with true fills/borders (Sign in transparent+borderless);
  6 scroll strips; proseLink with context; placeholder rotation structurally
  tested (slow live rotators don't fire inside the 5 s window — honest
  omission, documented).
- Fresh pack built from the capture carries every directive (Header chrome,
  Display-face weight, Scroll strips, Prose links, README Captured).
- CF47b fixes needed after first live look: most-links mis-picks hidden
  menu dumps → container-own-box + top<200 + min-links selection; brand
  scan depth 5→20; strips full-sweep (40-cap missed late DOM); prose
  majority vote + chrome exclusion; div-toggle structural dropdown
  detection (Webflow toggles aren't links).
- Eye-vs-measurement lesson: the eye read H1 as 800, computed leaf says
  700, and the pack shot scores higher at 700 — the extractor wins; the
  clone was reverted to 700. Ship the measurement, not the impression.
- Incidental repair: two stale expectations in
  `worker/test/snapshot-script.spec.ts` (CF43 fontFamily, CF45
  changedValues) updated — the file hadn't run green since those CFs.
