export interface RawHeading {
  level: number;
  text: string;
  truncated: boolean;
}

export interface RawLink {
  href: string;
  text: string;
  inNav: boolean;
  inHeader: boolean;
  inFooter: boolean;
}

export type TokenConfidence = "observed" | "inferred" | "unknown";

export interface CountedToken {
  value: string;
  count: number;
  source: string;
  confidence: TokenConfidence;
}

export interface SnapshotTokens {
  colors: CountedToken[];
  fontSizes: CountedToken[];
  spacing: CountedToken[];
  radii: CountedToken[];
  borders: CountedToken[];
  shadows: CountedToken[];
  gradients: CountedToken[];
  icons: CountedToken[];
  customProperties: { name: string; value: string; source: string; confidence: TokenConfidence }[];
}

export interface SnapshotTypography {
  fontFaces: { family: string; src: string; weight: string }[];
  fontFamilies: CountedToken[];
  lineHeights: CountedToken[];
  letterSpacings: CountedToken[];
}

export interface SnapshotSemanticStyle {
  role: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  color: string;
  backgroundColor: string;
  width: string;
  display: string;
  gridTemplateColumns: string;
  gap: string;
  position: string;
}

export interface SnapshotLayoutSample {
  role: string;
  width: number;
  height: number;
  display: string;
  columns: string;
  gap: string;
  position: string;
  visible: boolean;
}

export interface SnapshotBreakpoints {
  mediaQueries: { query: string; changedProperties: string[] }[];
}

export interface SnapshotMotion {
  transitions: { property: string; duration: string; easing: string; delay: string }[];
  animations: { name: string; duration: string; easing: string; delay: string }[];
  keyframes: string[];
}

export interface SnapshotGeometry {
  containerWidths: CountedToken[];
  sampledElements: number;
}

export interface SnapshotSection {
  role: string;
  heading: string;
  textExcerpt: string;
}

export interface SnapshotTone {
  avgSentenceWords: number;
  questionCount: number;
  ctaCount: number;
  voice: string;
}

export interface SnapshotContent {
  blocks: SnapshotContentBlock[];
  hiddenBlocks: SnapshotHiddenBlock[];
  controls: SnapshotControl[];
  components: SnapshotComponentPattern[];
  coverage: Record<string, SnapshotCollectionCoverage>;
  sections: SnapshotSection[];
  tone: SnapshotTone;
}

export interface SnapshotHiddenBlock {
  order: number;
  kind: SnapshotContentBlock["kind"];
  tag: string;
  text: string;
  initialState: "collapsed-details" | "aria-hidden" | "hidden-attribute" | "computed-hidden";
  truncated: boolean;
}

export interface SnapshotContentBlock {
  order: number;
  kind: "heading" | "paragraph" | "list-item" | "blockquote" | "summary" | "form-label" | "definition" | "code" | "table";
  tag: string;
  headingLevel: number | null;
  sectionIndex: number | null;
  text: string;
  truncated: boolean;
}

export interface SnapshotControl {
  order: number;
  kind: "link" | "button" | "input" | "textarea" | "select" | "summary" | "media" | "dialog";
  label: string;
  type: string | null;
  name: string | null;
  id: string | null;
  required: boolean;
  disabled: boolean;
  href: string | null;
  options: string[];
  ariaExpanded: string | null;
  ariaControls: string | null;
  ariaLabelledBy: string | null;
  placeholder?: string | null;
  autocomplete?: string | null;
  ariaPressed?: string | null;
  ariaSelected?: string | null;
  ariaHasPopup?: string | null;
  open?: boolean;
  multiple?: boolean;
}

export interface SnapshotComponentPattern {
  kind: string;
  signature: string;
  count: number;
  examples: string[];
}

export interface SnapshotCollectionCoverage {
  sourceCount: number;
  emittedCount: number;
  cap: number;
  truncated: boolean;
  deduplicatedCount?: number;
  reason: string | null;
}

export interface SnapshotAsset {
  url: string;
  kind: string;
  alt: string;
  width: number | null;
  height: number | null;
  usedOn: string;
  readyState?: number | null;
  rectY?: number | null;
  rectHeight?: number | null;
}

export interface SnapshotHoverState {
  selector: string;
  trigger: "hover" | "focus" | "focus-visible" | "focus-within" | "active";
  changedProperties: string[];
}

export interface SnapshotEmbed {
  url: string;
  domain: string;
  kind: "youtube" | "vimeo" | "maps" | "spotify" | "other";
  title: string;
  readyState: number | null;
  rectY: number | null;
  rectHeight: number | null;
}

export interface SnapshotSocial {
  ogTitle: string | null;
  ogDescription: string | null;
  twitterCard: string | null;
  generator: string | null;
  themeColor: string | null;
}

export interface SectionRect {
  y: number;
  height: number;
  heading: string;
}

export interface ObservedInteraction {
  kind: string;
  detail: string;
}

export interface PageSnapshot {
  payloadBytes?: number;
  url: string;
  title: string;
  metaDescription: string | null;
  lang: string | null;
  direction: string | null;
  headings: RawHeading[];  links: RawLink[];
  bodyBackgroundColor: string;
  bodyColor: string;
  bodyFontFamily: string;
  pageCanvasColor: string | null;  roleCounts: Record<string, number>;
  sectionCount: number;
  formCount: number;
  imageCount: number;
  domElementCount: number;
  viewport: { width: number; height: number };
  tokens: SnapshotTokens;
  typography: SnapshotTypography;
  semanticStyles: SnapshotSemanticStyle[];
  layoutSamples: SnapshotLayoutSample[];
  breakpoints: SnapshotBreakpoints;
  motion: SnapshotMotion;
  geometry: SnapshotGeometry;
  content: SnapshotContent;
  coverage: Record<string, SnapshotCollectionCoverage>;
  assets: SnapshotAsset[];
  embeds: SnapshotEmbed[];
  social: SnapshotSocial;
  hoverStates: SnapshotHoverState[];
  formActions: string[];
  sectionRects: SectionRect[];
  observedInteractions: ObservedInteraction[];
  limitations: string[];
}

/**
 * This function is serialized with `Function.prototype.toString()` and executed
 * inside the remote page. It therefore CANNOT reference anything from module
 * scope — not even constants. Keep every value as a literal inside the body.
 */
