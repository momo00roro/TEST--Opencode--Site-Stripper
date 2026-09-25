# Evidence-First Website Documentation Implementation Plan

> **Implementation complete (2026-09-23):** `npm run typecheck -w worker` passes; `npm test -w worker` passes with 200 tests across 16 files. Local Browser/ZIP smoke checks were performed against sold.com.sg. Hosted Browser Rendering verification remains pending.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make bounded browser observations the single source of truth for complete, verifiable JSON/Markdown documentation and move package rendering/ZIP work to the client, preserving Cloudflare Free-tier limits.

**Architecture:** Chromium extracts richer, field-bounded content, styles, component patterns, control affordances, and responsive evidence under the existing 512 KB/page limit. The Worker sequences and passes observations through without generating duplicate documentation files. A browser-side ESM package builder renders JSON/Markdown/theme files, validates screenshot manifest membership, and passes the package to the existing STORE ZIP writer.

**Tech Stack:** TypeScript, self-contained `page.evaluate()` extractor, Cloudflare Workers/Browser Rendering, browser ESM JavaScript, Vitest, existing STORE ZIP writer.

---

## Guardrails / Definition of Done

- No changes raise the Cloudflare Free-tier browser time, CPU, concurrency, screenshot, or per-page extraction limits.
- `collectPageSnapshot()` remains self-contained and performs DOM/CSS work in Chromium only.
- Worker does not build Markdown, reformat full JSON documents, base64-encode images, or ZIP.
- Per-page serialized observation remains `<= 512 * 1024` bytes. If pruned, exact collection counts/caps/reasons appear in the report.
- UI builds the documentation and ZIP; client package limit is increased enough for observations and all bounded assets, with an explicit hard stop/report rather than silent truncation.
- `data/pages.json` is the canonical emitted evidence. Every Markdown file is a projection from the same records.
- Report integrity distinguishes schema/ZIP consistency from partial observation coverage.
- Local typecheck/full worker tests pass; local sample analysis confirms ZIP output. Hosted Browser Rendering verification is still required before production-readiness claims.

## Task 1: Extend canonical extraction evidence

**Files:**
- Modify: `worker/src/browser/snapshot-script.ts`
- Modify: `worker/test/snapshot-script.spec.ts`
- Modify: `worker/test/helpers.ts`

**Step 1: Add failing tests for source-ordered content blocks**

Cover headings, paragraphs longer than the old 300-character clip, blockquotes, lists/list items, `details/summary`, and FAQ-like labelled content. Assert source order, type/role, exact text within the documented new field limit, and truncation metadata when a text block exceeds that limit.

**Step 2: Run focused tests and confirm the new assertions fail**

Run: `npx vitest run test/snapshot-script.spec.ts`

Expected: new tests fail because the extractor only emits separate short paragraph/list/button arrays and 200-character section excerpts.

**Step 3: Define bounded content/control/component/completeness types**

In `snapshot-script.ts`, add compact JSON-safe types for:

- Ordered content blocks: source order, semantic kind, heading level when relevant, section index when determinable, text, text-truncated flag.
- Form/control evidence: role/type, label, name/id, required/disabled, option labels, selected ARIA relationship/state; never input values.
- Component pattern evidence: stable kind/signature, occurrence count, representative section/order, concise structural features. Avoid raw HTML and unbounded class names.
- Interaction affordances: kind, count, concise labels/relationships, observed static state; do not claim behavior was replayed.
- Collection accounting: source count, emitted count, configured cap, truncation/pruned flag and reason for every bounded collection.

Keep arrays, each string and total payload bounded with literals inside the serialized function. Avoid additional full-document traversals when an existing query can supply the evidence.

**Step 4: Implement semantic observations and deterministic prioritization**

Read DOM text only. Preserve visual/content order; capture high-value headings, visible paragraphs, lists, labels, summary/details, links and controls before lower-priority generic blocks. Record counts before applying caps. Make each block’s own truncation explicit. Avoid treating hidden/inaccessible content as observed visible copy.

**Step 5: Implement explainable component/interaction summaries**

Use bounded selector groups and stable lightweight signatures over semantic tags/roles and a small safe set of structural hints. Group repeated patterns with occurrence counts and representative locations. Capture `aria-expanded`, `aria-controls`, `aria-labelledby`, form control types/options, native `details`, dialog open state, media controls, and carousel-like patterns where present. Do not click, submit, or read entered values.

**Step 6: Make pruning preserve priority evidence and report losses**

