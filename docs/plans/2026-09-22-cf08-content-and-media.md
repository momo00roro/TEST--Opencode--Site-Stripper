# CF08 Content and Media Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the in-browser extractor with bounded verbatim content, tone notes, and asset manifest, and surface them per-page plus as a deduped report-level `assets` manifest without Worker-side downloads.

**Architecture:** All DOM reading stays inside `collectPageSnapshot()` (`worker/src/browser/snapshot-script.ts`, zero imports per Trap 5). Worker (`worker/src/pipeline/analysis.ts`) only passes references through and aggregates a report-level asset list capped at `LIMITS.maxAssetManifestEntries` (300). No binary downloads in CF08 — critical-asset downloading is deferred to CF09/CF10 packaging; CF08 records URLs, dimensions, alt, and usage locations for `data/assets.json`.

**Tech Stack:** TypeScript, `page.evaluate(collectPageSnapshot)`, Vitest DOM shims in `worker/test/snapshot-script.spec.ts`, fake launcher in `worker/test/helpers.ts`.

---

### Task 1: Extend snapshot types with content + assets

**Files:**
- Modify: `worker/src/browser/snapshot-script.ts:1-76`
- Test: `worker/test/snapshot-script.spec.ts`

**Step 1: Write the failing test**

```ts
it("exposes bounded content and asset containers", () => {
  saved = installDom([el("p", { text: "Hello world" })], "Content");
  const snapshot = collectPageSnapshot();
  expect(snapshot.content.paragraphs.length).toBeLessThanOrEqual(50);
  expect(snapshot.assets.length).toBeLessThanOrEqual(100);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -w worker -- snapshot-script`
Expected: FAIL with "content is undefined".

**Step 3: Write minimal implementation**

Add types (JSON-serializable, bounded):

```ts
export interface SnapshotSection { role: string; heading: string; textExcerpt: string; }
export interface SnapshotContent {
  paragraphs: string[];            // max 50, each 300 chars
  listItems: string[];             // max 50, each 200 chars
  buttons: string[];               // max 30, each 100 chars
  formLabels: string[];            // max 30, each 100 chars
  sections: SnapshotSection[];     // max 20
  tone: { avgSentenceWords: number; questionCount: number; ctaCount: number; voice: string };
}
export interface SnapshotAsset {
  url: string; kind: string; alt: string; width: number | null; height: number | null; usedOn: string;
}
```

Extend `PageSnapshot` with `content: SnapshotContent; assets: SnapshotAsset[];` (assets max 100 per page in-browser).

**Step 4: Run test to verify it passes**

Run: `npm run test -w worker -- snapshot-script`
Expected: PASS (empty arrays initially).

**Step 5: Commit**

```bash
git add worker/src/browser/snapshot-script.ts worker/test/snapshot-script.spec.ts
git commit -m "feat: add CF08 bounded content and asset types"
```

---

### Task 2: Collect verbatim content + tone in-page (self-contained)

**Files:**
- Modify: `worker/src/browser/snapshot-script.ts` (inside `collectPageSnapshot` only)
- Test: `worker/test/snapshot-script.spec.ts`

**Step 1: Write the failing test**

```ts
it("collects verbatim paragraphs, buttons, and tone notes", () => {
  saved = installDom([
    el("p", { text: "Buy now! Great offer?" }),
    el("button", { text: "Get started" }),
  ], "Tone");
  const snapshot = collectPageSnapshot();
  expect(snapshot.content.paragraphs[0]).toContain("Buy now");
  expect(snapshot.content.buttons).toContain("Get started");
  expect(typeof snapshot.content.tone.avgSentenceWords).toBe("number");
});
```

Shim note: the existing `matches()` handles `p`, `button`, `li`, `label`, `section` tags. `querySelectorAll("section, [role='region']")` already works. Keep selectors to plain tags.

**Step 2: Run test to verify it fails**

Run: `npm run test -w worker -- snapshot-script`
Expected: FAIL — paragraphs empty.

**Step 3: Write minimal implementation**

Inside `collectPageSnapshot()`, literals only:

