# Cinematic UI Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Site Stripper UI's visual world with dark cinematic showcase styling while keeping every functional contract intact.

**Architecture:** Presentation-layer only. `web/index.html` gains CDN links (Space Grotesk, GSAP) and restructured markup with identical element IDs; `web/styles.css` is rewritten around new tokens; `web/app.js` render functions emit the new markup. Worker code, API shapes, NDJSON protocol, ZIP assembly, and `api-base` logic are untouched.

**Tech Stack:** Hand-written CSS (custom properties), GSAP 3 + ScrollTrigger via CDN (deferred), Space Grotesk via Google Fonts (`display=swap`), vanilla JS. No build step.

---

### Task 1: Visual tokens + CDN wiring

**Files:**
- Modify: `web/index.html` (head links, hero markup shell)
- Modify: `web/styles.css:1-60` (token block)

**Step 1: Add CDN links to head**

In `web/index.html` `<head>`, after `styles.css` link, add:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js" defer></script>
```

**Step 2: Replace `:root` tokens**

Replace `web/styles.css:1-20` token block with:

```css
:root {
  color-scheme: dark;
  --bg: #08090d;
  --panel: rgba(255, 255, 255, 0.04);
  --panel-deep: #0c0e14;
  --border: rgba(255, 255, 255, 0.09);
  --border-bright: rgba(255, 255, 255, 0.16);
  --text: #f2f5fa;
  --muted: #9aa6bb;
  --accent: #5b9dff;
  --accent-strong: #3f83f8;
  --accent-ink: #04101f;
  --aurora-b: rgba(91, 157, 255, 0.12);
  --aurora-v: rgba(139, 92, 246, 0.1);
  --success: #4ade80;
  --danger: #ff6b6b;
  --radius: 18px;
  --font-display: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
```

Keep `--shadow-pop`, `--glow-accent`, `--radius` names referenced elsewhere or update usages in the same commit.

**Step 3: Load the page, confirm no console errors**

Run: serve via `http://localhost:8917/`, open DevTools console.
Expected: no errors; GSAP absent from render (not used yet); fonts loading.

**Step 4: Commit**

```bash
git add web/index.html web/styles.css
git commit -m "🎨 Cinematic tokens + CDN wiring (fonts, GSAP)"
```

---

### Task 2: Hero + command-bar form

**Files:**
- Modify: `web/index.html` (hero + form markup, same IDs: `analyze-form`, `url`, `max-pages`, `include-mobile`, `submit`)
- Modify: `web/styles.css` (hero + form sections)

**Step 1: Restructure hero markup**

Full-viewport `.hero` (min-height 92svh): eyebrow, `h1` two-line display
(`Point at a site.<br />Steal its soul.`), lede, logo as glowing mark,
form as glass command-bar, scroll cue. Keep ALL input IDs/names identical.

**Step 2: Style hero + grain + aurora**

Aurora: two fixed radial layers using `--aurora-b`/`--aurora-v`.
Grain: inline SVG feTurbulence data-URI overlay at 3% opacity, `pointer-events: none`.
Headline: `var(--font-display)`, `clamp(3rem, 8vw, 6rem)`, `letter-spacing: -0.04em`.

**Step 3: Verify in browser at 1440px and 390px**

Run: screenshot both viewports via chrome-devtools.
Expected: full-viewport hero, no overlap, form usable at 390px.

**Step 4: Commit**

```bash
git add web/index.html web/styles.css
git commit -m "🎨 Cinematic hero + glass command-bar form"
```

---

### Task 3: Entrance motion (GSAP, reduced-motion safe)

**Files:**
- Modify: `web/app.js` (append init-motion block; guard `window.gsap` presence)
- Modify: `web/styles.css` (initial hidden states under `.js-motion` class only)

**Step 1: Gate on class + gsap presence**

```js
if (window.gsap && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  document.documentElement.classList.add("js-motion");
  gsap.from(".hero > *", { y: 28, opacity: 0, duration: 0.9, stagger: 0.09, ease: "power3.out" });
}
```

CSS hides pre-animation states ONLY under `.js-motion` (no-JS/no-CDN still shows content).

**Step 2: Verify with CDN blocked + reduced-motion**

Run: block `cdn.jsdelivr.net` in DevTools, reload.
Expected: full content visible, zero console errors.

**Step 3: Commit**

```bash
git add web/app.js web/styles.css
git commit -m "🎨 GSAP entrance motion with reduced-motion + no-CDN fallback"
```

---

### Task 4: Analysis theater (timeline + energy budget)

**Files:**
- Modify: `web/index.html` (status section: phase list markup with ids `phase-*`)
- Modify: `web/app.js` (`setProgress`/`consumeStream` wiring: map NDJSON messages to phases; DO NOT change stream parsing)
- Modify: `web/styles.css` (timeline + energy bar)

**Step 1: Add phase timeline markup**

Five phases: Validate, Capture, Discover, Document, Package. Map existing
progress messages by keyword; unknown messages light the nearest phase.
Budget bar keeps `budget-fill`/`budget-text` IDs.

**Step 2: Verify with a live run**

Run: `https://example.com`, max pages 1, on localhost.
Expected: phases light in order; completion state correct; `renderResult` untouched paths still work.

**Step 3: Commit**

```bash
git add web/index.html web/app.js web/styles.css
git commit -m "🎨 Analysis theater: phased timeline + energy budget"
```

---

### Task 5: Results showcase (gallery + cards + deliverable)

**Files:**
- Modify: `web/app.js` (gallery renderer: featured + filmstrip + overlay viewer with keyboard nav; keep `screenshot-container` ID; designed empty state when no `dataUrl`)
- Modify: `web/styles.css` (showcase styles)
- Modify: `web/index.html` (minor: wrap download panel as deliverable; raw JSON into `<details>`)

**Step 1: Rewrite gallery renderer**

Featured first desktop shot, filmstrip thumbnails, overlay viewer
(arrow-key nav, Esc close, focus trap-lite: return focus on close).
Empty state panel when `shots.added === 0`.

**Step 2: Page cards + deliverable panel**

Token chips + coverage bars from existing record fields; download panel
shows package stats; raw JSON moved to collapsed `<details>` (keep `result-body` ID).

**Step 3: Verify end-to-end (local + hosted-shape)**

Run: localhost `https://example.com` max 1 → binaries shown; confirm overlay keyboard nav.
Expected: viewer opens/closes, focus returns, no console errors.

**Step 4: Run worker suite + typecheck**

Run: `npm run typecheck -w worker` (Expected: clean) and `npm test -w worker` (Expected: 230/230).

**Step 5: Commit**

```bash
git add web/app.js web/index.html web/styles.css
git commit -m "🎨 Results showcase: gallery viewer, page cards, deliverable panel"
```

---

### Task 6: Scroll reveals + final pass

**Files:**
- Modify: `web/app.js` (ScrollTrigger batch reveals, same guards as Task 3)
- Modify: `web/styles.css` (contrast/ring audit fixes)

**Step 1: Add batched reveals**

One `ScrollTrigger.batch` over result sections; single pass, no loops.

**Step 2: Accessibility + weight audit**

Check: body contrast ≥4.5:1, focus-visible rings, aria-live intact,
added CDN weight <120 KB (fonts + gsap min). Fix offenders.

**Step 3: Full verification + push**

Run: typecheck clean, 230/230 tests, localhost e2e (example.com ×1 with
screenshots), production smoke after push (example.com ×1 metadata-only).
Then: `git push origin master`, wait for CI green.

**Step 4: Commit + push**

```bash
git add web/app.js web/styles.css
git commit -m "🎨 Scroll reveals + a11y/weight audit"
git push origin master
```
