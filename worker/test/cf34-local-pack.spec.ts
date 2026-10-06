import { describe, it, expect } from "vitest";
import { buildDocumentationFiles } from "../../web/package-docs.mjs";

describe("cf34 token aliasing", () => {
  it("clusters duplicate color values to one semantic alias", () => {
    const analysis = {
      schemaVersion: "0.2.0",
      request: { url: "https://example.com", hostname: "example.com", maxPages: 2 },
      pages: [
        { path: "/", tokens: { colors: [{ value: "#9F58FA", count: 5, source: "observed", confidence: "observed" }] }, typography: {}, semanticStyles: [] },
        { path: "/", tokens: { colors: [{ value: "#9f58fa", count: 3, source: "observed", confidence: "observed" }] }, typography: {}, semanticStyles: [] },
      ],
      selection: { candidates: [] },
      pagesDiscovered: 2,
      pagesSelected: 2,
      pagesAnalyzed: 2,
      screenshotsCaptured: 0,
      screenshotBytesTotal: 0,
      browserSecondsUsed: 0,
      issues: [],
      warnings: [],
      limitations: [],
      integrityPassed: true,
      assets: [],
      assetCount: 0,
    };
    const { files } = buildDocumentationFiles(analysis, {});
    const tokens = JSON.parse(files["data/tokens.json"]);
    expect(tokens.aliases["brand/primary"]).toMatch(/9f58fa/i);
  });
});

describe("cf34 motion timeline", () => {
  it("emits data/motion.json timeline with GSAP transcription", () => {
    const analysis = {
      schemaVersion: "0.2.0",
      request: { url: "https://example.com", hostname: "example.com", maxPages: 2 },
      pages: [
        {
          path: "/",
          url: "https://example.com/",
          title: "Home",
          tokens: {},
          typography: {},
          semanticStyles: [],
          // REAL page.motion shape (see SnapshotMotion): per-row timing has
          // no selector; observed selectors ride animatedSelectors.
          motion: {
            transitions: [{ property: "opacity", duration: "0.6s", easing: "ease-out", delay: "0s" }],
            animations: [],
            keyframes: [],
            animatedSelectors: [".hero"],
          },
          observedInteractions: [],
        },
        {
          path: "/about",
          url: "https://example.com/about",
          title: "About",
          tokens: {},
          typography: {},
          semanticStyles: [],
          motion: { transitions: [], animations: [], keyframes: [], animatedSelectors: [] },
          observedInteractions: [],
        },
      ],
      selection: { candidates: [] },
      pagesDiscovered: 2,
      pagesSelected: 2,
      pagesAnalyzed: 2,
      screenshotsCaptured: 0,
      screenshotBytesTotal: 0,
      browserSecondsUsed: 0,
      issues: [],
      warnings: [],
      limitations: [],
      integrityPassed: true,
      assets: [],
      assetCount: 0,
    };
    const { files } = buildDocumentationFiles(analysis, {});
    expect(files["data/motion.json"]).toBeDefined();
    const timeline = JSON.parse(files["data/motion.json"]);
    expect(JSON.stringify(timeline)).toContain(".hero");
    expect(files["motion-and-interactions.md"]).toContain("gsap");
    expect(files["motion-and-interactions.md"]).toContain("No observed motion on this page.");
  });
});

