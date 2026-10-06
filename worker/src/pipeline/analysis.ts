import { capturePage, renderIsolatedVideoShot, type CaptureResult, type CaptureTimings, type SectionShot, type ShotPayload } from "../browser/capture";
import type {
  PageSnapshot,
  SnapshotAsset,
  SnapshotBreakpoints,
  SnapshotCollectionCoverage,
  SnapshotContent,
  SnapshotEmbed,
  SnapshotGeometry,
  SnapshotHoverState,
  SnapshotMotion,
  SnapshotSection,
  SnapshotLayoutSample,
  SnapshotSectionLayout,
  SnapshotSemanticStyle,
  SnapshotSocial,
  SnapshotTokens,
  SnapshotTypography,
  SnapshotVideo,
} from "../browser/snapshot-script";
import type { AnalysisSession, SessionLauncher, WaitUntil } from "../browser/types";
import { LIMITS, SCHEMA_VERSION } from "../config/limits";
import { discoverCandidates } from "../discovery/discover";
import type { DiscoveryResult } from "../discovery/types";
import { humanizeSegment } from "../discovery/paths";
import { ApiError } from "../http/errors";
import { collectFontAssets, fetchVimeoThumbnailUrl, rehydrateAssets, vimeoVideoId } from "./rehydrate-assets";
import { buildSelection, type SelectionReport } from "../ranking/key-pages";
import type { AnalyzeRequest } from "../validation/analyze-request";
import { assertPublicTarget, parseHttpUrl } from "../validation/url";

export interface AnalysisScreenshot {
  kind: string;
  bytes: number;
  width: number;
  height: number;
  dataUrl?: string;
  /** Human label for playing-state video clips (e.g. "video: Demo"). */
  label?: string;
  /** Resolved stream URL a playing-state video clip came from ("" when unresolved). */
  streamUrl?: string;
  /** Page-Y placement of a playing-state clip (facade box), for compositing over section shots. */
  y?: number;
  /**
   * Full on-page box a playing-state frame belongs to. The client compositor
   * draws the frame here; set on section shots after compositing.
   */
  placement?: { x: number; y: number; width: number; height: number };
  /** True when a section shot already contains composited video still(s). */
  composited?: boolean;
}

export interface AnalysisNavLink {
  text: string;
  href: string;
}

/**
 * CF25: a deferred video facade that never produced a playing-state clip.
 * Carries the facade placement rect so a fetched thumbnail can stand in over
 * the blank band in section shots.
 */
export interface VideoPlaceholder {
  label: string;
  streamUrl: string;
  rectX: number;
  rectY: number;
  rectWidth: number;
  rectHeight: number;
  reason: "wall" | "bytes" | "load" | "motion";
}

export interface AnalysisNav {
  header: AnalysisNavLink[];
  primary: AnalysisNavLink[];
  footer: AnalysisNavLink[];
}

export interface AnalysisPage {
  url: string;
  path: string;
  title: string;
  metaDescription: string | null;
  lang: string | null;
  direction: string | null;  pageType: string;
  isHomepage: boolean;
  selected: boolean;
  priority: number | null;
  selectedBecause: string;
  headings: { level: number; text: string }[];
  linkCount: number;
  navLinkCount: number;
  pageCanvasColor: string | null;  nav: AnalysisNav;
  responsiveComparison: ResponsiveComparison;
  viewport: { width: number; height: number };
  layoutSamples: SnapshotLayoutSample[];
  semanticStyles: SnapshotSemanticStyle[];
  coverage: Record<string, SnapshotCollectionCoverage>;
  sectionCount: number;
  sections: SnapshotSection[];
  formCount: number;
  imageCount: number;
  domElementCount: number;
  extractionBytes: number;
  pageHeightPx: number;
  screenshot: AnalysisScreenshot | null;
  mobileScreenshot: AnalysisScreenshot | null;
  sectionShots: AnalysisScreenshot[];
  /** Playing-state clips of video facades, autoplay-first (CF21, homepage only). */
  videoShots: AnalysisScreenshot[];
  /**
   * Fetched fallback thumbnails for facades that never played (CF25,
   * homepage only). Honest stand-ins, never motion-verified: composited over
   * blank bands and labeled `thumbnail:`, not `video:`.
   */
  videoThumbnails: AnalysisScreenshot[];
  warnings: string[];
  tokens: SnapshotTokens;
  typography: SnapshotTypography;
  breakpoints: SnapshotBreakpoints;
  motion: SnapshotMotion;
  geometry: SnapshotGeometry;
  limitations: string[];
  observedInteractions: { kind: string; detail: string }[];
  hoverStates: SnapshotHoverState[];
  embeds: SnapshotEmbed[];
  videos: SnapshotVideo[];
  sectionLayouts: SnapshotSectionLayout[];
  social: SnapshotSocial;
  formActions: string[];
  content: SnapshotContent;
  assets: SnapshotAsset[];
}

export interface ResponsiveComparison {
  status: "captured" | "dom-only" | "not-requested" | "budget-skipped" | "capture-failed";
  desktopViewport: { width: number; height: number };
  mobileViewport: { width: number; height: number } | null;
  sectionHeadingsAdded: string[];
  sectionHeadingsMissing: string[];
  countDeltas: { headings: number; sections: number; forms: number; images: number; controls: number } | null;
  layoutChanges: Array<{
    role: string;
    desktop: SnapshotLayoutSample | null;
    mobile: SnapshotLayoutSample | null;
    changed: boolean;
  }>;
  note: string;
}

export interface AnalysisDiscovery {
  robotsFound: boolean;
  sitemapUrlCount: number;
  sitemapsChecked: string[];
  navLinkCount: number;
}

export interface AnalysisResult {
  schemaVersion: string;
  backend: string;
  request: {
    url: string;
    origin: string;
    hostname: string;
    maxPages: number;
    includeMobile: boolean;
    resolvedIps: string[];
  };
  pages: AnalysisPage[];
  discovery: AnalysisDiscovery | null;
  selection: SelectionReport | null;
  issues: string[];
  warnings: string[];
  limitations: string[];
  pagesDiscovered: number;
  pagesSelected: number;
  pagesAnalyzed: number;
  screenshotsCaptured: number;
  screenshotBytesTotal: number;
  browserSecondsUsed: number;
  integrityPassed: boolean;
  assets: SnapshotAsset[];
  assetCount: number;
  /**
   * CF29 Phase 0: per-phase browser-time attribution summed across every
   * capture in the run. Measurement only; omit when no capture ran.
   */
  timings?: CaptureTimings;
}

export interface AnalysisProgress {
  phase: "launching" | "homepage" | "discovery" | "selection" | "page" | "mobile" | "packaging" | "done";
  message: string;
  current?: number;
  total?: number;
  path?: string;
}

export interface AnalysisOptions {
  encodeBase64?: (bytes: Uint8Array) => string;
  /**
   * Extract-only mode (`?screenshots=0`): skip every screenshot, video clip,
   * mobile capture, and asset binary download. Observations, tokens, and
   * DOM-only comparisons still run. Defaults to true (full capture).
   */
  screenshots?: boolean;
  /**
   * Capture profile (CF32): `"full"` is the most capable build (local
   * Chromium — opened-up wall and byte budgets, full video cap);
   * `"lite"` is the compromised hosted build (free-tier wall/bytes, video
   * diet, honest limitations). Defaults to `"full"`; the Worker route
   * passes `"lite"`, the local server passes `"full"`.
   */
  capture?: "full" | "lite";
  maxInlineImageBytes?: number;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  onProgress?: (event: AnalysisProgress) => void;
  /** Homepage rotation re-sample delay in ms; unset disables the check. */
  detectRotationMs?: number;
    /**
     * Override for the total analysis wall budget in ms (tests force
     * wall-skips with 0). Otherwise the capture profile default applies
     * (free-tier wall for lite, opened-up wall for full).
     */
    wallBudgetMs?: number;
}

