import { describe, expect, it } from "vitest";
import { collectSitemapUrls, decodeXmlEntities, parseSitemap } from "../src/discovery/sitemap";
import { mockSiteFetch } from "./helpers";

describe("parseSitemap", () => {
  it("extracts same-file url entries", () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/</loc></url>
        <url><loc>https://example.com/about</loc></url>
        <url><loc>https://example.com/services?ref=nav&amp;x=1</loc></url>
      </urlset>`;

    const parsed = parseSitemap(xml);
    expect(parsed.urls).toEqual([
      "https://example.com/",
      "https://example.com/about",
      "https://example.com/services?ref=nav&x=1",
    ]);
    expect(parsed.childSitemaps).toEqual([]);
    expect(parsed.truncated).toBe(false);
  });

  it("detects a sitemap index and separates child sitemaps", () => {
    const xml = `<sitemapindex>
      <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
      <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
    </sitemapindex>`;

    const parsed = parseSitemap(xml);
    expect(parsed.childSitemaps).toEqual([
      "https://example.com/sitemap-pages.xml",
      "https://example.com/sitemap-posts.xml",
    ]);
    expect(parsed.urls).toEqual([]);
  });

  it("skips relative and non-http loc values", () => {
    const xml = "<urlset><loc>/relative</loc><loc>ftp://example.com/x</loc></urlset>";
    expect(parseSitemap(xml).urls).toEqual([]);
  });

  it("handles a truncated document without throwing", () => {
    const xml = "<urlset><url><loc>https://example.com/a</loc>";
    expect(parseSitemap(xml).urls).toEqual(["https://example.com/a"]);
  });
});

describe("decodeXmlEntities", () => {
  it("decodes common entities", () => {
    expect(decodeXmlEntities("a&amp;b&lt;c&gt;d&quot;e&#39;f")).toBe("a&b<c>d\"e'f");
  });
});

describe("collectSitemapUrls", () => {
  it("follows a sitemap index into child sitemaps", async () => {
    const fetchImpl = mockSiteFetch({
      "https://example.com/sitemap.xml": {
        body: "<sitemapindex><sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap></sitemapindex>",
      },
      "https://example.com/sitemap-pages.xml": {
        body: "<urlset><url><loc>https://example.com/about</loc></url></urlset>",
      },
    });

    const result = await collectSitemapUrls({
      origin: "https://example.com",
      sitemapUrls: ["https://example.com/sitemap.xml"],
      fetchImpl,
      timeoutMs: 1_000,
    });

    expect(result.urls).toEqual(["https://example.com/about"]);
    expect(result.sitemapsChecked).toEqual([
      "https://example.com/sitemap.xml",
      "https://example.com/sitemap-pages.xml",
    ]);
  });

  it("filters out cross-origin entries and reports unavailable sitemaps", async () => {
    const fetchImpl = mockSiteFetch({
      "https://example.com/sitemap.xml": {
        body: "<urlset><url><loc>https://evil.example.net/page</loc></url><url><loc>https://example.com/team</loc></url></urlset>",
      },
    });

    const result = await collectSitemapUrls({
      origin: "https://example.com",
      sitemapUrls: ["https://example.com/sitemap.xml", "https://example.com/missing.xml"],
      fetchImpl,
      timeoutMs: 1_000,
    });

    expect(result.urls).toEqual(["https://example.com/team"]);
    expect(result.warnings.some((warning) => warning.includes("missing.xml"))).toBe(true);
  });

  it("ignores sitemap roots on other origins", async () => {
    const fetchImpl = mockSiteFetch({});
    const result = await collectSitemapUrls({
      origin: "https://example.com",
      sitemapUrls: ["https://other.example.net/sitemap.xml"],
      fetchImpl,
      timeoutMs: 1_000,
    });

    expect(result.sitemapsChecked).toEqual([]);
    expect(result.urls).toEqual([]);
  });

  it("follows up to ten child sitemaps (Shopify-style indexes)", async () => {
    const children = ["products", "collections", "pages", "blogs", "agentic"];
    const routes: Record<string, { body: string }> = {
      "https://example.com/sitemap.xml": {
        body:
          "<sitemapindex>" +
          children.map((name) => `<sitemap><loc>https://example.com/sitemap-${name}.xml</loc></sitemap>`).join("") +
          "</sitemapindex>",
      },
    };
    for (const name of children) {
      routes[`https://example.com/sitemap-${name}.xml`] = {
        body: `<urlset><url><loc>https://example.com/${name}/item</loc></url></urlset>`,
      };
    }

    const result = await collectSitemapUrls({
      origin: "https://example.com",
      sitemapUrls: ["https://example.com/sitemap.xml"],
      fetchImpl: mockSiteFetch(routes),
      timeoutMs: 1_000,
    });

    expect(result.sitemapsChecked).toHaveLength(6);
    expect(result.urls).toHaveLength(5);
    expect(result.urls).toContain("https://example.com/blogs/item");
  });
});
