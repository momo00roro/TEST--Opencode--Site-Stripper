# Evidence-First Website Documentation Design

## Status

Approved for implementation on 2026-09-23.

## Goal

Produce accurate, useful, verifiable website-analysis packages whose JSON records preserve bounded source observations and whose Markdown/theme files are rendered from that single source. Improve fidelity for page content, design tokens, components, interactions, and responsive behavior without violating Cloudflare Workers Free-tier constraints.

The package is an AI-ready analysis, not an offline clone. Observations must distinguish what was seen from inference and from data omitted by caps or inaccessible source behavior.

## Non-negotiable runtime constraints

- Hosted production remains Cloudflare Pages + Workers Free plan + Browser Rendering only.
- No Worker-side screenshot encoding, ZIP compression, large Markdown generation, or unbounded object transformation.
- Keep in-page extraction under the existing 350 KB warning / 512 KB hard payload limits per page.
- Keep analysis page, browser-time, screenshot count/bytes, media-entry, and sequential-tab constraints from `docs/01-PRD.md`.
- Generate package files and ZIP in the browser. Client-side package growth is acceptable, but must remain bounded and report any client truncation.
- Keep the browser extractor self-contained for serialization and do all DOM/CSS work in Chromium.
- Never click controls, submit forms, or execute source-page actions to discover behavior.

## Architecture and data flow

1. Chromium captures one selected page per tab and returns a bounded, versioned observation record.
2. The Worker validates, sequences captures, enforces existing budgets, aggregates bounded report metadata, and returns observations plus screenshot metadata. It does not render a second copy of the documentation.
3. The UI renders the canonical observations into JSON, Markdown, CSS/Tailwind token files, and a screenshot manifest, then assembles the ZIP client-side.
4. Package generation and ZIP validation run in the browser. The output manifest explicitly records whether each screenshot binary was included.

Remove Worker-generated `packageFiles` once client generation is in place. Preserve useful API fields and document the response schema/version transition. Do not send both rich observations and redundant copies of all generated documents through the Worker response.

## Canonical observation schema

Extend the per-page record with bounded, structured observations:

- **Metadata and structure:** URL, title, description, language, headings in source order, semantic sections with stable order/index, visible text excerpts, and actual capture counts.
- **Content:** ordered semantic text blocks (at least headings, paragraphs, lists/list items, blockquotes, and disclosure/FAQ content), with source element role, section association where determinable, exact observed text up to a field limit, and omitted/truncated indicators. Deduplicate only when doing so does not erase repeated content or order.
- **Controls and forms:** visible labels, control type/name/id, required/disabled state, select option labels, button/link labels, and relevant ARIA attributes/relationships. Values and private/user-entered data are never captured. Never submit forms.
- **Components:** bounded repeated-pattern evidence, grouped by a stable, explainable fingerprint (semantic element/role, structure signature, and safe class hints), with occurrence count, representative locations/headings, and concise structural features. Do not emit full class dumps or arbitrary HTML.
- **Interactions:** enumerate observable affordances and their static state/relationships: anchors, button-like controls, form controls, `details/summary`, `aria-expanded`/`aria-controls`, dialog state, carousel-like landmarks, and video/audio controls. Clearly label these as observed affordances; do not claim runtime behavior was tested.
- **Design tokens and typography:** keep frequency/count, source, and confidence. Preserve category coverage (color, type scale, spacing, radius, borders, shadows, custom properties, font faces) and compact semantic samples (e.g. body, heading, button) where computed styles exist. Combine selected-page tokens client-side to avoid Worker aggregation cost. Do not label top-frequency samples as exhaustive design-system tokens.
- **Responsive behavior:** include CSS media-query evidence and compact desktop/mobile observation deltas from existing homepage and representative-page mobile captures (where enabled), such as viewport size, headings/sections present, key component counts, and sampled layout/visibility/geometry changes. Mark unknown when the capture was unavailable; do not infer undocumented breakpoints.
- **Assets:** retain URLs, kind, dimensions, alt text, and usage location with explicit entry counts/cap indicators.
- **Completeness metadata:** for each bounded collection, expose observed/collected count, emitted count, cap, whether truncation/pruning occurred, and why; retain page/global limitations and confidence.

All additions must be plain JSON, field-bounded, and included in the in-browser payload-size check. Prefer compact records with enums and references to avoid repeating strings. When pruning is needed, preserve page structure and high-value content/control evidence first, and record exactly which lower-priority collections were reduced.

## Client documentation generation

The browser package builder uses the canonical records to produce:

- `data/pages.json`: complete bounded observations and collection/completeness metadata.
- `data/tokens.json`, `theme.css`, and `tailwind.config.js`: all emitted token categories with source/confidence; generated token labels must not imply semantic names that were not observed.
- `data/components.json`: repeated-pattern inventory, counts, representative examples, and explicit sampling/cap notes.
- `data/navigation.json`: observed header, navigation, footer link groups separately from selected-page candidates.
- `data/interactions.json` (new): structured affordances, controls, relationships, and non-replay limitations.
- Page Markdown: source-order headings/content, forms/controls, CTAs, sections, and relevant completeness notes, rendered from the same JSON data.
- `motion-and-interactions.md`, `responsive-behavior.md`, and `imagery-and-video.md`: substantive summaries and counts derived from JSON, never independently sampled or silently truncated.
- `data/report.json`: analysis totals, actual shipped screenshot count/bytes, omissions, limits, warnings, and integrity status.
- Screenshot manifest: `hasBinary` per shot; client ZIP assembly validates that every `hasBinary: true` entry maps to a ZIP file and that metadata-only captures are not represented as included binaries.

Raise client package-size limits enough to include all emitted observations and assets; enforce a reasonable hard client cap and surface any truncation as an error/warning with exact affected paths. Markdown is a readable projection, not a second content source. `data/pages.json` is authoritative.

## Error handling and honesty

- Missing API fields or unknown schema versions must produce a clear UI/package error rather than an apparently complete ZIP.
- Missing mobile captures, blocked CSS, inaccessible fonts, payload pruning, and missing screenshot binaries are explicit limitations.
- Report integrity is not equivalent to completeness. Keep separate status fields for valid/consistent package output and partial observations.
- If a package file exceeds a limit, do not silently slice arbitrary text or replace useful JSON with an unexplained stub. Emit valid bounded JSON and precise truncation metadata.

## Validation and acceptance

- Unit-test extraction for content order, FAQ/disclosure capture, form/control attributes without values, repeated component grouping, token categories/samples, interaction relationships, responsive deltas, and accurate completeness counters.
- Unit-test pruning under synthetic large pages: extractor stays at or below 512 KB, preserves priority fields, and accurately identifies every pruned collection.
- Test that client-generated JSON, Markdown, theme files, and interaction/component documentation all derive from the same records and preserve full emitted text (including strings longer than the former 300-character paragraph clipping limit, within the new explicit limits).
- Test that client package creation accepts larger valid bundles within its cap, rejects over-cap cases explicitly, and verifies screenshot manifest entries against actual ZIP paths.
- Run the full worker test suite and typecheck; verify a local analysis produces a ZIP with the new schema. Hosted Browser Rendering verification remains required before claiming Cloudflare Free-tier production readiness.

## Out of scope

- Replaying arbitrary page JavaScript or guaranteeing all hidden/dynamic states.
- Authenticated content, form submission, exhaustive scraping, and uncapped DOM/CSS dumps.
- Raising Cloudflare limits, adding external services/storage, or changing the Worker browser-time budget.
- Claiming pixel-exact design-token or motion recovery where runtime evidence does not support it.