- Paragraphs: `doc.querySelectorAll("p")` first 50, clean whitespace, slice 300, skip empty.
- List items: `doc.querySelectorAll("li")` first 50, slice 200.
- Buttons: `doc.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button']")` — shim supports `button`, `[role='button']`, `input`; attribute-equals with quotes works (`input[type='submit']` matches `attrEquals` regex). First 30, text or `value`/`aria-label`, slice 100.
- Form labels: `doc.querySelectorAll("label")` first 30, slice 100. Never submit forms (read-only).
- Sections: `doc.querySelectorAll("section, [role='region']")` first 20 — role, first heading text inside (slice 120), text excerpt (slice 200).
- Tone (in-browser aggregation, no Worker CPU): join paragraphs+headings (capped), compute `avgSentenceWords` (words/sentences, rounded to 1 decimal), `questionCount` (`?` occurrences, capped), `ctaCount` (matches of buy/start/try/get/contact/learn/shop/sign/pricing/demo/trial/contact, case-insensitive, capped), `voice` = `"cta-heavy"` if ctaCount>=3 else `"informational"` if avgSentenceWords>18 else `"concise"`. All literals inline.

**Step 4: Run test to verify it passes**

Run: `npm run test -w worker -- snapshot-script`
Expected: PASS.

**Step 5: Commit**

```bash
git add worker/src/browser/snapshot-script.ts worker/test/snapshot-script.spec.ts
git commit -m "feat: collect CF08 verbatim content and tone in-page"
```

---

### Task 3: Collect asset manifest in-page (no downloads)

**Files:**
- Modify: `worker/src/browser/snapshot-script.ts`
- Test: `worker/test/snapshot-script.spec.ts`

**Step 1: Write the failing test**

```ts
it("collects image, icon, and video-poster assets by URL", () => {
  saved = installDom([
    el("img", { attrs: { src: "https://example.com/hero.jpg", alt: "Hero" } }),
    el("link", { attrs: { rel: "icon", href: "/favicon.ico" } }),
    el("video", { attrs: { poster: "/poster.jpg" } }),
  ], "Assets");
  const snapshot = collectPageSnapshot();
  expect(snapshot.assets.length).toBeGreaterThan(0);
  expect(snapshot.assets[0]?.url).toContain("hero.jpg");
});
```

Shim note: `matches()` handles `img`, `link`, `video` tags. `el()` stores `href` top-level plus `attrs`; for `src`/`poster`/`content` read via `getAttribute`. `doc.querySelector('meta[property="og:image"]')` works via `attrEquals`. Resolve relative URLs against `doc.location.href` with try/catch; keep absolute-URL failures as-is (Worker never fetches in CF08).

**Step 2: Run test to verify it fails**

Run: `npm run test -w worker -- snapshot-script`
Expected: FAIL — assets empty.

**Step 3: Write minimal implementation**

Inside `collectPageSnapshot()`:

- `img`: first 100 — `src`/`data-src`/`srcset` first URL, `alt`, `width`/`height` attributes or `naturalWidth` fallback null, `usedOn` = page URL. kind `"image"`.
- `svg` with `aria-label`: kind `"icon"`, url `""` (inline) + alt label — or skip empty URLs? Keep with `url: ""`? Better: record inline SVGs as `{url: "", kind: "icon"}`? For `data/assets.json`, empty URLs are noise. Decide: only record SVGs with `aria-label` as icon entries with url `""` + alt — hmm. Minimal: skip inline SVG without URL, but count them? Simpler: record `link[rel=icon]`, `meta[property=og:image]`, `video[poster]` as logo/favicon/hero/poster kinds:
  - `link[rel~='icon']`: kind `"icon"`, url href.
  - `meta[property='og:image']`: kind `"hero"`, url content.
  - `video[poster]`: kind `"video-poster"`, url poster.
- Logo heuristic: `img` whose `src`/`alt` includes "logo" → kind `"logo"`.
- Cap 100 entries per page in-browser, each string sliced (url 500, alt 200). Dedupe by url+kind.
- Never `fetch` in-page. Worker does zero downloads in CF08.

**Step 4: Run test to verify it passes**

Run: `npm run test -w worker -- snapshot-script`
Expected: PASS.

**Step 5: Commit**

```bash
git add worker/src/browser/snapshot-script.ts worker/test/snapshot-script.spec.ts
git commit -m "feat: collect CF08 asset manifest in-page"
```

---

### Task 4: Trap 2 pruning for content/assets + Trap 5 guard + pipeline surfacing

