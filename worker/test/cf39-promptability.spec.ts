import { describe, expect, it } from "vitest";
import { buildDocumentationFiles, validateDocumentationPackage } from "../../web/package-docs.mjs";
import { stripPromptabilityForLite } from "../src/pipeline/analysis";

// CF39 promptability: packs carry the directives a fresh agent needs
// (display face, image treatment, CTA fills, inline icons, component x/y)
// on local-full, and hosted-lite responses stay byte-identical without them.

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
    headings: [{ level: 1, text: "Hero Title Here", truncated: false, breaks: [3], fontFamily: "Space Grotesk" }],
    linkCount: 1,
    navLinkCount: 1,
    pageCanvasColor: "rgb(248, 250, 251)",
    nav: { header: [], primary: [], footer: [] },
    responsiveComparison: { status: "captured", desktopViewport: { width: 1440, height: 900 }, mobileViewport: null, sectionHeadingsAdded: [], sectionHeadingsMissing: [], countDeltas: null, layoutChanges: [], note: "n" },
    viewport: { width: 1440, height: 900 },
    layoutSamples: [],
    semanticStyles: [
      { role: "heading-1", fontFamily: '"DM Sans", system-ui, sans-serif', fontSize: "72px", fontWeight: "400", lineHeight: "72px", letterSpacing: "-1.44px", color: "rgb(21, 21, 22)", backgroundColor: "rgba(0, 0, 0, 0)", width: "729px", display: "block", gridTemplateColumns: "none", gap: "0px", position: "static" },
    ],
    coverage: {},
    sectionCount: 1,
    sections: [{ role: "section", heading: "Hero Title Here", textExcerpt: "Hero copy." }],
    formCount: 0,
    imageCount: 1,
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
    typography: { fontFaces: [{ family: "Space Grotesk", weight: "300 700", src: "local" }], fontFamilies: [], lineHeights: [], letterSpacings: [] },
    breakpoints: { mediaQueries: [] },
    motion: { transitions: [], animations: [], keyframes: [] },
    geometry: { containerWidths: [], sampledElements: 0 },
    limitations: [],
    observedInteractions: [],
    hoverStates: [],
    embeds: [],
    videos: [],
    sectionLayouts: [{ heading: "Hero Title Here", y: 0, height: 900, textAlign: "start", columns: "none", background: "rgb(255, 255, 255)", components: [{ kind: "canvas", w: 100, h: 80, x: 50, y: 60 }] }],
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
    },
    assets: [],
    imageTreatments: [{ url: "https://example.com/logo.svg", filter: "grayscale(1)", opacity: null, tileBg: "rgb(250, 250, 250)", tileRadius: "12px", rectX: 10, rectY: 20 }],
    ctaFills: [{ label: "Get Started", bg: "rgb(248, 247, 254)", radius: "8px", rectX: 30, rectY: 40, w: 120, h: 40 }],
    iconFlags: [{ label: "Desktop", w: 24, h: 24, color: "rgb(159, 88, 250)", svgCount: 1 }],
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
    assets: [
      { url: "https://example.com/logo.svg", kind: "logo", alt: "Logo", width: 100, height: 20, usedOn: "https://example.com/", source: "downloaded", localPath: "assets/1-logo.svg", content: "<svg></svg>" },
      { url: "https://example.com/font.woff2", kind: "font", alt: "Space Grotesk", width: null, height: null, usedOn: "https://example.com/", source: "downloaded", localPath: "assets/fonts/sg.woff2", fontFamily: "Space Grotesk", fontWeight: "300 700", dataUrl: "data:font/woff2;base64,AA==" },
      { url: "https://example.com/frame", kind: "hero", alt: "Canvas", width: 100, height: 80, usedOn: "https://example.com/", source: "downloaded", localPath: "assets/canvas-1.png", rectY: 10, content: new Uint8Array([9]) },
    ],
    assetCount: 3,
  };
}

describe("CF39 promptability directives", () => {
  it("emits display-face, treatment, CTA, icon, and x/y directives on full", () => {
    const shots = {
      "screenshots/desktop/home.webp": new Uint8Array([1]),
      "screenshots/sections/home-1.webp": new Uint8Array([2]),
    };
    const { files } = buildDocumentationFiles(fullAnalysis(), shots);
    expect(validateDocumentationPackage(files, shots)).toEqual([]);
    const rebuild = String(files["REBUILD.md"]);
    expect(rebuild).toContain("Space Grotesk");
    expect(rebuild).toContain("Display face");
    expect(rebuild).toContain("grayscale(1)");
    expect(rebuild).toContain("rgb(250, 250, 250)");
    expect(rebuild).toContain("rgb(248, 247, 254)");
    expect(rebuild).toContain("inline <svg>");
    expect(rebuild).toContain("@50,60");
    expect(rebuild).toContain("x=50px");
    expect(JSON.parse(files["data/layout.json"]).pages[0].sections[0].components[0].x).toBe(50);
  });

  it("omits CF39 directives when promptability fields are absent (lite shape)", () => {
    const analysis = fullAnalysis();
    const page = analysis.pages[0] as Record<string, unknown>;
    delete page.imageTreatments;
    delete page.ctaFills;
    delete page.iconFlags;
    page.headings = [{ level: 1, text: "Hero Title Here", truncated: false, breaks: [3] }];
    page.sectionLayouts = [{ heading: "Hero Title Here", y: 0, height: 900, textAlign: "start", columns: "none", background: "rgb(255, 255, 255)", components: [{ kind: "canvas", w: 100, h: 80 }] }];
    const shots = {
      "screenshots/desktop/home.webp": new Uint8Array([1]),
      "screenshots/sections/home-1.webp": new Uint8Array([2]),
    };
    const { files } = buildDocumentationFiles(analysis, shots);
    expect(validateDocumentationPackage(files, shots)).toEqual([]);
    const rebuild = String(files["REBUILD.md"]);
    expect(rebuild).not.toContain("Display face");
    expect(rebuild).not.toContain("grayscale(1)");
    expect(rebuild).not.toContain("Image treatment");
    expect(rebuild).not.toContain("CTA fills");
    expect(rebuild).not.toContain("Inline icons");
    expect(rebuild).not.toContain("@50,60");
  });

  it("stripPromptabilityForLite removes full-only fields and preserves the rest", () => {
    const page = {
      headings: [{ level: 1, text: "T", truncated: false, breaks: [1], fontFamily: "Space Grotesk" }],
      sectionLayouts: [{ heading: "H", y: 0, height: 10, textAlign: "", columns: "", background: "", components: [{ kind: "img", w: 5, h: 5, x: 1, y: 2 }] }],
      imageTreatments: [{ url: "u" }],
      ctaFills: [{ label: "l" }],
      iconFlags: [{ label: "i" }],
      title: "Keep me",
    } as unknown as Parameters<typeof stripPromptabilityForLite>[0];
    const lite = stripPromptabilityForLite(page);
    expect(lite.imageTreatments).toBeUndefined();
    expect(lite.ctaFills).toBeUndefined();
    expect(lite.iconFlags).toBeUndefined();
    expect((lite.headings[0] as Record<string, unknown>).fontFamily).toBeUndefined();
    expect(lite.headings[0]).toEqual({ level: 1, text: "T", truncated: false, breaks: [1] });
    expect(lite.sectionLayouts[0].components[0]).toEqual({ kind: "img", w: 5, h: 5 });
    expect((lite as unknown as Record<string, unknown>).title).toBe("Keep me");
    expect(JSON.stringify(lite).indexOf("Space Grotesk")).toBe(-1);
  });
});
