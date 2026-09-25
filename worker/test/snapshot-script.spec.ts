import { afterEach, describe, expect, it } from "vitest";
import { collectPageSnapshot } from "../src/browser/snapshot-script";

interface ShimElement {
  tagName: string;
  textContent: string;
  href: string;
  type?: string;
  name?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  options: ShimElement[];
  attrs: Record<string, string>;
  within: ShimElement[];
  getAttribute(name: string): string | null;
  contains: (candidate: ShimElement) => boolean;
  closest: (selector: string) => ShimElement | null;
}

function el(
  tagName: string,
  options: { text?: string; attrs?: Record<string, string>; within?: ShimElement[] } = {},
): ShimElement {
  const ancestors = options.within ?? [];
  const attributes = options.attrs ?? {};
  const element: ShimElement = {
    tagName: tagName.toUpperCase(),
    textContent: options.text ?? "",
    href: attributes.href ?? "",
    type: attributes.type,
    name: attributes.name,
    id: attributes.id,
    required: "required" in attributes,
    disabled: "disabled" in attributes,
    className: attributes.class ?? "",
    options: [],
    attrs: attributes,
    within: ancestors,
    getAttribute: (name) => (name in attributes ? attributes[name]! : null),
    contains: (candidate) => candidate === element || candidate.within.includes(element),
    closest: (selector) => {
      const candidates = [element, ...ancestors.slice().reverse()];
      if (selector === "summary") return candidates.find((candidate) => candidate.tagName === "SUMMARY") ?? null;
      if (selector === "details:not([open])") return candidates.find((candidate) => candidate.tagName === "DETAILS" && !("open" in candidate.attrs)) ?? null;
      if (selector === "[aria-hidden='true'], [hidden]") return candidates.find((candidate) => candidate.attrs["aria-hidden"] === "true" || "hidden" in candidate.attrs) ?? null;
      return null;
    },
  };
  return element;
}

