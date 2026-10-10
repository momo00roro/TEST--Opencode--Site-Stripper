import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLocalStaticPath } from "../local/static";

const webRoot = fileURLToPath(new URL("../../web", import.meta.url));

describe("local static routes", () => {
  it("maps the root, marketing routes, and local analyzer route to their HTML files", () => {
    expect(resolveLocalStaticPath("/", webRoot)).toBe(resolve(webRoot, "index.html"));
    expect(resolveLocalStaticPath("/app", webRoot)).toBe(resolve(webRoot, "app/index.html"));
    expect(resolveLocalStaticPath("/app/", webRoot)).toBe(resolve(webRoot, "app/index.html"));
    for (const route of ["features", "how-it-works", "sample-pack", "faq", "sign-up", "sign-in", "sign-up/complete", "sign-in/complete"]) {
      expect(resolveLocalStaticPath(`/${route}`, webRoot)).toBe(resolve(webRoot, route, "index.html"));
      expect(resolveLocalStaticPath(`/${route}/`, webRoot)).toBe(resolve(webRoot, route, "index.html"));
    }
    expect(resolveLocalStaticPath("/app.js", webRoot)).toBe(resolve(webRoot, "app.js"));
  });

  it("rejects paths that resolve outside the static root", () => {
    expect(resolveLocalStaticPath("/../../README.md", webRoot)).toBeNull();
  });
});
