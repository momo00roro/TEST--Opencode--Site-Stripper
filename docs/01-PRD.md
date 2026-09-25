# Website Analysis Pack — PRD

This is the authoritative product/technical specification. It replaces `CLOUDFLARE-ANALYSIS-MVP.md`.

This product is an **AI-ready website-analysis pack generator**, not an offline static replica or arbitrary JavaScript cloner.

## Goal

Accept a public website URL, identify the most important pages from its primary navigation, and return an AI-ready package of screenshots, design tokens, content guidance, responsive behavior, interaction notes, Markdown documentation, and JSON data.

The product analyzes websites. It does not attempt to clone arbitrary JavaScript or produce a working offline replica.

## Non-negotiable constraints

- The hosted production path runs **only on Cloudflare, on the Free plan**.
- No VPS, Docker host, external browser service, external database, third-party API, or AI API in production.
- Every hosted design decision must be justified against a real Cloudflare Free-tier limit.
- The same core analysis code must also run locally for development and verification.
- If a feature cannot work on Cloudflare Free tier, defer it rather than introducing another hosted vendor.

## Supported environments

### 1. Hosted Cloudflare environment

- Cloudflare Pages hosts the static UI.
- A Cloudflare Worker exposes the API.
- Browser Rendering supplies headless Chromium through the `BROWSER` binding.
- Production currently has no accounts, history, queue, or permanent result storage.

Relevant hosted configuration:

- `worker/wrangler.jsonc:10` binds Browser Rendering as `BROWSER`.
- `worker/package.json:6` uses Wrangler for development and deployment.

Hosted commands:

```sh
npm run dev -w worker
npm run dev:remote -w worker
npm run deploy -w worker
```

`npm run dev:remote -w worker` runs local code against remote Cloudflare resources. Final Free-tier behavior must be verified through Browser Rendering, not only through local Chromium.

### 2. Local development environment

The local path exists for development, debugging, and verification without requiring a Cloudflare deployment.

Local behavior:

- `worker/local/server.ts` serves the static `web/` UI and API routes from one local Node server.
- `worker/local/launcher.ts` exposes a local Chromium backend.
- `worker/local/chrome.ts` discovers an installed Chrome/Edge executable.
- `CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH`, or `CHROME_BIN` can explicitly select the browser.
- The local route handler injects the local launcher and a Node-only base64 encoder.
- Local execution is not subject to the Worker 10 ms CPU constraint, but code shared with the Worker must remain Worker-safe.

Local command:

```sh
npm run dev:local -w worker
```

The local server defaults to port `8787`, or the value of `PORT`.

## Backend abstraction

Browser access must go through a shared launcher abstraction so hosted and local execution use the same pipeline.

Required backend contract:

- A launcher has a `name`.
- `name` is either `"cloudflare"` or `"local"` for the supported backends.
- A launcher creates an analysis session.
- A session opens browser pages with **`newPage()`**, not `openPage()`.
- Every page/tab exposes:
  - `setViewport()`
  - `goto()`
  - `evaluate()`
  - `screenshot()`
  - `close()`
- The Worker Cloudflare backend uses `@cloudflare/puppeteer` and the `BROWSER` binding.
- The local backend uses `puppeteer-core` and locally installed Chromium.
- The API layer must accept an injected launcher for testing and local execution.
- If neither an injected launcher nor a `BROWSER` binding is available, the API must return a structured `500` explaining that no browser backend is configured.
- The Worker returns bounded, versioned page observations and report metadata only. The browser UI renders Markdown/JSON/theme files, validates the package, and assembles the ZIP.

This abstraction is implemented around:

- `worker/src/browser/types.ts`
- `worker/src/browser/launcher.ts`
- `worker/local/launcher.ts`
- `worker/src/routes/analyze.ts`
- `worker/src/app.ts`
- `worker/src/pipeline/preview.ts`

## Free-tier reality

These are the limits that actually shape the hosted design. Verify them before each release.

| Limit | Workers / Pages Free |
| --- | --- |
| Worker CPU time | 10 ms per invocation |
| Worker memory | 128 MB per isolate |
| Worker requests | 100,000 / day |
| Subrequests (`fetch`) | 50 per request |
| Simultaneous outgoing connections | 6 per request |
| Browser Run duration | 10 browser-minutes / day, 600 seconds |
| Concurrent browsers | 3 per account |
| New browser instances | 1 every 20 seconds |
| Browser inactivity timeout | 60 seconds, extendable to 10 minutes via `keep_alive` |
| Quick Actions for screenshot/content | 1 request / 10 seconds |
| Pages static hosting | Free plan, generous static serving limits |
| Response body size | Not enforced by Workers; streaming is supported |

