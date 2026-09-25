# CF09→CF12 Sequential Implementation Plan

> **Superseded (2026-09-23):** Documentation generation now runs client-side from canonical observations, and the Worker no longer returns `packageFiles`/`packageWarnings`. For the current contract and implementation, see `2026-09-23-documentation-fidelity-design.md` and `2026-09-23-documentation-fidelity.md`.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the product: CF09 pure package generation (Markdown/JSON/theme), CF10 STORE-only ZIP shared by Worker fallback and client UI, CF11 UI download + budget + per-page display, CF12 synthetic acceptance suite + rubric.

**Architecture:** Worker stays CPU-safe: `buildPackage(result)` is a pure bounded string transform (no browser, no compression, no base64 in Worker); screenshots travel as `dataUrl` only when the caller supplied an encoder (local dev), otherwise metadata-only. `zip-store.ts` implements ZIP STORE (no deflate) + CRC32 in ~120 lines, tested in Worker, vendored verbatim to `web/vendor/zip-store.js` for client assembly. UI uses `web/package.js` (`buildZip`) with 25MB warn cap. Acceptance tests are synthetic (fake launchers/fixtures), no real browser.

**Tech Stack:** TypeScript (worker), vanilla JS + vendored STORE writer (web), Vitest.

---

### CF09 Task 1: `worker/src/package/build.ts` pure builder

**Files:**
- Create: `worker/src/package/build.ts`
- Test: `worker/test/package-build.spec.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildPackage } from "../src/package/build";
import { makeFakeLauncher } from "./helpers";
import { runAnalysis } from "../src/pipeline/analysis";
// build minimal result via runAnalysis(maxPages 1, no mobile), then:
const pkg = buildPackage(result);
expect(Object.keys(pkg.files)).toContain("theme.css");
expect(Object.keys(pkg.files)).toContain("tailwind.config.js");
expect(Object.keys(pkg.files)).toContain("data/tokens.json");
expect(Object.keys(pkg.files)).toContain("data/selection.json");
expect(Object.keys(pkg.files)).toContain("data/assets.json");
expect(Object.keys(pkg.files)).toContain("data/report.json");
expect(JSON.parse(pkg.files["data/tokens.json"])).toBeDefined();
```

**Step 2: Run test to verify it fails**

Run: `npm run test -w worker -- package-build`
Expected: FAIL with "Cannot find module".

**Step 3: Write minimal implementation**

`buildPackage(result: AnalysisResult): { files: Record<string,string>; warnings: string[] }`:

- Helpers (module-scope, Worker-safe, no deps): `escMd` (escape `# * _ [ ] < >` + HTML), `slug` (path → filename), `topToken` (first value or fallback).
- `theme.css`: `:root` vars from homepage tokens — `--color-1..N` (top 8 colors), `--font-size-1..N` (top 5), `--spacing-1..N` (top 5), `--radius-1..N` (top 4) + `--font-family-base`. Fallbacks (`#111111`, `16px`, `8px`, `8px`, `system-ui`) with `confidence: unknown` note in comment when empty.
- `tailwind.config.js`: `module.exports = { theme: { extend: { colors, fontSize, spacing, borderRadius, boxShadow } } }` as string. Values from same tops.
- `data/tokens.json`: W3C-ish `{ color: {...}, fontSize: {...}, spacing: {...}, radius: {...}, shadow: {...} }` where each entry `{ value, type, description: "source/confidence" }`. Plus `extensions: { source, confidence }` per token? Keep flat + `$meta`.
- `data/selection.json`: pass-through `result.selection` (or empty report shape).
- `data/pages.json`: per-page `{url,path,title,pageType,priority,selectedBecause,headings,counts,content.tone,styleLimitations}` — no screenshots binary.
- `data/components.json`: aggregate roleCounts + section roles across pages (bounded 50 keys).
- `data/navigation.json`: `{ homepage, primary: selection candidates selected (url/path/label/priority/reason) }`.
- `data/assets.json`: `{ assets: result.assets, count }`.
- `data/report.json`: `{ schemaVersion, sourceUrl, pagesDiscovered/Selected/Analyzed, screenshotsCaptured, screenshotBytesTotal, browserSecondsUsed, issues, warnings, limitations, integrityPassed }`.
- Markdown (9 files + `pages/<slug>.md` per page ≤10): README, website-overview, information-architecture, design-tokens, typography, content-style, imagery-and-video, motion-and-interactions, responsive-behavior, implementation-plan. Each ≤ ~8KB via caps (top-N + excerpts). All user text through `escMd`.
- File count ≤ 30, each file ≤ 100KB (slice defensively), total ≤ 1MB; warnings when truncated.
- `validatePackage(files)`: asserts required paths present, JSON parses, tokens has color/fontSize, report has integrityPassed boolean. Returns `string[]` issues.

