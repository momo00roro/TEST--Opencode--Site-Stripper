import { describe, expect, it } from "vitest";
import { runAnalysis } from "../src/pipeline/analysis";
import { createStoreZip } from "../src/package/zip-store";
import { buildDocumentationFiles, validateDocumentationPackage } from "../../web/package-docs.mjs";
import { LIMITS } from "../src/config/limits";
import type { PageSnapshot } from "../src/browser/snapshot-script";
import type { SessionLauncher } from "../src/browser/types";
import type { AnalyzeRequest } from "../src/validation/analyze-request";
import { makeFakeLauncher, makeFakePage, mockSiteFetch, SAMPLE_SNAPSHOT } from "./helpers";

function buildRequest(overrides: Partial<AnalyzeRequest> = {}): AnalyzeRequest {
  return {
    target: {
      raw: "https://example.com/",
      url: new URL("https://example.com/"),
      origin: "https://example.com",
      hostname: "example.com",
    },
    resolvedIps: ["93.184.216.34"],
    maxPages: 10,
    includeMobile: true,
    ...overrides,
  };
}

function launcherWithSnapshot(
  snapshot: PageSnapshot,
  opts: { height?: number; bytes?: number } = {},
): SessionLauncher {
  return {
    name: "fake",
    launch: async () => ({
      newPage: async () => ({
        setViewport: async () => undefined,
        goto: async () => null,
        evaluate: async <T>(fn: (() => T) | string): Promise<T> => {
          const src = typeof fn === "string" ? fn : Function.prototype.toString.call(fn);
          if (src.includes("maxHeadings")) return snapshot as unknown as T;
          return (opts.height ?? 4000) as unknown as T;
        },
        screenshot: async () => new Uint8Array(opts.bytes ?? 1024),
        close: async () => undefined,
      }),
      close: async () => undefined,
    }),
  } as unknown as SessionLauncher;
}

function sitemapXml(paths: string[]): string {
  return `<urlset>${paths.map((p) => `<url><loc>https://example.com${p}</loc></url>`).join("")}</urlset>`;
}