### What this forces

1. **10 ms Worker CPU is the hard design driver.** DOM traversal, CSS inspection, token aggregation, parsing, compression, base64 encoding, and large JSON transformation must not run in Worker JavaScript. They must run inside Chromium through `page.evaluate()`, in the client, or through streamed pass-through bytes.
2. **ZIP assembly must be client-side.** `fflate` or equivalent code in the Pages UI builds the ZIP. The Worker must not buffer screenshots and compress them in a 128 MB isolate.
3. **One browser session, sequential tabs.** Launch one browser per analysis, respecting the one-new-instance-per-20-seconds limit. Open a tab, capture and extract, close it immediately, then continue. Never retain all analyzed tabs concurrently.
4. **Browser-minutes are the real budget.** 600 seconds per day divided by approximately 8–12 seconds per page supports roughly 50–75 page loads per day, or approximately 5–8 full analyses per day. State this in the UI.
5. **Screenshots must be bounded and Chromium-encoded.** Use `deviceScaleFactor: 1`, capped dimensions, bounded quality, byte caps, and Chromium-generated base64. Do not encode or transform screenshot binaries in Worker JavaScript.
6. **Extraction payloads must be budgeted.** Large JSON deserialization in the Worker consumes CPU. In-page extraction must prune, deduplicate, summarize, and enforce payload limits before returning data.
7. **Cache API is free and required.** Repeat or sibling analyses of the same host should reuse cached discovery data instead of spending browser-minutes again.

## Architecture

```text
Cloudflare Pages static UI
  index.html / app.js / package-docs.mjs / styles.css / vendor/zip-store.js
        │ POST /api/analyze, JSON
        ▼
Cloudflare Worker API
  - validates the request
  - resolves and validates the target
  - opens one Browser Rendering session
  - opens, captures, extracts, and closes one tab at a time
  - returns bounded versioned observations and metadata without duplicate generated documents
        ▼
Pages UI assembles the ZIP client-side and triggers download
```

Local development uses the same conceptual pipeline:

```text
Local Node server
  - serves web/
  - handles /health and /api/*
  - injects the local Chromium launcher
  - permits local-only conveniences such as Node base64 encoding
```

The client-side ZIP step happens in the user's browser. That is not a hosted service and consumes no Cloudflare compute.

## User flow

1. Enter a public HTTP(S) URL.
2. The backend validates the request and resolves the target safely.
3. It opens one browser session.
4. It fetches `robots.txt` and `sitemap.xml` with plain `fetch`, not browser time, to improve discovery.
5. It reads visible primary-navigation links and ranks likely key pages.
6. It analyzes the homepage plus up to nine additional same-origin pages, one closed tab at a time.
7. It captures bounded screenshots and runs structured in-page extraction.
8. The Worker streams the bundle; the UI builds and downloads the ZIP.

The first version is synchronous. It has no accounts, job history, queue, or permanent result storage.

## Key-page selection

Candidate sources, in priority order:

1. `sitemap.xml` entries, filtered to same-origin and human-readable paths.
2. Links in the header or primary navigation.
3. Links repeated across multiple navigation areas.
4. Direct homepage links with clean human-readable paths.
5. Labels such as About, Services, Work, Projects, Pricing, Team, or Contact.

Exclude or deprioritize:

- Login
- Signup
- Account
- Dashboard
- Cart
- Checkout
- Payment
- Privacy
- Terms
- Cookie
- Search
- Query-heavy URLs
- Downloads
- Third-party URLs
- Deep detail URLs

Deduplicate by normalized path.

The final report must list every candidate with:

- Score
- Selected or excluded status
- Candidate source
- Human-readable reason

Default selection is the homepage plus the top nine pages, with a hard maximum of ten pages. Deep pages (depth 2+) that share a top-level section are representatively sampled: only the highest-ranked page per section is selected, since same-section pages normally share one template; the rest are excluded with the representative named. Top-level pages are never sampled away.

The selection report must be emitted as `data/selection.json`, not buried inside `report.json`.

## Extraction strategy

Extraction is a bounded `page.evaluate()` operation that returns a plain JSON-serializable observation object. It runs after the page has loaded, fonts have settled, and scrolling has triggered lazy-loaded content.

The in-page extractor collects:

