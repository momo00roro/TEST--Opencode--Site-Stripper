# Site Stripper Static Alpha Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Turn the Site Stripper hosted root into a polished CHEEE product page, preserve the analyzer at `/app`, and add an honest account-free alpha entry flow.

**Architecture:** Keep the current static Cloudflare Pages site and analysis Worker. Move the existing analyzer HTML under `/app`, keep its client modules and API behavior, and serve the public landing and alpha access pages as static files. The local Node server maps `/app` to the analyzer and injects a Launch app link into the homepage; no auth provider, payment service, database, Pages Function, or other backend integration is added.

**Tech Stack:** Static HTML/CSS/vanilla JavaScript, Cloudflare Pages, the existing Cloudflare Worker API, local Node server, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-site-stripper-alpha-experience-design.md`

## Global Constraints

- Use only the current Cloudflare Pages + Worker setup and local server; add no auth/payment provider, D1 database, Pages Function, or new hosted service.
- Do not collect email addresses, passwords, or card details. Do not claim that a user signed in, an account was created, or a payment succeeded.
- Preserve the analyzer’s existing request validation, analysis pipeline, downloadable ZIP format, and client-side package generation.
- The hosted analyzer supports up to 10 pages and a 150-second run budget; screenshot files are included when capture succeeds and may be partial or unavailable.
- Never present the Cloudflare account-wide Browser Run allowance as an individual user plan or quota.
- Do not invent prices, trials, plan limits, or plan benefits. The alpha page may state that paid plans are not available yet and that alpha access does not require payment.
- Keep the product confident and CHEEE-branded. Do not use “demo,” “MVP,” “experiment,” or presentation-purpose copy in public content.
- Do not add customer logos, testimonials, metrics, mock screenshots, or the source repository URL to the website, metadata, screenshots, or public documentation.

## Review Focus

1. `/app`, `/app/`, and app-relative asset paths resolve both locally and on Pages; path traversal cannot escape `web/`. Pin in `worker/test/local-static.spec.ts`.
2. The localhost homepage gets exactly one Launch app link from the local server, while the deployed static page contains no rendered development shortcut. Pin marker injection and no-marker behavior in `worker/test/local-static.spec.ts`.
3. Alpha access and pricing actions do not collect email/password/card data or claim account/payment success. Pin in `worker/test/alpha-site.spec.ts`.
4. Landing and analyzer copy describe screenshots as conditional, remove the stale metadata-only/MVP claims, and keep claims about the 10-page and 150-second limits accurate. Pin in `worker/test/alpha-site.spec.ts`.
5. `/health` continues to report service/schema/features without exposing the misleading `environment: development` field. Pin in `worker/test/health.spec.ts`.

---

### Task 1: Serve the existing analyzer at `/app` locally and on Pages

**Files:**
- Create: `worker/local/static.ts`
- Create: `worker/test/local-static.spec.ts`
- Create: `web/app/index.html` by relocating the current analyzer markup from `web/index.html`
- Modify: `worker/local/server.ts`

**Interfaces:**
- Produces `resolveLocalStaticPath(pathname: string, webRoot: string): string | null`, returning the resolved file path for a local static request or `null` when it would escape the web root.
- Produces `injectLocalLaunchButton(html: string): string`, replacing the `<!-- LOCAL_LAUNCH_BUTTON -->` marker with one local-only link. If the marker is absent, it returns the HTML unchanged.
- The moved analyzer page references the existing root assets with `../` paths, so `web/app.js`, `web/styles.css`, `web/package.js`, `web/package-docs.mjs`, `web/composite-video.mjs`, `web/vendor/zip-store.js`, and `web/favicon.svg` remain at their current locations.

- [x] **Step 1: Write the failing local static-route tests**

```ts
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { injectLocalLaunchButton, resolveLocalStaticPath } from "../local/static";

const webRoot = fileURLToPath(new URL("../../web", import.meta.url));

describe("local static routes", () => {
  it("maps the root and analyzer aliases to their HTML files", () => {
    expect(resolveLocalStaticPath("/", webRoot)).toBe(resolve(webRoot, "index.html"));
    expect(resolveLocalStaticPath("/app", webRoot)).toBe(resolve(webRoot, "app/index.html"));
    expect(resolveLocalStaticPath("/app/", webRoot)).toBe(resolve(webRoot, "app/index.html"));
    expect(resolveLocalStaticPath("/app.js", webRoot)).toBe(resolve(webRoot, "app.js"));
  });

  it("rejects paths that resolve outside the static root", () => {
    expect(resolveLocalStaticPath("/../../README.md", webRoot)).toBeNull();
  });
});

