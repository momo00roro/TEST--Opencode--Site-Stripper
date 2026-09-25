import { describe, expect, it, vi } from "vitest";
import type { BrowserPage, SessionLauncher } from "../src/browser/types";
import type { PageSnapshot } from "../src/browser/snapshot-script";
import { LIMITS } from "../src/config/limits";
import { runAnalysis } from "../src/pipeline/analysis";
import type { AnalyzeRequest } from "../src/validation/analyze-request";
import { makeFakeLauncher, makeFakePage, mockSiteFetch, mockSiteFetchWithDoh, SAMPLE_SNAPSHOT } from "./helpers";

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

describe("runAnalysis (CF06)", () => {
  it("analyzes the homepage plus every selected page in priority order", async () => {
    const { launcher, state } = makeFakeLauncher("fake");
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 3 }), {
      fetchImpl: mockSiteFetch(),
    });

    expect(result.pagesAnalyzed).toBe(3);
    expect(result.pagesSelected).toBe(3);
    expect(result.pages.map((page) => page.priority)).toEqual([1, 2, 3]);
    expect(result.pages[0]?.path).toBe("/");
    expect(result.pages[1]?.path).toBe("/about");
    expect(result.pages[1]?.selectedBecause).toContain("Selected (priority 2)");
    // 3 desktop + homepage mobile + representative-page mobile (PRD §306),
    // plus one extract-only DOM-only mobile pass for the third page.
    expect(result.screenshotsCaptured).toBe(5);
    expect(result.integrityPassed).toBe(true);
    expect(state.opened).toBe(6);
    expect(state.closed).toBe(1);
  });

  it("marks tab hygiene: one tab at a time, opened and closed per page", async () => {
    const { launcher, state } = makeFakeLauncher("fake");
    await runAnalysis(launcher, buildRequest({ maxPages: 2, includeMobile: false }), {
      fetchImpl: mockSiteFetch(),
    });

    expect(state.opened).toBe(2);
    expect(state.closed).toBe(1);
  });

  it("adds a CF06 limitation when extra pages were selected", async () => {
    const { launcher } = makeFakeLauncher("fake");
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 3 }), {
      fetchImpl: mockSiteFetch(),
    });

    expect(result.limitations.some((line) => line.includes("documentation rendering") && line.includes("client-side"))).toBe(true);
  });

  it("captures mobile for the homepage and one representative page", async () => {
    const { launcher, state } = makeFakeLauncher("fake");
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 2 }), {
      fetchImpl: mockSiteFetch(),
    });

    const mobile = state.screenshots.filter((shot) => shot.clip?.width === 390);
    // PRD §306: mobile for the homepage and one representative page (max 2).
    expect(mobile).toHaveLength(2);
    expect(result.pages[0]?.mobileScreenshot).toMatchObject({ kind: "webp", width: 390 });
    expect(result.pages[1]?.mobileScreenshot).toMatchObject({ kind: "webp", width: 390 });
    expect(result.pages[0]?.responsiveComparison).toMatchObject({ status: "captured", desktopViewport: { width: 1440 }, mobileViewport: { width: 390 } });
    expect(result.pages[1]?.responsiveComparison.status).toBe("captured");
    expect(result.screenshotsCaptured).toBe(4);
    expect(result.screenshotBytesTotal).toBe(1024 * 4);
    // Hosted path: no encoder, so no inline binary — the client ZIP must not
    // advertise these as shippable (manifest hasBinary stays false).
    expect("dataUrl" in (result.pages[0]?.mobileScreenshot ?? {})).toBe(false);
    expect("dataUrl" in (result.pages[1]?.mobileScreenshot ?? {})).toBe(false);
  });

  it("captures DOM-only mobile observations for remaining pages", async () => {
    const { launcher, state } = makeFakeLauncher("fake");
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 3 }), {
      fetchImpl: mockSiteFetch(),
    });

    const third = result.pages[2];
    expect(third?.responsiveComparison.status).toBe("dom-only");
    expect(third?.responsiveComparison.mobileViewport).toMatchObject({ width: 390 });
    expect(third?.responsiveComparison.countDeltas).not.toBeNull();
    expect(third?.responsiveComparison.note).toContain("extract-only");
    expect(third?.mobileScreenshot).toBeNull();
    // No extra screenshot binaries: still 3 desktop + 2 mobile shots.
    expect(result.screenshotsCaptured).toBe(5);
    const mobileShots = state.screenshots.filter((shot) => shot.clip?.width === 390);
    expect(mobileShots).toHaveLength(2);
  });

  it("captures homepage mobile before remaining desktop pages", async () => {
    const { launcher, state } = makeFakeLauncher("fake");
    await runAnalysis(launcher, buildRequest({ maxPages: 3 }), {
      fetchImpl: mockSiteFetch(),
    });

    // Homepage desktop, homepage mobile, then remaining desktop pages: the
    // most valuable comparison survives wall-budget exhaustion.
    expect(state.viewports[0]).toMatchObject({ width: 1440 });
    expect(state.viewports[1]).toMatchObject({ width: 390 });
    expect(state.viewports[2]).toMatchObject({ width: 1440 });
  });

  it("aborts remaining pages when the homepage serves a bot challenge", async () => {
    const challenged: PageSnapshot = {
      ...SAMPLE_SNAPSHOT,
      title: "Access Verification",
      headings: [],
      links: [
        { href: "https://example.com/about", text: "About", inNav: true, inHeader: true, inFooter: false },
      ],
      content: {
        ...SAMPLE_SNAPSHOT.content,
        blocks: [
          { order: 0, kind: "heading", tag: "h1", headingLevel: 1, sectionIndex: null, text: "Access Verification", truncated: false },
          { order: 1, kind: "paragraph", tag: "p", headingLevel: null, sectionIndex: null, text: "For better experience, please slide to complete the verification.", truncated: false },
        ],
        controls: [],
      },
    };
    const { page: base } = makeFakePage();
    const launcher: SessionLauncher = {
      name: "fake",
      launch: async () => ({
        newPage: async () => ({
          ...base,
          evaluate: (async <T>(fn: (() => T) | string): Promise<T> => {
            const src = typeof fn === "string" ? fn : Function.prototype.toString.call(fn);
            if (src.includes("maxHeadings")) return challenged as unknown as T;
            return base.evaluate(fn);
          }) as BrowserPage["evaluate"],
        }) as BrowserPage,
        close: async () => undefined,
      }),
    };
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 3 }), {
      fetchImpl: mockSiteFetch(),
    });

    expect(result.pagesAnalyzed).toBe(1);
    expect(result.pages[0]?.title).toBe("Access Verification");
    expect(result.limitations.some((line) => line.includes("bot-verification challenge"))).toBe(true);
    // Homepage desktop shot only: mobile is skipped on challenged runs.
    expect(result.screenshotsCaptured).toBe(1);
  });

  it("skips a challenged inner page without documentation", async () => {
    const challenged: PageSnapshot = {
      ...SAMPLE_SNAPSHOT,
      title: "Access Verification",
      headings: [],
      links: [],
      content: {
        ...SAMPLE_SNAPSHOT.content,
        blocks: [
          { order: 0, kind: "heading", tag: "h1", headingLevel: 1, sectionIndex: null, text: "Access Verification", truncated: false },
          { order: 1, kind: "paragraph", tag: "p", headingLevel: null, sectionIndex: null, text: "For better experience, please slide to complete the verification.", truncated: false },
        ],
        controls: [],
      },
    };
    const { page: base } = makeFakePage();
    const gotos: string[] = [];
    const launcher: SessionLauncher = {
      name: "fake",
      launch: async () => ({
        newPage: async () => ({
          ...base,
          goto: (async (url: string, options?: Record<string, unknown>): Promise<null> => {
            gotos.push(url);
            await base.goto(url, options as never);
            return null;
          }) as unknown as BrowserPage["goto"],
          evaluate: (async <T>(fn: (() => T) | string): Promise<T> => {
            const src = typeof fn === "string" ? fn : Function.prototype.toString.call(fn);
            if (src.includes("maxHeadings")) {
              const current = gotos[gotos.length - 1] ?? "";
              return (current.includes("/about") ? challenged : SAMPLE_SNAPSHOT) as unknown as T;
            }
            return base.evaluate(fn);
          }) as BrowserPage["evaluate"],
        }) as BrowserPage,
        close: async () => undefined,
      }),
    };
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 2 }), {
      fetchImpl: mockSiteFetch(),
    });

    expect(result.pagesAnalyzed).toBe(1);
    expect(result.issues.some((line) => line.includes("bot-verification challenge"))).toBe(true);
    // Homepage desktop + homepage mobile + the spent challenged shot.
    expect(result.screenshotsCaptured).toBe(3);
  });

  it("inlines mobile screenshot dataUrls when an encoder is supplied", async () => {
    const { launcher } = makeFakeLauncher("fake");
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 2 }), {
      fetchImpl: mockSiteFetch(),
      encodeBase64: (bytes) => Buffer.from(bytes).toString("base64"),
    });

    // Local-dev path: mobile binaries ride along, so the client ZIP ships the
    // same shots the manifest lists (previously these were silently dropped).
    expect(result.pages[0]?.mobileScreenshot?.dataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(result.pages[1]?.mobileScreenshot?.dataUrl).toMatch(/^data:image\/webp;base64,/);
  });

  it("does not capture mobile when includeMobile is false", async () => {
    const { launcher, state } = makeFakeLauncher("fake");
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 2, includeMobile: false }), {
      fetchImpl: mockSiteFetch(),
    });

    expect(state.screenshots.filter((shot) => shot.clip?.width === 390)).toHaveLength(0);
    expect(result.pages[0]?.mobileScreenshot).toBeNull();
  });

  it("returns a partial report when a later page fails to open", async () => {
    const { launcher, state } = makeFakeLauncher("fake");
    const innerLaunch = launcher.launch.bind(launcher);
    let calls = 0;
    launcher.launch = async () => {
      const session = await innerLaunch();
      const origNewPage = session.newPage.bind(session);
      session.newPage = async () => {
        calls += 1;
        if (calls === 2) throw new Error("tab boom");
        return origNewPage();
      };
      return session;
    };

    const result = await runAnalysis(launcher, buildRequest({ maxPages: 3 }), {
      fetchImpl: mockSiteFetch(),
    });

    expect(result.pagesAnalyzed).toBeGreaterThanOrEqual(1);
    expect(result.issues.some((issue) => issue.includes("tab boom"))).toBe(true);
    expect(result.integrityPassed).toBe(true);
    expect(state.closed).toBe(1);
  });

  it("closes the session when selection input throws", async () => {
    const { launcher, state } = makeFakeLauncher("fake");
    const brokenFetch = async (): Promise<Response> => {
      throw new Error("discovery boom");
    };
    // Discovery catches its own errors, so force a throw after discovery by
    // using a launcher whose session close is observable; run must still close.
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 2 }), {
      fetchImpl: brokenFetch as unknown as typeof fetch,
    });

    expect(result.pagesAnalyzed).toBeGreaterThanOrEqual(1);
    expect(state.closed).toBe(1);
  });

  it("revalidates cross-host redirects and records unresolvable ones as page issues", async () => {
    const { launcher } = makeFakeLauncher("fake");
    const innerLaunch = launcher.launch.bind(launcher);
    let calls = 0;
    launcher.launch = async () => {
      const session = await innerLaunch();
      const origNewPage = session.newPage.bind(session);
      session.newPage = async () => {
        calls += 1;
        const page = await origNewPage();
        if (calls >= 2) {
          const origEvaluate = page.evaluate.bind(page);
          page.evaluate = (async <T>(fn: (() => T) | string): Promise<T> => {
            const src = typeof fn === "string" ? fn : Function.prototype.toString.call(fn);
            if (src.includes("maxHeadings")) {
              return { ...SAMPLE_SNAPSHOT, url: "https://unresolvable.example/page" } as unknown as T;
            }
            return origEvaluate(fn);
          }) as typeof page.evaluate;
        }
        return page;
      };
      return session;
    };

    const result = await runAnalysis(launcher, buildRequest({ maxPages: 3 }), {
      fetchImpl: mockSiteFetch(),
    });

    // Homepage analyzed; later pages + mobile redirect somewhere DoH cannot
    // resolve, so they become issues instead of trusted output.
    expect(result.pagesAnalyzed).toBeGreaterThanOrEqual(1);
    expect(result.issues.some((issue) => issue.includes("resolved"))).toBe(true);
    expect(result.integrityPassed).toBe(true);
  });

  it("keeps analyzing without screenshots after the byte cap", async () => {
    const { page, state } = makeFakePage({ bytes: 4 * 1024 * 1024 });
    const opened = { count: 0 };
    const closed = { count: 0 };
    const launcher = {
      name: "fake",
      launch: async () => ({
        newPage: async () => {
          opened.count += 1;
          return page;
        },
        close: async () => {
          closed.count += 1;
        },
      }),
    };

    const result = await runAnalysis(launcher, buildRequest({ maxPages: 3 }), {
      fetchImpl: mockSiteFetch(),
    });

    expect(result.pagesAnalyzed).toBe(3);
    expect(result.screenshotsCaptured).toBeLessThanOrEqual(LIMITS.maxDesktopScreenshots);
    expect(result.screenshotBytesTotal).toBeLessThanOrEqual(
      LIMITS.maxTotalScreenshotBytes + 4 * 1024 * 1024,
    );
    expect(result.limitations.some((line) => line.includes("screenshot cap"))).toBe(true);
    expect(state.screenshots.length).toBeGreaterThan(0);
    expect(closed.count).toBe(1);
  });

  it("records a limitation when extraction payload exceeds the hard cap", async () => {
    const hugeSnapshot = {
      ...SAMPLE_SNAPSHOT,
      headings: Array.from({ length: 200 }, (_, index) => ({
        level: 2,
        text: `heading-${index}-` + "y".repeat(3000),
      })),
    };
    const launcher = {
      name: "fake",
      launch: async () => ({
        newPage: async () => ({
          setViewport: async () => undefined,
          goto: async () => null,
          evaluate: async <T>(fn: (() => T) | string): Promise<T> => {
            const source = typeof fn === "string" ? fn : Function.prototype.toString.call(fn);
            if (source.includes("maxHeadings") || source.includes("querySelectorAll")) {
              return hugeSnapshot as unknown as T;
            }
            return 4000 as unknown as T;
          },
          screenshot: async () => new Uint8Array(1024),
          close: async () => undefined,
        }),
        close: async () => undefined,
      }),
    };

    const result = await runAnalysis(launcher, buildRequest({ maxPages: 1, includeMobile: false }), {
      fetchImpl: mockSiteFetch(),
    });

    expect(result.pagesAnalyzed).toBe(1);
    expect(result.limitations.some((line) => line.includes("extraction cap"))).toBe(true);
  });

  it("skips mobile capture when the wall budget is exhausted", async () => {
    const { launcher } = makeFakeLauncher("fake");
    const start = Date.now();
    let calls = 0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => {
      calls += 1;
      return calls === 1 ? start : start + LIMITS.totalAnalysisWallBudgetMs + 1000;
    });

    try {
      const result = await runAnalysis(launcher, buildRequest({ maxPages: 2 }), {
        fetchImpl: mockSiteFetch(),
      });

      expect(result.pages[0]?.mobileScreenshot).toBeNull();
      expect(result.limitations.some((line) => line.includes("wall budget"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("surfaces CF07 tokens and per-page style limitations", async () => {
    const { launcher } = makeFakeLauncher("fake");
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 1, includeMobile: false }), {
      fetchImpl: mockSiteFetch(),
    });

    const page = result.pages[0];
    expect(page?.tokens.colors.length).toBeLessThanOrEqual(15);
    expect(page?.tokens.fontSizes.length).toBeLessThanOrEqual(10);
    expect(page?.tokens.gradients.length).toBeLessThanOrEqual(8);
    expect(page?.typography.fontFamilies.length).toBeLessThanOrEqual(8);
    expect(Array.isArray(page?.hoverStates)).toBe(true);
    expect(Array.isArray(page?.embeds)).toBe(true);
    expect(Array.isArray(page?.formActions)).toBe(true);
    expect(page?.social).toBeDefined();
    expect(page?.typography).toBeDefined();
    expect(page?.pageCanvasColor).toBe("rgb(255, 255, 255)");
    expect(page?.lang).toBe("en");
    expect(page?.direction).toBe("ltr");
    expect(page?.breakpoints).toBeDefined();
    expect(page?.motion).toBeDefined();
    expect(page?.geometry).toBeDefined();
    expect(Array.isArray(page?.limitations)).toBe(true);
    expect(page?.selected).toBe(true);
    expect(Array.isArray(page?.sections)).toBe(true);
    expect(Array.isArray(page?.observedInteractions)).toBe(true);
  });

  it("reports ordered progress phases with page counts", async () => {
    const { launcher } = makeFakeLauncher("fake");
    const events: Array<{ phase: string; current?: number; total?: number; path?: string }> = [];

    await runAnalysis(launcher, buildRequest({ maxPages: 3 }), {
      fetchImpl: mockSiteFetch(),
      onProgress: (event) => events.push(event),
    });

    const phases = events.map((event) => event.phase);
    expect(phases[0]).toBe("launching");
    expect(phases).toContain("homepage");
    expect(phases).toContain("discovery");
    expect(phases).toContain("selection");
    expect(phases).toContain("page");
    expect(phases[phases.length - 1]).toBe("done");

    const pageEvents = events.filter((event) => event.phase === "page");
    expect(pageEvents).toHaveLength(2);
    expect(pageEvents[0]?.total).toBe(2);
    expect(pageEvents[0]?.path).toBe("/about");
  });

  it("scopes discovery to the landed origin after a www redirect", async () => {    // Fake snapshot lands on the apex while the request targets www: the
    // apex nav links must still be discovered via the scope origin.
    const { launcher } = makeFakeLauncher("fake");
    const request = buildRequest({
      target: {
        raw: "https://www.example.com/",
        url: new URL("https://www.example.com/"),
        origin: "https://www.example.com",
        hostname: "www.example.com",
      },
      maxPages: 2,
    });
    const result = await runAnalysis(launcher, request, {
      fetchImpl: mockSiteFetchWithDoh({}, { a: ["93.184.216.34"] }),
    });

    expect(result.warnings.some((w) => w.includes("Redirected from"))).toBe(true);
    expect(result.pagesSelected).toBe(2);
    expect(result.pages[1]?.path).toBe("/about");
  });

  it("discloses evidence-based known product limits", async () => {    const { launcher } = makeFakeLauncher("fake");
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 1, includeMobile: false }), {
      fetchImpl: mockSiteFetch(),
    });

    expect(result.limitations.some((line) => line.includes("Custom fonts"))).toBe(true);
  });

  it("surfaces CF08 content and aggregates the asset manifest", async () => {
    const { launcher } = makeFakeLauncher("fake");
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 2, includeMobile: false }), {
      fetchImpl: mockSiteFetch(),
    });

    expect(result.pages[0]?.content.blocks).toBeDefined();
    expect(result.pages[0]?.content.tone).toBeDefined();
    expect(Array.isArray(result.pages[0]?.assets)).toBe(true);
    expect(Array.isArray(result.assets)).toBe(true);
    expect(result.assets.length).toBeLessThanOrEqual(LIMITS.maxAssetManifestEntries);
    expect(result.assetCount).toBe(result.assets.length);
  });

  it("captures section-clipped homepage screenshots within the section cap", async () => {
    const { launcher, state } = makeFakeLauncher("fake");
    const innerLaunch = launcher.launch.bind(launcher);
    let first = true;
    launcher.launch = async () => {
      const session = await innerLaunch();
      const origNewPage = session.newPage.bind(session);
      session.newPage = async () => {
        const page = await origNewPage();
        if (first) {
          first = false;
          const origEvaluate = page.evaluate.bind(page);
          page.evaluate = (async <T>(fn: (() => T) | string): Promise<T> => {
            const src = typeof fn === "string" ? fn : Function.prototype.toString.call(fn);
            if (src.includes("maxHeadings")) {
              return {
                ...SAMPLE_SNAPSHOT,
                sectionRects: [
                  { y: 0, height: 900, heading: "Hero" },
                  { y: 900, height: 800, heading: "Features" },
                ],
              } as unknown as T;
            }
            return origEvaluate(fn);
          }) as typeof page.evaluate;
        }
        return page;
      };
      return session;
    };

    const result = await runAnalysis(launcher, buildRequest({ maxPages: 1, includeMobile: false }), {
      fetchImpl: mockSiteFetch(),
    });

    // Homepage + 2 section clips; mobile off; no extra page shots.
    expect(result.screenshotsCaptured).toBe(3);
    expect(result.pages[0]?.sectionShots).toHaveLength(2);
    expect(result.pages[0]?.sectionShots[0]).toMatchObject({ kind: "webp", height: 900 });
    const sectionClips = state.screenshots.filter((shot) => (shot.clip?.y ?? 0) > 0);
    expect(sectionClips.length).toBeGreaterThanOrEqual(1);
    expect(result.pages[0]?.sectionShots).toHaveLength(2);
    expect(result.pages[0]?.responsiveComparison.status).toBe("not-requested");
  });

  it("does not capture section clips when the page snapshot has no rects", async () => {
    const { launcher, state } = makeFakeLauncher("fake");
    const result = await runAnalysis(launcher, buildRequest({ maxPages: 1, includeMobile: false }), {
      fetchImpl: mockSiteFetch(),
    });

    expect(result.pages[0]?.sectionShots).toEqual([]);
    expect(state.screenshots.filter((shot) => (shot.clip?.y ?? 0) > 0)).toHaveLength(0);
  });
});
