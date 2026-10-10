# Site Stripper Professional Mockup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing single landing page with a professional, multi-page Site Stripper marketing mockup, realistic browser-only account flows, and a truthful sample-pack explorer.

**Architecture:** Keep the current Cloudflare Pages + Worker arrangement. Build a public allowlisted static site under `dist/site` that omits the analyzer and app-only assets, while the local Node server continues to serve the analyzer at `/app/`. Sign-up and sign-in validate in the browser, make no submission requests, save no values, and navigate to generic completion pages.

**Tech Stack:** Static HTML/CSS, vanilla browser JavaScript, Node.js ESM build script, existing Cloudflare Pages, existing Worker/local Node server, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-site-stripper-professional-mockup-design.md`

## Global Constraints

- Do not add a database, Pages Function, authentication provider, payment service, CAPTCHA provider, or new hosted service.
- Form values must not be sent to any endpoint, placed in the URL, or written to local storage, session storage, cookies, or another persistent store.
- The public marketing site must not link to, embed, or deploy the analyzer UI. Keep `/app/` available only through the local development server.
- Do not mention presentation/mockup intent in public site copy. Remove the “A CHEEE web tool” label, account/payment reassurance copy, the Alpha Access section, and the “Paid plans are being finalized” note.
- Keep the source repository URL private in public files and metadata.
- Do not invent prices, plan entitlements, testimonials, customer logos, adoption metrics, or unsupported product claims.
- Use the approved palette: purple primary, lavender and gray neutrals, restrained yellow accents; use the exact footer `© 2026 Site Stripper. Made with ❤️ by CHEEE.WORK`.
- Keep the existing Worker analysis behavior and local analyzer behavior unchanged.
- The package preview must reflect files actually emitted by `web/package-docs.mjs`; screenshot files are conditional.
- Do not deploy or publish as part of implementation.
- Do not add dependencies. Run focused test files one at a time; the repository notes the full suite can exhaust memory.

## Review Focus

1. File-preview navigation must resolve to the intended static HTML files from `file://`, localhost, and Pages; pin each route and relative-link target in `worker/test/marketing-site.spec.ts` and browser QA.
2. Valid and invalid mock account submissions must remain entirely in the browser; inputs must not be named for native submission, and no request/storage API may receive their values. Pin validators in `worker/test/mock-account.spec.ts` and inspect browser network/storage state.
3. The sample-pack file tree must be a subset of the generator’s real output for the package fixture; pin it in `worker/test/client-package.spec.ts`.
4. The Pages upload must exclude `app/index.html`, `app.js`, ZIP libraries, and package-generation modules while retaining the local `/app/` route. Pin the allowlist in `worker/test/public-site-build.spec.ts` and `worker/test/local-static.spec.ts`.
5. A run with no screenshot binaries must still be described accurately in the sample page; make the capture note conditional and verify with both populated and empty screenshot manifests.

---

### Task 1: Build the marketing page set and shared visual system

**Files:**
- Create: `worker/test/marketing-site.spec.ts`
- Delete: `worker/test/alpha-site.spec.ts`
- Create: `web/features/index.html`
- Create: `web/how-it-works/index.html`
- Create: `web/faq/index.html`
- Create: `web/sample-pack/index.html` as the initial package-preview shell
- Create: `web/sign-up/index.html` as the initial account-form shell
- Create: `web/sign-in/index.html` as the initial account-form shell
- Create: `web/sign-up/complete/index.html`
- Create: `web/sign-in/complete/index.html`
- Modify: `web/index.html`
- Modify: `web/landing.css`
- Delete: `web/alpha/index.html`

**Interfaces:**
- Produces static routes for `/`, `/features/`, `/how-it-works/`, `/sample-pack/`, `/faq/`, `/sign-up/`, `/sign-in/`, `/sign-up/complete/`, and `/sign-in/complete/`.
- Uses explicit relative links such as `./features/index.html` so the pages work from a `file://` preview as well as HTTP hosting.
- All pages share the same navigation, visual tokens, and exact footer line.

