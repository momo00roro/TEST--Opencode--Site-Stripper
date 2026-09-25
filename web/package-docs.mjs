const MAX_DOCUMENTATION_BYTES = 24 * 1024 * 1024;

const md = (value) => String(value ?? "")
  .replace(/\\/g, "\\\\")
  .replace(/([`*_\[\]])/g, "\\$1")
  .replace(/^(#{1,6} |[>\-+] )/gm, "\\$1");

// Code-span content needs no Markdown escaping: inside backticks every
// character is literal, so escaping parens/pipes there only adds noise.
const code = (value) => String(value ?? "").replace(/\\/g, "\\\\").replace(/`/g, "\\`");

// Fenced code blocks for preformatted evidence; tilde fences when the
// sample itself contains backtick fences.
const fence = (text) => {
  const fenceChars = String(text ?? "").includes("```") ? "~~~" : "```";
  return `${fenceChars}\n${text}\n${fenceChars}`;
};

const json = (value) => JSON.stringify(value, null, 2);
const slug = (path, fallback = "page") => {
  if (path === "/") return "home";
  return String(path || "").replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9/_-]+/g, "-").replace(/\/+?/g, "-").toLowerCase().slice(0, 60) || fallback;
};
const uniqueBy = (values, keyFn) => {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFn(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function cleanPage(page) {
  return {
    ...page,
    screenshot: page.screenshot ? Object.fromEntries(Object.entries(page.screenshot).filter(([key]) => key !== "dataUrl")) : null,
    mobileScreenshot: page.mobileScreenshot ? Object.fromEntries(Object.entries(page.mobileScreenshot).filter(([key]) => key !== "dataUrl")) : null,
    sectionShots: (page.sectionShots || []).map((shot) => Object.fromEntries(Object.entries(shot).filter(([key]) => key !== "dataUrl"))),
  };
}

function tokenInventory(pages) {
  const categories = ["colors", "fontSizes", "spacing", "radii", "borders", "shadows", "gradients", "icons", "customProperties"];
  // CSS-wide keywords and element defaults are inheritance noise, not design
  // decisions. The extractor already drops most of these; this second filter
  // keeps older captures (and any stragglers) out of the rendered palette.
  const nonTokenValues = new Set(["inherit", "initial", "unset", "revert", "revert-layer", "none", "transparent", "medium", "0px none", "0px solid"]);
  const transparentBlack = /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/i;
  const combined = {};
  for (const category of categories) {
    const byValue = new Map();
    for (const page of pages) {
      for (const token of page.tokens?.[category] || []) {
        const value = typeof token === "string" ? token : token.value;
        const identity = category === "customProperties" && typeof token !== "string" ? token.name : value;
        if (!value || !identity) continue;
        // Same second filter as the extractor: stale captures and
        // declaration artifacts (e.g. "!important") never reach the docs.
        if (category !== "customProperties" && (nonTokenValues.has(String(value).toLowerCase()) || transparentBlack.test(String(value)) || String(value).includes("!important"))) continue;
        const current = byValue.get(identity) || { value, name: category === "customProperties" && typeof token !== "string" ? token.name : null, count: 0, source: token.source || "observed", confidence: token.confidence || "unknown", pages: [] };
        current.count += Number(token.count || 1);
        if (!current.pages.includes(page.path)) current.pages.push(page.path);
        if (current.confidence !== token.confidence) current.confidence = "inferred";
        byValue.set(identity, current);
      }
    }
    combined[category] = [...byValue.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }
  return combined;
}

function w3cTokens(inventory, analysis) {
  const output = { $meta: { schemaVersion: analysis.schemaVersion, sourceUrl: analysis.request.url, note: "Observed/inferred tokens across selected pages; not an exhaustive design-system declaration." } };
  const typeMap = { colors: "color", fontSizes: "fontSize", spacing: "dimension", radii: "dimension", borders: "border", shadows: "shadow" };
  for (const [category, entries] of Object.entries(inventory)) {
    const values = {};
    for (const [index, token] of entries.entries()) {
        values[`token-${index + 1}`] = {
        value: token.value,
        type: typeMap[category] || "other",
        description: `${token.source}/${token.confidence}; observed on ${token.pages.join(", ")}`,
        extensions: { source: token.source, confidence: token.confidence, count: token.count, pages: token.pages, ...(token.name ? { name: token.name } : {}) },
      };
    }
    output[category] = values;
  }
  output.semanticSamples = analysis.pages.flatMap((page) => (page.semanticStyles || []).map((sample) => ({ ...sample, page: page.path })));
  output.typography = analysis.pages.map((page) => ({ page: page.path, ...page.typography }));
  return output;
}

function themeFiles(inventory, pages) {
  const vars = [];
  const cssCategories = [
    ["colors", "color"], ["fontSizes", "font-size"], ["spacing", "spacing"],
    ["radii", "radius"], ["borders", "border"], ["shadows", "shadow"], ["gradients", "gradient"],
  ];
  for (const [category, name] of cssCategories) {
    inventory[category].forEach((token, index) => vars.push(`  --${name}-${index + 1}: ${token.value}; /* ${token.source}/${token.confidence}; ${token.count} observation${token.count === 1 ? "" : "s"} */`));
  }
  for (const token of inventory.customProperties) {
    if (/^--[a-zA-Z0-9_-]+$/.test(token.name || "") && !/[;{}]/.test(token.value)) {
      vars.push(`  ${token.name}: ${token.value}; /* observed custom property */`);
    }
  }
  const firstFace = pages.flatMap((page) => page.typography?.fontFaces || [])[0]?.family?.replace(/["'\\;]/g, "") || "";
  vars.push(firstFace ? `  --font-family-base: ${firstFace}, system-ui, sans-serif;` : `  --font-family-base: system-ui, sans-serif;`);
  const theme = `:root {\n${vars.join("\n")}\n}\n`;
  const extend = (category, key) => Object.fromEntries(inventory[category].map((token, index) => [`${key}-${index + 1}`, token.value]));
  const tailwind = `module.exports = {\n  theme: { extend: {\n    colors: ${JSON.stringify(extend("colors", "color"), null, 6)},\n    fontSize: ${JSON.stringify(extend("fontSizes", "size"), null, 6)},\n    spacing: ${JSON.stringify(extend("spacing", "space"), null, 6)},\n    borderRadius: ${JSON.stringify(extend("radii", "radius"), null, 6)},\n    boxShadow: ${JSON.stringify(extend("shadows", "shadow"), null, 6)},\n    backgroundImage: ${JSON.stringify(extend("gradients", "gradient"), null, 6)},\n  } },\n};\n`;
  return { theme, tailwind };
}

// Builder/stack detection from asset URL fingerprints plus the generator
// meta as fallback. A generator value alone can mislead (e.g. a WordPress
// SEO plugin), so asset evidence always takes precedence in the wording.
function detectStack(pages, social) {
  const haystack = pages.flatMap((page) => [
    ...(page.assets || []).map((asset) => asset.url || ""),
    ...(page.content?.controls || []).map((control) => control.href || ""),
  ]).join("\n").toLowerCase();
  const generator = String(social?.generator || "");
  const marks = [];
  if (haystack.includes("wp-content") || haystack.includes("wp-includes")) marks.push("WordPress (wp-content/wp-includes assets)");
  if (haystack.includes("/_next/")) marks.push("Next.js (_next assets)");
  if (haystack.includes("cdn.shopify") || haystack.includes("myshopify.com")) marks.push("Shopify (shopify CDN assets)");
  if (haystack.includes("framerusercontent.com") || haystack.includes("framer.com")) marks.push("Framer (framer assets)");
  if (haystack.includes("webflow") || haystack.includes("wized")) marks.push("Webflow (webflow assets)");
  if (haystack.includes("squarespace")) marks.push("Squarespace (squarespace assets)");
  if (haystack.includes("wixstatic") || haystack.includes("wix.com")) marks.push("Wix (wix assets)");
  if (/next\.js/i.test(generator)) marks.push("Next.js (generator meta)");
  if (/wordpress/i.test(generator)) marks.push("WordPress (generator meta)");
  return { marks, generator };
}

function shotExt(kind) {
  return kind === "jpeg" ? "jpg" : kind || "webp";
}

function shotPath(page, variant, index, shot) {
  const base = slug(page.path);
  const ext = shotExt(shot.kind);
  if (variant === "desktop") return `screenshots/desktop/${base}.${ext}`;
  if (variant === "mobile") return `screenshots/mobile/${base}.${ext}`;
  return `screenshots/sections/${base}-${index + 1}.${ext}`;
}

function shotManifest(pages, binaryPaths) {
  const shots = [];
  const add = (page, variant, index, shot, path) => {
    if (!shot) return;
    shots.push({ page: page.path, variant, ...(index === null ? {} : { index }), kind: shot.kind, bytes: shot.bytes, width: shot.width, height: shot.height, hasBinary: binaryPaths.has(path), zipPath: path });
  };
  for (const page of pages) {
    add(page, "desktop", null, page.screenshot, page.screenshot ? shotPath(page, "desktop", null, page.screenshot) : "");
    add(page, "mobile", null, page.mobileScreenshot, page.mobileScreenshot ? shotPath(page, "mobile", null, page.mobileScreenshot) : "");
    (page.sectionShots || []).forEach((shot, index) => add(page, "section", index, shot, shotPath(page, "section", index, shot)));
  }
  return { shots, note: "hasBinary reflects the screenshot binary present in this downloaded client-side ZIP; false means metadata-only capture." };
}

// Maps frequency-ranked tokens to the roles an AI rebuilder actually needs:
// page background, body text, headings, and buttons. Sourced from the
// per-role computed-style samples, never inferred from frequency order.
function keyRoles(pages, inventory) {
  const samples = pages.flatMap((page) => (page.semanticStyles || []).map((sample) => ({ ...sample, path: page.path })));
  // Prefer the largest-area sample per role: the first match can be a
  // 1px skip-link while the representative control is far bigger.
  const areas = new Map();
  for (const page of pages) {
    for (const sample of page.layoutSamples || []) {
      areas.set(`${page.path}|${sample.role}`, (sample.width || 0) * (sample.height || 0));
    }
  }
  const pick = (roles) => samples
    .filter((sample) => roles.includes(sample.role))
    .sort((a, b) => (areas.get(`${b.path}|${b.role}`) || 0) - (areas.get(`${a.path}|${a.role}`) || 0))[0];
  const lines = [];
  const body = pick(["body-copy"]);
  if (body) {
    let line = `- Body text: \`${code(body.color)}\` on \`${code(body.backgroundColor)}\` — ${md(body.fontFamily)} ${code(body.fontSize)} / ${code(body.lineHeight)} (observed body-copy sample on \`${code(body.path)}\`)`;
    // Dark sites paint the canvas on :root/html, leaving body transparent.
    // Evidence order is strict: directly sampled root color first, then an
    // exactly-named canvas variable. Anything fuzzier is listed only as an
    // unverified candidate — never asserted as the canvas.
    if (/^(transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\))$/i.test(String(body.backgroundColor || ""))) {
      const owner = pages.find((page) => page.path === body.path);
      const strictCanvas = (inventory?.customProperties || []).find((token) => /^--(color-)?(canvas|background|bg)$/i.test(token.name || ""));
      if (owner?.pageCanvasColor) line += ` — body itself is transparent; page canvas sampled on root: \`${code(owner.pageCanvasColor)}\``;
      else if (strictCanvas) line += ` — body itself is transparent; page canvas is \`${code(strictCanvas.name)}\`: \`${code(strictCanvas.value)}\` (observed custom property)`;
      else {
        const seen = new Set();
        const candidates = (inventory?.colors || [])
          .map((token) => token.value)
          .filter((value) => /var\(--[^)]*(background|canvas|bg)[^)]*\)/i.test(String(value)) && !seen.has(value) && (seen.add(value), true))
          .slice(0, 3);
        line += " — body itself is transparent; page background not observed"
          + (candidates.length > 0 ? `; canvas-like variables to verify against the live page: ${candidates.map((value) => `\`${code(value)}\``).join(", ")}` : "");
      }
    }
    lines.push(line);
  }
  const heading = pick(["heading-1", "heading-2"]);
  if (heading) lines.push(`- Headings: \`${code(heading.color)}\` — ${md(heading.fontFamily)} ${code(heading.fontSize)}, weight ${code(heading.fontWeight)} (observed ${code(heading.role)} sample on \`${code(heading.path)}\`)`);
  const button = pick(["button"]);
  if (button) lines.push(`- Buttons: text \`${code(button.color)}\` on \`${code(button.backgroundColor)}\` — ${code(button.fontSize)}, weight ${code(button.fontWeight)} (observed button sample on \`${code(button.path)}\`)`);
  const link = pick(["link"]);
  if (link) lines.push(`- Links: \`${code(link.color)}\` (observed link sample on \`${code(link.path)}\`)`);
  const nav = pick(["navigation"]);
  if (nav) lines.push(`- Navigation: text \`${code(nav.color)}\` on \`${code(nav.backgroundColor)}\` (observed navigation sample on \`${code(nav.path)}\`)`);
  return lines;
}

// Page-level and content-level coverage use different key styles for the
// same collections ("content.blocks" vs "contentBlocks"). Merging both
// naively prints every collection twice, so dedupe by normalized key.
// Canonical spellings for coverage keys: content-level camelCase twins
// ("contentBlocks") are the same objects as the dotted page-level keys
// ("content.blocks"), so render one consistent spelling per collection.
const canonicalCoverageNames = {
  blocks: "content.blocks",
  nodesscanned: "content.nodesScanned",
  hiddenblocks: "content.hiddenBlocks",
  controls: "content.controls",
  sections: "content.sections",
  components: "components.patterns",
};

function coverageList(page) {
  const entries = Object.entries({ ...(page.coverage || {}), ...(page.content?.coverage || {}) });
  const seen = new Set();
  const out = [];
  for (const [name, item] of entries) {
    const norm = name.replace(/^content\.?/i, "").toLowerCase();
    const canonical = canonicalCoverageNames[norm] ?? name;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push([canonical, item]);
  }
  return out;
}

function pageMarkdown(page) {
  const blocks = page.content?.blocks || [];
  const hiddenBlocks = page.content?.hiddenBlocks || [];
  const content = blocks.map((block) => {
    const text = `${md(block.text)}${block.truncated ? " _(clipped at the observed text cap)_" : ""}`;
    if (block.kind === "heading") return `${"#".repeat(Math.min(Math.max(block.headingLevel || 2, 1), 6))} ${text}`;
    if (block.kind === "list-item") return `- ${text}`;
    if (block.kind === "blockquote") return `> ${text}`;
    if (block.kind === "code") return `${fence(code(block.text))}${block.truncated ? "\n\n_(clipped at the observed text cap)_" : ""}`;
    if (block.kind === "table") return `${block.text}${block.truncated ? "\n\n_(table clipped at the observed text cap)_" : ""}`;
    return text;
  }).join("\n\n");
  const controls = page.content?.controls || [];
  const forms = controls.filter((control) => ["input", "textarea", "select"].includes(control.kind));
  const buttons = controls.filter((control) => control.kind === "button");
  const nav = page.nav || { header: [], primary: [], footer: [] };
  const coverage = coverageList(page);
  const sections = (page.sections || []).map((section, index) => `### Section ${index + 1}: ${md(section.heading || "(unheaded)")}\n\nRole: ${md(section.role)}\n\n${md(section.textExcerpt)}`).join("\n\n");
  return `# ${md(page.title)}\n\nPath: ${md(page.path)}  \nType: ${md(page.pageType)}  \nURL: ${md(page.url)}${page.lang ? `  \nLanguage: ${md(page.lang)}` : ""}${page.direction ? `  \nDirection: ${md(page.direction)}` : ""}\n${page.metaDescription ? `\nMeta description: ${md(page.metaDescription)}\n` : ""}\n## Content in source order\n\n${content || "(no semantic text blocks captured)"}\n\n## Initially hidden or collapsed text\n\n${hiddenBlocks.map((block) => `- **${md(block.initialState)} / ${md(block.kind)}** ${md(block.text)}${block.truncated ? " _(clipped at the hidden-text cap)_" : ""}`).join("\n") || "(no hidden semantic copy captured)"}\n\nThis text was present in the captured DOM but was not initially visible; no controls were activated.\n\n## Section observations\n\n${sections || "(no semantic sections captured)"}\n\n## Controls and forms\n\n${controls.map((control) => `- **${md(control.kind)}** ${md(control.label || "(unlabelled)")}${control.type ? ` — type: ${md(control.type)}` : ""}${control.required ? " — required" : ""}${control.disabled ? " — disabled" : ""}${control.href ? ` — ${md(control.href)}` : ""}${control.placeholder ? ` — placeholder: ${md(control.placeholder)}` : ""}${control.options?.length ? ` — options: ${control.options.map(md).join(", ")}` : ""}${control.ariaExpanded ? ` — expanded: ${md(control.ariaExpanded)}` : ""}${control.open ? " — open" : ""}`).join("\n") || "(no controls captured)"}\n\nButtons/CTAs: ${buttons.length}; form controls: ${forms.length}.${(page.formActions || []).length > 0 ? ` Same-origin form endpoints (never submitted): ${(page.formActions || []).map((endpoint) => `\`${code(endpoint)}\``).join(", ")}.` : ""}\n\n## Repeated component patterns\n\n${(page.content?.components || []).map((pattern) => `- ${md(pattern.kind)} × ${pattern.count}: ${md(pattern.signature)}; examples: ${(pattern.examples || []).map(md).join("; ")}`).join("\n") || "(none observed)"}\n\n## Observed navigation\n\n${["header", "primary", "footer"].flatMap((area) => (nav[area] || []).map((link) => `- ${area}: ${md(link.text)} — ${md(link.href)}`)).join("\n") || "(none observed)"}\n\n## Capture coverage\n\n${coverage.map(([name, item]) => `- ${md(name)}: ${item.emittedCount}/${item.sourceCount} emitted (cap ${item.cap})${item.truncated ? ` — partial: ${md(item.reason || "truncated")}` : " — complete within observation cap"}`).join("\n") || "(coverage metadata unavailable)"}\n`;
}

function renderMarkdown(analysis, inventory, assets, manifest) {
  const pages = analysis.pages || [];
  const stackInfo = detectStack(pages, pages[0]?.social);
  const stackGenFirst = String(stackInfo.generator || "").split(/\s+/)[0] || "";
  const pageRows = pages.map((page) => `- [${md(page.title)}](${`pages/${slug(page.path)}.md`}) — \`${code(page.path)}\` — priority ${page.priority ?? "unknown"}`);
  const categoryRows = Object.entries(inventory).map(([name, values]) => `- ${name}: ${values.length} observed values`);
  const tokenRows = Object.entries(inventory).flatMap(([category, values]) => values.map((value) => `- ${category}${value.name ? ` (${code(value.name)})` : ""}: \`${code(value.value)}\` — ${value.count} observation${value.count === 1 ? "" : "s"}; ${md(value.confidence)} on ${value.pages.map((page) => `\`${code(page)}\``).join(", ")}`));
  const allBlocks = pages.flatMap((page) => (page.content?.blocks || []).map((block) => block.kind === "code" ? `### ${md(page.path)} — ${md(block.kind)}\n\n${fence(code(block.text))}` : block.kind === "table" ? `### ${md(page.path)} — ${md(block.kind)}\n\n${block.text}` : `### ${md(page.path)} — ${md(block.kind)}\n\n${md(block.text)}`));
  const hiddenBlocks = pages.flatMap((page) => (page.content?.hiddenBlocks || []).map((block) => `### ${md(page.path)} — ${md(block.initialState)} ${md(block.kind)}\n\n${md(block.text)}`));
  const interactions = pages.flatMap((page) => (page.observedInteractions || []).map((item) => `- ${md(page.path)} — ${md(item.kind)}: ${md(item.detail)}`));
  const motion = pages.map((page) => `## ${md(page.path)}\n\nTransitions:\n${(page.motion?.transitions || []).map((item) => `- ${md(item.property)} — ${md(item.duration)} ${md(item.easing)} delay ${md(item.delay)}`).join("\n") || "- none observed"}\n\nAnimations:\n${(page.motion?.animations || []).map((item) => `- ${md(item.name)} — ${md(item.duration)} ${md(item.easing)} delay ${md(item.delay)}`).join("\n") || "- none observed"}\n\nKeyframes: ${(page.motion?.keyframes || []).map(md).join(", ") || "none observed"}`).join("\n\n");
  const hover = pages.map((page) => `## ${md(page.path)}\n\n${(page.hoverStates || []).map((state) => `- ${code(state.trigger)} \`${code(state.selector)}\` → ${(state.changedProperties || []).map(code).join(", ") || "unspecified changes"}`).join("\n") || "- no hover/focus/active rules observed"}`).join("\n\n");
  const responsive = pages.map((page) => {
    const comparison = page.responsiveComparison;
    return `## ${md(page.path)}\n\nStatus: ${md(comparison?.status || "unknown")}${comparison?.status === "dom-only" ? " — DOM comparison from an extract-only 390px pass; no mobile screenshot" : ""}\n\nDesktop: ${comparison?.desktopViewport?.width || page.viewport?.width || "unknown"}×${comparison?.desktopViewport?.height || page.viewport?.height || "unknown"}; mobile: ${comparison?.mobileViewport ? `${comparison.mobileViewport.width}×${comparison.mobileViewport.height}` : "not captured"}.\n\n${md(comparison?.note || "No comparison available.")}\n\n${(comparison?.layoutChanges || []).filter((item) => item.changed).map((item) => `- ${md(item.role)}: ${item.desktop ? `${item.desktop.width}×${item.desktop.height} ${md(item.desktop.display)} columns ${md(item.desktop.columns)}` : "not present"} → ${item.mobile ? `${item.mobile.width}×${item.mobile.height} ${md(item.mobile.display)} columns ${md(item.mobile.columns)}` : "not present"}`).join("\n") || "No differences in the sampled layout roles."}`;
  }).join("\n\n");
  const assetLines = assets.map((asset) => `- [${md(asset.kind)}] ${md(asset.url)} — ${md(asset.alt)} (used on ${md(asset.usedOn)})${(asset.kind === "video" || asset.kind === "audio") && asset.readyState != null && asset.readyState < 2 ? " — first frame not ready at capture" : ""}`);
  const embedLines = pages.flatMap((page) => (page.embeds || []).map((embed) => `- [${md(embed.kind)}] ${md(embed.domain)} — ${md(embed.url)}${embed.title ? ` — "${md(embed.title)}"` : ""} (embedded on ${md(page.path)})`));
  const pageEmbeds = pages.flatMap((page) => (page.embeds || []).map((embed) => ({ ...embed, embeddedOn: page.path })));
  const coverage = pages.flatMap((page) => coverageList(page).map(([key, item]) => `- ${md(page.path)} / ${md(key)}: ${item.emittedCount}/${item.sourceCount}; cap ${item.cap}${item.deduplicatedCount ? `; ${item.deduplicatedCount} collapsed` : ""}; ${item.truncated ? `partial (${md(item.reason || "truncated")})` : "complete within cap"}`));
  const docs = {
    "README.md": `# Website analysis — ${md(analysis.request.hostname)}\n\nSource: ${md(analysis.request.url)}  \nPages: ${analysis.pagesAnalyzed}/${analysis.pagesSelected} selected; ${analysis.pagesDiscovered} discovered  \nScreenshot captures: ${analysis.screenshotsCaptured}; binaries included: ${manifest.shots.filter((shot) => shot.hasBinary).length}/${manifest.shots.length}  \nBrowser time: ${analysis.browserSecondsUsed}s  \nObservation status: ${analysis.integrityPassed ? "valid" : "partial/failed"}\n\n## Analyzed pages\n\n${pageRows.join("\n")}\n\n## Important interpretation\n\nJSON records are canonical bounded observations. Samples are evidence, not exhaustive CSS or interaction replay. See \`data/report.json\` for caps, omissions, warnings, and confidence.\n`,
    "website-overview.md": `# Website overview\n\n${md(pages[0]?.title || analysis.request.hostname)} at ${md(analysis.request.url)}.\n${pages[0]?.social?.ogTitle ? `\nShare title: ${md(pages[0].social.ogTitle)}\n` : ""}${pages[0]?.social?.ogDescription ? `\nShare description: ${md(pages[0].social.ogDescription)}\n` : ""}${stackInfo.marks.length > 0 || stackInfo.generator ? `\nDetected stack: ${stackInfo.marks.join("; ") || "unknown"}${stackInfo.generator && !stackInfo.marks.join(" ").toLowerCase().includes(stackGenFirst.toLowerCase()) ? ` — generator meta: ${md(stackInfo.generator)}` : ""}\n` : ""}${pages[0]?.social?.themeColor ? `\nTheme color: \`${code(pages[0].social.themeColor)}\`\n` : ""}\n${pageRows.join("\n")}\n\nObserved primary navigation is in \`data/navigation.json\`; observed affordances are in \`data/interactions.json\`.\n`,
    "information-architecture.md": `# Information architecture\n\n${pages.map((page) => `## ${md(page.title)} (\`${code(page.path)}\`)\n\n${(page.headings || []).map((heading) => `${"#".repeat(Math.min(Math.max(heading.level, 1), 6))} ${md(heading.text)}${heading.truncated ? " _(heading clipped; see capture coverage)_" : ""}`).join("\n")}\n`).join("\n")}`,
    "design-tokens.md": `# Design tokens\n\nTokens are frequency-ranked observations across the selected pages, with source/confidence. Values are not asserted to be a complete design system.\n\n## Key observed roles\n\n${keyRoles(pages, inventory).join("\n") || "No semantic style samples observed."}\n\n## All observed values\n\n${categoryRows.join("\n")}\n\n${tokenRows.join("\n") || "No token values observed."}\n\nSemantic samples by page/role are in \`data/tokens.json\`.\n`,
    "typography.md": `# Typography\n\nTypeface usage is ranked from computed-style sampling (inferred confidence); \`@font-face\` declarations are observed where stylesheets are accessible.\n\n${pages.map((page) => `## ${md(page.path)}\n\nFont faces:\n${(page.typography?.fontFaces || []).map((face) => `- ${md(face.family)} — ${md(face.weight)}; ${md(face.src)}`).join("\n") || "- none observed"}\n\nTypefaces in use:\n${(page.typography?.fontFamilies || []).map((entry) => `- \`${code(entry.value)}\` — ${entry.count} sampled elements; ${code(entry.confidence)}`).join("\n") || "- none observed"}\n\nSemantic samples:\n${(page.semanticStyles || []).map((sample) => `- ${md(sample.role)}: ${md(sample.fontFamily)} ${md(sample.fontSize)} / ${md(sample.lineHeight)}, weight ${md(sample.fontWeight)}, tracking ${md(sample.letterSpacing)}`).join("\n") || "- none observed"}`).join("\n\n")}\n`,
    "content-style.md": `# Content and voice\n\nTone summaries are page-level heuristics. Verbatim visible text is below; inspect \`data/pages.json\` for order, roles, controls, and per-collection completeness. Initially hidden/collapsed DOM copy is separately labelled and was not treated as visible or activated.\n\n${allBlocks.join("\n\n") || "No content blocks observed."}\n\n## Initially hidden or collapsed copy\n\n${hiddenBlocks.join("\n\n") || "No hidden semantic copy observed."}\n`,
    "imagery-and-video.md": `# Imagery and video\n\nAssets (${assets.length} listed of ${analysis.assetCount} observed):\n\n${assetLines.join("\n") || "No media assets observed."}\n\nAll media entries are URL references; binaries are not fetched. Motion note: videos are URL references and canvas scenes are single static frames — treat screenshots of those regions as posters, not the experience.\n\n## Embedded frames\n\n${embedLines.join("\n") || "No embedded frames observed."}\n`,
    "motion-and-interactions.md": `# Motion and interactions\n\nTransitions, animations, and keyframe names are computed/CSSOM observations; JavaScript-driven interactions were not replayed.\n\n${motion}\n\n## Hover and focus states\n\nDeclared hover/focus/active rules are static CSS evidence of state changes; nothing was hovered or activated during capture.\n\n${hover}\n\n## Interaction affordances\n\n${interactions.join("\n") || "None detected."}\n\nBehavior was not clicked or replayed. Structured controls and ARIA relationships are in \`data/interactions.json\`.\n`,
    "responsive-behavior.md": `# Responsive behavior\n\nEvidence is limited to CSS media queries plus actual desktop/mobile observations where mobile capture succeeded.\n\nMobile comparison with screenshots: ${pages.filter((page) => page.responsiveComparison?.status === "captured").map((page) => `\`${code(page.path)}\``).join(", ") || "none"}. DOM-only comparison (extract-only 390px pass, no screenshot): ${pages.filter((page) => page.responsiveComparison?.status === "dom-only").map((page) => `\`${code(page.path)}\``).join(", ") || "none"}. No comparison: ${pages.filter((page) => page.responsiveComparison?.status !== "captured" && page.responsiveComparison?.status !== "dom-only").map((page) => `\`${code(page.path)}\` (${code(page.responsiveComparison?.status || "unknown")})`).join(", ") || "none"}. Screenshot binaries are limited to the homepage plus one representative page by the Free-tier screenshot budget; DOM-only passes cost browser time instead of bytes.\n\n${pages.map((page) => `## ${md(page.path)}\n\n${(page.breakpoints?.mediaQueries || []).map((entry) => `- ${md(entry.query)} → ${entry.changedProperties.map(md).join(", ")}`).join("\n") || "No accessible media-query rules observed."}`).join("\n\n")}\n\n${responsive}\n`,
    "implementation-plan.md": `# Reconstruction guidance\n\nSource: ${md(analysis.request.url)}. Rebuild desktop-first at 1440px, then verify at 390px where mobile captures exist.\n\n## 1. Apply the observed theme\n\n- Paste \`theme.css\` (or \`tailwind.config.js\`) values; every value carries source/confidence — prefer \`observed\` over \`inferred\`.\n- Body text/background and heading/button roles are mapped in \`design-tokens.md\` under "Key observed roles".\n\n## 2. Rebuild pages in priority order\n\n${pages.map((page) => {
    const desktop = page.screenshot ? `\`${shotPath(page, "desktop", null, page.screenshot)}\` (${page.screenshot.width}×${page.screenshot.height})` : "no desktop capture";
    const mobile = page.mobileScreenshot ? `; mobile \`${shotPath(page, "mobile", null, page.mobileScreenshot)}\` (${page.mobileScreenshot.width}×${page.mobileScreenshot.height})` : page.responsiveComparison?.status === "dom-only" ? "; DOM-only mobile comparison, no screenshot" : "; no mobile capture";
    const partial = coverageList(page).filter(([, item]) => item.truncated).map(([name, item]) => `${name} (${item.emittedCount}/${item.sourceCount}; ${item.reason || "capped"})`);
    return `- \`${code(page.path)}\` — implement from \`pages/${slug(page.path)}.md\`; reference ${desktop}${mobile}. ${(page.content?.components || []).length} component patterns, ${(page.content?.controls || []).length} controls. Coverage: ${partial.length > 0 ? "PARTIAL — " + partial.map((entry) => code(entry)).join("; ") : "complete within caps"}.`;
  }).join("\n")}\n\n## 3. Components and interactions\n\n- Repeat patterns: \`data/components.json\` (occurrence counts plus representative examples per page).\n- Static affordances: \`data/interactions.json\`. Nothing was clicked or replayed — implement behavior intentionally.\n\n## 4. Verify and record gaps\n\n- Compare at the recorded viewport sizes against \`screenshots/\`.\n- Any collection marked partial in \`data/report.json\` coverage is incomplete evidence, not an exhaustive spec.\n`,
    "data/pages.json": json(pages.map(cleanPage)),
    "data/tokens.json": json(w3cTokens(inventory, analysis)),
    "data/components.json": json({ schemaVersion: analysis.schemaVersion, pages: pages.map((page) => ({ path: page.path, count: page.content?.components?.length || 0, sourcePatterns: page.content?.coverage?.components || null, patterns: page.content?.components || [] })), note: "Pattern fingerprints are heuristics based on semantic structure and safe class hints; not a source framework component tree." }),
    "data/navigation.json": json({ homepage: analysis.request.url, selectedPages: (analysis.selection?.candidates || []).filter((candidate) => candidate.selected).map((candidate) => ({ path: candidate.path, url: candidate.url, label: candidate.label, priority: candidate.priority, reason: candidate.reason })), observed: pages.map((page) => ({ path: page.path, header: page.nav?.header || [], primary: page.nav?.primary || [], footer: page.nav?.footer || [] })) }),
    "data/selection.json": json(analysis.selection || { maxPages: analysis.request.maxPages, pagesDiscovered: analysis.pagesDiscovered, pagesSelected: analysis.pagesSelected, candidates: [] }),
    "data/interactions.json": json({ schemaVersion: analysis.schemaVersion, pages: pages.map((page) => ({ path: page.path, affordances: page.observedInteractions || [], hoverStates: page.hoverStates || [], controls: page.content?.controls || [], formActions: page.formActions || [], coverage: { controls: page.content?.coverage?.controls || null, interactions: page.content?.coverage?.interactions || null }, limitation: "Static DOM affordances and declared CSS state rules only; no source JavaScript behavior was replayed, no form was submitted." })) }),
    "data/assets.json": json({ assets, count: assets.length, sourceCount: analysis.assetCount, complete: assets.length === analysis.assetCount, embeds: pageEmbeds, embedCount: pageEmbeds.length }),
    "data/report.json": json({ schemaVersion: analysis.schemaVersion, sourceUrl: analysis.request.url, pagesDiscovered: analysis.pagesDiscovered, pagesSelected: analysis.pagesSelected, pagesAnalyzed: analysis.pagesAnalyzed, screenshotsCaptured: analysis.screenshotsCaptured, screenshotBytesCaptured: analysis.screenshotBytesTotal, screenshotBinariesIncluded: manifest.shots.filter((shot) => shot.hasBinary).length, browserSecondsUsed: analysis.browserSecondsUsed, issues: analysis.issues, warnings: analysis.warnings, limitations: analysis.limitations, coverage, observationIntegrityPassed: analysis.integrityPassed, packageIntegrityPassed: true }),
    "screenshots/manifest.json": json(manifest),
  };
  const { theme, tailwind } = themeFiles(inventory, pages);
  docs["theme.css"] = theme;
  docs["tailwind.config.js"] = tailwind;
  for (const page of pages) docs[`pages/${slug(page.path)}.md`] = pageMarkdown(page);
  return docs;
}

