export function normalizePath(url: URL): string {
  let path = url.pathname.replace(/\/+$/u, "");
  if (path.length === 0) path = "/";
  return path.toLowerCase();
}

export function pathDepth(path: string): number {
  if (path === "/") return 0;
  return path.split("/").filter(Boolean).length;
}

export function humanizeSegment(segment: string): string {
  return segment
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function labelFromPath(path: string): string {
  if (path === "/") return "Homepage";
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  return humanizeSegment(last) || "Homepage";
}

export interface NormalizedCandidateUrl {
  url: string;
  origin: string;
  path: string;
  hasQuery: boolean;
}
export function normalizeCandidateUrl(value: string): NormalizedCandidateUrl | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return {
      url: url.toString(),
      origin: url.origin,
      path: normalizePath(url),
      hasQuery: url.search.length > 0,
    };
  } catch {
    return null;
  }
}

/**
 * Same-site origin check (CF04): strict same-origin, plus the `www.` alias
 * (`https://www.example.com` vs `https://example.com`). Sites routinely split
 * links, sitemaps, and redirects across the apex/www pair; treating them as
 * foreign drops real pages (or the whole sitemap). SSRF posture is unchanged:
 * every analyzed URL still passes blocklists and DoH revalidation.
 */
export function isSameSiteOrigin(a: string, b: string): boolean {
  try {
    const first = new URL(a);
    const second = new URL(b);
    if (first.protocol !== second.protocol || first.port !== second.port) return false;
    const hostA = first.hostname.toLowerCase().replace(/\.$/, "");
    const hostB = second.hostname.toLowerCase().replace(/\.$/, "");
    if (hostA === hostB) return true;
    const stripWww = (host: string): string => (host.startsWith("www.") ? host.slice(4) : host);
    const baseA = stripWww(hostA);
    const baseB = stripWww(hostB);
    return baseA.length > 0 && baseA.includes(".") && baseA === baseB;
  } catch {
    return false;
  }
}