Update both 350 KB warning pruning and 512 KB emergency pruning to prioritize structural headings, ordered content, forms/controls, interactions, component patterns and essential tokens before decorative/low-frequency details. After pruning, recompute emitted counters and include exact affected collection names and counts. Ensure the returned object—not only an intermediate estimate—stays under 512 KB.

**Step 7: Run focused extraction tests**

Run: `npx vitest run test/snapshot-script.spec.ts`

Expected: all extractor tests pass, including serialized payload ceiling and accurate cap/truncation fields.

## Task 2: Make page records preserve evidence and real viewport comparison

**Files:**
- Modify: `worker/src/pipeline/analysis.ts`
- Modify: `worker/test/pipeline-analysis.spec.ts`
- Modify: `worker/test/analyze-endpoint.spec.ts`
- Modify: `worker/src/config/limits.ts` only if new numeric limits need named documentation; do not raise existing ceilings.

**Step 1: Add failing pass-through and responsive tests**

Assert canonical content/control/component/completeness records survive `toRecord()` unchanged. For mobile captures, assert a compact responsive record is created from the already-returned mobile snapshot for homepage and the representative page, including both viewport widths and explicit unavailable/unknown status when mobile is disabled or capture fails.

**Step 2: Run focused tests and confirm failure**

Run: `npx vitest run test/pipeline-analysis.spec.ts test/analyze-endpoint.spec.ts`

Expected: new fields are currently absent or mobile snapshot data is discarded.

**Step 3: Pass through canonical per-page observations**

Add the new evidence to `AnalysisPage` and `toRecord()` by reference. Keep Worker aggregation limited to existing bounded counters/deduplication. Do not merge or sort token inventories in Worker code.

**Step 4: Build compact responsive deltas from captured desktop/mobile observations**

Use only already-captured page observations. Return viewport widths plus bounded comparisons for section/headings presence, component/control counts and sampled layout/visibility facts. State the comparison scope and mark unknown when a capture is missing; do not claim a comprehensive layout diff.

**Step 5: Run focused pipeline/API tests**

Run: `npx vitest run test/pipeline-analysis.spec.ts test/analyze-endpoint.spec.ts`

Expected: observations round-trip, responsive records are scoped to the two existing mobile captures, and established screenshot/wall/payload limits remain unchanged.

## Task 3: Remove duplicate Worker-side package generation

**Files:**
- Modify: `worker/src/pipeline/analysis.ts`
- Modify: `worker/src/routes/analyze.ts` if encoder/package dependencies become unnecessary.
- Delete: `worker/src/package/build.ts` after all consumers move.
- Modify: `worker/test/pipeline-analysis.spec.ts`
- Modify: `worker/test/analyze-endpoint.spec.ts`
- Modify: `worker/test/acceptance.spec.ts`
- Delete/replace: `worker/test/package-build.spec.ts`

**Step 1: Update API tests to define the observation response contract**

Assert the API returns `schemaVersion`, bounded `pages`, tokens/typography/breakpoints/motion, all new evidence/completeness fields, report totals and screenshot metadata. Assert it no longer returns `packageFiles`/`packageWarnings` or generated Markdown strings.

**Step 2: Run affected tests and confirm the contract tests fail**

Run: `npx vitest run test/pipeline-analysis.spec.ts test/analyze-endpoint.spec.ts test/acceptance.spec.ts`

Expected: tests fail while the old package builder still attaches `packageFiles`.

**Step 3: Remove Worker package formatting**

Remove the `buildPackage()` import/call and `packageFiles`/`packageWarnings` result fields. Update the CF06 limitation text so it references observations and client-side documentation/ZIP generation, not tokens/content hidden in packageFiles. Keep screenshot capture metadata and inline-image behavior unchanged.

**Step 4: Remove obsolete package tests/module**

Move output-generation expectations to client package tests (Task 4). Retain Worker-level assertions for valid bounded observation JSON and API fields. Delete `build.ts` only after search confirms no production/test imports remain.

**Step 5: Run affected Worker tests**

Run: `npx vitest run test/pipeline-analysis.spec.ts test/analyze-endpoint.spec.ts test/acceptance.spec.ts`

Expected: all pass without `packageFiles`; test response size/limits remain within existing contracts.

## Task 4: Build the complete package in the browser

**Files:**
- Create: `web/package-docs.mjs`
- Modify: `web/app.js`
- Modify: `web/index.html` only if needed for module loading.
- Modify: `worker/test/package-build.spec.ts` or create `worker/test/client-package.spec.ts`
- Modify: `web/package.js` only if STORE writer input/type support requires it.

**Step 1: Add failing browser-builder tests from a representative fixture**

