import { describe, expect, it } from "vitest";
import { buildDocumentationFiles, validateDocumentationPackage } from "../../web/package-docs.mjs";
import { stripPromptabilityForLite } from "../src/pipeline/analysis";

// CF45: taste directives — CTA box metrics, tile padding, tab dividers,
// hover values, eyebrow roles, heading margins. Local-full only.

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
    headings: [{ level: 1, text: "Hero Title Here", truncated: false, breaks: [3], fontFamily: "Space Grotesk", y: 100, height: 80, marginTop: "95px", marginBottom: "0px" }],
    linkCount: 1,
    navLinkCount: 1,
    pageCanvasColor: "rgb(248, 250, 251)",
    nav: { header: [], primary: [], footer: [] },
    responsiveComparison: { status: "captured", desktopViewport: { width: 1440, height: 900 }, mobileViewport: null, sectionHeadingsAdded: [], sectionHeadingsMissing: [], countDeltas: null, layoutChanges: [], note: "n" },
    viewport: { width: 1440, height: 900 },
    layoutSamples: [],
    semanticStyles: [
      { role: "body-copy", fontFamily: "Inter, sans-serif", fontSize: "18px", fontWeight: "400", lineHeight: "27.9px", letterSpacing: "normal", color: "rgba(21, 21, 22, 0.78)", backgroundColor: "rgb(255, 255, 255)" },
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
    hoverStates: [{ trigger: "hover", selector: ".tile", changedProperties: ["transform", "background-color"], changedValues: ["transform: translateY(-2px)", "background-color: #fff"] }],
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
      tabSets: [{ tabs: [{ label: "A", selected: true }, { label: "B", selected: false }], separators: "1px solid rgb(233, 230, 242)" }],
    },
    assets: [],
    imageTreatments: [{ url: "https://example.com/logo.svg", filter: "grayscale(1)", tileBg: "rgba(240, 240, 240, 0.3)", tileRadius: "12px", tilePadding: "16px 20px" }],
    ctaFills: [{ label: "Get Started", bg: "rgb(0, 0, 0)", radius: "8px", padding: "15px 44px", fontSize: "16px", fontWeight: "500" }],
    iconFlags: [],
    tabPanels: [],
    eyebrows: [{ text: "WHAT WE DO", fontFamily: "Inter", fontSize: "13px", fontWeight: "600", letterSpacing: "2.5px", color: "rgb(159, 88, 250)" }],
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
    assets: [{ kind: "logo", source: "downloaded", localPath: "assets/1-logo.svg", url: "https://example.com/logo.svg", alt: "Logo", content: new Uint8Array([7]) }],
    assetCount: 1,
  };
}

function shots() {
  return {
    "screenshots/desktop/home.webp": new Uint8Array([1]),
    "screenshots/sections/home-1.webp": new Uint8Array([2]),
  };
}

describe("CF45 design taste", () => {
  it("emits taste directives in REBUILD on full", () => {
    const { files } = buildDocumentationFiles(fullAnalysis(), shots());
    expect(validateDocumentationPackage(files, shots())).toEqual([]);
    const rebuild = String(files["REBUILD.md"]);
    expect(rebuild).toContain("eyebrow/kicker");
    expect(rebuild).toContain("WHAT WE DO");
    expect(rebuild).toContain("margin-top");
    expect(rebuild).toContain("95px");
    expect(rebuild).toContain("15px 44px");
    expect(rebuild).toContain("tile padding");
    expect(rebuild).toContain("16px 20px");
    expect(rebuild).toContain("divided by");
    expect(rebuild).toContain("1px solid rgb(233, 230, 242)");
    expect(String(files["motion-and-interactions.md"])).toContain("translateY(-2px)");
  });

  it("emits taste rules in design-system.md on full", () => {
    const { files } = buildDocumentationFiles(fullAnalysis(), shots());
    const doc = String(files["design-system.md"]);
    expect(doc).toContain("Kicker/eyebrow");
    expect(doc).toContain("Title rhythm");
    expect(doc).toContain("typical padding");
    expect(doc).toContain("Tab dividers");
    expect(doc).toContain("Micro-motion example");
  });

  it("stripPromptabilityForLite removes every CF45 field", () => {
    const page = {
      headings: [{ level: 1, text: "T", truncated: false, fontFamily: "F", y: 10, height: 20, marginTop: "95px", marginBottom: "10px" }],
      sectionLayouts: [],
      eyebrows: [{ text: "KICKER", fontFamily: "F", fontSize: "13px", fontWeight: "600", letterSpacing: "2px", color: "red" }],
      content: { tabSets: [{ tabs: [{ label: "A", selected: true }], separators: "1px solid red" }] },
      title: "Keep me",
    } as unknown as Parameters<typeof stripPromptabilityForLite>[0];
    const lite = stripPromptabilityForLite(page);
    expect(lite.eyebrows).toBeUndefined();
    expect(lite.headings[0]).toEqual({ level: 1, text: "T", truncated: false });
    expect((lite.content as unknown as { tabSets: Record<string, unknown>[] }).tabSets[0]).toEqual({ tabs: [{ label: "A", selected: true }] });
    expect((lite as unknown as Record<string, unknown>).title).toBe("Keep me");
    expect(JSON.stringify(lite)).not.toContain("separators");
  });
});
