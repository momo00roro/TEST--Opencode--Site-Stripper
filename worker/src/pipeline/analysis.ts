import { capturePage, type CaptureResult } from "../browser/capture";
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
  SnapshotSemanticStyle,
  SnapshotSocial,
  SnapshotTokens,
  SnapshotTypography,
} from "../browser/snapshot-script";
import type { AnalysisSession, SessionLauncher } from "../browser/types";
import { LIMITS, SCHEMA_VERSION } from "../config/limits";
import { discoverCandidates } from "../discovery/discover";
import type { DiscoveryResult } from "../discovery/types";
import { humanizeSegment } from "../discovery/paths";
import { ApiError } from "../http/errors";
import { buildSelection, type SelectionReport } from "../ranking/key-pages";
import type { AnalyzeRequest } from "../validation/analyze-request";
import { assertPublicTarget, parseHttpUrl } from "../validation/url";

export interface AnalysisScreenshot {
  kind: string;
  bytes: number;
  width: number;
  height: number;
  dataUrl?: string;
}

export interface AnalysisNavLink {
  text: string;
  href: string;
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
  maxInlineImageBytes?: number;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  onProgress?: (event: AnalysisProgress) => void;
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

  let discovery: DiscoveryResult | null = null;
  let selection: SelectionReport | null = null;
  let homepageSnapshot: PageSnapshot | null = null;
  let screenshotBytesTotal = 0;
  let screenshotsCaptured = 0;
  let budgetNotice = false;

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
        fetchImpl,
        maxSectionShots: LIMITS.maxSectionScreenshots,
      });
      homepageSnapshot = homepage.capture.snapshot;
      screenshotBytesTotal += homepage.screenshotBytes;
      screenshotsCaptured += homepage.screenshotCount;
      desktopTaken += homepage.screenshotCount;
      screenshotBytesTotal += homepage.sectionShotBytes;
      screenshotsCaptured += homepage.sectionShots.length;
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
      // Inline small section clips where the environment supports it (local
      // dev); hosted responses stay metadata-only (Trap 4: no Worker encoding).
      if (options.encodeBase64) {
        const maxInline = options.maxInlineImageBytes ?? DEFAULT_MAX_INLINE_BYTES;
        homepageRecord.sectionShots = homepageRecord.sectionShots.map((shot, index) => {
          const raw = homepage.capture.sectionShots[index];
          if (raw && raw.data.byteLength <= maxInline) {
            return {
              ...shot,
              dataUrl: `data:image/${shot.kind};base64,` + options.encodeBase64!(raw.data),
            };
          }
          return shot;
        });
      }
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
      if (Date.now() - startedAt > LIMITS.totalAnalysisWallBudgetMs) {
        limitations.push("Skipped mobile capture: wall budget exhausted.");
        pages[0]!.responsiveComparison.status = "budget-skipped";
        pages[0]!.responsiveComparison.note = "Mobile capture was skipped because the analysis wall-time budget was exhausted.";
      } else if (screenshotBytesTotal >= LIMITS.maxTotalScreenshotBytes) {
        limitations.push("Skipped mobile capture: screenshot byte cap reached.");
        pages[0]!.responsiveComparison.status = "budget-skipped";
        pages[0]!.responsiveComparison.note = "Mobile capture was skipped because the shared screenshot-byte budget was exhausted.";
      } else if (mobileTaken >= LIMITS.maxMobileScreenshots) {
        limitations.push("Skipped mobile capture: mobile screenshot cap reached.");
      } else {
        try {
          const mobile = await captureOne(session, request.target.url.toString(), {
            viewportWidth: LIMITS.mobileViewportWidth,
            maxBytes: Math.max(LIMITS.maxTotalScreenshotBytes - screenshotBytesTotal, 0),
            fetchImpl,
          });
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
            const dataUrl = inlineShotDataUrl(
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
      if (Date.now() - startedAt > LIMITS.totalAnalysisWallBudgetMs) {        limitations.push(
          `Analysis stopped after ${pages.length} pages: the ${LIMITS.totalAnalysisWallBudgetMs / 1000}s wall budget was reached.`,
        );
        break;
      }

      if (
        (screenshotBytesTotal >= LIMITS.maxTotalScreenshotBytes ||
          desktopTaken >= LIMITS.maxDesktopScreenshots) &&
        !budgetNotice
      ) {
        limitations.push(
          `The ${LIMITS.maxTotalScreenshotBytes} byte / ${LIMITS.maxDesktopScreenshots} screenshot cap was reached; later pages are analyzed without screenshots.`,
        );
        budgetNotice = true;
      }

      const remainingScreenshotBytes = Math.max(
        LIMITS.maxTotalScreenshotBytes - screenshotBytesTotal,
        0,
      );
      const canScreenshot =
        remainingScreenshotBytes > 0 && desktopTaken < LIMITS.maxDesktopScreenshots;

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
        });
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
            `The ${LIMITS.maxTotalScreenshotBytes} byte screenshot cap was reached; later pages are analyzed without screenshots.`,
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
      mobileTaken < LIMITS.maxMobileScreenshots &&
      Date.now() - startedAt <= LIMITS.totalAnalysisWallBudgetMs &&
      screenshotBytesTotal < LIMITS.maxTotalScreenshotBytes &&
      pages.length > 1 &&
      pages[1]
    ) {
      const representative = pages[1];
      const representativeUrl = representative.url;
      try {
        const mobileRep = await captureOne(session, representativeUrl, {
          viewportWidth: LIMITS.mobileViewportWidth,
          fetchImpl,
          captureScreenshot: screenshotBytesTotal < LIMITS.maxTotalScreenshotBytes,
          maxBytes: Math.max(LIMITS.maxTotalScreenshotBytes - screenshotBytesTotal, 0),
        });
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
          const dataUrl = inlineShotDataUrl(
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
        if (Date.now() - startedAt > LIMITS.totalAnalysisWallBudgetMs) {
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
          });
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
    const assets: SnapshotAsset[] = [];
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

    // PRD fidelity model: known product limits are always disclosed, but only
    // when the evidence supports them (no blanket claims).
    limitations.push(
      "Custom fonts referenced by @font-face were not downloaded; text falls back to system stacks.",
    );
    if (assets.some((asset) => asset.kind === "video-poster")) {
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

async function captureOne(
  session: AnalysisSession,
  url: string,
  options: {
    viewportWidth: number;
    captureScreenshot?: boolean;
    maxSectionShots?: number;
    maxBytes?: number;
    fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  },
): Promise<{
  url: string;
  path: string;
  capture: CaptureResult;
  screenshotBytes: number;
  screenshotCount: number;
  sectionShots: AnalysisScreenshot[];
  sectionShotBytes: number;
  extractionBytes: number;
  warnings: string[];
}> {
  // Trap 3: one tab at a time, closed before the next page opens.
  const page = await session.newPage();
  const warnings: string[] = [];

  try {
    const capture = await capturePage(page, {
      url,
      viewportWidth: options.viewportWidth,
      ...(options.captureScreenshot === false ? { captureScreenshot: false } : {}),
      ...(options.maxSectionShots !== undefined ? { maxSectionShots: options.maxSectionShots } : {}),
      ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
    });
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

    let screenshotBytes = capture.screenshot?.byteLength ?? 0;
    const sectionShots: AnalysisScreenshot[] = capture.sectionShots.map((shot) => ({
      kind: shot.kind,
      bytes: shot.bytes,
      width: options.viewportWidth,
      height: shot.height,
    }));
    return {
      url,
      path: new URL(url).pathname,
      capture,
      screenshotBytes,
      screenshotCount: capture.screenshot ? 1 : 0,
      sectionShots,
      sectionShotBytes: capture.sectionShots.reduce((total, shot) => total + shot.bytes, 0),
      extractionBytes,
      warnings,
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

// Mirror of the desktop inline logic in toRecord: mobile captures must also
// carry a dataUrl where the environment supplies an encoder (local dev), or
// the client-side ZIP silently drops them while the manifest still lists them.
function inlineShotDataUrl(
  kind: string | undefined,
  bytes: Uint8Array | null | undefined,
  encodeBase64: ((bytes: Uint8Array) => string) | undefined,
  maxInlineImageBytes: number | undefined,
): string | undefined {
  if (!encodeBase64 || !kind || !bytes) return undefined;
  const maxInline = maxInlineImageBytes ?? DEFAULT_MAX_INLINE_BYTES;
  if (bytes.byteLength > maxInline) return undefined;
  return `data:image/${kind};base64,` + encodeBase64(bytes);
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
      bytes: captured.capture.screenshot.byteLength,
      width: options.viewportWidth,
      height: Math.min(captured.capture.pageHeightPx, LIMITS.maxScreenshotHeightPx),
    };

    const maxInline = options.maxInlineImageBytes ?? DEFAULT_MAX_INLINE_BYTES;
    if (options.encodeBase64 && captured.capture.screenshot.byteLength <= maxInline) {
      screenshot.dataUrl =
        `data:image/${captured.capture.screenshotKind};base64,` +
        options.encodeBase64(captured.capture.screenshot);
    }
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
    social: snapshot.social,
    formActions: snapshot.formActions,
    content: snapshot.content,
    assets: snapshot.assets,
  };
}