export function buildDocumentationFiles(analysis, screenshotFiles = {}) {
  if (!analysis || !Array.isArray(analysis.pages) || !analysis.request?.url) throw new Error("Analysis response is missing required pages/request data.");
  if (!analysis.schemaVersion) throw new Error("Analysis response has no schema version.");
  const inventory = tokenInventory(analysis.pages);
  const assets = uniqueBy(analysis.assets || [], (asset) => `${asset.kind}|${asset.url}`);
  const binaryPaths = new Set(Object.keys(screenshotFiles));
  const manifest = shotManifest(analysis.pages, binaryPaths);
  const files = renderMarkdown(analysis, inventory, assets, manifest);
  const validationIssues = validateDocumentationPackage(files, screenshotFiles);
  if (validationIssues.length > 0) throw new Error(`Generated documentation failed validation: ${validationIssues.join("; ")}`);
  const byteLength = new TextEncoder().encode(Object.values(files).join("")).byteLength;
  if (byteLength > MAX_DOCUMENTATION_BYTES) {
    // Failure-path-only accounting: rank files so the error tells the user
    // WHERE the weight is (usually data/pages.json + content-style.md +
    // data/selection.json on news-scale sites), not just the total.
    const encoder = new TextEncoder();
    const ranked = Object.entries(files)
      .map(([name, contents]) => [name, encoder.encode(contents).byteLength])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, bytes]) => `${name} (${(bytes / 1024 / 1024).toFixed(1)} MiB)`)
      .join(", ");
    throw new Error(`Generated documentation is ${byteLength} bytes, exceeding the client-side ${MAX_DOCUMENTATION_BYTES}-byte documentation limit. Largest files: ${ranked}. Reduce selected pages or source-site content and analyze again.`);
  }
  return { files, byteLength, screenshotManifest: manifest };
}