**Files:**
- Modify: `worker/src/browser/snapshot-script.ts`, `worker/src/pipeline/analysis.ts`, `worker/test/helpers.ts`, `worker/test/pipeline-analysis.spec.ts`, `worker/test/discovery-discover.spec.ts`
- Test: `worker/test/snapshot-script.spec.ts`, `worker/test/pipeline-analysis.spec.ts`

**Step 1: Write the failing tests**

```ts
it("keeps maximal content pages under the extraction hard cap", () => {
  // 200 headings + 500 links + 50 paragraphs + 100 assets via shim
  // assert JSON.stringify(snapshot).length <= 512 * 1024
});
```

```ts
it("surfaces CF08 content and aggregates the asset manifest", async () => {
  const { launcher } = makeFakeLauncher("fake");
  const result = await runAnalysis(launcher, buildRequest({ maxPages: 2, includeMobile: false }), { fetchImpl: mockSiteFetch() });
  expect(result.pages[0]?.content.paragraphs).toBeDefined();
  expect(Array.isArray(result.assets)).toBe(true);
  expect(result.assets.length).toBeLessThanOrEqual(LIMITS.maxAssetManifestEntries);
  expect(result.assetCount).toBe(result.assets.length);
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -w worker -- snapshot-script pipeline-analysis`
Expected: FAIL (no `content` on page, no `assets` on result).

**Step 3: Write minimal implementation**

- Extractor: extend the existing Trap 2 block — when `serialized > 350*1024`, also trim `content.paragraphs` to 20, `listItems` to 20, drop `sections` excerpts beyond 10, trim `assets` to 50, push the existing pruning limitation (append ", content, assets" — or reuse same message). When `> 512*1024`, reduce to headings/links + top tokens + 10 paragraphs + 20 assets + structural limitation.
- Serialization guard: no new imports in `snapshot-script.ts`; keep `350 * 1024` / `512 * 1024` literal forms so `toString()` checks keep passing.
- Helpers: extend `SAMPLE_SNAPSHOT` + `snapshotWithLinks` fixture with `content` (empty arrays + neutral tone) and `assets: []`.
- Pipeline (`analysis.ts`): extend `AnalysisPage` with `content` + `assets` (pass-through, no transform); extend `AnalysisResult` with `assets: SnapshotAsset[]` (deduped by url across pages, cap 300) + `assetCount`. Aggregation is cheap string-key dedupe — Worker-safe (bounded: pages ≤10 × assets ≤100 = ≤1000 iterations).
- `toRecord()` passes `snapshot.content` / `snapshot.assets` by reference.

**Step 4: Run tests to verify they pass**

Run: `npm run test -w worker -- snapshot-script pipeline-analysis analyze-endpoint browser-capture`
Expected: PASS.

**Step 5: Commit**

```bash
git add worker/src/browser/snapshot-script.ts worker/src/pipeline/analysis.ts worker/test/helpers.ts worker/test/snapshot-script.spec.ts worker/test/pipeline-analysis.spec.ts worker/test/discovery-discover.spec.ts
git commit -m "feat: surface CF08 content and asset manifest in pipeline"
```

---

### Task 5: Full verification + PRD status update

**Files:**
- Modify: `docs/01-PRD.md` (CF08 status lines only, if green)

**Step 1: Run typecheck**

Run: `npm run typecheck -w worker`
Expected: exit 0.

**Step 2: Run full suite**

Run: `npm run test -w worker`
Expected: 11 files, 122+ tests, 0 failures.

**Step 3: Update PRD status**

Only if green — add `Status: implemented and verified by automated tests.` to `### CF08`, move bullet to completed list, update counts.

**Step 4: Commit**

```bash
git add docs/01-PRD.md
git commit -m "docs: mark CF08 complete"
```

---

## References

- PRD: `docs/01-PRD.md:212-221` (content + media manifest), `§344` (critical assets only), `§336` (`data/assets.json`), `§431-456` numeric limits, Trap 2 `§247-264`, Trap 5 `§293-301`
- Extractor: `worker/src/browser/snapshot-script.ts`
- Pipeline: `worker/src/pipeline/analysis.ts`, limits: `worker/src/config/limits.ts`
- Tests: `worker/test/snapshot-script.spec.ts`, `worker/test/helpers.ts`, `worker/test/pipeline-analysis.spec.ts`, `worker/test/discovery-discover.spec.ts`, `worker/test/browser-capture.spec.ts`
- Skills: @verification-before-completion (fresh typecheck+test before done), @systematic-debugging (root-cause first)