describe("acceptance (CF12)", () => {
  it("1. handles a simple static single-page site", async () => {
    const { launcher } = makeFakeLauncher("fake");
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 1, includeMobile: false }), {
      fetchImpl: mockSiteFetch(),
    });
    expect(result.pagesAnalyzed).toBe(1);
    expect(result.integrityPassed).toBe(true);
    const pkg = buildDocumentationFiles(result);
    expect(validateDocumentationPackage(pkg.files)).toEqual([]);
    expect(pkg.files["theme.css"]).toContain(":root");
  });

  it("2. analyzes a small multi-page site in priority order", async () => {
    const { launcher } = makeFakeLauncher("fake");
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 3 }), {
      fetchImpl: mockSiteFetch(),
    });
    expect(result.pagesAnalyzed).toBe(3);
    expect(result.pages.map((p) => p.priority)).toEqual([1, 2, 3]);
    expect(result.pages[1]?.selectedBecause).toContain("Selected (priority 2)");
  });

  it("3. discovers React-like JS-heavy pages via nav links without a sitemap", async () => {
    const snapshot: PageSnapshot = {
      ...SAMPLE_SNAPSHOT,
      links: [
        { href: "https://example.com/app", text: "App", inNav: true, inHeader: true, inFooter: false },
        { href: "https://example.com/docs", text: "Docs", inNav: true, inHeader: true, inFooter: false },
      ],
    };
    const result = await runAnalysis(launcherWithSnapshot(snapshot), buildRequest({ maxPages: 5 }), {
      fetchImpl: mockSiteFetch(),
    });
    expect(result.pagesSelected).toBeGreaterThanOrEqual(2);
    expect(result.integrityPassed).toBe(true);
  });

  it("4. caps a Next.js-like 12-URL sitemap at maxPages 10", async () => {
    const paths = Array.from({ length: 12 }, (_, i) => `/p${i + 1}`);
    const fetchImpl = mockSiteFetch({
      "https://example.com/robots.txt": { body: "Sitemap: https://example.com/sitemap.xml" },
      "https://example.com/sitemap.xml": { body: sitemapXml(paths) },
    });
    const { launcher } = makeFakeLauncher("fake");
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 10 }), { fetchImpl });
    expect(result.pagesSelected).toBeLessThanOrEqual(10);
    expect(result.pagesAnalyzed).toBeLessThanOrEqual(10);
  });

  it("5. bounds a large 50-link navigation to maxPages", async () => {
    const links = Array.from({ length: 50 }, (_, i) => ({
      href: `https://example.com/section-${i + 1}`,
      text: `Section ${i + 1}`,
      inNav: true,
      inHeader: true,
      inFooter: false,
    }));
    const result = await runAnalysis(launcherWithSnapshot({ ...SAMPLE_SNAPSHOT, links }), buildRequest({ maxPages: 4 }), {
      fetchImpl: mockSiteFetch(),
    });
    expect(result.pagesSelected).toBe(4);
    expect(result.pagesAnalyzed).toBe(4);
  });

  it("6. returns a partial report when robots/sitemap are blocked", async () => {
    const fetchImpl = mockSiteFetch({
      "https://example.com/robots.txt": { status: 403, body: "denied" },
      "https://example.com/sitemap.xml": { status: 404, body: "" },
    });
    const { launcher } = makeFakeLauncher("fake");
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 2 }), { fetchImpl });
    expect(result.integrityPassed).toBe(true);
    expect(result.warnings.some((w) => w.includes("robots.txt"))).toBe(true);
  });

  it("7. survives a slow page timeout with issues recorded", async () => {
    const { launcher } = makeFakeLauncher("fake");
    const inner = launcher.launch.bind(launcher);
    let calls = 0;
    launcher.launch = async () => {
      const session = await inner();
      const orig = session.newPage.bind(session);
      session.newPage = async () => {
        calls += 1;
        if (calls === 2) throw new Error("navigation timeout of 12000ms exceeded");
        return orig();
      };
      return session;
    };
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 3 }), {
      fetchImpl: mockSiteFetch(),
    });
    expect(result.pagesAnalyzed).toBeGreaterThanOrEqual(1);
    expect(result.issues.some((i) => i.includes("timeout"))).toBe(true);
  });

  it("8. discloses cross-origin stylesheets while keeping inferred tokens", async () => {
    const snapshot: PageSnapshot = {
      ...SAMPLE_SNAPSHOT,
      tokens: {
        ...SAMPLE_SNAPSHOT.tokens,
        colors: [{ value: "rgb(1, 2, 3)", count: 4, source: "sampling", confidence: "inferred" }],
      },
      limitations: ["Cross-origin stylesheet skipped: https://cdn.example.com/app.css"],
    };
    const result = await runAnalysis(launcherWithSnapshot(snapshot), buildRequest({ maxPages: 1, includeMobile: false }), {
      fetchImpl: mockSiteFetch(),
    });
    expect(result.pages[0]?.limitations.some((l) => l.includes("Cross-origin"))).toBe(true);
    expect(result.pages[0]?.tokens.colors[0]?.confidence).toBe("inferred");
  });

  it("9. clips a very tall 20000px page", async () => {
    const { page } = makeFakePage({ height: 20000 });
    const launcher: SessionLauncher = {
      name: "fake",
      launch: async () => ({
        newPage: async () => page,
        close: async () => undefined,
      }),
    };
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 1, includeMobile: false }), {
      fetchImpl: mockSiteFetch(),
    });
    expect(result.pages[0]?.pageHeightPx).toBe(20000);
    expect(result.pages[0]?.warnings.some((w) => w.includes("cap"))).toBe(true);
  });

  it("10. contains a large extraction payload within budget honesty", async () => {
    const huge: PageSnapshot = {
      ...SAMPLE_SNAPSHOT,
      headings: Array.from({ length: 200 }, (_, i) => ({ level: 2, text: `h${i}-` + "y".repeat(3000), truncated: false })),
    };
    const result = await runAnalysis(launcherWithSnapshot(huge), buildRequest({ maxPages: 1, includeMobile: false }), {
      fetchImpl: mockSiteFetch(),
    });
    expect(result.limitations.some((l) => l.includes("extraction cap"))).toBe(true);
    expect(result.integrityPassed).toBe(true);
  });

  it("11. analyzes screenshot-heavy pages without screenshots past the byte cap", async () => {
    const { page } = makeFakePage({ bytes: 4 * 1024 * 1024 });
    const launcher: SessionLauncher = {
      name: "fake",
      launch: async () => ({
        newPage: async () => page,
        close: async () => undefined,
      }),
    };
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 3 }), {
      fetchImpl: mockSiteFetch(),
    });
    expect(result.pagesAnalyzed).toBe(3);
    expect(result.limitations.some((l) => l.includes("screenshot cap"))).toBe(true);
    expect(result.screenshotsCaptured).toBeLessThanOrEqual(LIMITS.maxDesktopScreenshots + LIMITS.maxMobileScreenshots);
    // Total transferred screenshot bytes must never exceed the hard cap.
    expect(result.screenshotBytesTotal).toBeLessThanOrEqual(LIMITS.maxTotalScreenshotBytes);
  });

  it("fidelity rubric: 1440 + 390 viewports, report honesty, ZIP integrity", async () => {
    const { launcher, state } = makeFakeLauncher("fake");
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 2 }), {
      fetchImpl: mockSiteFetch(),
    });
    const widths = state.screenshots.map((s) => s.clip?.width).filter(Boolean);
    expect(widths).toContain(1440);
    expect(widths).toContain(390);

    const pkg = buildDocumentationFiles(result);
    expect(validateDocumentationPackage(pkg.files)).toEqual([]);
    const report = JSON.parse(pkg.files["data/report.json"] as string) as { limitations: unknown };
    expect(Array.isArray(report.limitations)).toBe(true);
    // Honest disclosure of known non-goals in generated docs.
    expect(pkg.files["motion-and-interactions.md"]).toContain("not replayed");
    expect(pkg.files["imagery-and-video.md"]).toContain("URL references");

    const zip = createStoreZip(pkg.files);
    expect(zip.fileCount).toBe(Object.keys(pkg.files).length);
    expect(zip.bytes[0]).toBe(0x50);
  });
});
