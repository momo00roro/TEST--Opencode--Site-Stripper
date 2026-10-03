import { ALLOWED_PORTS, ALLOWED_PROTOCOLS, LIMITS } from "../config/limits";
import { isBlockedHostname } from "../validation/hostnames";
import { isBlockedIpLiteral } from "../validation/ip";
import { collectPageSnapshot, collectHeadingTexts, diffRotatingText, labelSnapshotHeadings, type PageSnapshot, type SnapshotRotatingText } from "./snapshot-script";
import type { AnalysisSession, BrowserPage, WaitUntil } from "./types";

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
  /**
   * Homepage only: playing-state video captures. Facade elements
   * (`vimeo-video`, `[data-video]`, lite embeds) are tried autoplay-first
   * (scroll into view, clip when scroll-triggered playback starts) with a
   * trusted click-to-play fallback. Costs browser seconds — one page only.
   */
  maxVideoShots?: number;
  /**
   * Homepage only: rotation re-sample. When set, the worker waits this many
   * milliseconds after the snapshot, re-reads h1-h3 texts in-page, and diffs
   * them against the snapshot to catch rotating hero copy. Costs browser
   * seconds — one page only.
   */
  detectRotationMs?: number;
}

export type ScreenshotKind = "webp" | "jpeg" | "png";

export interface SectionShot {
  kind: ScreenshotKind;
  bytes: number;
  y: number;
  height: number;
  heading: string;
  data: Uint8Array;
  /**
   * On-page box a playing-state video frame belongs to (document coords).
   * The client compositor draws the frame here over blank video bands in
   * section screenshots. Absent on section shots and unplaced clips.
   */
  placement?: { x: number; y: number; width: number; height: number };
  /** Resolved stream URL the clip came from ("" when unresolved). */
  streamUrl?: string;
}

/**
 * CF29 Phase 0: per-phase wall-time attribution for one capturePage call.
 * Measurement only — no capture behavior depends on these numbers. This is
 * the "measure before optimize" step of the budget investigation: find where
 * the browser seconds actually go before changing anything.
 */
export interface CaptureTimings {
  /** Navigation goto, including any networkidle2 → domcontentloaded retry. */
  navMs: number;
  /** Pre-capture paced scroll / media settle / fonts / first-frame pass. */
  settleMs: number;
  /** DOM snapshot extraction. */
  snapshotMs: number;
  /** Homepage rotation re-sample delay (opt-in). */
  rotationMs: number;
  /** Lazy-media settle sweep (`ensureLazyMediaLoaded`). */
  lazySweepMs: number;
  /** Full-page screenshot encode. */
  fullPageShotMs: number;
  /** Section-clipped screenshots. */
  sectionShotsMs: number;
  /** Facade video pass, including carousel page-turns. */
  facadeVideoMs: number;
  /** Native `<video>` force-play pass (CF28) plus post-video probes. */
  nativeVideoMs: number;
  /** Stale-clip re-measures taken in the native pass (CF28 guard). */
  nativeRemasures: number;
  /**
   * Largest |scrollY delta| that tripped the stale-clip guard this capture
   * (px). Diagnostic for CF29 H2: distinguishes tiny smooth-scroll glide
   * from real wrong-band movement.
   */
  nativeRemasureMaxPx: number;
  /** Isolated video-tier renders (CF22); set by the pipeline, 0 here. */
  isolatedVideoMs: number;
  /** Total wall time inside this capturePage call. */
  totalMs: number;
}

