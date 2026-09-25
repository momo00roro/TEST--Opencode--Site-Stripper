import { describe, expect, it } from "vitest";
import { assertSafeFinalUrl, capturePage, clampTimeout, toInPageScript } from "../src/browser/capture";
import { collectPageSnapshot } from "../src/browser/snapshot-script";
import type { BrowserPage, GotoOptions } from "../src/browser/types";
import { makeFakePage, SAMPLE_SNAPSHOT } from "./helpers";

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
    const { page } = makeFakePage({ bytes: 10 * 1024 * 1024 });
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
