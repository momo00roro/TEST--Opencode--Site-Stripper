import { describe, expect, it } from "vitest";
import type { SnapshotAsset } from "../src/browser/snapshot-script";
import type { SessionLauncher } from "../src/browser/types";
import {
  collectFontAssets,
  extractFontUrls,
  MAX_FONT_DOWNLOADS,
  rehydrateAssets,
} from "../src/pipeline/rehydrate-assets";
import { runAnalysis } from "../src/pipeline/analysis";
import type { AnalyzeRequest } from "../src/validation/analyze-request";
import { buildDocumentationFiles, validateDocumentationPackage } from "../../web/package-docs.mjs";
import { makeFakePage, mockSiteFetchWithDoh, SAMPLE_SNAPSHOT } from "./helpers";

const ORIGIN = "https://example.com";
const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0x02, 0x03]);
const WOFF2_TYPE = "font/woff2";

function stubFetch(routes: Record<string, Response>): (input: string) => Promise<Response> {
  return async (input: string): Promise<Response> => {
    const route = routes[input];
    if (!route) return new Response("missing", { status: 404 });
    return route;
  };
}

const allowAll = async (): Promise<void> => undefined;

function fontResponse(bytes: Uint8Array<ArrayBuffer>, contentType = WOFF2_TYPE): Response {
  return new Response(bytes, { status: 200, headers: { "content-type": contentType } });
}

function pagesWithFaces(faces: Array<{ family: string; src: string; weight: string }>) {
  return [
    {
      typography: { fontFaces: faces, fontFamilies: [], lineHeights: [], letterSpacings: [] },
      url: "https://example.com/",
      path: "/",
    },
  ];
}

describe("extractFontUrls (CF36-2)", () => {
  it("pulls url() targets in order and skips data: URLs", () => {
    expect(
      extractFontUrls(
        `url(https://example.com/a.woff2) format("woff2"), url("/fonts/b.woff") format("woff"), url(data:font/woff2;base64,AAA) format("woff2")`,
      ),
    ).toEqual(["https://example.com/a.woff2", "/fonts/b.woff"]);
  });

  it("returns an empty list for non-string or url-less src values", () => {
    expect(extractFontUrls("")).toEqual([]);
    expect(extractFontUrls(undefined as unknown as string)).toEqual([]);
    expect(extractFontUrls('local("Inter")')).toEqual([]);
  });
});

describe("collectFontAssets (CF36-2)", () => {
  it("collects distinct font file URLs in document order", () => {
    const pages = pagesWithFaces([
      { family: "Inter", src: `url(https://example.com/fonts/inter-400.woff2) format("woff2")`, weight: "400" },
      { family: "Inter", src: `url(https://example.com/fonts/inter-700.woff2) format("woff2")`, weight: "700" },
      { family: "Inter", src: `url(https://example.com/fonts/inter-400.woff2) format("woff2")`, weight: "400" },
    ]);

    const collected = collectFontAssets(pages, ORIGIN);

    expect(collected).toHaveLength(2);
    expect(collected[0]).toMatchObject({
      kind: "font",
      url: "https://example.com/fonts/inter-400.woff2",
      fontFamily: "Inter",
      fontWeight: "400",
    });
    expect(collected[1]).toMatchObject({ url: "https://example.com/fonts/inter-700.woff2" });
  });

  it("skips data: URLs and non-font extensions", () => {
    const pages = pagesWithFaces([
      { family: "Icons", src: `url(data:font/woff2;base64,AAA) format("woff2")`, weight: "400" },
      { family: "Photo", src: `url(https://example.com/hero.jpg)`, weight: "400" },
      { family: "Body", src: `url(/fonts/body.woff2) format("woff2")`, weight: "400" },
    ]);

    const collected = collectFontAssets(pages, ORIGIN);

    expect(collected).toHaveLength(1);
    expect(collected[0]?.url).toBe("https://example.com/fonts/body.woff2");
  });

  it("prefers same-origin URLs first and caps at MAX_FONT_DOWNLOADS", () => {
    expect(MAX_FONT_DOWNLOADS).toBe(10);
    const faces = Array.from({ length: 12 }, (_, index) => ({
      family: `F${index}`,
      src: `url(https://cdn.example/f${index}.woff2)`,
      weight: "400",
    }));
    faces.unshift({ family: "Local", src: `url(/fonts/local.woff2)`, weight: "400" });
    const collected = collectFontAssets(pagesWithFaces(faces), ORIGIN);

    expect(collected).toHaveLength(MAX_FONT_DOWNLOADS);
    expect(collected[0]?.url).toBe("https://example.com/fonts/local.woff2");
  });
});

