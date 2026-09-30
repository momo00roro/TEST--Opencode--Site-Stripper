# Fidelity pack (CF14–CF17) — make one-shot rebuilds reach ~90%

Status: Implemented and verified 2026-09-29. `npm run test -w worker`: 285
passing (253 baseline + 32 new). `npm run typecheck -w worker`: clean. No
LIMITS changes; no payload-cap changes.

Refinement round (same day): (a) posters may live on third-party CDNs, so
poster kind skips the same-origin equality check at resolution AND
validation AND redirect-landing — but ALWAYS keeps `assertPublicTarget`
(SSRF guard), content-type sniffing, and caps; logos/images keep the strict
same-origin rule. (b) Posters accept `image/webp`. (c) Marquee sweep:
`[class*="marquee|ticker|carousel|slider|slide-track"]` + `[data-marquee]`
pass (max 8) catches scrollers outside the 30-selector sample, deduped.
(d) Validators mirror the 20-sections-per-page cap of `buildLayout` /
`buildRebuildMd` and skip pre-`sectionLayouts` pages. (e) `imagery-and-
video.md` gains a `## Videos` section from `SnapshotVideo` records.
(f) Rehydration limitation line carries a per-kind breakdown.

## Problem (proven by dogfood)

The `.testing/2026-09-28__figma.com/` rebuild started at ~60% and needed 5+
manual rounds to reach ~90%. Every round traced to pack gaps, not agent skill:

1. **No pixels**: all 40 figma assets were `reference-only`, so the first pass
   built CSS-gradient dummies. (Cline was saved only by 18 downloaded SVGs.)
2. **Blank video bands**: videos capture unloaded; nothing says "video region,
   screenshot shows nothing, here is the poster + playback flags".
3. **Flat footer links**: heading→list association not recorded (had to DOM-walk live).
4. **No behaviors**: fixed-vs-static banners, stacked-vs-horizontal forms,
   all-visible-vs-switching tabs, marquee animation, text-transform — invisible.
5. **No mobile sections**: only a total height; mobile tuned blind.
6. **Fonts named, not shipped**: WOFF2 hand-fetched.
7. **Researcher-shaped docs**: 8 cross-referenced files, no ordered build spec.

## Scope (this plan)

- CF14: poster-capture — video poster/flag metadata + binary ship.
- CF15: computed-behavior pass — positions, forms, tabs, animation, casing.
- CF16: `data/layout.json` — machine-readable section layout.
- CF17: `REBUILD.md` — ordered agent build spec.
- Out: temporal sampling (rotation detection), per-section exemplars, font
  binaries — queued as follow-ups, not this plan.

## CF14 — poster-capture

### Snapshot (`worker/src/browser/snapshot-script.ts`, zero-import, literals only)

- New asset kind `poster`: collect from `video[poster]`, `vimeo-video[poster]`,
  `[data-poster]`, `meta[property="og:image"]` already covers hero. Fields on
  `SnapshotAsset`: keep `url/kind/alt/width/height/usedOn`; add nothing (reuse).
- New `SnapshotVideo` entries on the page record (cap 6, tiny): `{ url,
  poster, autoplay, muted, loop, playsinline, rectY, rectHeight }` collected
  from `video`, `vimeo-video[src]`, `[data-video]`. Reuse embed-rect helper.
- Manifest cap unchanged (100/page); posters count as normal entries.

### Rehydrate (`worker/src/pipeline/rehydrate-assets.ts`)

- `REHYDRATABLE_KINDS` += `poster`. Same-origin + optimizer unwrap + CF02
  validator, unchanged.
- Binary path (jpg/png only): accept `image/jpeg` + `image/png`; store
  `content` as `Uint8Array` (never text-decode); `assetFilename()` keeps
  `.svg` for SVG kinds, uses `.jpg`/`.png` from content-type otherwise.
- Caps: share existing per-file 50 KB / total 512 KB / 40 files (no new
  LIMITS; posters that exceed stay `reference-only` with `skipReason`).
- `SnapshotAsset.content` widens to `string | Uint8Array`; `bytes` stays
  byte length. New skip reasons reuse the taxonomy
  (`non-jpeg-content-type` style follows `non-svg-content-type`).

### Packaging (`web/package-docs.mjs`)

- Fan-out accepts `Uint8Array` content into `files[localPath]` (ZIP STORE
  handles raw bytes today for screenshots).
- `validateDocumentationPackage`: downloaded poster without matching file
  fails, same as SVG rule.
- `imagery-and-video.md`: list posters with dimensions + playback flags from
  the new video records.

### Tests (TDD)

- `worker/test/snapshot-script.spec.ts`: poster attr + video flags collected,
  caps respected.
- `worker/test/rehydrate-assets.spec.ts`: jpg downloads as bytes, png
  accepted, gif/webp rejected with reason, oversize respected, SVG path
  unchanged (all existing tests keep passing).
- Package-docs spec: `Uint8Array` fan-out + missing-file validation (extend
  existing CF13 describes).