describe("local launch button injection", () => {
  it("replaces the homepage marker with one Launch app link", () => {
    const html = "<header><!-- LOCAL_LAUNCH_BUTTON --></header>";
    const rendered = injectLocalLaunchButton(html);
    expect(rendered).toContain('<a class="local-launch" href="/app/">Launch app</a>');
    expect(rendered).not.toContain("<!-- LOCAL_LAUNCH_BUTTON -->");
  });

  it("leaves pages without the marker unchanged", () => {
    expect(injectLocalLaunchButton("<main>Alpha access</main>")).toBe("<main>Alpha access</main>");
  });
});
```

- [x] **Step 2: Run the focused test and confirm it fails because the helper is not implemented**

Run: `npm run test -w worker -- test/local-static.spec.ts`

Expected: FAIL with a module-resolution or missing-export error for `../local/static`.

- [x] **Step 3: Add the safe local path mapper and marker replacement**

```ts
import { join, resolve, sep } from "node:path";

const LOCAL_LAUNCH_MARKER = "<!-- LOCAL_LAUNCH_BUTTON -->";
const LOCAL_LAUNCH_LINK = '<a class="local-launch" href="/app/">Launch app</a>';

export function resolveLocalStaticPath(pathname: string, webRoot: string): string | null {
  const root = resolve(webRoot);
  const relative = pathname === "/"
    ? "index.html"
    : pathname === "/app" || pathname === "/app/"
      ? "app/index.html"
      : pathname.replace(/^\/+/, "");
  const target = resolve(join(root, relative));
  return target === root || target.startsWith(`${root}${sep}`) ? target : null;
}

export function injectLocalLaunchButton(html: string): string {
  return html.replace(LOCAL_LAUNCH_MARKER, LOCAL_LAUNCH_LINK);
}
```

- [x] **Step 4: Route local static requests through the helper and add the analyzer entry page**

In `worker/local/server.ts`, use `resolveLocalStaticPath()` instead of building the target inline. Return `403` for `null`; retain the existing MIME map, cache headers, and 404 behavior. When the requested path is `/`, pass the loaded HTML through `injectLocalLaunchButton()` before responding. When the requested path is `/app` or `/app/`, serve `web/app/index.html`.

Create `web/app/index.html` from the existing analyzer page. Change the stylesheet and favicon paths to `../styles.css` and `../favicon.svg`, and change the script paths to `../vendor/zip-store.js`, `../package.js`, and `../app.js`. Preserve the `api-base` value, analyzer form IDs, output panels, and all existing app controls.

- [x] **Step 5: Run the focused tests and commit the route split**

Run: `npm run test -w worker -- test/local-static.spec.ts`

Expected: PASS for root/app aliases, asset paths, traversal rejection, and local-only link injection.

Commit: `git add worker/local/static.ts worker/local/server.ts worker/test/local-static.spec.ts web/app/index.html` then `git commit -m "feat: serve analyzer at app route"`.

### Task 2: Build the CHEEE-branded product page and alpha access page

**Files:**
- Create: `web/landing.css`
- Create: `web/alpha/index.html`
- Create: `worker/test/alpha-site.spec.ts`
- Modify: `web/index.html`

**Interfaces:**
- Consumes the `<!-- LOCAL_LAUNCH_BUTTON -->` marker that Task 1’s local server replaces.
- Produces static routes `/` and `/alpha/`; all analyzer CTAs point to `/app/`.
- Produces no form submission, user persistence, password handling, card input, or payment result state.

- [x] **Step 1: Write the failing static-page contract tests**

```ts
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const landing = await readFile(new URL("../../web/index.html", import.meta.url), "utf8");
const alpha = await readFile(new URL("../../web/alpha/index.html", import.meta.url), "utf8");
const analyzer = await readFile(new URL("../../web/app/index.html", import.meta.url), "utf8");