// Bot-verification challenges (CAPTCHAs, sliders, rate walls) are never
// solved or bypassed. They are recognized so the run stops burning browser
// budget on repeated pictures of the same slider: the signal is
// challenge-specific wording in a page with almost no real content.
const CHALLENGE_PATTERNS = [
  /verify you are (a )?human/i,
  /human verification/i,
  /access verification/i,
  /are you a robot/i,
  /slide to (complete|verify)/i,
  /complete the (verification|puzzle|challenge)/i,
  /just a moment/i,
  /checking your browser/i,
  /attention required/i,
  /unusual traffic/i,
  /geetest|recaptcha|cf-challenge|turnstile|perimeterx|datadome|kasada|arkose|funcaptcha/i,
];

export function isChallengeSnapshot(snapshot: PageSnapshot): boolean {
  const blocks = snapshot.content?.blocks ?? [];
  if (blocks.length > 10) return false;
  const haystack = [snapshot.title, ...blocks.map((block) => block.text)]
    .join("\n")
    .slice(0, 2000);
  return CHALLENGE_PATTERNS.some((pattern) => pattern.test(haystack));
}

// Inline cap for screenshot previews. Only environments that supply an
// encoder inline at all (local dev via Node); hosted responses never inline
// (Trap 4). Matching the total-bytes cap means every locally captured
// screenshot is viewable and ZIP-able.
const DEFAULT_MAX_INLINE_BYTES = LIMITS.maxTotalScreenshotBytes;

