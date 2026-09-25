import { describe, expect, it } from "vitest";
import { buildSelection, type SelectionInput } from "../src/ranking/key-pages";
import type { Candidate, CandidateSource } from "../src/discovery/types";

function candidate(
  path: string,
  sources: CandidateSource[] = ["homepage"],
  options: { label?: string; occurrences?: number; inNav?: boolean; hasQuery?: boolean } = {},
): Candidate {
  return {
    url: `https://example.com${path}`,
    path,
    label: options.label ?? "",
    sources,
    inNav: options.inNav ?? false,
    occurrences: options.occurrences ?? 1,
    hasQuery: options.hasQuery ?? false,
  };
}

function select(candidates: Candidate[], maxPages = 10): ReturnType<typeof buildSelection> {
  const input: SelectionInput = {
    candidates,
    maxPages,
    homepageUrl: "https://example.com/",
  };
  return buildSelection(input);
}

describe("buildSelection", () => {
  it("always selects the homepage first", () => {
    const report = select([]);
    const home = report.candidates[0]!;
    expect(home.path).toBe("/");
    expect(home.selected).toBe(true);
    expect(home.priority).toBe(1);
    expect(report.pagesSelected).toBe(1);
  });

  it("excludes utility URLs", () => {
    const report = select([
      candidate("/login", ["header"]),
      candidate("/checkout", ["header"]),
      candidate("/privacy-policy", ["footer"]),
      candidate("/account/settings", ["header"]),
    ]);

    for (const path of ["/login", "/checkout", "/privacy-policy", "/account/settings"]) {
      const entry = report.candidates.find((c) => c.path === path);
      expect(entry?.selected).toBe(false);
      expect(entry?.excludedReason).toMatch(/Excluded/);
    }
    expect(report.pagesSelected).toBe(1);
  });

  it("excludes non-HTML assets", () => {
    const report = select([candidate("/brochure.pdf", ["sitemap"])]);
    const entry = report.candidates.find((c) => c.path === "/brochure.pdf");
    expect(entry?.excludedReason).toContain("non-HTML asset");
  });

  it("excludes 3D models, media, fonts, and documents", () => {
    const report = select([
      candidate("/assets/models/chair_compressed-combined.glb", ["homepage"]),
      candidate("/assets/scene.gltf", ["homepage"]),
      candidate("/assets/model.usdz", ["homepage"]),
      candidate("/video/hero.mov", ["homepage"]),
      candidate("/audio/ambient.ogg", ["homepage"]),
      candidate("/fonts/display.ttf", ["homepage"]),
      candidate("/spec/sheet.xlsx", ["homepage"]),
      candidate("/img/photo.avif", ["homepage"]),
    ]);

    for (const path of [
      "/assets/models/chair_compressed-combined.glb",
      "/assets/scene.gltf",
      "/assets/model.usdz",
      "/video/hero.mov",
      "/audio/ambient.ogg",
      "/fonts/display.ttf",
      "/spec/sheet.xlsx",
      "/img/photo.avif",
    ]) {
      const entry = report.candidates.find((c) => c.path === path);
      expect(entry?.selected).toBe(false);
      expect(entry?.excludedReason).toContain("non-HTML asset");
    }
  });

  it("excludes markdown, feed, and data assets", () => {
    const report = select([
      candidate("/agents.md", ["sitemap"]),
      candidate("/changelog.markdown", ["sitemap"]),
      candidate("/news.rss", ["sitemap"]),
    ]);

    for (const path of ["/agents.md", "/changelog.markdown", "/news.rss"]) {
      const entry = report.candidates.find((c) => c.path === path);
      expect(entry?.selected).toBe(false);
      expect(entry?.excludedReason).toContain("non-HTML asset");
    }
  });

  it("excludes authentication and password flows", () => {
    const report = select([
      candidate("/customer_authentication/redirect", ["homepage"], { label: "Sign in" }),
      candidate("/password/change", ["homepage"], { label: "Change password" }),
    ]);

    const auth = report.candidates.find((c) => c.path === "/customer_authentication/redirect")!;
    expect(auth.selected).toBe(false);
    expect(auth.excludedReason).toContain("authentication");
    const password = report.candidates.find((c) => c.path === "/password/change")!;
    expect(password.selected).toBe(false);
    expect(password.excludedReason).toContain("password");
  });

  it("ranks priority pages above other links", () => {
    const report = select(
      [
        candidate("/services", ["header"], { label: "Services" }),
        candidate("/random-thing", ["homepage"]),
        candidate("/pricing", ["header"], { label: "Pricing" }),
      ],
      3,
    );

    const selected = report.candidates.filter((c) => c.selected);
    expect(selected.map((c) => c.path)).toEqual(["/", "/services", "/pricing"]);
    expect(selected.map((c) => c.priority)).toEqual([1, 2, 3]);
  });

  it("rewards repetition across navigation areas", () => {
    const report = select([
      candidate("/a", ["header"], { occurrences: 1 }),
      candidate("/b", ["header"], { occurrences: 3 }),
    ]);

    const a = report.candidates.find((c) => c.path === "/a")!;
    const b = report.candidates.find((c) => c.path === "/b")!;
    expect(b.score).toBeGreaterThan(a.score);
  });

  it("penalises deep and query-heavy URLs", () => {
    const report = select([
      candidate("/one", ["sitemap"]),
      candidate("/a/b/c/d/e", ["sitemap"]),
      candidate("/filter", ["sitemap"], { hasQuery: true }),
    ]);

    const one = report.candidates.find((c) => c.path === "/one")!;
    const deep = report.candidates.find((c) => c.path === "/a/b/c/d/e")!;
    const query = report.candidates.find((c) => c.path === "/filter")!;

    expect(deep.score).toBeLessThan(one.score);
    expect(query.score).toBeLessThan(one.score);
  });

  it("respects the maxPages cap", () => {
    const candidates = Array.from({ length: 20 }, (_, index) =>
      candidate(`/page-${index}`, ["sitemap"]),
    );
    const report = select(candidates, 4);

    expect(report.maxPages).toBe(4);
    expect(report.pagesSelected).toBe(4);
    expect(report.candidates.filter((c) => c.selected)).toHaveLength(4);
    expect(report.candidates.filter((c) => c.priority !== null)).toHaveLength(4);
  });

  it("records a human-readable reason and explicit status for every candidate", () => {    const report = select([
      candidate("/services", ["header"], { label: "Services", occurrences: 2 }),
      candidate("/login", ["footer"]),
      candidate("/overflow-1", ["homepage"]),
      candidate("/overflow-2", ["homepage"]),
    ], 2);

    expect(report.pagesSelected).toBe(2);

    for (const entry of report.candidates) {
      expect(["selected", "excluded"]).toContain(entry.status);
      expect(typeof entry.reason).toBe("string");
      expect(entry.reason.length).toBeGreaterThan(0);
      if (entry.status === "selected") {
        expect(entry.selected).toBe(true);
        expect(entry.reason).toBe(entry.selectedBecause);
      } else {
        expect(entry.selected).toBe(false);
        expect(entry.reason).toBe(entry.excludedReason);
        expect(entry.excludedReason).not.toBeNull();
      }
    }
  });

  it("selects one representative per section for deep pages", () => {
    const report = select(
      [
        candidate("/work/alpha", ["sitemap"]),
        candidate("/work/beta", ["sitemap"]),
        candidate("/work/gamma", ["sitemap"]),
        candidate("/blog/first", ["sitemap"]),
        candidate("/blog/second", ["sitemap"]),
        candidate("/about", ["header"], { label: "About" }),
      ],
      10,
    );

    const selected = report.candidates.filter((c) => c.selected);
    const deepSelected = selected.filter((c) => c.path !== "/" && c.path.split("/").length > 2);
    // One /work/* rep, one /blog/* rep, plus homepage and /about.
    // (/work/beta wins its section on the shortest-path tiebreak.)
    expect(selected.map((c) => c.path).sort()).toEqual(["/", "/about", "/blog/first", "/work/beta"]);
    expect(deepSelected).toHaveLength(2);

    const alpha = report.candidates.find((c) => c.path === "/work/alpha")!;
    expect(alpha.selected).toBe(false);
    expect(alpha.excludedReason).toContain("/work/beta");
    expect(alpha.excludedReason).toContain("already represented");
    expect(report.pagesSelected).toBe(4);
  });

  it("never samples away top-level pages", () => {
    const report = select(
      [
        candidate("/about", ["header"], { label: "About" }),
        candidate("/contact", ["header"], { label: "Contact" }),
        candidate("/work", ["header"], { label: "Work" }),
        candidate("/work/alpha", ["sitemap"]),
      ],
      10,
    );

    for (const path of ["/about", "/contact", "/work"]) {
      expect(report.candidates.find((c) => c.path === path)?.selected).toBe(true);
    }
    expect(report.candidates.find((c) => c.path === "/work/alpha")?.selected).toBe(true);
  });
});