export interface CaptureResult {
  snapshot: PageSnapshot;
  screenshot: Uint8Array | null;
  screenshotBytes: number;
  screenshotKind: ScreenshotKind | null;
  sectionShots: SectionShot[];
  /** Playing-state clips of video facades, autoplay-first (CF21). */
  videoShots: SectionShot[];
  /**
   * Facades with a resolvable direct player stream that never played on
   * scroll (CF22). The click path is skipped for these (it boots watch-URL
   * modals that stay white headless); the pipeline renders each stream in an
   * isolated player page instead, sequentially after this page closes.
   * rectY/rectHeight place the frame over the blank band in section shots.
   */
  pendingVideoStreams: Array<{ label: string; streamUrl: string; rectY: number; rectHeight: number; rectX: number; rectWidth: number }>;
  pageHeightPx: number;
  warnings: string[];
  rotatingText: SnapshotRotatingText[];
  rotationChecked: boolean;
  /** CF29 Phase 0 per-phase wall-time attribution. */
  timings: CaptureTimings;
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

async function evaluateWithTimeout<T>(page: BrowserPage, fn: (() => T) | string, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`In-browser extraction timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });
  try {
    const script = typeof fn === "string" ? fn : toInPageScript(fn);
    return await Promise.race([page.evaluate<T>(script), timeout]);
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

/**
 * Post-snapshot lazy-media sweep (self-contained: NO module-scope references,
 * literals only — ships via toInPageScript under Trap 5).
 *
 * Root cause (figma.com dogfood): below-fold lazy `<img>` elements that never
 * STARTED loading are invisible to the settle pass's readiness poll, which
 * only waits on images that already have a `currentSrc`. A paced band scroll
 * can pass over them faster than the site's lazy debounce, and once the
 * capture returns to the top Chrome deprioritizes far-from-viewport lazies
 * again — so the full-page shot shows blank card bands. Settling longer
 * cannot fix images that never started; they must be scrolled into view
 * explicitly and given a painted pause each.
 *
 * Runs AFTER the snapshot (extraction stays pristine) and BEFORE screenshots.
 * Bounded: at most 10 images (~2.5s worst each), 6 videos (~3s worst each),
 * and 6 iframes (~0.6s each) — typically 3-10s total, plain pages pay nothing.
 */
export function ensureLazyMediaLoaded(): Promise<{ settled: number; pending: number; failed: number; videosReady: number; videosPending: number }> {
  return (async () => {
    const empty = { settled: 0, pending: 0, failed: 0, videosReady: 0, videosPending: 0 };
    const pause = (ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    const isDone = (img: HTMLImageElement): boolean => {
      try {
        return img.complete;
      } catch {
        return true;
      }
    };
    // Complete but decoded zero pixels WITH a resolved source: the fetch
    // failed (blocked/slow CDN, bot-wall). No amount of waiting fixes those;
    // report them separately so the warning is honest.
    const isFailed = (img: HTMLImageElement): boolean => {
      try {
        return img.complete && img.naturalWidth === 0 && Boolean(img.currentSrc);
      } catch {
        return false;
      }
    };
    const scrollTo = (el: Element, block: string): void => {
      try {
        if (typeof el.scrollIntoView === "function") {
          (el as HTMLElement).scrollIntoView({ block: block as ScrollLogicalPosition, inline: "nearest" });
        } else {
          const rect = el.getBoundingClientRect();
          window.scrollTo(0, window.scrollY + rect.top - Math.floor(window.innerHeight / 2));
        }
      } catch {
        // Best effort: a failed scroll still earns the decode poll below.
      }
    };
    const pollUntilDone = async (img: HTMLImageElement, deadlineMs: number): Promise<void> => {
      const startedAt = Date.now();
      for (;;) {
        if (isDone(img)) return;
        if (Date.now() - startedAt >= deadlineMs) return;
        await pause(250);
      }
    };
    let pending: Array<HTMLImageElement> = [];
    try {
      pending = Array.from(document.images || []).filter((img) => {
        try {
          if (img.complete && img.naturalWidth > 0) return false;
          if (!img.complete) return true;
          // Complete but never decoded a source (lazy never triggered).
          if (!img.currentSrc && (img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("srcset"))) return true;
          return img.naturalWidth === 0;
        } catch {
          return false;
        }
      });
    } catch {
      return empty;
    }
    // No early return here: even with zero pending images, frameless videos
    // below still need the play/seek pass.
    const cap = Math.min(pending.length, 10);
    let settled = 0;
    for (let i = 0; i < cap; i += 1) {
      const img = pending[i];
      try {
        // Re-prioritize: a 10px loading="lazy" image far below the fold sits
        // at the back of Chrome's fetch queue behind everything the band
        // scroll triggered. Flipping it eager + high priority re-queues it
        // ahead so the poll below waits on an actually-loading fetch.
        img.loading = "eager";
        if ("fetchPriority" in img) (img as HTMLImageElement & { fetchPriority: string }).fetchPriority = "high";
      } catch {
        // Attribute flip is best effort; the scroll still triggers loading.
      }
      scrollTo(img, "center");
      // Condition-based wait, not a fixed pause: slow CDN first-bytes lose a
      // fixed 350ms race even after the lazy trigger fires. Poll to 1.5s.
      await pollUntilDone(img, 1500);
      if (!isDone(img)) {
        // One retry: sticky headers/chrome can leave "center" still outside
        // the true IO viewport; a second nudge re-fires the observer.
        scrollTo(img, "start");
        await pause(200);
        scrollTo(img, "center");
        await pollUntilDone(img, 750);
      }
      if (isDone(img)) settled += 1;
    }
    let stillPending = 0;
    let failed = 0;
    try {
      for (const img of Array.from(document.images || [])) {
        try {
          if (!img.complete) stillPending += 1;
          else if (isFailed(img)) failed += 1;
        } catch {
          // Ignore per-image inspection failures.
        }
      }
    } catch {
      stillPending = 0;
      failed = 0;
    }
    // Video pass: a video that never played (autoplay blocked, IO-gated, or
    // lazy src) captures as an empty/black box. Force each one to a real
    // frame: scroll into view, muted-play, wait for data, seek to a
    // representative time, then hold paused — a paused video with a decoded
    // frame screenshots deterministically, unlike a playing one. Already
    // frameless videos are counted so the warning stays honest.
    let videosReady = 0;
    let videosPending = 0;
    try {
      // Native <video> plus videos hosted inside facade shadow roots
      // (vimeo-video / lite embeds render their <video> behind an open
      // shadow root that document.querySelectorAll cannot pierce — figma's
      // scroll-autoplay videos live there, so a document-only query leaves
      // them frameless). Cap 6 total, document videos first.
      const vids: Array<HTMLVideoElement> = [];
      try {
        for (const video of Array.from(document.querySelectorAll("video") || [])) {
          vids.push(video as HTMLVideoElement);
          if (vids.length >= 6) break;
        }
      } catch {
        // Fall through to the shadow-root scan below.
      }
      if (vids.length < 6) {
        try {
          const hosts = Array.from(
            document.querySelectorAll("vimeo-video, lite-youtube-embed, lite-vimeo-embed, [data-video]") || [],
          );
          for (const host of hosts) {
            let shadowVideos: Array<HTMLVideoElement> = [];
            try {
              const shadow = (host as Element).shadowRoot;
              if (shadow) shadowVideos = Array.from(shadow.querySelectorAll("video") || []) as Array<HTMLVideoElement>;
            } catch {
              // Closed shadow roots throw on access; skip them.
              continue;
            }
            for (const video of shadowVideos) {
              if (vids.indexOf(video) === -1) vids.push(video);
              if (vids.length >= 6) break;
            }
            if (vids.length >= 6) break;
          }
        } catch {
          // Shadow scan is best effort; document videos still get the pass.
        }
      }
      for (const video of vids) {
        let hasFrame = false;
        try {
          hasFrame = video.readyState >= 2 && video.currentTime > 0;
        } catch {
          hasFrame = false;
        }
        if (hasFrame) {
          videosReady += 1;
          continue;
        }
        try {
          try {
            video.muted = true;
          } catch {
            // Muting is best effort; play may still be allowed.
          }
          scrollTo(video, "center");
          try {
            await video.play();
          } catch {
            // Autoplay blocked even muted: fall through to whatever frame
            // (poster/first) the element already holds.
          }
          const dataAt = Date.now();
          for (;;) {
            let rs = 0;
            try {
              rs = video.readyState;
            } catch {
              break;
            }
            if (rs >= 2) break;
            if (Date.now() - dataAt >= 2000) break;
            await pause(250);
          }
          try {
            const dur = video.duration;
            const target = Number.isFinite(dur) && dur > 0.2 ? Math.min(0.5, Math.max(0, dur - 0.1)) : 0.1;
            if (video.readyState >= 1 && Math.abs(video.currentTime - target) > 0.05) {
              await new Promise<void>((resolve) => {
                const to = setTimeout(() => resolve(), 1200);
                try {
                  video.addEventListener("seeked", () => {
                    clearTimeout(to);
                    resolve();
                  }, { once: true });
                  video.currentTime = target;
                } catch {
                  clearTimeout(to);
                  resolve();
                }
              });
            }
          } catch {
            // Seeking is best effort (streams may not be seekable).
          }
          try {
            video.pause();
          } catch {
            // Ignore pause failures.
          }
        } catch {
          // One bad video must not fail the capture.
        }
        try {
          if (video.readyState >= 2) videosReady += 1;
          else videosPending += 1;
        } catch {
          videosPending += 1;
        }
      }
    } catch {
      // No video support: nothing to do.
    }
    // Iframe-embed pass (YouTube/Vimeo players are cross-origin: they cannot
    // be force-played or inspected from outside, and click-to-play facades
    // only boot on real interaction). Lazy player iframes still need to be
    // scrolled into view to boot, so give each a painted pause. No
    // verifiable ready signal exists cross-origin, so this pass never warns.
    try {
      const frames = Array.from(document.querySelectorAll("iframe") || [])
        .filter((frame) => {
          try {
            return Boolean(frame.getAttribute("src"));
          } catch {
            return false;
          }
        })
        .slice(0, 6);
      for (const frame of frames) {
        scrollTo(frame, "center");
        await pause(600);
      }
    } catch {
      // Embed settling is best effort.
    }
    try {
      window.scrollTo(0, 0);
      await pause(600);
    } catch {
      // Ignore scroll-reset failures; screenshots clip by coordinates anyway.
    }
    return { settled, pending: stillPending + failed, failed, videosReady, videosPending };
  })();
}

export interface FacadeClickTarget {
  status: "none" | "target";
  x: number;
  y: number;
  label: string;
  /**
   * Direct autoplay player URL resolved from facade attributes (Vimeo /
   * YouTube IDs), or "". The Node side renders it in an isolated player page
   * when scroll-autoplay never starts in the site context.
   */
  streamUrl: string;
  /**
   * Facade box in DOCUMENT coordinates (page placement, scroll-independent).
   * Stored on every video shot so rebuilds can composite the playing frame
   * over the blank video band in section screenshots.
   */
  rectY: number;
  rectHeight: number;
  rectX: number;
  rectWidth: number;
  /**
   * Stable per-element id (in-page counter stashed on the element, shared
   * across re-queries). Lets the pager skip already-processed facades after
   * a carousel page-turn re-renders the grid. "" when unstorable.
   */
  uid: string;
}

export interface BootedVideoPlayer {
  started: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Click-to-play capture, step 1 of 3 (self-contained: NO module-scope
 * references, literals only — ships via a Trap-5-shimmed IIFE string with
 * the facade index baked in as a literal; see facadeClickScript).
 *
 * Returns the facade's viewport-center coordinates WITHOUT clicking: the
 * click itself must be trusted CDP input (Node side) to grant the transient
 * user activation web players require. A synthetic in-page .click() carries
 * no activation, so facades clicked that way never boot.
 *
 * Native `<video>` elements are deliberately EXCLUDED: they were already
 * forced to a paused frame by ensureLazyMediaLoaded, and clicking one would
 * toggle it back to playing (plus possible audio). Only facades that cannot
 * play without a click are handled: `vimeo-video` web components,
 * `[data-video]` markers, and lite embeds.
 */
export function facadeClickTarget(index: number): Promise<FacadeClickTarget> {
  return (async () => {
    const none = { status: "none", x: 0, y: 0, label: "", streamUrl: "", rectY: 0, rectHeight: 0, rectX: 0, rectWidth: 0, uid: "" } as FacadeClickTarget;
    const pause = (ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    let facades: Element[] = [];
    try {
      // Custom facade tags are always real players. Generic [data-video]
      // markers are only real when they look clickable themselves AND do not
      // merely wrap a real facade (wrappers outnumber players in document
      // order and would eat the cap with no-op clicks).
      const isCustomFacade = (el: Element): boolean => {
        const tag = String(el.tagName || "").toUpperCase();
        return tag === "VIMEO-VIDEO" || tag === "LITE-YOUTUBE-EMBED" || tag === "LITE-VIMEO-EMBED";
      };
      const looksClickable = (el: Element): boolean => {
        try {
          if (el.querySelector("vimeo-video, lite-youtube-embed, lite-vimeo-embed")) return false;
          return Boolean(el.querySelector("button, [role='button'], [data-play]"));
        } catch {
          return false;
        }
      };
      facades = Array.from(
        document.querySelectorAll("vimeo-video, [data-video], lite-youtube-embed, lite-vimeo-embed") || [],
      )
        .filter((el) => isCustomFacade(el) || looksClickable(el))
        .slice(0, 12);
    } catch {
      return none;
    }
    const el = facades[index];
    if (!el) return none;
    // Stable per-element id shared across re-queries (carousel page-turns
    // re-render the grid; the pager skips uids it already processed).
    let uid = "";
    try {
      const ds = (el as HTMLElement).dataset;
      if (ds) {
        if (!ds.ssVid) {
          const counter = Number((window as unknown as Record<string, unknown>).__ssVidCounter || 0) + 1;
          (window as unknown as Record<string, unknown>).__ssVidCounter = counter;
          ds.ssVid = `ss${counter}`;
        }
        uid = String(ds.ssVid || "");
      }
    } catch {
      // uid stays "": the caller falls back to processing by index.
    }
    let label = `video ${index + 1}`;
    try {
      const raw = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("data-title") || label;
      label = String(raw).slice(0, 60);
    } catch {
      // Keep the default label.
    }
    // Resolve the direct autoplay stream URL for this facade and stash it:
    // the post-click wait uses it to force watch-gated modals (bot-walled
    // watch URLs that stay white headless) onto the player endpoint, which
    // renders real frames. Vimeo IDs come from facade attrs/links; YouTube
    // from youtu.be / watch?v= / embed forms.
    try {
      const attrTexts: Array<string | null> = [
        el.getAttribute("src"),
        el.getAttribute("data-video"),
        el.getAttribute("data-vimeo-id"),
        el.getAttribute("data-youtube-id"),
        el.getAttribute("data-src"),
        el.getAttribute("href"),
      ];
      try {
        const vimeoLink = el.querySelector('a[href*="vimeo.com/"]');
        if (vimeoLink) attrTexts.push((vimeoLink as HTMLAnchorElement).href);
        const ytLink = el.querySelector('a[href*="youtu"]');
        if (ytLink) attrTexts.push((ytLink as HTMLAnchorElement).href);
      } catch {
        // Ignore query failures.
      }
      let streamUrl = "";
      for (const text of attrTexts) {
        if (!text) continue;
        const str = String(text);
        const vimeo = /vimeo\.com\/(\d+)/.exec(str);
        if (vimeo) {
          streamUrl = `https://player.vimeo.com/video/${vimeo[1]}?autoplay=1&muted=1&playsinline=1&transparent=0`;
          break;
        }
        const ytShort = /youtu\.be\/([\w-]{6,})/.exec(str);
        const ytWatch = /[?&]v=([\w-]{6,})/.exec(str);
        const ytEmbed = /youtube\.com\/embed\/([\w-]{6,})/.exec(str);
        const ytId = ytShort?.[1] ?? ytWatch?.[1] ?? ytEmbed?.[1] ?? null;
        if (ytId) {
          streamUrl = `https://www.youtube.com/embed/${ytId}?autoplay=1&mute=1&playsinline=1&rel=0`;
          break;
        }
      }
      (window as unknown as Record<string, unknown>).__ssVideoStream = streamUrl;
    } catch {
      // Stream resolution is best effort.
    }
    // Aim at the play affordance, not the facade center: cards are large and
    // the click handler usually lives on a small play button (light DOM or
    // open shadow root). A center click on the cover may hit nothing.
    // Prefer explicit play semantics (case-insensitive): a bare "button"
    // first-match could be an options/close/mute control that swallows the
    // click without booting anything.
    let aim: Element | null = null;
    try {
      const playSelector = "button[aria-label*='play' i], [role='button'][aria-label*='play' i], [data-play], button, [role='button'], [aria-label*='lay']";
      aim = el.querySelector(playSelector);
      if (!aim) {
        try {
          const shadow = (el as Element).shadowRoot;
          if (shadow) aim = (shadow as unknown as Document).querySelector(playSelector);
        } catch {
          // Closed shadow roots throw on access; fall back below.
        }
      }
    } catch {
      aim = null;
    }
    if (!aim) aim = el;
    // NOTE: explicit scroll math here instead of the shared scroll helper —
    // the mock browser backend routes evaluations by source markers, and the
    // helper's name would misroute this script to the lazy-image fixture.
    try {
      const rect = aim.getBoundingClientRect();
      window.scrollTo(0, window.scrollY + rect.top + rect.height / 2 - Math.floor(window.innerHeight / 2));
    } catch {
      // Best effort; the Node-side click below may still land.
    }
    // Smooth-scroll pages (Lenis-style glide) keep moving long after a
    // fixed pause: coordinates measured mid-glide are stale and the trusted
    // click lands on empty space. Force instant behavior and wait for the
    // scroll position to actually stabilize before measuring.
    try {
      document.documentElement.style.scrollBehavior = "auto";
    } catch {
      // Ignore; the stabilize poll below still helps.
    }
    try {
      const calmAt = Date.now();
      let lastY = window.scrollY;
      let calm = 0;
      while (Date.now() - calmAt < 1500) {
        await pause(250);
        let y = lastY;
        try {
          y = window.scrollY;
        } catch {
          break;
        }
        if (Math.abs(y - lastY) < 2) {
          calm += 1;
          if (calm >= 2) break;
        } else {
          calm = 0;
        }
        lastY = y;
      }
    } catch {
      // Ignore stabilization failures; measure anyway.
    }
    try {
      const rect = aim.getBoundingClientRect();
      // Stash the currently-known players so the post-click poll only
      // accepts NEWLY booted ones — otherwise it keeps matching a
      // pre-existing (possibly blank) hero video on every facade.
      // Inline (no shared helper): in-page code must stay self-contained.
      // Identity is tag+src only (NO size): scroll-responsive heroes resize
      // between the stash and the poll, and size in the signature makes the
      // same element look new on every facade.
      // CRITICAL: scan facade shadow roots here too — the poll does, and a
      // shadow-hosted hero video missed by a document-only stash looks new
      // on every facade (proven by byte-identical clips across facades).
      try {
        const known: string[] = [];
        const sigRoots: Array<Document | ShadowRoot> = [document];
        try {
          for (const host of Array.from(
            document.querySelectorAll("vimeo-video, lite-youtube-embed, lite-vimeo-embed, [data-video]") || [],
          )) {
            try {
              const shadow = (host as Element).shadowRoot;
              if (shadow) sigRoots.push(shadow as unknown as ShadowRoot);
            } catch {
              // Closed shadow roots throw on access; skip them.
            }
          }
        } catch {
          // Fall through with the document-only set.
        }
        for (const root of sigRoots) {
          let existing: Array<Element> = [];
          try {
            existing = Array.from(
              root.querySelectorAll('iframe[src*="vimeo"], iframe[src*="youtube"], iframe[src*="youtu.be"], video') || [],
            );
          } catch {
            continue;
          }
          for (const p of existing) {
            try {
              const tag = String((p as Element).tagName || "").toUpperCase();
              const src = (p as HTMLVideoElement).currentSrc || (p as Element).getAttribute("src") || "";
              known.push(`${tag}|${String(src).slice(-60)}`);
            } catch {
              // Ignore per-element failures.
            }
          }
        }
        (window as unknown as Record<string, unknown>).__ssVideoPlayers = known;
      } catch {
        // Stash is best effort; the poll falls back to any player.
      }
      return {
        status: "target",
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        label,
        streamUrl: (() => {
          try {
            return String((window as unknown as Record<string, unknown>).__ssVideoStream || "");
          } catch {
            return "";
          }
        })(),
        // Placement box of the FACADE (not the play affordance above):
        // document coordinates, so shots map onto section screenshots.
        rectY: (() => {
          try {
            return Math.max(Math.round(el.getBoundingClientRect().top + window.scrollY), 0);
          } catch {
            return 0;
          }
        })(),
        rectHeight: (() => {
          try {
            return Math.round(el.getBoundingClientRect().height);
          } catch {
            return 0;
          }
        })(),
        rectX: (() => {
          try {
            return Math.max(Math.round(el.getBoundingClientRect().left + window.scrollX), 0);
          } catch {
            return 0;
          }
        })(),
        rectWidth: (() => {
          try {
            return Math.round(el.getBoundingClientRect().width);
          } catch {
            return 0;
          }
        })(),
        uid,
      };
    } catch {
      return { status: "none", x: 0, y: 0, label, streamUrl: "", rectY: 0, rectHeight: 0, rectX: 0, rectWidth: 0, uid: "" };
    }
  })();
}