describe("cf35-1 accent-first aliasing", () => {
  const accentFixture = (semanticStyles: Array<{ role: string; color: string }>, colors?: Array<{ value: string; count: number; source?: string; confidence?: string }>) => ({
    schemaVersion: "0.2.0",
    request: { url: "https://example.com", hostname: "example.com", maxPages: 1 },
    pages: [
      {
        path: "/",
        tokens: {
          colors: colors || [
            { value: "rgb(255, 255, 255)", count: 32, source: "observed", confidence: "observed" },
            { value: "rgb(21, 21, 22)", count: 28, source: "observed", confidence: "observed" },
            { value: "rgb(159,88,250)", count: 8, source: "observed", confidence: "observed" },
          ],
        },
        typography: {},
        semanticStyles,
      },
    ],
    selection: { candidates: [] },
    pagesDiscovered: 1,
    pagesSelected: 1,
    pagesAnalyzed: 1,
    screenshotsCaptured: 0,
    screenshotBytesTotal: 0,
    browserSecondsUsed: 0,
    issues: [],
    warnings: [],
    limitations: [],
    integrityPassed: true,
    assets: [],
    assetCount: 0,
  });

  it("picks the saturated accent for brand/primary, never the frequent white", () => {
    // cline.bot shape: white page bg (cnt 32) + near-black text (cnt 28)
    // dwarf the true brand purple (cnt 8), which the heading-1 sample pins.
    const analysis = accentFixture([{ role: "heading-1", color: "rgb(159, 88, 250)" }]);
    const { files } = buildDocumentationFiles(analysis, {});
    const tokens = JSON.parse(files["data/tokens.json"]);
    expect(tokens.aliases["brand/primary"]).toMatch(/159.*88.*250/);
    expect(String(tokens.aliases["brand/primary"]).toLowerCase()).not.toMatch(/255,\s*255,\s*255/);
    expect(String(tokens.aliases["brand/secondary"] || "").toLowerCase()).not.toMatch(/255,\s*255,\s*255|21,\s*21,\s*22/);
    expect(tokens.aliases["surface/base"]).toMatch(/255.*255.*255/);
    // Raw token-N keys stay frequency-ranked and untouched by aliasing.
    expect(tokens.colors["token-1"].value).toBe("rgb(255, 255, 255)");
    expect(tokens.colors["token-3"].value).toBe("rgb(159,88,250)");
  });

  it("regression: saturation alone beats frequency without semanticStyles", () => {
    const analysis = accentFixture([]);
    const { files } = buildDocumentationFiles(analysis, {});
    const tokens = JSON.parse(files["data/tokens.json"]);
    expect(tokens.aliases["brand/primary"]).toMatch(/159.*88.*250/);
  });

  it("picks lime over light-gray on a higgsfield-style inventory", () => {
    const analysis = accentFixture([], [
      { value: "rgb(247, 247, 248)", count: 8, source: "observed", confidence: "observed" },
      { value: "rgb(255, 255, 255)", count: 8, source: "observed", confidence: "observed" },
      { value: "currentcolor", count: 6, source: "observed", confidence: "observed" },
      { value: "rgb(19, 21, 23)", count: 3, source: "observed", confidence: "observed" },
      { value: "rgb(209, 254, 23)", count: 3, source: "observed", confidence: "observed" },
      { value: "var(--normal-text)", count: 3, source: "observed", confidence: "observed" },
    ]);
    const { files } = buildDocumentationFiles(analysis, {});
    const tokens = JSON.parse(files["data/tokens.json"]);
    expect(tokens.aliases["brand/primary"]).toMatch(/209.*254.*23/);
    expect(tokens.aliases["surface/base"]).toMatch(/247.*247.*248|255.*255.*255/);
  });
});

describe("cf34-local task 5: theme.v2 + annotated/responsive pairs", () => {
  it("emits theme.v2.css, tailwind.theme.mjs and responsive-pairs manifest", () => {
    const analysisWithTokens = {
      schemaVersion: "0.2.0",
      request: { url: "https://example.com", hostname: "example.com", maxPages: 1 },
      pages: [
        {
          path: "/",
          url: "https://example.com/",
          title: "Home",
          viewport: { width: 1440, height: 900 },
          tokens: {
            colors: [
              { value: "#9F58FA", count: 5, source: "observed", confidence: "observed" },
              { value: "#111111", count: 3, source: "observed", confidence: "observed" },
            ],
            fontSizes: [
              { value: "16px", count: 4, source: "observed", confidence: "observed" },
              { value: "32px", count: 2, source: "observed", confidence: "observed" },
            ],
            spacing: [
              { value: "8px", count: 3, source: "observed", confidence: "observed" },
              { value: "24px", count: 2, source: "observed", confidence: "observed" },
            ],
            radii: [],
            borders: [],
            shadows: [],
            gradients: [],
            icons: [],
            customProperties: [],
          },
          typography: {},
          semanticStyles: [],
          motion: { transitions: [], animations: [], keyframes: [], animatedSelectors: [] },
          observedInteractions: [],
          content: {
            blocks: [{ order: 0, kind: "heading", tag: "h1", headingLevel: 1, sectionIndex: 0, text: "Welcome", truncated: false }],
            sections: [{ role: "hero", heading: "Welcome", textExcerpt: "Hello" }],
          },
          sectionLayouts: [],
          screenshot: { kind: "webp", bytes: 24, width: 1440, height: 900 },
          mobileScreenshot: { kind: "webp", bytes: 12, width: 390, height: 844 },
        },
      ],
      selection: { candidates: [] },
      pagesDiscovered: 1,
      pagesSelected: 1,
      pagesAnalyzed: 1,
      screenshotsCaptured: 2,
      screenshotBytesTotal: 36,
      browserSecondsUsed: 0,
      issues: [],
      warnings: [],
      limitations: [],
      integrityPassed: true,
      assets: [],
      assetCount: 0,
    };
    const { files } = buildDocumentationFiles(analysisWithTokens, {});
    expect(files["theme.v2.css"]).toBeDefined();
    expect(files["theme.v2.css"]).toContain("@layer");
    expect(files["tailwind.theme.mjs"]).toBeDefined();
    expect(files["tailwind.theme.mjs"]).toContain("@theme");
    expect(files["data/responsive-pairs.json"]).toBeDefined();
    const pairsDoc = JSON.parse(files["data/responsive-pairs.json"]);
    expect(Array.isArray(pairsDoc.pairs)).toBe(true);
    const home = pairsDoc.pairs.find((entry: { page: string }) => entry.page === "/");
    expect(home).toBeDefined();
    expect(JSON.stringify(home)).toContain("screenshots/desktop/home");
    expect(JSON.stringify(home)).toContain("screenshots/mobile/home");
  });
});

