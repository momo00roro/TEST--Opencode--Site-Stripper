import { describe, expect, it } from "vitest";
import type { SnapshotAsset } from "../src/browser/snapshot-script";
import type { SessionLauncher } from "../src/browser/types";
import { LIMITS } from "../src/config/limits";
import { rehydrateAssets, unwrapOptimizerUrl } from "../src/pipeline/rehydrate-assets";
import { runAnalysis } from "../src/pipeline/analysis";
import type { AnalyzeRequest } from "../src/validation/analyze-request";
import { buildDocumentationFiles, validateDocumentationPackage } from "../../web/package-docs.mjs";
import { makeFakePage, mockSiteFetchWithDoh, SAMPLE_SNAPSHOT } from "./helpers";

const ORIGIN = "https://example.com";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
const SVG_TYPE = "image/svg+xml";

function asset(overrides: Partial<SnapshotAsset> = {}): SnapshotAsset {
  return {
    url: "https://example.com/logo.svg",
    kind: "logo",
    alt: "Example logo",
    width: 120,
    height: 40,
    usedOn: "https://example.com/",
    ...overrides,
  };
}

function svgResponse(body: string, contentType = SVG_TYPE): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

function stubFetch(
  routes: Record<string, Response | (() => Promise<Response> | Response)>,
): (input: string) => Promise<Response> {
  return async (input: string): Promise<Response> => {
    const route = routes[input];
    if (!route) return new Response("missing", { status: 404 });
    return typeof route === "function" ? route() : route;
  };
}

const allowAll = async (): Promise<void> => undefined;

describe("unwrapOptimizerUrl", () => {
  it("unwraps a relative optimizer path to a same-origin absolute URL", () => {
    expect(unwrapOptimizerUrl("/_next/image?url=%2Fassets%2Flogo.svg&w=64&q=75", ORIGIN)).toBe(
      "https://example.com/assets/logo.svg",
    );
  });

  it("unwraps an absolute same-origin optimizer URL", () => {
    expect(
      unwrapOptimizerUrl("https://example.com/_next/image?url=/a.svg&w=32", ORIGIN),
    ).toBe("https://example.com/a.svg");
  });

  it("passes plain same-origin URLs through as absolute URLs", () => {
    expect(unwrapOptimizerUrl("https://example.com/logo.svg", ORIGIN)).toBe(
      "https://example.com/logo.svg",
    );
    expect(unwrapOptimizerUrl("/logo.svg", ORIGIN)).toBe("https://example.com/logo.svg");
  });

  it("returns null when the optimizer url param is missing", () => {
    expect(unwrapOptimizerUrl("/_next/image?w=64&q=75", ORIGIN)).toBeNull();
    expect(unwrapOptimizerUrl("https://", ORIGIN)).toBeNull();
    expect(unwrapOptimizerUrl("", ORIGIN)).toBeNull();
  });

  it("returns null for cross-origin inner and outer URLs", () => {
    expect(
      unwrapOptimizerUrl("/_next/image?url=https://evil.example/x.svg", ORIGIN),
    ).toBeNull();
    expect(unwrapOptimizerUrl("https://other.example/x.svg", ORIGIN)).toBeNull();
    expect(
      unwrapOptimizerUrl("https://evil.example/_next/image?url=/x.svg", ORIGIN),
    ).toBeNull();
  });

  it("resolves srcset-style values from their first candidate", () => {
    expect(
      unwrapOptimizerUrl("https://example.com/a.svg 1x, https://example.com/b.svg 2x", ORIGIN),
    ).toBe("https://example.com/a.svg");
    expect(
      unwrapOptimizerUrl("/_next/image?url=%2Fa.svg&w=64 1x, /_next/image?url=%2Fb.svg&w=128 2x", ORIGIN),
    ).toBe("https://example.com/a.svg");
  });

  it("returns null for non-HTTP(S) URLs", () => {
    expect(unwrapOptimizerUrl("data:image/svg+xml,<svg/>", ORIGIN)).toBeNull();
    expect(unwrapOptimizerUrl("javascript:alert(1)", ORIGIN)).toBeNull();
  });
});