export function collectPageSnapshot(): PageSnapshot {
  const doc = document;
  const maxHeadings = 200;
  const maxLinks = 500;
  const limitations: string[] = [];
  const isObservable = (node: unknown): boolean => {
    try {
      const element = node as { tagName?: string; getAttribute?: (name: string) => string | null; closest?: (selector: string) => { contains?: (candidate: unknown) => boolean } | null };
      if (element.getAttribute?.("aria-hidden") === "true" || element.getAttribute?.("hidden") !== null) return false;
      if (element.closest?.("[aria-hidden='true'], [hidden]")) return false;
      const closedDetails = element.closest?.("details:not([open])");
      const summary = element.closest?.("summary");
      if (closedDetails && String(element.tagName || "").toLowerCase() !== "details" && (!summary || !closedDetails.contains?.(summary))) return false;
      const style = getComputedStyle(node as Element) as unknown as Record<string, string>;
      return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
    } catch {
      return true;
    }
  };
  const renderedText = (node: { innerText?: string; textContent?: string } | null | undefined): string =>
    node?.innerText || node?.textContent || "";

  const headings: RawHeading[] = [];
  doc.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((el) => {
    if (headings.length >= maxHeadings) return;
    if (!isObservable(el)) return;
    const rawText = renderedText(el).replace(/\s+/g, " ").trim();
    if (rawText) headings.push({ level: Number(el.tagName.slice(1)) || 0, text: rawText.slice(0, 1200), truncated: rawText.length > 1200 });
  });

  const header = doc.querySelector("header");
  const footer = doc.querySelector("footer");
  const navElements = Array.from(doc.querySelectorAll("nav, [role='navigation']"));

  const links: RawLink[] = [];
  const seen = new Set<string>();
  const sourceLinkHrefs = new Set<string>();
  let linkCandidatesScanned = 0;
  doc.querySelectorAll("a[href]").forEach((el) => {
    if (linkCandidatesScanned >= maxLinks) return;
    linkCandidatesScanned += 1;
    const anchor = el as HTMLAnchorElement;
    const href = anchor.href;
    if (!href) return;
    sourceLinkHrefs.add(href);
    if (!isObservable(el) || seen.has(href)) return;
    seen.add(href);

    const inHeader = header ? header.contains(el) : false;
    const inFooter = footer ? footer.contains(el) : false;
    let inNav = inHeader || inFooter;
    if (!inNav) {
      for (const nav of navElements) {
        if (nav.contains(el)) {
          inNav = true;
          break;
        }
      }
    }

    links.push({ href, text: renderedText(anchor).replace(/\s+/g, " ").trim().slice(0, 200), inNav, inHeader, inFooter });
  });

  const roleCounts: Record<string, number> = {};
  doc.querySelectorAll("[role]").forEach((el) => {
    const role = (el.getAttribute("role") ?? "").slice(0, 40);
    if (!role) return;
    if (role in roleCounts) roleCounts[role] += 1;
    else if (Object.keys(roleCounts).length < 50) roleCounts[role] = 1;
  });

  const bodyStyle = getComputedStyle(doc.body);
  const metaDescription = doc.querySelector('meta[name="description"]');

  // Document direction (rtl/ltr) from the dir attribute, falling back to
  // the computed value. The only machine-readable mirroring signal: an AI
  // rebuilder cannot infer RTL layout from text alone.
  let direction: string | null = null;
  try {
    direction =
      doc.documentElement.getAttribute("dir") ||
      (doc.body?.getAttribute ? doc.body.getAttribute("dir") || "" : "") ||
      String(getComputedStyle(doc.documentElement).direction || "") ||
      null;
    direction = direction ? direction.slice(0, 10) : null;
  } catch {
    direction = null;
  }

  // Page-canvas sample from the root element: when body itself is
  // transparent, the visible page background comes from <html> (or a scheme
  // class on it). One computed read; null when transparent so clients can
  // say "unknown" honestly instead of guessing.
  let pageCanvasColor: string | null = null;
  try {
    const rootBg = String(getComputedStyle(doc.documentElement).backgroundColor || "");
    pageCanvasColor = !rootBg || rootBg.toLowerCase() === "transparent" || /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/i.test(rootBg)
      ? null
      : rootBg.slice(0, 100);
  } catch {
    pageCanvasColor = null;
  }

  // CF07 Pass 1: safe CSSOM traversal (Trap 1). Every sheet access is guarded;
  // cross-origin sheets throw SecurityError and are skipped with a limitation.
  const colorFreq: Record<string, number> = {};
  const fontSizeFreq: Record<string, number> = {};
  const spacingFreq: Record<string, number> = {};
  const radiiFreq: Record<string, number> = {};
  const borderFreq: Record<string, number> = {};
  const shadowFreq: Record<string, number> = {};
  const widthFreq: Record<string, number> = {};
  const lineHeightFreq: Record<string, number> = {};
  const letterSpacingFreq: Record<string, number> = {};
  const gradientFreq: Record<string, number> = {};
  const fontFamilyFreq: Record<string, number> = {};
  const mediaQueries: { query: string; changedProperties: string[] }[] = [];
  const fontFaces: { family: string; src: string; weight: string }[] = [];
  const hoverStates: SnapshotHoverState[] = [];
  let hoverSourceCount = 0;
  let widgetHoverSkipped = 0;
  let stickyFixedRuleCount = 0;
  let mediaQuerySourceCount = 0;
  let fontFaceSourceCount = 0;
  let keyframeSourceCount = 0;
  let transitionSourceCount = 0;
  let animationSourceCount = 0;
  let customPropertySourceCount = 0;
  const semanticStyles: SnapshotSemanticStyle[] = [];
  const layoutSamples: SnapshotLayoutSample[] = [];
  const keyframeNames: string[] = [];
  const customProps: { name: string; value: string; source: string; confidence: TokenConfidence }[] = [];
  const cssomValues: Record<string, Record<string, boolean>> = {
    colors: {}, fontSizes: {}, spacing: {}, radii: {}, borders: {}, shadows: {}, gradients: {},
  };
  const transList: { property: string; duration: string; easing: string; delay: string }[] = [];
  const animList: { name: string; duration: string; easing: string; delay: string }[] = [];

  const bump = (map: Record<string, number>, key: string): void => {
    const clean = (key || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!clean) return;
    // CSS-wide keywords describe inheritance, not design decisions. They
    // pollute frequency-ranked palettes (e.g. "inherit" outranking real
    // colors), so drop them at the single aggregation choke point.
    if (/^(inherit|initial|unset|revert|revert-layer)$/i.test(clean)) return;
    map[clean] = (map[clean] ?? 0) + 1;
  };
  const markCssomValue = (category: string, value: string): void => {
    const clean = (value || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (clean && cssomValues[category]) cssomValues[category]![clean] = true;
  };
  // Computed `transition`/`animation` shorthands serialize to zero-duration
  // defaults ("all 0s ease 0s", "none 0s ...") on most elements. Exact-string
  // guards rot across browsers; a zero-timing check is robust: a state
  // change with no duration is not motion evidence.
  const splitTopLevelCommas = (value: string): string[] => {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const char of value) {
      if (char === "(") depth += 1;
      if (char === ")") depth = Math.max(0, depth - 1);
      if (char === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
      current += char;
    }
    parts.push(current);
    return parts;
  };
  const hasNonZeroTiming = (value: string): boolean => {
    const first = (splitTopLevelCommas(value)[0] || "").trim();
    if (!first) return false;
    const timings = first.match(/(\d*\.?\d+)(m?s)/g) || [];
    if (timings.length === 0) return false;
    return timings.some((timing) => parseFloat(timing) !== 0);
  };
  // Browsers may serialize transitions property-last ("0.2s ease 0s") or
  // property-first ("opacity 0.2s ease 0s"). Parse by token role instead of
  // position: first time value is the duration, second the delay.
  const isTimeToken = (token: string): boolean => /^\d*\.?\d+m?s$/i.test(token);
  const isEasingToken = (token: string): boolean =>
    token === "ease" || token === "linear" || token === "ease-in" || token === "ease-out" ||
    token === "ease-in-out" || token === "step-start" || token === "step-end" ||
    /^(cubic-bezier|steps)\(/i.test(token);
  const parseTransitionTiming = (value: string): { property: string; duration: string; easing: string; delay: string } => {
    const first = (splitTopLevelCommas(value)[0] || "").trim();
    // Functional easings contain spaces ("cubic-bezier(0.16, 1, 0.3, 1)");
    // lift the whole function out before whitespace tokenizing.
    const funcEasing = /(cubic-bezier\([^)]*\)|steps\([^)]*\))/i.exec(first)?.[1] || "";
    const rest = funcEasing ? first.replace(funcEasing, " ") : first;
    const tokens = (rest.split(/\s+/).filter(Boolean));
    const times = tokens.filter(isTimeToken);
    const easing = funcEasing || tokens.find(isEasingToken) || "ease";
    const property = tokens.find((token) => !isTimeToken(token) && !isEasingToken(token)) || "all";
    return {
      property: property.slice(0, 60),
      duration: (times[0] || "0s").slice(0, 20),
      easing: easing.slice(0, 30),
      delay: (times[1] || "0s").slice(0, 20),
    };
  };
  // Animations serialize name-first ("spin 1.2s ...") or duration-first
  // ("1.3s ease-in-out infinite name"). Same role-based parse; anything left
  // that is not a time, easing, or playback keyword is the keyframe name.
  const parseAnimationTiming = (value: string): { name: string; duration: string; easing: string; delay: string } => {
    const first = (splitTopLevelCommas(value)[0] || "").trim();
    const funcEasing = /(cubic-bezier\([^)]*\)|steps\([^)]*\))/i.exec(first)?.[1] || "";
    const rest = funcEasing ? first.replace(funcEasing, " ") : first;
    const tokens = (rest.split(/\s+/).filter(Boolean));
    const isPlaybackKeyword = (token: string): boolean =>
      token === "infinite" || token === "normal" || token === "reverse" ||
      token === "alternate" || token === "alternate-reverse" || token === "forwards" ||
      token === "backwards" || token === "both" || token === "running" || token === "paused" ||
      /^\d+(\.\d+)?$/.test(token);
    const times = tokens.filter(isTimeToken);
    const easing = funcEasing || tokens.find(isEasingToken) || "ease";
    const name = tokens.find((token) => !isTimeToken(token) && !isEasingToken(token) && !isPlaybackKeyword(token)) || "unknown";
    return {
      name: name.slice(0, 80),
      duration: (times[0] || "0s").slice(0, 20),
      easing: easing.slice(0, 30),
      delay: (times[1] || "0s").slice(0, 20),
    };
  };

  try {
    const sheets = (doc as unknown as { styleSheets?: unknown }).styleSheets as unknown as Array<{ href?: string | null; cssRules?: unknown }> | undefined;
    const list = sheets ? Array.from(sheets as unknown as ArrayLike<unknown>) as Array<{ href?: string | null; cssRules?: unknown }> : [];
    let cssBytesParsed = 0;
    for (const sheet of list) {
      if (cssBytesParsed > 3_000_000) {
        limitations.push("CSS text parsing stopped at the 3MB per-page cap.");
        break;
      }
      let rules: Array<unknown> = [];
      try {
        rules = Array.from((sheet.cssRules as unknown as ArrayLike<unknown> | undefined) ?? []);
      } catch {
        // Shopify-style pages inject the same constructed stylesheet repeatedly;
        // record each href once so limitations stay readable.
        const note = "Cross-origin stylesheet skipped: " + (sheet.href || "unknown");
        if (!limitations.includes(note)) limitations.push(note);
        continue;
      }
      for (const rule of rules) {
        const typed = rule as { type?: number; style?: { cssText?: string }; cssText?: string; conditionText?: string; cssRules?: unknown; name?: string; styleMap?: unknown };
        const cssText = (typed.style?.cssText || typed.cssText || "") as string;
        cssBytesParsed += cssText.length;
        const ruleType = typed.type ?? 0;
        if (ruleType === 5) {
          // FONT_FACE_RULE
          fontFaceSourceCount += 1;
          const css = (typed.cssText || "") as string;
          const fam = (/font-family\s*:\s*([^;]+);?/i.exec(css) || [])[1] || "unknown";
          const src = (/src\s*:\s*([^;]+);?/i.exec(css) || [])[1] || "";
          const weight = (/font-weight\s*:\s*([^;]+);?/i.exec(css) || [])[1] || "400";
          if (fontFaces.length < 20) fontFaces.push({ family: fam.replace(/["']/g, "").trim().slice(0, 120), src: src.trim().slice(0, 300), weight: weight.trim().slice(0, 20) });
          continue;
        }
        if (ruleType === 4) {
          // MEDIA_RULE
          const query = ((typed as { conditionText?: string }).conditionText || (typed.cssText || "").slice(0, 200));
          const inner = Array.from(((typed as { cssRules?: ArrayLike<unknown> }).cssRules ?? []) as ArrayLike<unknown>);
          const props: string[] = [];
          for (const innerRule of inner.slice(0, 10)) {
            const css = (((innerRule as { style?: { cssText?: string } }).style || {}).cssText || "") as string;
            const names = css.split(";").map((part) => part.split(":")[0]?.trim()).filter(Boolean) as string[];
            for (const name of names.slice(0, 5)) if (!props.includes(name)) props.push(name.slice(0, 60));
          }
          if (query) {
            const trimmed = query.slice(0, 200);
            const existing = mediaQueries.find((entry) => entry.query === trimmed);
            if (existing) {
              for (const name of props.slice(0, 10)) {
                if (existing.changedProperties.length < 10 && !existing.changedProperties.includes(name)) {
                  existing.changedProperties.push(name);
                }
              }
            } else {
              mediaQuerySourceCount += 1;
              if (mediaQueries.length < 20) mediaQueries.push({ query: trimmed, changedProperties: props.slice(0, 10) });
            }
          }
          continue;
        }
        if (ruleType === 7 || ruleType === 8) {
          // KEYFRAMES_RULE
          const name = (typed as { name?: string }).name || "";
          if (name && !keyframeNames.includes(name)) {
            keyframeSourceCount += 1;
            if (keyframeNames.length < 20) keyframeNames.push(name.slice(0, 120));
          }
          continue;
        }
        if (ruleType !== 1) continue;
        const css = (((typed as { style?: { cssText?: string } }).style || {}).cssText || "") as string;
        if (!css) continue;
        const decls = css.split(";");
        const ruleProps: string[] = [];
        for (const decl of decls) {
          const idx = decl.indexOf(":");
          if (idx < 0) continue;
          const prop = decl.slice(0, idx).trim().toLowerCase();
          const val = decl.slice(idx + 1).trim();
          if (!val) continue;
          if (prop && !ruleProps.includes(prop) && ruleProps.length < 8) ruleProps.push(prop.slice(0, 60));
          if ((prop === "background" || prop === "background-image") && /gradient\(/i.test(val)) { bump(gradientFreq, val); markCssomValue("gradients", val); }
          // Sticky/fixed rules flag pinned scroll scenes, which misrender in
          // full-height screenshots. Counted here at zero marginal cost.
          if (prop === "position" && (val === "sticky" || val === "fixed")) stickyFixedRuleCount += 1;
          if (prop === "color" || prop === "background-color" || prop === "border-color") { bump(colorFreq, val); markCssomValue("colors", val); }
          else if (prop === "font-size") { bump(fontSizeFreq, val); markCssomValue("fontSizes", val); }
          else if (prop === "margin" || prop === "margin-top" || prop === "margin-right" || prop === "margin-bottom" || prop === "margin-left" || prop === "padding" || prop === "padding-top" || prop === "padding-right" || prop === "padding-bottom" || prop === "padding-left" || prop === "gap" || prop === "row-gap" || prop === "column-gap") { bump(spacingFreq, val); markCssomValue("spacing", val); }
          else if (prop === "border-radius" || prop === "border-top-left-radius") { bump(radiiFreq, val); markCssomValue("radii", val); }
          else if (prop === "border" || prop === "border-width" || prop === "border-style") { bump(borderFreq, val); markCssomValue("borders", val); }
          else if (prop === "box-shadow" || prop === "text-shadow") { bump(shadowFreq, val); markCssomValue("shadows", val); }
          else if (prop === "width" || prop === "max-width") bump(widthFreq, val);
          else if (prop === "line-height") bump(lineHeightFreq, val);
          else if (prop === "letter-spacing") bump(letterSpacingFreq, val);
        }
        // Static interaction evidence: :hover/:focus/:active rules declare
        // visible state changes without replaying anything. Bounded to 12.
        // The trigger is classified on the same truncated selector that gets
        // stored, so the label can never describe a cut-off pseudo-class.
        const fullSelector = String(((typed as { selectorText?: string }).selectorText || "").replace(/\s+/g, " ").trim());
        const selectorText = fullSelector.slice(0, 120);
        const trigger = selectorText.includes(":focus-visible") ? "focus-visible"
          : selectorText.includes(":focus-within") ? "focus-within"
          : selectorText.includes(":hover") ? "hover"
          : selectorText.includes(":focus") ? "focus"
          : selectorText.includes(":active") ? "active" : "";
        // Third-party embed-widget internals (maps, social players) declare
        // state rules for their own chrome; that is not rebuild evidence
        // for the site itself, so it is counted and omitted.
        const widgetNoise = /(^|[\s.:#])(gm-|goog-|google-|ytp-|fb-|twitter-|instagram-|pinterest-)/i.test(selectorText);
        if (trigger && widgetNoise) widgetHoverSkipped += 1;
        if (trigger && !widgetNoise) {
          hoverSourceCount += 1;
          if (hoverStates.length < 12) {
            hoverStates.push({ selector: selectorText, trigger, changedProperties: ruleProps.slice(0, 5) });
          }
        } else if (trigger) {
          hoverSourceCount += 1;
        }
      }
    }
  } catch {
    limitations.push("Stylesheet enumeration failed; fell back to computed-style sampling.");
  }

  // CF07 Pass 2: representative computed-style sampling (~30 selectors, Trap 1).
  const samplerSelectors = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "blockquote", "code", "button", "[role='button']", "input", "textarea", "select", "header", "nav", "main", "section", "article", "footer", "aside", ".card", ".container", "ul", "ol", "li", "img", "form"];
  let sampledElements = 0;
  try {
    for (const selector of samplerSelectors) {
      let candidates: ArrayLike<Element>;
      try {
        candidates = doc.querySelectorAll(selector);
      } catch {
        continue;
      }
      const list = Array.from(candidates as unknown as Array<Element>);
      // Prefer a meaningfully-sized representative: the first DOM match is
      // often a 1px skip-link or hidden anchor, while the representative
      // control sits further down. Icon-only buttons report boxes but zero
      // font metrics, making them degenerate *type* samples (their geometry
      // is still recorded). Bounded to 5 rect reads per selector.
      const needsTextSample = selector === "h1" || selector === "h2" || selector === "h3" ||
        selector === "h4" || selector === "h5" || selector === "h6" || selector === "p" ||
        selector === "button" || selector === "a" || selector === "blockquote" || selector === "code";
      let first = list[0];
      for (let candidateIndex = 0; candidateIndex < list.length && candidateIndex < 5; candidateIndex += 1) {
        const candidate = list[candidateIndex]!;
        let area = -1;
        let degenerateText = false;
        try {
          const rect = candidate.getBoundingClientRect?.();
          area = rect ? Math.round(rect.width) * Math.round(rect.height) : -1;
          if (needsTextSample && area >= 0) {
            degenerateText = parseFloat(String(getComputedStyle(candidate).fontSize || "")) === 0;
          }
        } catch {
          area = -1;
        }
        if (area < 0) break;
        if (area >= 100 && !degenerateText) {
          first = candidate;
          break;
        }
      }
      if (!first) continue;
      let computed: CSSStyleDeclaration;
      try {
        computed = getComputedStyle(first);
      } catch {
        continue;
      }
      sampledElements += 1;
      const semanticRole = selector === "h1" ? "heading-1"
        : selector === "h2" ? "heading-2"
          : selector === "p" ? "body-copy"
            : selector === "button" ? "button"
              : selector === "a" ? "link"
              : selector === "nav" ? "navigation"
                : selector === "main" ? "main"
                  : selector === "section" ? "section"
                    : selector === "form" ? "form"
                      : "";
      const styleRecord = computed as unknown as Record<string, string>;
      if (semanticRole && semanticStyles.length < 8) {
        semanticStyles.push({
          role: semanticRole,
          fontFamily: (styleRecord.fontFamily || "").slice(0, 160),
          fontSize: (styleRecord.fontSize || "").slice(0, 40),
          fontWeight: (styleRecord.fontWeight || "").slice(0, 30),
          lineHeight: (styleRecord.lineHeight || "").slice(0, 40),
          letterSpacing: (styleRecord.letterSpacing || "").slice(0, 40),
          color: (styleRecord.color || "").slice(0, 80),
          backgroundColor: (styleRecord.backgroundColor || "").slice(0, 80),
          width: (styleRecord.width || "").slice(0, 40),
          display: (styleRecord.display || "").slice(0, 30),
          gridTemplateColumns: (styleRecord.gridTemplateColumns || "").slice(0, 120),
          gap: (styleRecord.gap || "").slice(0, 40),
          position: (styleRecord.position || "").slice(0, 30),
        });
      }
      if (semanticRole && layoutSamples.length < 8) {
        try {
          const rect = (first as unknown as { getBoundingClientRect?: () => { width: number; height: number } }).getBoundingClientRect?.();
          const width = Math.round(rect?.width || 0);
          const height = Math.round(rect?.height || 0);
          layoutSamples.push({
            role: semanticRole,
            width,
            height,
            display: (styleRecord.display || "").slice(0, 30),
            columns: (styleRecord.gridTemplateColumns || "").slice(0, 120),
            gap: (styleRecord.gap || "").slice(0, 40),
            position: (styleRecord.position || "").slice(0, 30),
            visible: width > 0 && height > 0 && styleRecord.display !== "none" && styleRecord.visibility !== "hidden",
          });
        } catch {
          // Keep the computed style sample if layout geometry is inaccessible.
        }
      }
      bump(colorFreq, (computed as unknown as Record<string, string>).color || "");
      bump(colorFreq, ((computed as unknown as Record<string, string>).backgroundColor || ""));
      bump(fontSizeFreq, ((computed as unknown as Record<string, string>).fontSize || ""));
      bump(spacingFreq, ((computed as unknown as Record<string, string>).marginTop || ""));
      bump(spacingFreq, ((computed as unknown as Record<string, string>).paddingTop || ""));
      bump(radiiFreq, ((computed as unknown as Record<string, string>).borderRadius || ""));
      bump(shadowFreq, ((computed as unknown as Record<string, string>).boxShadow || ""));
      bump(borderFreq, ((computed as unknown as Record<string, string>).borderTopWidth || "") + " " + (((computed as unknown as Record<string, string>).borderTopStyle || "")));
      bump(widthFreq, ((computed as unknown as Record<string, string>).width || ""));
      bump(fontFamilyFreq, ((computed as unknown as Record<string, string>).fontFamily || ""));
      bump(lineHeightFreq, ((computed as unknown as Record<string, string>).lineHeight || ""));
      bump(letterSpacingFreq, ((computed as unknown as Record<string, string>).letterSpacing || ""));
      const transition = ((computed as unknown as Record<string, string>).transition || "");
      if (transition && hasNonZeroTiming(transition)) {
        transitionSourceCount += 1;
        if (transList.length < 20) {
          const parsed = parseTransitionTiming(transition);
          transList.push({ property: parsed.property, duration: parsed.duration, easing: parsed.easing, delay: parsed.delay });
        }
      }
      const animation = ((computed as unknown as Record<string, string>).animation || "");
      if (animation && hasNonZeroTiming(animation)) {
        animationSourceCount += 1;
        if (animList.length < 20) {
          const parsed = parseAnimationTiming(animation);
          animList.push({ name: parsed.name, duration: parsed.duration, easing: parsed.easing, delay: parsed.delay });
        }
      }
      if (sampledElements >= 30) break;
    }
  } catch {
    limitations.push("Computed-style sampling partially failed.");
  }

  // CF07 Pass 3: CSS custom properties crawl.
  try {
    const rootComputed = getComputedStyle(doc.documentElement);
    const styleApi = rootComputed as unknown as {
      length?: number;
      getPropertyValue?: (name: string) => string;
    } & Record<string, string>;
    const total = typeof styleApi.length === "number" ? styleApi.length : 0;
    for (let index = 0; index < total; index += 1) {
      const name = (styleApi[String(index)] || "") as string;
      if (!name || name.indexOf("--") !== 0) continue;
      customPropertySourceCount += 1;
      if (customProps.length >= 50) continue;
      let raw = "";
      try {
        raw =
          typeof styleApi.getPropertyValue === "function"
            ? styleApi.getPropertyValue(name)
            : styleApi[name] || "";
      } catch {
        raw = "";
      }
      customProps.push({ name: name.slice(0, 120), value: String(raw ?? "").slice(0, 300), source: "computed-custom-property", confidence: "inferred" });
    }
  } catch {
    limitations.push("Custom-property crawl failed.");
  }

  // CF07 Pass 3b: scheme classes often live on <body> (e.g. Shopify color
  // schemes), never reaching :root. Merge body-level properties unseen on
  // root so site palettes are not lost.
  try {
    const seenPropNames = new Set(customProps.map((entry) => entry.name));
    const bodyComputed = getComputedStyle(doc.body);
    const bodyApi = bodyComputed as unknown as {
      length?: number;
      getPropertyValue?: (name: string) => string;
    } & Record<string, string>;
    const bodyTotal = typeof bodyApi.length === "number" ? bodyApi.length : 0;
    for (let index = 0; index < bodyTotal; index += 1) {
      const name = (bodyApi[String(index)] || "") as string;
      if (!name || name.indexOf("--") !== 0 || seenPropNames.has(name)) continue;
      seenPropNames.add(name);
      customPropertySourceCount += 1;
      if (customProps.length >= 50) continue;
      let raw = "";
      try {
        raw =
          typeof bodyApi.getPropertyValue === "function"
            ? bodyApi.getPropertyValue(name)
            : bodyApi[name] || "";
      } catch {
        raw = "";
      }
      customProps.push({ name: name.slice(0, 120), value: String(raw ?? "").slice(0, 300), source: "computed-custom-property", confidence: "inferred" });
    }
  } catch {
    // Root-level crawl already reported failures; body props are supplementary.
  }

  // SVG icon inventory: icon systems (Lucide, custom sprites) are design
  // language that classes and copy never name. Bounded to 20 symbols.
  // Placed before token ranking so `tokens.icons` builds with the rest.
  const iconFreq: Record<string, number> = {};
  let iconSourceCount = 0;
  let unnamedIconCount = 0;
  try {
    const svgs = doc.querySelectorAll("svg");
    for (let index = 0; index < svgs.length && index < 200; index += 1) {
      const node = svgs[index] as unknown as {
        getAttribute?: (name: string) => string | null;
        querySelector?: (selector: string) => { getAttribute?: (name: string) => string | null } | null;
      };
      if (!isObservable(node)) continue;
      iconSourceCount += 1;
      const use = node.querySelector ? node.querySelector("use") : null;
      // Class fallback for unnamed decorative symbols: WooCommerce-style
      // themes carry icon semantics in classes, not data attributes. Longest
      // match wins ("icon-cart" over bare "icon").
      const classHit = (node.getAttribute?.("class") || "")
        .split(/\s+/)
        .filter((part) => /icon|logo|symbol|glyph|arrow|chev/i.test(part))
        .sort((a, b) => b.length - a.length)[0] || "";
      const name = node.getAttribute?.("data-lucide") || node.getAttribute?.("data-icon") || node.getAttribute?.("aria-label") || use?.getAttribute?.("href") || use?.getAttribute?.("xlink:href") || classHit || "";
      const clean = name.replace(/\s+/g, " ").trim().slice(0, 80);
      if (clean) bump(iconFreq, clean);
      else unnamedIconCount += 1;
    }
  } catch {
    limitations.push("Icon inventory partially failed.");
  }

  // Palette noise: "transparent" backgrounds and "none" shadows/borders are
  // per-element defaults, not deliberate design values, yet they dominate
  // frequency counts on most pages. Purge them before ranking so top-N
  // tokens reflect actual choices; per-role computed samples still carry
  // the true rendered colors.
  for (const key of Object.keys(colorFreq)) {
    const lower = key.toLowerCase();
    // Computed sampling reports fully-transparent black as an rgba literal
    // rather than the "transparent" keyword; both are element defaults.
    if (lower === "transparent" || /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(lower)) delete colorFreq[key];
  }
  for (const key of Object.keys(shadowFreq)) {
    if (key.toLowerCase() === "none") delete shadowFreq[key];
  }
  for (const key of Object.keys(borderFreq)) {
    // Computed border sampling concatenates width + style, so "no border"
    // shows up as "0px none"/"0px solid"/"medium", and shorthand CSSOM
    // values can carry "!important" declaration noise. None of these are
    // reusable design tokens.
    const lower = key.toLowerCase();
    if (lower === "none" || lower === "medium" || lower === "0px none" || lower === "0px solid" || lower.includes("!important")) delete borderFreq[key];
  }

  const toTop = (freq: Record<string, number>, source: string, confidence: TokenConfidence, limit: number): CountedToken[] => {    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([value, count]) => ({ value, count, source, confidence }));
  };

  const withProvenance = (entries: CountedToken[], category: string): CountedToken[] => entries.map((entry) =>
    cssomValues[category]?.[entry.value]
      ? { ...entry, source: "cssom-rule", confidence: "observed" }
      : { ...entry, source: sampledElements > 0 ? "computed-style-sampling" : "unknown", confidence: sampledElements > 0 ? "inferred" : "unknown" },
  );
  const tokens: SnapshotTokens = {
    colors: withProvenance(toTop(colorFreq, "unclassified", "unknown", 15), "colors"),
    fontSizes: withProvenance(toTop(fontSizeFreq, "unclassified", "unknown", 10), "fontSizes"),
    spacing: withProvenance(toTop(spacingFreq, "unclassified", "unknown", 8), "spacing"),
    radii: withProvenance(toTop(radiiFreq, "unclassified", "unknown", 8), "radii"),
    borders: withProvenance(toTop(borderFreq, "unclassified", "unknown", 8), "borders"),
    shadows: withProvenance(toTop(shadowFreq, "unclassified", "unknown", 8), "shadows"),
    gradients: withProvenance(toTop(gradientFreq, "unclassified", "unknown", 8), "gradients"),
    icons: toTop(iconFreq, "svg-symbol", "observed", 20),
    customProperties: customProps.slice(0, 50),
  };
  let typography: SnapshotTypography = {
    fontFaces: fontFaces.slice(0, 20),
    fontFamilies: toTop(fontFamilyFreq, "computed", "inferred", 8),
    lineHeights: toTop(lineHeightFreq, "computed", "inferred", 8),
    letterSpacings: toTop(letterSpacingFreq, "computed", "inferred", 8),
  };
  let breakpoints: SnapshotBreakpoints = { mediaQueries: mediaQueries.slice(0, 20) };
  let motion: SnapshotMotion = {
    transitions: transList.slice(0, 20),
    animations: animList.slice(0, 20),
    keyframes: keyframeNames.slice(0, 20),
  };
  let geometry: SnapshotGeometry = {
    containerWidths: toTop(widthFreq, "computed", "inferred", 8),
    sampledElements,
  };

  // CF08: ordered, structure-preserving content and affordances. Read only;
  // no interaction is replayed, no form is submitted, and input values are
  // deliberately never read.
  const cleanText = (value: string | null | undefined, limit: number): string =>
    ((value || "").replace(/\s+/g, " ").trim()).slice(0, limit);
  const rawText = (value: string | null | undefined): string =>
    (value || "").replace(/\s+/g, " ").trim();
  const contentCap = 120;
  const contentScanCap = 500;
  const contentTextLimit = 1200;
  const hiddenContentCap = 30;
  const hiddenTextLimit = 1000;
  const contentSelector = "h1, h2, h3, h4, h5, h6, p, li, blockquote, summary, label, dt, dd, pre, table";
  const contentNodes = Array.from(doc.querySelectorAll(contentSelector));
  const contentBlocks: SnapshotContentBlock[] = [];
  const hiddenBlocks: SnapshotHiddenBlock[] = [];
  const hiddenBlockKeys = new Set<string>();
  let hiddenBlockSourceCount = 0;
  let visibleContentSourceCount = 0;
  let lastBlockKey = "";
  let contentDuplicateCount = 0;
  let visibleParagraphCount = 0;
  let visibleListItemCount = 0;
  let visibleLabelCount = 0;
  let visibleCodeCount = 0;
  let visibleTableCount = 0;
  const sectionNodesForContent = Array.from(doc.querySelectorAll("section, [role='region']"));
  const contentNodesScanned = Math.min(contentNodes.length, contentScanCap);
  for (let index = 0; index < contentNodesScanned; index += 1) {
    const node = contentNodes[index] as unknown as {
      tagName?: string;
      textContent?: string;
      parentElement?: unknown;
      closest?: (selector: string) => unknown;
    };
    const tag = String(node.tagName || "").toLowerCase();
    const observable = isObservable(node);
    // Tables are captured structurally (bounded markdown), not as flat
    // text: cell order without headers is meaningless for support matrices.
    const captureTableText = (tableNode: unknown): string => {
      try {
        const element = tableNode as unknown as {
          querySelector?: (selector: string) => { textContent?: string } | null;
          querySelectorAll?: (selector: string) => ArrayLike<unknown>;
          getAttribute?: (name: string) => string | null;
        };
        const captionNode = element.querySelector ? element.querySelector("caption") : null;
        const caption = cleanText(captionNode?.textContent || element.getAttribute?.("aria-label") || "", 120);
        const rowNodes = element.querySelectorAll ? Array.from(element.querySelectorAll("tr")) : [];
        if (rowNodes.length === 0) return "";
        const maxRows = 6;
        const maxCols = 8;
        const cleanCell = (value: unknown): string =>
          String((value as { textContent?: string } | null)?.textContent ?? "")
            .replace(/\s+/g, " ").trim().replace(/\|/g, "/").slice(0, 60);
        const cellsOf = (row: unknown): string[] =>
          Array.from(
            ((row as { querySelectorAll?: (selector: string) => ArrayLike<unknown> }).querySelectorAll?.("th, td") ?? []) as ArrayLike<unknown>,
          ).slice(0, maxCols).map(cleanCell);
        const headerCells = rowNodes.length > 0
          ? Array.from(
            ((rowNodes[0] as { querySelectorAll?: (selector: string) => ArrayLike<unknown> }).querySelectorAll?.("th, td") ?? []) as ArrayLike<unknown>,
          ).map(cleanCell)
          : [];
        if (headerCells.length === 0 || headerCells.every((cell) => !cell)) return "";
        const header = headerCells.slice(0, maxCols);
        const body = rowNodes.slice(1, maxRows + 1).map(cellsOf).filter((cells) => cells.some((cell) => Boolean(cell)));
        const clipped = rowNodes.length - 1 > maxRows || headerCells.length > maxCols;
        const totalCols = Math.max(header.length, ...body.map((cells) => cells.length));
        const pad = (cells: string[]): string[] => cells.concat(Array(Math.max(0, totalCols - cells.length)).fill(""));
        const lines = [
          `Table${caption ? `: ${caption}` : ""} (${rowNodes.length} rows x ${totalCols} cols${clipped ? ", clipped" : ""}):`,
          `| ${pad(header).join(" | ")} |`,
          `|${pad(header).map(() => "---").join("|")}|`,
          ...body.map((cells) => `| ${pad(cells).join(" | ")} |`),
        ];
        return lines.join("\n");
      } catch {
        return "";
      }
    };
    // Code samples keep their line breaks and indentation (trimmed per
    // line, capped per line); every other block collapses whitespace.
    const raw = tag === "table"
      ? captureTableText(node)
      : tag === "pre"
      ? ((observable ? renderedText(node) : node.textContent) || "")
        .split("\n")
        .map((line) => line.replace(/[ \t\f\v]+$/g, "").slice(0, 400))
        .join("\n")
        .replace(/^\n+|\n+$/g, "")
      : rawText(observable ? renderedText(node) : node.textContent);
    if (!raw) continue;
    if (!observable) {
      const nodeRef = node as unknown as { getAttribute?: (name: string) => string | null; closest?: (selector: string) => unknown };
      const collapsed = Boolean(nodeRef.closest?.("details:not([open])"));
      const ariaHidden = nodeRef.getAttribute?.("aria-hidden") === "true" || Boolean(nodeRef.closest?.("[aria-hidden='true']"));
      const explicitlyHidden = nodeRef.getAttribute?.("hidden") !== null || Boolean(nodeRef.closest?.("[hidden]"));
      const initialState: SnapshotHiddenBlock["initialState"] = collapsed
        ? "collapsed-details"
        : ariaHidden
          ? "aria-hidden"
          : explicitlyHidden
            ? "hidden-attribute"
            : "computed-hidden";
      const key = `${tag}|${raw}`;
      if (!hiddenBlockKeys.has(key)) {
        hiddenBlockKeys.add(key);
        hiddenBlockSourceCount += 1;
        if (hiddenBlocks.length < hiddenContentCap) {
          const hiddenLevel = /^h[1-6]$/.test(tag) ? Number(tag.slice(1)) : null;
          const hiddenKind: SnapshotContentBlock["kind"] = hiddenLevel
            ? "heading"
            : tag === "p"
              ? "paragraph"
              : tag === "pre"
                ? "code"
                : tag === "li"
                  ? "list-item"
                  : tag === "blockquote"
                    ? "blockquote"
                    : tag === "summary"
                      ? "summary"
                      : tag === "label"
                        ? "form-label"
                        : "definition";
          hiddenBlocks.push({ order: index, kind: hiddenKind, tag, text: raw.slice(0, hiddenTextLimit), initialState, truncated: raw.length > hiddenTextLimit });
        }
      }
      continue;
    }
    visibleContentSourceCount += 1;
    if (tag === "p") visibleParagraphCount += 1;
    if (tag === "li") visibleListItemCount += 1;
    if (tag === "label") visibleLabelCount += 1;
    if (tag === "pre") visibleCodeCount += 1;
    if (tag === "table") visibleTableCount += 1;
    const sectionIndex = sectionNodesForContent.findIndex((section) =>
      Boolean((section as unknown as { contains?: (candidate: unknown) => boolean }).contains?.(node)),
    );
    const level = /^h[1-6]$/.test(tag) ? Number(tag.slice(1)) : null;
    const kind: SnapshotContentBlock["kind"] = level
      ? "heading"
      : tag === "p"
        ? "paragraph"
        : tag === "pre"
          ? "code"
          : tag === "table"
            ? "table"
            : tag === "li"
              ? "list-item"
            : tag === "blockquote"
              ? "blockquote"
              : tag === "summary"
                ? "summary"
                : tag === "label"
                  ? "form-label"
                  : "definition";
    if (contentBlocks.length >= contentCap) continue;
    // Sticky/fixed chrome repeats identical adjacent copy (nav captured per
    // paint band). Count the source, emit once, and report the collapse.
    const blockKey = `${kind}|${tag}|${raw}`;
    if (blockKey === lastBlockKey) {
      contentDuplicateCount += 1;
      continue;
    }
    lastBlockKey = blockKey;
    contentBlocks.push({
      order: index,
      kind,
      tag,
      headingLevel: level,
      sectionIndex: sectionIndex >= 0 ? sectionIndex : null,
      text: raw.slice(0, contentTextLimit),
      truncated: raw.length > contentTextLimit,
    });
  }

  const controlsCap = 100;
  const controlsSelector = "a[href], button, input, textarea, select, summary, dialog, video[controls], audio[controls], [role='button'], [role='link'], [role='dialog']";
  const controlNodes = Array.from(doc.querySelectorAll(controlsSelector));
  const controls: SnapshotControl[] = [];
  const optionText = (option: unknown): string => {
    const item = option as { textContent?: string; label?: string };
    return cleanText(item.label || item.textContent || "", 120);
  };
  for (let index = 0; index < controlNodes.length && controls.length < controlsCap; index += 1) {
    const node = controlNodes[index] as unknown as {
      tagName?: string;
      textContent?: string;
      type?: string;
      name?: string;
      id?: string;
      required?: boolean;
      disabled?: boolean;
      href?: string;
      labels?: ArrayLike<{ textContent?: string }> | null;
      options?: ArrayLike<unknown>;
      getAttribute?: (name: string) => string | null;
    };
    if (!isObservable(node)) continue;
    const tag = String(node.tagName || "").toLowerCase();
    const role = node.getAttribute?.("role") || "";
    const type = node.type ? String(node.type).slice(0, 40) : null;
    const kind: SnapshotControl["kind"] = tag === "a" || role === "link"
      ? "link"
      : tag === "dialog" || role === "dialog"
        ? "dialog"
      : tag === "input" && ["submit", "button", "reset"].includes(type || "")
        ? "button"
        : tag === "input" || tag === "textarea" || tag === "select"
        ? tag
        : tag === "summary"
          ? "summary"
          : tag === "video" || tag === "audio"
            ? "media"
            : "button";
    let associatedLabel = "";
    try {
      const labels = node.labels;
      for (let labelIndex = 0; labels && labelIndex < labels.length && labelIndex < 3; labelIndex += 1) {
      associatedLabel += " " + renderedText(labels[labelIndex]);
      }
    } catch {
      // Some custom controls do not expose the labels collection.
    }
    const safeButtonValue = tag === "input" && ["submit", "button", "reset"].includes(type || "")
      ? node.getAttribute?.("value") || ""
      : "";
    const label = cleanText(
      associatedLabel || node.getAttribute?.("aria-label") || renderedText(node) || safeButtonValue,
      160,
    );
    const options: string[] = [];
    try {
      for (let optionIndex = 0; node.options && optionIndex < node.options.length && optionIndex < 20; optionIndex += 1) {
        const text = optionText(node.options[optionIndex]);
        if (text) options.push(text);
      }
    } catch {
      // Options are supplementary evidence; retain the control if inaccessible.
    }
    controls.push({
      order: index,
      kind,
      label,
      type,
      name: node.name ? String(node.name).slice(0, 100) : null,
      id: node.id ? String(node.id).slice(0, 100) : null,
      required: Boolean(node.required || node.getAttribute?.("aria-required") === "true"),
      disabled: Boolean(node.disabled || node.getAttribute?.("aria-disabled") === "true"),
      href: node.href ? String(node.href).slice(0, 500) : null,
      options,
      ariaExpanded: node.getAttribute?.("aria-expanded")?.slice(0, 20) ?? null,
      ariaControls: node.getAttribute?.("aria-controls")?.slice(0, 120) ?? null,
      ariaLabelledBy: node.getAttribute?.("aria-labelledby")?.slice(0, 120) ?? null,
      placeholder: node.getAttribute?.("placeholder")?.slice(0, 160) ?? null,
      autocomplete: node.getAttribute?.("autocomplete")?.slice(0, 80) ?? null,
      ariaPressed: node.getAttribute?.("aria-pressed")?.slice(0, 20) ?? null,
      ariaSelected: node.getAttribute?.("aria-selected")?.slice(0, 20) ?? null,
      ariaHasPopup: node.getAttribute?.("aria-haspopup")?.slice(0, 40) ?? null,
      open: node.getAttribute ? node.getAttribute("open") !== null : false,
      multiple: Boolean(node.getAttribute?.("multiple") !== null),
    });
  }

  const componentNodes = Array.from(
    doc.querySelectorAll("article, form, nav, details, dialog, [role='dialog'], [role='region'], [class*='card'], [class*='project'], [class*='portfolio'], [class*='testimonial'], [class*='service'], [class*='team'], [class*='award'], [class*='step'], [class*='package'], [class*='client'], [class*='feature'], [class*='faq'], [class*='carousel'], [class*='slider'], [class*='swiper-slide'], [data-accordion]"),
  );
  const componentPatterns: SnapshotComponentPattern[] = [];
  const componentBySignature: Record<string, SnapshotComponentPattern> = {};
  for (let index = 0; index < componentNodes.length && index < 300; index += 1) {
    const node = componentNodes[index] as unknown as {
      tagName?: string;
      textContent?: string;
      className?: unknown;
      getAttribute?: (name: string) => string | null;
      querySelector?: (selector: string) => { textContent?: string } | null;
    };
    if (!isObservable(node)) continue;
    const tag = String(node.tagName || "").toLowerCase();
    const role = node.getAttribute?.("role") || "";
    const classText = typeof node.className === "string" ? node.className : "";
    const classHint = classText
      .split(/\s+/)
      .filter((name) => /card|hero|grid|project|portfolio|testimonial|service|team|award|step|package|client|feature|faq|carousel|slider|swiper|accordion|modal|dialog|menu|nav|form/i.test(name))
      .filter((name) => !/(^|[-_])(featured|active|inactive|selected|current|large|small|wide|compact|first|last)([-_]|$)/i.test(name))
      .slice(0, 2)
      .map((name) => name.slice(0, 40))
      .join(".");
    const kind = classHint.includes("testimonial")
      ? "testimonial"
      : classHint.includes("service")
        ? "service"
        : classHint.includes("team")
          ? "team-member"
          : classHint.includes("award")
            ? "award"
            : classHint.includes("project") || classHint.includes("portfolio")
              ? "project-card"
              : classHint.includes("package")
                ? "package"
                : tag === "article" || classHint.includes("card")
                  ? "card-like"
      : tag === "form"
        ? "form"
        : tag === "nav"
          ? "navigation"
          : tag === "details" || classHint.includes("accordion") || classHint.includes("faq")
            ? "disclosure"
            : tag === "dialog" || role === "dialog" || classHint.includes("modal")
              ? "dialog"
              : classHint.includes("carousel") || classHint.includes("slider")
                ? "carousel-like"
                : "region";
    const signature = `${kind}|${tag}|${role || "no-role"}|${classHint || "no-hint"}`.slice(0, 140);
    let pattern = componentBySignature[signature];
    if (!pattern) {
      pattern = { kind, signature, count: 0, examples: [] };
      componentBySignature[signature] = pattern;
      if (componentPatterns.length < 20) componentPatterns.push(pattern);
    }
    pattern.count += 1;
    const heading = renderedText(node.querySelector?.("h1, h2, h3, h4, h5, h6")) || renderedText(node);
    const example = cleanText(heading, 100);
    if (example && pattern.examples.length < 3 && !pattern.examples.includes(example)) pattern.examples.push(example);
  }

  const coverage = (
    sourceCount: number,
    emittedCount: number,
    cap: number,
    textWasTruncated = false,
    exclusionReason = "elements outside the observable content set were omitted",
    deduplicatedCount = 0,
  ): SnapshotCollectionCoverage => {
    const omitted = sourceCount > emittedCount + deduplicatedCount;
    return {
      sourceCount,
      emittedCount,
      cap,
      truncated: omitted || textWasTruncated,
      ...(deduplicatedCount > 0 ? { deduplicatedCount } : {}),
      reason: omitted
        ? emittedCount >= cap ? `collection cap ${cap} reached` : exclusionReason
        : textWasTruncated
          ? "one or more text fields reached their per-field character cap"
          : deduplicatedCount > 0 ? `${deduplicatedCount} duplicate references collapsed` : null,
    };
  };

  const detailedSections: SnapshotSection[] = [];
  const sectionRects: SectionRect[] = [];
  try {
    const nodes = sectionNodesForContent;
    for (let index = 0; index < nodes.length && detailedSections.length < 20; index += 1) {
      const node = nodes[index] as unknown as { getAttribute?: (name: string) => string | null; querySelector?: (selector: string) => { textContent?: string } | null; textContent?: string };
      if (!isObservable(node)) continue;
      const role = node.getAttribute ? node.getAttribute("role") || "section" : "section";
      const innerHeading = node.querySelector ? node.querySelector("h1, h2, h3, h4, h5, h6") : null;
      detailedSections.push({
        role: (role || "section").slice(0, 40),
        heading: cleanText(renderedText(innerHeading), 120),
        textExcerpt: cleanText(renderedText(node), 200),
      });
      // Bounding rects for section-clipped screenshots (homepage, max 6).
      if (sectionRects.length < 6) {
        try {
          const rect = (node as unknown as { getBoundingClientRect?: () => { top: number; height: number } }).getBoundingClientRect?.();
          if (rect) {
            const top = Math.max(Math.round(rect.top + (window.scrollY || 0)), 0);
            const height = Math.round(rect.height);
            // Only meaningful visible blocks (skip hairlines and viewport giants).
            if (height >= 200 && height <= 6000 && sectionRects.every((existing) => Math.abs(existing.y - top) > 50)) {
              sectionRects.push({ y: top, height, heading: cleanText(renderedText(innerHeading), 80) });
            }
          }
        } catch {
          // Geometry unavailable for this node; skip silently.
        }
      }
    }
  } catch {
    limitations.push("Section detail collection partially failed.");
  }
  // Tone notes aggregated in-browser (no Worker CPU).
  let tone: SnapshotTone = { avgSentenceWords: 0, questionCount: 0, ctaCount: 0, voice: "unknown" };
  try {
    const corpus = contentBlocks
      .filter((block) => block.kind === "heading" || block.kind === "paragraph")
      .slice(0, 50)
      .map((block) => block.text)
      .join(" ")
      .slice(0, 5000);
    const sentences = corpus.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean);
    const words = corpus.split(/\s+/).filter(Boolean).length;
    const avg = sentences.length > 0 ? Math.round((words / sentences.length) * 10) / 10 : 0;
    const questions = (corpus.match(/\?/g) || []).length;
    const ctaHits = (corpus.match(/buy|start|try|get|contact|learn|shop|sign|pricing|demo|trial/gi) || []).length;
    tone = {
      avgSentenceWords: avg,
      questionCount: Math.min(questions, 99),
      ctaCount: Math.min(ctaHits, 99),
      voice: ctaHits >= 3 ? "cta-heavy" : avg > 18 ? "informational" : sentences.length > 0 ? "concise" : "unknown",
    };
  } catch {
    limitations.push("Tone analysis partially failed.");
  }
  const hasTextTruncation = contentBlocks.some((block) => block.truncated);
  const representedComponentCount = componentPatterns.reduce((total, pattern) => total + pattern.count, 0);
  const componentCoverage = coverage(componentNodes.length, representedComponentCount, 300, false, "pattern signatures omitted after the 20-pattern cap");
  if (Object.keys(componentBySignature).length > 20) componentCoverage.reason = "pattern signatures omitted after the 20-pattern cap";
  const content: SnapshotContent = {
    blocks: contentBlocks,
    hiddenBlocks,
    controls,
    components: componentPatterns,
    coverage: {
      headings: coverage(doc.querySelectorAll("h1, h2, h3, h4, h5, h6").length, headings.length, maxHeadings),
      links: coverage(doc.querySelectorAll("a[href]").length, links.length, maxLinks),
      contentBlocks: coverage(visibleContentSourceCount, contentBlocks.length, contentCap, hasTextTruncation, undefined, contentDuplicateCount),
      contentNodesScanned: coverage(contentNodes.length, contentNodesScanned, contentScanCap, false, "semantic text node scan cap reached"),
      hiddenBlocks: coverage(hiddenBlockSourceCount, hiddenBlocks.length, hiddenContentCap, hiddenBlocks.some((block) => block.truncated)),
      controls: coverage(controlNodes.length, controls.length, controlsCap, false, "hidden or inaccessible controls were omitted"),
      components: componentCoverage,
      sections: coverage(sectionNodesForContent.length, detailedSections.length, 20),
      labels: coverage(visibleLabelCount, contentBlocks.filter((block) => block.kind === "form-label").length, contentCap),
      paragraphElements: coverage(visibleParagraphCount, contentBlocks.filter((block) => block.kind === "paragraph").length, contentCap),
      listElements: coverage(visibleListItemCount, contentBlocks.filter((block) => block.kind === "list-item").length, contentCap),
      codeElements: coverage(visibleCodeCount, contentBlocks.filter((block) => block.kind === "code").length, contentCap),
      tableElements: coverage(visibleTableCount, contentBlocks.filter((block) => block.kind === "table").length, contentCap),
    },
    sections: detailedSections,
    tone,
  };
  const anchorSourceCount = doc.querySelectorAll("a[href]").length;
  content.coverage.links = coverage(
    anchorSourceCount,
    links.length,
    maxLinks,
    false,
    "hidden or inaccessible links were omitted",
    Math.max(0, linkCandidatesScanned - sourceLinkHrefs.size),
  );

  // Observed interaction affordances (DOM attributes only; nothing is clicked
  // or submitted). Bounded to 20 entries.
  const observedInteractions: ObservedInteraction[] = [];
  try {
    const pushInteraction = (kind: string, detail: string): void => {
      if (observedInteractions.length >= 20) return;
      observedInteractions.push({ kind, detail: cleanText(detail, 120) });
    };
    if (doc.querySelectorAll("[onclick]").length > 0) pushInteraction("inline-onclick", String(doc.querySelectorAll("[onclick]").length) + " element(s) with onclick attributes");
    if (doc.querySelectorAll("video[controls]").length > 0) pushInteraction("video-controls", String(doc.querySelectorAll("video[controls]").length) + " video player(s)");
    if (doc.querySelectorAll("audio[controls]").length > 0) pushInteraction("audio-controls", String(doc.querySelectorAll("audio[controls]").length) + " audio player(s)");
    // Canvas/WebGL hero scenes (common on award sites) paint motion that a
    // static screenshot freezes. Name it so rebuilders know the still is
    // not the experience.
    if (doc.querySelectorAll("canvas").length > 0) {
      pushInteraction("canvas-present", String(doc.querySelectorAll("canvas").length) + " canvas element(s); script-rendered scenes captured as a single static frame");
      limitations.push("Canvas element(s) present; script-rendered scenes are captured as a single static frame, not as motion.");
    }
    // Pinned scroll-scrub scenes misrender in full-height screenshots (the
    // pin spacer paints as a blank band). The CSSOM pass already counted
    // sticky/fixed rules at zero marginal cost; surface it here.
    if (stickyFixedRuleCount > 0) {
      pushInteraction("sticky-fixed", String(stickyFixedRuleCount) + " CSS rule(s) use sticky/fixed positioning; pinned scroll scenes may show blank bands in full-page captures");
      limitations.push("Sticky/fixed positioning present; pinned scroll scenes can misrender as blank bands in full-page screenshots while their copy remains in the documentation.");
    }
    if (doc.querySelectorAll("details").length > 0) pushInteraction("details-toggle", String(doc.querySelectorAll("details").length) + " collapsible area(s)");
    if (doc.querySelectorAll("dialog, [open]").length > 0) pushInteraction("dialog", "dialog or open-state element present");
    if (doc.querySelectorAll("[contenteditable='true']").length > 0) pushInteraction("contenteditable", "editable region present");
    if (doc.querySelectorAll("form input[type='email'], form input[type='search'], form textarea").length > 0) pushInteraction("form-input", "text/email/search inputs present");
    const ariaToggles = doc.querySelectorAll("[aria-expanded], [aria-controls]");
    if (ariaToggles.length > 0) {
      const states: string[] = [];
      for (let index = 0; index < ariaToggles.length && states.length < 5; index += 1) {
        const node = ariaToggles[index] as unknown as { getAttribute?: (name: string) => string | null; textContent?: string };
        const label = cleanText(node.getAttribute?.("aria-label") || renderedText(node), 40);
        const expanded = node.getAttribute?.("aria-expanded");
        const controls = node.getAttribute?.("aria-controls");
        states.push(`${label || "unlabelled"}: expanded=${expanded || "unknown"}${controls ? ` controls=${controls.slice(0, 50)}` : ""}`);
      }
      pushInteraction("aria-controlled", `${ariaToggles.length} control(s); ${states.join("; ")}`);
    }
    if (doc.querySelectorAll("form").length > 0) pushInteraction("form", `${doc.querySelectorAll("form").length} form(s); controls are described in content.controls`);
    const carousels = doc.querySelectorAll("[class*='carousel'], [class*='slider'], [class*='swiper']");
    if (carousels.length > 0) pushInteraction("carousel-like", String(carousels.length) + " carousel/slider-like container(s)");
    if (doc.querySelectorAll("[data-toggle], [data-bs-toggle], [data-accordion]").length > 0) pushInteraction("data-attribute-toggle", "framework toggle attributes present");
    // Modern sites attach behavior via addEventListener, which is invisible
    // to static inspection. These observable proxies recover part of that
    // signal without clicking anything: ARIA-declared interactivity,
    // keyboard focus hints, and framework handler attributes.
    const roleInteractive = doc.querySelectorAll("[role='button'], [role='link'], [role='tab'], [role='switch'], [role='menuitem'], [role='checkbox'], [role='radio'], [role='slider'], [role='option']");
    if (roleInteractive.length > 0) pushInteraction("role-interactive", String(roleInteractive.length) + " element(s) expose interactive ARIA roles");
    const focusHints = doc.querySelectorAll("[tabindex]");
    if (focusHints.length > 0) pushInteraction("keyboard-focusable", String(focusHints.length) + " element(s) carry tabindex focus hints");
    const frameworkHandlers = doc.querySelectorAll("[ng-click], [data-action], [x-data]");
    if (frameworkHandlers.length > 0) pushInteraction("framework-handler", String(frameworkHandlers.length) + " element(s) declare framework click/data handlers");
  } catch {
    limitations.push("Interaction detection partially failed.");
  }

  // CF08: asset manifest by URL reference only — never fetched or downloaded here.
  const assets: SnapshotAsset[] = [];
  const seenAssets = new Set<string>();
  const pageUrl = doc.location?.href ?? "";
  const resolveUrl = (value: string): string => {
    const trimmed = (value || "").trim();
    if (!trimmed) return "";
    // Inline data blobs are not shippable manifest entries; record by
    // reference only.
    if (/^data:/i.test(trimmed)) return "";
    try {
      const resolved = new URL(trimmed, pageUrl);
      // Map tiles multiply per page/zoom and are re-embedded, not copied.
      const host = resolved.hostname.toLowerCase();
      if (host === "maps.googleapis.com" || host === "maps.gstatic.com") return "";
      return resolved.toString().slice(0, 500);
    } catch {
      return trimmed.slice(0, 500);
    }
  };
  const pushAsset = (url: string, kind: string, alt: string, width: number | null, height: number | null, extra?: { readyState?: number | null; rectY?: number | null; rectHeight?: number | null }): void => {
    if (assets.length >= 100) return;
    const key = kind + "|" + url;
    if (!url || seenAssets.has(key)) return;
    seenAssets.add(key);
    assets.push({ url, kind, alt: (alt || "").replace(/\s+/g, " ").trim().slice(0, 200), width, height, usedOn: pageUrl.slice(0, 500), ...(extra ?? {}) });
  };
  // Document-relative box for media elements, so docs can say *where* an
  // unready video or embed sits on the page.
  const embedRect = (node: unknown): { y: number; height: number } | null => {
    try {
      const rect = (node as unknown as { getBoundingClientRect?: () => { top: number; height: number } }).getBoundingClientRect?.();
      if (!rect) return null;
      return { y: Math.max(Math.round(rect.top + (window.scrollY || 0)), 0), height: Math.round(rect.height) };
    } catch {
      return null;
    }
  };
  try {
    const images = doc.querySelectorAll("img");
    for (let index = 0; index < images.length && assets.length < 100; index += 1) {
      const node = images[index] as unknown as { getAttribute?: (name: string) => string | null };
      const raw = (node.getAttribute ? node.getAttribute("src") || node.getAttribute("data-src") || "" : "") || "";
      const srcset = (node.getAttribute ? node.getAttribute("srcset") || "" : "") || "";
      const firstSrc = raw || (srcset.split(",")[0] || "").trim().split(" ")[0] || "";
      const url = resolveUrl(firstSrc);
      const alt = (node.getAttribute ? node.getAttribute("alt") || "" : "") || "";
      const widthAttr = node.getAttribute ? node.getAttribute("width") : null;
      const heightAttr = node.getAttribute ? node.getAttribute("height") : null;
      const width = widthAttr ? Number(widthAttr) || null : null;
      const height = heightAttr ? Number(heightAttr) || null : null;
      const kind = /logo/i.test(raw + " " + alt) ? "logo" : "image";
      pushAsset(url, kind, alt, width, height);
    }
  } catch {
    limitations.push("Image manifest collection partially failed.");
  }
  try {
    const icons = doc.querySelectorAll("link[rel='icon'], link[rel='shortcut icon']");
    for (let index = 0; index < icons.length && assets.length < 100; index += 1) {
      const node = icons[index] as unknown as { getAttribute?: (name: string) => string | null };
      const href = (node.getAttribute ? node.getAttribute("href") || "" : "") || "";
      pushAsset(resolveUrl(href), "icon", "favicon", null, null);
    }
    const ogImage = doc.querySelector('meta[property="og:image"]');
    const ogContent = ogImage ? (ogImage as unknown as { getAttribute?: (name: string) => string | null }).getAttribute?.("content") || "" : "";
    if (ogContent) pushAsset(resolveUrl(ogContent), "hero", "open graph image", null, null);
    const videos = doc.querySelectorAll("video[poster]");
    for (let index = 0; index < videos.length && assets.length < 100; index += 1) {
      const node = videos[index] as unknown as { getAttribute?: (name: string) => string | null };
      const poster = (node.getAttribute ? node.getAttribute("poster") || "" : "") || "";
      pushAsset(resolveUrl(poster), "video-poster", "video poster", null, null);
    }
  } catch {
    limitations.push("Icon/hero manifest collection partially failed.");
  }
  // Videos without poster attributes (common on Framer-style builders) are
  // invisible to the poster pass above. Record their file URLs so rebuilders
  // at least know motion content exists; the binary is never fetched.
  let mediaSourceCount = 0;
  try {
    const videos = doc.querySelectorAll("video");
    for (let index = 0; index < videos.length && assets.length < 100; index += 1) {
      const node = videos[index] as unknown as { getAttribute?: (name: string) => string | null; readyState?: number };
      const src = (node.getAttribute ? node.getAttribute("src") || "" : "") || "";
      const label = (node.getAttribute ? node.getAttribute("aria-label") || node.getAttribute("title") || "" : "") || "";
      const readyState = typeof node.readyState === "number" ? node.readyState : null;
      const rect = embedRect(node);
      pushAsset(resolveUrl(src), "video", label || "video", null, null, { readyState, rectY: rect?.y ?? null, rectHeight: rect?.height ?? null });
    }
    const sources = doc.querySelectorAll("source");
    for (let index = 0; index < sources.length && assets.length < 100; index += 1) {
      const node = sources[index] as unknown as { getAttribute?: (name: string) => string | null };
      const src = (node.getAttribute ? node.getAttribute("src") || "" : "") || "";
      const type = (node.getAttribute ? node.getAttribute("type") || "" : "") || "";
      // <picture> art-direction uses srcset, not src; only media files here.
      if (!src || !(/video|audio/i.test(type) || /\.(mp4|webm|mov|ogv|m4v|mp3|wav|ogg|oga|m4a)(\?|#|$)/i.test(src))) continue;
      mediaSourceCount += 1;
      const kind = /audio|mp3|wav|ogg|oga|m4a/i.test(type + " " + src) ? "audio" : "video";
      const label = (node.getAttribute ? node.getAttribute("title") || "" : "") || "";
      pushAsset(resolveUrl(src), kind, label || kind, null, null);
    }
  } catch {
    limitations.push("Video/audio manifest collection partially failed.");
  }
  const assetSourceCount = doc.querySelectorAll("img").length
    + doc.querySelectorAll("link[rel='icon'], link[rel='shortcut icon']").length
    + doc.querySelectorAll("video[poster]").length
    + doc.querySelectorAll("video").length
    + mediaSourceCount
    + (doc.querySelector('meta[property="og:image"]') ? 1 : 0);
  content.coverage.assets = coverage(assetSourceCount, assets.length, 100);
  content.coverage.interactions = coverage(observedInteractions.length, observedInteractions.length, 20);

  // Embedded third-party frames (video players, maps, audio) are functional
  // page content a rebuild must account for. URL + domain + kind only.
  const embeds: SnapshotEmbed[] = [];
  const seenEmbeds = new Set<string>();
  const iframeNodes = doc.querySelectorAll("iframe");
  try {
    for (let index = 0; index < iframeNodes.length && embeds.length < 20; index += 1) {
      const node = iframeNodes[index] as unknown as { getAttribute?: (name: string) => string | null; title?: string };
      const raw = node.getAttribute ? node.getAttribute("src") || "" : "";
      const url = resolveUrl(raw);
      if (!url || seenEmbeds.has(url)) continue;
      seenEmbeds.add(url);
      let host = "";
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        host = "";
      }
      const kind: SnapshotEmbed["kind"] = /youtube\.com|youtu\.be/.test(host) ? "youtube"
        : /vimeo\.com/.test(host) ? "vimeo"
        : /spotify\.com|spotify\.embed/.test(host) ? "spotify"
        : /google\.com|maps\.google/.test(host) ? "maps" : "other";
      const rect = embedRect(node);
      embeds.push({ url, domain: host.slice(0, 120) || "unknown", kind, title: cleanText(node.getAttribute?.("title") || node.title || "", 120), readyState: null, rectY: rect?.y ?? null, rectHeight: rect?.height ?? null });
    }
  } catch {
    limitations.push("Embed manifest collection partially failed.");
  }

  // Social/share metadata: bounded meta reads for the overview docs.
  const readMeta = (selector: string): string | null => {
    try {
      const node = doc.querySelector(selector) as unknown as { getAttribute?: (name: string) => string | null } | null;
      const raw = node?.getAttribute ? node.getAttribute("content") || "" : "";
      const clean = raw.replace(/\s+/g, " ").trim();
      return clean ? clean.slice(0, 300) : null;
    } catch {
      return null;
    }
  };
  const social: SnapshotSocial = {
    ogTitle: readMeta('meta[property="og:title"]'),
    ogDescription: readMeta('meta[property="og:description"]'),
    twitterCard: readMeta('meta[name="twitter:card"]'),
    generator: readMeta('meta[name="generator"]'),
    themeColor: readMeta('meta[name="theme-color"]'),
  };

  // Same-origin form endpoints (paths only): tells a rebuilder what each
  // form posts to without submitting anything. Third-party endpoints and
  // query strings are omitted rather than leaked.
  const formActions: string[] = [];
  try {
    const forms = doc.querySelectorAll("form");
    const pageOrigin = (() => {
      try {
        return new URL(pageUrl).origin;
      } catch {
        return "";
      }
    })();
    for (let index = 0; index < forms.length && formActions.length < 5; index += 1) {
      const node = forms[index] as unknown as { getAttribute?: (name: string) => string | null };
      const raw = node.getAttribute ? node.getAttribute("action") || "" : "";
      if (!raw) continue;
      try {
        const resolved = new URL(raw, pageUrl);
        if (!pageOrigin || resolved.origin !== pageOrigin) continue;
        const path = resolved.pathname.slice(0, 200);
        if (path && !formActions.includes(path)) formActions.push(path);
      } catch {
        // Unparseable actions are skipped, not trusted.
      }
    }
  } catch {
    limitations.push("Form action collection partially failed.");
  }
  const collectionCoverage: Record<string, SnapshotCollectionCoverage> = {
    headings: coverage(doc.querySelectorAll("h1, h2, h3, h4, h5, h6").length, headings.length, maxHeadings, headings.some((heading) => heading.truncated), "hidden headings were omitted"),
    links: content.coverage.links,
    "tokens.colors": coverage(Object.keys(colorFreq).length, tokens.colors.length, 15),
    "tokens.fontSizes": coverage(Object.keys(fontSizeFreq).length, tokens.fontSizes.length, 10),
    "tokens.spacing": coverage(Object.keys(spacingFreq).length, tokens.spacing.length, 8),
    "tokens.radii": coverage(Object.keys(radiiFreq).length, tokens.radii.length, 8),
    "tokens.borders": coverage(Object.keys(borderFreq).length, tokens.borders.length, 8),
    "tokens.shadows": coverage(Object.keys(shadowFreq).length, tokens.shadows.length, 8),
    "tokens.gradients": coverage(Object.keys(gradientFreq).length, tokens.gradients.length, 8),
    "tokens.icons": coverage(iconSourceCount, tokens.icons.length, 20),
    "forms.actions": coverage(doc.querySelectorAll("form").length, formActions.length, 5),    "tokens.customProperties": coverage(customPropertySourceCount, tokens.customProperties.length, 50),
    "typography.fontFaces": coverage(fontFaceSourceCount, typography.fontFaces.length, 20),
    "typography.fontFamilies": coverage(Object.keys(fontFamilyFreq).length, typography.fontFamilies.length, 8),
    "typography.lineHeights": coverage(Object.keys(lineHeightFreq).length, typography.lineHeights.length, 8),
    "typography.letterSpacings": coverage(Object.keys(letterSpacingFreq).length, typography.letterSpacings.length, 8),
    "responsive.mediaQueries": coverage(mediaQuerySourceCount, breakpoints.mediaQueries.length, 20),
    "motion.transitions": coverage(transitionSourceCount, motion.transitions.length, 20),
    "motion.animations": coverage(animationSourceCount, motion.animations.length, 20),
    "motion.keyframes": coverage(keyframeSourceCount, motion.keyframes.length, 20),
    "geometry.containerWidths": coverage(Object.keys(widthFreq).length, geometry.containerWidths.length, 8),
    "screenshots.sectionRects": coverage(sectionNodesForContent.length, sectionRects.length, 6, false, "sections without a capturable bounding box were omitted"),
    "components.patterns": content.coverage.components,
    "content.blocks": content.coverage.contentBlocks,
    hoverStates: coverage(hoverSourceCount, hoverStates.length, 12),
    embeds: coverage(iframeNodes.length, embeds.length, 20),
    "content.hiddenBlocks": content.coverage.hiddenBlocks,
    "content.nodesScanned": content.coverage.contentNodesScanned,
    "content.controls": content.coverage.controls,
    "content.sections": content.coverage.sections,
    "assets": coverage(
      assetSourceCount,
      assets.length,
      100,
      false,
      "asset entries were omitted by the collection cap",
      assets.length < 100 ? Math.max(0, assetSourceCount - assets.length) : 0,
    ),
  };
  content.coverage.assets = collectionCoverage.assets;
  if (widgetHoverSkipped > 0) {
    const entry = collectionCoverage.hoverStates!;
    const note = `${widgetHoverSkipped} third-party widget rule(s) omitted as non-site evidence`;
    entry.truncated = true;
    entry.reason = entry.reason ? `${entry.reason}; ${note}` : note;
  }
  if (unnamedIconCount > 0) {
    const entry = collectionCoverage["tokens.icons"]!;
    const note = `${unnamedIconCount} unnamed symbol(s) omitted (no data attribute or icon-like class)`;
    entry.truncated = true;
    entry.reason = entry.reason ? `${entry.reason}; ${note}` : note;
  }

  // CF07 Trap 2: in-browser byte-budget self-check with emergency pruning.
  const basePayload = {
    url: (doc.location?.href ?? "").slice(0, 1000),
    title: ((doc.title || "").replace(/\s+/g, " ").trim()).slice(0, 500),
    metaDescription: metaDescription ? (((metaDescription.getAttribute("content") || "").replace(/\s+/g, " ").trim()).slice(0, 1000) || null) : null,
    lang: (doc.documentElement.getAttribute("lang") || "").slice(0, 40) || null,
    headings,
    links,
    bodyBackgroundColor: String(bodyStyle.backgroundColor || "").slice(0, 100),
    bodyColor: String(bodyStyle.color || "").slice(0, 100),
    bodyFontFamily: String(bodyStyle.fontFamily || "").slice(0, 200),
    pageCanvasColor,
    direction,
    roleCounts,
    sectionCount: doc.querySelectorAll("section, [role='region']").length,
    formCount: doc.querySelectorAll("form").length,
    imageCount: doc.querySelectorAll("img").length,
    domElementCount: doc.querySelectorAll("*").length,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    tokens,
    typography,
    semanticStyles,
    layoutSamples,
    breakpoints,
    motion,
    geometry,
    content,
    coverage: collectionCoverage,
    assets,
    embeds,
    social,
    hoverStates,
    formActions,
    sectionRects,
    observedInteractions,
    limitations,
  };
  let prunedTokens = tokens;
  let prunedMotion = motion;
  let prunedBreakpoints = breakpoints;
  let prunedContent = content;
  let prunedAssets = assets;
  let prunedHeadings = headings;
  let prunedLinks = links;
  let prunedTypography = typography;
  let prunedObservedInteractions = observedInteractions;
  const capCoverage = (
    source: Record<string, SnapshotCollectionCoverage>,
    key: string,
    emittedCount: number,
    reason: string,
  ): Record<string, SnapshotCollectionCoverage> => ({
    ...source,
    [key]: {
      ...(source[key] || { sourceCount: emittedCount, cap: emittedCount, truncated: false, reason: null }),
      emittedCount,
      truncated: true,
      reason,
    },
  });
  const reducedContent = (caps: { blocks: number; hiddenBlocks: number; controls: number; components: number; sections: number }, reason: string): SnapshotContent => {
    const blocks = content.blocks.slice(0, caps.blocks);
    const hiddenBlocks = content.hiddenBlocks.slice(0, caps.hiddenBlocks);
    const controls = content.controls.slice(0, caps.controls);
    const components = content.components.slice(0, caps.components).map((pattern) => ({
      ...pattern,
      examples: pattern.examples.slice(0, 1),
    }));
    const sections = content.sections.slice(0, caps.sections);
    let coverageMap = content.coverage;
    if (blocks.length < content.blocks.length) coverageMap = capCoverage(coverageMap, "contentBlocks", blocks.length, reason);
    if (hiddenBlocks.length < content.hiddenBlocks.length) coverageMap = capCoverage(coverageMap, "hiddenBlocks", hiddenBlocks.length, reason);
    if (controls.length < content.controls.length) coverageMap = capCoverage(coverageMap, "controls", controls.length, reason);
    if (components.length < content.components.length) coverageMap = capCoverage(coverageMap, "components", components.length, reason);
    if (sections.length < content.sections.length) coverageMap = capCoverage(coverageMap, "sections", sections.length, reason);
    return { ...content, blocks, hiddenBlocks, controls, components, sections, coverage: coverageMap };
  };
  let serialized = JSON.stringify(basePayload).length;
  if (serialized > 350 * 1024) {
    limitations.push("Extraction payload pruned to stay within the 512 KB/page budget; collection coverage identifies reduced fields.");
    prunedTokens = { ...tokens, shadows: tokens.shadows.slice(0, 4), borders: tokens.borders.slice(0, 4), customProperties: tokens.customProperties.slice(0, 20) };
    prunedMotion = { transitions: motion.transitions.slice(0, 10), animations: motion.animations.slice(0, 10), keyframes: motion.keyframes.slice(0, 10) };
    prunedBreakpoints = { mediaQueries: breakpoints.mediaQueries.slice(0, 10) };
    prunedContent = reducedContent({ blocks: 80, hiddenBlocks: 20, controls: 60, components: 12, sections: 10 }, "350 KB warning-budget pruning");
    prunedAssets = assets.slice(0, 50);
    if (prunedAssets.length < assets.length) {
      prunedContent.coverage = capCoverage(prunedContent.coverage, "assets", prunedAssets.length, "350 KB warning-budget pruning");
    }
    prunedHeadings = headings.slice(0, 120);
    prunedLinks = links.slice(0, 300);
    if (prunedHeadings.length < headings.length) prunedContent.coverage = capCoverage(prunedContent.coverage, "headings", prunedHeadings.length, "350 KB warning-budget pruning");
    if (prunedLinks.length < links.length) prunedContent.coverage = capCoverage(prunedContent.coverage, "links", prunedLinks.length, "350 KB warning-budget pruning");
    sectionRects.length = Math.min(sectionRects.length, 3);
    serialized = JSON.stringify({ ...basePayload, headings: prunedHeadings, links: prunedLinks, tokens: prunedTokens, motion: prunedMotion, breakpoints: prunedBreakpoints, content: prunedContent, assets: prunedAssets, sectionRects }).length;
  }
  if (serialized > 512 * 1024) {
    limitations.push("Extraction payload required emergency hard-cap pruning; collection coverage identifies all reduced fields.");
    prunedTokens = { colors: tokens.colors.slice(0, 5), fontSizes: tokens.fontSizes.slice(0, 5), spacing: tokens.spacing.slice(0, 5), radii: [], borders: [], shadows: [], gradients: [], icons: [], customProperties: [] };
    prunedMotion = { transitions: [], animations: [], keyframes: [] };
    prunedBreakpoints = { mediaQueries: [] };
    prunedContent = reducedContent({ blocks: 40, hiddenBlocks: 12, controls: 30, components: 6, sections: 5 }, "512 KB hard-cap emergency pruning");
    prunedAssets = assets.slice(0, 20);
    if (prunedAssets.length < assets.length) {
      prunedContent.coverage = capCoverage(prunedContent.coverage, "assets", prunedAssets.length, "512 KB hard-cap emergency pruning");
    }
    prunedHeadings = headings.slice(0, 50);
    prunedLinks = links.slice(0, 100);
    if (prunedHeadings.length < headings.length) prunedContent.coverage = capCoverage(prunedContent.coverage, "headings", prunedHeadings.length, "512 KB hard-cap emergency pruning");
    if (prunedLinks.length < links.length) prunedContent.coverage = capCoverage(prunedContent.coverage, "links", prunedLinks.length, "512 KB hard-cap emergency pruning");
    prunedTypography = { fontFaces: typography.fontFaces.slice(0, 5), fontFamilies: typography.fontFamilies.slice(0, 5), lineHeights: typography.lineHeights.slice(0, 5), letterSpacings: typography.letterSpacings.slice(0, 5) };
    prunedObservedInteractions = observedInteractions.slice(0, 10);
    if (prunedObservedInteractions.length < observedInteractions.length) {
      prunedContent.coverage = capCoverage(prunedContent.coverage, "interactions", prunedObservedInteractions.length, "512 KB hard-cap emergency pruning");
    }
    sectionRects.length = Math.min(sectionRects.length, 2);
    serialized = JSON.stringify({ ...basePayload, headings: prunedHeadings, links: prunedLinks, tokens: prunedTokens, typography: prunedTypography, semanticStyles: semanticStyles.slice(0, 5), layoutSamples: layoutSamples.slice(0, 5), motion: prunedMotion, breakpoints: prunedBreakpoints, content: prunedContent, assets: prunedAssets, sectionRects, observedInteractions: prunedObservedInteractions }).length;
  }

  // A pathological hostname, role map, or accumulated limitation list must
  // never leak an over-cap payload. This final bounded fallback records that
  // the page was severely reduced while preserving parseable structural data.
  if (serialized > 512 * 1024) {
    prunedHeadings = headings.slice(0, 20);
    prunedLinks = links.slice(0, 20).map((link) => ({ ...link, href: link.href.slice(0, 160), text: link.text.slice(0, 80) }));
    prunedContent = reducedContent({ blocks: 12, hiddenBlocks: 4, controls: 10, components: 3, sections: 2 }, "final payload hard-cap fallback");
    prunedAssets = assets.slice(0, 5);
    prunedObservedInteractions = observedInteractions.slice(0, 3);
    limitations.splice(20);
    limitations.push("Final emergency reduction applied to keep the page observation below 512 KB.");
  }

  const buildFinalCoverage = (
    finalHeadings: RawHeading[],
    finalLinks: RawLink[],
    finalTokens: SnapshotTokens,
    finalTypography: SnapshotTypography,
    finalBreakpoints: SnapshotBreakpoints,
    finalMotion: SnapshotMotion,
    finalGeometry: SnapshotGeometry,
    finalContent: SnapshotContent,
    finalAssets: SnapshotAsset[],
    finalSectionRectCount: number,
  ): Record<string, SnapshotCollectionCoverage> => ({
    ...collectionCoverage,
    ...finalContent.coverage,
    headings: coverage(doc.querySelectorAll("h1, h2, h3, h4, h5, h6").length, finalHeadings.length, maxHeadings, finalHeadings.some((heading) => heading.truncated), "hidden headings were omitted"),
    links: coverage(anchorSourceCount, finalLinks.length, maxLinks, false, "hidden, inaccessible, or capped links were omitted", Math.max(0, linkCandidatesScanned - sourceLinkHrefs.size)),
    "tokens.colors": coverage(Object.keys(colorFreq).length, finalTokens.colors.length, 15),
    "tokens.fontSizes": coverage(Object.keys(fontSizeFreq).length, finalTokens.fontSizes.length, 10),
    "tokens.spacing": coverage(Object.keys(spacingFreq).length, finalTokens.spacing.length, 8),
    "tokens.radii": coverage(Object.keys(radiiFreq).length, finalTokens.radii.length, 8),
    "tokens.borders": coverage(Object.keys(borderFreq).length, finalTokens.borders.length, 8),
    "tokens.shadows": coverage(Object.keys(shadowFreq).length, finalTokens.shadows.length, 8),
    "tokens.gradients": coverage(Object.keys(gradientFreq).length, finalTokens.gradients.length, 8),
    "tokens.customProperties": coverage(customPropertySourceCount, finalTokens.customProperties.length, 50),
    "typography.fontFaces": coverage(fontFaceSourceCount, finalTypography.fontFaces.length, 20),
    "typography.fontFamilies": coverage(Object.keys(fontFamilyFreq).length, finalTypography.fontFamilies.length, 8),
    "typography.lineHeights": coverage(Object.keys(lineHeightFreq).length, finalTypography.lineHeights.length, 8),
    "typography.letterSpacings": coverage(Object.keys(letterSpacingFreq).length, finalTypography.letterSpacings.length, 8),
    "responsive.mediaQueries": coverage(mediaQuerySourceCount, finalBreakpoints.mediaQueries.length, 20),
    "motion.transitions": coverage(transitionSourceCount, finalMotion.transitions.length, 20),
    "motion.animations": coverage(animationSourceCount, finalMotion.animations.length, 20),
    "motion.keyframes": coverage(keyframeSourceCount, finalMotion.keyframes.length, 20),
    "geometry.containerWidths": coverage(Object.keys(widthFreq).length, finalGeometry.containerWidths.length, 8),
    "screenshots.sectionRects": coverage(sectionNodesForContent.length, finalSectionRectCount, 6, false, "sections without a capturable bounding box were omitted"),
    "components.patterns": finalContent.coverage.components || collectionCoverage["components.patterns"]!,
    "content.blocks": finalContent.coverage.contentBlocks || collectionCoverage["content.blocks"]!,
    "content.hiddenBlocks": finalContent.coverage.hiddenBlocks || collectionCoverage["content.hiddenBlocks"]!,
    "content.nodesScanned": finalContent.coverage.contentNodesScanned || collectionCoverage["content.nodesScanned"]!,
    "content.controls": finalContent.coverage.controls || collectionCoverage["content.controls"]!,
    "content.sections": finalContent.coverage.sections || collectionCoverage["content.sections"]!,
    assets: finalContent.coverage.assets || collectionCoverage.assets!,
  });

  let finalPayload = {
    ...basePayload,
    headings: prunedHeadings,
    links: prunedLinks,
    tokens: prunedTokens,
    typography: prunedTypography,
    semanticStyles: semanticStyles.slice(0, serialized > 350 * 1024 ? 5 : 8),
    layoutSamples: layoutSamples.slice(0, serialized > 350 * 1024 ? 5 : 8),
    breakpoints: prunedBreakpoints,
    motion: prunedMotion,
    geometry,
    content: prunedContent,
    coverage: buildFinalCoverage(prunedHeadings, prunedLinks, prunedTokens, prunedTypography, prunedBreakpoints, prunedMotion, geometry, prunedContent, prunedAssets, sectionRects.length),
    assets: prunedAssets,
    sectionRects,
    observedInteractions: prunedObservedInteractions,
    limitations: limitations.slice(0, 30).map((entry) => String(entry).slice(0, 300)),
  };
  let payloadBytes = 0;
  for (let pass = 0; pass < 3; pass += 1) {
    payloadBytes = JSON.stringify({ ...finalPayload, payloadBytes }).length;
  }
  if (payloadBytes > 512 * 1024) {
    limitations.splice(0, limitations.length, "Final emergency reduction applied to keep the page observation below 512 KB.");
    finalPayload = {
      ...basePayload,
      url: basePayload.url.slice(0, 300),
      title: basePayload.title.slice(0, 120),
      metaDescription: basePayload.metaDescription?.slice(0, 180) || null,
      lang: basePayload.lang,
      headings: headings.slice(0, 12).map((heading) => ({ ...heading, text: heading.text.slice(0, 240), truncated: true })),
      links: links.slice(0, 20).map((link) => ({ ...link, href: link.href.slice(0, 120), text: link.text.slice(0, 60) })),
      bodyBackgroundColor: basePayload.bodyBackgroundColor.slice(0, 40),
      bodyColor: basePayload.bodyColor.slice(0, 40),
      bodyFontFamily: basePayload.bodyFontFamily.slice(0, 80),
      roleCounts: Object.fromEntries(Object.entries(roleCounts).slice(0, 10)),
      tokens:         { colors: tokens.colors.slice(0, 3), fontSizes: tokens.fontSizes.slice(0, 3), spacing: tokens.spacing.slice(0, 3), radii: [], borders: [], shadows: [], gradients: [], icons: [], customProperties: [] },
      typography: { fontFaces: typography.fontFaces.slice(0, 2), fontFamilies: [], lineHeights: [], letterSpacings: [] },
      semanticStyles: semanticStyles.slice(0, 2),
      layoutSamples: layoutSamples.slice(0, 2),
      breakpoints: { mediaQueries: [] },
      motion: { transitions: [], animations: [], keyframes: [] },
      geometry: { containerWidths: geometry.containerWidths.slice(0, 3), sampledElements: geometry.sampledElements },
      content: reducedContent({ blocks: 8, hiddenBlocks: 3, controls: 5, components: 2, sections: 1 }, "final payload hard-cap fallback"),
      assets: assets.slice(0, 2),
      sectionRects: sectionRects.slice(0, 1),
      observedInteractions: observedInteractions.slice(0, 2),
      limitations: ["Final emergency reduction applied to keep the page observation below 512 KB."],
      coverage: buildFinalCoverage(
        headings.slice(0, 12),
        links.slice(0, 20),
        { colors: tokens.colors.slice(0, 3), fontSizes: tokens.fontSizes.slice(0, 3), spacing: tokens.spacing.slice(0, 3), radii: [], borders: [], shadows: [], gradients: [], icons: [], customProperties: [] },
        { fontFaces: typography.fontFaces.slice(0, 2), fontFamilies: [], lineHeights: [], letterSpacings: [] },
        { mediaQueries: [] },
        { transitions: [], animations: [], keyframes: [] },
        { containerWidths: geometry.containerWidths.slice(0, 3), sampledElements: geometry.sampledElements },
        reducedContent({ blocks: 8, hiddenBlocks: 3, controls: 5, components: 2, sections: 1 }, "final payload hard-cap fallback"),
        assets.slice(0, 2),
        Math.min(sectionRects.length, 1),
      ),
    };
    payloadBytes = 0;
    for (let pass = 0; pass < 3; pass += 1) {
      payloadBytes = JSON.stringify({ ...finalPayload, payloadBytes }).length;
    }
  }
  return { ...finalPayload, payloadBytes };
}
