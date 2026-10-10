import { describe, expect, it } from "vitest";
import { buildDocumentationFiles, validateDocumentationPackage } from "../../web/package-docs.mjs";

// CF44: design-system.md encodes the site's UI system + art direction so an
// agent can build NEW sections/pages in-style. Renders from observed data;
// degrades honestly when evidence is absent (lite shape).

function fullPage() {
  return {
    url: "https://example.com/",
    path: "/",
    title: "Example",
    pageType: "homepage",
    isHomepage: true,
    selected: true,
    priority: 1,
    selectedBecause: "requested",
    headings: [{ level: 1, text: "Hero Title Here", truncated: false, breaks: [3], fontFamily: "Space Grotesk", y: 100, height: 80 }],
    linkCount: 1,
    navLinkCount: 1,
    pageCanvasColor: "rgb(248, 250, 251)",
    nav: { header: [], primary: [{ text: "Docs" }], footer: [{ text: "Privacy" }] },
    responsiveComparison: { status: "captured", desktopViewport: { width: 1440, height: 900 }, mobileViewport: { width: 390, height: 800 }, sectionHeadingsAdded: [], sectionHeadingsMissing: [], countDeltas: null, layoutChanges: [{ role: "grid", desktop: { width: 1200, height: 400, display: "grid", columns: "6" }, mobile: { width: 350, height: 800, display: "grid", columns: "3" }, changed: true }], note: "reflow" },
    viewport: { width: 1440, height: 900 },
    layoutSamples: [],
    semanticStyles: [
      { role: "body-copy", fontFamily: "Inter, sans-serif", fontSize: "18px", fontWeight: "400", lineHeight: "27.9px", letterSpacing: "normal", color: "rgba(21, 21, 22, 0.78)", backgroundColor: "rgb(255, 255, 255)" },
      { role: "heading-1", fontFamily: "Space Grotesk, sans-serif", fontSize: "72px", fontWeight: "500", lineHeight: "72px", letterSpacing: "-1.44px", color: "rgb(159, 88, 250)" },
      { role: "button", fontFamily: "Inter, sans-serif", fontSize: "16px", fontWeight: "500", lineHeight: "22px", letterSpacing: "normal", color: "rgb(255, 255, 255)", backgroundColor: "rgb(0, 0, 0)" },
    ],
    coverage: {},
    sectionCount: 1,
    sections: [{ role: "section", heading: "Hero Title Here", textExcerpt: "Hero copy." }],
    formCount: 0,
    imageCount: 0,
    domElementCount: 10,
    extractionBytes: 10,
    pageHeightPx: 900,
    screenshot: { kind: "webp", bytes: 24, width: 1440, height: 900, dataUrl: "data:image/webp;base64,AA==" },
    mobileScreenshot: null,
    sectionShots: [{ kind: "webp", bytes: 5, width: 1440, height: 300, dataUrl: "data:image/webp;base64,Ag==" }],
    videoShots: [],
    videoThumbnails: [],
    warnings: [],
    tokens: {
      colors: [{ value: "rgb(159, 88, 250)", count: 9, confidence: "observed", pages: ["/"] }],
      fontSizes: [{ value: "72px", count: 4, confidence: "observed", pages: ["/"] }],
      spacing: [{ value: "120px", count: 6, confidence: "observed", pages: ["/"] }],
      radii: [{ value: "8px", count: 7, confidence: "observed", pages: ["/"] }],
      borders: [],
      shadows: [],
      gradients: [],
      icons: [],
      customProperties: [],
    },
    typography: { fontFaces: [], fontFamilies: [{ value: "Inter", count: 40, confidence: "inferred" }], lineHeights: [], letterSpacings: [] },
    breakpoints: { mediaQueries: [{ query: "(max-width: 1000px)", changedProperties: ["display"] }] },
    motion: { transitions: [{ property: "color", duration: "0.18s", easing: "ease", delay: "0s" }], animations: [], keyframes: [] },
    geometry: { containerWidths: [1240, 1100], sampledElements: 4 },
    limitations: [],
    observedInteractions: [],
    hoverStates: [{ trigger: "hover", selector: ".dl", changedProperties: ["border-color"] }],
    embeds: [],
    videos: [],
    sectionLayouts: [{ heading: "Hero Title Here", y: 0, height: 900, textAlign: "start", columns: "none", background: "rgb(255, 255, 255)", components: [] }],
    social: {},
    formActions: [],
    content: {
      blocks: [{ order: 0, kind: "heading", tag: "h1", headingLevel: 1, sectionIndex: 0, text: "Hero Title Here", truncated: false }],
      hiddenBlocks: [],
      controls: [],
      components: [],
      coverage: {},
      sections: [{ role: "section", heading: "Hero Title Here", textExcerpt: "Hero copy." }],
      tone: { avgSentenceWords: 5, questionCount: 0, ctaCount: 0, voice: "plain" },
      tabSets: [{ tabs: [{ label: "Desktop", selected: true }, { label: "CLI", selected: false }] }],
    },
    assets: [{ kind: "font", source: "downloaded", localPath: "assets/fonts/space-grotesk.woff2", fontFamily: "Space Grotesk", url: "https://example.com/sg.woff2" }],
    imageTreatments: [{ url: "https://example.com/logo.svg", filter: "grayscale(1)", tileBg: "rgba(240, 240, 240, 0.3)", tileRadius: "12px" }],
    ctaFills: [{ label: "Get Started", bg: "rgb(0, 0, 0)", radius: "8px" }],
    iconFlags: [{ label: "Star", w: 16, h: 16, svgCount: 1, color: "rgb(21, 21, 22)" }],
    tabPanels: [{ tabset: 0, tab: "Desktop", selected: true, panelText: "Desktop panel copy." }],
  };
}

