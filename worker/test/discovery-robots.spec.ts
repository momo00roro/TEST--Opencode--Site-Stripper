import { describe, expect, it } from "vitest";
import { parseRobots } from "../src/discovery/robots";

describe("parseRobots", () => {
  it("collects sitemaps and disallow rules", () => {
    const info = parseRobots(
      [
        "# comment",
        "User-agent: *",
        "Disallow: /admin",
        "",
        "Sitemap: https://example.com/sitemap.xml",
        "sitemap: https://example.com/news-sitemap.xml",
      ].join("\n"),
    );

    expect(info.sitemaps).toEqual([
      "https://example.com/sitemap.xml",
      "https://example.com/news-sitemap.xml",
    ]);
    expect(info.disallow).toEqual(["/admin"]);
  });

  it("ignores malformed lines and empty values", () => {
    const info = parseRobots("nonsense\nDisallow:\nSitemap:\n\n:value");
    expect(info.sitemaps).toEqual([]);
    expect(info.disallow).toEqual([]);
  });

  it("tolerates CRLF and leading whitespace", () => {
    const info = parseRobots("   Sitemap:  https://example.com/sitemap.xml  \r\nDisallow: /tmp\r\n");
    expect(info.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
    expect(info.disallow).toEqual(["/tmp"]);
  });
});
