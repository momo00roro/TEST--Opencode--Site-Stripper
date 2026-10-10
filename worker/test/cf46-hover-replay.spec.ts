import { describe, expect, it } from "vitest";
import { buildDocumentationFiles, validateDocumentationPackage } from "../../web/package-docs.mjs";
import { stripPromptabilityForLite } from "../src/pipeline/analysis";

// CF46: observed hover replay (trusted pointer; catches JS-driven states
// static CSS parsing misses) + h3/h4 type roles. Local-full only.

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
    headings: [{ level: 1, text: "Hero Title Here", truncated: false, breaks: [3] }],
    linkCount: 1,
    navLinkCount: 1,
    pageCanvasColor: "rgb(248, 250, 251)",
    nav: { header: [], primary: [], footer: [] },
    responsiveComparison: { status: "captured", desktopViewport: { width: 1440, height: 900 }, mobileViewport: null, sectionHeadingsAdded: [], sectionHeadingsMissing: [], countDeltas: null, layoutChanges: [], note: "n" },
    viewport: { width: 1440, height: 900 },
    layoutSamples: [],
    semanticStyles: [
      { role: "body-copy", fontFamily: "Inter, sans-serif", fontSize: "18px", fontWeight: "400", lineHeight: "27.9px", letterSpacing: "normal", color: "rgba(21, 21, 22, 0.78)", backgroundColor: "rgb(255, 255, 255)" },
      { role: "heading-3", fontFamily: "Space Grotesk, sans-serif", fontSize: "36px", fontWeight: "600", lineHeight: "39px", letterSpacing: "normal", color: "rgb(21, 21, 22)", backgroundColor: "rgba(0, 0, 0, 0)" },
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
    tokens: { colors: [], fontSizes: [], spacing: [], radii: [], borders: [], shadows: [], gradients: [], icons: [], customProperties: [] },
    typography: { fontFaces: [], fontFamilies: [], lineHeights: [], letterSpacings: [] },
    breakpoints: { mediaQueries: [] },
    motion: { transitions: [], animations: [], keyframes: [] },
    geometry: { containerWidths: [], sampledElements: 0 },
    limitations: [],
    observedInteractions: [],
    hoverStates: [],
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
      tabSets: [],
    },
    assets: [],
    hoverEffects: [
      { label: "Build an app", selector: "main > div:nth-of-type(1)", changes: [{ property: "backgroundColor", before: "rgb(249, 247, 244)", after: "rgb(255, 106, 0)" }, { property: "linkColor", before: "rgb(30, 30, 36)", after: "rgb(255, 255, 255)" }] },
      { label: "Empty", selector: "x", changes: [] },
    ],
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
    assets: [],
    assetCount: 0,
  };
}

function shots() {
  return {
    "screenshots/desktop/home.webp": new Uint8Array([1]),
    "screenshots/sections/home-1.webp": new Uint8Array([2]),
  };
}

describe("CF46 hover replay", () => {
  it("emits observed hover effects in REBUILD on full", () => {
    const { files } = buildDocumentationFiles(fullAnalysis(), shots());
    expect(validateDocumentationPackage(files, shots())).toEqual([]);
    const rebuild = String(files["REBUILD.md"]);
    expect(rebuild).toContain("Observed hover effects");
    expect(rebuild).toContain("Build an app");
    expect(rebuild).toContain("rgb(255, 106, 0)");
    expect(rebuild).toContain("rgb(249, 247, 244)");
    expect(rebuild).toContain("nested links/buttons color");
    expect(rebuild).not.toContain("Empty");
  });

  it("emits heading-3 scale and hover replay in design-system.md", () => {
    const { files } = buildDocumentationFiles(fullAnalysis(), shots());
    const doc = String(files["design-system.md"]);
    expect(doc).toContain("heading-3");
    expect(doc).toContain("36px");
    expect(doc).toContain("Observed hover replay");
  });

  it("stays quiet without hover effects (no empty section)", () => {
    const analysis = fullAnalysis();
    (analysis.pages[0] as Record<string, unknown>).hoverEffects = [];
    const { files } = buildDocumentationFiles(analysis, shots());
    expect(validateDocumentationPackage(files, shots())).toEqual([]);
    expect(String(files["REBUILD.md"])).not.toContain("Observed hover effects");
  });

  it("stripPromptabilityForLite removes hoverEffects", () => {
    const page = {
      headings: [],
      sectionLayouts: [],
      hoverEffects: [{ label: "B", selector: "s", changes: [{ property: "backgroundColor", before: "a", after: "b" }] }],
      title: "Keep me",
    } as unknown as Parameters<typeof stripPromptabilityForLite>[0];
    const lite = stripPromptabilityForLite(page);
    expect(lite.hoverEffects).toBeUndefined();
    expect(JSON.stringify(lite).indexOf("backgroundColor")).toBe(-1);
  });
});
