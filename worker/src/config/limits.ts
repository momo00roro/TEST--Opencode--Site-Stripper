export const SCHEMA_VERSION = "0.2.0";

export const LIMITS = {
  maxPagesHardMax: 10,
  maxPagesDefault: 10,
  perPageNavigationTimeoutMs: 12_000,
  perPageExtractionBudgetMs: 3_000,
  totalAnalysisWallBudgetMs: 90_000,
  browserKeepAliveMs: 600_000,
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
  maxTotalScreenshotBytes: 6 * 1024 * 1024,
  maxAssetManifestEntries: 300,
  extractionPayloadWarnBytes: 350 * 1024,
  maxExtractionPayloadBytes: 512 * 1024,
  discoveryTimeoutMs: 5_000,
  maxCssBytesPerPage: 3 * 1024 * 1024,
  zipWarnBytes: 25 * 1024 * 1024,
} as const;

export const ALLOWED_PORTS = new Set(["", "80", "443"]);

export const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
