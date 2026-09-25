import { ALLOWED_PORTS, ALLOWED_PROTOCOLS, LIMITS } from "../config/limits";
import { isBlockedHostname } from "../validation/hostnames";
import { isBlockedIpLiteral } from "../validation/ip";
import { collectPageSnapshot, type PageSnapshot } from "./snapshot-script";
import type { BrowserPage, WaitUntil } from "./types";

export interface CaptureOptions {
  url: string;
  viewportWidth: number;
  timeoutMs?: number;
  waitUntil?: WaitUntil;
  maxHeightPx?: number;
  quality?: number;
  maxBytes?: number;
  captureScreenshot?: boolean;
  /** Homepage only: section-clipped screenshots from snapshot.sectionRects. */
  maxSectionShots?: number;
}

export type ScreenshotKind = "webp" | "jpeg" | "png";

export interface SectionShot {
  kind: ScreenshotKind;
  bytes: number;
  y: number;
  height: number;
  heading: string;
  data: Uint8Array;
}

export interface CaptureResult {
  snapshot: PageSnapshot;
  screenshot: Uint8Array | null;
  screenshotBytes: number;
  screenshotKind: ScreenshotKind | null;
  sectionShots: SectionShot[];
  pageHeightPx: number;
  warnings: string[];
}

function toBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

export function clampTimeout(value: number | undefined): number {
  const fallback = LIMITS.perPageNavigationTimeoutMs;
  if (value === undefined) return fallback;
  return Math.min(Math.max(value, 1_000), LIMITS.perPageNavigationTimeoutMs);
}

/**
 * Fail-closed static check on the post-navigation URL (CF02): the browser
 * follows redirects, so an unparseable, private-literal, or blocked-hostname
 * landing URL throws before any extraction output is trusted. Cross-host
 * public redirects pass this layer and are revalidated via DoH by the
 * pipeline (`assertPublicTarget`), per "reject again after redirects".
 */
