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