describe("LIMITS (CF13)", () => {
  it("caps per-file, total, and count downloads", () => {
    expect(LIMITS.maxAssetDownloadBytesPerFile).toBe(50 * 1024);
    expect(LIMITS.maxAssetDownloadBytesTotal).toBe(512 * 1024);
    expect(LIMITS.maxAssetDownloads).toBe(40);
  });
});

describe("rehydrateAssets caps", () => {
  it("skips a single file over the per-file cap as oversize", async () => {
    const big = `<svg xmlns="http://www.w3.org/2000/svg">${"x".repeat(60_000)}</svg>`;
    const summary = await rehydrateAssets([asset()], {
      fetchImpl: stubFetch({ "https://example.com/logo.svg": svgResponse(big) }),
      origin: ORIGIN,
      validate: allowAll,
    });

    expect(summary.downloaded).toBe(0);
    expect(summary.skippedOversize).toBe(1);
    expect(summary.assets[0]).toMatchObject({ source: "reference-only", skipReason: "oversize" });
    expect(summary.assets[0]?.localPath).toBeUndefined();
  });

  it("treats a declared content-length over the cap as oversize", async () => {
    const declared = {
      ok: true,
      status: 200,
      url: "",
      headers: new Headers({
        "content-type": SVG_TYPE,
        "content-length": String(10 * 1024 * 1024),
      }),
      body: null,
      text: async () => "<svg/>",
    } as unknown as Response;
    const summary = await rehydrateAssets([asset()], {
      fetchImpl: stubFetch({ "https://example.com/logo.svg": declared }),
      origin: ORIGIN,
      validate: allowAll,
    });

    expect(summary.assets[0]).toMatchObject({ source: "reference-only", skipReason: "oversize" });
  });

  it("enforces the total-byte cap across files in document order", async () => {
    const entries = [
      asset({ url: "https://example.com/a.svg", alt: "Aaa" }),
      asset({ url: "https://example.com/b.svg", alt: "Bbb" }),
      asset({ url: "https://example.com/c.svg", alt: "Ccc" }),
    ];
    const fetchImpl = stubFetch({
      "https://example.com/a.svg": svgResponse(SVG),
      "https://example.com/b.svg": svgResponse(SVG),
      "https://example.com/c.svg": svgResponse(SVG),
    });
    const summary = await rehydrateAssets(entries, {
      fetchImpl,
      origin: ORIGIN,
      validate: allowAll,
      totalCap: new TextEncoder().encode(SVG).byteLength * 2,
    });

    expect(summary.downloaded).toBe(2);
    expect(summary.assets[2]).toMatchObject({ source: "reference-only", skipReason: "total-cap" });
  });

  it("enforces the file-count cap in document order", async () => {
    const entries = [
      asset({ url: "https://example.com/a.svg", alt: "Aaa" }),
      asset({ url: "https://example.com/b.svg", alt: "Bbb" }),
      asset({ url: "https://example.com/c.svg", alt: "Ccc" }),
    ];
    const fetchImpl = stubFetch({
      "https://example.com/a.svg": svgResponse(SVG),
      "https://example.com/b.svg": svgResponse(SVG),
      "https://example.com/c.svg": svgResponse(SVG),
    });
    const summary = await rehydrateAssets(entries, {
      fetchImpl,
      origin: ORIGIN,
      validate: allowAll,
      maxFiles: 2,
    });

    expect(summary.downloaded).toBe(2);
    expect(summary.assets[0]?.source).toBe("downloaded");
    expect(summary.assets[1]?.source).toBe("downloaded");
    expect(summary.assets[2]).toMatchObject({ source: "reference-only", skipReason: "count-cap" });
  });

  it("never throws when the fetch implementation fails", async () => {
    const failing = async (): Promise<Response> => {
      throw new Error("network down");
    };
    const summary = await rehydrateAssets([asset(), asset({ url: "https://example.com/b.svg" })], {
      fetchImpl: failing,
      origin: ORIGIN,
      validate: allowAll,
    });

    expect(summary.downloaded).toBe(0);
    expect(summary.assets).toHaveLength(2);
    expect(summary.assets.every((entry) => entry.source === "reference-only")).toBe(true);
  });
});

