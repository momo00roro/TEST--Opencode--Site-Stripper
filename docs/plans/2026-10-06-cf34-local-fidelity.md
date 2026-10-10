# CF34-local — Homepage-fidelity extraction (design + implementation)

Date: 2026-10-06. Local-only. Hosted lite path untouched. Zero Cloudflare meter.
Status: **Completed** (shipped; spec `worker/test/cf34-local-pack.spec.ts` green).

> Merged 2026-10-10 from `2026-10-06-cf34-local-fidelity-design.md` +
> `2026-10-06-cf34-local-fidelity-implementation.md` (identical content, one record).

---

## Part I — Design RFC

## §1 Goal & measurement

Goal: localhost pack lets an AI agent rebuild the HOMEPAGE ONLY (1 page each,
no inner pages) of cline.bot and higgsfield.ai to ≥92% fidelity without
viewing the live site — pack only.

- Benchmark pair: Site A cline.bot (content/marketing, prior rebuild ~85–90%),
  Site B higgsfield.ai (interactive/media, video facades, motion).
- Score = 40% layout/section order + 25% tokens (palette/type/spacing/radii/
  shadows) + 20% copy/structure + 15% motion/interactions (video = poster +
  placement, never fake playback).
- Pass = ≥92% on cline.bot; higgsfield ≥90% accepted (video-heavy) with all
  gaps listed in report.json.limitations.
- Rebuild outputs live in `.testing/2026-10-06__cline.bot/` and
  `.testing/2026-10-06__higgsfield.ai/` (homepage only).
- Gate: everything new runs under capture:"full" or ?pack=v2.

## §2 Extractor deepening (local-only)

In worker/src/browser/snapshot-script.ts (in-page) + worker/src/browser/
capture.ts full-profile only:

- Per-section computed-style samples: attach top-5 props per section (bg,
  type, spacing, radius, border) to existing section boxes + semantic roles.
- Token aliasing: cluster raw values → semantic names (brand/primary,
  surface/sunken); keep raw map for traceability. Dark/light pairing where
  body scheme props differ from :root.
- Motion dump: full keyframes + per-element duration/easing/delay +
  scroll-reveal map (record which sections change opacity/transform during
  the existing 0.8-band scroll).
- Event-listener inventory via local Chrome CDP (never hosted): trigger →
  effect pairs for menus/tabs/carousels.
- All new fields optional + capped (350KB warn / 512KB hard payload budget).
  Hosted lite never sees them.

## §3 Pack outputs (client-render, web/package-docs.mjs)

New/upgraded files in the ZIP, homepage-only:

- REBUILD.md — dependency-ordered build spec: tokens → layout shell →
  section-by-section (screenshot ref + token refs + copy block + acceptance
  checkbox each).
- data/motion.json + motion-and-interactions.md — timeline table (element,
  keyframes, duration/easing/delay, scroll-trigger) + GSAP transcription
  snippet per animated block.
- data/components.json + components.md — inventory from fingerprint repeats
  (hero, nav, card, grid) with variant props.
- theme.v2.css (@layer tokens/base/components, clamp() type) +
  tailwind.theme.mjs (v4 @theme) alongside existing files — additive.
- screenshots/annotated/ (section boxes + heading order, Node-canvas local
  render) + responsive-pairs/ (desktop/mobile homepage side-by-side).

## §4 Testing & acceptance

- npm run typecheck -w worker from root (zero errors); spec files run
  separately (full suite OOMs) — new worker/test/cf34-local-pack.spec.ts for
  aliasing + motion timeline + REBUILD ordering.
- Local proof, no CF meter: maxPages 1, homepage only; captures to
  C:\Users\Admin\AppData\Local\Temp\opencode\ab\; packs in gitignored
  .examples/.
- Rebuild trial: agent builds homepage-only from pack alone into the two
  .testing/ folders above, scored by the §1 rubric. Gaps →
  report.json.limitations, never silent.
- Failure modes: payload over budget → prune + limit note; unplayable video
  → poster + placement (honest thumbnail: label); missing font → system
  stack + limitation entry.

---

## Part II — Implementation record (TDD task list, executed 2026-10-06)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship local-only homepage-fidelity extraction (tokens aliasing, per-section styles, motion timeline, ordered REBUILD spec) so an agent rebuilds cline.bot / higgsfield.ai homepages to ≥92%.

**Architecture:** Deepen in-page extractor (snapshot-script.ts, full-profile only, capped payloads) + extend client pack renderer (package-docs.mjs, additive files). Hosted lite path untouched.

