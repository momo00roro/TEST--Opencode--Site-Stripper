# CF06 Bounded Multi-Page Analysis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the existing multi-page loop in `worker/src/pipeline/analysis.ts` to fully meet CF06 budgets, session hygiene, and partial-report requirements without leaking into CF07 token work.

**Architecture:** Keep one `AnalysisSession`, sequential `newPage()`/`close()` per page with `try/finally`, enforce wall-clock + screenshot count/byte budgets before each capture (including mobile), surface extraction-budget warnings as limitations, and guarantee `session.close()` in a `finally` block.

**Tech Stack:** TypeScript, Cloudflare Workers (`@cloudflare/puppeteer` via injected `SessionLauncher`), `puppeteer-core` locally, Vitest with fake launcher in `worker/test/helpers.ts`.

---

### Task 1: Guarantee session close in finally

**Files:**
- Modify: `worker/src/pipeline/analysis.ts:83-260`
- Test: `worker/test/analyze-endpoint.spec.ts:102-129`

**Step 1: Write the failing test**

Add to `worker/test/pipeline-analysis.spec.ts`:

```ts
it("closes the session when selection throws", async () => {
  const { launcher, state } = makeFakeLauncher("fake");
  const brokenFetch = async () => { throw new Error("discovery boom"); };
  // Force buildSelection to throw by passing invalid selection input via monkey-patch?
  // Simpler: launcher whose second launch fails — assert first session still closed.
});
```

Simpler deterministic version (no monkey-patch): verify session close happens even when a mid-loop capture throws fatally (e.g. `newPage` throws on 2nd call). The existing `analyze-endpoint.spec.ts` already covers homepage failure; extend to mid-loop failure with a custom launcher that throws on 2nd `newPage()` and assert `closed === 1` plus partial `pagesAnalyzed >= 1`.

Minimal test to add:

```ts
it("returns a partial report when a later page fails to open", async () => {
  const { launcher } = makeFakeLauncher("fake");
  // wrap launcher to throw on 2nd newPage
  let calls = 0;
  const origLaunch = launcher.launch.bind(launcher);
  launcher.launch = async () => {
    const session = await origLaunch();
    const origNewPage = session.newPage.bind(session);
    session.newPage = async () => {
      calls += 1;
      if (calls === 2) throw new Error("tab boom");
      return origNewPage();
    };
    return session;
  };
  const result = await runAnalysis(launcher, buildRequest({ maxPages: 3 }), {
    fetchImpl: mockSiteFetch(),
  });
  expect(result.pagesAnalyzed).toBeGreaterThanOrEqual(1);
  expect(result.issues.some((i) => i.includes("tab boom"))).toBe(true);
  expect(result.integrityPassed).toBe(true);
});
```

**Step 2: Run test to verify it fails or leaks**

Run: `npm run test -w worker -- pipeline-analysis`
Expected: PASS for partial report (current code already catches per-page errors), but session-close-on-unexpected-throw still leaks — verify by inspection: `session.close()` is not in `finally`.

**Step 3: Write minimal implementation**

Restructure `runAnalysis()`:

```ts
const session = await launcher.launch();
try {
  // ... homepage, discovery, selection, loop, mobile ...
  return { ... };
} finally {
  await session.close().catch(() => undefined);
}
```

Remove the two ad-hoc `await session.close().catch(...)` calls (homepage-failure path and end-of-function path). For homepage failure, still throw `ApiError(502)` but let `finally` close the session:

```ts
try {
  homepage = await captureOne(...);
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  throw new ApiError("INTERNAL", 502, `Browser capture failed on the homepage: ${message}`);
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -w worker -- pipeline-analysis analyze-endpoint`
Expected: PASS (all existing + new tests).

**Step 5: Commit**

```bash
git add worker/src/pipeline/analysis.ts worker/test/pipeline-analysis.spec.ts
git commit -m "fix: guarantee browser session close in finally for CF06"
```

---

### Task 2: Enforce screenshot count caps + mobile byte cap

**Files:**
- Modify: `worker/src/pipeline/analysis.ts:158-218`
- Test: `worker/test/pipeline-analysis.spec.ts`

