export interface RobotsInfo {
  sitemaps: string[];
  disallow: string[];
}

const MAX_LINES = 2_000;

export function parseRobots(text: string): RobotsInfo {
  const sitemaps: string[] = [];
  const disallow: string[] = [];

  const lines = text.split(/\r?\n/);
  const limit = Math.min(lines.length, MAX_LINES);

  for (let i = 0; i < limit; i += 1) {
    const line = lines[i]!.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (value.length === 0) continue;

    if (key === "sitemap") sitemaps.push(value);
    else if (key === "disallow") disallow.push(value);
  }

  return { sitemaps, disallow };
}

export function defaultSitemapUrl(origin: string): string {
  return `${origin}/sitemap.xml`;
}