export function assertSafeFinalUrl(snapshot: PageSnapshot): void {
  let parsed: URL;
  try {
    parsed = new URL(snapshot.url);
  } catch {
    throw new Error(`Unparseable post-navigation URL blocked: ${snapshot.url}`);
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname.length === 0) {
    throw new Error("Empty post-navigation hostname blocked.");
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Redirect to a disallowed protocol stopped: ${parsed.protocol}.`);
  }
  if (!ALLOWED_PORTS.has(parsed.port)) {
    throw new Error(`Redirect to a disallowed port stopped: ${parsed.port}.`);
  }
  if (isBlockedIpLiteral(hostname) || isBlockedHostname(hostname)) {
    throw new Error(`Redirect to a blocked target stopped: ${hostname}.`);
  }
}

async function evaluateWithTimeout<T>(page: BrowserPage, fn: () => T, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`In-browser extraction timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([page.evaluate<T>(toInPageScript(fn)), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Serializes an in-page function to a self-contained script (Trap 5).
 *
 * Bundlers (esbuild via tsx/wrangler with keepNames) rewrite const-assigned
 * arrows as `__name(arrow, "name")`. A bare function reference would carry
 * those calls into the page where `__name` is undefined (ReferenceError), so
 * every evaluation ships as a string: an identity shim that resolves any
 * injected `__name(...)` wrappers, followed by the function invoked as an
 * IIFE. `__name(fn, name)` semantically returns `fn`, so the shim is exact.
 */
export function toInPageScript(fn: () => unknown): string {
  return `var __name=function(f){return f};(${fn.toString()})()`;
}

export async function capturePage(
  page: BrowserPage,
  options: CaptureOptions,
): Promise<CaptureResult> {
  const timeoutMs = clampTimeout(options.timeoutMs);
  const quality = options.quality ?? LIMITS.screenshotQuality;
  const maxHeightPx = options.maxHeightPx ?? LIMITS.maxScreenshotHeightPx;
  const maxBytes = options.maxBytes ?? LIMITS.maxTotalScreenshotBytes;
  const warnings: string[] = [];

  await page.setViewport({
    width: options.viewportWidth,
    height: 900,
    deviceScaleFactor: LIMITS.deviceScaleFactor,
  });

  // Slow, tracker-heavy pages (e.g. Shopify with 90+ scripts) may never reach
  // network idle: on a navigation *timeout*, fall back once to domcontentloaded
  // so slow sites yield a partial report instead of a 502. Non-timeout errors
  // (refused, blocked, DNS) rethrow immediately.
  const waitUntil = options.waitUntil ?? "networkidle2";
  try {
    await page.goto(options.url, { waitUntil, timeout: timeoutMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (waitUntil !== "domcontentloaded" && /timeout|exceeded/i.test(message)) {
      warnings.push(
        `Navigation with ${waitUntil} timed out after ${timeoutMs}ms; retried with domcontentloaded.`,
      );
      await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    } else {
      throw error;
    }
  }

  const pageHeightPx = await page.evaluate<number>(toInPageScript(async () => {
    const docHeight = (): number =>
      Math.max(
        document.body?.scrollHeight ?? 0,
        document.documentElement?.scrollHeight ?? 0,
        window.innerHeight,
      );
    const viewport = Math.max(window.innerHeight, 1);
    const pause = (ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });

    // Pass 1: paced scroll in 0.8-viewport bands. Long pauses are essential:
    // scroll-triggered reveals (fade/slide-in), lazy images, and background
    // images only start *and finish* during a painted band, so fast scrolling
    // yields a half-empty capture. Bounded to <= 40 bands x 350ms (~14s).
    // Media-heavy pages (video/canvas heroes) hydrate late: they earn a
    // longer bottom pause plus a longer top settle below. Plain pages pay
    // nothing extra.
    const hasMedia = (() => {
      try {
        return (
          document.querySelectorAll("video").length > 0 || document.querySelectorAll("canvas").length > 0
        );
      } catch {
        return false;
      }
    })();
    const step = Math.floor(viewport * 0.8);
    let y = 0;
    let bands = 0;
    while (y < docHeight() && bands < 40) {
      window.scrollTo(0, y);
      await pause(350);
      y += step;
      bands += 1;
    }
    window.scrollTo(0, docHeight());
    await pause(hasMedia ? 2000 : 500);

    // Pass 2: wait for images to finish decoding (<= 12 x 300ms).
    const images = Array.from(document.images || []);
    for (let pass = 0; pass < 12; pass += 1) {
      const pending = images.some(
        (img) => !img.complete || (img.naturalWidth === 0 && Boolean(img.currentSrc)),
      );
      if (!pending) break;
      await pause(300);
    }

    // Pass 2b: fonts plus video first-frames. WebGL/canvas heroes and video
    // backgrounds otherwise capture as wireframes or flat color. Cost is
    // conditional: fonts.ready usually resolves instantly, and the video
    // loop is skipped entirely when the page has no videos (<= 10 x 250ms).
    try {
      const fontsReady = document.fonts?.ready;
      if (fontsReady && typeof (fontsReady as Promise<unknown>).then === "function") {
        await Promise.race([fontsReady, pause(1500)]);
      }
    } catch {
      // Font loading API unavailable; continue to capture.
    }
    const videos = Array.from(document.querySelectorAll("video") || []);
    if (videos.length > 0) {
      for (let pass = 0; pass < 10; pass += 1) {
        const pending = videos.some((video) => {
          try {
            const src = video.currentSrc || video.getAttribute("src") || "";
            return Boolean(src) && video.readyState < 2;
          } catch {
            return false;
          }
        });
        if (!pending) break;
        await pause(250);
      }
    }

    // Pass 3: return to the top and let entry animations settle before capture.
    window.scrollTo(0, 0);
    await pause(hasMedia ? 1500 : 900);
    return docHeight();
  }));

  const snapshot = await evaluateWithTimeout(
    page,
    collectPageSnapshot,
    LIMITS.perPageExtractionBudgetMs,
  );

  // Static fail-closed check on the post-navigation URL. Cross-host public
  // redirects are allowed here; the pipeline revalidates them via DoH.
  assertSafeFinalUrl(snapshot);

  if (pageHeightPx > maxHeightPx) {
    warnings.push(`Page height ${pageHeightPx}px exceeds the ${maxHeightPx}px cap; screenshot clipped.`);
  }
  const clipHeight = Math.min(pageHeightPx, maxHeightPx);

  const shotOptions = {
    quality,
    clip: { x: 0, y: 0, width: options.viewportWidth, height: clipHeight },
    captureBeyondViewport: true,
  };

  let screenshot: Uint8Array | null = null;
  let screenshotKind: ScreenshotKind | null = null;

  if (options.captureScreenshot !== false) {
    for (const type of ["webp", "jpeg"] as const) {
      try {
        const buffer = await page.screenshot({ type, ...shotOptions });
        screenshot = toBytes(buffer);
        screenshotKind = type;
        break;
      } catch {
        warnings.push(`Screenshot as ${type} failed.`);
      }
    }
  }

  if (screenshot && screenshot.byteLength > maxBytes) {
    warnings.push(
      `Screenshot of ${screenshot.byteLength} bytes exceeds the ${maxBytes} byte cap; dropped.`,
    );
    screenshot = null;
    screenshotKind = null;
  }

  // Section-clipped screenshots (PRD screenshot policy): homepage only,
  // bounded by maxSectionShots (6) and the remaining byte budget. Chromium
  // encodes each clip; the Worker never transforms the bytes.
  const sectionShots: SectionShot[] = [];
  if (
    screenshotKind &&
    options.maxSectionShots !== undefined &&
    options.maxSectionShots > 0 &&
    (snapshot.sectionRects ?? []).length > 0
  ) {
    let budget = maxBytes - (screenshot?.byteLength ?? 0);
    const cap = Math.min(options.maxSectionShots ?? 0, LIMITS.maxSectionScreenshots);
    for (const rect of snapshot.sectionRects ?? []) {
      if (sectionShots.length >= cap || budget <= 0) break;
      const clipY = Math.min(rect.y, clipHeight - 1);
      const clipH = Math.min(rect.height, clipHeight - clipY);
      if (clipH < 50) continue;
      let taken: Uint8Array | null = null;
      let takenKind: ScreenshotKind | null = null;
      const fallbackTypes: ScreenshotKind[] = Array.from(
        new Set<ScreenshotKind>([screenshotKind ?? "webp", "jpeg"]),
      );
      for (const type of fallbackTypes) {
        try {
          const buffer = await page.screenshot({
            type,
            quality,
            clip: { x: 0, y: clipY, width: options.viewportWidth, height: clipH },
            captureBeyondViewport: true,
          });
          taken = toBytes(buffer);
          takenKind = type;
          break;
        } catch {
          warnings.push(`Section screenshot at y=${rect.y} as ${type} failed.`);
        }
      }
      if (taken && takenKind && taken.byteLength <= budget) {
        sectionShots.push({ kind: takenKind, bytes: taken.byteLength, y: rect.y, height: rect.height, heading: rect.heading, data: taken });
        budget -= taken.byteLength;
      } else if (taken) {
        warnings.push(`Section screenshot at y=${rect.y} dropped: byte budget exhausted.`);
        break;
      }
    }
  }

  return {
    snapshot,
    screenshot,
    screenshotBytes: screenshot?.byteLength ?? 0,
    screenshotKind,
    sectionShots,
    pageHeightPx,
    warnings,
  };
}