**Step 1: Write the failing test**

```ts
it("stops screenshotting after the desktop count cap but keeps analyzing", async () => {
  const { launcher } = makeFakeLauncher("fake");
  const result = await runAnalysis(launcher, buildRequest({ maxPages: 10 }), {
    fetchImpl: mockSiteFetch(),
  });
  expect(result.screenshotsCaptured).toBeLessThanOrEqual(10);
  expect(result.pagesAnalyzed).toBeGreaterThan(0);
});
```

Note: with the fake snapshot only 2 non-home candidates exist, so this passes trivially today. The real failing assertion is the code check: no reference to `LIMITS.maxDesktopScreenshots` / `maxMobileScreenshots` in `analysis.ts`.

**Step 2: Run test to verify current gap**

Run: `npm run test -w worker -- pipeline-analysis`
Expected: PASS but `grep maxDesktopScreenshots worker/src/pipeline/analysis.ts` returns nothing — confirming the cap is unenforced.

**Step 3: Write minimal implementation**

Track counts separately:

```ts
let desktopScreenshots = screenshotsCaptured > 0 ? 1 : 0; // or explicit counter
```

Cleaner: introduce `desktopTaken` and `mobileTaken` counters. Before each desktop capture:

```ts
const canScreenshot =
  screenshotBytesTotal < LIMITS.maxTotalScreenshotBytes &&
  desktopTaken < LIMITS.maxDesktopScreenshots;
```

Pass `captureScreenshot: canScreenshot`. After capture, `desktopTaken += captured.screenshotCount`.

Before mobile capture, check all three:

```ts
if (request.includeMobile && homepageSucceeded) {
  if (Date.now() - startedAt > LIMITS.totalAnalysisWallBudgetMs) {
    limitations.push("Skipped mobile capture: wall budget exhausted.");
  } else if (screenshotBytesTotal >= LIMITS.maxTotalScreenshotBytes) {
    limitations.push(`Skipped mobile capture: screenshot byte cap reached.`);
  } else if (mobileTaken >= LIMITS.maxMobileScreenshots) {
    limitations.push(`Skipped mobile capture: mobile screenshot cap reached.`);
  } else {
    // ... captureOne mobile ...
  }
}
```

Keep the existing `budgetNotice` one-time limitation for desktop byte cap.

**Step 4: Run test to verify it passes**

Run: `npm run test -w worker -- pipeline-analysis`
Expected: PASS.

**Step 5: Commit**

```bash
git add worker/src/pipeline/analysis.ts worker/test/pipeline-analysis.spec.ts
git commit -m "feat: enforce CF06 screenshot count and mobile byte caps"
```

---

### Task 3: Surface extraction-budget overruns as limitations

**Files:**
- Modify: `worker/src/pipeline/analysis.ts:262-308` (`captureOne`)
- Test: `worker/test/pipeline-analysis.spec.ts`

**Step 1: Write the failing test**

```ts
it("records an issue when extraction payload exceeds the hard cap", async () => {
  // fake page returns SAMPLE_SNAPSHOT (~small), so force via tiny limit?
  // Instead assert current warning path exists for oversize payloads by inspecting code.
});
```

Deterministic approach: add a test with a launcher whose snapshot is artificially large (override `evaluate` to return `{...SAMPLE_SNAPSHOT, headings: Array(500).fill({level:2,text:"x".repeat(500)})}`), then assert `warnings` or `limitations` mention the byte budget. Today this yields only a per-page warning, no report-level limitation.

**Step 2: Run test to verify it fails**

Run: `npm run test -w worker -- pipeline-analysis`
Expected: FAIL with "expected warning/limitation to mention budget".

**Step 3: Write minimal implementation**

In `captureOne`, keep the existing warning, and in `runAnalysis` after each capture, if `extractionBytes > LIMITS.maxExtractionPayloadBytes`, push to `issues` (page-specific) — or aggregate once at report level:

```ts
if (extractionBytes > LIMITS.extractionPayloadWarnBytes) {
  warnings.push(`Extraction payload of ${extractionBytes} bytes exceeds the ${LIMITS.extractionPayloadWarnBytes} byte warning threshold.`);
}
```