- [x] **Step 1: Write the failing marketing-page contract test**

Create `worker/test/marketing-site.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const page = async (relativePath: string) =>
  readFile(new URL(`../../web/${relativePath}`, import.meta.url), "utf8");

describe("Site Stripper public pages", () => {
  it("includes every linked marketing and account route", async () => {
    const [home, features, howItWorks, samplePack, faq, signUp, signIn, signUpComplete, signInComplete] = await Promise.all([
      page("index.html"),
      page("features/index.html"),
      page("how-it-works/index.html"),
      page("sample-pack/index.html"),
      page("faq/index.html"),
      page("sign-up/index.html"),
      page("sign-in/index.html"),
      page("sign-up/complete/index.html"),
      page("sign-in/complete/index.html"),
    ]);
    for (const html of [home, features, howItWorks, samplePack, faq, signUp, signIn, signUpComplete, signInComplete]) {
      expect(html).toContain("© 2026 Site Stripper. Made with ❤️ by CHEEE.WORK");
      expect(html).not.toMatch(/a CHEEE web tool|alpha access|paid plans are being finalized/i);
      expect(html).not.toMatch(/no account or payment details needed|alpha access does not require payment/i);
      expect(html).not.toContain("/app/");
      expect(html).not.toMatch(/github\.com/i);
    }
    expect(home).toContain('href="./features/index.html"');
    expect(home).toContain('href="./how-it-works/index.html"');
    expect(home).toContain('href="./sample-pack/index.html"');
    expect(home).toContain('href="./faq/index.html"');
    expect(home).toContain('href="./sign-up/index.html"');
    expect(home).toContain('href="./sign-in/index.html"');
  });

  it("keeps product claims tied to the hosted analyzer behavior", async () => {
    const pages = await Promise.all([
      page("index.html"), page("features/index.html"), page("how-it-works/index.html"), page("faq/index.html"),
    ]);
    const copy = pages.join("\n").toLowerCase();
    expect(copy).toContain("10 pages");
    expect(copy).toContain("150 seconds");
    expect(copy).toContain("when captured");
    expect(copy).not.toMatch(/AI-powered|guaranteed screenshots|CAPTCHA bypass/i);
  });
});
```

- [x] **Step 2: Run the new test and confirm the expected missing-page/copy failures**

Run: `npm run test -w worker -- test/marketing-site.spec.ts`

Expected: FAIL because the new routes are missing and the root still contains the withdrawn alpha messaging.

- [x] **Step 3: Replace the home content and create the marketing and account route shells**

Keep the copy grounded in the PRD: public-site analysis, same-site discovery, up to ten pages, hosted 150-second wall limit, conditional captures, structured output, and browser-side ZIP assembly. Do not add pricing, customer stories, metrics, or an analyzer CTA. Use the relative links asserted above. Create a starter page shell for every path in the route contract with the exact footer; Task 2 fills in the sample explorer, and Task 3 wires the account forms. Keep the old Alpha page out of the page map.

- [x] **Step 4: Restyle the shared page system with the approved palette**

In `web/landing.css`, retain purple as the primary action and emphasis color, pale lavender and grayscale surfaces, and small yellow highlights. Remove the previous orange/blue/mint token roles. Style the shared header, footer, navigation, cards, mobile layout, focus state, and reduced-motion behavior once for every marketing page. Extend the contract test to require the purple/lavender/yellow tokens and reject old orange/blue/mint tokens.

- [x] **Step 5: Run the marketing-page contract and commit the pages**

Run: `npm run test -w worker -- test/marketing-site.spec.ts`

Expected: PASS for the route set, removed alpha/account copy, exact footer, and verified capability limits.

Commit: `git add web/index.html web/landing.css web/features/index.html web/how-it-works/index.html web/faq/index.html web/sample-pack/index.html web/sign-up/index.html web/sign-in/index.html web/sign-up/complete/index.html web/sign-in/complete/index.html web/alpha/index.html worker/test/alpha-site.spec.ts worker/test/marketing-site.spec.ts` then `git commit -m "feat: build Site Stripper marketing pages"`.