**Step 4: Run test to verify it passes**

Run: `npm run test -w worker -- package-build`
Expected: PASS.

**Step 5: Commit**

```bash
git add worker/src/package/build.ts worker/test/package-build.spec.ts
git commit -m "feat: add CF09 pure package builder"
```

---

### CF09 Task 2: Wire package into analyze response (bounded)

**Files:**
- Modify: `worker/src/pipeline/analysis.ts` (import buildPackage, add `package` to result? or keep separate?) — Decision: add `files: Record<string,string>` + `packageWarnings` to `AnalysisResult`? That bloats every test snapshot? Tests use property access, extras are fine.
- Simpler + safer: new route `POST /api/package` that accepts an `AnalysisResult` JSON and returns `{ files }`? Doubles transfer but keeps `/api/analyze` shape stable. Hmm — PRD says Worker streams the bundle; UI already has the analyze JSON, so re-POSTing it costs the same bytes again.
- Decision: include `packageFiles` + `packageWarnings` directly on the analyze response (single round-trip, bounded ~100KB text). Update `AnalysisResult` interface + exactly one return-site edit + `toRecord` untouched.
- Test: `worker/test/analyze-endpoint.spec.ts` — assert `body.packageFiles["theme.css"]` contains `:root`.

**Step 1: Write failing test** (add to analyze-endpoint.spec): `expect(typeof body.packageFiles["theme.css"]).toBe("string")`.
**Step 2: Run** → FAIL (undefined).
**Step 3: Implement**: in `runAnalysis` before return, `const pkg = buildPackage({...result-so-far})` — careful: buildPackage needs the result object; construct result first, then attach. To avoid double-build, build a local `result` const, then `return { ...result, packageFiles: pkg.files, packageWarnings: pkg.warnings }`.
**Step 4: Run** `npm run test -w worker -- analyze-endpoint package-build` → PASS.
**Step 5: Commit** `feat: include CF09 package files in analyze response`.

---

### CF10 Task 1: STORE-only ZIP writer (shared Worker + web)

**Files:**
- Create: `worker/src/package/zip-store.ts`
- Test: `worker/test/zip-store.spec.ts`
- Create (vendor copy): `web/vendor/zip-store.js`
- Create: `web/package.js`

**Step 1: Write the failing test**

```ts
it("writes a STORE zip readable via headers", () => {
  const bytes = createStoreZip({ "a.txt": "hello", "b/b.txt": "world".repeat(100) });
  expect(bytes[0]).toBe(0x50); expect(bytes[1]).toBe(0x4b); // PK
  // central directory ends with file count
});
```

**Step 2: Run** → FAIL (module missing).
**Step 3: Implement** `createStoreZip(files: Record<string, string | Uint8Array>): Uint8Array`:
- UTF-8 encode strings (TextEncoder — available in Worker + browsers).
- CRC32 table-driven (literal table built at runtime, no import).
- Local file headers + central directory + EOCD, method 0 (STORE), no compression, no encryption, no ZIP64. Cap: throw/`warn` when total > 25MB (`zipWarnBytes`)? Return `{ bytes, warnings }` instead of throwing — caller decides. Keep function pure + tiny: `createStoreZip(files): { bytes: Uint8Array; warnings: string[]; fileCount: number; totalBytes: number }`.
- Filenames sanitized (`..` → `_`, backslash → `/`, slice 200).
**Step 4: Run** → PASS. Verify round-trip by parsing central directory in the test (no external dep).
**Step 5: Vendor**: copy file content to `web/vendor/zip-store.js` with a 3-line IIFE wrapper comment (`// Vendored from worker/src/package/zip-store.ts — keep in sync`). `web/package.js` exports `buildZip(packageFiles)` calling global `createStoreZip` + 25MB warn. Commit all.

---