**Tech Stack:** TypeScript, vitest, puppeteer-core (local Chrome), web/package-docs.mjs (dependency-free), Node canvas-free annotation (DOM-overlay SVG, no native deps).

---

### Task 1: Token-aliasing spec + renderer helper

**Files:**
- Test: `worker/test/cf34-local-pack.spec.ts`
- Modify: `web/package-docs.mjs`

**Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { buildDocumentationFiles } from "../../web/package-docs.mjs";

describe("cf34 token aliasing", () => {
  it("clusters duplicate color values to one semantic alias", () => {
    const analysis = {
      schemaVersion: "0.2.0",
      request: { url: "https://example.com" },
      pages: [
        { path: "/", tokens: { colors: [{ value: "#9F58FA", count: 5, source: "observed", confidence: "observed" }] }, typography: {}, semanticStyles: [] },
        { path: "/", tokens: { colors: [{ value: "#9f58fa", count: 3, source: "observed", confidence: "observed" }] }, typography: {}, semanticStyles: [] },
      ],
    };
    const { files } = buildDocumentationFiles(analysis, {});
    const tokens = JSON.parse(files["data/tokens.json"]);
    expect(tokens.aliases["brand/primary"]).toMatch(/9f58fa/i);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/cf34-local-pack.spec.ts`
Workdir: `worker/`
Expected: FAIL with `tokens.aliases is undefined`

**Step 3: Write minimal implementation**

In `web/package-docs.mjs`, add `aliasInventory()` (case-insensitive color dedupe → `aliases` map, keep raw `inventory` untouched) and include `aliases` in `w3cTokens()` output.

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/cf34-local-pack.spec.ts`
Workdir: `worker/`
Expected: PASS

**Step 5: Commit**

```bash
git add worker/test/cf34-local-pack.spec.ts web/package-docs.mjs
git commit -m "✨ CF34: token aliasing (semantic clusters, raw map kept) - aliases in data/tokens.json; local-only, lite untouched"
```

### Task 2: Per-section computed-style samples (extractor)

**Files:**
- Test: `worker/test/snapshot-script.spec.ts` (append describe block)
- Modify: `worker/src/browser/snapshot-script.ts`

**Step 1: Write the failing test**

```ts
it("attaches top-5 computed props to each section", () => {
  const src = collectPageSnapshot.toString();
  expect(src).toContain("sectionStyles");
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/snapshot-script.spec.ts`
Workdir: `worker/`
Expected: FAIL (no `sectionStyles` in stringified extractor)

**Step 3: Write minimal implementation**

Inside the self-contained in-page `collectPageSnapshot` (no imports/closures — Trap 5), sample `getComputedStyle(sectionEl)` for `backgroundColor, color, fontSize, padding, borderRadius` per section (max 20 sections, clipped strings), store as `section.sectionStyles`. Keep payload capped.

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/snapshot-script.spec.ts`
Workdir: `worker/`
Expected: PASS

**Step 5: Commit**

```bash
git add worker/src/browser/snapshot-script.ts worker/test/snapshot-script.spec.ts
git commit -m "✨ CF34: per-section computed-style samples (top-5 props, capped) - local-full only in practice; payload budget holds"
```

### Task 3: Motion timeline JSON + markdown

**Files:**
- Test: `worker/test/cf34-local-pack.spec.ts` (append)
- Modify: `web/package-docs.mjs`

**Step 1: Write the failing test**

```js
it("emits data/motion.json timeline with GSAP transcription", () => {
  const { files } = buildDocumentationFiles(minimalAnalysisWithMotion, {});
  expect(files["data/motion.json"]).toBeDefined();
  expect(files["motion-and-interactions.md"]).toContain("gsap");
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/cf34-local-pack.spec.ts`
Workdir: `worker/`
Expected: FAIL (no `data/motion.json`)

**Step 3: Write minimal implementation**

Build `motionTimeline(pages)` from `page.motion` + `page.observedInteractions`: rows of {element, keyframes, duration, easing, delay, scrollTrigger}; render markdown table + one GSAP snippet per animated block. Empty-motion pages → honest "no observed motion" section, never invented.

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/cf34-local-pack.spec.ts`
Workdir: `worker/`
Expected: PASS

**Step 5: Commit**

```bash
git add web/package-docs.mjs worker/test/cf34-local-pack.spec.ts
git commit -m "✨ CF34: motion timeline JSON + GSAP transcription - honest empty-motion copy; local-full source data"
```

### Task 4: Ordered REBUILD.md + components inventory

**Files:**
- Test: `worker/test/cf34-local-pack.spec.ts` (append)
- Modify: `web/package-docs.mjs`

**Step 1: Write the failing test**

```js
it("orders REBUILD.md tokens→shell→sections with acceptance boxes", () => {
  const { files } = buildDocumentationFiles(minimalAnalysis, {});
  const md = files["REBUILD.md"];
  expect(md.indexOf("Tokens")).toBeLessThan(md.indexOf("Section 1"));
  expect(md).toContain("- [ ]");
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/cf34-local-pack.spec.ts`
Workdir: `worker/`
Expected: FAIL (no acceptance boxes / wrong order)

**Step 3: Write minimal implementation**

Rewrite `REBUILD.md` renderer: 1) tokens refs, 2) layout shell (nav/footer from navigation.json), 3) per-section blocks (screenshot path + token refs + copy + `- [ ]` checkbox). Add `data/components.json` + `components.md` from fingerprint repeats (kind counts ≥2 → component entry with variant props).

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/cf34-local-pack.spec.ts`
Workdir: `worker/`
Expected: PASS

**Step 5: Commit**

```bash
git add web/package-docs.mjs worker/test/cf34-local-pack.spec.ts
git commit -m "✨ CF34: ordered REBUILD.md + component inventory - tokens→shell→sections with acceptance boxes"
```

### Task 5: theme.v2 + annotated/responsive pairs (additive, local render)

**Files:**
- Test: `worker/test/cf34-local-pack.spec.ts` (append)
- Modify: `web/package-docs.mjs`, `web/app.js` (composite hook only)

**Step 1: Write the failing test**

```js
it("ships theme.v2.css and responsive pair manifest", () => {
  const { files } = buildDocumentationFiles(minimalAnalysis, {});
  expect(files["theme.v2.css"]).toContain("@layer");
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/cf34-local-pack.spec.ts`
Workdir: `worker/`
Expected: FAIL

**Step 3: Write minimal implementation**

Render `theme.v2.css` (`@layer tokens,base,components`, `clamp()` type from fontSizes) + `tailwind.theme.mjs` (v4 `@theme`). Annotation = SVG overlay manifest (`screenshots/annotated/*.svg` with section rects + heading order, drawn over the PNG by the viewer — no native canvas dep). Responsive pairs = manifest pairing desktop/mobile homepage shots.

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/cf34-local-pack.spec.ts`
Workdir: `worker/`
Expected: PASS

**Step 5: Commit**

```bash
git add web/package-docs.mjs web/app.js worker/test/cf34-local-pack.spec.ts
git commit -m "✨ CF34: theme.v2 + annotation overlays + responsive pairs - additive, old files unchanged"
```

### Task 6: Typecheck + focused suites + local proof

**Files:** none (verification only)

**Step 1: Typecheck from root**

Run: `npm run typecheck -w worker`
Workdir: repo root
Expected: zero errors

**Step 2: Focused specs, one file at a time (full suite OOMs)**

Run: `npx vitest run test/cf34-local-pack.spec.ts` then `npx vitest run test/snapshot-script.spec.ts` then `npx vitest run test/client-package.spec.ts`
Workdir: `worker/`
Expected: all PASS

**Step 3: Local proof, homepage-only, no CF meter**

Restart :8917 server after edits (`start-server.bat` flow), then POST maxPages 1 for cline.bot + higgsfield.ai locally; captures stream to `C:\Users\Admin\AppData\Local\Temp\opencode\ab\`, packs land in gitignored `.examples/`.

**Step 4: Rebuild trial**

Agent rebuilds homepage-only from pack alone into `.testing/2026-10-06__cline.bot/` and `.testing/2026-10-06__higgsfield.ai/`; score vs §1 rubric; gaps filed to report.json.limitations.

**Step 5: Commit proof notes**

```bash
git add docs/plans/2026-10-06-cf34-local-fidelity-implementation.md
git commit -m "📝 CF34: implementation plan + local proof notes - typecheck clean, focused specs pass, homepage trials scored"
```

---

## Outcome

Shipped as designed (Tasks 1–5 in `web/package-docs.mjs` + extractor,
Task 6 verified). Follow-up CF35 (HiDPI heroes, font refs, layout-carrying
pack) shipped separately — see git log `CF35` and the CF39/CF43/CF45 plans
for the continuation into the promptability loop.