Keep Worker-safe behavior: only measure via `JSON.stringify().length` (cheap for bounded snapshots), never transform payload in Worker. Add a single report-level limitation when any page exceeded the hard cap:

```ts
if (oversizePages > 0) {
  limitations.push(`${oversizePages} page(s) exceeded the ${LIMITS.maxExtractionPayloadBytes} byte extraction cap; payloads must be pruned in-page in CF07.`);
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -w worker -- pipeline-analysis`
Expected: PASS.

**Step 5: Commit**

```bash
git add worker/src/pipeline/analysis.ts worker/test/pipeline-analysis.spec.ts
git commit -m "feat: surface CF06 extraction budget overruns"
```

---

### Task 4: Check wall budget before mobile + record budget stop cleanly

**Files:**
- Modify: `worker/src/pipeline/analysis.ts:197-224`
- Test: `worker/test/pipeline-analysis.spec.ts`

**Step 1: Write the failing test**

```ts
it("skips mobile capture when the wall budget is exhausted", async () => {
  const { launcher } = makeFakeLauncher("fake");
  // Use maxPages + artificial delay? Simplest: assert code checks wall budget before mobile.
});
```

Implementation-level test: mock `Date.now` to simulate exhausted budget after desktop loop, assert mobile screenshot is null and a limitation mentions wall budget.

**Step 2: Run test to verify it fails**

Run: `npm run test -w worker -- pipeline-analysis`
Expected: FAIL (mobile captured despite exhausted budget).

**Step 3: Write minimal implementation**

As in Task 2 snippet: check `Date.now() - startedAt > LIMITS.totalAnalysisWallBudgetMs` before mobile, push limitation, skip capture. Also ensure the desktop loop's existing wall-budget break stays:

```ts
if (Date.now() - startedAt > LIMITS.totalAnalysisWallBudgetMs) {
  limitations.push(`Analysis stopped after ${pages.length} pages: the ${LIMITS.totalAnalysisWallBudgetMs / 1000}s wall budget was reached.`);
  break;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -w worker -- pipeline-analysis analyze-endpoint browser-capture`
Expected: PASS.

**Step 5: Commit**

```bash
git add worker/src/pipeline/analysis.ts worker/test/pipeline-analysis.spec.ts
git commit -m "fix: enforce CF06 wall budget before mobile capture"
```

---

### Task 5: Full verification + PRD status update

**Files:**
- Modify: `docs/01-PRD.md:559-562,615-618` (CF06 status lines only, if code is green)
- Test: all

**Step 1: Run typecheck**

Run: `npm run typecheck -w worker`
Expected: exit 0, no errors.

**Step 2: Run full suite**

Run: `npm run test -w worker`
Expected: 11 files, 112+ tests (112 baseline + new CF06 tests), 0 failures.

**Step 3: Update PRD status**

Only if green:

```md
### CF06 — Bounded multi-page analysis
Status: implemented and verified by automated tests.
...
- CF06 bounded multi-page analysis loop (sequential tabs, wall-clock timeout budgeting, partial report generation).
```

Change to completed list. Keep CF07–CF12 as upcoming.

**Step 4: Commit**

```bash
git add docs/01-PRD.md
git commit -m "docs: mark CF06 complete"
```

---

## References

- PRD: `docs/01-PRD.md` (CF06 §559-562, numeric limits §431-456, traps §226-302, current status §603-618)
- Pipeline: `worker/src/pipeline/analysis.ts`
- Capture: `worker/src/browser/capture.ts`, `worker/src/browser/types.ts`, `worker/src/browser/launcher.ts`
- Discovery: `worker/src/discovery/discover.ts`, ranking: `worker/src/ranking/key-pages.ts`
- Limits: `worker/src/config/limits.ts`
- Tests: `worker/test/pipeline-analysis.spec.ts`, `worker/test/analyze-endpoint.spec.ts`, `worker/test/helpers.ts`
- Skills: @verification-before-completion (fresh `typecheck` + `test` before any done claim), @systematic-debugging (root-cause first if tests fail)