export function validateDocumentationPackage(files, screenshotFiles = {}) {
  const issues = [];
  const required = ["data/pages.json", "data/tokens.json", "data/selection.json", "data/components.json", "data/navigation.json", "data/interactions.json", "data/assets.json", "data/report.json", "screenshots/manifest.json", "theme.css", "tailwind.config.js", "README.md"];
  for (const name of required) if (!(name in files)) issues.push(`Missing required package file: ${name}`);
  for (const [name, contents] of Object.entries(files)) {
    if (name.endsWith(".json")) {
      try { JSON.parse(contents); } catch { issues.push(`Invalid JSON: ${name}`); }
    }
  }
  try {
    const report = JSON.parse(files["data/report.json"] || "{}");
    const pages = JSON.parse(files["data/pages.json"] || "[]");
    const assets = JSON.parse(files["data/assets.json"] || "{}");
    if (report.packageIntegrityPassed !== true) issues.push("Report does not mark package integrity as passed.");
    if (Array.isArray(pages) && Number(report.pagesAnalyzed) !== pages.length) issues.push("Report page count does not match data/pages.json.");
    if (Array.isArray(assets.assets) && Number(assets.count) !== assets.assets.length) issues.push("Asset count does not match data/assets.json entries.");
    const manifest = JSON.parse(files["screenshots/manifest.json"] || "{}");
    const binaryPaths = new Set(Object.keys(screenshotFiles));
    for (const shot of manifest.shots || []) {
      const exists = binaryPaths.has(shot.zipPath);
      if (Boolean(shot.hasBinary) !== exists) issues.push(`Screenshot manifest mismatch: ${shot.zipPath} hasBinary=${Boolean(shot.hasBinary)}, ZIP entry present=${exists}`);
    }
    for (const name of binaryPaths) if (!manifest.shots?.some((shot) => shot.zipPath === name && shot.hasBinary)) issues.push(`Unindexed screenshot binary: ${name}`);
  } catch { /* invalid JSON is reported above */ }
  return issues;
}
