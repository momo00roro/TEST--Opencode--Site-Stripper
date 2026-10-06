import { describe, expect, it } from "vitest";
import type { SnapshotAsset } from "../src/browser/snapshot-script";
import type { SessionLauncher } from "../src/browser/types";
import { LIMITS } from "../src/config/limits";
import { fetchVimeoThumbnailUrl, rehydrateAssets, unwrapOptimizerUrl, vimeoOEmbedUrl, vimeoVideoId } from "../src/pipeline/rehydrate-assets";
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

  it("downloads an SVG image even when classified as kind image (provider-logo case)", async () => {
    const entries = [
      asset({ url: "https://example.com/_next/image?url=%2Fassets%2Fimages%2Fhome%2Fmodels%2Fclaude.svg&w=2048&q=75", kind: "image", alt: "Anthropic" }),
      asset({ url: "https://example.com/photo.jpg", kind: "image", alt: "Photo" }),
    ];
    const summary = await rehydrateAssets(entries, {
      fetchImpl: stubFetch({
        "https://example.com/assets/images/home/models/claude.svg": svgResponse(SVG),
        "https://example.com/photo.jpg": svgResponse("x"),
      }),
      origin: ORIGIN,
      validate: allowAll,
    });

    expect(summary.assets[0]).toMatchObject({ source: "downloaded" });
    expect(summary.assets[0]?.localPath).toMatch(/^assets\/01-anthropic\.svg$/);
    expect(summary.assets[1]).toMatchObject({ source: "reference-only", skipReason: "ineligible-kind" });
  });

  it("downloads a poster JPG as bytes with a .jpg localPath", async () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const summary = await rehydrateAssets(
      [asset({ url: "https://example.com/poster.jpg", kind: "poster", alt: "Demo" })],
      {
        fetchImpl: stubFetch({
          "https://example.com/poster.jpg": new Response(jpg, { status: 200, headers: { "content-type": "image/jpeg" } }),
        }),
        origin: ORIGIN,
        validate: allowAll,
      },
    );

    expect(summary.downloaded).toBe(1);
    expect(summary.assets[0]).toMatchObject({ source: "downloaded", localPath: "assets/01-demo.jpg", bytes: jpg.byteLength, contentType: "image/jpeg" });
    expect(summary.assets[0]?.content).toBeInstanceOf(Uint8Array);
  });

  it("accepts PNG posters and rejects GIFs with a reason", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const summary = await rehydrateAssets(
      [
        asset({ url: "https://example.com/a.png", kind: "poster", alt: "Aaa" }),
        asset({ url: "https://example.com/b.gif", kind: "poster", alt: "Bbb" }),
      ],
      {
        fetchImpl: stubFetch({
          "https://example.com/a.png": new Response(png, { status: 200, headers: { "content-type": "image/png" } }),
          "https://example.com/b.gif": new Response(png, { status: 200, headers: { "content-type": "image/gif" } }),
        }),
        origin: ORIGIN,
        validate: allowAll,
      },
    );

    expect(summary.assets[0]).toMatchObject({ source: "downloaded", localPath: "assets/01-aaa.png" });
    expect(summary.assets[1]).toMatchObject({ source: "reference-only", skipReason: "non-image-content-type" });
  });

  it("accepts webp posters with a .webp localPath", async () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    const summary = await rehydrateAssets(
      [asset({ url: "https://example.com/p.webp", kind: "poster", alt: "Www" })],
      {
        fetchImpl: stubFetch({
          "https://example.com/p.webp": new Response(webp, { status: 200, headers: { "content-type": "image/webp" } }),
        }),
        origin: ORIGIN,
        validate: allowAll,
      },
    );

    expect(summary.assets[0]).toMatchObject({ source: "downloaded", localPath: "assets/01-www.webp" });
  });

  // Default validation path (no `validate` override): posters usually live
  // on third-party CDNs, so same-origin equality is skipped — but the
  // public-target SSRF guard always applies. Logos keep the strict check.
  it("downloads a cross-origin poster via the default path when the CDN host resolves public", async () => {
    const summary = await rehydrateAssets(
      [asset({ url: "https://cdn.example/poster.jpg", kind: "poster", alt: "Hero" })],
      {
        fetchImpl: mockSiteFetchWithDoh(
          { "https://cdn.example/poster.jpg": { body: "JPEGBYTES", contentType: "image/jpeg" } },
          { a: ["93.184.216.34"] },
        ),
        origin: ORIGIN,
      },
    );

    expect(summary.assets[0]).toMatchObject({ source: "downloaded", localPath: "assets/01-hero.jpg", contentType: "image/jpeg" });
  });

  it("still blocks a cross-origin poster that resolves to a private address", async () => {
    const summary = await rehydrateAssets(
      [asset({ url: "https://cdn.example/poster.jpg", kind: "poster", alt: "Hero" })],
      {
        fetchImpl: mockSiteFetchWithDoh({}, { a: ["10.0.0.9"] }),
        origin: ORIGIN,
      },
    );

    expect(summary.assets[0]).toMatchObject({ source: "reference-only", skipReason: "validation-failed" });
  });

  it("still blocks a cross-origin logo via the default path", async () => {
    const summary = await rehydrateAssets([asset({ url: "https://cdn.example/logo.svg", alt: "Logo" })], {
      fetchImpl: mockSiteFetchWithDoh(
        { "https://cdn.example/logo.svg": { body: SVG, contentType: "image/svg+xml" } },
        { a: ["93.184.216.34"] },
      ),
      origin: ORIGIN,
    });

    expect(summary.assets[0]).toMatchObject({ source: "reference-only", skipReason: "unresolvable-url" });
  });

  it("prioritizes non-poster assets under the file-count cap (posters use the remainder)", async () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const entries = [
      asset({ url: "https://example.com/p1.jpg", kind: "poster", alt: "P1" }),
      asset({ url: "https://example.com/a.svg", kind: "logo", alt: "Aaa" }),
      asset({ url: "https://example.com/b.svg", kind: "logo", alt: "Bbb" }),
      asset({ url: "https://example.com/p2.jpg", kind: "poster", alt: "P2" }),
    ];
    const summary = await rehydrateAssets(entries, {
      fetchImpl: stubFetch({
        "https://example.com/p1.jpg": new Response(jpg, { status: 200, headers: { "content-type": "image/jpeg" } }),
        "https://example.com/a.svg": svgResponse(SVG),
        "https://example.com/b.svg": svgResponse(SVG),
        "https://example.com/p2.jpg": new Response(jpg, { status: 200, headers: { "content-type": "image/jpeg" } }),
      }),
      origin: ORIGIN,
      validate: allowAll,
      maxFiles: 3,
    });

    // Document-order filenames, but logos download before posters.
    expect(summary.assets[0]).toMatchObject({ source: "downloaded", localPath: "assets/01-p1.jpg" });
    expect(summary.assets[1]).toMatchObject({ source: "downloaded", localPath: "assets/02-aaa.svg" });
    expect(summary.assets[2]).toMatchObject({ source: "downloaded", localPath: "assets/03-bbb.svg" });
    expect(summary.assets[3]).toMatchObject({ source: "reference-only", skipReason: "count-cap" });
  });

  it("prioritizes non-poster assets under the total-byte cap", async () => {
    const big = new Uint8Array(100).fill(0xff);
    const entries = [
      asset({ url: "https://example.com/p1.jpg", kind: "poster", alt: "P1" }),
      asset({ url: "https://example.com/a.svg", kind: "logo", alt: "Aaa" }),
    ];
    const summary = await rehydrateAssets(entries, {
      fetchImpl: stubFetch({
        "https://example.com/p1.jpg": new Response(big, { status: 200, headers: { "content-type": "image/jpeg" } }),
        "https://example.com/a.svg": svgResponse("0123456789"),
      }),
      origin: ORIGIN,
      validate: allowAll,
      totalCap: 50,
    });

    expect(summary.assets[1]).toMatchObject({ source: "downloaded" });
    expect(summary.assets[0]).toMatchObject({ source: "reference-only", skipReason: "total-cap" });
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

describe("rehydrateAssets raster hero/image (CF36-1 local-full)", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const pngRoute = (url: string): Record<string, Response> => ({
    [url]: new Response(png, { status: 200, headers: { "content-type": "image/png" } }),
  });

  it("downloads a hero PNG when allowRasterKinds is true", async () => {
    const summary = await rehydrateAssets(
      [asset({ url: "https://example.com/hero.png", kind: "hero", alt: "Hero" })],
      {
        fetchImpl: stubFetch(pngRoute("https://example.com/hero.png")),
        origin: ORIGIN,
        validate: allowAll,
        allowRasterKinds: true,
      },
    );

    expect(summary.downloaded).toBe(1);
    expect(summary.assets[0]).toMatchObject({
      source: "downloaded",
      localPath: "assets/01-hero.png",
      bytes: png.byteLength,
      contentType: "image/png",
    });
    expect(summary.assets[0]?.content).toBeInstanceOf(Uint8Array);
  });

  it("keeps a hero PNG reference-only without the flag (hosted default)", async () => {
    const summary = await rehydrateAssets(
      [asset({ url: "https://example.com/hero.png", kind: "hero", alt: "Hero" })],
      {
        fetchImpl: stubFetch(pngRoute("https://example.com/hero.png")),
        origin: ORIGIN,
        validate: allowAll,
      },
    );

    expect(summary.downloaded).toBe(0);
    expect(summary.assets[0]).toMatchObject({ source: "reference-only", skipReason: "non-svg-content-type" });
    expect(summary.assets[0]?.localPath).toBeUndefined();
  });

  it("honors perFileCap/totalCap/maxFiles overrides on the local-full path", async () => {
    const entries = [
      asset({ url: "https://example.com/a.svg", kind: "logo", alt: "Aaa" }),
      asset({ url: "https://example.com/b.svg", kind: "logo", alt: "Bbb" }),
      asset({ url: "https://example.com/c.svg", kind: "logo", alt: "Ccc" }),
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
      perFileCap: 512 * 1024,
      totalCap: 100,
      maxFiles: 80,
    });

    expect(summary.downloaded).toBe(2);
    expect(summary.assets[0]?.source).toBe("downloaded");
    expect(summary.assets[1]?.source).toBe("downloaded");
    expect(summary.assets[2]).toMatchObject({ source: "reference-only", skipReason: "total-cap" });
  });
});

