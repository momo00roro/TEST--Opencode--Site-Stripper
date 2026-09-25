import { fetchText } from "./fetch-text";
import { isSameSiteOrigin } from "./paths";

export function decodeXmlEntities(value: string): string {
  if (value.indexOf("&") === -1) return value;
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export interface SitemapParseResult {
  urls: string[];
  childSitemaps: string[];
  truncated: boolean;
}

const MAX_LOC_ENTRIES = 2_000;

export function parseSitemap(xml: string): SitemapParseResult {
  const urls: string[] = [];
  const childSitemaps: string[] = [];
  const isIndex = /<sitemapindex[\s>]/i.test(xml) || /<sitemapindex\s*$/i.test(xml);

  let cursor = 0;
  let parsed = 0;
  let truncated = false;

  while (parsed < MAX_LOC_ENTRIES) {
    const open = xml.indexOf("<loc", cursor);
    if (open === -1) break;

    const openEnd = xml.indexOf(">", open);
    if (openEnd === -1) break;

    const close = xml.indexOf("</loc>", openEnd);
    if (close === -1) break;

    const raw = decodeXmlEntities(xml.slice(openEnd + 1, close).trim());
    cursor = close + 6;
    parsed += 1;

    if (!/^https?:\/\//i.test(raw)) continue;
    if (isIndex) childSitemaps.push(raw);
    else urls.push(raw);
  }

  if (parsed >= MAX_LOC_ENTRIES && xml.indexOf("<loc", cursor) !== -1) truncated = true;

  return { urls, childSitemaps, truncated };
}

export interface SitemapCollection {
  urls: string[];
  sitemapsChecked: string[];
  warnings: string[];
}

export interface CollectSitemapsOptions {
  origin: string;
  sitemapUrls: string[];
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs: number;
  maxSitemapUrls?: number;
  maxChildSitemaps?: number;
}

export async function collectSitemapUrls(options: CollectSitemapsOptions): Promise<SitemapCollection> {
  const { origin, fetchImpl, timeoutMs } = options;
  const maxSitemapUrls = options.maxSitemapUrls ?? 2;
  // 10 children cover Shopify-style indexes (products/collections/pages/blogs
  // plus pagination) while staying far under the 50-subrequest budget:
  // worst case is 2 (DoH) + 1 (robots) + 2 (roots) + 10 (children).
  const maxChildSitemaps = options.maxChildSitemaps ?? 10;

  const urls = new Set<string>();
  const sitemapsChecked: string[] = [];
  const warnings: string[] = [];

  const roots = options.sitemapUrls
    .filter((value) => isSameOriginUrl(value, origin))
    .slice(0, maxSitemapUrls);

  const childQueue: string[] = [];

  for (const root of roots) {
    sitemapsChecked.push(root);
    const result = await fetchText(root, fetchImpl, timeoutMs);
    if (!result.ok) {
      warnings.push(`Sitemap unavailable: ${root}`);
      continue;
    }

    const parsed = parseSitemap(result.text);
    if (parsed.truncated) warnings.push(`Sitemap truncated at the entry cap: ${root}`);
    for (const url of parsed.urls) if (isSameOriginUrl(url, origin)) urls.add(url);
    for (const child of parsed.childSitemaps) {
      if (isSameOriginUrl(child, origin)) childQueue.push(child);
    }
  }

  for (const child of childQueue.slice(0, maxChildSitemaps)) {
    sitemapsChecked.push(child);
    const result = await fetchText(child, fetchImpl, timeoutMs);
    if (!result.ok) continue;
    const parsed = parseSitemap(result.text);
    for (const url of parsed.urls) if (isSameOriginUrl(url, origin)) urls.add(url);
  }

  return { urls: [...urls], sitemapsChecked, warnings };
}

function isSameOriginUrl(value: string, origin: string): boolean {
  try {
    return isSameSiteOrigin(new URL(value).origin, origin);
  } catch {
    return false;
  }
}
