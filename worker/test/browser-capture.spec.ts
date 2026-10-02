import { describe, expect, it } from "vitest";
import { assertSafeFinalUrl, awaitVideoPlayer, autoplayVideoScript, capturePage, clampTimeout, dismissVideoPlayer, ensureLazyMediaLoaded, facadeClickScript, facadeClickTarget, pageVideoCarouselScript, renderIsolatedVideoShot, toInPageScript } from "../src/browser/capture";
import { collectPageSnapshot } from "../src/browser/snapshot-script";
import type { BrowserPage, GotoOptions } from "../src/browser/types";
import { makeFakePage, SAMPLE_SNAPSHOT } from "./helpers";
import { LIMITS } from "../src/config/limits";

describe("clampTimeout", () => {
  it("defaults, floors, and caps the timeout", () => {
    expect(clampTimeout(undefined)).toBe(12_000);
    expect(clampTimeout(10)).toBe(1_000);
    expect(clampTimeout(99_999)).toBe(12_000);
    expect(clampTimeout(5_000)).toBe(5_000);
  });
});

describe("capturePage", () => {
  it("sets the viewport, navigates, scrolls, and captures webp", async () => {
    const { page, state } = makeFakePage({ height: 3000, bytes: 2048 });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440 });

    expect(state.viewports[0]).toEqual({ width: 1440, height: 900, deviceScaleFactor: 1 });
    expect(state.gotos[0]?.url).toBe("https://example.com/");
    expect(state.gotos[0]?.options?.timeout).toBe(12_000);
    expect(state.scrolls).toBe(1);
    expect(state.screenshots[0]?.type).toBe("webp");
    expect(state.screenshots[0]?.clip?.height).toBe(3000);
    expect(result.screenshotKind).toBe("webp");
    expect(result.screenshotBytes).toBe(2048);
    expect(result.snapshot.title).toBe("Example");
    expect(result.warnings).toEqual([]);
  });

  it("falls back to jpeg when webp fails", async () => {
    const { page, state } = makeFakePage({ failTypes: ["webp"] });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 390 });

    expect(state.screenshots.map((shot) => shot.type)).toEqual(["webp", "jpeg"]);
    expect(result.screenshotKind).toBe("jpeg");
    expect(result.warnings.some((warning) => warning.includes("webp"))).toBe(true);
  });

  it("retries a networkidle timeout with domcontentloaded", async () => {
    const { page, state } = makeFakePage();
    let calls = 0;
    const slowPage = {
      ...page,
      goto: (async (url: string, gotoOptions?: GotoOptions) => {
        calls += 1;
        state.gotos.push({ url, options: gotoOptions });
        if (calls === 1) throw new Error("Navigation timeout of 12000 ms exceeded");
        return null;
      }) as BrowserPage["goto"],
    };

    const result = await capturePage(slowPage, { url: "https://example.com/", viewportWidth: 1440 });

    expect(state.gotos.map((g) => g.options?.waitUntil)).toEqual(["networkidle2", "domcontentloaded"]);
    expect(result.snapshot.title).toBe("Example");
    expect(result.warnings.some((w) => w.includes("domcontentloaded"))).toBe(true);
  });

  it("rethrows non-timeout navigation errors without retrying", async () => {
    const { page, state } = makeFakePage();
    const deadPage = {
      ...page,
      goto: (async (url: string, gotoOptions?: GotoOptions) => {
        state.gotos.push({ url, options: gotoOptions });
        throw new Error("net::ERR_CONNECTION_REFUSED");
      }) as BrowserPage["goto"],
    };

    await expect(
      capturePage(deadPage, { url: "https://example.com/", viewportWidth: 1440 }),
    ).rejects.toThrow(/ERR_CONNECTION_REFUSED/);
    expect(state.gotos).toHaveLength(1);
  });

  it("drops an oversized screenshot", async () => {
    const { page } = makeFakePage({ bytes: LIMITS.maxTotalScreenshotBytes + 1024 });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440 });

    expect(result.screenshot).toBeNull();
    expect(result.screenshotKind).toBeNull();
    expect(result.warnings.some((warning) => warning.includes("exceeds"))).toBe(true);
  });

  it("clips tall pages to the height cap", async () => {
    const { page, state } = makeFakePage({ height: 20_000 });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440 });

    expect(state.screenshots[0]?.clip?.height).toBe(16_000);
    expect(result.pageHeightPx).toBe(20_000);
    expect(result.warnings.some((warning) => warning.includes("cap"))).toBe(true);
  });

  it("returns no screenshot when every format fails", async () => {
    const { page } = makeFakePage({ failTypes: ["webp", "jpeg"] });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440 });

    expect(result.screenshot).toBeNull();
    expect(result.warnings).toHaveLength(2);
  });

  it("stops a landing URL on a private IP literal", async () => {
    const { page } = makeFakePage();
    const loopback = { ...SAMPLE_SNAPSHOT, url: "http://127.0.0.1/" };
    const redirected = {
      ...page,
      evaluate: (async <T>(fn: (() => T) | string): Promise<T> => {
        const src = typeof fn === "string" ? fn : Function.prototype.toString.call(fn);
        if (src.includes("maxHeadings")) return loopback as unknown as T;
        return 4000 as unknown as T;
      }) as BrowserPage["evaluate"],
    };

    await expect(
      capturePage(redirected, { url: "https://example.com/", viewportWidth: 1440 }),
    ).rejects.toThrow(/blocked target/);
  });

  it("stops a landing URL on a blocked hostname", async () => {
    const { page } = makeFakePage();
    const internal = { ...SAMPLE_SNAPSHOT, url: "http://localhost/" };
    const redirected = {
      ...page,
      evaluate: (async <T>(fn: (() => T) | string): Promise<T> => {
        const src = typeof fn === "string" ? fn : Function.prototype.toString.call(fn);
        if (src.includes("maxHeadings")) return internal as unknown as T;
        return 4000 as unknown as T;
      }) as BrowserPage["evaluate"],
    };

    await expect(
      capturePage(redirected, { url: "https://example.com/", viewportWidth: 1440 }),
    ).rejects.toThrow(/blocked target/);
  });

  it("re-samples headings when rotation detection is enabled", async () => {
    const { page } = makeFakePage({ headingTexts: [{ label: "h1[0]", text: "Changed" }] });
    const result = await capturePage(page, {
      url: "https://example.com/",
      viewportWidth: 1440,
      detectRotationMs: 5,
    });

    expect(result.rotationChecked).toBe(true);
    expect(result.rotatingText).toEqual([{ label: "h1[0]", before: "Hi", after: "Changed" }]);
  });

  it("leaves rotation unchecked by default", async () => {
    const { page } = makeFakePage({ headingTexts: [{ label: "h1[0]", text: "Changed" }] });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440 });

    expect(result.rotationChecked).toBe(false);
    expect(result.rotatingText).toEqual([]);
  });

  it("paces the pre-capture scroll so lazy content can load", async () => {
    const { page } = makeFakePage();
    const seen: string[] = [];
    const probing = {
      ...page,
      evaluate: (async <T>(fn: (() => T) | string): Promise<T> => {
        const src = typeof fn === "string" ? fn : Function.prototype.toString.call(fn);
        seen.push(src);
        return page.evaluate(fn);
      }) as BrowserPage["evaluate"],
    };

    await capturePage(probing, { url: "https://example.com/", viewportWidth: 1440 });

    const scrollSrc = seen.find((src) => src.includes("scrollTo")) ?? "";
    // Pauses between viewport bands let IntersectionObservers fire; a tight
    // synchronous loop would leave below-fold lazy content blank.
    expect(scrollSrc).toContain("setTimeout");
    // Fonts and video first-frames settle before capture so WebGL heroes
    // and video backgrounds do not freeze as wireframes or flat color.
    expect(scrollSrc).toContain("fonts");
    expect(scrollSrc).toContain("readyState");
    // Media-heavy pages earn a longer bottom pause and top settle; plain
    // pages pay nothing extra.
    expect(scrollSrc).toContain("hasMedia");
    // Image-heavy pages (lazy CDN batches invisible to document.images)
    // earn the same long settle so card grids do not shoot blank.
    expect(scrollSrc).toContain("hasManyImages");
  });

  it("warns when lazy images are still unloaded at capture", async () => {
    const { page } = makeFakePage({ lazySweep: { settled: 3, pending: 2 } });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440 });

    expect(result.warnings.some((warning) => warning.includes("2 image(s) were still unloaded"))).toBe(true);
  });

  it("stays quiet when every lazy image settled", async () => {
    const { page } = makeFakePage({ lazySweep: { settled: 4, pending: 0 } });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440 });

    expect(result.warnings).toEqual([]);
  });

  it("calls out images that failed to load, not just slow ones", async () => {
    const { page } = makeFakePage({ lazySweep: { settled: 1, pending: 3, failed: 2 } });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440 });

    expect(result.warnings.some((warning) => warning.includes("3 image(s) were still unloaded"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("2 failed to load"))).toBe(true);
  });

  it("warns when videos have no playable frame at capture", async () => {
    const { page } = makeFakePage({ lazySweep: { settled: 0, pending: 0, videosPending: 2 } });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440 });

    expect(result.warnings.some((warning) => warning.includes("2 video(s) had no playable frame"))).toBe(true);
  });

  it("captures playing-state clips for click-to-play facades when requested", async () => {
    const { page, state } = makeFakePage({
      videoTarget: { status: "target", x: 720, y: 500, label: "Demo" },
      videoPlayer: { started: true, x: 0, y: 100, width: 800, height: 450 },
      facadeCount: 2,
    });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440, maxVideoShots: 2 });

    expect(result.videoShots).toHaveLength(2);
    expect(result.videoShots[0]).toMatchObject({ kind: "webp", y: 100, height: 450, heading: "video: Demo" });
    expect(result.videoShots[0]?.data).toBeInstanceOf(Uint8Array);
    expect(result.warnings).toEqual([]);
    expect(state.screenshots.filter((shot) => shot.clip && shot.clip.y === 100)).toHaveLength(2);
    // Trusted clicks land on the facade centers reported in-page.
    expect(state.clicks).toEqual([{ x: 720, y: 500 }, { x: 720, y: 500 }]);
    // Each clip is followed by a trusted Escape to dismiss the player.
    expect(state.keys).toEqual(["Escape", "Escape"]);
  });

  it("clips scroll-autoplay facades without clicking or dismissing", async () => {
    const { page, state } = makeFakePage({
      videoTarget: { status: "target", x: 720, y: 500, label: "Demo" },
      autoplayPlayer: { started: true, x: 0, y: 100, width: 800, height: 450 },
      videoPlayer: { started: false, x: 0, y: 0, width: 0, height: 0 },
      facadeCount: 2,
    });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440, maxVideoShots: 2 });

    expect(result.videoShots).toHaveLength(2);
    expect(result.videoShots[0]).toMatchObject({ kind: "webp", y: 100, height: 450, heading: "video: Demo" });
    expect(result.warnings).toEqual([]);
    // Autoplay-first: no trusted clicks, no Escape dismissals — the inline
    // player was caught playing, so no modal was ever opened.
    expect(state.clicks).toEqual([]);
    expect(state.keys).toEqual([]);
  });

  it("falls back to click-to-play when autoplay never starts", async () => {
    const { page, state } = makeFakePage({
      videoTarget: { status: "target", x: 720, y: 500, label: "Demo" },
      autoplayPlayer: { started: false, x: 0, y: 0, width: 0, height: 0 },
      videoPlayer: { started: true, x: 0, y: 100, width: 800, height: 450 },
    });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440, maxVideoShots: 1 });

    expect(result.videoShots).toHaveLength(1);
    expect(state.clicks).toEqual([{ x: 720, y: 500 }]);
    expect(state.keys).toEqual(["Escape"]);
  });

  it("captures muted force-play native videos after facades run dry (CF28)", async () => {
    const { page, state } = makeFakePage({
      facadeCount: 0,
      nativeVideoAt: {
        0: { status: "target", started: true, x: 720, y: 600, width: 800, height: 450, label: "Hero loop", streamUrl: "https://example.com/hero.mp4", rectY: 900, rectHeight: 450, rectX: 320, rectWidth: 800, uid: "native-0" },
        1: { status: "target", started: true, x: 720, y: 1500, width: 640, height: 400, label: "Showcase", streamUrl: "https://example.com/show.mp4", rectY: 2400, rectHeight: 400, rectX: 400, rectWidth: 640, uid: "native-1" },
      },
    });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440, maxVideoShots: 4 });

    expect(result.videoShots).toHaveLength(2);
    expect(result.videoShots[0]).toMatchObject({ kind: "webp", heading: "video: Hero loop", placement: { x: 320, y: 900, width: 800, height: 450 } });
    expect(result.videoShots[1]).toMatchObject({ heading: "video: Showcase" });
    expect(result.warnings.some((warning) => warning.includes("native video(s) captured playing-state"))).toBe(true);
    // Native force-play needs no trusted clicks and no Escape dismissals.
    expect(state.clicks).toEqual([]);
    expect(state.keys).toEqual([]);
  });

  it("skips native videos whose stream a facade already deferred (CF28)", async () => {
    const streamUrl = "https://player.vimeo.com/video/1202887330?autoplay=1&muted=1";
    const { page, state } = makeFakePage({
      videoTargetAt: {
        0: { status: "target", x: 720, y: 500, label: "Demo", streamUrl, rectY: 2000, rectHeight: 765, rectX: 100, rectWidth: 348 },
      },
      facadeCount: 1,
      autoplayPlayer: { started: false, x: 0, y: 0, width: 0, height: 0 },
      nativeVideoAt: {
        0: { status: "target", started: true, x: 720, y: 600, width: 800, height: 450, label: "Demo", streamUrl, rectY: 2000, rectHeight: 765, rectX: 100, rectWidth: 348, uid: "native-0" },
      },
    });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440, maxVideoShots: 4 });

    expect(result.pendingVideoStreams).toHaveLength(1);
    expect(result.videoShots).toEqual([]);
    expect(state.clicks).toEqual([]);
  });

  it("defers stream-resolvable facades to isolated render instead of clicking", async () => {
    const card = (index: number, id: number) => ({
      status: "target",
      x: 720,
      y: 500,
      label: index === 0 ? "Demo" : `Demo ${index + 1}`,
      streamUrl: `https://player.vimeo.com/video/${id}?autoplay=1&muted=1`,
      rectY: 2000 + index * 800,
      rectHeight: 765,
      rectX: 100,
      rectWidth: 348,
    });
    const { page, state } = makeFakePage({
      // Distinct streams per index: identical URLs would correctly dedup.
      videoTargetAt: { 0: card(0, 1202887330), 1: card(1, 1202887331) },
      autoplayPlayer: { started: false, x: 0, y: 0, width: 0, height: 0 },
      // Would boot a white modal if clicked: the click must be skipped.
      videoPlayer: { started: true, x: 0, y: 100, width: 800, height: 450 },
      facadeCount: 2,
    });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440, maxVideoShots: 2 });

    expect(result.videoShots).toEqual([]);
    expect(result.pendingVideoStreams).toHaveLength(2);
    expect(result.pendingVideoStreams[0]).toMatchObject({ label: "Demo", rectY: 2000, rectHeight: 765 });
    expect(result.pendingVideoStreams[0]?.streamUrl).toContain("player.vimeo.com/video/1202887330");
    expect(state.clicks).toEqual([]);
    expect(state.keys).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("warns on facades that never boot a player", async () => {
    const { page, state } = makeFakePage({
      videoTarget: { status: "target", x: 720, y: 500, label: "Stuck" },
      videoPlayer: { started: false, x: 0, y: 0, width: 0, height: 0 },
      facadeCount: 2,
    });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440, maxVideoShots: 2 });

    expect(result.videoShots).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("2 video(s) did not start (autoplay, click-to-play, or native force-play)"))).toBe(true);
    expect(state.clicks).toHaveLength(2);
  });

  it("pages the carousel for freshly hydrated facades", async () => {
    const card = (uid: string, label: string) => ({
      status: "target",
      x: 720,
      y: 500,
      label,
      streamUrl: `https://player.vimeo.com/video/${uid}?autoplay=1&muted=1`,
      uid,
      rectY: 3284,
      rectHeight: 435,
      rectX: 100,
      rectWidth: 348,
    });
    const { page, state } = makeFakePage({
      // DOM state 1: one card; then dry; after the page-turn the grid
      // re-renders with the old card (same uid) plus a fresh one.
      facadeSequence: [card("ss1", "A"), null, card("ss1", "A"), card("ss7", "G"), null],
      carouselNexts: [{ x: 1300, y: 3500 }],
      autoplayPlayer: { started: false, x: 0, y: 0, width: 0, height: 0 },
      facadeCount: 2,
    });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440, maxVideoShots: 4 });

    expect(result.pendingVideoStreams.map((shot) => shot.label)).toEqual(["A", "G"]);
    // Only the pager click happened; stream facades are never player-clicked.
    expect(state.clicks).toEqual([{ x: 1300, y: 3500 }]);
    expect(state.keys).toEqual([]);
    expect(result.warnings).toEqual(["Paged the video carousel 1 time(s); 2 video facade(s) processed in total."]);
  }, 20_000);

  it("bounds carousel page-turns", async () => {
    // Each turn surfaces one fresh-but-unstartable dud (no stream, never
    // boots): the loop must stop at the turn bound, not the guard. A dry
    // rescan stops even earlier (see the loop-back test below).
    const dud = (uid: string) => ({ status: "target", x: 720, y: 500, label: `Dud ${uid}`, uid });
    const { page, state } = makeFakePage({
      facadeSequence: [null, dud("u1"), null, dud("u2"), null, dud("u3"), null, dud("u4")],
      carouselNexts: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }],
      autoplayPlayer: { started: false, x: 0, y: 0, width: 0, height: 0 },
      videoPlayer: { started: false, x: 0, y: 0, width: 0, height: 0 },
    });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440, maxVideoShots: 4 });

    expect(state.clicks.filter((click) => click.x !== 720)).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
    expect(result.videoShots).toEqual([]);
    expect(result.pendingVideoStreams).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("3 video(s) did not start"))).toBe(true);
  }, 30_000);

  it("skips re-rendered facades with already-deferred streams", async () => {
    // A carousel page-turn replaces DOM nodes (fresh uids) for identical
    // content: stream identity must dedup, or the same URLs defer forever,
    // throttling the player CDN and blowing the wall budget.
    const dup = (uid: string) => ({
      status: "target",
      x: 720,
      y: 500,
      label: "Same",
      streamUrl: "https://player.vimeo.com/video/9?autoplay=1&muted=1",
      uid,
      rectY: 3000,
      rectHeight: 435,
      rectX: 100,
      rectWidth: 348,
    });
    const { page, state } = makeFakePage({
      facadeSequence: [dup("ss1"), dup("ss2")],
      autoplayPlayer: { started: false, x: 0, y: 0, width: 0, height: 0 },
      facadeCount: 2,
    });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440, maxVideoShots: 4 });

    expect(result.pendingVideoStreams).toHaveLength(1);
    expect(state.clicks).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("stops paging when a turn yields nothing new", async () => {
    const card = (uid: string) => ({
      status: "target",
      x: 720,
      y: 500,
      label: "A",
      streamUrl: "https://player.vimeo.com/video/1?autoplay=1&muted=1",
      uid,
      rectY: 3000,
      rectHeight: 435,
      rectX: 100,
      rectWidth: 348,
    });
    const { page, state } = makeFakePage({
      facadeSequence: [card("ss1"), null, card("ss1"), null],
      carouselNexts: [{ x: 1300, y: 3500 }, { x: 1301, y: 3501 }, { x: 1302, y: 3502 }],
      autoplayPlayer: { started: false, x: 0, y: 0, width: 0, height: 0 },
    });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440, maxVideoShots: 4 });

    // One turn, then the loop-back rescan finds only the seen card: no more
    // turns burned on a looping carousel.
    expect(state.clicks).toEqual([{ x: 1300, y: 3500 }]);
    expect(result.pendingVideoStreams.map((shot) => shot.label)).toEqual(["A"]);
    expect(result.warnings).toEqual(["Paged the video carousel 1 time(s); 1 video facade(s) processed in total."]);
  }, 20_000);

  it("warns about facades beyond the clip cap instead of dropping them silently", async () => {
    const { page } = makeFakePage({
      videoTarget: { status: "target", x: 720, y: 500, label: "Demo" },
      autoplayPlayer: { started: true, x: 0, y: 100, width: 800, height: 450 },
      // Unbounded facades (default): the cap fills and more remain.
    });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440, maxVideoShots: 2 });

    expect(result.videoShots).toHaveLength(2);
    expect(result.warnings.some((warning) => warning.includes("beyond the 2-clip cap"))).toBe(true);
  });

  it("stops quietly when no facades remain", async () => {
    const { page, state } = makeFakePage({
      videoTarget: { status: "none", x: 0, y: 0, label: "" },
    });
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440, maxVideoShots: 4 });

    expect(result.videoShots).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(state.clicks).toEqual([]);
  });

  it("takes no video clips unless maxVideoShots is set", async () => {
    const { page, state } = makeFakePage({
      videoTarget: { status: "target", x: 720, y: 500, label: "Demo" },
      videoPlayer: { started: true, x: 0, y: 100, width: 800, height: 450 },
    });
    const before = state.screenshots.length;
    const result = await capturePage(page, { url: "https://example.com/", viewportWidth: 1440 });

    expect(result.videoShots).toEqual([]);
    expect(state.screenshots.length).toBe(before + 1);
    expect(state.clicks).toEqual([]);
  });

  it("lets a cross-host public redirect through to pipeline DoH revalidation", async () => {
    const { page } = makeFakePage();
    const evil = { ...SAMPLE_SNAPSHOT, url: "https://evil.example/" };
    const redirected = {
      ...page,
      evaluate: (async <T>(fn: (() => T) | string): Promise<T> => {
        const src = typeof fn === "string" ? fn : Function.prototype.toString.call(fn);
        if (src.includes("maxHeadings")) return evil as unknown as T;
        return 4000 as unknown as T;
      }) as BrowserPage["evaluate"],
    };

    // Static layer passes; runAnalysis revalidates via DoH and records a page issue.
    const result = await capturePage(redirected, { url: "https://example.com/", viewportWidth: 1440 });
    expect(result.snapshot.url).toBe("https://evil.example/");
  });

  it("times out a hung in-page extraction", async () => {
    const { page } = makeFakePage();
    const hanging = {
      ...page,
      evaluate: (<T>(fn: (() => T) | string): Promise<T> => {
        const src = typeof fn === "string" ? fn : Function.prototype.toString.call(fn);
        if (src.includes("maxHeadings")) return new Promise<T>(() => undefined);
        return Promise.resolve(4000 as unknown as T);
      }) as BrowserPage["evaluate"],
    };

    await expect(
      capturePage(hanging, { url: "https://example.com/", viewportWidth: 1440, timeoutMs: 5000 }),
    ).rejects.toThrow(/timed out/);
  });
});