### CF10 Task 2: Stream-friendly response (no Worker compression)

**Files:**
- Modify: `worker/src/http/response.ts` (check existing `json` helper), `worker/src/routes/analyze.ts`
- Test: extend `worker/test/analyze-endpoint.spec.ts`

No new endpoint. Assert: `POST /api/analyze` responds `cache-control: no-store`, JSON parses, `screenshotBytesTotal <= 6MB`, and package files total ≤ 1MB (Worker never buffers >128MB). Document in code comment that ZIP assembly is client-side via `web/package.js` + STORE writer. Test asserts `body.screenshotBytesTotal <= 6*1024*1024` and `JSON.stringify(body.packageFiles).length <= 1*1024*1024`.

---

### CF11: Pages UI (form exists — add download + budget + per-page)

**Files:**
- Modify: `web/index.html`, `web/app.js`, `web/styles.css`
- Vendor: `web/vendor/zip-store.js`, `web/package.js` (from CF10)

Changes (minimal, no framework, no CDN):
- `index.html`: add `#budget` meter section, `#pages` per-page cards section, `#download` button (disabled until result), `<script src="./vendor/zip-store.js">` + `<script src="./package.js">` before `app.js` (classic scripts setting globals; keep `app.js` as module but read globals via `window`).
- `app.js`: after success — render budget (`600s` daily budget minus `browserSecondsUsed`, warn at >80%), render per-page cards (title/path/priority/reason, token tops, tone, asset count, styleLimitations), enable Download ZIP (calls `window.buildZip(packageFiles)` → Blob → `a[download=website-analysis.zip]`). Error state already exists; add `packageWarnings` display. Screenshot display: extend `renderScreenshot` to thumbnails for all pages with `dataUrl` (local dev) + metadata otherwise.
- `styles.css`: ~40 lines for budget bar, page cards, download button.
- Verification: no test runner for web — verify via `node --check` syntax (`node --check web/app.js` etc.) + manual DOM review. Typecheck/tests unaffected.

---

### CF12: Acceptance suite + fidelity rubric

**Files:**
- Create: `worker/test/acceptance.spec.ts`
- Modify: `docs/01-PRD.md` (status only, if green)

11 synthetic scenarios (fake launchers, no network/browser), each asserting the PRD check:
1. static single-page → 1 page, integrityPassed, files include README/theme/tokens.
2. small multi-page (3) → priority order, selection reasons present.
3. react-like (JS-heavy, no sitemap) → discovery via nav links still selects ≥1.
4. nextjs-like (sitemap with 12 urls, maxPages 10) → capped at 10.
5. large-navigation (50 links) → links capped 500 in-page, selection ≤ maxPages.
6. blocked-resource (robots 403 + sitemap 404) → warnings mention robots, partial report still integrityPassed.
7. slow-resource (goto times out on 2nd page) → issues recorded, pagesAnalyzed ≥1, wall-budget limitation path.
8. cross-origin-stylesheet → styleLimitations mention skip, tokens still inferred via sampling.
9. very tall page (height 20000) → screenshot clipped warning, pageHeightPx recorded.
10. large extraction payload → oversize limitation, payload ≤512KB path (reuse huge snapshot).
11. screenshot-heavy (4MB × 3 pages) → byte-cap limitation, later pages screenshotless but analyzed.
Plus rubric test: viewports 1440 + mobile 390 captured; `data/report.json` has limitations array; fidelity gaps (fonts not downloaded, video, JS interactions) disclosed in limitations or docs.

Each test builds its fixture from existing helpers (`makeFakeLauncher`, `makeFakePage`, `mockSiteFetch`, `SAMPLE_SNAPSHOT`) — no new infra.

---

## References

- PRD CF09 `§579-581`, CF10 `§583-585`, CF11 `§587-589`, CF12 `§591-607`, limits `§431-456`, output package `§313-344`, definition of done `§630-644`
- Pipeline: `worker/src/pipeline/analysis.ts`, routes: `worker/src/routes/analyze.ts`, http: `worker/src/http/response.ts`
- Web: `web/index.html`, `web/app.js`, `web/styles.css`, local: `worker/local/server.ts`
- Tests: `worker/test/*`, helpers: `worker/test/helpers.ts`
- Skills: @verification-before-completion (fresh evidence before done claims), @systematic-debugging (root-cause first on failure)