- **Structure:** heading hierarchy, ordered sections with roles, repeated component fingerprints, nav/footer structure, and forms. Forms are never submitted.
- **Semantic evidence:** ordered visible text blocks; labels, control types/options/required/disabled state and ARIA relationships; repeated component evidence; static interaction affordances; and collection completeness counters. Never capture user-entered values, click controls, or submit forms.
- **Geometry:** bounding rectangles plus computed margin, padding, gap, container widths, grid configuration, and flex configuration.
- **Content:** verbatim, structure-preserving text for sections, headings, paragraphs, code samples (line breaks preserved, rendered as fenced blocks), support tables (bounded markdown with headers), list items, links, buttons, and form labels, plus tone/style notes.
- **CSSOM tokens:** declaration-frequency analysis for colors, font sizes, spacing, radii, borders, and shadows.
- **Typography:** `@font-face` families, URLs, weights, computed line-height, and letter-spacing.
- **Responsive behavior:** real `@media` query strings enumerated from CSSOM and the properties they change.
- **Motion:** computed transitions, animations, durations, easings, delays, and keyframes.
- **Media manifest:** image, icon, logo, and video-poster URLs with dimensions, alt text, and usage locations.
- **Semantic style/layout samples:** compact computed styles for common roles and bounded geometry samples at each captured viewport. Where mobile capture succeeds, emit a compact actual desktop/mobile observation comparison; otherwise mark the comparison as not requested, skipped, or failed.

Confidence labels are mandatory: `observed`, `inferred`, or `unknown`. Every token carries a value, a source, and a confidence.

### Required in-page implementation traps and mitigations

The following are normative implementation requirements, detailing verified solutions for key technical risks:

#### Trap 1: Cross-origin CSSOM access & computed style sampling

Chromium throws a `SecurityError (DOMException)` when JavaScript attempts to read `.cssRules` from a `<link rel="stylesheet">` hosted on another origin without explicit CORS headers. This commonly affects fonts (Google Fonts), UI frameworks (Bootstrap, Tailwind CDN), and CDN-hosted assets.

Required solution & behavior:

- **Pass 1 (Safe CSSOM Traversal):** Wrap every `sheet.cssRules` access in a `try/catch` block. If reading rules throws, silently skip the stylesheet and record its `href` in the extraction limitations list (`limitations.push("Cross-origin stylesheet skipped: " + sheet.href)`).
- **Pass 2 (Representative Computed Style Sampling):** To guarantee token discovery regardless of CDN origins, sample `window.getComputedStyle(element)` across ~30 representative semantic elements:
  - Headings (`h1, h2, h3, h4, h5, h6`)
  - Body and text elements (`p, span, a, blockquote, code`)
  - Interactive controls (`button, [role="button"], input, textarea, select`)
  - Structural containers (`header, nav, main, section, article, footer, aside, .card, [class*="card"], [class*="container"]`)
- **Pass 3 (CSS Custom Properties Crawl):** Read CSS custom properties directly from `getComputedStyle(document.documentElement)` or inline `:root` style declarations, then merge body-level properties unseen on root (theme schemes often live on `<body>`, e.g. Shopify color schemes).
- **Confidence Tagging:**
  - Mark tokens extracted from CSSOM rule analysis as `confidence: "observed"`.
  - Mark tokens derived from DOM computed-style sampling as `confidence: "inferred"`.
  - Mark fallback/default tokens as `confidence: "unknown"`.

#### Trap 2: Worker CPU consumed by large JSON payloads

Although `page.evaluate()` executes remotely in Chromium, the returned observation object is transferred across the bridge and deserialized by the Worker's V8 isolate. A large raw DOM/CSS dump (e.g. 5–10 MB) requires 20–40 ms of CPU time to deserialize, instantly tripping Cloudflare's `Error 1102 (Worker CPU time limit exceeded)` on the 10 ms Free tier.

Required solution & behavior:

- **In-Browser Reduction & Aggregation:** The in-page extractor must aggregate and summarize data *before* returning across the browser boundary.
  - Return frequency maps and top-N scales (e.g., top 15 colors, top 10 font sizes, top 8 spacing intervals) rather than exhaustive element-by-element dumps.
  - Hard-cap arrays and string lengths in-page:
    - Headings: max 50–100, text clipped to 150 chars.
    - Links: deduplicated by normalized URL, max 100 per page (prioritizing navigation links).
    - Sections: max 20 sections with semantic roles, bounding boxes, and text excerpts clipped to 200 chars.
    - Media assets: max 100 entries per page.
- **In-Browser Byte Budget Self-Check & Emergency Pruning:**
  - Inside `page.evaluate()`, measure payload size: `const serialized = JSON.stringify(payload)`.
  - If `serialized.length > 350_000` (350 KB warning threshold), execute an emergency pruning pass (drop text excerpts, drop minor CSS classes, trim asset lists).
  - If still `> 500_000` (500 KB hard cap), prune to bare structural tokens and append a limitation note.
  - Keep standard page-extraction payloads strictly below 350 KB (hard max 512 KB).

