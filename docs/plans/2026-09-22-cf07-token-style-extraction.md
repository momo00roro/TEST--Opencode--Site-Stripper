# CF07 Token and Style Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the in-browser extractor to return bounded CSSOM tokens, typography, breakpoints, motion, and geometry with source/confidence, including Trap 1 fallback and Trap 2 in-page pruning.

**Architecture:** All heavy work stays inside `collectPageSnapshot()` in `worker/src/browser/snapshot-script.ts` (self-contained, zero imports per Trap 5). Worker only passes through bytes: `capturePage` unchanged except larger snapshot type, `analysis.ts` surfaces new fields on `AnalysisPage` plus per-page limitations. Frequency maps + top-N caps keep payloads under 350KB warn / 512KB hard.

**Tech Stack:** TypeScript, `page.evaluate(collectPageSnapshot)`, Vitest DOM shims in `worker/test/snapshot-script.spec.ts`, fake launcher in `worker/test/helpers.ts`.

---

### Task 1: Extend snapshot types with bounded token fields

**Files:**
- Modify: `worker/src/browser/snapshot-script.ts:1-30`
- Test: `worker/test/snapshot-script.spec.ts`

**Step 1: Write the failing test**

Add to `worker/test/snapshot-script.spec.ts`:

```ts
it("exposes token containers with confidence tags", () => {
  saved = installDom([], "Tokens");
  const snapshot = collectPageSnapshot();
  expect(snapshot.tokens.colors.length).toBeLessThanOrEqual(15);
  expect(snapshot.tokens.colors[0]?.confidence).toMatch(/observed|inferred|unknown/);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -w worker -- snapshot-script`
Expected: FAIL with "tokens is undefined".

**Step 3: Write minimal implementation**

Add types (all JSON-serializable, all bounded):

```ts
export type TokenConfidence = "observed" | "inferred" | "unknown";
export interface CountedToken { value: string; count: number; source: string; confidence: TokenConfidence; }
export interface SnapshotTokens {
  colors: CountedToken[];      // top 15
  fontSizes: CountedToken[];   // top 10
  spacing: CountedToken[];     // top 8
  radii: CountedToken[];       // top 8
  borders: CountedToken[];     // top 8
  shadows: CountedToken[];     // top 8
  customProperties: { name: string; value: string }[]; // max 50
}
export interface SnapshotTypography {
  fontFaces: { family: string; src: string; weight: string }[]; // max 20
  lineHeights: CountedToken[];
  letterSpacings: CountedToken[];
}
export interface SnapshotBreakpoints { mediaQueries: { query: string; changedProperties: string[] }[]; } // max 20
export interface SnapshotMotion {
  transitions: { property: string; duration: string; easing: string; delay: string }[]; // max 20
  animations: { name: string; duration: string; easing: string; delay: string }[]; // max 20
  keyframes: string[]; // max 20
}
export interface SnapshotGeometry {
  containerWidths: CountedToken[];
  sampledElements: number;
}
```

Extend `PageSnapshot` with `tokens`, `typography`, `breakpoints`, `motion`, `geometry`, `limitations: string[]`.

**Step 4: Run test to verify it passes**

Run: `npm run test -w worker -- snapshot-script`
Expected: PASS (empty arrays with correct shape initially).

**Step 5: Commit**

```bash
git add worker/src/browser/snapshot-script.ts worker/test/snapshot-script.spec.ts
git commit -m "feat: add CF07 bounded token types"
```

---

### Task 2: Implement Trap 1 three-pass extraction (self-contained)

**Files:**
- Modify: `worker/src/browser/snapshot-script.ts:37-103`
- Test: `worker/test/snapshot-script.spec.ts`

**Step 1: Write the failing test**

```ts
it("samples computed styles when stylesheets are cross-origin", () => {
  // shim document.styleSheets with a sheet whose cssRules throws
  // assert snapshot.limitations contains "Cross-origin stylesheet skipped"
  // assert tokens.colors has inferred entries from getComputedStyle sampling
});
```