describe("rehydrateAssets manifest shape", () => {
  it("marks downloaded entries with localPath, bytes, source, and content", async () => {
    const summary = await rehydrateAssets([asset()], {
      fetchImpl: stubFetch({ "https://example.com/logo.svg": svgResponse(SVG) }),
      origin: ORIGIN,
      validate: allowAll,
    });

    expect(summary.downloaded).toBe(1);
    expect(summary.totalBytes).toBe(new TextEncoder().encode(SVG).byteLength);
    expect(summary.assets[0]).toMatchObject({
      source: "downloaded",
      localPath: "assets/01-example-logo.svg",
      bytes: new TextEncoder().encode(SVG).byteLength,
      content: SVG,
      url: "https://example.com/logo.svg",
      kind: "logo",
    });
  });

  it("numbers filenames in manifest order and slugs empty alt text from the URL", async () => {
    const entries = [
      asset({ url: "https://example.com/photo.jpg", kind: "image", alt: "Photo" }),
      asset({ url: "https://example.com/_next/image?url=%2Ficons%2Fgrid.svg&w=64", kind: "icon", alt: "" }),
    ];
    const summary = await rehydrateAssets(entries, {
      fetchImpl: stubFetch({
        "https://example.com/photo.jpg": svgResponse("x"),
        "https://example.com/icons/grid.svg": svgResponse(SVG),
      }),
      origin: ORIGIN,
      validate: allowAll,
    });

    expect(summary.assets[0]).toMatchObject({ source: "reference-only", skipReason: "ineligible-kind" });
    expect(summary.assets[1]).toMatchObject({ source: "downloaded", localPath: "assets/02-grid.svg" });
  });

  it("records skip reasons for non-SVG content and failed validation", async () => {
    const entries = [
      asset({ url: "https://example.com/a.svg", alt: "Aaa" }),
      asset({ url: "https://example.com/b.svg", alt: "Bbb" }),
    ];
    const fetchImpl = stubFetch({
      "https://example.com/a.svg": svgResponse("fake-bytes", "image/png"),
      "https://example.com/b.svg": svgResponse(SVG),
    });
    const summary = await rehydrateAssets(entries, {
      fetchImpl,
      origin: ORIGIN,
      validate: async (url) => {
        if (url.endsWith("/b.svg")) throw new Error("blocked");
      },
    });

    expect(summary.assets[0]).toMatchObject({ source: "reference-only", skipReason: "non-svg-content-type" });
    expect(summary.assets[1]).toMatchObject({ source: "reference-only", skipReason: "validation-failed" });
    expect(summary.skippedUnresolvable).toBe(1);
  });
});

