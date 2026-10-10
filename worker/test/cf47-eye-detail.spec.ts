import { describe, expect, it } from "vitest";
import { buildDocumentationFiles, validateDocumentationPackage } from "../../web/package-docs.mjs";
import { stripPromptabilityForLite } from "../src/pipeline/analysis";
import { diffRotatingText, labelSnapshotPlaceholders } from "../src/browser/snapshot-script";

// CF47: eye-comparison detail capture (softr.io lessons) — rendered heading
// weight, CTA borders, nav chrome (brand mark/dropdowns/actions), scroll
// strips, prose-link idiom, placeholder rotation, capturedAt. Local-full only.

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
    headings: [{ level: 1, text: "Hero Title Here", truncated: false, breaks: [3], fontFamily: "Satoshi Variable", fontWeight: "800" }],
    linkCount: 1,
    navLinkCount: 1,
    pageCanvasColor: "rgb(255, 255, 255)",
    nav: { header: [{ text: "Product" }], primary: [], footer: [] },
    navChrome: {
      brandMark: "svg",
      dropdowns: ["Product", "Solutions"],
      actions: [
        { label: "Sign in", bg: "rgba(0, 0, 0, 0)", border: "none" },
        { label: "Start for free", bg: "rgb(3, 7, 18)", border: "none" },
      ],
    },
    scrollStrips: [{ label: "templates", visibleW: 800, scrollW: 950 }],
    proseLink: { underline: true, color: "rgb(3, 7, 18)" },
    rotatingPlaceholders: [{ label: "input[0]", before: "Build me a…", after: "Build me a portal…" }],
    responsiveComparison: { status: "captured", desktopViewport: { width: 1440, height: 900 }, mobileViewport: null, sectionHeadingsAdded: [], sectionHeadingsMissing: [], countDeltas: null, layoutChanges: [], note: "n" },
    viewport: { width: 1440, height: 900 },
    layoutSamples: [],
    semanticStyles: [
      { role: "body-copy", fontFamily: "Inter, sans-serif", fontSize: "18px", fontWeight: "400", lineHeight: "27px", letterSpacing: "normal", color: "rgb(55, 65, 81)", backgroundColor: "rgb(255, 255, 255)" },
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
    ctaFills: [{ label: "Book a demo", bg: "rgb(238, 240, 245)", radius: "8px", border: "none", padding: "8px 16px", fontSize: "14px", fontWeight: "500", rectX: 0, rectY: 0, w: 100, h: 36 }],
  };
}

function fullAnalysis(capturedAt?: string) {
  return {
    schemaVersion: "0.2.0",
    backend: "local",
    ...(capturedAt ? { capturedAt } : {}),
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
    assets: [{ source: "downloaded", kind: "font", fontFamily: "Satoshi Variable", fontWeight: "300 900", localPath: "assets/fonts/satoshi-variable-300-900.ttf", url: "https://example.com/satoshi.ttf", content: new Uint8Array([9]) }],
    assetCount: 1,
  };
}

function shots() {
  return {
    "screenshots/desktop/home.webp": new Uint8Array([1]),
    "screenshots/sections/home-1.webp": new Uint8Array([2]),
  };
}

describe("CF47 eye detail", () => {
  it("emits weight, border, chrome, strips, prose, rotation directives on full", () => {
    const { files } = buildDocumentationFiles(fullAnalysis("2026-10-11T00:00:00.000Z"), shots());
    expect(validateDocumentationPackage(files, shots())).toEqual([]);
    const rebuild = String(files["REBUILD.md"]);
    expect(rebuild).toContain("weight 800");
    expect(rebuild).toContain("border none (borderless");
    expect(rebuild).toContain("brand mark is inline <svg>");
    expect(rebuild).toContain("Product");
    expect(rebuild).toContain("Sign in");
    expect(rebuild).toContain("Scroll strips");
    expect(rebuild).toContain("overflow-x:auto");
    expect(rebuild).toContain("Prose links");
    expect(rebuild).toContain("underlined");
    expect(rebuild).toContain("Placeholder rotation");
    expect(rebuild).toContain("Build me a portal");
    expect(String(files["README.md"])).toContain("2026-10-11");
    expect(String(files["data/report.json"])).toContain("capturedAt");
  });

  it("stays quiet without CF47 fields (no empty sections)", () => {
    const analysis = fullAnalysis();
    const page = analysis.pages[0] as Record<string, unknown>;
    delete page.navChrome;
    delete page.scrollStrips;
    delete page.proseLink;
    delete page.rotatingPlaceholders;
    page.headings = [{ level: 1, text: "Hero Title Here", truncated: false, breaks: [3] }];
    page.ctaFills = [];
    const { files } = buildDocumentationFiles(analysis, shots());
    expect(validateDocumentationPackage(files, shots())).toEqual([]);
    const rebuild = String(files["REBUILD.md"]);
    expect(rebuild).not.toContain("Scroll strips");
    expect(rebuild).not.toContain("Prose links");
    expect(rebuild).not.toContain("Placeholder rotation");
    expect(rebuild).not.toContain("Header chrome");
    expect(String(files["README.md"])).not.toContain("Captured:");
  });

  it("stripPromptabilityForLite removes CF47 fields and heading weight", () => {
    const page = {
      headings: [{ level: 1, text: "T", fontFamily: "Satoshi Variable", fontWeight: "800" }],
      sectionLayouts: [],
      navChrome: { brandMark: "svg", dropdowns: [], actions: [] },
      scrollStrips: [{ label: "s", visibleW: 1, scrollW: 2 }],
      proseLink: { underline: true, color: "rgb(0, 0, 0)" },
      rotatingPlaceholders: [{ label: "input[0]", before: "a", after: "b" }],
      title: "Keep me",
    } as unknown as Parameters<typeof stripPromptabilityForLite>[0];
    const lite = stripPromptabilityForLite(page);
    expect(lite.navChrome).toBeUndefined();
    expect(lite.scrollStrips).toBeUndefined();
    expect(lite.proseLink).toBeUndefined();
    expect(lite.rotatingPlaceholders).toBeUndefined();
    expect((lite.headings[0] as Record<string, unknown>).fontWeight).toBeUndefined();
    expect((lite.headings[0] as Record<string, unknown>).fontFamily).toBeUndefined();
    expect(JSON.stringify(lite).indexOf("scrollW")).toBe(-1);
  });

  it("detects rotating placeholders via label + diff helpers", () => {
    const before = labelSnapshotPlaceholders([
      { kind: "input", placeholder: "Build me a…" },
      { kind: "button", placeholder: null },
    ] as unknown as Parameters<typeof labelSnapshotPlaceholders>[0]);
    expect(before).toEqual([{ label: "input[0]", text: "Build me a…" }]);
    const rotated = diffRotatingText(before, [{ label: "input[0]", text: "Build me a portal…" }]);
    expect(rotated).toEqual([{ label: "input[0]", before: "Build me a…", after: "Build me a portal…" }]);
    expect(diffRotatingText(before, before)).toEqual([]);
  });
});
