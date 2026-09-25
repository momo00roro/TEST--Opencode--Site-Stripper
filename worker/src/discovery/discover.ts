import type { PageSnapshot } from "../browser/snapshot-script";
import { LIMITS } from "../config/limits";
import type { NormalizedUrl } from "../validation/url";
import { fetchText } from "./fetch-text";
import { isSameSiteOrigin, labelFromPath, normalizeCandidateUrl } from "./paths";
import { defaultSitemapUrl, parseRobots } from "./robots";
import { collectSitemapUrls } from "./sitemap";
import type { Candidate, CandidateSource, DiscoveryResult } from "./types";

export interface DiscoverOptions {
  target: NormalizedUrl;
  snapshot: PageSnapshot | null;
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  maxSitemapUrls?: number;
  maxChildSitemaps?: number;
  /**
   * Post-navigation scope (CF04): when the browser was redirected (e.g.
   * www -> apex), robots/sitemap/link discovery must run against the origin
   * the browser actually landed on. Defaults to the requested origin.
   */
  scopeOrigin?: string;
}

interface MutableCandidate {
  url: string;
  path: string;
  label: string;
  sources: CandidateSource[];
  inNav: boolean;
  occurrences: number;
  hasQuery: boolean;
}

export async function discoverCandidates(options: DiscoverOptions): Promise<DiscoveryResult> {
  const { target, snapshot, fetchImpl } = options;
  const timeoutMs = options.timeoutMs ?? LIMITS.discoveryTimeoutMs;
  // Scope to the post-navigation origin when the caller knows it; the
  // requested origin otherwise.
  const origin = options.scopeOrigin ?? target.origin;
  const warnings: string[] = [];

  // normalizePath() lowercases, so the homepage path must be lowered too or a
  // mixed-case homepage path would be re-added as a duplicate candidate.
  const homepagePath = (target.url.pathname.replace(/\/+$/u, "") || "/").toLowerCase();
  const byPath = new Map<string, MutableCandidate>();

  const add = (
    value: string,
    source: CandidateSource,
    label: string,
    inNav = false,
  ): void => {
    const normalized = normalizeCandidateUrl(value);
    if (!normalized || !isSameSiteOrigin(normalized.origin, origin)) return;
    // The homepage is always analyzed separately; never collect it as a candidate.
    if (normalized.path === homepagePath || normalized.path === "/") return;

    const existing = byPath.get(normalized.path);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      existing.occurrences += 1;
      if (inNav) existing.inNav = true;
      if (label.length > existing.label.length) existing.label = label;
      return;
    }

    byPath.set(normalized.path, {
      url: normalized.url,
      path: normalized.path,
      label: label || labelFromPath(normalized.path),
      sources: [source],
      inNav,
      occurrences: 1,
      hasQuery: normalized.hasQuery,
    });
  };

  let robotsFound = false;
  let sitemapsChecked: string[] = [];
  let sitemapUrlCount = 0;

  const robotsResult = await fetchText(`${origin}/robots.txt`, fetchImpl, timeoutMs);
  const declaredSitemaps: string[] = [];

  if (robotsResult.ok && robotsResult.text.trim().length > 0) {
    robotsFound = true;
    const robots = parseRobots(robotsResult.text);
    for (const sitemap of robots.sitemaps) pushSameOriginUrl(declaredSitemaps, sitemap, origin);
  } else {
    warnings.push("robots.txt was unavailable; falling back to /sitemap.xml.");
  }

  const sitemapRoots = declaredSitemaps.length > 0 ? declaredSitemaps : [defaultSitemapUrl(origin)];

  try {
    const collection = await collectSitemapUrls({
      origin,
      sitemapUrls: sitemapRoots,
      fetchImpl,
      timeoutMs,
      maxSitemapUrls: options.maxSitemapUrls ?? 2,
      maxChildSitemaps: options.maxChildSitemaps ?? 10,
    });
    sitemapsChecked = collection.sitemapsChecked;
    warnings.push(...collection.warnings);
    sitemapUrlCount = collection.urls.length;
    for (const url of collection.urls) add(url, "sitemap", "");
  } catch (error) {
    warnings.push(
      `Sitemap discovery failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  if (snapshot) {
    for (const link of snapshot.links) {
      const source: CandidateSource = link.inHeader
        ? "header"
        : link.inFooter
          ? "footer"
          : link.inNav
            ? "nav"
            : "homepage";
      add(link.href, source, link.text, link.inNav);
    }
  }

  const candidates: Candidate[] = [...byPath.values()]
    .map((candidate) => ({
      url: candidate.url,
      path: candidate.path,
      label: candidate.label,
      sources: candidate.sources,
      inNav: candidate.inNav,
      occurrences: candidate.occurrences,
      hasQuery: candidate.hasQuery,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    candidates,
    sitemapsChecked,
    sitemapUrlCount,
    robotsFound,
    warnings,
  };
}

function pushSameOriginUrl(target: string[], value: string, origin: string): void {
  try {
    const url = new URL(value);
    if (!isSameSiteOrigin(url.origin, origin)) return;
    url.hash = "";
    target.push(url.toString());
  } catch {
    return;
  }
}