function matchesOne(element: ShimElement, selector: string): boolean {
  const attrOnly = /^\[([\w-]+)\]$/.exec(selector);
  if (attrOnly) return attrOnly[1]! in element.attrs;

  const roleOnly = /^\[role=['"]?([\w-]+)['"]?\]$/.exec(selector);
  if (roleOnly) return element.attrs.role === roleOnly[1];

  const attrPresent = /^(\w+)\[([\w-]+)\]$/.exec(selector);
  if (attrPresent) {
    return element.tagName === attrPresent[1]!.toUpperCase() && attrPresent[2]! in element.attrs;
  }

  const attrEquals = /^(\w+)\[([\w-]+)=["']?([^"'\]]+)["']?\]$/.exec(selector);
  if (attrEquals) {
    return (
      element.tagName === attrEquals[1]!.toUpperCase() &&
      element.attrs[attrEquals[2]!] === attrEquals[3]
    );
  }

  if (selector === "*") return true;
  return element.tagName === selector.toUpperCase();
}

function matches(element: ShimElement, selector: string): boolean {
  return selector
    .split(",")
    .map((part) => part.trim())
    .some((part) => matchesOne(element, part));
}

function installDom(elements: ShimElement[], title: string): Record<string, unknown> {
  const previous = {
    document: (globalThis as Record<string, unknown>).document,
    window: (globalThis as Record<string, unknown>).window,
    getComputedStyle: (globalThis as Record<string, unknown>).getComputedStyle,
  };

  const documentShim = {
    title,
    location: { href: "https://example.com/" },
    documentElement: { getAttribute: (name: string) => (name === "lang" ? "en" : null) },
    body: el("body"),
    querySelector: (selector: string) => elements.find((e) => matches(e, selector)) ?? null,
    querySelectorAll: (selector: string) => elements.filter((e) => matches(e, selector)),
  };

  const globals = globalThis as Record<string, unknown>;
  globals.document = documentShim;
  globals.window = { innerWidth: 1440, innerHeight: 900 };
  globals.getComputedStyle = () => ({
    backgroundColor: "rgb(255, 255, 255)",
    color: "rgb(17, 17, 17)",
    fontFamily: "Inter, sans-serif",
  });

  return previous;
}

function restoreGlobals(previous: Record<string, unknown>): void {
  const globals = globalThis as Record<string, unknown>;
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete globals[key];
    else globals[key] = value;
  }
}

let saved: Record<string, unknown> | null = null;

afterEach(() => {
  if (saved) {
    restoreGlobals(saved);
    saved = null;
  }
});

describe("collectPageSnapshot", () => {
  it("executes in a page-like context without leaking module scope", () => {    const body = el("body");
    const header = el("header", { within: [body] });
    const nav = el("nav", { within: [header] });
    const footer = el("footer", { within: [body] });

    const elements: ShimElement[] = [
      el("h1", { text: "  Welcome   to  the   site " }),
      el("h2", { text: "Features" }),
      header,
      nav,
      el("a", { text: "About", attrs: { href: "https://example.com/about" }, within: [nav, header] }),
      footer,
      el("a", { text: "Privacy", attrs: { href: "https://example.com/privacy" }, within: [footer] }),
      el("a", { text: "Blog", attrs: { href: "https://example.com/blog" }, within: [body] }),
      el("section", { within: [body] }),
      el("section", { within: [body] }),
      el("form", { within: [body] }),
      el("img", { attrs: { src: "a.png" } }),
      el("img", { attrs: { src: "b.png" } }),
      el("button", { attrs: { role: "button" } }),
      el("meta", { attrs: { name: "description", content: "A demo site" } }),
    ];

    saved = installDom(elements, "Example Site");
    const snapshot = collectPageSnapshot();

    expect(snapshot.url).toBe("https://example.com/");
    expect(snapshot.title).toBe("Example Site");
    expect(snapshot.lang).toBe("en");
    expect(snapshot.metaDescription).toBe("A demo site");
    expect(snapshot.headings).toEqual([
      { level: 1, text: "Welcome to the site", truncated: false },
      { level: 2, text: "Features", truncated: false },
    ]);

    const about = snapshot.links.find((link) => link.text === "About");
    const privacy = snapshot.links.find((link) => link.text === "Privacy");
    const blog = snapshot.links.find((link) => link.text === "Blog");

    expect(about).toMatchObject({ inNav: true, inHeader: true, inFooter: false });
    expect(privacy).toMatchObject({ inNav: true, inHeader: false, inFooter: true });
    expect(blog).toMatchObject({ inNav: false, inHeader: false, inFooter: false });

    expect(snapshot.links).toHaveLength(3);
    expect(snapshot.sectionCount).toBe(2);
    expect(snapshot.formCount).toBe(1);
    expect(snapshot.imageCount).toBe(2);
    expect(snapshot.domElementCount).toBe(elements.length);
    expect(snapshot.roleCounts).toEqual({ button: 1 });
    expect(snapshot.bodyColor).toBe("rgb(17, 17, 17)");
    expect(snapshot.bodyFontFamily).toBe("Inter, sans-serif");
    expect(snapshot.viewport).toEqual({ width: 1440, height: 900 });
  });

  it("deduplicates repeated links", () => {
    const elements: ShimElement[] = [
      el("a", { text: "Home", attrs: { href: "https://example.com/" } }),
      el("a", { text: "Home again", attrs: { href: "https://example.com/" } }),
    ];

    saved = installDom(elements, "Dedupe");
    const snapshot = collectPageSnapshot();

    expect(snapshot.links).toHaveLength(1);
  });

  it("exposes bounded token containers with confidence tags", () => {
    saved = installDom([el("h1", { text: "Hi" }), el("p", { text: "Body" })], "Tokens");
    const snapshot = collectPageSnapshot();

    expect(snapshot.tokens.colors.length).toBeLessThanOrEqual(15);
    expect(snapshot.tokens.fontSizes.length).toBeLessThanOrEqual(10);
    expect(snapshot.tokens.spacing.length).toBeLessThanOrEqual(8);
    expect(snapshot.tokens.radii.length).toBeLessThanOrEqual(8);
    expect(snapshot.tokens.borders.length).toBeLessThanOrEqual(8);
    expect(snapshot.tokens.shadows.length).toBeLessThanOrEqual(8);
    expect(snapshot.tokens.customProperties.length).toBeLessThanOrEqual(50);
    expect(snapshot.coverage["tokens.colors"]).toMatchObject({ sourceCount: snapshot.tokens.colors.length, emittedCount: snapshot.tokens.colors.length, cap: 15 });
    expect(snapshot.typography.fontFaces.length).toBeLessThanOrEqual(20);
    expect(snapshot.breakpoints.mediaQueries.length).toBeLessThanOrEqual(20);
    expect(snapshot.motion.transitions.length).toBeLessThanOrEqual(20);
    expect(snapshot.geometry.containerWidths.length).toBeLessThanOrEqual(8);
    for (const token of [
      ...snapshot.tokens.colors,
      ...snapshot.tokens.fontSizes,
      ...snapshot.geometry.containerWidths,
    ]) {
      expect(["observed", "inferred", "unknown"]).toContain(token.confidence);
      expect(typeof token.value).toBe("string");
      expect(typeof token.count).toBe("number");
      expect(typeof token.source).toBe("string");
    }
    expect(Array.isArray(snapshot.limitations)).toBe(true);
  });

  it("skips cross-origin stylesheets but still samples computed styles", () => {
    const elements: ShimElement[] = [
      el("h1", { text: "Hi" }),
      el("p", { text: "Body copy" }),
      el("button", { text: "Click" }),
    ];
    saved = installDom(elements, "Cross-origin");

    const badSheet: Record<string, unknown> = { href: "https://cdn.example.com/app.css" };
    Object.defineProperty(badSheet, "cssRules", {
      get() {
        throw new Error("SecurityError");
      },
    });
    const goodRule = {
      type: 1,
      style: { cssText: "color: rgb(1, 2, 3); font-size: 16px; margin-top: 8px;" },
    };
    const mediaRule = {
      type: 4,
      conditionText: "(max-width: 768px)",
      cssRules: [{ style: { cssText: "color: red; font-size: 14px;" } }],
    };
    const fontRule = {
      type: 5,
      cssText: '@font-face { font-family: "Test"; src: url(test.woff2); font-weight: 700; }',
    };
    const keyframesRule = { type: 7, name: "fade" };
    const goodSheet = {
      href: "https://example.com/app.css",
      cssRules: [goodRule, mediaRule, fontRule, keyframesRule],
    };
    (globalThis as Record<string, unknown>).document = {
      ...((globalThis as Record<string, unknown>).document as Record<string, unknown>),
      styleSheets: [badSheet, goodSheet],
    };

    const snapshot = collectPageSnapshot();

    expect(snapshot.limitations.some((line) => line.includes("Cross-origin stylesheet skipped"))).toBe(true);
    expect(snapshot.limitations.some((line) => line.includes("https://cdn.example.com/app.css"))).toBe(true);
    // Computed-style sampling still yields inferred tokens despite the CDN block.
    expect(snapshot.tokens.colors.length).toBeGreaterThan(0);
    expect(snapshot.tokens.colors.find((token) => token.value === "rgb(1, 2, 3)")).toMatchObject({ source: "cssom-rule", confidence: "observed" });
    expect(snapshot.tokens.colors.find((token) => token.value === "rgb(255, 255, 255)")).toMatchObject({ source: "computed-style-sampling", confidence: "inferred" });
    expect(snapshot.breakpoints.mediaQueries[0]?.query).toContain("max-width");
    expect(snapshot.typography.fontFaces[0]?.family).toContain("Test");
    expect(snapshot.motion.keyframes).toContain("fade");
  });

  it("merges duplicate media queries by union of changed properties", () => {    saved = installDom([el("p", { text: "Body" })], "Breakpoints");
    const mediaA = {
      type: 4,
      conditionText: "(max-width: 640px)",
      cssRules: [{ style: { cssText: "color: red;" } }],
    };
    const mediaB = {
      type: 4,
      conditionText: "(max-width: 640px)",
      cssRules: [{ style: { cssText: "padding: 8px;" } }],
    };
    (globalThis as Record<string, unknown>).document = {
      ...((globalThis as Record<string, unknown>).document as Record<string, unknown>),
      styleSheets: [{ href: "https://example.com/a.css", cssRules: [mediaA, mediaB] }],
    };

    const snapshot = collectPageSnapshot();

    expect(snapshot.breakpoints.mediaQueries).toHaveLength(1);
    expect(snapshot.breakpoints.mediaQueries[0]?.query).toBe("(max-width: 640px)");
    expect([...(snapshot.breakpoints.mediaQueries[0]?.changedProperties ?? [])].sort()).toEqual([
      "color",
      "padding",
    ]);
  });

  it("records a repeated cross-origin stylesheet only once", () => {
    saved = installDom([el("p", { text: "Body" })], "Repeated sheets");
    const repeated: Record<string, unknown> = { href: "https://cdn.example.com/app.css" };
    Object.defineProperty(repeated, "cssRules", {
      get() {
        throw new Error("SecurityError");
      },
    });
    (globalThis as Record<string, unknown>).document = {
      ...((globalThis as Record<string, unknown>).document as Record<string, unknown>),
      styleSheets: [repeated, repeated, repeated],
    };

    const snapshot = collectPageSnapshot();
    const notes = snapshot.limitations.filter((line) =>
      line.includes("Cross-origin stylesheet skipped"),
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("https://cdn.example.com/app.css");
  });

  it("keeps maximal pages under the extraction hard cap", () => {
    const elements: ShimElement[] = [];
    for (let index = 0; index < 200; index += 1) {
      elements.push(el("h2", { text: "Heading " + index + " " + "x".repeat(500) }));
    }
    for (let index = 0; index < 500; index += 1) {
      elements.push(
        el("a", {
          text: "Link " + index + " " + "y".repeat(500),
          attrs: { href: "https://example.com/page-" + index },
        }),
      );
    }

    saved = installDom(elements, "Maximal");
    const snapshot = collectPageSnapshot();
    const bytes = JSON.stringify(snapshot).length;

    expect(bytes).toBeLessThanOrEqual(512 * 1024);
  });

  it("keeps the extractor self-contained for page.evaluate", () => {
    const source = collectPageSnapshot.toString();

    expect(source).not.toMatch(/__name|__spreadValues|require\(|LIMITS|from\s+["']/);
    expect(source).toContain("Cross-origin stylesheet skipped");
    expect(source).toMatch(/350\s*\*\s*1024/);
    expect(source).toMatch(/512\s*\*\s*1024/);
  });

  it("exposes bounded content and asset containers", () => {
    saved = installDom([el("p", { text: "Hello world" })], "Content");
    const snapshot = collectPageSnapshot();

    expect(snapshot.content.blocks.length).toBeLessThanOrEqual(120);
    expect(snapshot.content.controls.length).toBeLessThanOrEqual(100);
    expect(snapshot.content.components.length).toBeLessThanOrEqual(20);
    expect(snapshot.content.sections.length).toBeLessThanOrEqual(20);
    expect(snapshot.assets.length).toBeLessThanOrEqual(100);
    expect(snapshot.content.coverage.contentBlocks?.emittedCount).toBe(snapshot.content.blocks.length);
  });

  it("collects verbatim paragraphs, buttons, and tone notes", () => {
    saved = installDom(
      [
        el("p", { text: "Buy now! Great offer?" }),
        el("button", { text: "Get started" }),
        el("label", { text: "Email address" }),
        el("li", { text: "Feature one" }),
      ],
      "Tone",
    );
    const snapshot = collectPageSnapshot();

    expect(snapshot.content.blocks.find((block) => block.kind === "paragraph")?.text).toContain("Buy now");
    expect(snapshot.content.controls.some((control) => control.kind === "button" && control.label === "Get started")).toBe(true);
    expect(snapshot.content.blocks.some((block) => block.kind === "form-label" && block.text === "Email address")).toBe(true);
    expect(snapshot.content.blocks.some((block) => block.kind === "list-item" && block.text === "Feature one")).toBe(true);
    expect(typeof snapshot.content.tone.avgSentenceWords).toBe("number");
    expect(snapshot.content.tone.ctaCount).toBeGreaterThan(0);
    expect(snapshot.content.tone.questionCount).toBeGreaterThan(0);
  });

  it("preserves semantic copy order and long visible text with explicit caps", () => {
    const longCopy = "Detailed project information ".repeat(25);
    const summary = el("summary", { text: "Frequently asked question" });
    saved = installDom(
      [
        el("h2", { text: "FAQs" }),
        el("p", { text: longCopy }),
        el("blockquote", { text: "A client quote" }),
        el("details"),
        summary,
      ],
      "Content coverage",
    );
    const snapshot = collectPageSnapshot();

    expect(snapshot.content.blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "blockquote",
      "summary",
    ]);
    const paragraph = snapshot.content.blocks.find((block) => block.kind === "paragraph");
    expect(paragraph?.text).toBe(longCopy.trim());
    expect(paragraph?.truncated).toBe(false);
    expect(snapshot.content.coverage.contentBlocks).toMatchObject({ sourceCount: 4, emittedCount: 4, truncated: false });
  });

  it("marks clipped headings and preserves role-specific style/layout samples", () => {
    const longHeading = "Heading detail ".repeat(120);
    saved = installDom([el("h1", { text: longHeading }), el("p", { text: "Body copy" }), el("button", { text: "Continue" }), el("a", { text: "Read more", attrs: { href: "https://example.com/more" } })], "Style evidence");
    const snapshot = collectPageSnapshot();

    expect(snapshot.headings[0]?.truncated).toBe(true);
    expect(snapshot.content.blocks.find((block) => block.kind === "heading")?.truncated).toBe(true);
    expect(snapshot.semanticStyles.length).toBeGreaterThan(0);
    expect(snapshot.semanticStyles.some((sample) => sample.role === "heading-1")).toBe(true);
    expect(snapshot.semanticStyles.some((sample) => sample.role === "link")).toBe(true);
    expect(snapshot.layoutSamples.some((sample) => sample.role === "body-copy")).toBe(true);
    expect(snapshot.semanticStyles.length).toBeLessThanOrEqual(8);
    expect(snapshot.layoutSamples.length).toBeLessThanOrEqual(8);
  });

  it("reports source and emitted counts when a collection cap is reached", () => {
    const elements = Array.from({ length: 130 }, (_, index) => el("p", { text: `Copy ${index}` }));
    saved = installDom(elements, "Content cap");
    const snapshot = collectPageSnapshot();

    expect(snapshot.content.blocks).toHaveLength(120);
    expect(snapshot.content.coverage.contentBlocks).toMatchObject({
      sourceCount: 130,
      emittedCount: 120,
      cap: 120,
      truncated: true,
      reason: "collection cap 120 reached",
    });
  });

  it("does not present hidden text or headings as visible observations", () => {
    const visible = el("p", { text: "Visible copy" });
    const hidden = el("p", { text: "Hidden FAQ answer", attrs: { "data-hidden": "true" } });
    const hiddenHeading = el("h2", { text: "Hidden heading", attrs: { "data-hidden": "true" } });
    const details = el("details");
    const summary = el("summary", { text: "FAQ question", within: [details] });
    const closedAnswer = el("p", { text: "Collapsed FAQ answer", within: [details] });
    saved = installDom([visible, hidden, hiddenHeading, details, summary, closedAnswer], "Visible content");
    (globalThis as Record<string, unknown>).getComputedStyle = (node: ShimElement) => ({
      display: node.getAttribute("data-hidden") === "true" ? "none" : "block",
      visibility: "visible",
      backgroundColor: "rgb(255, 255, 255)",
      color: "rgb(17, 17, 17)",
      fontFamily: "Inter, sans-serif",
    });

    const snapshot = collectPageSnapshot();
    expect(snapshot.content.blocks.map((block) => block.text)).toContain("Visible copy");
    expect(snapshot.content.blocks.map((block) => block.text)).toContain("FAQ question");
    expect(snapshot.content.blocks.map((block) => block.text)).not.toContain("Hidden FAQ answer");
    expect(snapshot.content.blocks.map((block) => block.text)).not.toContain("Collapsed FAQ answer");
    expect(snapshot.content.hiddenBlocks.map((block) => block.text)).toContain("Collapsed FAQ answer");
    expect(snapshot.content.hiddenBlocks.find((block) => block.text === "Collapsed FAQ answer")?.initialState).toBe("collapsed-details");
    expect(snapshot.headings).toEqual([]);
    expect(snapshot.coverage["content.blocks"]).toMatchObject({ sourceCount: 2, emittedCount: 2, truncated: false });
    expect(snapshot.coverage["content.hiddenBlocks"]).toMatchObject({ sourceCount: 3, emittedCount: 3, truncated: false });
  });

  it("records safe form/control metadata without capturing entered values", () => {
    const input = el("input", {
      attrs: { type: "email", name: "email", id: "email-field", required: "", value: "private@example.com", "aria-label": "Email address" },
    });
    const select = el("select", { attrs: { name: "service", "aria-expanded": "false" } });
    select.options.push(el("option", { text: "Brand Identity" }), el("option", { text: "Digital Experience" }));
    saved = installDom([el("form"), input, select], "Controls");
    const snapshot = collectPageSnapshot();

    expect(snapshot.content.controls[0]).toMatchObject({
      kind: "input",
      label: "Email address",
      type: "email",
      name: "email",
      id: "email-field",
      required: true,
      disabled: false,
    });
    expect(snapshot.content.controls[1]?.options).toEqual(["Brand Identity", "Digital Experience"]);
    expect(JSON.stringify(snapshot)).not.toContain("private@example.com");
  });

  it("groups repeated semantic components with bounded representative evidence", () => {
    const first = el("article", { text: "First case study", attrs: { class: "project-card featured" } });
    const second = el("article", { text: "Second case study", attrs: { class: "project-card" } });
    saved = installDom([first, second], "Component patterns");
    const snapshot = collectPageSnapshot();

    const cardPattern = snapshot.content.components.find((pattern) => pattern.kind === "project-card");
    expect(cardPattern?.count).toBe(2);
    expect(cardPattern?.examples).toContain("First case study");
    expect(snapshot.content.coverage.components).toMatchObject({ sourceCount: 2, emittedCount: 2, truncated: false });
  });

  it("collects image, icon, and video-poster assets by URL", () => {    saved = installDom(
      [
        el("img", { attrs: { src: "https://example.com/hero.jpg", alt: "Hero" } }),
        el("img", { attrs: { src: "/logo.png", alt: "Acme logo" } }),
        el("link", { attrs: { rel: "icon", href: "/favicon.ico" } }),
        el("meta", { attrs: { property: "og:image", content: "https://example.com/og.jpg" } }),
        el("video", { attrs: { poster: "/poster.jpg" } }),
      ],
      "Assets",
    );
    const snapshot = collectPageSnapshot();

    const urls = snapshot.assets.map((asset) => asset.url);
    expect(urls.some((url) => url.includes("hero.jpg"))).toBe(true);
    expect(urls.some((url) => url.includes("logo.png"))).toBe(true);
    expect(urls.some((url) => url.includes("favicon.ico"))).toBe(true);
    expect(urls.some((url) => url.includes("og.jpg"))).toBe(true);
    expect(urls.some((url) => url.includes("poster.jpg"))).toBe(true);
    expect(snapshot.assets.find((asset) => asset.url.includes("logo.png"))?.kind).toBe("logo");
    expect(snapshot.assets.find((asset) => asset.url.includes("favicon.ico"))?.kind).toBe("icon");
    for (const asset of snapshot.assets) {
      expect(typeof asset.url).toBe("string");
      expect(typeof asset.kind).toBe("string");
      expect(typeof asset.alt).toBe("string");
    }
  });

  it("reports repeated media URLs as collapsed references, not truncation", () => {
    saved = installDom([
      el("img", { attrs: { src: "https://example.com/shared.webp", alt: "Shared" } }),
      el("img", { attrs: { src: "https://example.com/shared.webp", alt: "Repeated" } }),
    ], "Deduplicated assets");
    const snapshot = collectPageSnapshot();

    expect(snapshot.assets).toHaveLength(1);
    expect(snapshot.coverage.assets).toMatchObject({ sourceCount: 2, emittedCount: 1, cap: 100, truncated: false, deduplicatedCount: 1 });
  });

  it("skips inline data blobs and map tiles in the asset manifest", () => {
    saved = installDom(
      [
        el("img", { attrs: { src: "data:image/svg+xml,%3Csvg%3E", alt: "inline" } }),
        el("img", { attrs: { src: "https://maps.googleapis.com/maps/vt?pb=abc", alt: "" } }),
        el("img", { attrs: { src: "https://maps.gstatic.com/mapfiles/transparent.png", alt: "" } }),
        el("img", { attrs: { src: "https://example.com/real.jpg", alt: "Real" } }),
      ],
      "Asset noise",
    );
    const snapshot = collectPageSnapshot();

    expect(snapshot.assets.map((asset) => asset.url)).toEqual(["https://example.com/real.jpg"]);
  });

  it("keeps maximal content pages under the extraction hard cap", () => {
    const elements: ShimElement[] = [];
    for (let index = 0; index < 50; index += 1) {
      elements.push(el("p", { text: "Paragraph " + index + " " + "z".repeat(500) }));
    }
    for (let index = 0; index < 100; index += 1) {
      elements.push(
        el("img", { attrs: { src: "https://example.com/img-" + index + ".jpg", alt: "Image " + index } }),
      );
    }

    saved = installDom(elements, "Maximal content");
    const snapshot = collectPageSnapshot();

    expect(JSON.stringify(snapshot).length).toBeLessThanOrEqual(512 * 1024);
    expect(snapshot.payloadBytes).toBe(JSON.stringify(snapshot).length);
    expect(snapshot.assets.length).toBeLessThanOrEqual(100);
  });

  it("prioritizes structure and reports every omitted collection under mixed large-page pressure", () => {
    const elements: ShimElement[] = [];
    for (let index = 0; index < 200; index += 1) elements.push(el("h2", { text: `Heading ${index} ` + "h".repeat(1000) }));
    for (let index = 0; index < 500; index += 1) elements.push(el("a", { text: `Navigation ${index}`, attrs: { href: `https://example.com/path-${index}-` + "p".repeat(350) } }));
    saved = installDom(elements, "Bounded mixed pressure");
    const snapshot = collectPageSnapshot();

    expect(snapshot.payloadBytes).toBe(JSON.stringify(snapshot).length);
    expect(snapshot.payloadBytes).toBeLessThanOrEqual(512 * 1024);
    expect(snapshot.content.coverage.headings?.truncated).toBe(true);
    expect(snapshot.content.coverage.links?.truncated).toBe(true);
    expect(snapshot.content.coverage.contentBlocks?.truncated).toBe(true);
    expect(snapshot.headings[0]?.text).toContain("Heading 0");
  });

  it("reads custom-property values via getPropertyValue", () => {
    saved = installDom([el("p", { text: "Themed copy" })], "Custom props");
    (globalThis as Record<string, unknown>).getComputedStyle = () => ({
      length: 1,
      0: "--brand",
      getPropertyValue: (name: string) => (name === "--brand" ? "#ff0000" : ""),
      backgroundColor: "rgb(255, 255, 255)",
      color: "rgb(17, 17, 17)",
      fontFamily: "Inter, sans-serif",
    });

    const snapshot = collectPageSnapshot();

    expect(snapshot.tokens.customProperties).toContainEqual({ name: "--brand", value: "#ff0000", source: "computed-custom-property", confidence: "inferred" });
  });

  it("labels submit inputs as buttons without submitting forms", () => {
    saved = installDom(
      [el("input", { attrs: { type: "submit", value: "Send" } })],
      "Submit input",
    );
    const snapshot = collectPageSnapshot();

    expect(snapshot.content.controls.some((control) => control.kind === "button" && control.label === "Send")).toBe(true);
    expect(snapshot.content.blocks.filter((block) => block.kind === "form-label")).toEqual([]);
  });

  it("records bounded observed interactions from DOM affordances", () => {
    saved = installDom(
      [
        el("button", { attrs: { onclick: "go()" }, text: "Buy" }),
        el("video", { attrs: { controls: "" } }),
        el("details", {}),
        el("div", { attrs: { role: "tab", "aria-selected": "true" }, text: "Tab one" }),
        el("div", { attrs: { tabindex: "0" }, text: "Focusable card" }),
        el("div", { attrs: { "ng-click": "open()", "x-data": "{ open: false }" } }),
      ],
      "Interactions",
    );
    const snapshot = collectPageSnapshot();

    expect(snapshot.observedInteractions.length).toBeGreaterThan(0);
    expect(snapshot.observedInteractions.length).toBeLessThanOrEqual(20);
    const kinds = snapshot.observedInteractions.map((entry) => entry.kind);
    expect(kinds).toContain("inline-onclick");
    expect(kinds).toContain("video-controls");
    expect(kinds).toContain("details-toggle");
    expect(kinds).toContain("role-interactive");
    expect(kinds).toContain("keyboard-focusable");
    expect(kinds).toContain("framework-handler");
  });

  it("excludes CSS-wide keywords and element defaults from ranked tokens", () => {
    saved = installDom([el("p", { text: "Body" })], "Junk tokens");
    const junkRule = {
      type: 1,
      style: { cssText: "color: inherit; background-color: rgba(0, 0, 0, 0); font-size: inherit; box-shadow: none; border: medium !important;" },
    };
    const realRule = {
      type: 1,
      style: { cssText: "color: rgb(10, 20, 30); font-size: 18px;" },
    };
    (globalThis as Record<string, unknown>).document = {
      ...((globalThis as Record<string, unknown>).document as Record<string, unknown>),
      styleSheets: [{ href: "https://example.com/a.css", cssRules: [junkRule, realRule] }],
    };
    const snapshot = collectPageSnapshot();

    const values = [
      ...snapshot.tokens.colors,
      ...snapshot.tokens.fontSizes,
      ...snapshot.tokens.shadows,
      ...snapshot.tokens.borders,
    ].map((token) => token.value);
    expect(values).not.toContain("inherit");
    expect(values).not.toContain("transparent");
    expect(values).not.toContain("rgba(0, 0, 0, 0)");
    expect(values).not.toContain("none");
    expect(values.some((value) => value.includes("!important"))).toBe(false);
    expect(snapshot.tokens.colors.map((token) => token.value)).toContain("rgb(10, 20, 30)");
    expect(snapshot.tokens.fontSizes.map((token) => token.value)).toContain("18px");
  });

  it("captures hover states, gradients, font usage, embeds, and social meta", () => {
    saved = installDom(
      [
        el("p", { text: "Body" }),
        el("iframe", { attrs: { src: "https://www.youtube.com/embed/abc", title: "Showreel" } }),
        el("meta", { attrs: { property: "og:title", content: "Ronnie Chan" } }),
        el("meta", { attrs: { property: "og:description", content: "Design leader" } }),
      ],
      "Rich evidence",
    );
    const hoverRule = {
      type: 1,
      selectorText: ".card:hover",
      style: { cssText: "background: linear-gradient(135deg, #000, #fff); transform: translateY(-2px);" },
    };
    (globalThis as Record<string, unknown>).document = {
      ...((globalThis as Record<string, unknown>).document as Record<string, unknown>),
      styleSheets: [{ href: "https://example.com/a.css", cssRules: [hoverRule] }],
    };
    const snapshot = collectPageSnapshot();

    expect(snapshot.hoverStates).toContainEqual({ selector: ".card:hover", trigger: "hover", changedProperties: ["background", "transform"] });
    expect(snapshot.tokens.gradients.map((token) => token.value)).toContain("linear-gradient(135deg, #000, #fff)");
    expect(snapshot.tokens.gradients[0]).toMatchObject({ source: "cssom-rule", confidence: "observed" });
    expect(snapshot.typography.fontFamilies.map((token) => token.value)).toContain("Inter, sans-serif");
    expect(snapshot.embeds).toContainEqual({ url: "https://www.youtube.com/embed/abc", domain: "www.youtube.com", kind: "youtube", title: "Showreel", readyState: null, rectY: null, rectHeight: null });
    expect(snapshot.social).toMatchObject({ ogTitle: "Ronnie Chan", ogDescription: "Design leader" });
    expect(snapshot.semanticStyles[0]).toHaveProperty("position");
    expect(snapshot.coverage["tokens.gradients"]).toMatchObject({ emittedCount: 1 });
    expect(snapshot.coverage["typography.fontFamilies"]?.emittedCount).toBeGreaterThan(0);
    expect(snapshot.coverage.hoverStates).toMatchObject({ emittedCount: 1 });
    expect(snapshot.coverage.embeds).toMatchObject({ emittedCount: 1 });
  });

  it("labels hover triggers on the stored selector and skips widget chrome", () => {
    saved = installDom([el("p", { text: "Body" })], "Hover hygiene");
    const lateHover = {
      type: 1,
      selectorText: ".card" + ".x".repeat(80) + ":hover",
      style: { cssText: "color: red;" },
    };
    const widgetRule = {
      type: 1,
      selectorText: ".gm-control:hover",
      style: { cssText: "display: block;" },
    };
    const realRule = {
      type: 1,
      selectorText: ".buy:hover",
      style: { cssText: "background: blue;" },
    };
    (globalThis as Record<string, unknown>).document = {
      ...((globalThis as Record<string, unknown>).document as Record<string, unknown>),
      styleSheets: [{ href: "https://example.com/a.css", cssRules: [lateHover, widgetRule, realRule] }],
    };
    const snapshot = collectPageSnapshot();

    // :hover beyond the 120-char store cut must not label a truncated
    // selector that shows no pseudo-class; widget chrome is omitted.
    expect(snapshot.hoverStates).toHaveLength(1);
    expect(snapshot.hoverStates[0]).toMatchObject({ selector: ".buy:hover", trigger: "hover" });
    expect(snapshot.coverage.hoverStates).toMatchObject({ sourceCount: 2, emittedCount: 1, truncated: true });
    expect(snapshot.coverage.hoverStates?.reason).toContain("widget");
  });

  it("excludes zero-duration computed motion defaults but keeps real timings", () => {
    const idleStyle = {
      display: "block",
      visibility: "visible",
      backgroundColor: "rgb(255, 255, 255)",
      color: "rgb(17, 17, 17)",
      fontFamily: "Inter, sans-serif",
      transition: "all 0s ease 0s",
      animation: "none 0s ease 0s 1 normal none running",
    };
    saved = installDom([el("button", { text: "Buy" })], "Idle motion");
    (globalThis as Record<string, unknown>).getComputedStyle = () => idleStyle;
    const idle = collectPageSnapshot();
    expect(idle.motion.transitions).toEqual([]);
    expect(idle.motion.animations).toEqual([]);

    (globalThis as Record<string, unknown>).getComputedStyle = () => ({
      ...idleStyle,
      transition: "opacity 0.3s ease 0s",
      animation: "spin 1.2s linear infinite",
    });
    const real = collectPageSnapshot();
    expect(real.motion.transitions[0]).toMatchObject({ property: "opacity", duration: "0.3s" });
    expect(real.motion.animations[0]).toMatchObject({ name: "spin", duration: "1.2s" });
  });

  it("parses property-last transition serializations by token role", () => {
    saved = installDom([el("button", { text: "Buy" })], "Transition order");
    (globalThis as Record<string, unknown>).getComputedStyle = () => ({
      display: "block",
      visibility: "visible",
      backgroundColor: "rgb(255, 255, 255)",
      color: "rgb(17, 17, 17)",
      fontFamily: "Inter, sans-serif",
      transition: "0.2s ease 0s",
      animation: "1.3s ease-in-out infinite dmcNudge",
    });
    const snapshot = collectPageSnapshot();

    expect(snapshot.motion.transitions).toHaveLength(1);
    expect(snapshot.motion.transitions[0]).toMatchObject({ property: "all", duration: "0.2s", easing: "ease", delay: "0s" });
    expect(snapshot.motion.animations).toHaveLength(1);
    expect(snapshot.motion.animations[0]).toMatchObject({ name: "dmcNudge", duration: "1.3s", easing: "ease-in-out", delay: "0s" });
  });

  it("keeps functional easings whole when serializations contain spaces", () => {
    saved = installDom([el("button", { text: "Buy" })], "Functional easing");
    (globalThis as Record<string, unknown>).getComputedStyle = () => ({
      display: "block",
      visibility: "visible",
      backgroundColor: "rgb(255, 255, 255)",
      color: "rgb(17, 17, 17)",
      fontFamily: "Inter, sans-serif",
      transition: "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1) 0s",
      animation: "",
    });
    const snapshot = collectPageSnapshot();

    expect(snapshot.motion.transitions).toHaveLength(1);
    expect(snapshot.motion.transitions[0]).toMatchObject({ property: "transform", duration: "0.2s", easing: "cubic-bezier(0.16, 1, 0.3, 1)", delay: "0s" });
  });

  it("captures document direction for mirrored layouts", () => {
    saved = installDom([el("p", { text: "Body" })], "Direction");
    (globalThis as Record<string, unknown>).document = {
      ...((globalThis as Record<string, unknown>).document as Record<string, unknown>),
      documentElement: { getAttribute: (name: string) => (name === "lang" ? "ar" : name === "dir" ? "rtl" : null) },
    };
    const snapshot = collectPageSnapshot();

    expect(snapshot.direction).toBe("rtl");
    expect(snapshot.lang).toBe("ar");
  });

  it("prefers meaningfully-sized elements for role samples", () => {
    const tiny = el("a", { text: "Skip", attrs: { href: "#main" } });
    const real = el("a", { text: "Get started", attrs: { href: "https://example.com/start" } });
    (tiny as unknown as { getBoundingClientRect: () => { width: number; height: number } }).getBoundingClientRect = () => ({ width: 1, height: 1 });
    (real as unknown as { getBoundingClientRect: () => { width: number; height: number } }).getBoundingClientRect = () => ({ width: 200, height: 40 });
    saved = installDom([tiny, real], "Link samples");
    const snapshot = collectPageSnapshot();

    expect(snapshot.layoutSamples.find((sample) => sample.role === "link")).toMatchObject({ width: 200, height: 40, visible: true });
  });

  it("skips zero-font elements for text-role samples", () => {
    saved = installDom(
      [el("button", { text: "X" }), el("button", { text: "Buy now" })],
      "Zero font",
    );
    const doc = (globalThis as Record<string, unknown>).document as Record<string, unknown>;
    const buttons = (doc.querySelectorAll as (selector: string) => ShimElement[])("button");
    (buttons[0] as unknown as { getBoundingClientRect: () => { width: number; height: number } }).getBoundingClientRect = () => ({ width: 200, height: 40 });
    (buttons[1] as unknown as { getBoundingClientRect: () => { width: number; height: number } }).getBoundingClientRect = () => ({ width: 100, height: 30 });
    const baseStyle = {
      display: "block",
      visibility: "visible",
      backgroundColor: "rgb(255, 255, 255)",
      color: "rgb(17, 17, 17)",
      fontFamily: "Inter, sans-serif",
    };
    (globalThis as Record<string, unknown>).getComputedStyle = (node: unknown) => ({
      ...baseStyle,
      fontSize: node === buttons[0] ? "0px" : "14px",
    });
    const snapshot = collectPageSnapshot();

    expect(snapshot.layoutSamples.find((sample) => sample.role === "button")).toMatchObject({ width: 100, height: 30, visible: true });
    expect(snapshot.semanticStyles.find((sample) => sample.role === "button")?.fontSize).toBe("14px");
  });

  it("merges body-level custom properties unseen on root", () => {
    saved = installDom([el("p", { text: "Body" })], "Scheme props");
    const doc = (globalThis as Record<string, unknown>).document as Record<string, unknown>;
    const bodyEl = doc.body;
    const rootStyle = {
      length: 1,
      0: "--brand",
      getPropertyValue: (name: string) => (name === "--brand" ? "#ff0000" : ""),
      backgroundColor: "rgb(255, 255, 255)",
      color: "rgb(17, 17, 17)",
      fontFamily: "Inter, sans-serif",
    };
    (globalThis as Record<string, unknown>).getComputedStyle = (node: unknown) =>
      node === bodyEl
        ? {
            ...rootStyle,
            length: 2,
            0: "--color-background",
            1: "--brand",
            getPropertyValue: (name: string) =>
              name === "--color-background" ? "#ffffff" : name === "--brand" ? "#ff0000" : "",
          }
        : rootStyle;
    const snapshot = collectPageSnapshot();

    expect(snapshot.tokens.customProperties).toContainEqual({ name: "--color-background", value: "#ffffff", source: "computed-custom-property", confidence: "inferred" });
    expect(snapshot.tokens.customProperties.filter((entry) => entry.name === "--brand")).toHaveLength(1);
    expect(snapshot.pageCanvasColor).toBe("rgb(255, 255, 255)");
  });

  it("records video/audio file URLs and names canvas scenes", () => {
    const readyVideo = el("video", { attrs: { src: "https://example.com/ready.mp4" } });
    (readyVideo as unknown as { readyState: number }).readyState = 3;
    saved = installDom(
      [
        el("video", { attrs: { src: "https://example.com/hero.mp4", "aria-label": "Hero loop" } }),
        readyVideo,
        el("source", { attrs: { src: "https://example.com/alt.webm", type: "video/webm" } }),
        el("source", { attrs: { srcset: "https://example.com/pic-2x.jpg 2x", type: "image/jpeg" } }),
        el("canvas", {}),
      ],
      "Media files",
    );
    const snapshot = collectPageSnapshot();

    const urls = snapshot.assets.map((asset) => asset.url);
    expect(urls).toContain("https://example.com/hero.mp4");
    expect(urls).toContain("https://example.com/alt.webm");
    expect(urls.some((url) => url.includes("pic-2x"))).toBe(false);
    expect(snapshot.assets.find((asset) => asset.url.includes("hero.mp4"))).toMatchObject({ kind: "video", alt: "Hero loop" });
    expect(snapshot.assets.find((asset) => asset.url.includes("ready.mp4"))).toMatchObject({ kind: "video", readyState: 3, rectY: null, rectHeight: null });
    expect(snapshot.observedInteractions.map((entry) => entry.kind)).toContain("canvas-present");
    expect(snapshot.limitations.some((line) => line.includes("single static frame"))).toBe(true);
    expect(snapshot.coverage.assets).toMatchObject({ sourceCount: 3, emittedCount: 3, truncated: false });
  });

  it("flags sticky/fixed rules as pin-scene evidence", () => {
    saved = installDom([el("p", { text: "Body" })], "Sticky");
    const stickyRule = {
      type: 1,
      selectorText: ".pin",
      style: { cssText: "position: sticky; top: 0;" },
    };
    (globalThis as Record<string, unknown>).document = {
      ...((globalThis as Record<string, unknown>).document as Record<string, unknown>),
      styleSheets: [{ href: "https://example.com/a.css", cssRules: [stickyRule] }],
    };
    const snapshot = collectPageSnapshot();

    expect(snapshot.observedInteractions.map((entry) => entry.kind)).toContain("sticky-fixed");
    expect(snapshot.limitations.some((line) => line.includes("blank bands"))).toBe(true);
  });

  it("inventories SVG icon symbols with honest counts", () => {
    saved = installDom(
      [
        el("svg", { attrs: { "data-lucide": "menu" } }),
        el("svg", { attrs: { "aria-label": "Cart" } }),
        el("svg", { attrs: { class: "icon icon-cart" } }),
        el("svg", {}),
      ],
      "Icons",
    );
    const snapshot = collectPageSnapshot();

    expect(snapshot.tokens.icons).toContainEqual({ value: "menu", count: 1, source: "svg-symbol", confidence: "observed" });
    expect(snapshot.tokens.icons).toContainEqual({ value: "Cart", count: 1, source: "svg-symbol", confidence: "observed" });
    expect(snapshot.tokens.icons).toContainEqual({ value: "icon-cart", count: 1, source: "svg-symbol", confidence: "observed" });
    expect(snapshot.coverage["tokens.icons"]).toMatchObject({ sourceCount: 4, emittedCount: 3, cap: 20, truncated: true });
    expect(snapshot.coverage["tokens.icons"]?.reason).toContain("unnamed symbol");
  });

  it("reads generator and theme-color metadata and same-origin form actions", () => {
    saved = installDom(
      [
        el("meta", { attrs: { name: "generator", content: "Next.js" } }),
        el("meta", { attrs: { name: "theme-color", content: "#000000" } }),
        el("form", { attrs: { action: "/contact" } }),
        el("form", { attrs: { action: "https://payments.example.com/pay" } }),
      ],
      "Meta and forms",
    );
    const snapshot = collectPageSnapshot();

    expect(snapshot.social).toMatchObject({ generator: "Next.js", themeColor: "#000000" });
    expect(snapshot.formActions).toEqual(["/contact"]);
    expect(snapshot.coverage["forms.actions"]).toMatchObject({ sourceCount: 2, emittedCount: 1, cap: 5 });
  });

  it("collapses consecutive duplicate content blocks", () => {
    saved = installDom(
      [el("p", { text: "Nav" }), el("p", { text: "Nav" }), el("p", { text: "Other" })],
      "Dupes",
    );
    const snapshot = collectPageSnapshot();

    expect(snapshot.content.blocks.map((block) => block.text)).toEqual(["Nav", "Other"]);
    expect(snapshot.content.coverage.contentBlocks).toMatchObject({ sourceCount: 3, emittedCount: 2, deduplicatedCount: 1 });
  });

  it("captures preformatted code blocks with line breaks", () => {
    saved = installDom(
      [el("pre", { text: "npm install foo\n  --save\nnpm start" }), el("p", { text: "Run it" })],
      "Code",
    );
    const snapshot = collectPageSnapshot();

    const code = snapshot.content.blocks.find((block) => block.kind === "code");
    expect(code?.tag).toBe("pre");
    expect(code?.text).toBe("npm install foo\n  --save\nnpm start");
    expect(code?.truncated).toBe(false);
    expect(snapshot.content.coverage.codeElements).toMatchObject({ sourceCount: 1, emittedCount: 1 });
  });

  it("captures tables as bounded markdown with headers", () => {
    const table = el("table", {});
    const headRow = el("tr", {});
    const bodyRow = el("tr", {});
    (table as unknown as Record<string, unknown>).querySelectorAll = (selector: string) =>
      selector === "tr" ? [headRow, bodyRow] : [];
    (table as unknown as Record<string, unknown>).querySelector = () => null;
    const wireRow = (row: ShimElement, cells: ShimElement[]) => {
      (row as unknown as Record<string, unknown>).querySelectorAll = (selector: string) =>
        selector === "th, td" ? cells : [];
    };
    wireRow(headRow, [el("th", { text: "Chrome" }), el("th", { text: "Firefox" })]);
    wireRow(bodyRow, [el("td", { text: "128" }), el("td", { text: "130" })]);
    saved = installDom([table], "Tables");
    const snapshot = collectPageSnapshot();

    const block = snapshot.content.blocks.find((entry) => entry.kind === "table");
    expect(block?.tag).toBe("table");
    expect(block?.text).toContain("| Chrome | Firefox |");
    expect(block?.text).toContain("| 128 | 130 |");
    expect(block?.text).toContain("(2 rows x 2 cols)");
    expect(block?.truncated).toBe(false);
    expect(snapshot.content.coverage.tableElements).toMatchObject({ sourceCount: 1, emittedCount: 1 });
  });

  it("collects section bounding rects for screenshot clipping", () => {
    const body = el("body");
    saved = installDom(
      [el("section", { within: [body] }), el("section", { within: [body] })],
      "Rects",
    );
    // Shim getBoundingClientRect on sections via global window.scrollY.
    (globalThis as Record<string, unknown>).window = {
      innerWidth: 1440,
      innerHeight: 900,
      scrollY: 0,
    };
    // Patch querySelectorAll results to expose rects: simplest route is to
    // re-install with a custom document shim.
    const baseDocument = (globalThis as Record<string, unknown>).document as Record<string, unknown>;
    const originalQuerySelectorAll = baseDocument.querySelectorAll as (selector: string) => ShimElement[];
    baseDocument.querySelectorAll = (selector: string) => {
      const found = originalQuerySelectorAll(selector);
      if (selector.includes("section")) {
        return found.map((node, index) => ({
          ...node,
          getBoundingClientRect: () => ({ top: index * 1000, height: 900 }),
        })) as unknown as ShimElement[];
      }
      return found;
    };

    const snapshot = collectPageSnapshot();

    expect(snapshot.sectionRects.length).toBe(2);
    expect(snapshot.sectionRects[0]).toMatchObject({ y: 0, height: 900 });
    expect(snapshot.sectionRects[1]).toMatchObject({ y: 1000, height: 900 });
  });
});