### Task 2: Show a package preview based on the real ZIP generator

**Files:**
- Modify: `web/sample-pack/index.html`
- Create: `web/sample-pack/files.json`
- Create: `web/sample-pack/preview.json` with excerpts from the captured ZIP
- Create: `web/sample-pack/assets/example-home.webp` from a real local analysis capture
- Extend: `worker/test/client-package.spec.ts`
- Extend: `worker/test/marketing-site.spec.ts`

**Interfaces:**
- Adds `/sample-pack/` and links to it from the home page and navigation.
- `files.json` contains representative, real paths emitted by `buildDocumentationFiles()` plus explicitly conditional screenshot/asset entries.

- [x] **Step 1: Add a failing assertion that the public sample list matches generated files**

Extend `worker/test/client-package.spec.ts`, which already owns the `fixture()` analysis and imports `buildDocumentationFiles()`. Add `readFile` from `node:fs/promises`. Read `web/sample-pack/files.json`, build the package with the existing desktop/mobile/section screenshot fixture, and assert every required displayed path is present in the merged documentation-plus-screenshot map. Assert conditional capture paths have a `whenCaptured: true` flag and are not described as guaranteed. Read `preview.json` and assert each preview path exists in the manifest’s `files`. Use this manifest shape: `{ "files": [{ "path": "README.md" }], "conditional": [{ "path": "screenshots/desktop/home.webp", "whenCaptured": true }] }`.

```ts
it("keeps the public sample tree aligned with generated package paths", async () => {
  const sample = JSON.parse(await readFile(new URL("../../web/sample-pack/files.json", import.meta.url), "utf8"));
  const shots = {
    "screenshots/desktop/home.webp": new Uint8Array([1]),
    "screenshots/mobile/home.webp": new Uint8Array([2]),
    "screenshots/sections/home-1.webp": new Uint8Array([3]),
  };
  const generated = { ...buildDocumentationFiles(fixture(), shots).files, ...shots };
  const withoutShots = buildDocumentationFiles(fixture(), {}).files;
  for (const entry of sample.files) expect(generated[entry.path], entry.path).toBeDefined();
  for (const entry of sample.conditional) {
    expect(entry.whenCaptured).toBe(true);
    expect(withoutShots[entry.path], entry.path).toBeUndefined();
  }
});
```

- [x] **Step 2: Run the focused test and confirm it fails because the sample listing is absent**

Run: `npm run test -w worker -- test/client-package.spec.ts`

Expected: FAIL on the missing sample manifest.

- [x] **Step 3: Capture one genuine sample output using the existing analyzer**

Run the existing local server and open `http://localhost:8787/app/` directly. Analyze `https://example.com/` with `Max pages` set to `1` and mobile capture unchecked. Inspect the generated ZIP. Save its actual desktop capture as `web/sample-pack/assets/example-home.webp`, record the real paths in `web/sample-pack/files.json`, and copy short excerpts from its `README.md`, `data/pages.json`, and `theme.css` into `web/sample-pack/preview.json`. Do not use the unit-test fixture as displayed sample content.

- [x] **Step 4: Create the representative file manifest from the generator’s verified outputs**

Include stable outputs such as `README.md`, `REBUILD.md`, `website-overview.md`, `design-tokens.md`, `data/pages.json`, `data/tokens.json`, `data/report.json`, `pages/home.md`, `theme.css`, and `tailwind.config.js`. Include screenshot paths only as conditional entries. Do not invent a page count, screenshot image, or asset binary.

- [x] **Step 5: Create the accessible sample-pack file browser**

Update `web/sample-pack/index.html` to use the manifest, genuine capture asset, and real excerpts. Show collapsible folder groups for documentation, `data/`, `pages/`, `screenshots/`, and styles. Provide a focused file detail panel with a real excerpt from the captured ZIP, and label screenshot files as present only when capture succeeds. Link back to marketing pages using relative `../index.html`-style targets.