describe("cf34 ordered rebuild", () => {
  it("orders REBUILD.md tokens→shell→sections with acceptance boxes", () => {
    // REAL SnapshotSection shape (worker/src/browser/snapshot-script.ts):
    // { role: string, heading: string, textExcerpt: string, sectionStyles?: {...} }.
    const homepageOnlyAnalysis = {
      schemaVersion: "0.2.0",
      request: { url: "https://example.com", hostname: "example.com", maxPages: 1 },
      pages: [
        {
          path: "/",
          url: "https://example.com/",
          title: "Home",
          viewport: { width: 1440, height: 900 },
          tokens: {},
          typography: {},
          semanticStyles: [],
          motion: { transitions: [], animations: [], keyframes: [], animatedSelectors: [] },
          observedInteractions: [],
          nav: {
            header: [{ text: "Home", href: "https://example.com/" }],
            primary: [{ text: "Home", href: "https://example.com/" }],
            footer: [{ text: "Contact", href: "https://example.com/contact" }],
          },
          content: {
            blocks: [
              { order: 0, kind: "heading", tag: "h1", headingLevel: 1, sectionIndex: 0, text: "Welcome", truncated: false },
              { order: 1, kind: "paragraph", tag: "p", headingLevel: null, sectionIndex: 0, text: "Hello", truncated: false },
            ],
            sections: [
              {
                role: "hero",
                heading: "Welcome",
                textExcerpt: "Hello",
                sectionStyles: { backgroundColor: "#ffffff", color: "#111111", fontSize: "32px", padding: "24px", borderRadius: "8px" },
              },
              { role: "nav", heading: "Links", textExcerpt: "Home About" },
            ],
            components: [{ kind: "card-like", signature: "card-like|article", count: 3, examples: ["A", "B"] }],
          },
          sectionLayouts: [],
        },
      ],
      selection: { candidates: [] },
      pagesDiscovered: 1,
      pagesSelected: 1,
      pagesAnalyzed: 1,
      screenshotsCaptured: 0,
      screenshotBytesTotal: 0,
      browserSecondsUsed: 0,
      issues: [],
      warnings: [],
      limitations: [],
      integrityPassed: true,
      assets: [],
      assetCount: 0,
    };
    const { files } = buildDocumentationFiles(homepageOnlyAnalysis, {});
    const rebuild = files["REBUILD.md"];
    expect(rebuild.indexOf("Tokens")).toBeLessThan(rebuild.indexOf("Section 1"));
    expect(rebuild).toContain("- [ ]");
    expect(files["data/components.json"]).toBeDefined();
  });
});

