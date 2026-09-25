import { describe, expect, it } from "vitest";
import { buildDocumentationFiles, validateDocumentationPackage } from "../../web/package-docs.mjs";
import { createStoreZip } from "../src/package/zip-store";

function fixture() {
  const basePage = {
    url: "https://example.com/",
    path: "/",
    title: "Example site",
    pageType: "homepage",
    isHomepage: true,
    selected: true,
    priority: 1,
    selectedBecause: "requested homepage",
    headings: [{ level: 1, text: "A detailed heading", truncated: false }],
    sections: [{ role: "section", heading: "Work", textExcerpt: "Observed work section" }],
    geometry: { containerWidths: [], sampledElements: 2 },
    navLinkCount: 1,
    nav: { header: [{ text: "Work", href: "https://example.com/work" }], primary: [{ text: "Work", href: "https://example.com/work" }], footer: [] },
    viewport: { width: 1440, height: 900 },
    layoutSamples: [{ role: "main", width: 1200, height: 800, display: "grid", columns: "1fr 1fr", gap: "24px", visible: true }],
    responsiveComparison: {
      status: "captured",
      desktopViewport: { width: 1440, height: 900 },
      mobileViewport: { width: 390, height: 900 },
      sectionHeadingsAdded: [], sectionHeadingsMissing: [],
      countDeltas: { headings: 0, sections: 0, forms: 0, images: 0, controls: 0 },
      layoutChanges: [{ role: "main", desktop: { role: "main", width: 1200, height: 800, display: "grid", columns: "1fr 1fr", gap: "24px", visible: true }, mobile: { role: "main", width: 358, height: 900, display: "block", columns: "none", gap: "16px", visible: true }, changed: true }],
      note: "sampled comparison",
    },
    formCount: 1,
    imageCount: 1,
    domElementCount: 12,
    screenshot: { kind: "webp", bytes: 24, width: 1440, height: 900, dataUrl: "data:image/webp;base64,AA==" },
    mobileScreenshot: { kind: "webp", bytes: 12, width: 390, height: 900, dataUrl: "data:image/webp;base64,AQ==" },
    sectionShots: [{ kind: "webp", bytes: 5, width: 1440, height: 300, dataUrl: "data:image/webp;base64,Ag==" }],
    warnings: [],
    limitations: [],
    observedInteractions: [{ kind: "aria-controlled", detail: "1 control; FAQ: expanded=false" }],
    hoverStates: [{ selector: ".card:hover", trigger: "hover", changedProperties: ["transform", "box-shadow"] }],
    embeds: [{ url: "https://www.youtube.com/embed/abc", domain: "www.youtube.com", kind: "youtube", title: "Showreel" }],
    formActions: ["/contact"],
    social: { ogTitle: "Example site", ogDescription: "An example analysis", twitterCard: "summary", generator: "Next.js", themeColor: "#000000" },
    tokens: {
      colors: [{ value: "#ccff00", count: 4, source: "cssom", confidence: "observed" }],
      fontSizes: [{ value: "18px", count: 3, source: "sampling", confidence: "inferred" }],
      spacing: [{ value: "24px", count: 2, source: "sampling", confidence: "inferred" }],
      radii: [], borders: [], shadows: [],
      gradients: [{ value: "linear-gradient(135deg, #000, #fff)", count: 2, source: "cssom-rule", confidence: "observed" }],
      icons: [{ value: "arrow-right", count: 2, source: "svg-symbol", confidence: "observed" }],
      customProperties: [],
    },
    typography: { fontFaces: [{ family: "Example Sans", weight: "400", src: "local" }], fontFamilies: [{ value: "Example Sans, sans-serif", count: 5, source: "computed-style-sampling", confidence: "inferred" }], lineHeights: [], letterSpacings: [] },
    semanticStyles: [{ role: "body-copy", fontFamily: "Example Sans", fontSize: "18px", fontWeight: "400", lineHeight: "1.5", letterSpacing: "normal", color: "#222", backgroundColor: "#fff", width: "900px", display: "block", gridTemplateColumns: "none", gap: "0" }],
    breakpoints: { mediaQueries: [{ query: "(max-width: 640px)", changedProperties: ["display", "grid-template-columns"] }] },
    motion: { transitions: [{ property: "opacity", duration: "0.2s", easing: "ease", delay: "0s" }], animations: [], keyframes: ["fade"] },
    content: {
      blocks: [
        { order: 0, kind: "heading", tag: "h1", headingLevel: 1, sectionIndex: null, text: "A detailed heading", truncated: false },
        { order: 1, kind: "paragraph", tag: "p", headingLevel: null, sectionIndex: 0, text: "Full observed copy with useful detail.".repeat(20), truncated: false },
        { order: 2, kind: "list-item", tag: "li", headingLevel: null, sectionIndex: 0, text: "First feature", truncated: false },
        { order: 3, kind: "blockquote", tag: "blockquote", headingLevel: null, sectionIndex: 0, text: "Client quote", truncated: false },
        { order: 4, kind: "code", tag: "pre", headingLevel: null, sectionIndex: 0, text: "npm install foo\nnpm start", truncated: false },
        { order: 5, kind: "table", tag: "table", headingLevel: null, sectionIndex: 0, text: "Table (2 rows x 2 cols):\n| Chrome | Firefox |\n|---|---|\n| 128 | 130 |", truncated: false },
      ],
      hiddenBlocks: [{ order: 4, kind: "paragraph", tag: "p", text: "Collapsed FAQ answer", initialState: "collapsed-details", truncated: false }],
      controls: [
        { order: 0, kind: "input", label: "Email address", type: "email", name: "email", id: "email", required: true, disabled: false, href: null, options: [], ariaExpanded: null, ariaControls: null, ariaLabelledBy: null },
        { order: 1, kind: "select", label: "Service", type: "select-one", name: "service", id: "service", required: true, disabled: false, href: null, options: ["Brand", "Web"], ariaExpanded: null, ariaControls: null, ariaLabelledBy: null },
        { order: 2, kind: "button", label: "Send", type: "submit", name: null, id: null, required: false, disabled: false, href: null, options: [], ariaExpanded: null, ariaControls: null, ariaLabelledBy: null },
      ],
      components: [{ kind: "card-like", signature: "card-like|article|no-role|project-card", count: 3, examples: ["Project one", "Project two"] }],
      coverage: { contentBlocks: { sourceCount: 4, emittedCount: 4, cap: 120, truncated: false, reason: null }, controls: { sourceCount: 3, emittedCount: 3, cap: 100, truncated: false, reason: null } },
      sections: [{ role: "section", heading: "Work", textExcerpt: "Observed work section" }],
      tone: { avgSentenceWords: 12, questionCount: 1, ctaCount: 2, voice: "concise" },
    },
    assets: [
      { url: "https://example.com/hero.webp", kind: "image", alt: "Hero", width: 800, height: 600, usedOn: "https://example.com/" },
      { url: "https://example.com/loop.webm", kind: "video", alt: "Loop", width: null, height: null, usedOn: "https://example.com/", readyState: 0 },
    ],
  };
  const secondPage = {
    ...basePage,
    url: "https://example.com/services/", path: "/services", title: "Services", pageType: "services", isHomepage: false, priority: 2,
    screenshot: { kind: "webp", bytes: 24, width: 1440, height: 900 }, mobileScreenshot: null, sectionShots: [],
    responsiveComparison: { status: "dom-only", desktopViewport: { width: 1440, height: 900 }, mobileViewport: { width: 390, height: 900 }, sectionHeadingsAdded: [], sectionHeadingsMissing: [], countDeltas: { headings: 0, sections: 0, forms: 0, images: 0, controls: 0 }, layoutChanges: [], note: "DOM-only comparison from an extract-only pass." },
    tokens: { ...basePage.tokens, colors: [{ value: "#000", count: 1, source: "sampling", confidence: "inferred" }] },
  };
  return {
    schemaVersion: "0.2.0", backend: "local", request: { url: "https://example.com/", hostname: "example.com", maxPages: 2, includeMobile: true },
    pages: [basePage, secondPage], selection: { candidates: [] }, pagesDiscovered: 2, pagesSelected: 2, pagesAnalyzed: 2,
    screenshotsCaptured: 3, screenshotBytesTotal: 41, browserSecondsUsed: 2, issues: [], warnings: [], limitations: [], integrityPassed: true,
    assets: basePage.assets, assetCount: 2,
  };
}