- [x] **Step 6: Add the route to marketing navigation and verify the generated-file contract**

Update the home/navigation and marketing-page test to include `./sample-pack/index.html`.

Run: `npm run test -w worker -- test/client-package.spec.ts`

Expected: PASS for the sample tree’s stable generated files and conditional screenshot entries.

Commit: `git add web/index.html web/sample-pack/index.html web/sample-pack/files.json web/sample-pack/preview.json web/sample-pack/assets/example-home.webp worker/test/client-package.spec.ts worker/test/marketing-site.spec.ts` then `git commit -m "feat: add a real ZIP package preview"`.

### Task 3: Add browser-only sign-up, sign-in, and completion screens

**Files:**
- Modify: `web/sign-up/index.html`
- Modify: `web/sign-in/index.html`
- Verify: `web/sign-up/complete/index.html`
- Verify: `web/sign-in/complete/index.html`
- Create: `web/mock-account.js`
- Create: `worker/test/mock-account.spec.ts`
- Extend: `worker/test/marketing-site.spec.ts`

**Interfaces:**
- `window.SiteStripperMockAccount.validateSignUp(fields)` returns `{ valid: boolean, field?: string, message?: string }` for name, email, password length, and password confirmation.
- `window.SiteStripperMockAccount.validateSignIn(fields)` returns the same result shape for required email/password fields.
- The pages load the classic `web/mock-account.js` script so they work in both `file://` preview and HTTP. Inputs have no `name` attributes; client code prevents native submission, resets fields, and navigates to a generic completion page.

- [x] **Step 1: Write failing validator and static privacy-boundary tests**

Create `worker/test/mock-account.spec.ts` with tests for missing name, invalid email, password shorter than eight characters, mismatched confirmation, valid sign-up, and valid sign-in. Load `web/mock-account.js` into a Node `vm` sandbox with a stub `document.querySelectorAll()` and read the exposed validator methods from `window.SiteStripperMockAccount`. Also read all four account pages and the script and assert the fields have no `name` attributes, the script contains no `fetch`, `XMLHttpRequest`, `localStorage`, `sessionStorage`, or `document.cookie`, and completion copy does not include submitted values or claim an email was sent.

```ts
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../../web/mock-account.js", import.meta.url), "utf8");
const sandbox: { window: Record<string, unknown>; document: { querySelectorAll: () => never[] } } = {
  window: {},
  document: { querySelectorAll: () => [] },
};
runInNewContext(source, sandbox);
const api = sandbox.window.SiteStripperMockAccount as {
  validateSignIn: (fields: { email: string; password: string }) => { valid: boolean };
  validateSignUp: (fields: { fullName: string; email: string; password: string; confirmPassword: string }) => { valid: boolean };
};

describe("browser-only mock account validation", () => {
  it("requires matching sign-up passwords", () => {
    expect(api.validateSignUp({ fullName: "A. User", email: "a@example.com", password: "long-enough", confirmPassword: "different" }).valid).toBe(false);
    expect(api.validateSignUp({ fullName: "A. User", email: "a@example.com", password: "long-enough", confirmPassword: "long-enough" }).valid).toBe(true);
  });

  it("validates sign-in fields without an account lookup", () => {
    expect(api.validateSignIn({ email: "", password: "" }).valid).toBe(false);
    expect(api.validateSignIn({ email: "a@example.com", password: "anything" }).valid).toBe(true);
  });
});
```

- [x] **Step 2: Run the account test and confirm the missing-validator failure**

Run: `npm run test -w worker -- test/mock-account.spec.ts`

Expected: FAIL because `web/mock-account.js` does not exist.

- [x] **Step 3: Implement pure validators and browser-only navigation**

Implement only the two pure validation functions in an IIFE and expose them as `window.SiteStripperMockAccount`. Page handlers call `preventDefault()`, report invalid fields inline, clear all fields on valid input, and navigate to the corresponding completion HTML file. The handlers must not issue requests, write storage/cookies, put values in query parameters, or forward input values to another page. Keep the script a classic script, not an ES module, so local `file://` previews can load it.