function fullAnalysis() {
  return {
    schemaVersion: "0.2.0",
    backend: "local",
    request: { url: "https://example.com/", hostname: "example.com", maxPages: 1, includeMobile: false },
    pages: [fullPage()],
    selection: { candidates: [] },
    pagesDiscovered: 1,
    pagesSelected: 1,
    pagesAnalyzed: 1,
    screenshotsCaptured: 2,
    screenshotBytesTotal: 29,
    browserSecondsUsed: 1,
    issues: [],
    warnings: [],
    limitations: [],
    integrityPassed: true,
    assets: [{ kind: "font", source: "downloaded", localPath: "assets/fonts/space-grotesk.woff2", fontFamily: "Space Grotesk", url: "https://example.com/sg.woff2", content: new Uint8Array([9]) }],
    assetCount: 1,
  };
}

function shots() {
  return {
    "screenshots/desktop/home.webp": new Uint8Array([1]),
    "screenshots/sections/home-1.webp": new Uint8Array([2]),
  };
}

describe("CF44 design system", () => {
  it("emits design-system.md with observed system rules on full", () => {
    const { files } = buildDocumentationFiles(fullAnalysis(), shots());
    expect(validateDocumentationPackage(files, shots())).toEqual([]);
    const doc = String(files["design-system.md"]);
    expect(doc).toContain("## 1. Palette");
    expect(doc).toContain("## 2. Type");
    expect(doc).toContain("## 3. Rhythm");
    expect(doc).toContain("## 4. Component recipes");
    expect(doc).toContain("## 5. Motion");
    expect(doc).toContain("## 6. Grid + responsive");
    expect(doc).toContain("## 7. Imagery + art direction");
    expect(doc).toContain("## 8. Voice + expansion recipes");
    expect(doc).toContain("Space Grotesk");
    expect(doc).toContain("grayscale(1)");
    expect(doc).toContain("Get Started");
    expect(doc).toContain("New SECTION in 5 steps");
    expect(doc).toContain("House rule");
    expect(doc).toContain("font families");
  });

  it("degrades honestly on lite-shaped pages (no promptability data)", () => {
    const analysis = fullAnalysis();
    const page = analysis.pages[0] as Record<string, unknown>;
    delete page.imageTreatments;
    delete page.ctaFills;
    delete page.iconFlags;
    delete page.tabPanels;
    (page.content as Record<string, unknown>).tabSets = [];
    const { files } = buildDocumentationFiles(analysis, shots());
    expect(validateDocumentationPackage(files, shots())).toEqual([]);
    const doc = String(files["design-system.md"]);
    expect(doc).toContain("## 4. Component recipes");
    expect(doc).not.toContain("grayscale(1)");
    expect(doc).toContain("House rule");
  });

  it("renders an empty-system fallback without crashing", () => {
    const analysis = fullAnalysis();
    const page = analysis.pages[0] as Record<string, unknown>;
    page.semanticStyles = [];
    page.headings = [];
    page.tokens = { colors: [], fontSizes: [], spacing: [], radii: [], borders: [], shadows: [], gradients: [], icons: [], customProperties: [] };
    const { files } = buildDocumentationFiles(analysis, shots());
    expect(validateDocumentationPackage(files, shots())).toEqual([]);
    expect(String(files["design-system.md"])).toContain("House rule");
  });
});