Requires extending the DOM shim: `styleSheets`, `getComputedStyle(el)` per-element, `querySelectorAll` for the ~30 sampler selectors. Keep shim minimal: add `styleSheets: []` + per-test override.

**Step 2: Run test to verify it fails**

Run: `npm run test -w worker -- snapshot-script`
Expected: FAIL — no limitations entry.

**Step 3: Write minimal implementation**

Inside `collectPageSnapshot()` only (literals only, no imports):

- Pass 1: `try { for (const sheet of document.styleSheets) { try { rules = sheet.cssRules } catch { limitations.push("Cross-origin stylesheet skipped: " + sheet.href); continue } ... } } catch {}`. Parse `STYLE_RULE` declarations via regex for color/font-size/margin/padding/border-radius/box-shadow/border + `@media` queries (record query + changed props, max 20) + `@font-face` (family/src/weight, max 20). Frequency-map, top-N, confidence `observed`.
- Pass 2: sampler selectors literal array (~30 entries per PRD). For first matching element per selector (cap 30 elements), `getComputedStyle(el)`, collect color/backgroundColor/fontSize/borderRadius/boxShadow/margin/padding/lineHeight/letterSpacing/transition/animation. Frequency-map, top-N, confidence `inferred`. Record `sampledElements`.
- Pass 3: custom props: `getComputedStyle(document.documentElement)` — iterate computed style for `--*`? JSDOM/Chromium exposes via index access; fallback: scan `:root` inline style. Cap 50. Confidence `inferred`, fallback `unknown` entry if none found.
- Motion: from sampled computed styles + CSSOM `TRANSITION`/`ANIMATION` rules, cap 20 each, keyframes names max 20.
- Geometry: container widths from sampled block widths (rounded to int px), frequency top 8.

All caps enforced in-page. No outer references.

**Step 4: Run test to verify it passes**

Run: `npm run test -w worker -- snapshot-script`
Expected: PASS.

**Step 5: Commit**

```bash
git add worker/src/browser/snapshot-script.ts worker/test/snapshot-script.spec.ts
git commit -m "feat: implement CF07 three-pass token extraction"
```

---

### Task 3: Trap 2 in-page byte-budget self-check + emergency pruning

**Files:**
- Modify: `worker/src/browser/snapshot-script.ts`
- Test: `worker/test/snapshot-script.spec.ts`

**Step 1: Write the failing test**

```ts
it("prunes to stay under the extraction hard cap", () => {
  // install 200 headings + large token arrays via shim, assert JSON.stringify(snapshot).length <= 524288
  // and limitations mentions pruning when over 350KB
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -w worker -- snapshot-script`
Expected: FAIL (payload over cap, no pruning note).

**Step 3: Write minimal implementation**

At end of `collectPageSnapshot()`, before return:

```ts
let payload = { ...all fields... };
let serialized = JSON.stringify(payload).length;
if (serialized > 350000) {
  // prune: drop customProperties beyond 20, shadows/borders beyond 4, motion beyond 10, geometry sampled detail
  // rebuild payload, re-measure
  // limitations.push("Extraction payload pruned to stay under budget: ...")
}
if (JSON.stringify(payload).length > 500000) {
  // emergency: keep headings 50, links already capped, tokens top 5 each, drop motion/breakpoints detail
  // limitations.push("Extraction payload exceeded hard cap; reduced to structural tokens.")
}
return payload;
```

Literals `350000`/`500000` inline (Trap 5: no imported LIMITS).

**Step 4: Run test to verify it passes**

Run: `npm run test -w worker -- snapshot-script`
Expected: PASS, payload <= 512KB.

**Step 5: Commit**

```bash
git add worker/src/browser/snapshot-script.ts worker/test/snapshot-script.spec.ts
git commit -m "feat: add CF07 in-page payload pruning"
```

---

### Task 4: Trap 5 serialization guard + surface in pipeline