- [x] **Step 4: Create the four account screens with the approved visual reference**

Use the existing site header and palette. Sign-up fields: full name, email address, optional company, password, confirm password. Sign-in fields: email and password. Set `autocomplete="off"`, omit every input `name` attribute, and handle valid submit in JavaScript; this keeps native fallback submissions from carrying values. Do not add CAPTCHA, OAuth, remember-me, or password-reset UI. Completion screens use a generic confirmation icon/message and a return-to-site link; they have no analyzer CTA and do not echo personal details.

- [x] **Step 5: Run the focused mock-account tests and commit**

Run: `npm run test -w worker -- test/mock-account.spec.ts`

Expected: PASS for field validation, no automatic data submission, and generic completion copy.

Commit: `git add web/sign-up web/sign-in web/mock-account.js worker/test/mock-account.spec.ts worker/test/marketing-site.spec.ts` then `git commit -m "feat: add mock sign-up and sign-in pages"`.

### Task 4: Publish only the marketing bundle and preserve local `/app/`

**Files:**
- Create: `scripts/build-public-site.mjs`
- Create: `scripts/build-public-site.d.mts`
- Create: `worker/test/public-site-build.spec.ts`
- Modify: `package.json`
- Modify: `.github/workflows/deploy.yml`
- Modify: `worker/local/static.ts`
- Modify: `worker/local/server.ts`
- Modify: `worker/test/local-static.spec.ts`

**Interfaces:**
- Exports `copyPublicSite(sourceRoot: string, outputRoot: string): Promise<void>` from `scripts/build-public-site.mjs`; the CLI clears only the fixed generated target `dist/site/` before calling it.
- Builds `dist/site/` from an explicit allowlist of the marketing pages, shared CSS, Site Stripper mark, mock-account script, and sample manifest.
- The local server continues to map `/app/` to `web/app/index.html`; the public build never copies `app/`, `app.js`, `package.js`, `package-docs.mjs`, `composite-video.mjs`, `styles.css`, or `vendor/zip-store.js`.

- [x] **Step 1: Write failing tests for the build allowlist and local routes**

Create `worker/test/public-site-build.spec.ts`. In a temporary source directory, create every allowlisted marketing entry and forbidden analyzer files. Call `copyPublicSite(sourceRoot, outputRoot)` and assert the marketing files are present while `app/index.html`, `app.js`, `package.js`, and `vendor/zip-store.js` are absent. Add `scripts/build-public-site.d.mts` with the declaration `export declare function copyPublicSite(sourceRoot: string, outputRoot: string): Promise<void>;`. Extend `worker/test/local-static.spec.ts` to keep `/app` and `/app/` mapped locally and map every public directory route to its `index.html`; remove tests for the Launch app injection and alpha route.

- [x] **Step 2: Run build and route tests to confirm they fail before implementation**

Run: `npm run test -w worker -- test/public-site-build.spec.ts`

Run: `npm run test -w worker -- test/local-static.spec.ts`

Expected: the build import is missing; the local static test still expects the removed alpha/injection behavior or lacks the new public route cases.

- [x] **Step 3: Implement the allowlisted public build**

Use Node `fs/promises` to copy only these source entries: `index.html`, `landing.css`, `favicon.svg`, `mock-account.js`, `features/`, `how-it-works/`, `sample-pack/`, `faq/`, `sign-up/`, and `sign-in/`. `copyPublicSite()` does not delete its destination. The CLI removes and recreates only the repository’s fixed `dist/site/` target before copying; the test writes only to its own temporary directory. In the build test, create every allowlisted source entry plus forbidden `app/index.html`, `app.js`, `package.js`, and `vendor/zip-store.js`; assert all public routes and `mock-account.js` appear, while every forbidden path is absent.

- [x] **Step 4: Point manual and CI Pages deployment at `dist/site/`**