#### Trap 3: Remote browser tab lifecycle & memory limits

Retaining multiple tabs simultaneously inside the remote headless Chromium instance exhausts container memory and leads to unexpected browser crashes.

Required solution & behavior:

- Strictly follow a sequential, single-tab lifecycle per analysis session:
  1. Open a tab using `newPage()`.
  2. Set viewport and navigate to the target URL.
  3. Perform smooth scrolling, snapshot collection, and screenshot capture.
  4. Immediately close that tab with `await page.close()`.
  5. Only then proceed to the next selected page.
- Wrap per-page operations in `try/finally` to guarantee `page.close()` is called even if navigation or extraction throws an exception.
- Close the overall browser session (`await session.close()`) in the analysis pipeline's `finally` block upon completion or abortion.
- Never retain all analyzed pages open concurrently.

#### Trap 4: Screenshot encoding CPU overhead

The Worker must not base64-encode, resize, transcode, buffer, or otherwise manipulate binary screenshot data in Worker JavaScript, as encoding multi-megabyte buffers easily blows the 10 ms CPU budget.

Required solution & behavior:

- Direct Chromium to produce base64 directly: `page.screenshot({ type: "webp", quality: 70, encoding: "base64" })`.
- This ensures all image encoding compute happens entirely inside the remote Chromium process, allowing the Worker to pass the base64 string directly with near-zero CPU time.
- Fall back to JPEG if WebP is unsupported in the target environment.
- Enforce the 6 MB total screenshot byte budget across all captured screenshots in the session.

#### Trap 5: In-page script serialization & bundler artifacts

When TypeScript code is compiled/bundled by `wrangler`, `esbuild`, or `tsc`, helper wrappers (such as `__name()` or `__spreadValues()`) may be injected. Passing function references directly to `page.evaluate(fn)` causes `fn.toString()` to contain references to these undefined helpers in page scope, causing runtime `ReferenceError`.

Required solution & behavior:

- Keep all in-page evaluation functions completely self-contained with **zero module-scope imports, constants, or outer closures**.
- Wrap stringified evaluations in self-executing IIFEs: `await page.evaluate(\`(\${collectPageSnapshot.toString()})()\`)` or evaluate standalone string literals.
- Enforce strict unit tests that inspect stringified extractor functions to verify no `__name`, `require`, or unresolved bundler identifiers exist.

### Screenshot policy

- Desktop full-page screenshots for every selected page, subject to caps.
- Mobile screenshots at 390 px for the homepage and one representative page.
- Extract-only mobile observations (390 px viewport pass, no screenshot) for every other analyzed page, wall-budget permitting, so each page carries a real DOM-level responsive comparison without spending screenshot bytes or mobile-shot budget.
- Section-clipped screenshots for the homepage for section-level fidelity.
- Formats: WebP quality 70, JPEG fallback.
- `deviceScaleFactor: 1`.
- Maximum screenshot height is capped.
- Total screenshot bytes are capped.

## Output package

```text
website-analysis/
  README.md
  website-overview.md
  information-architecture.md
  design-tokens.md
  typography.md
  content-style.md
  imagery-and-video.md
  motion-and-interactions.md
  responsive-behavior.md
  implementation-plan.md
  pages/
  screenshots/desktop/
  screenshots/mobile/
  screenshots/sections/
  data/tokens.json          # W3C Design Tokens format plus source/confidence
  data/selection.json       # candidate scores, selected/excluded status, reasons
  data/pages.json
  data/components.json
  data/navigation.json
  data/interactions.json
  data/assets.json          # media manifest: URLs, dimensions, alt, used-on
  data/report.json
  theme.css                 # extracted CSS custom properties
  tailwind.config.js        # extracted theme, ready to paste
```

Generate `theme.css` and `tailwind.config.js` because coding agents rehydrate standard token formats more reliably than prose.

`data/pages.json` is the canonical bounded observation record. All Markdown, token, component, navigation, interaction, and theme documents are client-rendered projections of those same records. The Worker must not create redundant generated-document copies in its response. The client refuses invalid packages and documentation over 24 MiB rather than silently truncating. Screenshot manifest `hasBinary` values are checked against the exact screenshot paths included in the ZIP.

Download only critical assets, such as the logo, favicon, hero image, and Open Graph image. Reference other media by URL.

## Fidelity model

“Closeness” is defined and measured, not asserted. The package targets high structural and stylistic fidelity and honest disclosure of everything else.