describe("runAnalysis (CF13)", () => {
  function buildRequest(overrides: Partial<AnalyzeRequest> = {}): AnalyzeRequest {
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
    };
  }

  function assetLauncher(): SessionLauncher {
    const snapshot = {
      ...SAMPLE_SNAPSHOT,
      assets: [
        { url: "https://example.com/logo.svg", kind: "logo", alt: "Example logo", width: 120, height: 40, usedOn: "https://example.com/" },
        { url: "https://example.com/_next/image?url=%2Ficons%2Fgrid.svg&w=64&q=75", kind: "icon", alt: "", width: 32, height: 32, usedOn: "https://example.com/" },
        { url: "https://example.com/hero.jpg", kind: "hero", alt: "Hero", width: 800, height: 600, usedOn: "https://example.com/" },
      ],
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

  it("attaches downloaded content to result.assets and notes counts in limitations", async () => {
    const fetchImpl = mockSiteFetchWithDoh(
      {
        "https://example.com/logo.svg": { body: SVG, contentType: SVG_TYPE },
        "https://example.com/icons/grid.svg": { body: SVG, contentType: SVG_TYPE },
        "https://example.com/hero.jpg": { body: "fake-bytes", contentType: "image/jpeg" },
      },
      { a: ["93.184.216.34"] },
    );
    const result = await runAnalysis(assetLauncher(), buildRequest(), { fetchImpl });

    expect(result.assets).toHaveLength(3);
    expect(result.assets[0]).toMatchObject({ source: "downloaded", localPath: "assets/01-example-logo.svg" });
    expect(typeof result.assets[0]?.content).toBe("string");
    expect(result.assets[0]?.bytes).toBe(new TextEncoder().encode(SVG).byteLength);
    expect(result.assets[1]).toMatchObject({ source: "downloaded", localPath: "assets/02-grid.svg" });
    expect(result.assets[2]).toMatchObject({ source: "reference-only", skipReason: "non-svg-content-type" });
    expect(result.limitations.some((line) => line.includes("Asset rehydration: downloaded 2"))).toBe(true);
    // Page-level assets stay reference-only: no content duplication into data/pages.json.
    expect("source" in (result.pages[0]?.assets[0] ?? {})).toBe(false);
    expect("content" in (result.pages[0]?.assets[0] ?? {})).toBe(false);
  });

  it("leaves every asset reference-only when downloads fail, without failing the run", async () => {
    const fetchImpl = mockSiteFetchWithDoh({}, {});
    const result = await runAnalysis(assetLauncher(), buildRequest(), { fetchImpl });

    expect(result.pagesAnalyzed).toBe(1);
    expect(result.assets).toHaveLength(3);
    expect(result.assets.every((entry) => entry.source === "reference-only")).toBe(true);
    expect(result.assets.every((entry) => typeof entry.skipReason === "string")).toBe(true);
    expect(result.limitations.some((line) => line.startsWith("Asset rehydration:"))).toBe(true);
  });
});

describe("package-docs (CF13)", () => {
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

  const downloadedEntry = {
    url: "https://example.com/logo.svg",
    kind: "logo",
    alt: "Example logo",
    width: 120,
    height: 40,
    usedOn: "https://example.com/",
    source: "downloaded",
    localPath: "assets/01-example-logo.svg",
    bytes: new TextEncoder().encode(SVG).byteLength,
    content: SVG,
  };

  const referenceEntry = {
    url: "https://example.com/hero.jpg",
    kind: "hero",
    alt: "Hero",
    width: 800,
    height: 600,
    usedOn: "https://example.com/",
    source: "reference-only",
    skipReason: "non-svg-content-type",
  };

  it("ships downloaded SVG text as assets/ files and notes them in imagery-and-video.md", () => {
    const { files } = buildDocumentationFiles(analysisFixture([downloadedEntry, referenceEntry]), {});

    expect(files["assets/01-example-logo.svg"]).toBe(SVG);
    expect(files["imagery-and-video.md"]).toContain("1 SVG asset(s) were downloaded");
    expect(files["imagery-and-video.md"]).toContain("assets/01-example-logo.svg");
    expect(files["imagery-and-video.md"]).toContain("downloaded to");
    expect(files["imagery-and-video.md"]).not.toContain("binaries are not fetched");
    const assetsJson = JSON.parse(files["data/assets.json"]);
    expect(assetsJson.assets[0].content).toBe(SVG);
    expect(validateDocumentationPackage(files, {})).toEqual([]);
  });

  it("flags downloaded entries without a matching assets/ file", () => {
    const { files } = buildDocumentationFiles(analysisFixture([downloadedEntry]), {});
    delete files["assets/01-example-logo.svg"];

    const issues = validateDocumentationPackage(files, {});
    expect(issues.some((issue: string) => issue.includes("Downloaded asset missing file entry"))).toBe(true);
  });

  it("still validates an all-skipped pack with no localPath required", () => {
    const { files } = buildDocumentationFiles(analysisFixture([referenceEntry]), {});

    expect(Object.keys(files).some((name) => name.startsWith("assets/"))).toBe(false);
    expect(files["imagery-and-video.md"]).toContain("No SVG assets were downloaded");
    expect(validateDocumentationPackage(files, {})).toEqual([]);
  });
});
