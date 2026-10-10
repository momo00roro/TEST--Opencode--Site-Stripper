import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { injectLocalLaunchButton, resolveLocalStaticPath } from "../local/static";

const webRoot = fileURLToPath(new URL("../../web", import.meta.url));

describe("local static routes", () => {
  it("maps the root and analyzer aliases to their HTML files", () => {
    expect(resolveLocalStaticPath("/", webRoot)).toBe(resolve(webRoot, "index.html"));
    expect(resolveLocalStaticPath("/app", webRoot)).toBe(resolve(webRoot, "app/index.html"));
    expect(resolveLocalStaticPath("/app/", webRoot)).toBe(resolve(webRoot, "app/index.html"));
    expect(resolveLocalStaticPath("/alpha", webRoot)).toBe(resolve(webRoot, "alpha/index.html"));
    expect(resolveLocalStaticPath("/alpha/", webRoot)).toBe(resolve(webRoot, "alpha/index.html"));
    expect(resolveLocalStaticPath("/app.js", webRoot)).toBe(resolve(webRoot, "app.js"));
  });

  it("rejects paths that resolve outside the static root", () => {
    expect(resolveLocalStaticPath("/../../README.md", webRoot)).toBeNull();
  });
});

describe("local launch button injection", () => {
  it("replaces the homepage marker with one Launch app link", () => {
    const html = "<header><!-- LOCAL_LAUNCH_BUTTON --></header>";
    const rendered = injectLocalLaunchButton(html);
    expect(rendered).toContain('<a class="local-launch" href="/app/">Launch app</a>');
    expect(rendered).not.toContain("<!-- LOCAL_LAUNCH_BUTTON -->");
  });

  it("leaves pages without the marker unchanged", () => {
    expect(injectLocalLaunchButton("<main>Alpha access</main>")).toBe("<main>Alpha access</main>");
  });
});