Add `build:site` to the root `package.json`. Update `deploy:ui` to run `npm run build:site` before `wrangler pages deploy dist/site --project-name site-stripper-ui`. Add the same build step before the Pages deploy in `.github/workflows/deploy.yml`, and change that deploy path to `dist/site` while preserving its existing branch pin.

- [x] **Step 5: Remove local launch injection but retain the local analyzer route**

Remove `injectLocalLaunchButton()` and the marker replacement from `worker/local/static.ts` and `worker/local/server.ts`. Keep `resolveLocalStaticPath()` traversal protection and add index aliases for the marketing pages and `/app`; remove the obsolete `/alpha` alias. Verify that the root marketing page has no app link while `/app/` remains resolvable locally.

- [x] **Step 6: Run the public-build and local-route tests, then commit**

Run: `npm run test -w worker -- test/public-site-build.spec.ts`

Run: `npm run test -w worker -- test/local-static.spec.ts`

Expected: the allowlisted output contains the marketing pages and excludes all analyzer UI assets; local `/app/` still maps to the analyzer.

Commit: `git add scripts/build-public-site.mjs scripts/build-public-site.d.mts worker/test/public-site-build.spec.ts package.json .github/workflows/deploy.yml worker/local/static.ts worker/local/server.ts worker/test/local-static.spec.ts` then `git commit -m "build: keep the analyzer out of the public site"`.

### Task 5: Update internal docs and run end-to-end review

**Files:**
- Modify: `README.md`
- Modify: `docs/01-PRD.md`
- Verify: all new public routes and `dist/site/`

**Interfaces:**
- Internal docs distinguish the marketing-only public Pages bundle, browser-only mock account screens, and local-only analyzer route.
- No public-facing page or generated deployment output contains the removed Alpha Access copy.

- [x] **Step 1: Update route and deployment documentation**

Update the README Pages target, manual deploy command, architecture diagram, and local development section. Update the PRD user flow to say that the public marketing site contains mock account screens and that the actual analyzer remains available only through local development. Keep the verified analysis limits and package behavior unchanged.

- [x] **Step 2: Run focused verification one file at a time**

Run: `npm run typecheck`

Run: `npm run test -w worker -- test/marketing-site.spec.ts`

Run: `npm run test -w worker -- test/client-package.spec.ts`

Run: `npm run test -w worker -- test/mock-account.spec.ts`

Run: `npm run test -w worker -- test/public-site-build.spec.ts`

Run: `npm run test -w worker -- test/local-static.spec.ts`

Expected: typecheck and each focused test file pass; the full suite is not run as one process because the README documents memory exhaustion.

- [ ] **Step 3: Exercise the complete experience in a browser**
  - Not run: browser policy blocked local `file://` preview and forbids alternate/local-HTTP workarounds for this same browser check. Static route, build, account-flow, and no-storage tests passed.

Use the existing local Node server at `http://localhost:8787/` if it is already running; otherwise run `npm run dev:local -w worker`. Follow every marketing route at desktop and 390 px widths. In a fresh isolated browser context, submit invalid and valid sign-up/sign-in values. Confirm valid forms reach their generic completion screens, page content contains no submitted values, the network panel shows no account-form request, browser storage remains empty, and no public route links to `/app/`. Open `/sample-pack/` and compare the listed paths to the verified sample ZIP. Open local `/app/` directly and verify the existing analyzer remains available.

- [x] **Step 4: Build and inspect the public upload folder**

Run `npm run build:site`. Inspect `dist/site/` and confirm all marketing/account/sample routes are present and `app/`, `app.js`, `package.js`, `package-docs.mjs`, and `vendor/zip-store.js` are absent. Run `git diff --check` and `git status --short --branch`.

- [x] **Step 5: Commit docs and final verification notes**

Commit: `git add README.md docs/01-PRD.md` then `git commit -m "docs: describe the Site Stripper marketing mockup"`.

## Execution Handoff

Implementation proceeded after the user approved the design and plan; all implementation tasks are complete except the browser check noted above.