describe("rehydrateAssets font kind (CF36-2)", () => {
  function fontAsset(overrides: Partial<SnapshotAsset> = {}): SnapshotAsset {
    return {
      url: "https://example.com/fonts/inter-400.woff2",
      kind: "font",
      alt: "Inter 400",
      width: null,
      height: null,
      usedOn: "https://example.com/",
      fontFamily: "Inter",
      fontWeight: "400",
      ...overrides,
    };
  }

  it("downloads a woff2 file with an assets/fonts localPath and Uint8Array content", async () => {
    const summary = await rehydrateAssets([fontAsset()], {
      fetchImpl: stubFetch({ "https://example.com/fonts/inter-400.woff2": fontResponse(WOFF2) }),
      origin: ORIGIN,
      validate: allowAll,
    });

    expect(summary.downloaded).toBe(1);
    expect(summary.assets[0]).toMatchObject({
      source: "downloaded",
      localPath: "assets/fonts/inter-400.woff2",
      bytes: WOFF2.byteLength,
      contentType: "font/woff2",
    });
    expect(summary.assets[0]?.content).toBeInstanceOf(Uint8Array);
    expect(summary.assets[0]).not.toHaveProperty("dataUrl");
  });

  it("suffixes same family+weight collisions deterministically", async () => {
    const entries = [
      fontAsset({ url: "https://example.com/fonts/inter-400-a.woff2" }),
      fontAsset({ url: "https://example.com/fonts/inter-400-b.woff2" }),
    ];
    const summary = await rehydrateAssets(entries, {
      fetchImpl: stubFetch({
        "https://example.com/fonts/inter-400-a.woff2": fontResponse(WOFF2),
        "https://example.com/fonts/inter-400-b.woff2": fontResponse(WOFF2),
      }),
      origin: ORIGIN,
      validate: allowAll,
    });

    expect(summary.assets[0]).toMatchObject({ localPath: "assets/fonts/inter-400.woff2" });
    expect(summary.assets[1]).toMatchObject({ localPath: "assets/fonts/inter-400-2.woff2" });
  });

  it("allows a cross-origin gstatic URL through the default public-target guard (poster carve-out)", async () => {
    const summary = await rehydrateAssets(
      [fontAsset({ url: "https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2" })],
      {
        fetchImpl: mockSiteFetchWithDoh(
          {
            "https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2": {
              body: "WOFF2BYTES",
              contentType: WOFF2_TYPE,
            },
          },
          { a: ["142.250.0.1"] },
        ),
        origin: ORIGIN,
      },
    );

    expect(summary.assets[0]).toMatchObject({ source: "downloaded", contentType: "font/woff2" });
    expect(summary.assets[0]?.localPath).toMatch(/^assets\/fonts\//);
  });

  it("still blocks a cross-origin font that resolves to a private address", async () => {
    const summary = await rehydrateAssets(
      [fontAsset({ url: "https://fonts.gstatic.com/s/inter/v12/test.woff2" })],
      {
        fetchImpl: mockSiteFetchWithDoh({}, { a: ["10.0.0.9"] }),
        origin: ORIGIN,
      },
    );

    expect(summary.assets[0]).toMatchObject({ source: "reference-only", skipReason: "validation-failed" });
  });

  it("records non-font content types with a reason instead of downloading", async () => {
    const summary = await rehydrateAssets([fontAsset()], {
      fetchImpl: stubFetch({
        "https://example.com/fonts/inter-400.woff2": new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      }),
      origin: ORIGIN,
      validate: allowAll,
    });

    expect(summary.assets[0]).toMatchObject({ source: "reference-only", skipReason: "non-font-content-type" });
  });
});

describe("runAnalysis font capture profile (CF36-2)", () => {
  function buildRequest(overrides: Record<string, unknown> = {}): AnalyzeRequest {
    return {
      target: {
        raw: "https://example.com/",
        url: new URL("https://example.com/"),
        origin: "https://example.com",
        hostname: "example.com",
      },
      resolvedIps: ["93.184.216.34"],
      maxPages: 1,
      includeMobile: false,
      ...overrides,
    } as AnalyzeRequest;
  }

  function fontLauncher(): SessionLauncher {
    const snapshot = {
      ...SAMPLE_SNAPSHOT,
      assets: [],
      typography: {
        fontFaces: [
          { family: "Inter", src: `url(https://example.com/fonts/inter-400.woff2) format("woff2")`, weight: "400" },
        ],
        fontFamilies: [],
        lineHeights: [],
        letterSpacings: [],
      },
    };
    const { page: base } = makeFakePage();
    return {
      name: "fake",
      launch: async () => ({
        newPage: async () => ({
          ...base,
          evaluate: (async <T>(fn: (() => T) | string): Promise<T> => {
            const src = typeof fn === "string" ? fn : Function.prototype.toString.call(fn);
            if (src.includes("maxHeadings")) return snapshot as unknown as T;
            return base.evaluate(fn);
          }) as typeof base.evaluate,
        }),
        close: async () => undefined,
      }),
    };
  }

  it("local-full downloads the font and converts bytes to dataUrl when an encoder is present", async () => {
    const fetchImpl = mockSiteFetchWithDoh(
      {
        "https://example.com/fonts/inter-400.woff2": { body: "WOFF2BYTES", contentType: WOFF2_TYPE },
      },
      { a: ["93.184.216.34"] },
    );
    const result = await runAnalysis(fontLauncher(), buildRequest(), {
      fetchImpl,
      capture: "full",
      encodeBase64: (bytes) => Buffer.from(bytes).toString("base64"),
    });

    const font = result.assets.find((entry) => entry.kind === "font");
    expect(font).toMatchObject({ source: "downloaded", localPath: "assets/fonts/inter-400.woff2" });
    expect(font?.dataUrl).toMatch(/^data:font\/woff2;base64,/);
    expect("content" in (font ?? {})).toBe(false);
    expect(result.limitations.some((line) => line.includes("[1 font]"))).toBe(true);
  });

  it("lite path collects no font assets (reference-only typography, byte-identical pack)", async () => {
    const fetchImpl = mockSiteFetchWithDoh(
      {
        "https://example.com/fonts/inter-400.woff2": { body: "WOFF2BYTES", contentType: WOFF2_TYPE },
      },
      { a: ["93.184.216.34"] },
    );
    const result = await runAnalysis(fontLauncher(), buildRequest(), {
      fetchImpl,
      capture: "lite",
      encodeBase64: (bytes) => Buffer.from(bytes).toString("base64"),
    });

    expect(result.assets.some((entry) => entry.kind === "font")).toBe(false);
  });
});

describe("package-docs fonts.css (CF36-2)", () => {
  function page(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      url: "https://example.com/",
      path: "/",
      title: "Example site",
      pageType: "homepage",
      isHomepage: true,
      selected: true,
      priority: 1,
      selectedBecause: "requested homepage",
      headings: [],
      sections: [],
      geometry: { containerWidths: [], sampledElements: 0 },
      navLinkCount: 0,
      nav: { header: [], primary: [], footer: [] },
      viewport: { width: 1440, height: 900 },
      layoutSamples: [],
      responsiveComparison: {
        status: "not-requested",
        desktopViewport: { width: 1440, height: 900 },
        mobileViewport: null,
        sectionHeadingsAdded: [],
        sectionHeadingsMissing: [],
        countDeltas: null,
        layoutChanges: [],
        note: "Mobile comparison was not requested.",
      },
      formCount: 0,
      imageCount: 0,
      domElementCount: 1,
      screenshot: null,
      mobileScreenshot: null,
      sectionShots: [],
      warnings: [],
      limitations: [],
      observedInteractions: [],
      hoverStates: [],
      embeds: [],
      formActions: [],
      social: {},
      tokens: {},
      typography: {},
      semanticStyles: [],
      breakpoints: {},
      motion: {},
      content: {
        blocks: [
          { order: 0, kind: "paragraph", tag: "p", headingLevel: null, sectionIndex: null, text: "Hello.", truncated: false },
        ],
        hiddenBlocks: [],
        controls: [],
        components: [],
        coverage: {},
        sections: [],
        tone: { avgSentenceWords: 1, questionCount: 0, ctaCount: 0, voice: "concise" },
      },
      assets: [],
      ...overrides,
    };
  }

  function analysisFixture(assets: Array<Record<string, unknown>>) {
    return {
      schemaVersion: "0.2.0",
      backend: "fake",
      request: { url: "https://example.com/", hostname: "example.com", maxPages: 1, includeMobile: false },
      pages: [page()],
      selection: null,
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
      assets,
      assetCount: assets.length,
    };
  }

  const downloadedFont = {
    url: "https://example.com/fonts/inter-400.woff2",
    kind: "font",
    alt: "Inter 400",
    width: null,
    height: null,
    usedOn: "https://example.com/",
    fontFamily: "Inter",
    fontWeight: "400",
    source: "downloaded",
    localPath: "assets/fonts/inter-400.woff2",
    bytes: WOFF2.byteLength,
    contentType: "font/woff2",
    dataUrl: `data:font/woff2;base64,${Buffer.from(WOFF2).toString("base64")}`,
  };

  it("ships font bytes into assets/fonts/* and emits @font-face rules after a JSON round-trip", () => {
    const wireAnalysis = JSON.parse(JSON.stringify(analysisFixture([downloadedFont])));

    const { files } = buildDocumentationFiles(wireAnalysis, {});

    expect(files["assets/fonts/inter-400.woff2"]).toBeInstanceOf(Uint8Array);
    expect(files["assets/fonts/inter-400.woff2"]).toEqual(WOFF2);
    expect(files["fonts.css"]).toContain('@font-face');
    expect(files["fonts.css"]).toContain('font-family: "Inter"');
    expect(files["fonts.css"]).toContain("url(\"assets/fonts/inter-400.woff2\")");
    const assetsJson = JSON.parse(files["data/assets.json"]);
    expect(assetsJson.assets[0].dataUrl).toBeUndefined();
    expect(validateDocumentationPackage(files, {})).toEqual([]);
  });

  it("emits an honest reference-only comment when no font was downloaded", () => {
    const referenceFont = {
      url: "https://fonts.gstatic.com/s/inter/v12/test.woff2",
      kind: "font",
      alt: "Inter 400",
      width: null,
      height: null,
      usedOn: "https://example.com/",
      fontFamily: "Inter",
      fontWeight: "400",
      source: "reference-only",
      skipReason: "validation-failed",
    };
    const { files } = buildDocumentationFiles(analysisFixture([referenceFont]), {});

    expect(Object.keys(files).some((name) => name.startsWith("assets/fonts/"))).toBe(false);
    expect(files["fonts.css"]).toContain("Reference-only");
    expect(files["fonts.css"]).toContain("https://fonts.gstatic.com/s/inter/v12/test.woff2");
    expect(files["fonts.css"]).not.toContain("@font-face {");
    expect(validateDocumentationPackage(files, {})).toEqual([]);
  });
});