/** Builds the Trap-5-shimmed IIFE string for facadeClickTarget(index). */
export function facadeClickScript(index: number): string {
  return `var __name=function(f){return f};(${facadeClickTarget.toString()})(${index})`;
}

/**
 * Autoplay-first capture (self-contained: NO module-scope references,
 * literals only — ships via autoplayVideoScript with the facade index baked
 * in as a literal; NOTE: explicit scroll math here, no shared scroll helper —
 * the mock backend routes evaluations by source markers).
 *
 * Scroll-autoplay facades (figma-style: muted/loop players that boot on
 * IntersectionObserver when scrolled into view, no click needed) must be
 * caught WITHOUT clicking: a click opens a watch-URL modal that stays white
 * headless instead of the inline player. This scrolls facade `index` into
 * view, nudges its inner videos to muted-play (the site's own observer may
 * also fire), and reports the playing rect in VIEWPORT coordinates when its
 * clock actually advances. Facades that never play report started:false and
 * the Node side falls back to the click path.
 *
 * quick=true shortens the motion poll for facades with a resolvable direct
 * stream: a full poll never succeeds on bot-gated players (proven), and the
 * isolated tier renders the same content anyway — so probe cheaply and defer.
 */
export function awaitAutoplayVideo(index: number, quick = false): Promise<BootedVideoPlayer> {
  return (async () => {
    const none = { started: false, x: 0, y: 0, width: 0, height: 0 } as BootedVideoPlayer;
    const pause = (ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    // Identical facade list to the click path so indices line up: custom
    // player tags always count; generic markers only when they look clickable
    // themselves and do not merely wrap a real player.
    let facades: Element[] = [];
    try {
      const isCustom = (el: Element): boolean => {
        const tag = String(el.tagName || "").toUpperCase();
        return tag === "VIMEO-VIDEO" || tag === "LITE-YOUTUBE-EMBED" || tag === "LITE-VIMEO-EMBED";
      };
      const looksClickable = (el: Element): boolean => {
        try {
          if (el.querySelector("vimeo-video, lite-youtube-embed, lite-vimeo-embed")) return false;
          return Boolean(el.querySelector("button, [role='button'], [data-play]"));
        } catch {
          return false;
        }
      };
      facades = Array.from(
        document.querySelectorAll("vimeo-video, [data-video], lite-youtube-embed, lite-vimeo-embed") || [],
      )
        .filter((el) => isCustom(el) || looksClickable(el))
        .slice(0, 12);
    } catch {
      return none;
    }
    const el = facades[index];
    if (!el) return none;
    // Explicit scroll math (no shared helper): smooth-glide pages keep moving
    // long after a fixed pause, so stabilize before measuring.
    try {
      const rect = el.getBoundingClientRect();
      window.scrollTo(0, window.scrollY + rect.top + rect.height / 2 - Math.floor(window.innerHeight / 2));
    } catch {
      // Best effort; the poll below may still catch playback.
    }
    try {
      document.documentElement.style.scrollBehavior = "auto";
    } catch {
      // Ignore; the stabilize poll below still helps.
    }
    try {
      const calmAt = Date.now();
      let lastY = window.scrollY;
      let calm = 0;
      while (Date.now() - calmAt < 1500) {
        await pause(250);
        let y = lastY;
        try {
          y = window.scrollY;
        } catch {
          break;
        }
        if (Math.abs(y - lastY) < 2) {
          calm += 1;
          if (calm >= 2) break;
        } else {
          calm = 0;
        }
        lastY = y;
      }
    } catch {
      // Ignore stabilization failures; poll anyway.
    }
    // Nudge inner videos toward muted playback: the site's own scroll
    // observer may have fired already; where it did not (headless IO timing)
    // this produces the same playing state a hand scroll would.
    try {
      const inners: Array<HTMLVideoElement> = [];
      try {
        for (const v of Array.from(el.querySelectorAll("video") || []).slice(0, 3)) {
          inners.push(v as HTMLVideoElement);
        }
      } catch {
        // Ignore light-DOM query failures.
      }
      try {
        const shadow = (el as Element).shadowRoot;
        if (shadow) {
          for (const v of Array.from(shadow.querySelectorAll("video") || []).slice(0, 3)) {
            const vv = v as HTMLVideoElement;
            if (inners.indexOf(vv) === -1) inners.push(vv);
          }
        }
      } catch {
        // Closed shadow roots throw on access; skip them.
      }
      for (const v of inners) {
        try {
          v.muted = true;
        } catch {
          // Muting is best effort.
        }
        try {
          const played = (v as HTMLVideoElement).play();
          if (played && typeof (played as Promise<void>).catch === "function") {
            (played as Promise<void>).catch(() => undefined);
          }
        } catch {
          // Play rejection (blocked): the poll below still checks frames.
        }
      }
    } catch {
      // Nudge is best effort.
    }
    // Facade box in document coordinates: only playback overlapping THIS
    // facade counts, so a pre-existing hero video never misattributes.
    let fx0 = 0;
    let fy0 = 0;
    let fx1 = 0;
    let fy1 = 0;
    try {
      const rect = el.getBoundingClientRect();
      fx0 = rect.left + window.scrollX - 20;
      fy0 = rect.top + window.scrollY - 20;
      fx1 = rect.left + window.scrollX + rect.width + 20;
      fy1 = rect.top + window.scrollY + rect.height + 20;
    } catch {
      return none;
    }
    const overlapsFacade = (x: number, y: number, w: number, h: number): boolean => {
      const cx = x + w / 2;
      const cy = y + h / 2;
      return cx >= fx0 && cx <= fx1 && cy >= fy0 && cy <= fy1;
    };
    const collectVideos = (): Array<{ el: HTMLVideoElement; x: number; y: number; width: number; height: number }> => {
      const out: Array<{ el: HTMLVideoElement; x: number; y: number; width: number; height: number }> = [];
      const scan = (root: Document | ShadowRoot): void => {
        let nodes: Array<Element> = [];
        try {
          nodes = Array.from(root.querySelectorAll("video") || []);
        } catch {
          return;
        }
        for (const node of nodes) {
          try {
            const rect = node.getBoundingClientRect();
            if (rect.width < 120 || rect.height < 120) continue;
            out.push({
              el: node as HTMLVideoElement,
              x: Math.max(Math.round(rect.left + window.scrollX), 0),
              y: Math.max(Math.round(rect.top + window.scrollY), 0),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            });
          } catch {
            continue;
          }
        }
      };
      try {
        scan(document);
        const hosts = Array.from(
          document.querySelectorAll("vimeo-video, lite-youtube-embed, lite-vimeo-embed, [data-video]") || [],
        );
        for (const host of hosts) {
          try {
            const shadow = (host as Element).shadowRoot;
            if (shadow) scan(shadow as unknown as ShadowRoot);
          } catch {
            // Closed shadow roots throw on access; skip them.
          }
        }
      } catch {
        // Return whatever was collected.
      }
      return out;
    };
    const clockAdvances = async (video: HTMLVideoElement): Promise<boolean> => {
      try {
        if (video.readyState < 2) return false;
        const first = video.currentTime;
        await pause(500);
        let second = first;
        try {
          second = video.currentTime;
        } catch {
          return false;
        }
        return second > first;
      } catch {
        return false;
      }
    };
    const startedAt = Date.now();
    let found: { x: number; y: number; width: number; height: number } | null = null;
    // Quick probes (stream known: isolated tier renders the same content)
    // poll briefly; full probes earn the long window for slow in-page boots.
    const pollBudgetMs = quick ? 2000 : 5000;
    for (;;) {
      const candidates = collectVideos();
      for (const candidate of candidates) {
        if (!overlapsFacade(candidate.x, candidate.y, candidate.width, candidate.height)) continue;
        try {
          if (await clockAdvances(candidate.el)) {
            found = candidate;
            break;
          }
        } catch {
          // Per-candidate failures must not fail the pass.
        }
      }
      if (found) break;
      if (Date.now() - startedAt >= pollBudgetMs) break;
      await pause(300);
    }
    if (!found) return none;
    // Let motion develop so the clip catches a mid-play frame, then report
    // VIEWPORT coordinates (Node clips without captureBeyondViewport: OOPIF
    // content can go blank in beyond-viewport captures). Quick probes settle
    // briefly; full probes earn the long stream-manifest wait.
    await pause(quick ? 600 : 1200);
    try {
      const viewportW = Math.max(window.innerWidth, 1);
      const viewportH = Math.max(window.innerHeight, 1);
      const box = found as { x: number; y: number; width: number; height: number };
      const docTop = Math.max(box.y - 80, 0);
      window.scrollTo(0, docTop);
      await pause(400);
      const vx = Math.max(Math.min(box.x, viewportW - 1), 0);
      const vy = Math.max(Math.min(box.y - docTop, viewportH - 1), 0);
      const vw = Math.min(box.width, viewportW - vx);
      const vh = Math.min(box.height, viewportH - vy);
      if (vw < 120 || vh < 120) return none;
      return { started: true, x: Math.round(vx), y: Math.round(vy), width: Math.round(vw), height: Math.round(vh) };
    } catch {
      return none;
    }
  })();
}

/** Builds the Trap-5-shimmed IIFE string for awaitAutoplayVideo(index, quick). */
export function autoplayVideoScript(index: number, quick = false): string {
  return `var __name=function(f){return f};(${awaitAutoplayVideo.toString()})(${index},${quick ? "true" : "false"})`;
}

export interface NativeVideoTarget {
  status: "none" | "target";
  started: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  streamUrl: string;
  rectY: number;
  rectHeight: number;
  rectX: number;
  rectWidth: number;
  uid: string;
  /**
   * window.scrollY at measure time (CF28 follow-up). Node re-reads scrollY
   * just before clipping: a mismatch means the page moved between measure
   * and screenshot (snap points, SPA scroll-into-view on play), so the
   * viewport coordinates are stale and the clip would land on the wrong
   * band. Absent (tests) disables the check.
   */
  scrollY: number;
}

/**
 * Native-video capture, step 1 of 1 (CF28; self-contained: NO module-scope
 * references, literals only — ships via nativeVideoScript with the video
 * index baked in as a literal; NOTE: explicit scroll math here, no shared
 * scroll helper — the mock backend routes evaluations by source markers).
 *
 * Bare native <video> elements never enter the facade loop (no click
 * affordance, no Vimeo/YouTube stream to defer), so facade-only pages with
 * laid-out players report zero video. This pass enumerates laid-out native
 * videos site-wide, force-plays them MUTED (muted, so the
 * ensureLazyMediaLoaded audio concern does not apply — unmuted autoplay is
 * born blocked headless), and reports the playing rect in VIEWPORT
 * coordinates when the clock actually advances. Node screenshots via the
 * shared clipPlayer; unstarted videos count into the honest shortfall.
 */
export function nativeVideoTarget(index: number): Promise<NativeVideoTarget> {
  return (async () => {
    const none = { status: "none", started: false, x: 0, y: 0, width: 0, height: 0, label: "", streamUrl: "", rectY: 0, rectHeight: 0, rectX: 0, rectWidth: 0, uid: "", scrollY: 0 } as NativeVideoTarget;
    const pause = (ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    let videos: HTMLVideoElement[] = [];
    try {
      const seen = new Set<HTMLVideoElement>();
      const collect = (root: Document | ShadowRoot): void => {
        let nodes: Array<Element> = [];
        try {
          nodes = Array.from(root.querySelectorAll("video") || []);
        } catch {
          return;
        }
        for (const node of nodes) {
          const video = node as HTMLVideoElement;
          if (seen.has(video)) continue;
          seen.add(video);
          try {
            const rect = node.getBoundingClientRect();
            if (!rect || rect.width < 120 || rect.height < 120) continue;
          } catch {
            continue;
          }
          // Paint check: visibility:hidden / opacity:0 instances keep full
          // layout rects (Canva-style duplicate preloads) but paint nothing,
          // so clips come out flat black. Only players that actually paint.
          try {
            const style = window.getComputedStyle(node);
            if (!style || style.visibility === "hidden" || style.display === "none") continue;
            const opacity = Number(style.opacity);
            if (Number.isFinite(opacity) && opacity <= 0) continue;
          } catch {
            continue;
          }
          videos.push(video);
        }
      };
      collect(document);
      const hosts = Array.from(
        document.querySelectorAll("vimeo-video, lite-youtube-embed, lite-vimeo-embed, [data-video]") || [],
      );
      for (const host of hosts) {
        try {
          const shadow = (host as Element).shadowRoot;
          if (shadow) collect(shadow as unknown as ShadowRoot);
        } catch {
          // Closed shadow roots throw on access; skip them.
        }
      }
    } catch {
      return none;
    }
    const el = videos[index];
    if (!el) return none;
    let label = `native video ${index + 1}`;
    try {
      const raw = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("data-title") || label;
      label = String(raw).slice(0, 60);
    } catch {
      // Keep the default label.
    }
    // Resolve the file: live currentSrc first (browser-resolved), then the
    // src attribute, then the first <source> child (Canva-style builders).
    let streamUrl = "";
    try {
      const live = el.currentSrc || "";
      const attr = el.getAttribute("src") || "";
      let child = "";
      try {
        const source = el.querySelector("source");
        child = source ? source.getAttribute("src") || "" : "";
      } catch {
        // Ignore query failures.
      }
      streamUrl = String(live || attr || child || "");
    } catch {
      // Best effort; an empty stream still screenshots (no dedup key).
    }
    // Scroll into view + stabilize (same glide-guard as the facade path).
    try {
      const rect = el.getBoundingClientRect();
      window.scrollTo(0, window.scrollY + rect.top + rect.height / 2 - Math.floor(window.innerHeight / 2));
    } catch {
      // Best effort; the poll below may still catch playback.
    }
    try {
      document.documentElement.style.scrollBehavior = "auto";
    } catch {
      // Ignore.
    }
    try {
      const calmAt = Date.now();
      let lastY = window.scrollY;
      let calm = 0;
      while (Date.now() - calmAt < 1500) {
        await pause(250);
        let y = lastY;
        try {
          y = window.scrollY;
        } catch {
          break;
        }
        if (Math.abs(y - lastY) < 2) {
          calm += 1;
          if (calm >= 2) break;
        } else {
          calm = 0;
        }
        lastY = y;
      }
    } catch {
      // Ignore stabilization failures; measure anyway.
    }
    // Reachability: carousel duplicates (Canva-style tracks) keep full
    // layout rects while translated off-viewport inside overflow tracks —
    // window scrolling can never bring them into view, so clips come out
    // black. Only the instance actually on screen earns force-play; the
    // rest report unstarted with NO stream URL so they neither screenshot
    // nor poison stream dedup for the visible duplicate.
    try {
      const r = el.getBoundingClientRect();
      const reachable = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
      if (!reachable) {
        return { status: "target", started: false, x: 0, y: 0, width: 0, height: 0, label, streamUrl: "", rectY: 0, rectHeight: 0, rectX: 0, rectWidth: 0, uid: `native-${index}`, scrollY: 0 };
      }
    } catch {
      return none;
    }
    // Force muted playback (unmuted autoplay is born blocked headless).
    try {
      el.muted = true;
    } catch {
      // Muting is best effort.
    }
    try {
      const played = el.play();
      if (played && typeof (played as Promise<void>).catch === "function") {
        (played as Promise<void>).catch(() => undefined);
      }
    } catch {
      // Play rejection (blocked): the poll below still checks the clock.
    }
    // The clock must actually advance: paused-at-frame covers must not pass.
    let started = false;
    try {
      if (el.readyState >= 2) {
        const first = el.currentTime;
        await pause(800);
        let second = first;
        try {
          second = el.currentTime;
        } catch {
          second = first;
        }
        started = second > first;
      }
    } catch {
      started = false;
    }
    if (!started) {
      return { status: "target", started: false, x: 0, y: 0, width: 0, height: 0, label, streamUrl, rectY: 0, rectHeight: 0, rectX: 0, rectWidth: 0, uid: `native-${index}`, scrollY: 0 };
    }
    // Let motion develop past fade-from-black intros (Canva-style players
    // open on black; a 600ms settle kept catching the fade), then re-anchor
    // onto the element: the page may have moved under us since the pre-play
    // scroll (snap points, Lenis glide, site scroll-into-view on play), and
    // stale viewport coordinates clip the wrong band. Re-center, require
    // scroll quiescence, and only then measure.
    await pause(1500);
    try {
      const r0 = el.getBoundingClientRect();
      window.scrollTo(0, window.scrollY + r0.top + r0.height / 2 - Math.floor(window.innerHeight / 2));
    } catch {
      // Best effort; the quiescence check below still guards the measure.
    }
    try {
      let lastY = window.scrollY;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await pause(250);
        let now = lastY;
        try {
          now = window.scrollY;
        } catch {
          break;
        }
        if (Math.abs(now - lastY) < 2) break;
        lastY = now;
      }
    } catch {
      // Best effort; measure anyway.
    }
    try {
      const rect = el.getBoundingClientRect();
      const viewportW = Math.max(window.innerWidth, 1);
      const viewportH = Math.max(window.innerHeight, 1);
      const vw = Math.round(rect.width);
      const vh = Math.round(rect.height);
      if (vw < 120 || vh < 120) {
        return { status: "target", started: false, x: 0, y: 0, width: 0, height: 0, label, streamUrl, rectY: 0, rectHeight: 0, rectX: 0, rectWidth: 0, uid: `native-${index}`, scrollY: 0 };
      }
      let pageX = 0;
      let pageY = 0;
      let measuredScroll = 0;
      try {
        pageX = Math.max(Math.round(rect.left + window.scrollX), 0);
        pageY = Math.max(Math.round(rect.top + window.scrollY), 0);
        measuredScroll = window.scrollY;
      } catch {
        // Keep zeros; the clip still lands, placement falls back to the player.
      }
      return {
        status: "target",
        started: true,
        // Clip origin is the TOP-LEFT (clipPlayer treats x/y as the clip
        // origin, like the facade path) — never the center.
        x: Math.max(Math.min(Math.round(rect.left), viewportW - 1), 0),
        y: Math.max(Math.min(Math.round(rect.top), viewportH - 1), 0),
        width: Math.min(vw, viewportW - Math.max(Math.min(Math.round(rect.left), viewportW - 1), 0)),
        height: Math.min(vh, viewportH - Math.max(Math.min(Math.round(rect.top), viewportH - 1), 0)),
        label,
        streamUrl,
        rectY: pageY,
        rectHeight: vh,
        rectX: pageX,
        rectWidth: vw,
        uid: `native-${index}`,
        scrollY: measuredScroll,
      };
    } catch {
      return none;
    }
  })();
}

/** Builds the Trap-5-shimmed IIFE string for nativeVideoTarget(index). */
export function nativeVideoScript(index: number): string {
  return `var __name=function(f){return f};(${nativeVideoTarget.toString()})(${index})`;
}

/**
 * CF29 H2: lightweight re-measure backing the stale-clip retry. The target
 * already passed the clock check in the first pass; only its FRAMING is in
 * doubt after the page moved (measured up to 517px on higgsfield). This
 * re-enumerates videos exactly like nativeVideoTarget (so the same index
 * maps to the same element), re-anchors, waits for a LONGER stable scroll
 * window than the in-pass measure, and returns fresh rects — with NO
 * re-play, NO 800ms clock poll, and NO 1500ms fade pause. Self-contained
 * (Trap-5): ships via nativeVideoRemeasureScript; mock-routed by marker.
 */
export function nativeVideoRemeasure(index: number): Promise<NativeVideoTarget> {
  return (async () => {
    const none = { status: "none", started: false, x: 0, y: 0, width: 0, height: 0, label: "", streamUrl: "", rectY: 0, rectHeight: 0, rectX: 0, rectWidth: 0, uid: "", scrollY: 0 } as NativeVideoTarget;
    const paused = (label: string, streamUrl: string): NativeVideoTarget => ({ status: "target", started: false, x: 0, y: 0, width: 0, height: 0, label, streamUrl, rectY: 0, rectHeight: 0, rectX: 0, rectWidth: 0, uid: `native-${index}`, scrollY: 0 });
    const pause = (ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    let videos: HTMLVideoElement[] = [];
    try {
      const seen = new Set<HTMLVideoElement>();
      const collect = (root: Document | ShadowRoot): void => {
        let nodes: Array<Element> = [];
        try {
          nodes = Array.from(root.querySelectorAll("video") || []);
        } catch {
          return;
        }
        for (const node of nodes) {
          const video = node as HTMLVideoElement;
          if (seen.has(video)) continue;
          seen.add(video);
          try {
            const rect = node.getBoundingClientRect();
            if (!rect || rect.width < 120 || rect.height < 120) continue;
          } catch {
            continue;
          }
          try {
            const style = window.getComputedStyle(node);
            if (!style || style.visibility === "hidden" || style.display === "none") continue;
            const opacity = Number(style.opacity);
            if (Number.isFinite(opacity) && opacity <= 0) continue;
          } catch {
            continue;
          }
          videos.push(video);
        }
      };
      collect(document);
      const hosts = Array.from(
        document.querySelectorAll("vimeo-video, lite-youtube-embed, lite-vimeo-embed, [data-video]") || [],
      );
      for (const host of hosts) {
        try {
          const shadow = (host as Element).shadowRoot;
          if (shadow) collect(shadow as unknown as ShadowRoot);
        } catch {
          // Closed shadow roots throw on access; skip them.
        }
      }
    } catch {
      return none;
    }
    const el = videos[index];
    if (!el) return none;
    let label = `native video ${index + 1}`;
    try {
      const raw = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("data-title") || label;
      label = String(raw).slice(0, 60);
    } catch {
      // Keep the default label.
    }
    let streamUrl = "";
    try {
      const live = el.currentSrc || "";
      const attr = el.getAttribute("src") || "";
      let child = "";
      try {
        const source = el.querySelector("source");
        child = source ? source.getAttribute("src") || "" : "";
      } catch {
        // Ignore query failures.
      }
      streamUrl = String(live || attr || child || "");
    } catch {
      // Best effort; an empty stream still screenshots (no dedup key).
    }
    // Re-anchor, then require three consecutive calm 250ms samples (~750ms
    // stable) before trusting the measure — the first attempt already proved
    // the page glides, so a single calm sample is not enough.
    try {
      const rect = el.getBoundingClientRect();
      window.scrollTo(0, window.scrollY + rect.top + rect.height / 2 - Math.floor(window.innerHeight / 2));
    } catch {
      // Best effort; the quiescence check below still guards the measure.
    }
    try {
      document.documentElement.style.scrollBehavior = "auto";
    } catch {
      // Ignore.
    }
    try {
      let lastY = window.scrollY;
      let calm = 0;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await pause(250);
        let now = lastY;
        try {
          now = window.scrollY;
        } catch {
          break;
        }
        if (Math.abs(now - lastY) < 2) {
          calm += 1;
          if (calm >= 3) break;
        } else {
          calm = 0;
        }
        lastY = now;
      }
    } catch {
      // Best effort; measure anyway.
    }
    try {
      const r = el.getBoundingClientRect();
      const reachable = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
      if (!reachable) return paused(label, "");
    } catch {
      return none;
    }
    // Cheap liveness: the first pass already verified clock advancement; do
    // NOT re-poll. If the page paused the element, report it unstarted.
    let started = false;
    try {
      started = el.readyState >= 2 && !el.paused;
    } catch {
      started = false;
    }
    if (!started) return paused(label, streamUrl);
    try {
      const rect = el.getBoundingClientRect();
      const viewportW = Math.max(window.innerWidth, 1);
      const viewportH = Math.max(window.innerHeight, 1);
      const vw = Math.round(rect.width);
      const vh = Math.round(rect.height);
      if (vw < 120 || vh < 120) return paused(label, streamUrl);
      let pageX = 0;
      let pageY = 0;
      let measuredScroll = 0;
      try {
        pageX = Math.max(Math.round(rect.left + window.scrollX), 0);
        pageY = Math.max(Math.round(rect.top + window.scrollY), 0);
        measuredScroll = window.scrollY;
      } catch {
        // Keep zeros; the clip still lands, placement falls back to the player.
      }
      return {
        status: "target",
        started: true,
        x: Math.max(Math.min(Math.round(rect.left), viewportW - 1), 0),
        y: Math.max(Math.min(Math.round(rect.top), viewportH - 1), 0),
        width: Math.min(vw, viewportW - Math.max(Math.min(Math.round(rect.left), viewportW - 1), 0)),
        height: Math.min(vh, viewportH - Math.max(Math.min(Math.round(rect.top), viewportH - 1), 0)),
        label,
        streamUrl,
        rectY: pageY,
        rectHeight: vh,
        rectX: pageX,
        rectWidth: vw,
        uid: `native-${index}`,
        scrollY: measuredScroll,
      };
    } catch {
      return none;
    }
  })();
}

/** Builds the Trap-5-shimmed IIFE string for nativeVideoRemeasure(index). */
export function nativeVideoRemeasureScript(index: number): string {
  return `var __name=function(f){return f};(${nativeVideoRemeasure.toString()})(${index})`;
}

/**
 * Tiny scrollY read backing the CF28 stale-clip guard (mock-routed by the
 * function-name marker, like the other passes).
 */
export function nativeScrollScript(): string {
  return `var __name=function(f){return f};((function nativeScrollY() { try { return window.scrollY; } catch { return 0; } })())`;
}

export interface CarouselNextTarget {
  status: "none" | "target";
  x: number;
  y: number;
}

/**
 * Carousel pager (self-contained: NO module-scope references, literals only —
 * ships via pageVideoCarouselScript; NOTE: explicit scroll math here, no
 * shared scroll helper — the mock backend routes evaluations by source
 * markers).
 *
 * Video grids hydrate/paginate a few cards at a time (figma's card carousel
 * keeps ~6 vimeo-video facades in the DOM). When the facade list runs dry,
 * this aims at a next-arrow serving a video grid so the Node side can
 * trusted-click it and re-scan for fresh facades. Carousel arrows are plain
 * site buttons (no user-activation requirement), but the click still goes
 * through trusted CDP input for consistency. Runs last-safe: screenshots are
 * already taken, so a stray page-turn harms nothing.
 */
export function pageVideoCarousel(): Promise<CarouselNextTarget> {
  return (async () => {
    const none = { status: "none", x: 0, y: 0 } as CarouselNextTarget;
    const pause = (ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    try {
      const selectors = [
        "button[aria-label*='next' i]",
        "button[aria-label*='Next']",
        "button[data-next]",
        "[data-carousel-next]",
      ];
      let best: Element | null = null;
      let fallback: Element | null = null;
      outer: for (const sel of selectors) {
        let buttons: Element[] = [];
        try {
          buttons = Array.from(document.querySelectorAll(sel) || []);
        } catch {
          continue;
        }
        for (const button of buttons) {
          try {
            const box = button.getBoundingClientRect();
            if (box.width <= 0 || box.height <= 0) continue;
            let scope: Element | null = null;
            try {
              scope = button.closest("section") || button.parentElement;
            } catch {
              scope = null;
            }
            let servesVideo = false;
            try {
              servesVideo = Boolean(
                scope?.querySelector("vimeo-video, lite-youtube-embed, lite-vimeo-embed, [data-video]"),
              );
            } catch {
              servesVideo = false;
            }
            if (servesVideo) {
              best = button;
              break outer;
            }
            if (!fallback) fallback = button;
          } catch {
            continue;
          }
        }
      }
      const el = best ?? fallback;
      if (!el) return none;
      try {
        const rect = el.getBoundingClientRect();
        window.scrollTo(0, window.scrollY + rect.top + rect.height / 2 - Math.floor(window.innerHeight / 2));
      } catch {
        // Best effort; the Node-side click below may still land.
      }
      try {
        document.documentElement.style.scrollBehavior = "auto";
      } catch {
        // Ignore; the stabilize poll below still helps.
      }
      try {
        const calmAt = Date.now();
        let lastY = window.scrollY;
        let calm = 0;
        while (Date.now() - calmAt < 1500) {
          await pause(250);
          let y = lastY;
          try {
            y = window.scrollY;
          } catch {
            break;
          }
          if (Math.abs(y - lastY) < 2) {
            calm += 1;
            if (calm >= 2) break;
          } else {
            calm = 0;
          }
          lastY = y;
        }
      } catch {
        // Ignore stabilization failures; measure anyway.
      }
      try {
        const rect = el.getBoundingClientRect();
        return {
          status: "target",
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };
      } catch {
        return none;
      }
    } catch {
      return none;
    }
  })();
}

/** Builds the Trap-5-shimmed IIFE string for pageVideoCarousel(). */
export function pageVideoCarouselScript(): string {
  return `var __name=function(f){return f};(${pageVideoCarousel.toString()})()`;
}

/**
 * Click-to-play capture, step 2 of 3: after the trusted Node-side click,
 * wait for the booted player (inline iframe/video, or a modal lightbox) and
 * report its rect for clip-capture.
 *
 * A booted modal iframe without autoplay params (watch-gated stream) is
 * rewritten in place to the direct autoplay stream URL stashed by
 * facadeClickTarget: watch URLs can stay white headless while the player
 * endpoint renders real frames. Setting src is allowed cross-origin.
 *
 * The rect is returned in VIEWPORT coordinates with the player scrolled into
 * view, because cross-origin (out-of-process) iframes can composite blank in
 * captureBeyondViewport screenshots while painting fine in viewport captures.
 * The Node side therefore clips WITHOUT captureBeyondViewport.
 */
export function awaitVideoPlayer(): Promise<BootedVideoPlayer> {
  return (async () => {
    const pause = (ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    const playerSelector = 'iframe[src*="vimeo"], iframe[src*="youtube"], iframe[src*="youtu.be"], video';
    // Players often render inside the facade's shadow root (web-component
    // players), which document.querySelectorAll cannot pierce — scan each
    // facade's shadow tree too. Native <video> placeholders (preload=none,
    // empty shadow video tags) match by size but hold no frame: only count
    // videos with decoded frame data (readyState >= 2). And only count
    // players that appeared AFTER the facade click (stashed pre-click set):
    // otherwise every facade matches the same pre-existing hero video.
    const knownSigs = (): string[] => {
      try {
        const raw = (window as unknown as Record<string, unknown>).__ssVideoPlayers;
        return Array.isArray(raw) ? (raw as string[]) : [];
      } catch {
        return [];
      }
    };
    // Same-tag identity with empty-src wildcard: a hero/placeholder video
    // whose src materializes between the stash and the poll ("" → stream
    // URL) must still count as known. Without this, every facade matches
    // the same pre-existing hero video once it starts loading.
    const isKnownPlayer = (player: Element): boolean => {
      const known = knownSigs();
      if (known.length === 0) return false;
      try {
        const tag = String((player as Element).tagName || "").toUpperCase();
        const src = String((player as HTMLVideoElement).currentSrc || (player as Element).getAttribute("src") || "");
        for (const entry of known) {
          const sep = entry.indexOf("|");
          const entryTag = sep === -1 ? entry : entry.slice(0, sep);
          const entrySrc = sep === -1 ? "" : entry.slice(sep + 1);
          if (entryTag !== tag) continue;
          if (!entrySrc || !src) return true;
          if (entrySrc === src) return true;
        }
      } catch {
        return false;
      }
      return false;
    };
    const findPlayer = (): { el: Element; x: number; y: number; width: number; height: number } | null => {
      let best: { el: Element; x: number; y: number; width: number; height: number } | null = null;
      let bestArea = 0;
      const check = (root: Document | ShadowRoot): void => {
        let players: Array<Element> = [];
        try {
          players = Array.from(root.querySelectorAll(playerSelector) || []);
        } catch {
          return;
        }
        for (const player of players) {
          let rect: { left: number; top: number; width: number; height: number } | null = null;
          try {
            rect = player.getBoundingClientRect();
          } catch {
            continue;
          }
          try {
            const tag = String((player as Element).tagName || "").toUpperCase();
            if (tag === "VIDEO" && (player as HTMLVideoElement).readyState < 2) continue;
          } catch {
            continue;
          }
          if (isKnownPlayer(player)) continue;
          const area = Math.max(rect.width, 0) * Math.max(rect.height, 0);
          if (rect.width > 120 && rect.height > 120 && area > bestArea) {
            bestArea = area;
            best = {
              el: player,
              x: Math.max(Math.round(rect.left + window.scrollX), 0),
              y: Math.max(Math.round(rect.top + window.scrollY), 0),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          }
        }
      };
      try {
        check(document);
        const hosts = Array.from(
          document.querySelectorAll("vimeo-video, lite-youtube-embed, lite-vimeo-embed, [data-video]") || [],
        );
        for (const host of hosts) {
          try {
            const shadow = (host as Element).shadowRoot;
            if (shadow) check(shadow as unknown as ShadowRoot);
          } catch {
            // Closed shadow roots throw on access; skip them.
          }
        }
      } catch {
        return null;
      }
      return best;
    };
    // A native <video> counts as playing only when its clock actually
    // advances between two samples: paused-at-frame covers (and stalled
    // streams) must not pass as playing state. Iframes cannot be inspected
    // cross-origin — a newly appeared one is the best available signal.
    const isAdvancing = async (el: Element): Promise<boolean> => {
      try {
        const tag = String((el as Element).tagName || "").toUpperCase();
        if (tag !== "VIDEO") return true;
        const video = el as HTMLVideoElement;
        const first = video.currentTime;
        await pause(500);
        let second = first;
        try {
          second = video.currentTime;
        } catch {
          return false;
        }
        return second > first;
      } catch {
        return false;
      }
    };
    const startedAt = Date.now();
    let found: { el: Element; x: number; y: number; width: number; height: number } | null = null;
    for (;;) {
      const candidate = findPlayer();
      if (candidate) {
        let playing = true;
        try {
          const tag = String((candidate.el as Element).tagName || "").toUpperCase();
          if (tag === "VIDEO") {
            playing = await isAdvancing(candidate.el);
          } else {
            // Iframe without autoplay params (watch-gated modal): force the
            // stashed direct stream URL, then keep polling — the reload
            // re-matches with the new src once it boots.
            let src = "";
            try {
              src = (candidate.el as HTMLIFrameElement).src || "";
            } catch {
              src = "";
            }
            if (!/autoplay=1/.test(src)) {
              let streamUrl = "";
              try {
                streamUrl = String((window as unknown as Record<string, unknown>).__ssVideoStream || "");
              } catch {
                streamUrl = "";
              }
              if (streamUrl) {
                try {
                  (candidate.el as HTMLIFrameElement).src = streamUrl;
                } catch {
                  // Ignore src-write failures.
                }
                playing = false;
              }
            }
          }
        } catch {
          playing = false;
        }
        if (playing) {
          found = candidate;
          break;
        }
      }
      if (Date.now() - startedAt >= 8000) break;
      await pause(300);
    }
    if (!found) return { started: false, x: 0, y: 0, width: 0, height: 0 };
    // Let it play on so the clip catches mid-play motion: Vimeo-style
    // players need player.js + stream manifest + first segment after boot,
    // which takes seconds on a saturated page (proven: direct player URLs
    // render fine headless given a full capture budget). Then re-scroll
    // into view and report viewport coordinates (see below).
    await pause(6000);
    // Re-scroll the player into view and report VIEWPORT coordinates: the
    // Node side clips without captureBeyondViewport (OOPIF content can go
    // blank in beyond-viewport captures). Clamp to the visible viewport.
    try {
      const fresh = findPlayer();
      const target = fresh ?? { x: found.x, y: found.y, width: found.width, height: found.height };
      const viewportW = Math.max(window.innerWidth, 1);
      const viewportH = Math.max(window.innerHeight, 1);
      const docTop = Math.max(target.y - 80, 0);
      window.scrollTo(0, docTop);
      // Same smooth-glide hazard as the click coordinates: stabilize before
      // measuring the viewport rect the Node side will clip.
      try {
        document.documentElement.style.scrollBehavior = "auto";
      } catch {
        // Ignore; the stabilize poll below still helps.
      }
      try {
        const calmAt = Date.now();
        let lastY = window.scrollY;
        let calm = 0;
        while (Date.now() - calmAt < 1500) {
          await pause(250);
          let y = lastY;
          try {
            y = window.scrollY;
          } catch {
            break;
          }
          if (Math.abs(y - lastY) < 2) {
            calm += 1;
            if (calm >= 2) break;
          } else {
            calm = 0;
          }
          lastY = y;
        }
      } catch {
        // Ignore stabilization failures; measure anyway.
      }
      const recheck = findPlayer();
      const box = recheck ?? target;
      const vx = Math.max(Math.min(box.x, viewportW - 1), 0);
      const vy = Math.max(Math.min(box.y - docTop, viewportH - 1), 0);
      const vw = Math.min(box.width, viewportW - vx);
      const vh = Math.min(box.height, viewportH - vy);
      return { started: true, x: Math.round(vx), y: Math.round(vy), width: Math.round(vw), height: Math.round(vh) };
    } catch {
      // Could not position for a viewport clip: report unstarted rather
      // than emit a misaligned clip.
      return { started: false, x: 0, y: 0, width: 0, height: 0 };
    }
  })();
}

/**
 * Trusted click at viewport coordinates (CDP input). Web players require
 * transient user activation to boot/play; synthetic in-page .click() events
 * carry none, so facades must be clicked here, Node side. Both real backends
 * (local puppeteer-core, Cloudflare puppeteer) expose .mouse; mock backends
 * do not, in which case this returns false and the facade keeps cover art.
 */
async function trustedClick(page: BrowserPage, x: number, y: number): Promise<boolean> {
  const raw = page as unknown as {
    clickAt?: (x: number, y: number) => Promise<void>;
    mouse?: { click?: (x: number, y: number) => Promise<void> };
  };
  try {
    if (typeof raw.clickAt === "function") {
      await raw.clickAt(x, y);
      return true;
    }
    if (raw.mouse && typeof raw.mouse.click === "function") {
      await raw.mouse.click(x, y);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Trusted Escape keypress (CDP input). Shadow-hosted player modals do not
 * hear synthetic document-level key events, but a real keypress propagates
 * through the focused element's composed path. Best effort.
 */
async function trustedEscape(page: BrowserPage): Promise<void> {
  const raw = page as unknown as {
    keyboard?: { press?: (key: string) => Promise<void> };
  };
  try {
    if (raw.keyboard && typeof raw.keyboard.press === "function") {
      await raw.keyboard.press("Escape");
      return;
    }
  } catch {
    // Fall through to the synthetic in-page dismiss below.
  }
  try {
    await evaluateWithTimeout(page, toInPageScript(dismissVideoPlayer), 10_000);
  } catch {
    // A stuck modal only affects shots already taken (this block is last).
  }
}

/**
 * Click-to-play capture, step 3 of 3: dismiss any player/modal the facade
 * click opened so later shots see a clean page. Best effort — a stuck modal
 * only affects shots already taken (video clips run last).
 */
export function dismissVideoPlayer(): Promise<boolean> {
  return (async () => {
    const pause = (ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    // Pull focus out of a player iframe first: with focus trapped inside an
    // out-of-process frame, neither trusted CDP keypresses nor synthetic
    // document events reach the modal's own Escape handling.
    try {
      const active = document.activeElement as HTMLElement | null;
      if (active && typeof active.blur === "function") active.blur();
      const body = document.body as HTMLElement | null;
      if (body && typeof body.focus === "function") body.focus();
    } catch {
      // Focus juggling is best effort.
    }
    try {
      const event = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
      document.dispatchEvent(event);
    } catch {
      // Dismissal is best effort.
    }
    await pause(500);
    try {
      const selector = 'iframe[src*="vimeo"], iframe[src*="youtube"], iframe[src*="youtu.be"], video';
      const roots: Array<Document | ShadowRoot> = [document];
      try {
        for (const host of Array.from(document.querySelectorAll("vimeo-video, lite-youtube-embed, lite-vimeo-embed, [data-video]") || [])) {
          try {
            const shadow = (host as Element).shadowRoot;
            if (shadow) roots.push(shadow as unknown as ShadowRoot);
          } catch {
            // Closed shadow roots throw on access; skip them.
          }
        }
      } catch {
        // Fall through to the document-only check below.
      }
      for (const root of roots) {
        let players: Array<Element> = [];
        try {
          players = Array.from(root.querySelectorAll(selector) || []);
        } catch {
          continue;
        }
        for (const player of players) {
          let rect: { width: number; height: number } | null = null;
          try {
            rect = player.getBoundingClientRect();
          } catch {
            continue;
          }
          try {
            const tag = String((player as Element).tagName || "").toUpperCase();
            if (tag === "VIDEO" && (player as HTMLVideoElement).readyState < 2) continue;
          } catch {
            continue;
          }
          if (rect.width > 120 && rect.height > 120) return false;
        }
      }
    } catch {
      return true;
    }
    return true;
  })();
}

export interface IsolatedVideoShot {
  started: boolean;
  kind: ScreenshotKind;
  bytes: number;
  data: Uint8Array;
}

/**
 * Isolated stream render (CF22): last-resort tier for facades whose direct
 * player stream never played in the site context (bot-gated SDK, dead
 * IntersectionObserver). Renders the autoplay player URL in a clean,
 * site-free page — no facade DOM, no smooth-scroll hijack, no modal — and
 * polls screenshots for motion: the first pair of differing frames proves
 * playback and the later frame is returned. Identical bytes throughout mean
 * static/blank (gated even isolated): reported unstarted, never emitted.
 *
 * Adaptive dwell: fast streams resolve after ~4s; slow boots under a
 * saturated connection earn up to ~10s instead of failing at a fixed 5s.
 * One tab at a time (Trap 3): the caller closes the site page BEFORE opening
 * this one, and this page is always closed before returning. Bounded: 15s
 * navigation cap, <= 6 screenshots, byte-compare only (no Worker encoding).
 * Returns null when the isolated page itself cannot be built or loaded.
 */
export async function renderIsolatedVideoShot(
  session: AnalysisSession,
  streamUrl: string,
  options: { quality?: number } = {},
): Promise<IsolatedVideoShot | null> {
  const quality = options.quality ?? LIMITS.screenshotQuality;
  let page: BrowserPage | null = null;
  try {
    page = await session.newPage();
  } catch {
    return null;
  }
  try {
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(streamUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const kinds: ScreenshotKind[] = ["webp", "jpeg"];
    let kind: ScreenshotKind = "webp";
    let previous: Uint8Array | null = null;
    for (const type of kinds) {
      try {
        previous = toBytes(await page.screenshot({ type, quality }));
        kind = type;
        break;
      } catch {
        // Try the next encoding.
      }
    }
    if (!previous) return null;
    // Motion poll: saturating pages boot player streams late; a fixed dwell
    // fails them just before the first frame. Compare consecutive pairs up
    // to ~10s; the first difference is playback, all-identical is gated.
    const pollStarted = Date.now();
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      let current: Uint8Array | null = null;
      try {
        current = toBytes(await page.screenshot({ type: kind, quality }));
      } catch {
        return null;
      }
      if (!framesEqual(previous, current)) {
        return { started: true, kind, bytes: current.byteLength, data: current };
      }
      previous = current;
      if (Date.now() - pollStarted >= 7500) {
        // Same bytes ~10s after load: a blank/gated player, not motion. The
        // poster's cover art (already captured) stands in; no misleading
        // clip is emitted.
        return { started: false, kind, bytes: 0, data: new Uint8Array(0) };
      }
    }
  } catch {
    return null;
  } finally {
    try {
      await page.close();
    } catch {
      // Close is best effort; a leaked tab dies with the session.
    }
  }
}

/** Byte-compare two frames: equal length and every byte equal. */
function framesEqual(first: Uint8Array, second: Uint8Array): boolean {
  if (first.byteLength !== second.byteLength) return false;
  for (let i = 0; i < first.byteLength; i += 1) {
    if (first[i] !== second[i]) return false;
  }
  return true;
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

  // CF29 Phase 0 timing accumulators (measurement only).
  const captureStartedAt = Date.now();
  let navMs = 0;
  let settleMs = 0;
  let snapshotMs = 0;
  let rotationMs = 0;
  let lazySweepMs = 0;
  let fullPageShotMs = 0;
  let sectionShotsMs = 0;
  let facadeVideoMs = 0;
  let nativeVideoMs = 0;
  let nativeRemasures = 0;
  let nativeRemasureMaxPx = 0;

  await page.setViewport({
    width: options.viewportWidth,
    height: 900,
    deviceScaleFactor: LIMITS.deviceScaleFactor,
  });

  // Slow, tracker-heavy pages (e.g. Shopify with 90+ scripts) may never reach
  // network idle: on a navigation *timeout*, fall back once to domcontentloaded
  // so slow sites yield a partial report instead of a 502. Non-timeout errors
  // (refused, blocked, DNS) rethrow immediately.
  const navStart = Date.now();
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
  navMs = Date.now() - navStart;

  const settleStart = Date.now();
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
    // yields a half-empty capture. Bounded to <= 40 bands x 400ms (~16s).
    // Media-heavy pages (video/canvas heroes) hydrate late: they earn a
    // longer bottom pause plus a longer top settle below. Image-heavy pages
    // (e.g. figma.com with 40+ lazy Sanity CDN images, many as CSS
    // backgrounds invisible to document.images) earn the same: dogfood showed
    // blank card regions with only a 500ms bottom + 900ms top settle.
    // Plain pages pay a modest extra (~+1.5s) for the longer settle.
    const hasMedia = (() => {
      try {
        return (
          document.querySelectorAll("video").length > 0 || document.querySelectorAll("canvas").length > 0
        );
      } catch {
        return false;
      }
    })();
    const hasManyImages = (() => {
      try {
        return (document.images?.length ?? 0) > 20;
      } catch {
        return false;
      }
    })();
    const needsLongSettle = hasMedia || hasManyImages;
    const step = Math.floor(viewport * 0.8);
    let y = 0;
    let bands = 0;
    while (y < docHeight() && bands < 40) {
      window.scrollTo(0, y);
      await pause(400);
      y += step;
      bands += 1;
    }
    window.scrollTo(0, docHeight());
    await pause(needsLongSettle ? 2000 : 1200);

    // Pass 2: wait for images to finish decoding (<= 12 x 300ms). CSS
    // background-images never appear in document.images, so image-heavy
    // pages earn one extra unconditional settle below for CDN lazies.
    const images = Array.from(document.images || []);
    for (let pass = 0; pass < 12; pass += 1) {
      const pending = images.some(
        (img) => !img.complete || (img.naturalWidth === 0 && Boolean(img.currentSrc)),
      );
      if (!pending) break;
      await pause(300);
    }
    if (hasManyImages) {
      await pause(1000);
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
    // Settling at the top re-hides some scroll-triggered reveals, so the
    // pause here must cover re-paint of above-fold lazy content instead.
    window.scrollTo(0, 0);
    await pause(needsLongSettle ? 2500 : 1800);
    return docHeight();
  }));
  settleMs = Date.now() - settleStart;

  const snapshotStart = Date.now();
  const snapshot = await evaluateWithTimeout(
    page,
    collectPageSnapshot,
    LIMITS.perPageExtractionBudgetMs,
  );
  snapshotMs = Date.now() - snapshotStart;

  // Static fail-closed check on the post-navigation URL. Cross-host public
  // redirects are allowed here; the pipeline revalidates them via DoH.
  assertSafeFinalUrl(snapshot);

  // Rotation re-sample (homepage only): wait, re-read h1-h3 texts, diff.
  // Runs before screenshots so captures show the settled state. A repeat
  // read that matches proves nothing about slower rotations — the analysis
  // records that honesty in limitations.
  let rotatingText: SnapshotRotatingText[] = [];
  let rotationChecked = false;
  if (options.detectRotationMs !== undefined && options.detectRotationMs > 0) {
    const rotationStart = Date.now();
    rotationChecked = true;
    try {
      const before = labelSnapshotHeadings(snapshot.headings);
      await new Promise((resolve) => setTimeout(resolve, options.detectRotationMs));
      const after = await evaluateWithTimeout(page, collectHeadingTexts, 10_000);
      rotatingText = diffRotatingText(before, after ?? []);
    } catch {
      warnings.push("Rotation re-sample failed; rotating hero text, if any, is undetected.");
    }
    rotationMs = Date.now() - rotationStart;
  }

  // Lazy-media sweep: force un-started lazy images into view so they decode,
  // and force videos to a real paused frame, before the full-page shot. Runs
  // after the snapshot (extraction already collected) and costs nothing when
  // everything already settled.
  const lazyStart = Date.now();
  try {
    const sweep = await evaluateWithTimeout(page, ensureLazyMediaLoaded, 45_000);
    const record = (typeof sweep === "object" && sweep !== null ? sweep : {}) as Record<string, unknown>;
    const pending = Number(record.pending ?? 0);
    const failed = Number(record.failed ?? 0);
    const videosPending = Number(record.videosPending ?? 0);
    if (Number.isFinite(pending) && pending > 0) {
      warnings.push(
        Number.isFinite(failed) && failed > 0
          ? `${pending} image(s) were still unloaded at capture (${failed} failed to load); those regions may appear blank in screenshots.`
          : `${pending} image(s) were still unloaded at capture; those regions may appear blank in screenshots.`,
      );
    }
    if (Number.isFinite(videosPending) && videosPending > 0) {
      warnings.push(
        `${videosPending} video(s) had no playable frame at capture; those regions may appear blank in screenshots.`,
      );
    }
  } catch {
    warnings.push("Lazy-image settle sweep failed; below-fold images may appear blank.");
  }
  lazySweepMs = Date.now() - lazyStart;

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

  const fullShotStart = Date.now();
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
  fullPageShotMs = Date.now() - fullShotStart;

  // Section-clipped screenshots (PRD screenshot policy): homepage only,
  // bounded by maxSectionShots (6) and the remaining byte budget. Chromium
  // encodes each clip; the Worker never transforms the bytes.
  const sectionStart = Date.now();
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

  sectionShotsMs = Date.now() - sectionStart;

  // Video playing-state captures (CF21): runs LAST so a stuck player modal
  // can only affect shots already taken. AUTOPLAY-FIRST per facade: scroll
  // the facade into view and clip it when its own scroll-triggered playback
  // starts (figma-style muted/loop players need no click, and clicking one
  // opens a watch-URL modal that stays white headless). Facades with a
  // resolvable direct stream that never play on scroll are DEFERRED (CF22):
  // no click (proven to white-modal), the pipeline renders the stream
  // isolated instead. Only facades with no resolvable stream fall back to
  // the trusted click-to-play path (CDP input carries the user activation
  // web players require), then Escape dismisses the modal. When the facade
  // list runs dry, the carousel pager (CF24) turns video-grid next-arrows
  // and re-scans for freshly hydrated facades (bounded turns). Facades that
  // never play keep their cover art; they are counted, not thrown. Local
  // audio is muted at launch. AFTER facades, the native pass (CF28)
  // force-plays laid-out bare <video> elements muted (facade loop never
  // sees them) and clips the playing ones via the same helper.
  const videoShots: SectionShot[] = [];
  const pendingVideoStreams: Array<{ label: string; streamUrl: string; rectY: number; rectHeight: number; rectX: number; rectWidth: number }> = [];
  const videoCap = Math.min(options.maxVideoShots ?? 0, LIMITS.maxVideoShots);
  /** Carousel page-turns per capture (CF24): each turn re-renders the grid for fresh facades. */
  const MAX_VIDEO_PAGE_TURNS = 3;
  if (screenshotKind && videoCap > 0) {
    let videoBudget = maxBytes - (screenshot?.byteLength ?? 0) - sectionShots.reduce((total, shot) => total + shot.bytes, 0);
    let unstarted = 0;
    const seenIds = new Set<string>();
    const seenStreams = new Set<string>();
    let vi = 0;
    let turns = 0;
    // True while the current grid state may still hold unprocessed facades.
    // A page-turn resets it; if the rescan finds nothing unseen, the carousel
    // is looping and further turns are refused (re-renders mint fresh uids
    // for identical content, so element identity alone cannot stop it).
    let freshFound = true;
    let freshProcessed = 0;
    // Viewport clip WITHOUT captureBeyondViewport: player rects arrive
    // in viewport coordinates (scrolled into view in-page), and
    // out-of-process iframes can composite blank in beyond-viewport
    // captures while painting fine in viewport ones. Returns "taken" when
    // a shot was stored (or the rect was too small to bother), "dropped"
    // when the byte budget gave out (caller breaks the facade loop).
    // Stored y/height are the facade's PAGE placement rect (for compositing
    // over section shots), not the viewport clip rect used below. Shared
    // by the facade loop and the CF28 native pass.
    const clipPlayer = async (
      player: BootedVideoPlayer,
      label: string,
      target: FacadeClickTarget,
    ): Promise<"taken" | "dropped"> => {
      const clipY = Math.min(player.y, clipHeight - 1);
      const clipH = Math.min(player.height, clipHeight - clipY);
      if (clipH < 50) return "taken";
      const clipX = Math.max(Math.min(player.x, options.viewportWidth - 1), 0);
      const clipW = Math.min(player.width, options.viewportWidth - clipX);
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
            clip: { x: clipX, y: clipY, width: clipW, height: clipH },
          });
          taken = toBytes(buffer);
          takenKind = type;
          break;
        } catch {
          warnings.push(`Playing-state video screenshot ${vi + 1} as ${type} failed.`);
        }
      }
      if (taken && takenKind && taken.byteLength <= videoBudget) {
        const facadeBox = Number.isFinite(target.rectY) && Number.isFinite(target.rectX)
          && target.rectHeight > 0 && target.rectWidth > 0;
        videoShots.push({
          kind: takenKind,
          bytes: taken.byteLength,
          y: Number.isFinite(target.rectY) ? target.rectY : player.y,
          height: target.rectHeight > 0 ? target.rectHeight : player.height,
          heading: `video: ${label}`,
          data: taken,
          streamUrl: String(target.streamUrl || ""),
          ...(facadeBox
            ? { placement: { x: target.rectX, y: target.rectY, width: target.rectWidth, height: target.rectHeight } }
            : {}),
        });
        videoBudget -= taken.byteLength;
        return "taken";
      }
      if (taken) {
        warnings.push(`Playing-state video screenshot ${vi + 1} dropped: byte budget exhausted.`);
        return "dropped";
      }
      return "taken";
    };
    // Hard iteration bound (real lists end via "none"; keeps pathological
    // ever-growing DOMs from spinning).
    const facadeStart = Date.now();
    let guard = videoCap * 4 + 8;
    while (videoShots.length + pendingVideoStreams.length < videoCap && guard > 0) {
      guard -= 1;
      if (videoBudget <= 0) break;
      let target: FacadeClickTarget | null = null;
      try {
        target = await evaluateWithTimeout<FacadeClickTarget | null>(page, facadeClickScript(vi), 20_000);
      } catch {
        warnings.push(`Video ${vi + 1} facade lookup timed out; its cover art stands in.`);
        break;
      }
      if (!target || target.status === "none") {
        // Carousel pager (CF24): grids hydrate/paginate a few cards at a
        // time, so a dry list may just mean "turn the page". Trusted-click a
        // next-arrow serving a video grid, then re-scan from the top —
        // already-seen facades are skipped below. Refused when the previous
        // turn yielded nothing unseen (looping carousel), and bounded in
        // turns regardless; screenshots are already taken, so a stray
        // page-turn harms nothing.
        if (turns >= MAX_VIDEO_PAGE_TURNS || !freshFound) break;
        let next: CarouselNextTarget | null = null;
        try {
          next = await evaluateWithTimeout<CarouselNextTarget | null>(page, pageVideoCarouselScript(), 20_000);
        } catch {
          break;
        }
        if (!next || next.status === "none") break;
        if (!(await trustedClick(page, next.x, next.y))) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
        turns += 1;
        freshFound = false;
        vi = 0;
        continue;
      }
      // Skip already-processed facades: element uids are stable across
      // re-queries, and stream URLs are stable across carousel re-renders
      // (which mint fresh uids for identical content — element identity alone
      // cannot stop a looping carousel from deferring the same streams).
      // Facades with neither process by index as before.
      const fid = target.uid || "";
      const fstream = String(target.streamUrl || "");
      if ((fid !== "" && seenIds.has(fid)) || (fstream !== "" && seenStreams.has(fstream))) {
        vi += 1;
        continue;
      }
      if (fid !== "") seenIds.add(fid);
      if (fstream !== "") seenStreams.add(fstream);
      freshFound = true;
      freshProcessed += 1;
      // Autoplay-first: no click, no modal, no dismiss needed. Facades with
      // a resolvable stream earn only a quick probe: the full poll never
      // succeeds on bot-gated players, and the isolated tier renders the
      // same content — probing cheaply funds that tier within wall budget.
      let autoplay: BootedVideoPlayer | null = null;
      try {
        const quickProbe = String(target.streamUrl || "").length > 0;
        autoplay = await evaluateWithTimeout<BootedVideoPlayer | null>(page, autoplayVideoScript(vi, quickProbe), 20_000);
      } catch {
        autoplay = null;
      }
      if (autoplay && autoplay.started && autoplay.width >= 120 && autoplay.height >= 120) {
        if ((await clipPlayer(autoplay, target.label, target)) === "dropped") break;
        vi += 1;
        continue;
      }
      // Resolvable stream that never played in the site context: defer to
      // the isolated player render (CF22) instead of clicking — the click
      // boots a watch-URL modal that stays white headless, while the direct
      // player endpoint renders real frames. Facades with no resolvable
      // stream keep the click fallback below.
      const deferredStream = String(target.streamUrl || "").slice(0, 500);
      if (deferredStream) {
        pendingVideoStreams.push({
          label: target.label,
          streamUrl: deferredStream,
          rectY: Number.isFinite(target.rectY) ? target.rectY : 0,
          rectHeight: target.rectHeight > 0 ? target.rectHeight : 0,
          rectX: Number.isFinite(target.rectX) ? target.rectX : 0,
          rectWidth: target.rectWidth > 0 ? target.rectWidth : 0,
        });
        vi += 1;
        continue;
      }
      let player: BootedVideoPlayer | null = null;
      let clicked = false;
      try {
        clicked = await trustedClick(page, target.x, target.y);
        if (!clicked) {
          unstarted += 1;
          vi += 1;
          continue;
        }
        // Stream forcing happens inside the wait below (per-candidate, after
        // the modal exists); nothing to do here but wait for the boot.
        player = await evaluateWithTimeout<BootedVideoPlayer | null>(page, toInPageScript(awaitVideoPlayer), 25_000);
      } catch {
        warnings.push(`Video ${vi + 1} click-to-play timed out; its cover art stands in.`);
        break;
      }
      if (!player || !player.started || player.width < 120 || player.height < 120) {
        unstarted += 1;
        vi += 1;
        continue;
      }
      if ((await clipPlayer(player, target.label, target)) === "dropped") {
        await trustedEscape(page);
        break;
      }
      await trustedEscape(page);
      try {
        await evaluateWithTimeout(page, toInPageScript(dismissVideoPlayer), 10_000);
      } catch {
        // A stuck modal only affects shots already taken (this block is last).
      }
      vi += 1;
    }
    facadeVideoMs = Date.now() - facadeStart;
    const nativeStart = Date.now();
    // Native-video pass (CF28): bare <video> elements never enter the
    // facade loop above (no click affordance, no deferrable stream), so
    // facade-only pages with laid-out players report zero video. After
    // facades are exhausted, force-play laid-out natives muted and clip
    // the playing ones. Shares the cap, byte budget, stream dedup, and
    // clip helper with the facade path; silence when absent.
    if (videoShots.length + pendingVideoStreams.length < videoCap) {
      let ni = 0;
      let nativeTaken = 0;
      let nativeGuard = videoCap * 2 + 4;
      while (videoShots.length + pendingVideoStreams.length < videoCap && nativeGuard > 0) {
        nativeGuard -= 1;
        if (videoBudget <= 0) break;
        let native: NativeVideoTarget | null = null;
        try {
          native = await evaluateWithTimeout<NativeVideoTarget | null>(page, nativeVideoScript(ni), 20_000);
        } catch {
          warnings.push(`Native video ${ni + 1} lookup timed out; its cover art stands in.`);
          break;
        }
        if (!native || native.status === "none") break;
        ni += 1;
        const nstream = String(native.streamUrl || "");
        if (nstream !== "" && seenStreams.has(nstream)) continue;
        if (!native.started || native.width < 120 || native.height < 120) {
          // Reachable-but-stalled players count into the honest shortfall;
          // unreachable duplicates (empty stream) skip silently so the
          // visible instance for the same file still gets its turn.
          if (nstream !== "") unstarted += 1;
          continue;
        }
        if ((await clipPlayer(native, native.label, native)) === "dropped") break;
        // Stale-clip guard: the page may have moved between measure and
        // screenshot (snap points, SPA scroll-on-play), landing the clip on
        // the wrong band. Re-read scrollY; on a move, discard the
        // mis-framed shot (refunding bytes) and take one fresh attempt with
        // re-measured coordinates. Skipped when the target carries no
        // scroll reading (unit fixtures).
        const measuredScroll = Number(native.scrollY);
        if (Number.isFinite(measuredScroll)) {
          let scrolled = measuredScroll;
          try {
            const check = await evaluateWithTimeout<number | null>(page, nativeScrollScript(), 10_000);
            if (typeof check === "number" && Number.isFinite(check)) scrolled = check;
          } catch {
            // An unreadable scroll is not evidence of a move; keep the shot.
          }
          if (Math.abs(scrolled - measuredScroll) > 2) {
            const movedBy = Math.abs(scrolled - measuredScroll);
            if (movedBy > nativeRemasureMaxPx) nativeRemasureMaxPx = movedBy;
            const popped = videoShots.pop();
            if (popped) videoBudget += popped.bytes;
            warnings.push(`Native video '${native.label.slice(0, 60)}' moved during capture; re-measured once.`);
            nativeRemasures += 1;
            let retry: NativeVideoTarget | null = null;
            try {
              retry = await evaluateWithTimeout<NativeVideoTarget | null>(page, nativeVideoRemeasureScript(ni - 1), 20_000);
            } catch {
              retry = null;
            }
            if (retry && retry.status !== "none" && retry.started && retry.width >= 120 && retry.height >= 120) {
              const rstream = String(retry.streamUrl || "");
              if (rstream !== "") seenStreams.add(rstream);
              if ((await clipPlayer(retry, retry.label, retry)) === "dropped") break;
              nativeTaken += 1;
            } else {
              unstarted += 1;
            }
            continue;
          }
        }
        if (nstream !== "") seenStreams.add(nstream);
        nativeTaken += 1;
      }
      if (nativeTaken > 0) {
        warnings.push(
          `${nativeTaken} native video(s) captured playing-state via muted force-play; composited over their bands in section screenshots.`,
        );
      }
    }
    if (unstarted > 0) {
      warnings.push(
        `${unstarted} video(s) did not start (autoplay, click-to-play, or native force-play); those regions show their cover art, not playing frames.`,
      );
    }
    if (turns > 0) {
      warnings.push(
        `Paged the video carousel ${turns} time(s); ${freshProcessed} video facade(s) processed in total.`,
      );
    }
    // Beyond-cap honesty: the loop simply ends at the cap, so further
    // facades would vanish silently. One extra lookup reports them. Only
    // probed when the cap actually filled (shots + deferred streams).
    if (videoShots.length + pendingVideoStreams.length >= videoCap && videoCap > 0) {
      try {
        const extra = await evaluateWithTimeout<FacadeClickTarget | null>(page, facadeClickScript(videoCap), 20_000);
        if (extra && extra.status !== "none") {
          warnings.push(
            `More video facades exist beyond the ${videoCap}-clip cap; those regions show their cover art, not playing frames.`,
          );
        }
      } catch {
        // Probe is best effort; an unknown remainder stays unreported rather
        // than reported wrongly.
      }
    }
    nativeVideoMs = Date.now() - nativeStart;
  }

  return {
    snapshot,
    screenshot,
    screenshotBytes: screenshot?.byteLength ?? 0,
    screenshotKind,
    sectionShots,
    videoShots,
    pendingVideoStreams,
    pageHeightPx,
    warnings,
    rotatingText,
    rotationChecked,
    timings: {
      navMs,
      settleMs,
      snapshotMs,
      rotationMs,
      lazySweepMs,
      fullPageShotMs,
      sectionShotsMs,
      facadeVideoMs,
      nativeVideoMs,
      nativeRemasures,
      nativeRemasureMaxPx,
      isolatedVideoMs: 0,
      totalMs: Date.now() - captureStartedAt,
    },
  };
}
