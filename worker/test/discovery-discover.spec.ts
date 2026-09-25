import { describe, expect, it } from "vitest";
import type { PageSnapshot } from "../src/browser/snapshot-script";
import { discoverCandidates } from "../src/discovery/discover";
import { parseHttpUrl } from "../src/validation/url";
import { mockSiteFetch } from "./helpers";

function snapshotWithLinks(
  links: Array<{ href: string; text: string; inNav?: boolean; inHeader?: boolean; inFooter?: boolean }>,
): PageSnapshot {
  return {
    url: "https://example.com/",
    title: "Example",
    metaDescription: null,
    lang: "en",
    direction: "ltr",
    headings: [],
    links: links.map((link) => ({
      href: link.href,
      text: link.text,
      inNav: link.inNav ?? false,
      inHeader: link.inHeader ?? false,
      inFooter: link.inFooter ?? false,
    })),
    bodyBackgroundColor: "rgb(255,255,255)",
    bodyColor: "rgb(0,0,0)",
    bodyFontFamily: "sans-serif",
    pageCanvasColor: "rgb(255,255,255)",
    roleCounts: {},
    sectionCount: 0,
    formCount: 0,
    imageCount: 0,
    domElementCount: 0,
    viewport: { width: 1440, height: 900 },
    tokens: {
      colors: [],
      fontSizes: [],
      spacing: [],
      radii: [],
      borders: [],
      shadows: [],
      gradients: [],
      icons: [],
      customProperties: [],
    },
    typography: { fontFaces: [], fontFamilies: [], lineHeights: [], letterSpacings: [] },
    semanticStyles: [],
    layoutSamples: [],
    breakpoints: { mediaQueries: [] },
    motion: { transitions: [], animations: [], keyframes: [] },
    geometry: { containerWidths: [], sampledElements: 0 },
    content: {
      blocks: [],
      hiddenBlocks: [],
      controls: [],
      components: [],
      coverage: {},
      sections: [],
      tone: { avgSentenceWords: 0, questionCount: 0, ctaCount: 0, voice: "unknown" },
    },
    coverage: {},
    assets: [],
    embeds: [],
    social: { ogTitle: null, ogDescription: null, twitterCard: null, generator: null, themeColor: null },
    hoverStates: [],
    formActions: [],
    sectionRects: [],
    observedInteractions: [],
    limitations: [],
  };
}