Fidelity rubric for acceptance testing:

- Rebuild at 1440 px and 390 px and compare against captured screenshots.
- Check palette, type scale, spacing scale, radii, and shadows against `data/tokens.json`.
- Check section order and structure against `data/pages.json`.
- Check verbatim copy against `content-style.md`.
- Record every gap in `report.json.limitations`.

Known limits that must always be reported include:

- Bot-verification challenges (CAPTCHA, sliders, rate walls): recorded, never solved; remaining pages skipped
- Custom fonts not downloaded
- Video content
- JavaScript-driven interactions
- CMS- or data-driven content
- Authenticated regions
- Pixel-exact motion timing
- Stylesheets inaccessible because of cross-origin CSSOM restrictions
- Screenshots or payloads omitted because of Free-tier caps

## API contracts

`POST /api/analyze` accepts:

```json
{"url":"https://example.com","maxPages":10,"includeMobile":true}
```

The backend:

- Clamps `maxPages` to a minimum of 1 and maximum of 10.
- Rejects invalid, credential-bearing, private, loopback, link-local, reserved, and non-HTTP(S) URLs.
- Resolves hostnames and validates resolved addresses before browser use.
- Rejects again after redirects.
- Streams or returns bounded analysis data.
- Returns structured machine-readable errors.

`GET /health` returns service status and backend capability information.

The current CF03 milestone returns a homepage-only preview response rather than the complete ZIP package. It includes:

- Schema version
- Browser backend name
- Normalized request
- Homepage snapshot
- Bounded screenshot metadata
- Optional inline screenshot when explicitly supported by the calling environment
- Extraction payload byte count
- Warnings
- Limitations
- Browser seconds used
- Integrity status

Each final multi-page record must contain:

- `url`
- `path`
- `title`
- `pageType`
- `selected`
- `priority`
- `selectedBecause`
- `sections`
- `geometry`
- `observedInteractions`
- `limitations`

The final report must contain:

- `schemaVersion`
- `sourceUrl`
- `pagesDiscovered`
- `pagesSelected`
- `pagesAnalyzed`
- `screenshotsCaptured`
- `browserSecondsUsed`
- `issues`
- `limitations`
- `integrityPassed`

If the UI cannot assemble or validate a package client-side, it must report a clear error and not offer a partial ZIP. There is no Worker-side package/ZIP fallback; this keeps all document rendering and archive work off Worker CPU.

## Numeric limits

All limits are enforced by the backend and surfaced in reports or previews.