describe("Site Stripper alpha pages", () => {
  it("keeps product and local-app routes available", () => {
    expect(landing).toContain("<!-- LOCAL_LAUNCH_BUTTON -->");
    expect(landing).toContain('href="/app/"');
    expect(landing).toContain('href="/alpha/"');
    expect(alpha).toContain('href="/app/"');
    expect(analyzer).toContain('id="analyze-form"');
  });

  it("states that alpha access does not create an account or require payment", () => {
    expect(alpha).toContain("Alpha access");
    expect(alpha).toContain("No account or payment is required");
    expect(alpha).not.toMatch(/<form\b|<input\b|<textarea\b|<select\b/i);
    expect(alpha).not.toMatch(/payment succeeded|account created|you are signed in/i);
  });

  it("avoids unapproved prices and unsupported public claims", () => {
    for (const page of [landing, alpha]) {
      expect(page).not.toMatch(/\b(?:MVP|demo|experiment|presentation)\b/i);
      expect(page).not.toMatch(/github\.com/i);
    }
    expect(landing).toContain("Paid plans are being finalized");
    expect(landing).not.toMatch(/(?:S\$|US\$|\$)\s?\d|\bSGD\s?\d/i);
  });
});
```

- [x] **Step 2: Run the focused test and confirm it fails against the current homepage**

Run: `npm run test -w worker -- test/alpha-site.spec.ts`

Expected: FAIL because `/alpha/` and the static product page do not exist yet.

- [x] **Step 3: Replace the root analyzer page with a static product landing page**

Create semantic sections in `web/index.html` for the CHEEE/Site Stripper header, product hero, audience, three-step workflow, verified output contents, alpha pricing status, and FAQ. Use this exact product language as the starting copy:

```html
<h1>Turn a website into a clearer rebuild brief.</h1>
<p>Analyze a public site and organize its page structure, design observations, content, and available captures into a downloadable reference pack.</p>
<p>Alpha access does not require an account or payment.</p>
```

Add `<!-- LOCAL_LAUNCH_BUTTON -->` in the header where the localhost server can insert its CTA. Link the main “Open the app” and “Continue to alpha” actions to `/app/` and `/alpha/`. Link sign-in/account affordances to `/alpha/`; do not present a form as a real authentication flow.

The pricing area must say `Paid plans are being finalized` and `No account or payment is required for alpha access`. Do not add numeric plan prices, trial terms, usage allowances, or benefits.

- [x] **Step 4: Add the alpha access page without collecting identity or payment data**

Create `web/alpha/index.html` with a page title, Site Stripper/CHEEE branding, a short explanation that the current alpha opens the analyzer without an account, and one `Continue to app` link to `/app/`. Use no `<form>`, `<input>`, or checkout UI. Keep all copy free of claims that an account was created, a user signed in, or payment succeeded.

- [x] **Step 5: Add responsive landing styles, run the page tests, and commit**

Create `web/landing.css` with a light background, dark readable text, restrained orange and blue accents, a strong hero, clear content bands, card-based output summary, responsive navigation, and `:focus-visible` styles. Reuse the existing monster SVG identity from `web/favicon.svg`; do not create fake product screenshots or new image dependencies.

Run: `npm run test -w worker -- test/alpha-site.spec.ts`

Expected: PASS for route links, the alpha-only access copy, absence of personal/payment forms, and absence of unapproved prices or banned terms.

Commit: `git add web/index.html web/landing.css web/alpha/index.html worker/test/alpha-site.spec.ts` then `git commit -m "feat: add Site Stripper alpha landing page"`.

### Task 3: Correct hosted capture and health copy; align documentation

**Files:**
- Modify: `web/app.js`
- Modify: `web/app/index.html`
- Modify: `worker/src/routes/health.ts`
- Modify: `worker/test/health.spec.ts`
- Modify: `README.md`
- Modify: `docs/01-PRD.md`
- Extend: `worker/test/alpha-site.spec.ts`

**Interfaces:**
- Keeps the analyzer API schema and response data unchanged.
- Removes only the misleading public environment label from `/health`; status, service, schema version, browser capability, page limit, timestamp, and cache policy stay intact.
- Updates existing UI copy to distinguish hosted lighter capture from local full capture.

- [x] **Step 1: Add failing assertions for accurate capture copy and health metadata**

In `worker/test/alpha-site.spec.ts`, load `web/app.js` and assert it does not contain `metadata-only, screenshots excluded by design` or `host cannot capture pixels`, and does contain the exact hosted notice `Screenshots are included when captured; hosted capture may be partial.` Assert that the landing, alpha, and analyzer HTML contain none of `MVP`, `demo`, or `experiment`. In `worker/test/health.spec.ts`, assert the response body does not have an `environment` property while the current status, schema, and feature assertions still pass.

- [x] **Step 2: Run the focused tests and confirm the stale strings/field fail**

Run: `npm run test -w worker -- test/alpha-site.spec.ts`

Run: `npm run test -w worker -- test/health.spec.ts`

Expected: the new capture-copy assertion fails on the old UI string; the health assertion fails because the current response includes `environment`.

- [x] **Step 3: Correct app notices without changing analyzer requests**

In `web/app/index.html`, replace the old `Cloudflare-only MVP` lede with the verified structured-reference-pack description used in the approved spec. Replace the daily free-tier note with `Hosted runs share daily browser capacity; complex or protected sites may return partial results.` Keep the 10-page control and mobile-capture control intact.

In `web/app.js`, update the top API-base comment and the environment pill to say that hosted capture uses a lighter profile and screenshot binaries are included when capture succeeds. Replace the empty-state claim that Cloudflare cannot capture pixels with `No screenshots were included in this run. Captures depend on the source site and hosted limits; local runs use the full capture profile.` Keep `fetch`, request payloads, page rendering, and ZIP assembly unchanged.

- [x] **Step 4: Remove the misleading health environment field and update product docs**

In `worker/src/routes/health.ts`, remove `environment` from the returned JSON. Update `worker/test/health.spec.ts` to assert its absence and keep all other health assertions. In `README.md`, describe the root as the SaaS-style alpha landing page and the existing analyzer as `/app`; replace the outdated Cloudflare metadata-only UI description. In `docs/01-PRD.md`, document the static root + `/app` routes while preserving the existing analysis limits and no-account alpha scope.

- [x] **Step 5: Run focused tests and commit the copy/documentation corrections**

Run: `npm run test -w worker -- test/alpha-site.spec.ts`

Run: `npm run test -w worker -- test/health.spec.ts`

Expected: both tests pass; `/health` no longer says `development`, and the app copy no longer claims hosted screenshots are excluded.

Commit: `git add web/app.js worker/src/routes/health.ts worker/test/health.spec.ts worker/test/alpha-site.spec.ts README.md docs/01-PRD.md` then `git commit -m "docs: align alpha copy with hosted behavior"`.

### Task 4: Build and exercise the local alpha experience

**Files:**
- Verify: `web/index.html`, `web/landing.css`, `web/alpha/index.html`, `web/app/index.html`
- Verify: `worker/local/server.ts`, `worker/local/static.ts`
- Verify: `worker/src/routes/health.ts`

**Interfaces:**
- Uses the public static root, alpha route, local `/app` alias, and existing `/api/analyze` behavior from Tasks 1–3.

- [x] **Step 1: Run typechecking and focused tests**

Run: `npm run typecheck`

Run these Vitest files one at a time because the repository README notes that the full suite can exhaust memory:

```text
npm run test -w worker -- test/local-static.spec.ts
npm run test -w worker -- test/alpha-site.spec.ts
npm run test -w worker -- test/health.spec.ts
npm run test -w worker -- test/analyze-endpoint.spec.ts
```

Expected: typechecking completes without errors, and each focused test file passes.

- [x] **Step 2: Run the local server and check the homepage at desktop and mobile widths**

Run: `npm run dev:local -w worker`

Open `http://localhost:8787/` and verify the desktop layout, a 390 px viewport, keyboard focus visibility, working FAQ links, and the injected “Launch app” button. Verify that the static HTML deployed from `web/index.html` contains only the marker comment and no rendered localhost control.