Import the ESM builder in Vitest. Provide two pages with distinct tokens/content, long copy, form controls, component patterns, interactions, responsive comparisons, assets, and screenshots. Assert generated JSON is parseable; all emitted evidence remains present; Markdown derives from the same ordered records; all token categories are emitted; page navigation and components are structured; interaction docs contain observed static details; responsive docs disclose sampled widths/coverage; asset count equals listed assets.

**Step 2: Add screenshot manifest/ZIP consistency tests**

Assert every `hasBinary: true` entry maps to a generated screenshot path (`desktop`, `mobile`, or `sections` with expected slug/extension); metadata-only shots map to no claimed binary. Test mismatched flags fail validation with the exact missing/unexpected path.

**Step 3: Implement pure client-side package rendering**

Build `buildDocumentationFiles(analysis)` in `web/package-docs.mjs`. Generate all documentation outputs from canonical observations, including `data/pages.json`, W3C-format `data/tokens.json`, `theme.css`, Tailwind config, `components.json`, `navigation.json`, new `interactions.json`, `assets.json`, report, README/overview/IA, typography, content-style, imagery, motion, responsive docs, and page Markdown. Preserve field order and observed text; do not independently resample or clip documentation. Escape Markdown safely and serialize valid JSON.

Implement a compact client validator that checks schema version, page/report counts, collection totals, generated JSON parseability, screenshot manifest paths/binary flags, and a named hard package byte cap. On cap/schema failure, refuse download and show a precise UI error rather than silently slicing files or outputting stub JSON.

**Step 4: Integrate package generation with the download flow**

Store the analysis response in `web/app.js`. On download, generate docs in the browser, merge with `collectScreenshotFiles()` output, validate, and call the existing STORE ZIP builder. Update package status to report included screenshot binaries vs metadata-only captures and the client documentation-file count. Remove assumptions that `body.packageFiles` exists.

**Step 5: Run client package tests**

Run: `npx vitest run test/client-package.spec.ts` (or the chosen test file).

Expected: full evidence is present, every JSON file parses, and screenshot/package inconsistencies are rejected.

## Task 5: Align documentation, report semantics, and user-facing status

**Files:**
- Modify: `docs/01-PRD.md`
- Modify: `docs/plans/2026-09-23-documentation-fidelity-design.md`
- Modify: `web/app.js`
- Modify: `web/index.html`/UI copy if package status text needs an explanatory note.

**Step 1: Update PRD architecture/contracts**

Document observations-only Worker response and client-side document+ZIP generation. Reconcile CF09/CF10/current status text so it no longer states documentation files are generated in the Worker. Explicitly keep Cloudflare limits and hosted verification requirement.

**Step 2: Separate package consistency from evidence completeness**

Emit report fields for valid package/schema and partial/incomplete observations separately. Include per-collection emitted/captured/cap/truncated metadata; include actual screenshot binary counts and actual ZIP bytes on client-generated report. Do not mark partial evidence as a malformed package, nor complete evidence merely because JSON parses.

**Step 3: Run UI smoke check locally**

Start local app with `npm run dev:local -w worker`, analyze a known static/site fixture, download the ZIP, inspect the archive for expected docs/screenshots, and confirm an intentional schema or package-cap error is shown clearly.

## Task 6: Full verification and performance guardrails

**Files:**
- Modify tests as needed in `worker/test/acceptance.spec.ts`, `worker/test/snapshot-script.spec.ts`, and `worker/test/client-package.spec.ts`.

**Step 1: Run typecheck**

Run: `npm run typecheck -w worker`

Expected: no TypeScript errors.

**Step 2: Run the full suite**

Run: `npm test -w worker`

Expected: all tests pass, including extractor size/pruning, client rendering, API response, and ZIP manifest checks.

**Step 3: Verify repository searches and budgets**

Search for remaining `packageFiles`, `packageWarnings`, `buildPackage`, Worker-side Markdown rendering and Worker ZIP calls. Only tests documenting absence or client code should match. Confirm no configured Worker/extraction/screenshot hard limits were raised.

**Step 4: Verify local end-to-end output**

Run: `npm run dev:local -w worker`; analyze homepage plus a representative page; inspect the downloaded ZIP. Confirm `data/pages.json` equals the emitted bounded observation set, mobile shots advertised as binary exist in the ZIP, and truncation fields/warnings agree with actual captured/emitted counts.

**Step 5: Record hosted verification status accurately**

Do not claim Free-tier production readiness from local tests alone. Record hosted Browser Rendering test requirement as pending until `npm run dev:remote -w worker` is actually exercised.