describe("renderIsolatedVideoShot (CF22)", () => {
  const streamUrl = "https://player.vimeo.com/video/1202887330?autoplay=1&muted=1";

  it("returns a motion-verified frame and closes its tab", async () => {
    const { page, state } = makeFakePage({ variedShots: true, bytes: 2048 });
    let closed = 0;
    const session = {
      newPage: async () => ({ ...page, close: async () => { closed += 1; } }),
      close: async () => undefined,
    };

    const shot = await renderIsolatedVideoShot(session, streamUrl);

    expect(shot?.started).toBe(true);
    expect(shot?.kind).toBe("webp");
    expect(shot?.bytes).toBe(2048);
    expect(shot?.data).toBeInstanceOf(Uint8Array);
    expect(closed).toBe(1);
    expect(state.gotos[0]?.url).toBe(streamUrl);
  }, 20_000);

  it("rejects identical frames as gated, without emitting a clip", async () => {
    // Zero-filled screenshots: both frames identical, so no motion.
    const { page } = makeFakePage({ bytes: 2048 });
    let closed = 0;
    const session = {
      newPage: async () => ({ ...page, close: async () => { closed += 1; } }),
      close: async () => undefined,
    };

    const shot = await renderIsolatedVideoShot(session, streamUrl);

    expect(shot?.started).toBe(false);
    expect(closed).toBe(1);
  }, 20_000);

  it("catches slow-booting streams within the poll window", async () => {
    // First two frames static (saturated connection), then motion: a fixed
    // two-shot dwell would reject this stream; the adaptive poll catches it.
    const { page } = makeFakePage({ variedShots: true, staticShots: 2, bytes: 2048 });
    let closed = 0;
    const session = {
      newPage: async () => ({ ...page, close: async () => { closed += 1; } }),
      close: async () => undefined,
    };

    const shot = await renderIsolatedVideoShot(session, streamUrl);

    expect(shot?.started).toBe(true);
    expect(shot?.data).toBeInstanceOf(Uint8Array);
    expect(closed).toBe(1);
  }, 20_000);

  it("returns null when the isolated page cannot load, and still closes", async () => {
    const { page } = makeFakePage();
    const failing = { ...page, goto: async () => { throw new Error("blocked"); } };
    let closed = 0;
    const session = {
      newPage: async () => ({ ...failing, close: async () => { closed += 1; } }),
      close: async () => undefined,
    };

    expect(await renderIsolatedVideoShot(session, streamUrl)).toBeNull();
    expect(closed).toBe(1);
  });

  it("returns null when no tab can be opened", async () => {
    const session = {
      newPage: async () => { throw new Error("no tabs"); },
      close: async () => undefined,
    };

    expect(await renderIsolatedVideoShot(session, streamUrl)).toBeNull();
  });
});

