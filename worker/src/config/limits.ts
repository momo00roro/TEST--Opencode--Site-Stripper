export const SCHEMA_VERSION = "0.2.0";

export const LIMITS = {
  maxPagesHardMax: 10,
  maxPagesDefault: 10,
  perPageNavigationTimeoutMs: 12_000,
  perPageExtractionBudgetMs: 3_000,
  // Internal-tool sizing (2026-10-01): 150s wall x 4 runs/day = 600s, exactly
  // the Workers Free 10-min/day browser meter. Light sites use seconds, so
  // typical usage lands well under; the worst case only binds on all-heavy days.
  totalAnalysisWallBudgetMs: 150_000,
  // Idle timeout for a Browser Rendering session (Cloudflare default 60s; max
  // 600s). Was pinned to the 600s max, so a CPU-killed isolate (Error 1102)
  // left its session idling the *entire* daily meter (observed 10:01 burned).
  // 90s still clears the longest single in-flight command (the 45s lazy-media
  // sweep) with 2x margin, but caps an orphan's waste to 90s.
  browserKeepAliveMs: 90_000,
  desktopViewportWidth: 1440,
  mobileViewportWidth: 390,
  deviceScaleFactor: 1,
  // Chrome's canvas ceiling is ~16384px per dimension; 16000 keeps full-page
  // captures intact for all but the very tallest pages.
  maxScreenshotHeightPx: 16_000,
  screenshotQuality: 70,
  maxDesktopScreenshots: 10,
  maxMobileScreenshots: 2,
  maxSectionScreenshots: 6,
  // Carousel-paged grids hold 7+ facades but hydrate a few cards at a time;
  // the pager (CF24) turns next-arrows to discover them. Affordable since
  // isolated renders cost ~4-10s per facade versus ~30s for doomed clicks.
  maxVideoShots: 12,
  maxTotalScreenshotBytes: 10 * 1024 * 1024,
  maxAssetManifestEntries: 300,
  maxAssetDownloadBytesPerFile: 50 * 1024,
  maxAssetDownloadBytesTotal: 512 * 1024,
  maxAssetDownloads: 40,
  extractionPayloadWarnBytes: 350 * 1024,
  maxExtractionPayloadBytes: 512 * 1024,
  discoveryTimeoutMs: 5_000,
  maxCssBytesPerPage: 3 * 1024 * 1024,
  zipWarnBytes: 25 * 1024 * 1024,
} as const;

export const ALLOWED_PORTS = new Set(["", "80", "443"]);

export const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