export async function runAnalysis(
  launcher: SessionLauncher,
  request: AnalyzeRequest,
  options: AnalysisOptions = {},
): Promise<AnalysisResult> {
  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  const progress = options.onProgress ?? ((): void => undefined);
  const report = (event: AnalysisProgress): void => {
    try {
      progress(event);
    } catch {
      // Progress reporting must never break the analysis.
    }
  };
  const warnings: string[] = [];
  const issues: string[] = [];
  const limitations: string[] = [];
  const pages: AnalysisPage[] = [];
  const wantScreenshots = options.screenshots !== false;
  // CF32 two-tier budgets: local full capture gets opened-up wall/byte
  // budgets (guardrails, not targets); hosted lite keeps free-tier
  // discipline plus the video diet below. Tests that force wall-skips pass
  // wallBudgetMs explicitly and are unaffected.
  const liteCapture = options.capture === "lite";
  const wallBudgetMs = options.wallBudgetMs
    ?? (liteCapture ? LIMITS.totalAnalysisWallBudgetMs : LIMITS.totalAnalysisWallBudgetMs * 4);
  const screenshotByteBudget = liteCapture
    ? LIMITS.maxTotalScreenshotBytes
    : LIMITS.maxTotalScreenshotBytes * 2.5;
  const maxVideoShotsCap = liteCapture ? LIMITS.maxVideoShotsLite : LIMITS.maxVideoShots;
  // CF33: hosted-lite navigates on domcontentloaded (skip the networkidle2
  // firehose-track that burns the free CPU); full capture keeps
  // networkidle2+retry. Threaded into every captureOne call below.
  const navWait: WaitUntil | undefined = liteCapture ? "domcontentloaded" : undefined;
  if (liteCapture) {
    limitations.push(
      `Hosted lite capture: navigates on domcontentloaded without waiting for network idle (late-loading media may appear blank), video clips capped at ${LIMITS.maxVideoShotsLite} per homepage (full: ${LIMITS.maxVideoShots}); run locally for the full-fidelity pack.`,
    );
  }
  if (!wantScreenshots) {
    limitations.push(
      "Extract-only mode (`?screenshots=0`): no screenshots, video clips, mobile captures, or asset binaries were taken; observations, tokens, and DOM-only comparisons are complete.",
    );
  }

  let discovery: DiscoveryResult | null = null;
  let selection: SelectionReport | null = null;
  let homepageSnapshot: PageSnapshot | null = null;
  let homepagePlaceholders: VideoPlaceholder[] = [];
  let homepagePath = "/";
  let screenshotBytesTotal = 0;
  let screenshotsCaptured = 0;
  let budgetNotice = false;
  const captureTimings: CaptureTimings[] = [];

  const session = await launcher.launch();
  let homepageSucceeded = false;
  let homepageChallenged = false;
  let desktopTaken = 0;
  let mobileTaken = 0;
  let oversizePages = 0;

  try {
    const homepageUrl = request.target.url.toString();

    report({ phase: "launching", message: "Opening browser session…" });
    try {
      report({ phase: "homepage", message: "Capturing the homepage…", current: 1, total: 1, path: "/" });
      const homepage = await captureOne(session, homepageUrl, {
        viewportWidth: LIMITS.desktopViewportWidth,
        captureScreenshot: wantScreenshots,
        fetchImpl,
        maxBytes: screenshotByteBudget,
        wallBudgetMs,
        waitUntil: navWait,
        maxSectionShots: wantScreenshots ? LIMITS.maxSectionScreenshots : 0,
        maxVideoShots: wantScreenshots ? maxVideoShotsCap : 0,
        analysisStartedAt: startedAt,
        ...(options.wallBudgetMs !== undefined ? { wallBudgetMs: options.wallBudgetMs } : {}),
        // Rotation re-sample is opt-in (costs browser seconds): the API
        // route enables it; unit tests leave it off for speed.
        ...(options.detectRotationMs !== undefined ? { detectRotationMs: options.detectRotationMs } : {}),
      });
      captureTimings.push(homepage.timings);
      homepageSnapshot = homepage.capture.snapshot;
      homepagePlaceholders = homepage.videoPlaceholders;
      homepagePath = homepage.path;
      screenshotBytesTotal += homepage.screenshotBytes;
      screenshotsCaptured += homepage.screenshotCount;
      desktopTaken += homepage.screenshotCount;
      screenshotBytesTotal += homepage.sectionShotBytes;
      screenshotsCaptured += homepage.sectionShots.length;
      screenshotBytesTotal += homepage.videoShotBytes;
      screenshotsCaptured += homepage.videoShots.length;
      if (homepage.extractionBytes > LIMITS.maxExtractionPayloadBytes) oversizePages += 1;
      warnings.push(...homepage.warnings);
      const homepageRecord = toRecord(homepage, {
        url: homepageUrl,
        path: homepage.path,
        priority: 1,
        selectedBecause: "Always analyzed: the requested homepage.",
        viewportWidth: LIMITS.desktopViewportWidth,
        pageType: "homepage",
        encodeBase64: options.encodeBase64,
        maxInlineImageBytes: options.maxInlineImageBytes,
      });
      homepageRecord.sectionShots = homepage.sectionShots;
      homepageRecord.videoShots = homepage.videoShots;
      // Rotation re-sample honesty: a repeat read that matches only rules
      // out fast rotations; slower ones stay undetected.
      if (homepage.capture.rotationChecked && homepageRecord.content.rotatingText.length === 0) {
        limitations.push(
          "Rotation check: homepage headings re-sampled after a short delay with no text changes; rotations slower than the delay are undetected.",
        );
      }
      // Inline clips as dataUrls: Chromium-native base64 straight through
      // (Trap 4 — no Worker encoding); a provided encoder is the local-dev /
      // test-double fallback when a backend returned raw bytes.
      const maxInline = options.maxInlineImageBytes ?? DEFAULT_MAX_INLINE_BYTES;
      const inlineFromShot = (shot: AnalysisScreenshot, raw: SectionShot | undefined): AnalysisScreenshot => {
        const dataUrl = shotPayloadDataUrl(shot.kind, raw, options.encodeBase64, maxInline);
        return dataUrl ? { ...shot, dataUrl } : shot;
      };
      homepageRecord.sectionShots = homepageRecord.sectionShots.map((shot, index) =>
        inlineFromShot(shot, homepage.capture.sectionShots[index]),
      );
      homepageRecord.videoShots = homepageRecord.videoShots.map((shot, index) =>
        inlineFromShot(shot, homepage.capture.videoShots[index]),
      );
      pages.push(homepageRecord);
      homepageSucceeded = true;
      if (isChallengeSnapshot(homepage.capture.snapshot)) {
        homepageChallenged = true;
        limitations.push(
          "The homepage serves a bot-verification challenge (CAPTCHA/slider/rate wall): captured content and screenshots record the challenge, not the site. Challenges are never solved or bypassed; remaining pages were skipped to preserve the browser budget.",
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      throw new ApiError("INTERNAL", 502, `Browser capture failed on the homepage: ${message}`);
    }

    // Homepage mobile capture runs immediately (before discovery, selection,
    // and remaining pages) so the most valuable responsive comparison
    // survives wall-budget exhaustion on large multi-page sites. The byte
    // and shot caps still apply; desktop pages later in the run yield to
    // whatever this capture spends.
    if (request.includeMobile && homepageSucceeded && !homepageChallenged) {
      report({ phase: "mobile", message: "Capturing mobile viewports…" });
      if (!wantScreenshots) {
        limitations.push("Skipped mobile capture: extract-only mode (`?screenshots=0`) captures no screenshots.");
        pages[0]!.responsiveComparison.status = "budget-skipped";
        pages[0]!.responsiveComparison.note = "Mobile capture was skipped because extract-only mode (`?screenshots=0`) captures no screenshots.";
      } else if (Date.now() - startedAt > wallBudgetMs) {
        limitations.push("Skipped mobile capture: wall budget exhausted.");
        pages[0]!.responsiveComparison.status = "budget-skipped";
        pages[0]!.responsiveComparison.note = "Mobile capture was skipped because the analysis wall-time budget was exhausted.";
      } else if (screenshotBytesTotal >= screenshotByteBudget) {
        limitations.push("Skipped mobile capture: screenshot byte cap reached.");
        pages[0]!.responsiveComparison.status = "budget-skipped";
        pages[0]!.responsiveComparison.note = "Mobile capture was skipped because the shared screenshot-byte budget was exhausted.";
      } else if (mobileTaken >= LIMITS.maxMobileScreenshots) {
        limitations.push("Skipped mobile capture: mobile screenshot cap reached.");
      } else {
        try {
          const mobile = await captureOne(session, request.target.url.toString(), {
            viewportWidth: LIMITS.mobileViewportWidth,
            maxBytes: Math.max(screenshotByteBudget - screenshotBytesTotal, 0),
            fetchImpl,
            waitUntil: navWait,
          });
          captureTimings.push(mobile.timings);
          screenshotBytesTotal += mobile.screenshotBytes;
          screenshotsCaptured += mobile.screenshotCount;
          mobileTaken += mobile.screenshotCount;
          if (mobile.extractionBytes > LIMITS.maxExtractionPayloadBytes) oversizePages += 1;
          warnings.push(...mobile.warnings);
          const homepage = pages[0];
          if (homepage && mobile.capture.screenshot && mobile.capture.screenshotKind) {
            homepage.mobileScreenshot = {
              kind: mobile.capture.screenshotKind,
              bytes: mobile.screenshotBytes,
              width: LIMITS.mobileViewportWidth,
              height: Math.min(mobile.capture.pageHeightPx, LIMITS.maxScreenshotHeightPx),
            };
            const dataUrl = shotPayloadDataUrl(
              mobile.capture.screenshotKind,
              mobile.capture.screenshot,
              options.encodeBase64,
              options.maxInlineImageBytes,
            );
            if (dataUrl) homepage.mobileScreenshot.dataUrl = dataUrl;
          }
          if (homepage && homepageSnapshot) homepage.responsiveComparison = compareResponsive(homepage, mobile.capture.snapshot);
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          issues.push(`Mobile homepage capture failed: ${message}`);
          pages[0]!.responsiveComparison.status = "capture-failed";
          pages[0]!.responsiveComparison.note = "Mobile capture failed; no layout comparison is available.";
        }
      }
    }

    try {
      report({ phase: "discovery", message: "Reading robots.txt and sitemap…" });
      // Scope discovery to the origin the browser actually landed on: after a
      // redirect (e.g. www -> apex) the requested origin would hide the real
      // robots.txt, sitemap, and navigation. The snapshot URL already passed
      // the static safety check and DoH revalidation above.
      let scopeOrigin: string | undefined;
      try {
        scopeOrigin = new URL(homepageSnapshot?.url ?? "").origin;
      } catch {
        scopeOrigin = undefined;
      }
      if (scopeOrigin && scopeOrigin !== request.target.origin) {
        warnings.push(
          `Redirected from ${request.target.origin} to ${scopeOrigin}; discovery scoped to the landed origin.`,
        );
      }
      discovery = await discoverCandidates({
        target: request.target,
        snapshot: homepageSnapshot,
        fetchImpl,
        timeoutMs: LIMITS.discoveryTimeoutMs,
        ...(scopeOrigin ? { scopeOrigin } : {}),
      });
      warnings.push(...discovery.warnings);
    } catch (error) {
      warnings.push(
        `Discovery failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    selection = buildSelection({
      candidates: discovery?.candidates ?? [],
      maxPages: request.maxPages,
      homepageUrl: request.target.url.toString(),
    });

    const remaining = homepageChallenged
      ? []
      : selection.candidates.filter(
        (candidate) => candidate.selected && candidate.path !== "/",
      );
    if (homepageChallenged && selection.pagesSelected > 1) {
      limitations.push(
        `Skipped ${selection.pagesSelected - 1} selected page(s): every page serves the same bot-verification challenge.`,
      );
    }
    report({
      phase: "selection",
      message: `Selected ${selection.pagesSelected} page(s); analyzing…`,
      current: 0,
      total: remaining.length,
    });

    for (const candidate of remaining) {
      if (Date.now() - startedAt > wallBudgetMs) {        limitations.push(
          `Analysis stopped after ${pages.length} pages: the ${wallBudgetMs / 1000}s wall budget was reached.`,
        );
        break;
      }

      if (
        (screenshotBytesTotal >= screenshotByteBudget ||
          desktopTaken >= LIMITS.maxDesktopScreenshots) &&
        !budgetNotice
      ) {
        limitations.push(
          `The ${screenshotByteBudget} byte / ${LIMITS.maxDesktopScreenshots} screenshot cap was reached; later pages are analyzed without screenshots.`,
        );
        budgetNotice = true;
      }

      const remainingScreenshotBytes = Math.max(
        screenshotByteBudget - screenshotBytesTotal,
        0,
      );
      const canScreenshot =
        wantScreenshots && remainingScreenshotBytes > 0 && desktopTaken < LIMITS.maxDesktopScreenshots;

      try {
        report({
          phase: "page",
          message: `Analyzing ${candidate.path}…`,
          current: pages.length,
          total: remaining.length,
          path: candidate.path,
        });
        const captured = await captureOne(session, candidate.url, {
          viewportWidth: LIMITS.desktopViewportWidth,
          captureScreenshot: canScreenshot,
          maxBytes: remainingScreenshotBytes,
          fetchImpl,
          waitUntil: navWait,
        });
        captureTimings.push(captured.timings);
        if (isChallengeSnapshot(captured.capture.snapshot)) {
          screenshotBytesTotal += captured.screenshotBytes;
          screenshotsCaptured += captured.screenshotCount;
          desktopTaken += captured.screenshotCount;
          issues.push(`Page ${candidate.url} serves a bot-verification challenge; skipped without documentation.`);
          continue;
        }
        screenshotBytesTotal += captured.screenshotBytes;
        screenshotsCaptured += captured.screenshotCount;
        desktopTaken += captured.screenshotCount;
        if (captured.extractionBytes > LIMITS.maxExtractionPayloadBytes) oversizePages += 1;
        if (canScreenshot && !captured.capture.screenshot && !budgetNotice) {
          limitations.push(
            `The ${screenshotByteBudget} byte screenshot cap was reached; later pages are analyzed without screenshots.`,
          );
          budgetNotice = true;
        }
        warnings.push(...captured.warnings);
        pages.push(
          toRecord(captured, {
            url: candidate.url,
            path: candidate.path,
            priority: candidate.priority,
            selectedBecause: candidate.selectedBecause,
            viewportWidth: LIMITS.desktopViewportWidth,
            pageType: candidate.label || humanizeSegment(candidate.path),
            encodeBase64: options.encodeBase64,
            maxInlineImageBytes: options.maxInlineImageBytes,
          }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        issues.push(`Page ${candidate.url} failed: ${message}`);
      }
    }

    // PRD screenshot policy: mobile at 390px for the homepage AND one
    // representative page (the first analyzed non-homepage).
    if (
      request.includeMobile &&
      homepageSucceeded &&
      wantScreenshots &&
      mobileTaken < LIMITS.maxMobileScreenshots &&
      Date.now() - startedAt <= wallBudgetMs &&
      screenshotBytesTotal < screenshotByteBudget &&
      pages.length > 1 &&
      pages[1]
    ) {
      const representative = pages[1];
      const representativeUrl = representative.url;
      try {
        const mobileRep = await captureOne(session, representativeUrl, {
          viewportWidth: LIMITS.mobileViewportWidth,
          fetchImpl,
          captureScreenshot: screenshotBytesTotal < screenshotByteBudget,
          maxBytes: Math.max(screenshotByteBudget - screenshotBytesTotal, 0),
          waitUntil: navWait,
        });
        captureTimings.push(mobileRep.timings);
        screenshotBytesTotal += mobileRep.screenshotBytes;
        screenshotsCaptured += mobileRep.screenshotCount;
        mobileTaken += mobileRep.screenshotCount;
        if (mobileRep.extractionBytes > LIMITS.maxExtractionPayloadBytes) oversizePages += 1;
        warnings.push(...mobileRep.warnings);
        if (representative && mobileRep.capture.screenshot && mobileRep.capture.screenshotKind) {
          representative.mobileScreenshot = {
            kind: mobileRep.capture.screenshotKind,
            bytes: mobileRep.screenshotBytes,
            width: LIMITS.mobileViewportWidth,
            height: Math.min(mobileRep.capture.pageHeightPx, LIMITS.maxScreenshotHeightPx),
          };
          const dataUrl = shotPayloadDataUrl(
            mobileRep.capture.screenshotKind,
            mobileRep.capture.screenshot,
            options.encodeBase64,
            options.maxInlineImageBytes,
          );
          if (dataUrl) representative.mobileScreenshot.dataUrl = dataUrl;
        }
        if (representative) representative.responsiveComparison = compareResponsive(representative, mobileRep.capture.snapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        issues.push(`Mobile representative-page capture failed: ${message}`);
        if (representative) {
          representative.responsiveComparison.status = "capture-failed";
          representative.responsiveComparison.note = "Mobile capture failed; no layout comparison is available.";
        }
      }
    } else if (request.includeMobile && pages[1]) {
      pages[1].responsiveComparison.status = "budget-skipped";
      pages[1].responsiveComparison.note = "Representative-page mobile capture was skipped by a page, wall-time, or screenshot budget.";
    }

    // Extract-only mobile observations for every remaining page: a 390px
    // viewport pass with no screenshot. This yields a real DOM-level
    // responsive comparison per page without spending screenshot bytes or
    // mobile-shot budget. Price: browser seconds and wall-clock per page,
    // so the loop checks the wall budget before each pass and marks the
    // rest budget-skipped when it runs out.
    if (request.includeMobile && homepageSucceeded && pages.length > 2) {
      const rest = pages.slice(2);
      for (let offset = 0; offset < rest.length; offset += 1) {
        const page = rest[offset]!;
        if (Date.now() - startedAt > wallBudgetMs) {
          for (const skipped of rest.slice(offset)) {
            skipped.responsiveComparison.status = "budget-skipped";
            skipped.responsiveComparison.note = "DOM-only mobile comparison was skipped because the analysis wall-time budget was exhausted.";
          }
          limitations.push("Skipped DOM-only mobile observations for remaining pages: wall budget exhausted.");
          break;
        }
        try {
          report({
            phase: "mobile",
            message: `Comparing ${page.path} at mobile width…`,
            current: offset + 1,
            total: rest.length,
            path: page.path,
          });
          const mobileOnly = await captureOne(session, page.url, {
            viewportWidth: LIMITS.mobileViewportWidth,
            captureScreenshot: false,
            fetchImpl,
            waitUntil: navWait,
          });
          captureTimings.push(mobileOnly.timings);
          if (mobileOnly.extractionBytes > LIMITS.maxExtractionPayloadBytes) oversizePages += 1;
          warnings.push(...mobileOnly.warnings);
          page.responsiveComparison = compareResponsive(page, mobileOnly.capture.snapshot);
          page.responsiveComparison.status = "dom-only";
          page.responsiveComparison.note += " No mobile screenshot was captured for this page (screenshot binaries are reserved for the homepage and one representative page); geometry and content deltas come from an extract-only 390px viewport pass.";
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          issues.push(`Mobile DOM-only capture failed for ${page.url}: ${message}`);
          page.responsiveComparison.status = "capture-failed";
          page.responsiveComparison.note = "DOM-only mobile comparison failed; no layout comparison is available.";
        }
      }
    }

    if (oversizePages > 0) {
      limitations.push(
        `${oversizePages} page(s) exceeded the ${LIMITS.maxExtractionPayloadBytes} byte extraction cap; payloads must be pruned in-page in CF07.`,
      );
    }

    if (remaining.length > 0) {
      limitations.push(
        "Multi-page observations captured within bounded per-page payloads; documentation rendering and ZIP assembly happen client-side.",
      );
    }

    // CF08: report-level asset manifest — deduped URL references only, no downloads.
    // Bounded and Worker-safe: pages <= 10, assets per page <= 100.
    const seenAssetKeys = new Set<string>();
    let assets: SnapshotAsset[] = [];
    for (const page of pages) {
      for (const asset of page.assets) {
        const key = `${asset.kind}|${asset.url}`;
        if (!asset.url || seenAssetKeys.has(key)) continue;
        seenAssetKeys.add(key);
        if (assets.length >= LIMITS.maxAssetManifestEntries) break;
        assets.push(asset);
      }
      if (assets.length >= LIMITS.maxAssetManifestEntries) break;
    }

    // CF25: fetched thumbnails for uncaptured facades. Facades that never
    // played AND captured no poster would leave blank bands; Vimeo oEmbed
    // resolves a thumbnail_url with one tiny JSON fetch each (zero
    // browser-minutes). Resolved URLs ride the existing poster pipeline as
    // synthetic assets (shared caps, lowest priority), so shipping, docs,
    // and validation need no new paths.
    const placeholders = homepagePlaceholders;
    const homepageVideos = homepageSnapshot?.videos ?? [];
    const thumbnailFor = new Map<string, (typeof placeholders)[number]>();
    if (placeholders.length > 0) {
      const posterByVideoId = new Map<string, string>();
      for (const video of homepageVideos) {
        const id = vimeoVideoId(video.url);
        if (id && !posterByVideoId.has(id)) posterByVideoId.set(id, video.poster ?? "");
      }
      for (const item of placeholders.slice(0, LIMITS.maxVideoShots)) {
        const id = vimeoVideoId(item.streamUrl);
        if (!id) continue;
        if ((posterByVideoId.get(id) ?? "") !== "") continue;
        if (assets.length >= LIMITS.maxAssetManifestEntries) break;
        try {
          const thumbUrl = await fetchVimeoThumbnailUrl(item.streamUrl, fetchImpl);
          if (thumbUrl && !thumbnailFor.has(thumbUrl)) {
            thumbnailFor.set(thumbUrl, item);
            assets.push({
              url: thumbUrl,
              kind: "poster",
              alt: `Fetched video thumbnail for '${item.label.slice(0, 80)}'`,
              width: null,
              height: null,
              usedOn: homepagePath,
            });
          }
        } catch {
          // One unresolvable thumbnail never fails the analysis.
        }
      }
    }

    // CF13: rehydrate eligible SVGs (logo/icon/hero) with plain fetch
    // subrequests, batched after page analysis. Shortfall is recorded on the
    // entries and in limitations, never thrown. Entries are replaced with new
    // objects so page-level assets stay reference-only (no content duplication
    // into data/pages.json).
    let assetOrigin = request.target.origin;
    try {
      assetOrigin = new URL(homepageSnapshot?.url ?? request.target.origin).origin;
    } catch {
      // Keep the requested origin when the snapshot URL is unparseable.
    }
    if (!wantScreenshots) {
      limitations.push("Asset rehydration skipped: extract-only mode (`?screenshots=0`) downloads no binaries; all assets remain URL references.");
    }
    try {
      // Extract-only mode passes an empty list so no binary is fetched or
      // encoded; the snapshot's reference-only manifest entries above stay.
      // CF36-1: local-full (options.capture === "full", passed explicitly
      // by the local dev server) raises the caps and allows raster
      // hero/image downloads. Lite/hosted keeps today's call unchanged.
      // CF36-2: local-full also collects distinct @font-face files from
      // pages' typography and PREPENDS them to the same manifest list, so
      // fonts share the raised 8MB/80-file pool and download FIRST in
      // document order (non-poster pass) before images/posters — no
      // separate budget. Lite/hosted collects nothing, so their packs are
      // byte-identical to before.
      const isLocalFull = options.capture === "full";
      const fontAssets = isLocalFull ? collectFontAssets(pages, assetOrigin) : [];
      const manifestAssets = [...fontAssets, ...assets];
      const rehydrated = await rehydrateAssets(wantScreenshots ? manifestAssets : [], isLocalFull
        ? {
          fetchImpl,
          origin: assetOrigin,
          perFileCap: 512 * 1024,
          totalCap: 8 * 1024 * 1024,
          maxFiles: 80,
          allowRasterKinds: true,
        }
        : { fetchImpl, origin: assetOrigin });
      // Poster/font bytes ride Uint8Array in memory but cannot survive the
      // API (they serialize as {"0":..} bloat and fail client-side
      // validation, killing the whole ZIP download). Where the environment
      // supplies an encoder (local dev), re-encode as dataUrl strings exactly
      // like screenshots; hosted responses stay metadata-only (Trap 4), so
      // poster/font downloads there revert to URL references instead of
      // shipping undecodable entries that would fail package validation.
      // CF36-2 confirmation: font binaries ride Uint8Array, so this path
      // needs no font-specific branch — dataUrl when an encoder is present,
      // reference-only revert when it is not.
      assets = rehydrated.assets.map((entry) => {
        if (entry.source !== "downloaded" || !(entry.content instanceof Uint8Array)) return entry;
        if (options.encodeBase64) {
          const { content, ...rest } = entry;
          return {
            ...rest,
            dataUrl: `data:${entry.contentType || "image/webp"};base64,${options.encodeBase64(content)}`,
          };
        }
        const { content, contentType, ...rest } = entry;
        void content;
        void contentType;
        return { ...rest, source: "reference-only" as const, skipReason: "binary-not-shipped" };
      });
      const kindCounts: Record<string, number> = {};
      for (const entry of assets) {
        if (entry.source === "downloaded") kindCounts[entry.kind] = (kindCounts[entry.kind] ?? 0) + 1;
      }
      const kindBreakdown = Object.entries(kindCounts)
        .map(([kind, count]) => `${count} ${kind}`)
        .join(", ");
      // Hosted reverts above move poster downloads back to references; report
      // the shipped numbers, not the fetched ones.
      const revertedBytes = assets
        .filter((entry) => entry.skipReason === "binary-not-shipped")
        .reduce((total, entry) => total + (entry.bytes ?? 0), 0);
      const reverted = assets.filter((entry) => entry.skipReason === "binary-not-shipped").length;
      limitations.push(
        `Asset rehydration: downloaded ${rehydrated.downloaded - reverted} asset(s) (${rehydrated.totalBytes - revertedBytes} bytes) to assets/${kindBreakdown ? ` [${kindBreakdown}]` : ""}; ${rehydrated.skipped + reverted} asset(s) remain URL references (oversize: ${rehydrated.skippedOversize}, unresolvable: ${rehydrated.skippedUnresolvable}).`,
      );
    } catch {
      assets = assets.map((asset) => ({ ...asset, source: "reference-only" as const, skipReason: "rehydration-error" }));
      limitations.push("Asset rehydration was skipped after an unexpected error; all assets remain URL references.");
    }

    // CF25: downloaded thumbnails become composited stand-ins on the homepage
    // record (placement from the uncaptured facade). Local dev inlines the
    // dataUrl the poster path already produced; hosted stays metadata-only.
    // Thumbnails are asset bytes, not screenshot bytes — never double-counted.
    if (thumbnailFor.size > 0 && pages[0]) {
      const homePage = pages[0];
      let thumbnailed = 0;
      for (const entry of assets) {
        const item = entry.url ? thumbnailFor.get(entry.url) : undefined;
        if (!item || entry.source !== "downloaded" || typeof entry.dataUrl !== "string") continue;
        const kind = entry.dataUrl.startsWith("data:image/") ? entry.dataUrl.slice(11).split(";")[0]! : "webp";
        homePage.videoThumbnails.push({
          kind,
          bytes: entry.bytes ?? 0,
          width: LIMITS.desktopViewportWidth,
          height: item.rectHeight > 0 ? item.rectHeight : 720,
          y: item.rectY,
          label: `thumbnail: ${item.label}`,
          dataUrl: entry.dataUrl,
          ...(item.rectWidth > 0 && item.rectHeight > 0
            ? { placement: { x: item.rectX, y: item.rectY, width: item.rectWidth, height: item.rectHeight } }
            : {}),
        });
        thumbnailed += 1;
      }
      const labels = [...thumbnailFor.values()].map((item) => item.label.slice(0, 60)).join("; ");
      limitations.push(
        `Video thumbnails: ${thumbnailed} fetched thumbnail(s) stand in for ${thumbnailFor.size} uncaptured facade(s) (${labels}); facades without a resolvable thumbnail keep their embed details in imagery-and-video.md.`,
      );
    } else if (homepagePlaceholders.length > 0) {
      limitations.push(
        `Video thumbnails: no fetched thumbnail resolved for ${homepagePlaceholders.length} uncaptured facade(s); those regions keep their embed details in imagery-and-video.md.`,
      );
    }

    // PRD fidelity model: known product limits are always disclosed, but only
    // when the evidence supports them (no blanket claims).
    limitations.push(
      "Custom fonts referenced by @font-face were not downloaded; text falls back to system stacks.",
    );
    // Claim "not captured" only when nothing playing was actually caught:
    // video assets plus zero shots and zero thumbnails. A run with
    // motion-verified frames must not carry the blanket shortfall.
    const capturedVideo =
      thumbnailFor.size > 0 || pages.some((page) => page.videoShots.length > 0);
    if (assets.some((asset) => asset.kind === "video") && !capturedVideo) {
      limitations.push("Video content was referenced but not captured; see data/assets.json.");
    }
    if (
      pages.some(
        (page) => page.motion.transitions.length > 0 || page.motion.animations.length > 0,
      )
    ) {
      limitations.push(
        "Pixel-exact motion timing was not reproduced; sampled durations and easings are in the package.",
      );
    }
    if (pages.some((page) => page.observedInteractions.length > 0)) {
      limitations.push(
        "JavaScript-driven interactions were observed but not replayed; see observedInteractions in data/pages.json.",
      );
    }

    const runTimings = sumCaptureTimings(captureTimings);
    const result = {
      schemaVersion: SCHEMA_VERSION,
      backend: launcher.name,
      request: {
        url: request.target.url.toString(),
        origin: request.target.origin,
        hostname: request.target.hostname,
        maxPages: request.maxPages,
        includeMobile: request.includeMobile,
        resolvedIps: request.resolvedIps,
      },
      pages,
      discovery: discovery
        ? {
            robotsFound: discovery.robotsFound,
            sitemapUrlCount: discovery.sitemapUrlCount,
            sitemapsChecked: discovery.sitemapsChecked,
            navLinkCount: homepageSnapshot?.links.filter((link) => link.inNav).length ?? 0,
          }
        : null,
      selection,
      issues,
      warnings,
      limitations,
      pagesDiscovered: selection.pagesDiscovered,
      pagesSelected: selection.pagesSelected,
      pagesAnalyzed: pages.length,
      screenshotsCaptured,
      screenshotBytesTotal,
      browserSecondsUsed: Math.round(((Date.now() - startedAt) / 1000) * 100) / 100,
      integrityPassed: pages.length > 0,
      assets,
      assetCount: assets.length,
      ...(runTimings ? { timings: runTimings } : {}),
    };
    report({ phase: "done", message: "Analysis complete." });
    return result;
  } finally {
    // Trap 3: always release the remote session, even on homepage failure,
    // selection throws, or wall-budget abort.
    await session.close().catch(() => undefined);
  }
}

async function revalidateRedirect(
  requestedUrl: string,
  finalUrl: string,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<void> {
  let requestedHost = "";
  let finalHost = "";
  try {
    requestedHost = new URL(requestedUrl).hostname.toLowerCase().replace(/\.$/, "");
    finalHost = new URL(finalUrl).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    throw new Error(`Unparseable redirect URL blocked: ${finalUrl}`);
  }
  if (!finalHost || finalHost === requestedHost) return;
  // Different host: resolve and revalidate exactly like the initial target.
  const target = parseHttpUrl(finalUrl);
  await assertPublicTarget(target, fetchImpl);
}

/**
 * CF29 Phase 0: sum per-capture phase timings across a run. Pure arithmetic
 * (no Date.now) so the wall-budget tests that mock the clock are unaffected.
 */
function sumCaptureTimings(list: CaptureTimings[]): CaptureTimings | undefined {
  if (list.length === 0) return undefined;
  const total: CaptureTimings = {
    navMs: 0,
    settleMs: 0,
    snapshotMs: 0,
    rotationMs: 0,
    lazySweepMs: 0,
    fullPageShotMs: 0,
    sectionShotsMs: 0,
    facadeVideoMs: 0,
    nativeVideoMs: 0,
    nativeRemasures: 0,
    nativeRemasureMaxPx: 0,
    isolatedVideoMs: 0,
    totalMs: 0,
  };
  for (const t of list) {
    total.navMs += t.navMs;
    total.settleMs += t.settleMs;
    total.snapshotMs += t.snapshotMs;
    total.rotationMs += t.rotationMs;
    total.lazySweepMs += t.lazySweepMs;
    total.fullPageShotMs += t.fullPageShotMs;
    total.sectionShotsMs += t.sectionShotsMs;
    total.facadeVideoMs += t.facadeVideoMs;
    total.nativeVideoMs += t.nativeVideoMs;
    total.nativeRemasures += t.nativeRemasures;
    total.nativeRemasureMaxPx = Math.max(total.nativeRemasureMaxPx, t.nativeRemasureMaxPx);
    total.isolatedVideoMs += t.isolatedVideoMs;
    total.totalMs += t.totalMs;
  }
  return total;
}

async function captureOne(
  session: AnalysisSession,
  url: string,
  options: {
    viewportWidth: number;
    captureScreenshot?: boolean;
    maxSectionShots?: number;
    maxVideoShots?: number;
    maxBytes?: number;
    fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
    detectRotationMs?: number;
    /**
     * Analysis start timestamp (Date.now()). The isolated video tier checks
     * the remaining wall budget against it and skips honestly when exhausted.
     */
    analysisStartedAt?: number;
    /** Wall-budget override in ms (tests); defaults to LIMITS. */
    wallBudgetMs?: number;
    /**
     * Navigation wait condition (CF33). The pipeline sets domcontentloaded
     * for hosted-lite (skip the networkidle2 firehose-track) and leaves it
     * unset for full capture (capturePage defaults to networkidle2+retry).
     */
    waitUntil?: WaitUntil;
  },
): Promise<{
  url: string;
  path: string;
  capture: CaptureResult;
  screenshotBytes: number;
  screenshotCount: number;
  sectionShots: AnalysisScreenshot[];
  sectionShotBytes: number;
  videoShots: AnalysisScreenshot[];
  videoShotBytes: number;
  /**
   * CF25: deferred facades that never became playing-state clips (wall/byte
   * skips, load failures, no-motion renders), with their facade placement
   * rects so packaging can substitute fetched thumbnails over the blank bands.
   */
  videoPlaceholders: VideoPlaceholder[];
  extractionBytes: number;
  warnings: string[];
  timings: CaptureTimings;
}> {
  // Trap 3: one tab at a time, closed before the next page opens.
  const page = await session.newPage();
  const warnings: string[] = [];
  const videoPlaceholders: VideoPlaceholder[] = [];

  try {
    const capture = await capturePage(page, {
      url,
      viewportWidth: options.viewportWidth,
      ...(options.captureScreenshot === false ? { captureScreenshot: false } : {}),
      ...(options.maxSectionShots !== undefined ? { maxSectionShots: options.maxSectionShots } : {}),
      ...(options.maxVideoShots !== undefined ? { maxVideoShots: options.maxVideoShots } : {}),
      ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
      ...(options.detectRotationMs !== undefined ? { detectRotationMs: options.detectRotationMs } : {}),
      ...(options.waitUntil !== undefined ? { waitUntil: options.waitUntil } : {}),
    });
    // Isolated video tier (CF22): the site page is closed FIRST so only one
    // tab is ever open (Trap 3). Each deferred stream renders in a clean
    // player page; motion-verified frames append to videoShots exactly like
    // in-page clips (downstream counts/bytes/dataUrls map by index).
    await page.close().catch(() => undefined);
    const pending = (options.maxVideoShots ?? 0) > 0 && capture.screenshot
      ? capture.pendingVideoStreams
      : [];
    const isolatedStart = Date.now();
    if (pending.length > 0) {
      const maxBytes = options.maxBytes ?? LIMITS.maxTotalScreenshotBytes;
      let used = (capture.screenshot?.bytes ?? 0)
        + capture.sectionShots.reduce((total, shot) => total + shot.bytes, 0)
        + capture.videoShots.reduce((total, shot) => total + shot.bytes, 0);
      const deadline = (options.analysisStartedAt ?? Date.now()) + (options.wallBudgetMs ?? LIMITS.totalAnalysisWallBudgetMs);
      // CF25 honesty: "cover art stands in" is only true when a poster was
      // captured; otherwise packaging substitutes a fetched thumbnail where
      // one resolves (see imagery-and-video.md for the actual outcome).
      const fallbackNote = "packaging substitutes a fetched thumbnail where one resolves (see imagery-and-video.md)";
      const toPlaceholder = (
        item: { label: string; streamUrl: string; rectX: number; rectY: number; rectWidth: number; rectHeight: number },
        reason: VideoPlaceholder["reason"],
      ): void => {
        videoPlaceholders.push({
          label: item.label,
          streamUrl: item.streamUrl,
          rectX: item.rectX,
          rectY: item.rectY,
          rectWidth: item.rectWidth,
          rectHeight: item.rectHeight,
          reason,
        });
      };
      for (let pi = 0; pi < pending.length; pi += 1) {
        const item = pending[pi]!;
        if (used >= maxBytes) {
          warnings.push(`Isolated render for video '${item.label}' dropped: byte budget exhausted; ${fallbackNote}.`);
          toPlaceholder(item, "bytes");
          break;
        }
        if (Date.now() >= deadline) {
          warnings.push(
            `Skipped isolated render for video '${item.label}': wall budget exhausted; ${fallbackNote}.`,
          );
          for (let qi = pi + 1; qi < pending.length; qi += 1) {
            warnings.push(
              `Skipped isolated render for video '${pending[qi]!.label}': wall budget exhausted; ${fallbackNote}.`,
            );
          }
          for (let qi = pi; qi < pending.length; qi += 1) toPlaceholder(pending[qi]!, "wall");
          break;
        }
        let shot: Awaited<ReturnType<typeof renderIsolatedVideoShot>> = null;
        try {
          shot = await renderIsolatedVideoShot(session, item.streamUrl);
        } catch {
          shot = null;
        }
        if (!shot) {
          warnings.push(`Isolated render for video '${item.label}' failed to load; ${fallbackNote}.`);
          toPlaceholder(item, "load");
          continue;
        }
        // Per-facade outcome (bounded: one line each, at most the video cap):
        // repeated labels here mean duplicate deferrals upstream; distinct
        // failing labels mean distinct gated streams.
        if (!shot.started) {
          warnings.push(`Isolated render for video '${item.label}' showed no motion; ${fallbackNote}.`);
          toPlaceholder(item, "motion");
          continue;
        }
        if (used + shot.bytes > maxBytes) {
          warnings.push(`Isolated render for video '${item.label}' dropped: byte budget exhausted.`);
          break;
        }
        capture.videoShots.push({
          kind: shot.kind,
          bytes: shot.bytes,
          y: item.rectY,
          height: item.rectHeight > 0 ? item.rectHeight : 720,
          heading: `video: ${item.label}`,
          ...(shot.base64 !== undefined ? { base64: shot.base64 } : {}),
          ...(shot.data ? { data: shot.data } : {}),
          streamUrl: item.streamUrl,
          ...(item.rectWidth > 0 && item.rectHeight > 0
            ? { placement: { x: item.rectX, y: item.rectY, width: item.rectWidth, height: item.rectHeight } }
            : {}),
        });
        used += shot.bytes;
      }
    }
    const isolatedVideoMs = Date.now() - isolatedStart;
    warnings.push(...capture.warnings);

    // CF02 "reject again after redirects": when the browser landed on a
    // different host, re-resolve and revalidate it before trusting output.
    if (options.fetchImpl) {
      await revalidateRedirect(url, capture.snapshot.url, options.fetchImpl);
    }

    // The extractor measures its own bounded JSON in Chromium. Keep the
    // worker pass-through path free of repeated large JSON.stringify calls.
    const extractionBytes = capture.snapshot.payloadBytes ?? JSON.stringify(capture.snapshot).length;
    if (extractionBytes > LIMITS.maxExtractionPayloadBytes) {
      warnings.push(
        `Extraction payload of ${extractionBytes} bytes exceeds the ${LIMITS.maxExtractionPayloadBytes} byte budget and must be pruned in-page.`,
      );
    }

    let screenshotBytes = capture.screenshot?.bytes ?? 0;
    const sectionShots: AnalysisScreenshot[] = capture.sectionShots.map((shot) => ({
      kind: shot.kind,
      bytes: shot.bytes,
      width: options.viewportWidth,
      height: shot.height,
      y: shot.y,
    }));
    const videoShots: AnalysisScreenshot[] = capture.videoShots.map((shot) => ({
      kind: shot.kind,
      bytes: shot.bytes,
      width: options.viewportWidth,
      height: shot.height,
      y: shot.y,
      label: shot.heading,
      ...(shot.streamUrl ? { streamUrl: shot.streamUrl } : {}),
      ...(shot.placement ? { placement: { ...shot.placement } } : {}),
    }));
    return {
      url,
      path: new URL(url).pathname,
      capture,
      screenshotBytes,
      screenshotCount: capture.screenshot ? 1 : 0,
      sectionShots,
      sectionShotBytes: capture.sectionShots.reduce((total, shot) => total + shot.bytes, 0),
      videoShots,
      videoShotBytes: capture.videoShots.reduce((total, shot) => total + shot.bytes, 0),
      videoPlaceholders,
      extractionBytes,
      warnings,
      timings: { ...capture.timings, isolatedVideoMs },
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

interface RecordOptions {
  url: string;
  path: string;
  priority: number | null;
  selectedBecause: string;
  viewportWidth: number;
  pageType: string;
  encodeBase64?: (bytes: Uint8Array) => string;
  maxInlineImageBytes?: number;
}

// Observed navigation links, deduplicated by href and bounded per area so the
// record (and data/navigation.json) carries the real site nav, not just the
// selection-derived labels. Worker-cheap: pure projection over the snapshot.
function pickNavLinks(
  links: { href: string; text: string; inNav: boolean; inHeader: boolean; inFooter: boolean }[],
  area: "inNav" | "inHeader" | "inFooter",
): AnalysisNavLink[] {
  const seen = new Set<string>();
  const picked: AnalysisNavLink[] = [];
  for (const link of links) {
    if (!link[area]) continue;
    const href = String(link.href ?? "");
    if (!href || seen.has(href)) continue;
    seen.add(href);
    picked.push({ text: String(link.text ?? "").slice(0, 120), href: href.slice(0, 500) });
    if (picked.length >= 30) break;
  }
  return picked;
}

// Mirror of the desktop inline logic in toRecord: captures carry a dataUrl so
// the client-side ZIP and screenshot previews include them. Chromium-native
// base64 (Trap 4) passes straight through; a supplied encoder is the
// local-dev / test-double fallback when a backend returned raw bytes.
function shotPayloadDataUrl(
  kind: string | undefined,
  payload: ShotPayload | null | undefined,
  encodeBase64: ((bytes: Uint8Array) => string) | undefined,
  maxInlineImageBytes: number | undefined,
): string | undefined {
  // An available encoder is the "ship binaries" signal (hosted `?binaries=0`
  // and metadata-only callers pass none); it is the fallback codec for
  // byte-returning doubles, never called when Chromium already gave base64.
  if (!kind || !payload || !encodeBase64) return undefined;
  const maxInline = maxInlineImageBytes ?? DEFAULT_MAX_INLINE_BYTES;
  if (payload.base64 !== undefined) {
    return payload.bytes <= maxInline ? `data:image/${kind};base64,${payload.base64}` : undefined;
  }
  if (payload.data && payload.data.byteLength <= maxInline) {
    return `data:image/${kind};base64,` + encodeBase64(payload.data);
  }
  return undefined;
}

function compareResponsive(
  desktop: AnalysisPage,
  mobile: PageSnapshot,
): ResponsiveComparison {
  const desktopHeadings = new Set(desktop.sections.map((section) => section.heading).filter(Boolean));
  const mobileHeadings = new Set(mobile.content.sections.map((section) => section.heading).filter(Boolean));
  const layoutChanges: ResponsiveComparison["layoutChanges"] = [];
  const desktopLayout = new Map(desktop.layoutSamples.map((sample) => [sample.role, sample]));
  const mobileLayout = new Map(mobile.layoutSamples.map((sample) => [sample.role, sample]));
  const roles = [...new Set([...desktop.layoutSamples, ...mobile.layoutSamples].map((sample) => sample.role))].slice(0, 8);
  for (const role of roles) {
    const desktopSample = desktopLayout.get(role) ?? null;
    const mobileSample = mobileLayout.get(role) ?? null;
    const changed = !desktopSample || !mobileSample || desktopSample.width !== mobileSample.width
      || desktopSample.height !== mobileSample.height
      || desktopSample.display !== mobileSample.display
      || desktopSample.position !== mobileSample.position
      || desktopSample.columns !== mobileSample.columns
      || desktopSample.gap !== mobileSample.gap
      || desktopSample.visible !== mobileSample.visible;
    layoutChanges.push({ role, desktop: desktopSample, mobile: mobileSample, changed });
  }
  const desktopControls = desktop.content.controls.length;
  const mobileControls = mobile.content.controls.length;
  return {
    status: "captured",
    desktopViewport: desktop.viewport,
    mobileViewport: mobile.viewport,
    sectionHeadingsAdded: [...mobileHeadings].filter((heading) => !desktopHeadings.has(heading)).slice(0, 20),
    sectionHeadingsMissing: [...desktopHeadings].filter((heading) => !mobileHeadings.has(heading)).slice(0, 20),
    countDeltas: {
      headings: mobile.headings.length - desktop.headings.length,
      sections: mobile.content.sections.length - desktop.sections.length,
      forms: mobile.formCount - desktop.formCount,
      images: mobile.imageCount - desktop.imageCount,
      controls: mobileControls - desktopControls,
    },
    layoutChanges,
    note: "Observed DOM and sampled geometry comparison only; no claim of pixel-perfect or exhaustive responsive behavior.",
  };
}

function toRecord(
  captured: Awaited<ReturnType<typeof captureOne>>,
  options: RecordOptions,
): AnalysisPage {
  const snapshot = captured.capture.snapshot;
  let screenshot: AnalysisScreenshot | null = null;

  if (captured.capture.screenshot && captured.capture.screenshotKind) {
    screenshot = {
      kind: captured.capture.screenshotKind,
      bytes: captured.capture.screenshot.bytes,
      width: options.viewportWidth,
      height: Math.min(captured.capture.pageHeightPx, LIMITS.maxScreenshotHeightPx),
    };

    const dataUrl = shotPayloadDataUrl(
      captured.capture.screenshotKind,
      captured.capture.screenshot,
      options.encodeBase64,
      options.maxInlineImageBytes,
    );
    if (dataUrl) screenshot.dataUrl = dataUrl;
  }

  return {
    url: snapshot.url || options.url,
    path: new URL(options.url).pathname.replace(/\/+$/u, "") || "/",
    title: snapshot.title,
    metaDescription: snapshot.metaDescription ?? null,
    lang: snapshot.lang ?? null,
    direction: snapshot.direction ?? null,
    pageType: options.pageType,
    isHomepage: options.pageType === "homepage",
    selected: true,
    priority: options.priority,
    selectedBecause: options.selectedBecause,
    headings: snapshot.headings,
    linkCount: snapshot.links.length,
    pageCanvasColor: snapshot.pageCanvasColor,
    navLinkCount: snapshot.links.filter((link) => link.inNav).length,
    nav: {
      header: pickNavLinks(snapshot.links, "inHeader"),
      primary: pickNavLinks(snapshot.links, "inNav"),
      footer: pickNavLinks(snapshot.links, "inFooter"),
    },
    responsiveComparison: {
      status: "not-requested",
      desktopViewport: snapshot.viewport,
      mobileViewport: null,
      sectionHeadingsAdded: [],
      sectionHeadingsMissing: [],
      countDeltas: null,
      layoutChanges: [],
      note: "Mobile comparison was not requested or is not yet available.",
    },
    viewport: snapshot.viewport,
    layoutSamples: snapshot.layoutSamples,
    semanticStyles: snapshot.semanticStyles,
    coverage: snapshot.coverage,
    sectionCount: snapshot.sectionCount,
    sections: snapshot.content.sections,
    formCount: snapshot.formCount,
    imageCount: snapshot.imageCount,
    domElementCount: snapshot.domElementCount,
    extractionBytes: captured.extractionBytes,
    pageHeightPx: captured.capture.pageHeightPx,
    screenshot,
    mobileScreenshot: null,
    sectionShots: [],
    videoShots: [],
    videoThumbnails: [],
    warnings: captured.warnings,
    tokens: snapshot.tokens,
    typography: snapshot.typography,
    breakpoints: snapshot.breakpoints,
    motion: snapshot.motion,
    geometry: snapshot.geometry,
    limitations: snapshot.limitations,
    observedInteractions: snapshot.observedInteractions,
    hoverStates: snapshot.hoverStates,
    embeds: snapshot.embeds,
    videos: snapshot.videos,
    sectionLayouts: snapshot.sectionLayouts,
    social: snapshot.social,
    formActions: snapshot.formActions,
    content: { ...snapshot.content, rotatingText: captured.capture.rotatingText ?? [] },
    assets: snapshot.assets,
  };
}
