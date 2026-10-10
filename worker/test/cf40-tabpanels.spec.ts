import { describe, expect, it } from "vitest";
import { buildDocumentationFiles, validateDocumentationPackage } from "../../web/package-docs.mjs";
import { stripPromptabilityForLite } from "../src/pipeline/analysis";
import { maxLayoutDrift } from "../src/browser/capture";

// CF40: per-tab panel copy lets rebuilds CSS-switch tabs with REAL copy.
// Local-full only; hosted-lite omits tabPanels byte-identically.

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
    nav: { header: [], primary: [], footer: [] },
    responsiveComparison: { status: "captured", desktopViewport: { width: 1440, height: 900 }, mobileViewport: null, sectionHeadingsAdded: [], sectionHeadingsMissing: [], countDeltas: null, layoutChanges: [], note: "n" },
    viewport: { width: 1440, height: 900 },
    layoutSamples: [],
    semanticStyles: [],
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
      tabSets: [{ tabs: [{ label: "Desktop", selected: true }, { label: "CLI", selected: false }] }],
    },
    assets: [],
    tabPanels: [
      { tabset: 0, tab: "Desktop", selected: true, panelText: "Desktop panel copy here." },
      { tabset: 0, tab: "CLI", selected: false, panelText: "CLI panel copy here." },
      { tabset: 0, tab: "Ghost", selected: false, panelText: "   " },
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

describe("CF40 tab panels", () => {
  it("emits per-tab panel copy with CSS-switch directive on full", () => {
    const shots = {
      "screenshots/desktop/home.webp": new Uint8Array([1]),
      "screenshots/sections/home-1.webp": new Uint8Array([2]),
    };
    const { files } = buildDocumentationFiles(fullAnalysis(), shots);
    expect(validateDocumentationPackage(files, shots)).toEqual([]);
    const rebuild = String(files["REBUILD.md"]);
    expect(rebuild).toContain("Tab panels");
    expect(rebuild).toContain("Desktop panel copy here.");
    expect(rebuild).toContain("CLI panel copy here.");
    expect(rebuild).toContain("default selected");
    expect(rebuild).toContain(":checked");
    expect(rebuild).not.toContain("Ghost");
    expect(rebuild).toContain("Headline positions");
    expect(rebuild).toContain("y=100px");
  });

  it("omits tab panels when absent (lite shape)", () => {
    const analysis = fullAnalysis();
    delete (analysis.pages[0] as Record<string, unknown>).tabPanels;
    const shots = {
      "screenshots/desktop/home.webp": new Uint8Array([1]),
      "screenshots/sections/home-1.webp": new Uint8Array([2]),
    };
    const { files } = buildDocumentationFiles(analysis, shots);
    expect(validateDocumentationPackage(files, shots)).toEqual([]);
    expect(String(files["REBUILD.md"])).not.toContain("Tab panels");
  });

  it("maxLayoutDrift flags large shifts and stays silent on noise", () => {
    const a = [
      { heading: "Hero", y: 0, height: 900 },
      { heading: "Logos", y: 900, height: 400 },
      { heading: "Video", y: 1300, height: 1100 },
    ];
    expect(maxLayoutDrift(a, a)).toBe(0);
    expect(maxLayoutDrift(a, a.map((s) => ({ ...s, y: s.y + 20 })))).toBe(20);
    expect(maxLayoutDrift(a, [{ heading: "Hero", y: 0, height: 900 }, { heading: "Logos", y: 900, height: 400 }, { heading: "Video", y: 2700, height: 1100 }])).toBe(1400);
    expect(maxLayoutDrift(a, [])).toBe(0);
    expect(maxLayoutDrift([], [])).toBe(0);
  });

  it("stripPromptabilityForLite removes tabPanels and preserves the rest", () => {
    const page = {
      headings: [{ level: 1, text: "T", truncated: false, fontFamily: "F", y: 10, height: 20 }],
      sectionLayouts: [],
      tabPanels: [{ tabset: 0, tab: "A", selected: true, panelText: "x" }],
      layoutDriftPx: 140,
      title: "Keep me",
    } as unknown as Parameters<typeof stripPromptabilityForLite>[0];
    const lite = stripPromptabilityForLite(page);
    expect(lite.tabPanels).toBeUndefined();
    expect(lite.layoutDriftPx).toBeUndefined();
    expect((lite as unknown as Record<string, unknown>).title).toBe("Keep me");
    expect(JSON.stringify(lite).indexOf("panelText")).toBe(-1);
    expect(lite.headings[0]).toEqual({ level: 1, text: "T", truncated: false });
  });
});

describe("CF43 drift surfacing", () => {
  function driftShots() {
    return {
      "screenshots/desktop/home.webp": new Uint8Array([1]),
      "screenshots/sections/home-1.webp": new Uint8Array([2]),
    };
  }
  it("emits drift + capture warnings in Known gaps when capture shifted", () => {
    const analysis = fullAnalysis();
    (analysis.pages[0] as Record<string, unknown>).warnings = [
      "Layout shifted during capture (up to 140px); section screenshots may misalign with layout y/h — build from REBUILD copy/layout and use shots as loose reference.",
    ];
    (analysis.pages[0] as Record<string, unknown>).layoutDriftPx = 140;
    const { files } = buildDocumentationFiles(analysis, driftShots());
    expect(validateDocumentationPackage(files, driftShots())).toEqual([]);
    const rebuild = String(files["REBUILD.md"]);
    expect(rebuild).toContain("Layout drift 140px");
    expect(rebuild).toContain("Capture warning");
    expect(rebuild).toContain("build from copy/layout");
  });

  it("stays quiet in Known gaps when capture was clean", () => {
    const analysis = fullAnalysis();
    (analysis.pages[0] as Record<string, unknown>).layoutDriftPx = 12;
    const { files } = buildDocumentationFiles(analysis, driftShots());
    expect(validateDocumentationPackage(files, driftShots())).toEqual([]);
    const rebuild = String(files["REBUILD.md"]);
    expect(rebuild).not.toContain("Capture warning");
    expect(rebuild).not.toContain("Layout drift");
  });
});