describe("client documentation generation", () => {
  it("renders every documentation output from bounded observations", () => {
    const screenshotFiles = {
      "screenshots/desktop/home.webp": new Uint8Array([1]),
      "screenshots/mobile/home.webp": new Uint8Array([2]),
      "screenshots/sections/home-1.webp": new Uint8Array([3]),
    };
    const { files, byteLength } = buildDocumentationFiles(fixture(), screenshotFiles);
    expect(byteLength).toBeGreaterThan(0);
    for (const name of ["data/pages.json", "data/tokens.json", "data/components.json", "data/navigation.json", "data/interactions.json", "data/assets.json", "data/report.json", "screenshots/manifest.json", "theme.css", "tailwind.config.js", "pages/home.md", "pages/services.md", "responsive-behavior.md", "motion-and-interactions.md"]) {
      expect(files[name], name).toBeDefined();
    }
    for (const [name, contents] of Object.entries(files)) if (name.endsWith(".json")) expect(() => JSON.parse(contents), name).not.toThrow();
    const pageJson = JSON.parse(files["data/pages.json"]);
    expect(pageJson[0].content.blocks[1].text).toBe(fixture().pages[0].content.blocks[1].text);
    expect(pageJson[0].screenshot.dataUrl).toBeUndefined();
    expect(files["pages/home.md"]).toContain("Full observed copy with useful detail.");
    expect(files["pages/home.md"]).toContain("```\nnpm install foo");
    expect(files["pages/home.md"]).toContain("| Chrome | Firefox |");
    expect(files["pages/home.md"]).toContain("options: Brand, Web");
    expect(files["pages/home.md"]).toContain("collapsed-details / paragraph");
    expect(files["pages/home.md"]).toContain("Collapsed FAQ answer");
    expect(files["data/tokens.json"]).toContain("semanticSamples");
    expect(files["data/tokens.json"]).toContain("#000");
    expect(files["data/tokens.json"]).toContain("linear-gradient(135deg, #000, #fff)");
    expect(files["design-tokens.md"]).toContain("arrow-right");
    expect(files["data/interactions.json"]).toContain("/contact");
    expect(files["website-overview.md"]).toContain("Detected stack:");
    expect(files["website-overview.md"]).toContain("Next.js");
    expect(files["pages/home.md"]).toContain("never submitted");
    expect(files["theme.css"]).toContain("--gradient-1");
    expect(files["tailwind.config.js"]).toContain("backgroundImage");
    expect(files["typography.md"]).toContain("Typefaces in use");
    expect(files["typography.md"]).toContain("Example Sans, sans-serif");
    expect(files["data/interactions.json"]).toContain(".card:hover");
    expect(files["motion-and-interactions.md"]).toContain("Hover and focus states");
    expect(files["imagery-and-video.md"]).toContain("youtube");
    expect(files["imagery-and-video.md"]).toContain("single static frames");
    expect(JSON.parse(files["data/assets.json"]).embedCount).toBe(2);
    expect(files["website-overview.md"]).toContain("Share title");
    expect(files["data/interactions.json"]).toContain("aria-controlled");
    expect(files["responsive-behavior.md"]).toContain("1440×900");
    expect(files["responsive-behavior.md"]).toContain("DOM-only comparison (extract-only");
    expect(files["responsive-behavior.md"]).toContain("Status: dom-only");
    expect(files["motion-and-interactions.md"]).toContain("0.2s ease");
    expect(JSON.parse(files["data/assets.json"]).count).toBe(2);
    expect(files["imagery-and-video.md"]).toContain("first frame not ready at capture");
    expect(validateDocumentationPackage(files, screenshotFiles)).toEqual([]);
  });

  it("detects screenshot manifest mismatches and unindexed binaries", () => {
    const { files } = buildDocumentationFiles(fixture(), {});
    const screenshotFiles = { "screenshots/desktop/home.webp": new Uint8Array([1]), "screenshots/desktop/extra.webp": new Uint8Array([2]) };
    const issues = validateDocumentationPackage(files, screenshotFiles);
    expect(issues.some((issue) => issue.includes("hasBinary=false, ZIP entry present=true"))).toBe(true);
    expect(issues).toContain("Unindexed screenshot binary: screenshots/desktop/extra.webp");
  });

  it("filters non-token values and maps rebuild roles", () => {
    const analysis = fixture();
    analysis.pages[0].tokens.colors.push(
      { value: "inherit", count: 9, source: "cssom-rule", confidence: "observed" },
      { value: "transparent", count: 8, source: "computed-style-sampling", confidence: "inferred" },
      { value: "rgba(0, 0, 0, 0)", count: 8, source: "computed-style-sampling", confidence: "inferred" },
      { value: "var(--accent)", count: 5, source: "cssom-rule", confidence: "observed" },
    );
    (analysis.pages[0].tokens.borders as Array<{ value: string; count: number; source: string; confidence: string }>).push({ value: "medium !important", count: 4, source: "cssom-rule", confidence: "observed" });
    (analysis.pages[0].tokens.shadows as Array<{ value: string; count: number; source: string; confidence: string }>).push({ value: "none", count: 7, source: "computed-style-sampling", confidence: "inferred" });
    (analysis.pages[0].tokens.customProperties as Array<{ name: string; value: string; source: string; confidence: string }>).push({ name: "--canvas", value: "#080808", source: "computed-custom-property", confidence: "inferred" });
    analysis.pages[0].semanticStyles[0].backgroundColor = "rgba(0, 0, 0, 0)";
    analysis.pages[0].semanticStyles.push({ role: "button", fontFamily: "Example Sans", fontSize: "16px", fontWeight: "600", lineHeight: "1.25", letterSpacing: "normal", color: "#fff", backgroundColor: "#ccff00", width: "200px", display: "inline-block", gridTemplateColumns: "none", gap: "0" });
    // Page-level dotted keys duplicate content-level camelCase keys; only
    // one spelling must survive in the rendered coverage.
    (analysis.pages[0] as Record<string, unknown>).coverage = {
      "content.blocks": { sourceCount: 4, emittedCount: 4, cap: 120, truncated: false, reason: null },
    };
    const { files } = buildDocumentationFiles(analysis, {});

    expect(files["theme.css"]).not.toContain("inherit");
    expect(files["theme.css"]).not.toContain("transparent");
    expect(files["theme.css"]).not.toContain("rgba(0, 0, 0, 0)");
    expect(files["theme.css"]).not.toContain("!important");
    expect(JSON.stringify(JSON.parse(files["data/tokens.json"]))).not.toContain("inherit");
    expect(files["design-tokens.md"]).toContain("Key observed roles");
    expect(files["design-tokens.md"]).toContain("Body text:");
    expect(files["design-tokens.md"]).toContain("Buttons:");
    expect(files["design-tokens.md"]).toContain("page canvas is `--canvas`: `#080808`");
    expect(files["design-tokens.md"]).toContain("customProperties (--canvas): `#080808`");
    expect(files["design-tokens.md"]).toContain("`var(--accent)`");
    expect(files["design-tokens.md"]).not.toContain("var\\(--accent)");
    const report = JSON.parse(files["data/report.json"]);
    expect(report.coverage.some((line: string) => line.includes("/ content.blocks:"))).toBe(true);
    expect(report.coverage.some((line: string) => line.includes("contentBlocks:"))).toBe(false);
    expect(files["pages/home.md"]).not.toContain("contentBlocks:");
    expect(files["implementation-plan.md"]).toContain("pages/home.md");
    expect(files["implementation-plan.md"]).toContain("screenshots/desktop/home.webp");
    expect(files["implementation-plan.md"]).toContain("screenshots/mobile/home.webp");
    expect(files["responsive-behavior.md"]).toContain("Mobile comparison with screenshots:");
    expect(validateDocumentationPackage(files, {})).toEqual([]);
  });

  it("falls back to the root canvas sample when no canvas variable exists", () => {
    const analysis = fixture();
    analysis.pages[0].semanticStyles[0].backgroundColor = "rgba(0, 0, 0, 0)";
    (analysis.pages[0] as Record<string, unknown>).pageCanvasColor = "#123456";
    const { files } = buildDocumentationFiles(analysis, {});

    expect(files["design-tokens.md"]).toContain("page canvas sampled on root: `#123456`");
    expect(validateDocumentationPackage(files, {})).toEqual([]);
  });

  it("prefers the sampled root canvas over a canvas-named variable guess", () => {    const analysis = fixture();
    analysis.pages[0].semanticStyles[0].backgroundColor = "rgba(0, 0, 0, 0)";
    (analysis.pages[0] as Record<string, unknown>).pageCanvasColor = "#123456";
    (analysis.pages[0].tokens.customProperties as Array<{ name: string; value: string; source: string; confidence: string }>).push({ name: "--tooltip-background", value: "#03bfac", source: "computed-custom-property", confidence: "inferred" });
    const { files } = buildDocumentationFiles(analysis, {});

    expect(files["design-tokens.md"]).toContain("page canvas sampled on root: `#123456`");
    expect(files["design-tokens.md"]).not.toContain("possible page canvas is");
  });

  it("lists canvas-like variables as unverified candidates when nothing resolves", () => {
    const analysis = fixture();
    analysis.pages[0].semanticStyles[0].backgroundColor = "rgba(0, 0, 0, 0)";
    analysis.pages[0].tokens.colors.push({ value: "var(--bg-page)", count: 17, source: "cssom-rule", confidence: "observed" });
    const { files } = buildDocumentationFiles(analysis, {});

    expect(files["design-tokens.md"]).toContain("page background not observed");
    expect(files["design-tokens.md"]).toContain("canvas-like variables to verify");
    expect(files["design-tokens.md"]).toContain("`var(--bg-page)`");
  });

  it("detects the build stack from asset URLs ahead of the generator meta", () => {
    const analysis = fixture();
    (analysis.pages[0].assets as Array<Record<string, unknown>>).push({ url: "https://example.com/wp-content/themes/x/style.css", kind: "image", alt: "", width: null, height: null, usedOn: "https://example.com/" });
    const { files } = buildDocumentationFiles(analysis, {});

    expect(files["website-overview.md"]).toContain("Detected stack: WordPress (wp-content/wp-includes assets)");
    expect(validateDocumentationPackage(files, {})).toEqual([]);
  });

  it("prefers the largest-area sample when mapping key roles", () => {
    const analysis = fixture();
    analysis.pages[0].semanticStyles.push(
      { role: "button", fontFamily: "Example Sans", fontSize: "12px", fontWeight: "400", lineHeight: "1", letterSpacing: "normal", color: "#111", backgroundColor: "#222", width: "10px", display: "inline", gridTemplateColumns: "none", gap: "0" },
    );
    analysis.pages[0].layoutSamples.push(
      { role: "button", width: 10, height: 10, display: "inline", columns: "none", gap: "0", visible: true },
    );
    analysis.pages[1].semanticStyles = [
      { role: "button", fontFamily: "Example Sans", fontSize: "16px", fontWeight: "700", lineHeight: "1.25", letterSpacing: "normal", color: "#333", backgroundColor: "#444", width: "200px", display: "inline-block", gridTemplateColumns: "none", gap: "0" },
    ];
    analysis.pages[1].layoutSamples = [
      { role: "button", width: 300, height: 60, display: "inline-block", columns: "none", gap: "0", visible: true },
    ];
    const { files } = buildDocumentationFiles(analysis, {});

    expect(files["design-tokens.md"]).toContain("Buttons: text `#333` on `#444`");
    expect(validateDocumentationPackage(files, {})).toEqual([]);
  });

  it("renders the page language when observed", () => {
    const analysis = fixture();
    (analysis.pages[0] as Record<string, unknown>).lang = "zh-Hant-TW";
    (analysis.pages[0] as Record<string, unknown>).direction = "rtl";
    const { files } = buildDocumentationFiles(analysis, {});

    expect(files["pages/home.md"]).toContain("Language: zh-Hant-TW");
    expect(files["pages/home.md"]).toContain("Direction: rtl");
    expect(validateDocumentationPackage(files, {})).toEqual([]);
  });

  it("refuses documentation that exceeds the client hard cap rather than truncating it", () => {
    const analysis = fixture();
    analysis.pages[0].content.blocks[0].text = "x".repeat(9 * 1024 * 1024);
    expect(() => buildDocumentationFiles(analysis)).toThrow(/exceeding the client-side .* documentation limit/);
    try {
      buildDocumentationFiles(analysis);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("Largest files:");
    }
  });

  it("feeds generated docs and binaries to the STORE ZIP writer", () => {
    const screenshotFiles = { "screenshots/desktop/home.webp": new Uint8Array([1]) };
    const { files } = buildDocumentationFiles(fixture(), screenshotFiles);
    const merged = { ...files, ...screenshotFiles };
    expect(validateDocumentationPackage(files, screenshotFiles)).toEqual([]);
    const zip = createStoreZip(merged);
    expect(zip.bytes[0]).toBe(0x50);
    expect(zip.fileCount).toBe(Object.keys(merged).length);
  });
});