describe("cf35-2 layout-carrying pack", () => {
  it("carries sectionLayouts/geometry/layoutSamples into pages.json, y-orders layout.json, renders columns/components/type", () => {
    // REAL cline.bot shape: two-column hero (729px text + 530px visual).
    const analysis = {
      schemaVersion: "0.2.0",
      request: { url: "https://example.com", hostname: "example.com", maxPages: 1 },
      pages: [
        {
          path: "/",
          url: "https://example.com/",
          title: "Home",
          viewport: { width: 1440, height: 900 },
          tokens: {},
          typography: {},
          semanticStyles: [
            { role: "heading-1", fontFamily: "Inter", fontSize: "48px", fontWeight: "700", lineHeight: "1.1", letterSpacing: "-0.02em", color: "#111", backgroundColor: "rgba(0,0,0,0)", width: "729px", display: "block", gridTemplateColumns: "none", gap: "0" },
          ],
          geometry: { containerWidths: [1440, 1280, 1024, 768, 640, 390], sampledElements: 6 },
          layoutSamples: Array.from({ length: 10 }, (_, i) => ({ role: "main", width: 1200 - i, height: 800, display: "grid", columns: "1fr 1fr", gap: "24px", visible: true })),
          motion: { transitions: [], animations: [], keyframes: [], animatedSelectors: [] },
          observedInteractions: [],
          content: {
            blocks: [{ order: 0, kind: "heading", tag: "h1", headingLevel: 1, sectionIndex: 0, text: "The Open Coding Agent", truncated: false }],
            sections: [
              { role: "section", heading: "The Open Coding Agent", textExcerpt: "Hero copy" },
              { role: "section", heading: "Logos", textExcerpt: "Logo wall" },
            ],
          },
          // Deliberately out of y-order: layout.json must sort by y.
          sectionLayouts: [
            { heading: "The Open Coding Agent", y: 0, height: 953, columns: "729.469px 530.516px", background: "rgba(0,0,0,0)", textAlign: "left", components: [{ kind: "canvas", w: 383, h: 361 }, { kind: "table", w: 451, h: 425 }] },
            { heading: "Logos", y: 953, height: 400, columns: "none", background: "rgb(255, 255, 255)", textAlign: "center", components: [] },
          ],
        },
      ],
      selection: { candidates: [] },
      pagesDiscovered: 1,
      pagesSelected: 1,
      pagesAnalyzed: 1,
      screenshotsCaptured: 0,
      screenshotBytesTotal: 0,
      browserSecondsUsed: 0,
      issues: [],
      warnings: [],
      limitations: [],
      integrityPassed: true,
      assets: [],
      assetCount: 0,
    };
    const { files } = buildDocumentationFiles(analysis, {});
    const pageJson = JSON.parse(files["data/pages.json"]);
    expect(pageJson[0].sectionLayouts).toHaveLength(2);
    expect(JSON.stringify(pageJson[0].sectionLayouts)).toContain("729.469px");
    expect(pageJson[0].sectionLayouts[0].components[0]).toMatchObject({ kind: "canvas", w: 383, h: 361 });
    expect(pageJson[0].geometry.containerWidths).toHaveLength(5);
    expect(pageJson[0].layoutSamples).toHaveLength(8);
    expect(pageJson[0].semanticStyles[0].role).toBe("heading-1");
    expect(files["data/layout.json"]).toBeDefined();
    const layout = JSON.parse(files["data/layout.json"]);
    expect(layout.pages[0].sections.map((s: { y: number }) => s.y)).toEqual([0, 953]);
    const rebuild = files["REBUILD.md"];
    expect(rebuild).toContain("729");
    expect(rebuild).toContain("canvas 383x361");
    expect(rebuild).toContain("Inter");
    expect(rebuild).toContain("- [ ]");
  });

  it("renders an honest fallback when no section geometry was observed", () => {
    const analysis = {
      schemaVersion: "0.2.0",
      request: { url: "https://example.com", hostname: "example.com", maxPages: 1 },
      pages: [
        {
          path: "/",
          url: "https://example.com/",
          title: "Home",
          viewport: { width: 1440, height: 900 },
          tokens: {},
          typography: {},
          semanticStyles: [],
          motion: { transitions: [], animations: [], keyframes: [], animatedSelectors: [] },
          observedInteractions: [],
          content: {
            blocks: [],
            sections: [{ role: "section", heading: "Bare", textExcerpt: "No geometry" }],
          },
          sectionLayouts: [],
        },
      ],
      selection: { candidates: [] },
      pagesDiscovered: 1,
      pagesSelected: 1,
      pagesAnalyzed: 1,
      screenshotsCaptured: 0,
      screenshotBytesTotal: 0,
      browserSecondsUsed: 0,
      issues: [],
      warnings: [],
      limitations: [],
      integrityPassed: true,
      assets: [],
      assetCount: 0,
    };
    const { files } = buildDocumentationFiles(analysis, {});
    expect(files["REBUILD.md"]).toContain("layout not observed");
    expect(files["REBUILD.md"]).toContain("- [ ]");
  });
});