describe("rehydrateAssets cross-origin hero raster (CF36-3 local-full carve-out)", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

  it("downloads a cross-origin hero PNG with the flag via the public-target guard (no same-origin)", async () => {
    const summary = await rehydrateAssets(
      [asset({ url: "https://static.higgsfield.ai/hero.png", kind: "hero", alt: "Showcase still" })],
      {
        fetchImpl: mockSiteFetchWithDoh(
          { "https://static.higgsfield.ai/hero.png": { body: "PNGBYTES", contentType: "image/png" } },
          { a: ["93.184.216.34"] },
        ),
        origin: ORIGIN,
        allowRasterKinds: true,
      },
    );

    expect(summary.downloaded).toBe(1);
    expect(summary.assets[0]).toMatchObject({
      source: "downloaded",
      localPath: "assets/01-showcase-still.png",
      contentType: "image/png",
    });
    expect(summary.assets[0]?.content).toBeInstanceOf(Uint8Array);
  });

  it("keeps a cross-origin hero PNG reference-only without the flag (hosted/lite default)", async () => {
    const summary = await rehydrateAssets(
      [asset({ url: "https://static.higgsfield.ai/hero.png", kind: "hero", alt: "Showcase still" })],
      {
        fetchImpl: mockSiteFetchWithDoh(
          { "https://static.higgsfield.ai/hero.png": { body: "PNGBYTES", contentType: "image/png" } },
          { a: ["93.184.216.34"] },
        ),
        origin: ORIGIN,
      },
    );

    expect(summary.downloaded).toBe(0);
    expect(summary.assets[0]).toMatchObject({ source: "reference-only", skipReason: "unresolvable-url" });
    expect(summary.assets[0]?.localPath).toBeUndefined();
  });

  it("still blocks a cross-origin private-IP hero even with the flag (SSRF guard unchanged)", async () => {
    const summary = await rehydrateAssets(
      [asset({ url: "https://cdn.example/hero.png", kind: "hero", alt: "Hero" })],
      {
        fetchImpl: mockSiteFetchWithDoh({}, { a: ["10.0.0.9"] }),
        origin: ORIGIN,
        allowRasterKinds: true,
      },
    );

    expect(summary.assets[0]).toMatchObject({ source: "reference-only", skipReason: "validation-failed" });
  });

  it("keeps SVG/logo/icon cross-origin even with the flag (identity assets stay first-party)", async () => {
    const summary = await rehydrateAssets(
      [asset({ url: "https://cdn.example/logo.svg", alt: "Logo" })],
      {
        fetchImpl: mockSiteFetchWithDoh(
          { "https://cdn.example/logo.svg": { body: SVG, contentType: SVG_TYPE } },
          { a: ["93.184.216.34"] },
        ),
        origin: ORIGIN,
        allowRasterKinds: true,
      },
    );

    expect(summary.assets[0]).toMatchObject({ source: "reference-only", skipReason: "unresolvable-url" });
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
    expect(result.limitations.some((line) => line.includes("[1 logo, 1 icon]"))).toBe(true);
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

  function posterLauncher(): SessionLauncher {
    const snapshot = {
      ...SAMPLE_SNAPSHOT,
      assets: [
        { url: "https://example.com/trailer-poster.jpg", kind: "poster", alt: "Trailer", width: null, height: null, usedOn: "https://example.com/" },
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
          close: async () => undefined,
        }),
        close: async () => undefined,
      }),
    };
  }

  it("re-encodes downloaded poster bytes as dataUrl when an encoder is supplied", async () => {
    const fetchImpl = mockSiteFetchWithDoh(
      {
        "https://example.com/trailer-poster.jpg": {
          body: "fake-bytes",
          contentType: "image/jpeg",
        },
      },
      { a: ["93.184.216.34"] },
    );
    const result = await runAnalysis(posterLauncher(), buildRequest(), {
      fetchImpl,
      encodeBase64: (bytes) => Buffer.from(bytes).toString("base64"),
    });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({ source: "downloaded", localPath: "assets/01-trailer.jpg" });
    expect(result.assets[0]?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    // Raw bytes must not ride the JSON response: they serialize as {"0":..}
    // bloat and fail client-side package validation (dead ZIP download).
    expect("content" in (result.assets[0] ?? {})).toBe(false);
    expect(result.limitations.some((line) => line.includes("Asset rehydration: downloaded 1"))).toBe(true);
  });

  it("reverts poster downloads to references when no encoder is available (hosted)", async () => {
    const fetchImpl = mockSiteFetchWithDoh(
      {
        "https://example.com/trailer-poster.jpg": {
          body: "fake-bytes",
          contentType: "image/jpeg",
        },
      },
      { a: ["93.184.216.34"] },
    );
    const result = await runAnalysis(posterLauncher(), buildRequest(), { fetchImpl });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({ source: "reference-only", skipReason: "binary-not-shipped" });
    expect(result.limitations.some((line) => line.includes("Asset rehydration: downloaded 0"))).toBe(true);
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

  const posterBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const downloadedPoster = {
    url: "https://example.com/poster.jpg",
    kind: "poster",
    alt: "Demo",
    width: null,
    height: null,
    usedOn: "https://example.com/",
    source: "downloaded",
    localPath: "assets/02-demo.jpg",
    bytes: posterBytes.byteLength,
    content: posterBytes,
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

  it("ships downloaded poster bytes as assets/ files without duplicating bytes into data JSON", () => {
    const { files, byteLength } = buildDocumentationFiles(analysisFixture([downloadedPoster]), {});

    expect(files["assets/02-demo.jpg"]).toBeInstanceOf(Uint8Array);
    expect(files["imagery-and-video.md"]).toContain("1 poster asset(s)");
    const assetsJson = JSON.parse(files["data/assets.json"]);
    expect(assetsJson.assets[0].content).toBeUndefined();
    expect(assetsJson.assets[0]).toMatchObject({ source: "downloaded", localPath: "assets/02-demo.jpg", bytes: posterBytes.byteLength });
    expect(byteLength).toBeGreaterThanOrEqual(posterBytes.byteLength);
    expect(validateDocumentationPackage(files, {})).toEqual([]);
  });

  it("ships poster dataUrl entries after a JSON round-trip (the browser download path)", () => {
    // Regression: poster bytes cannot cross the JSON API as Uint8Array, so
    // the pipeline re-encodes them as dataUrl. The in-memory shape above
    // passes, but only this post-round-trip shape reaches the browser — and
    // it used to fail validation with "Downloaded asset missing file entry",
    // leaving the DOWNLOAD ZIP button dead with no file.
    const wirePoster = {
      ...downloadedPoster,
      contentType: "image/jpeg",
      dataUrl: `data:image/jpeg;base64,${Buffer.from(posterBytes).toString("base64")}`,
    };
    delete (wirePoster as Record<string, unknown>).content;
    const wireAnalysis = JSON.parse(JSON.stringify(analysisFixture([wirePoster])));

    const { files } = buildDocumentationFiles(wireAnalysis, {});

    expect(files["assets/02-demo.jpg"]).toBeInstanceOf(Uint8Array);
    expect(files["assets/02-demo.jpg"]).toEqual(posterBytes);
    const assetsJson = JSON.parse(files["data/assets.json"]);
    expect(assetsJson.assets[0].dataUrl).toBeUndefined();
    expect(assetsJson.assets[0]).toMatchObject({ source: "downloaded", localPath: "assets/02-demo.jpg" });
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

  it("builds data/layout.json with per-section geometry and alignment", () => {
    const fixture = analysisFixture([referenceEntry]);
    fixture.pages[0] = {
      ...fixture.pages[0] as Record<string, unknown>,
      content: {
        ...(fixture.pages[0].content as Record<string, unknown>),
        sections: [{ role: "section", heading: "Hero", textExcerpt: "Hello." }],
      },
      sectionLayouts: [
        { heading: "Hero", y: 0, height: 900, textAlign: "center", columns: "1fr 1fr", background: "rgb(255, 255, 255)", components: [{ kind: "img", w: 100, h: 40 }] },
      ],
    };
    const { files } = buildDocumentationFiles(fixture, {});

    const layout = JSON.parse(files["data/layout.json"]);
    expect(layout.pages[0].sections).toMatchObject([
      { heading: "Hero", y: 0, height: 900, textAlign: "center", columns: "1fr 1fr" },
    ]);
    expect(layout.pages[0].sections[0].components).toMatchObject([{ kind: "img", w: 100, h: 40 }]);
    expect(validateDocumentationPackage(files, {})).toEqual([]);
  });

  it("builds REBUILD.md with one section header per homepage section plus gaps", () => {
    const fixture = analysisFixture([downloadedEntry, referenceEntry]);
    fixture.pages[0] = {
      ...fixture.pages[0] as Record<string, unknown>,
      content: {
        ...(fixture.pages[0].content as Record<string, unknown>),
        sections: [{ role: "section", heading: "Hero", textExcerpt: "Hello." }],
      },
    };
    const { files } = buildDocumentationFiles(fixture, {});

    expect(files["REBUILD.md"]).toContain("## Section 1: Hero");
    expect(files["REBUILD.md"]).toContain("Known gaps");
    expect(files["REBUILD.md"]).toContain("assets/01-example-logo.svg");
    expect(validateDocumentationPackage(files, {})).toEqual([]);
  });

  it("marks heading line-breaks in information-architecture.md", () => {
    const fixture = analysisFixture([referenceEntry]);
    fixture.pages[0] = {
      ...fixture.pages[0] as Record<string, unknown>,
      headings: [{ level: 1, text: "Scale design across teams", truncated: false, breaks: [2] }],
    };
    const { files } = buildDocumentationFiles(fixture, {});

    expect(files["information-architecture.md"]).toContain("Scale design ⏎ across teams");
    expect(files["information-architecture.md"]).toContain("⏎ marks where a heading wraps");
    expect(files["REBUILD.md"]).toContain("headings[].breaks");
    expect(validateDocumentationPackage(files, {})).toEqual([]);
  });

  it("lists rotating heading variants in motion-and-interactions.md", () => {
    const fixture = analysisFixture([referenceEntry]);
    fixture.pages[0] = {
      ...fixture.pages[0] as Record<string, unknown>,
      content: {
        ...(fixture.pages[0].content as Record<string, unknown>),
        rotatingText: [{ label: "h1[0]", before: "Made for Gemini", after: "Made for Claude" }],
      },
    };
    const { files } = buildDocumentationFiles(fixture, {});

    expect(files["motion-and-interactions.md"]).toContain("Made for Gemini");
    expect(files["motion-and-interactions.md"]).toContain("cycle through these variants");
    expect(validateDocumentationPackage(files, {})).toEqual([]);
  });

  it("lists video playback records with posters and flags in imagery-and-video.md", () => {
    const fixture = analysisFixture([referenceEntry]);
    fixture.pages[0] = {
      ...fixture.pages[0] as Record<string, unknown>,
      videos: [
        { url: "https://cdn.example/hero.mp4", poster: "https://cdn.example/hero.jpg", autoplay: true, muted: true, loop: true, playsinline: true, rectY: 100, rectHeight: 500 },
        { url: "", poster: "", autoplay: false, muted: false, loop: false, playsinline: false, rectY: null, rectHeight: null },
      ],
    };
    const { files } = buildDocumentationFiles(fixture, {});

    expect(files["imagery-and-video.md"]).toContain("## Videos");
    expect(files["imagery-and-video.md"]).toContain("https://cdn.example/hero.jpg");
    expect(files["imagery-and-video.md"]).toContain("autoplay");
    expect(files["imagery-and-video.md"]).toContain("tap/click-to-play");
    expect(files["imagery-and-video.md"]).toContain("no poster captured");
    expect(validateDocumentationPackage(files, {})).toEqual([]);
  });

  it("validates a 21-section page against the 20-section layout cap", () => {
    const sections = Array.from({ length: 21 }, (_, index) => ({ role: "section", heading: `S${index + 1}`, textExcerpt: "Hi." }));
    const sectionLayouts = Array.from({ length: 20 }, (_, index) => ({ heading: `S${index + 1}`, y: index * 100, height: 100 }));
    const fixture = analysisFixture([referenceEntry]);
    fixture.pages[0] = {
      ...fixture.pages[0] as Record<string, unknown>,
      content: {
        ...(fixture.pages[0].content as Record<string, unknown>),
        sections,
      },
      sectionLayouts,
    };
    const { files } = buildDocumentationFiles(fixture, {});

    expect(JSON.parse(files["data/layout.json"]).pages[0].sections).toHaveLength(20);
    expect(validateDocumentationPackage(files, {})).toEqual([]);
  });
});

describe("vimeoVideoId (CF25)", () => {
  it("extracts the numeric id from watch and player URLs", () => {
    expect(vimeoVideoId("https://vimeo.com/1202189218")).toBe("1202189218");
    expect(vimeoVideoId("https://vimeo.com/1202195955?share=copy&fl=sv&fe=ci")).toBe("1202195955");
    expect(vimeoVideoId("https://player.vimeo.com/video/1202189218?muted=1")).toBe("1202189218");
  });

  it("returns null for non-Vimeo or id-less URLs", () => {
    expect(vimeoVideoId("https://www.youtube.com/watch?v=abc")).toBeNull();
    expect(vimeoVideoId("https://vimeo.com/channels/staffpicks")).toBeNull();
    expect(vimeoVideoId("not a url")).toBeNull();
    expect(vimeoVideoId("")).toBeNull();
  });
});

describe("vimeoOEmbedUrl (CF25)", () => {
  it("builds the oEmbed lookup for a Vimeo URL", () => {
    expect(vimeoOEmbedUrl("https://vimeo.com/1202189218?share=copy")).toBe(
      "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F1202189218",
    );
  });

  it("returns null when no Vimeo id is present", () => {
    expect(vimeoOEmbedUrl("https://example.com/video.mp4")).toBeNull();
  });
});

describe("fetchVimeoThumbnailUrl (CF25)", () => {
  const oembed = (thumb: string): Response =>
    new Response(JSON.stringify({ thumbnail_url: thumb }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("returns the thumbnail_url from oEmbed JSON", async () => {
    const fetch = stubFetch({
      "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F1202189218": oembed(
        "https://i.vimeocdn.com/video/12345_640.jpg",
      ),
    });
    await expect(fetchVimeoThumbnailUrl("https://vimeo.com/1202189218", fetch)).resolves.toBe(
      "https://i.vimeocdn.com/video/12345_640.jpg",
    );
  });

  it("returns null on fetch failure, bad JSON, or missing thumbnail", async () => {
    const fetch = stubFetch({
      "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F1": oembed(""),
      "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F2": new Response("nope", { status: 200 }),
    });
    await expect(fetchVimeoThumbnailUrl("https://vimeo.com/1", fetch)).resolves.toBeNull();
    await expect(fetchVimeoThumbnailUrl("https://vimeo.com/2", fetch)).resolves.toBeNull();
    await expect(fetchVimeoThumbnailUrl("https://vimeo.com/3", fetch)).resolves.toBeNull();
    await expect(fetchVimeoThumbnailUrl("https://example.com/x.mp4", fetch)).resolves.toBeNull();
  });

  it("never throws when fetch rejects", async () => {
    const fetch = async (): Promise<Response> => { throw new Error("down"); };
    await expect(fetchVimeoThumbnailUrl("https://vimeo.com/1202189218", fetch)).resolves.toBeNull();
  });
});