| Limit | Value |
| --- | --- |
| `maxPages` default / hard max | 10 / 10 |
| `maxPages` hard minimum | 1 |
| Per-page navigation timeout | 12 seconds |
| Per-page in-browser extraction budget | 3 seconds |
| Total analysis wall budget | 90 seconds, hard |
| Browser session `keep_alive` | 10 minutes maximum, closed on completion |
| Desktop viewport | 1440 px wide, automatic height, `deviceScaleFactor: 1` |
| Mobile viewport | 390 px wide, automatic height, `deviceScaleFactor: 1` |
| Maximum screenshot height | 16000 px, clip beyond (Chrome's ~16384px canvas ceiling) |
| Screenshot format | WebP quality 70, JPEG fallback |
| Maximum screenshots | 10 desktop, 2 mobile, 6 homepage sections |
| Maximum total screenshot bytes | 6 MB |
| Maximum asset manifest entries | 300 |
| Maximum in-page headings collected | 200 |
| Maximum in-page links collected | 500 |
| Extraction payload warning threshold | 350 KB |
| Maximum extraction payload per page | 512 KB |
| `robots.txt` / `sitemap.xml` timeout | 5 seconds each |
| Maximum CSS text parsed per page | 3 MB |
| Client documentation size, hard max | 24 MiB before screenshot binaries |
| Maximum ZIP size, warn above | 25 MB |

## Cloudflare design

A Pages project hosts the static UI. A Worker validates requests, calls Browser Rendering, follows same-origin links sequentially in one session, drives in-browser extraction, generates the package, and streams it.

Persistent storage is avoided in the first version. The Cache API is used only for ephemeral discovery caching.

Add R2 only if packages outgrow direct responses or users need history. R2 is not required for the MVP.

Apply all strict limits. A blocked or slow site must produce a useful partial report rather than hang. Check the remaining wall-clock budget before each page and stop cleanly when it is exhausted.

## Local design

The local server must preserve the same validation, routing, pipeline, extraction, screenshot, and reporting semantics as the hosted Worker, except for explicitly documented local-only conveniences.

Required local behavior:

- Serve `web/` statically.
- Expose `/health`.
- Expose `/api/analyze`.
- Use the shared request router and pipeline.
- Validate URLs and resolved targets identically.
- Inject the local Chromium launcher.
- Close pages and browser sessions identically.
- Apply the same numeric budgets where applicable.
- Document any local-only exception, such as Node base64 encoding.

The local browser may legitimately be faster or less constrained than Browser Rendering. Local success therefore does not prove Cloudflare Free-tier compliance. Hosted verification remains mandatory.

## Cost control, rate limiting, and quota protection

The account-wide limit of **10 browser-minutes (600 seconds) per day** requires active defense against budget exhaustion:

- **One browser session per analysis:** Use sequential tabs, not new browser instances.
- **Immediate tab teardown:** Close each tab immediately after capture and extraction.
- **Resource blocking:** Intercept requests in Chromium to block trackers, ads, analytics, video streams, and nonessential third-party scripts (e.g. Google Analytics, GTM, Hotjar, Facebook Pixel, Intercom).
- **Domain-level ephemeral caching (Cache API):** Cache full analysis responses in Cloudflare `caches.default` keyed by normalized host URL with a 2-hour TTL. Sibling or repeated requests for the same website consume **0 browser-minutes**.
- **Per-IP cooldown rate limiting (Cache API):** Protect the shared daily budget from abusive scrapers by recording client IP cooldown stamps in `caches.default` (`Cache-Control: max-age=300`). Enforce a 5-minute cooldown between full analyses per IP, returning HTTP `429 Too Many Requests` when exceeded.
- **Free bot barrier (Cloudflare Turnstile):** Embed Cloudflare Turnstile on the static UI form. The Worker verifies the Turnstile token before launching browser sessions, blocking automated bots with zero Cloudflare billing impact (Turnstile is 100% free on all plans).
- **Subrequest efficiency:** Use `fetch` (cheap subrequests), not the browser, for `robots.txt`, `sitemap.xml`, and raw asset metadata.
- **Client-side compression:** Build the ZIP in the client (`fflate`), not the Worker.
- **In-browser pruning:** Aggregate and prune extraction payloads in-page before returning them.
- **Chromium-native screenshot encoding:** Encode screenshots directly in Chromium, avoiding Worker CPU burn.
- **Transparent UI budget meter:** Expose remaining daily browser budget and estimated page costs in the UI.

## Security

- Allow only HTTP(S).
- Reject credential-bearing URLs.
- Reject nonstandard web ports.
- Resolve hostnames and validate resolved IPs.
- Reject private, loopback, link-local, carrier-grade NAT, reserved, multicast, documentation, and otherwise nonpublic targets.
- Revalidate targets after every redirect.
- Follow same-origin links only.
- The `www.`/apex pair counts as the same site for discovery, and discovery is scoped to the origin the browser actually landed on after redirects (a `www.` request that 301s to apex analyzes the apex site, not an empty one).
- Never submit source-site forms.
- Never attempt to solve CAPTCHAs, sliders, or bot-verification challenges, or to bypass rate walls. Challenged pages are recorded as evidence with remaining captures skipped and the browser budget preserved.
- Never treat source JavaScript as trusted application code.
- Escape generated Markdown and JSON.
- Keep all Cloudflare credentials server-side.
- Record blocked targets and resolution failures in structured errors.

## Implementation tasks

### CF01 — Project foundation

Create the Cloudflare Pages static UI and Workers API TypeScript project, local development configuration, deployment configuration, and `/health`.

Status: implemented.

### CF02 — Safe request validation

Implement URL validation, resolved-IP private-target rejection, redirect policy, numeric limits, and structured errors.

Status: implemented.

### CF03 — Browser Rendering adapter

Implement:

- One-session lifecycle with `keep_alive`.
- `newPage()` tab management.
- Immediate tab closure after capture.
- Resource blocking.
- Serializable in-browser extraction payload.
- Bounded screenshot capture.
- Chromium-generated screenshot encoding.
- Extraction-byte measurement.
- Homepage preview pipeline.

Status: implemented and verified by automated tests and a live local-Chromium analysis (Trap 5 bundler-artifact failure reproduced on localhost and fixed via string+shim evaluation).

### CF04 — Page discovery

Fetch and parse `robots.txt` and `sitemap.xml`, detect primary navigation, and collect candidates with sources.

Status: implemented and verified by automated tests.

### CF05 — Key-page ranking

Implement utility exclusions, scoring, deduplication, ten-page selection, and `data/selection.json`.

Status: implemented and verified by automated tests.

### CF06 — Bounded multi-page analysis

Visit selected pages sequentially in immediately closed tabs with per-page and total-duration budgets. Emit page records, partial reports, and `browserSecondsUsed`.

Status: implemented and verified by automated tests.

### CF07 — Token and style extraction

Extract CSSOM-derived tokens, typography, breakpoints, motion, and geometry in-browser, each with source and confidence.

CF07 must implement the cross-origin CSSOM fallback and computed-style sampling required above.

Status: implemented and verified by automated tests.

### CF08 — Content and media

Emit verbatim structure-preserving text, tone notes, and the asset manifest. Download only critical assets.

Status: implemented and verified by automated tests (manifest by URL reference; critical-asset downloads deferred to packaging).

### CF09 — Markdown, JSON, and theme generation

Render every package document in the client from canonical observations, including `theme.css`, `tailwind.config.js`, W3C-format `data/tokens.json`, and structured `data/interactions.json`. Validate JSON and screenshot manifest membership before download. The Worker returns observations, not generated documents.

Status: implemented client-side and verified by automated tests; hosted Browser Rendering verification remains pending.

### CF10 — Streaming bundle and client-side ZIP

Stream bounded observations from the Worker. Render documents and assemble the STORE ZIP in the Pages UI. Enforce the client documentation and ZIP size caps. Avoid Worker-side documentation generation, encoding, and compression.

Status: implemented and verified by automated tests (client-side STORE ZIP; Worker does not render documents or compress).

### CF11 — Pages UI

Build the URL form, progress/status display, selected-page summary with reasons, remaining-budget indicator, error state, screenshot display, and download action.

Status: implemented (form, status, selection, budget meter, per-page cards, screenshot thumbnails, client ZIP download).

### CF12 — Acceptance tests and fidelity rubric

Test:

- Simple static sites
- Small multi-page sites
- React sites
- Next.js sites
- Large-navigation sites
- Blocked-resource sites
- Slow-resource sites
- Cross-origin-stylesheet sites
- Very tall pages
- Large extraction-payload pages
- Screenshot-heavy pages

Verify page selection, Markdown, JSON, screenshots, ZIP integrity, timeouts, payload budgets, tab cleanup, and honest limitations. Apply the fidelity rubric at 1440 px and 390 px.

Status: implemented and verified by automated tests (`worker/test/acceptance.spec.ts`, 12 scenarios + rubric).

## Current implementation status

Completed and verified by automated tests:

- CF01 project foundation, routing, CORS, `/health`, Pages UI scaffold.
- CF02 URL validation, IP/hostname controls, Cloudflare DoH resolution validation with one retry per query type against transient blips, request limits, structured errors.
- CF03 browser capture lifecycle, homepage snapshot extraction, screenshot bounds, preview pipeline, fake-backend tests.
- CF04 page discovery via `robots.txt` and `sitemap.xml` parsing, primary navigation/header/footer link detection, candidate source tracking.
- CF05 key-page scoring, utility/asset exclusions (documents, images, video/audio, 3D models, fonts, office files), path depth weighting, top-N selection with explicit `status` and `reason` metadata (`data/selection.json`).
- CF06 bounded multi-page loop, sequential tabs with immediate close, wall-budget + screenshot count/byte caps, homepage-mobile-first ordering, extract-only DOM-only mobile passes for remaining pages, bot-challenge abort/skip, partial reports, `browserSecondsUsed`.
- CF07 in-browser token/style extraction, three-pass CSSOM fallback plus body-level scheme properties, typography/breakpoints/motion/geometry with confidence, zero-duration motion-default filtering, hover/focus/active state rules (third-party widget chrome omitted, triggers classified on the stored selector), in-page payload pruning.
- CF08 verbatim content (paragraphs, code samples with line breaks, bounded support tables, hidden/collapsed copy labeled, consecutive-duplicate collapse), tone notes, asset manifest by URL reference with report-level deduped manifest, video/audio file entries with readiness, iframe embeds, form actions (same-origin only), SVG icon inventory, social/share metadata, page language and direction.
- CF09 client-side package generation from canonical bounded observations (Markdown, JSON, W3C tokens, theme.css, Tailwind config, interaction docs, key-role mapping, stack detection, canvas fallbacks, coverage dedupe) with schema/manifest validation and a 24 MiB documentation cap; generated files are not duplicated in the Worker response.
- CF10 STORE-only ZIP writer shared Worker/web, client-side assembly with 25MB warn cap, Worker never compresses.
- CF11 Pages UI (monster brand, sticky bottom download bar, budget meter, per-page cards, screenshot gallery, client ZIP download).
- CF12 synthetic acceptance suite (11 scenarios + fidelity rubric at 1440/390).
- PRD-record compliance: every multi-page record carries `selected`, `sections`, `observedInteractions`, and `limitations`; section-clipped homepage screenshots (max 6, byte-budgeted) and mobile capture for the homepage plus one representative page (max 2) are implemented; CSS parsing respects the 3MB per-page cap.
- Budget and safety hardening: total screenshot bytes never exceed 6 MB (per-capture remaining-budget enforcement), redirect landings are checked for blocked hosts, disallowed ports, and non-HTTP(S) protocols, unexpected errors no longer leak internal detail, and discovery no longer duplicates mixed-case homepage paths.
- Package integrity: client-generated JSON is validated before download; page observations expose collection counts/caps/truncation; screenshot manifest binary flags are validated against ZIP paths; ZIP CRC32 checksums are verified against the known vector.
- `npm run typecheck` passes with zero errors.
- Screenshot fidelity: capture scrolls in 0.8-viewport bands with 350ms painted pauses, waits for images to finish decoding, then settles fonts plus video first-frames, with extended pauses on video/canvas pages before settling at the top for capture, so scroll-triggered reveals and lazy media are included. Full-page height cap is 16000px (Chrome's ~16384px canvas ceiling), and local previews inline every shot up to the 6MB byte cap.
- Vitest suite passes with 230 tests across 16 test files; local live-site verification is not evidence of hosted Free-tier compliance.

Open or next milestones:

- All CF01–CF12 implemented. Hosted smoke-verified via `npm run dev:remote -w worker` (Browser Rendering) on 2026-09-25: `backend: cloudflare`, schema 0.2.0, extraction parity with local runs (64 blocks / 30 controls / 15 colors on the reference homepage), mobile capture metadata-only (Trap 4 holds remotely), zero Error 1102s, zero issues. One transient remote navigation timeout observed on a fast host; succeeded on immediate retry with identical evidence.
- **Deploy pipeline live 2026-09-25** via GitHub Actions (`.github/workflows/deploy.yml`: typecheck → test → deploy Worker → deploy Pages UI on push to `master`, green): API at `https://site-stripper-api.momo00roro.workers.dev`, UI at `https://fdcbe66a.site-stripper-ui.pages.dev` with `api-base` wired to the Worker. CI uses repo-pinned Wrangler v4 on Node 22 with `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets. Public end-to-end check pending.
- Deferred (require the real runtime to test): per-IP cooldown rate limiting, Cache API discovery caching, and the Turnstile bot barrier from the cost-control section.
- Deliberate deviation: screenshot and critical-asset *binaries* are not embedded in the hosted package. Encoding multi-MB images in the Worker violates Trap 4 (10 ms CPU), and a client cannot reliably read cross-origin image bytes. Hosted responses therefore return screenshot metadata plus `screenshots/manifest.json`, and asset URLs in `data/assets.json`; the local dev path inlines screenshot base64 via the Node encoder. `report.json.limitations` and package warnings state this explicitly. Introducing R2 or a Deflate path would be required to ship binaries.

The previously noted test expectation used a comma in the data URL, not a colon. That issue is resolved.

## Definition of done

- Deployable using only Cloudflare Pages and Workers on the Free plan.
- No external service, database, or AI API is required by hosted production.
- Local development works with local Chromium and the same core pipeline.
- A public URL produces a downloadable analysis ZIP.
- Homepage plus up to nine high-priority pages are analyzed.
- The package contains screenshots, Markdown, JSON, `theme.css`, and a Tailwind config.
- Selection reasons are visible and machine-readable.
- Unsafe URLs are rejected and every numeric limit is enforced.
- Closed tabs and sessions do not leak browser resources.
- Payload, screenshot, encoding, and CPU mitigations are implemented.
- Slow or blocked sites terminate with a partial report rather than hanging.
- The package can be supplied directly to an AI coding model.
- The fidelity rubric is applied and gaps are reported.

## Non-goals

No working clone, arbitrary JavaScript replay, logged-in capture, hundreds-page crawling, accounts, team collaboration, AI API calls, VPS, Docker, external managed services, or paid Cloudflare features in the first hosted version.

## Coding-agent starting prompt

Read `01-PRD.md` completely. Implement the next incomplete task in task order. Preserve dual local/Cloudflare compatibility. Preserve Free-tier compatibility. Do all heavy work in Chromium or the client, never in Worker CPU. Close every browser tab immediately. Keep extraction payloads pruned and budgeted. Do not build the old static-replica exporter. After each task, run focused tests and record exact commands and results.