## CF15 — computed-behavior pass

### Snapshot additions (all bounded, all cheap `getComputedStyle` reads)

- `SnapshotLayoutSample` gains optional: `position`, `flexDirection`,
  `textTransform` (covers sticky/fixed nav, stacked forms, PRODUCT casing).
- New `SnapshotTabSet` on content (cap 4 sets, 8 tabs each): `{ label,
  selected, panelVisible }` per tab — collected from
  `[role=tablist]`/`[role=tab]` + common tab classes; panel visibility via
  `hidden` attr / `display`. Distinguishes all-visible (cline work) from
  switching sets.
- `SnapshotMotion` gains `animatedSelectors: string[]` (cap 12): selectors
  whose computed `animation-name` is not `none` (marquee/ticker detection).
- Footer grouping: emit `content.footerGroups: { heading, links[] }[]`
  (cap 8 groups, 20 links each) by walking footer containers for
  heading→list association (the exact DOM walk validated live on cline.bot).

### Pass-through (`worker/src/pipeline/analysis.ts`)

- `toRecord`: add each field (one line each) + `AnalysisPage` type entries.
  Page-level `assets` stay reference-only (no byte duplication).

### Tests (TDD)

- `snapshot-script.spec.ts`: position/flex/transform sampled; tab sets with
  mixed visible/hidden panels; animated selector captured; footer groups
  grouped correctly.
- `pipeline-analysis.spec.ts`: fields pass through to records.

## CF16 — `data/layout.json`

### Builder (`web/package-docs.mjs`)

- `buildLayout(pages)`: per page, per `content.sections` entry (cap 20):
  `{ heading, rect (from sectionRects by order), textAlign, columns,
  background, components[] }` where `columns` derives from computed
  grid/flex of the section's first layout container and `components` lists
  `{ kind, box }` for `img, video, canvas, form, table` descendants
  (cap 12, boxes from getBoundingClientRect at capture — new tiny snapshot
  field `sectionLayouts`, cap 20×12, pruned like other collections).
- `data/layout.json`: `json({ pages: [{ url, sections }] })`.
- Validation: required file + JSON-parseable + section count matches
  `pages.json` entry.

### Tests

- Package-docs spec: layout built from fixture, validation fails when
  missing/mismatched.

## CF17 — `REBUILD.md`

### Builder (`web/package-docs.mjs`)

- `buildRebuildMd(analysis)`: ordered spec — global tokens/fonts, then per
  section in order: copy blocks, layout (from CF16 data), assets (localPath
  first), behaviors (CF15 flags), then explicit "Known gaps" section from
  `report.limitations` + reference-only asset count. Machine-checkable
  structure (`## Section N: <heading>` headers).
- Validation: required file + contains one `## Section` header per homepage
  section.

### Tests

- Package-docs spec: headers match fixture sections; gaps section lists
  reference-only counts.

## Acceptance

- `npm run test -w worker`: all pass (current 253 + new).
- `npm run typecheck -w worker`: clean.
- No LIMITS changes; no payload-cap changes (new snapshot fields bounded:
  videos 6, tab sets 4×8, animated 12, footer groups 8×20, sectionLayouts
  20×12).
- Zero-import / serializability guard for `snapshot-script.ts` still passes.

## CF18 — heading line-breaks

- Snapshot (`RawHeading.breaks: number[]`, required): per-word `Range`
  rects over the heading's text nodes; a rounded-top change records the word
  index starting the new line. h1-h3 only, first 12 measured; 60 words and 8
  breaks per heading; any DOM API gap yields `[]`, never throws.
- Docs: `information-architecture.md` renders `⏎` markers with a legend;
  `REBUILD.md` header points at `headings[].breaks`; `data/pages.json`
  carries the raw indices.

## CF19 — split rehydration budget (two-pass, same caps)

- `rehydrateAssets` resolves targets/eligibility first (no fetch, no cap
  use), then downloads eligible non-posters in document order, then eligible
  posters with the remainder. Filenames keep manifest order. Posters can no
  longer starve logos/icons under the file-count or total-byte caps.
- Poster CDN carve-out (same-origin skipped, `assertPublicTarget` kept)
  applies at resolution, validation, and redirect-landing; other kinds keep
  the strict same-origin rule. Posters accept jpeg/png/webp.

## CF20 — rotation re-sample (+5s diff, homepage only)

- `capturePage({ detectRotationMs })`: after the snapshot, the worker waits,
  re-reads h1-h3 texts via serialized `collectHeadingTexts`, and diffs with
  `labelSnapshotHeadings`/`diffRotatingText` (paired by index + label).
  Results merge into `content.rotatingText`; a clean check is disclosed as a
  limitation (slower rotations stay undetected).
- Opt-in at every layer (`captureOne`, `AnalysisOptions`, route deps default
  5000, unit tests off) so the suite pays no delay tax. Surfaced in
  `motion-and-interactions.md` with cycle-them-don't-freeze wording.