**Files:**
- Modify: `worker/src/browser/snapshot-script.ts`, `worker/src/pipeline/analysis.ts`, `worker/test/helpers.ts`, `worker/test/pipeline-analysis.spec.ts`, `worker/test/analyze-endpoint.spec.ts`
- Test: `worker/test/snapshot-script.spec.ts`, `worker/test/pipeline-analysis.spec.ts`

**Step 1: Write the failing test**

```ts
it("keeps the extractor self-contained for page.evaluate", () => {
  const source = collectPageSnapshot.toString();
  expect(source).not.toMatch(/__name|__spreadValues|require\(|LIMITS|import/);
  expect(source).toContain("Cross-origin stylesheet skipped");
  expect(source).toContain("350000");
});
```

And pipeline test:

```ts
it("surfaces CF07 tokens and per-page limitations", async () => {
  const { launcher } = makeFakeLauncher("fake");
  const result = await runAnalysis(launcher, buildRequest({ maxPages: 1, includeMobile: false }), { fetchImpl: mockSiteFetch() });
  expect(result.pages[0]?.tokens.colors.length).toBeLessThanOrEqual(15);
  expect(Array.isArray(result.pages[0]?.styleLimitations)).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -w worker -- snapshot-script pipeline-analysis`
Expected: FAIL (no tokens on AnalysisPage).

**Step 3: Write minimal implementation**

- Update `SAMPLE_SNAPSHOT` in `helpers.ts` with empty token containers + `limitations: []` so fake launcher stays type-correct.
- Extend `AnalysisPage` in `analysis.ts` with `tokens`, `typography`, `breakpoints`, `motion`, `geometry`, `styleLimitations`; populate in `toRecord()` by pass-through (no Worker transform — just reference snapshot fields). Merge `snapshot.limitations` into page `warnings`? Keep separate `styleLimitations` + also push into report `limitations`? Minimal: `styleLimitations` per page, no aggregation (avoid CPU).
- Verify no imports added to `snapshot-script.ts` (must stay zero-import).

**Step 4: Run test to verify it passes**

Run: `npm run test -w worker -- snapshot-script pipeline-analysis analyze-endpoint browser-capture`
Expected: PASS.

**Step 5: Commit**

```bash
git add worker/src/browser/snapshot-script.ts worker/src/pipeline/analysis.ts worker/test/helpers.ts worker/test/snapshot-script.spec.ts worker/test/pipeline-analysis.spec.ts
git commit -m "feat: surface CF07 tokens in pipeline with serialization guard"
```

---

### Task 5: Full verification + PRD status update

**Files:**
- Modify: `docs/01-PRD.md` (CF07 status lines only, if green)

**Step 1: Run typecheck**

Run: `npm run typecheck -w worker`
Expected: exit 0.

**Step 2: Run full suite**

Run: `npm run test -w worker`
Expected: 11 files, 117+ tests, 0 failures.

**Step 3: Update PRD status**

Only if green — change `### CF07` to add `Status: implemented and verified by automated tests.` and move bullet from upcoming to completed list.

**Step 4: Commit**

```bash
git add docs/01-PRD.md
git commit -m "docs: mark CF07 complete"
```

---

## References

- PRD: `docs/01-PRD.md:208-264` (extraction strategy + Trap 1/2/5), `§303-312` screenshot policy, `§431-456` numeric limits
- Extractor: `worker/src/browser/snapshot-script.ts`
- Capture: `worker/src/browser/capture.ts`, types: `worker/src/browser/types.ts`
- Pipeline: `worker/src/pipeline/analysis.ts`, limits: `worker/src/config/limits.ts`
- Tests: `worker/test/snapshot-script.spec.ts`, `worker/test/helpers.ts`, `worker/test/pipeline-analysis.spec.ts`, `worker/test/browser-capture.spec.ts`
- Skills: @verification-before-completion (fresh typecheck+test before done), @systematic-debugging (root-cause first)