describe("toInPageScript (Trap 5)", () => {
  it("ships evaluations as shimmed strings that parse standalone", () => {
    const script = toInPageScript(collectPageSnapshot);

    // The identity shim resolves transformer-injected __name(...) wrappers.
    expect(script.startsWith("var __name=")).toBe(true);
    expect(script).toContain("maxHeadings");
    // Parses without executing (no DOM available here); proves the exact
    // string sent to page.evaluate is syntactically valid.
    expect(() => new Function(script)).not.toThrow();
  });

  it("ships the lazy-media sweep as a self-contained parseable script", () => {
    const script = toInPageScript(ensureLazyMediaLoaded);

    expect(script.startsWith("var __name=")).toBe(true);
    // Forces un-started lazies into view; never relies on module scope.
    expect(script).toContain("scrollIntoView");
    expect(script).toContain("currentSrc");
    // Forces videos to a real paused frame for deterministic capture.
    expect(script).toContain("seeked");
    // Facade shadow roots host scroll-autoplay videos invisible to a
    // document-only query (figma-style vimeo-video components).
    expect(script).toContain("shadowRoot");
    // Boots lazy cross-origin player iframes (no script access possible).
    expect(script).toContain("iframe");
    expect(() => new Function(script)).not.toThrow();
  });

  it("ships autoplay-first catch as a self-contained parseable script", () => {
    const script = autoplayVideoScript(0);
    expect(script.startsWith("var __name=")).toBe(true);
    expect(() => new Function(script)).not.toThrow();
    // Same facade list as the click path so indices line up.
    expect(script).toContain("vimeo-video");
    expect(script).toContain("[data-video]");
    // Mock-backend routing: must not carry the shared scroll helper literal.
    expect(script).not.toContain("scrollIntoView");
    // Only playback overlapping the scrolled-to facade counts, so a hero
    // video never misattributes; the clock must actually advance.
    expect(script).toContain("currentTime");
    expect(script).toContain("readyState");
    expect(() => new Function(script)).not.toThrow();
    // Quick variant (stream known: probe cheaply, isolated tier renders).
    const quick = autoplayVideoScript(0, true);
    expect(quick).toContain("true");
    expect(quick).not.toContain("scrollIntoView");
    expect(() => new Function(quick)).not.toThrow();
  });

  it("ships the carousel pager as a self-contained parseable script", () => {
    const script = pageVideoCarouselScript();
    expect(script.startsWith("var __name=")).toBe(true);
    expect(() => new Function(script)).not.toThrow();
    // Aims at next-arrows serving video grids.
    expect(script).toContain("vimeo-video");
    expect(script).toContain("next");
    // Mock-backend routing: must not carry foreign markers or the shared
    // scroll helper literal.
    expect(script).not.toContain("scrollIntoView");
    expect(script).not.toContain("facadeClickTarget");
    expect(script).not.toContain("awaitVideoPlayer");
    expect(script).not.toContain("awaitAutoplayVideo");
  });

  it("ships click-to-play open/dismiss as self-contained parseable scripts", () => {
    const openScript = facadeClickScript(0);
    expect(openScript.startsWith("var __name=")).toBe(true);
    expect(() => new Function(openScript)).not.toThrow();
    // Facades only — native <video> toggling would undo the paused frame.
    expect(openScript).toContain("vimeo-video");
    expect(openScript).toContain("[data-video]");
    expect(openScript).not.toContain("scrollIntoView");
    const playerScript = toInPageScript(awaitVideoPlayer);
    expect(playerScript).toContain("youtube");
    expect(playerScript).not.toContain("scrollIntoView");
    // Watch-gated modals are rewritten to the stashed direct autoplay stream.
    expect(playerScript).toContain("__ssVideoStream");
    expect(playerScript).toContain("autoplay=1");
    expect(() => new Function(playerScript)).not.toThrow();
    // The stash step resolves player URLs from facade attributes.
    expect(facadeClickScript(0)).toContain("player.vimeo.com");
    const dismissScript = toInPageScript(dismissVideoPlayer);
    expect(dismissScript).toContain("Escape");
    expect(() => new Function(dismissScript)).not.toThrow();
  });
});

describe("assertSafeFinalUrl", () => {  it("allows same-host navigation", () => {
    expect(() =>
      assertSafeFinalUrl({ ...SAMPLE_SNAPSHOT, url: "https://example.com/b" }),
    ).not.toThrow();
  });

  it("allows http to https upgrades on the same host", () => {
    expect(() =>
      assertSafeFinalUrl({ ...SAMPLE_SNAPSHOT, url: "https://example.com/" }),
    ).not.toThrow();
  });

  it("rejects unparseable landing URLs", () => {
    expect(() => assertSafeFinalUrl({ ...SAMPLE_SNAPSHOT, url: ":::not a url" })).toThrow(
      /Unparseable/,
    );
  });

  it("rejects a landing URL on a disallowed port", () => {
    expect(() =>
      assertSafeFinalUrl({ ...SAMPLE_SNAPSHOT, url: "https://example.com:8443/" }),
    ).toThrow(/port/);
  });

  it("rejects a landing URL with a non-http(s) protocol", () => {
    expect(() => assertSafeFinalUrl({ ...SAMPLE_SNAPSHOT, url: "ftp://example.com/" })).toThrow(
      /protocol/,
    );
  });
});