- [x] **Step 3: Open `/app/` and exercise a one-page local analysis**

Open `http://localhost:8787/app/`, submit `https://example.com/` with `Max pages` set to `1` and mobile capture unchecked, then download the ZIP. Verify the existing result panels and package validation still work and that the ZIP contains the expected Markdown/JSON files plus `screenshots/desktop/home.webp` when the local capture succeeds.

- [x] **Step 4: Check alpha actions and public copy**

From `/`, open each alpha/sign-in/create-account affordance. Verify each reaches the alpha information page, that `Continue to app` reaches the real analyzer, and that no form collects identity or card details or claims successful signup/payment.

- [x] **Step 5: Review the finished local diff**

Run: `git diff --check`

Run: `git status --short --branch`

Expected: no whitespace errors, only the planned UI, local routing, health copy, tests, and documentation changes; no new dependencies or provider configuration.

## Execution Handoff

Implementation starts after the user reviews this plan and selects an execution method. Use native execution in this session unless the user explicitly requests subagent delegation.

## Execution Record

- Completed locally on `master`; no publish or push was performed.
- Verification: typecheck passed; focused tests passed (local-static 4/4, alpha-site 4/4, health 7/7, analyze-endpoint 17/17).
- Browser exercise: desktop and 390 px layouts, keyboard focus, FAQ disclosure, local-only Launch app injection, `/alpha/` to `/app/`, one-page local analysis, and ZIP contents were checked.
- Final route correction: `/alpha` and `/alpha/` map to `web/alpha/index.html` in the local server.