describe("discoverCandidates", () => {
  it("merges robots sitemaps and navigation links, deduplicating by path", async () => {
    const fetchImpl = mockSiteFetch({
      "https://example.com/robots.txt": {
        body: "Sitemap: https://example.com/sitemap.xml\nDisallow: /admin",
      },
      "https://example.com/sitemap.xml": {
        body: "<urlset><url><loc>https://example.com/about</loc></url><url><loc>https://example.com/services</loc></url></urlset>",
      },
    });

    const snapshot = snapshotWithLinks([
      { href: "https://example.com/about", text: "About Us", inNav: true, inHeader: true },
      { href: "https://example.com/about/", text: "About", inNav: true, inHeader: true },
      { href: "https://example.com/contact", text: "Contact", inNav: true, inHeader: true },
      { href: "https://other.example.net/partner", text: "Partner", inNav: true, inHeader: true },
      { href: "https://example.com/", text: "Home", inNav: true, inHeader: true },
    ]);

    const result = await discoverCandidates({
      target: parseHttpUrl("https://example.com/"),
      snapshot,
      fetchImpl,
      timeoutMs: 1_000,
    });

    const paths = result.candidates.map((candidate) => candidate.path).sort();
    expect(paths).toEqual(["/about", "/contact", "/services"]);
    expect(result.robotsFound).toBe(true);
    expect(result.sitemapUrlCount).toBe(2);

    const about = result.candidates.find((candidate) => candidate.path === "/about");
    expect(about?.sources.sort()).toEqual(["header", "sitemap"]);
    expect(about?.occurrences).toBe(3);
    expect(about?.label).toBe("About Us");
  });

  it("classifies header, nav, footer, and homepage link sources", async () => {
    const fetchImpl = mockSiteFetch({});
    const snapshot = snapshotWithLinks([
      { href: "https://example.com/a", text: "A", inNav: true, inHeader: true },
      { href: "https://example.com/b", text: "B", inNav: true, inHeader: false },
      { href: "https://example.com/c", text: "C", inNav: true, inFooter: true },
      { href: "https://example.com/d", text: "D" },
    ]);

    const result = await discoverCandidates({
      target: parseHttpUrl("https://example.com/"),
      snapshot,
      fetchImpl,
      timeoutMs: 1_000,
    });

    const sourceOf = (path: string) => result.candidates.find((c) => c.path === path)?.sources[0];
    expect(sourceOf("/a")).toBe("header");
    expect(sourceOf("/b")).toBe("nav");
    expect(sourceOf("/c")).toBe("footer");
    expect(sourceOf("/d")).toBe("homepage");
  });

  it("falls back to /sitemap.xml and warns when robots.txt is missing", async () => {
    const fetchImpl = mockSiteFetch({
      "https://example.com/sitemap.xml": {
        body: "<urlset><url><loc>https://example.com/team</loc></url></urlset>",
      },
    });

    const result = await discoverCandidates({
      target: parseHttpUrl("https://example.com/"),
      snapshot: null,
      fetchImpl,
      timeoutMs: 1_000,
    });

    expect(result.robotsFound).toBe(false);
    expect(result.candidates.map((candidate) => candidate.path)).toEqual(["/team"]);
    expect(result.warnings.some((warning) => warning.includes("robots.txt"))).toBe(true);
  });

  it("works when the snapshot is unavailable", async () => {
    const result = await discoverCandidates({
      target: parseHttpUrl("https://example.com/"),
      snapshot: null,
      fetchImpl: mockSiteFetch({}),
      timeoutMs: 1_000,
    });

    expect(result.candidates).toEqual([]);
    expect(result.sitemapsChecked).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("does not re-add a mixed-case homepage path as a candidate", async () => {
    const snapshot = snapshotWithLinks([
      { href: "https://example.com/Home", text: "Home", inNav: true, inHeader: true },
      { href: "https://example.com/about", text: "About", inNav: true, inHeader: true },
    ]);

    const result = await discoverCandidates({
      target: parseHttpUrl("https://example.com/Home"),
      snapshot,
      fetchImpl: mockSiteFetch({}),
      timeoutMs: 1_000,
    });

    expect(result.candidates.map((candidate) => candidate.path)).toEqual(["/about"]);
  });

  it("treats www/apex link variants as the same site", async () => {
    const snapshot = snapshotWithLinks([
      { href: "https://example.com/studio", text: "Studio", inNav: true, inHeader: true },
    ]);

    const result = await discoverCandidates({
      target: parseHttpUrl("https://www.example.com/"),
      snapshot,
      fetchImpl: mockSiteFetch({}),
      timeoutMs: 1_000,
    });

    expect(result.candidates.map((candidate) => candidate.path)).toEqual(["/studio"]);
  });

  it("scopes robots and sitemap to the post-redirect origin", async () => {
    const fetchImpl = mockSiteFetch({
      "https://example.com/robots.txt": {
        body: "Sitemap: https://example.com/sitemap.xml",
      },
      "https://example.com/sitemap.xml": {
        body: "<urlset><url><loc>https://example.com/studio</loc></url></urlset>",
      },
    });
    const snapshot = snapshotWithLinks([]);

    const scoped = await discoverCandidates({
      target: parseHttpUrl("https://www.example.com/"),
      snapshot,
      fetchImpl,
      timeoutMs: 1_000,
      scopeOrigin: "https://example.com",
    });

    expect(scoped.sitemapsChecked).toEqual(["https://example.com/sitemap.xml"]);
    expect(scoped.candidates.map((candidate) => candidate.path)).toEqual(["/studio"]);

    // Without the scope, the www fallback finds nothing.
    const unscoped = await discoverCandidates({
      target: parseHttpUrl("https://www.example.com/"),
      snapshot,
      fetchImpl: mockSiteFetch({}),
      timeoutMs: 1_000,
    });
    expect(unscoped.candidates).toEqual([]);
  });
});
