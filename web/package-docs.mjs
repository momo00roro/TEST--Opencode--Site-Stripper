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
// Base64 dataUrl payload back to bytes. Runs in browsers (atob) and in Node
// tests (Buffer); the file stays dependency-free either way.
const dataUrlBytes = (dataUrl) => {
  if (typeof dataUrl !== "string") return null;
  const comma = dataUrl.indexOf(",");
  if (comma === -1 || !/^data:[^,;]+;base64$/i.test(dataUrl.slice(0, comma))) return null;
  const body = dataUrl.slice(comma + 1);
  try {
    if (typeof atob === "function") {
      const binary = atob(body);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
  } catch { return null; }
  try {
    if (typeof Buffer === "function") return Uint8Array.from(Buffer.from(body, "base64"));
  } catch { return null; }
  return null;
};
// Heading text with rendered line-breaks marked: headings[].breaks holds the
// word indices starting each new line, so insert a ⏎ marker before them.
const withBreaks = (heading) => {
  const words = String(heading?.text ?? "").split(" ");
  const marks = new Set(Array.isArray(heading?.breaks) ? heading.breaks : []);
  return words.map((word, index) => (marks.has(index) && index > 0 ? "⏎ " : "") + word).join(" ");
};
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
  const cleaned = {
    ...page,
    screenshot: page.screenshot ? Object.fromEntries(Object.entries(page.screenshot).filter(([key]) => key !== "dataUrl")) : null,
    mobileScreenshot: page.mobileScreenshot ? Object.fromEntries(Object.entries(page.mobileScreenshot).filter(([key]) => key !== "dataUrl")) : null,
    sectionShots: (page.sectionShots || []).map((shot) => Object.fromEntries(Object.entries(shot).filter(([key]) => key !== "dataUrl"))),
    videoShots: (page.videoShots || []).map((shot) => Object.fromEntries(Object.entries(shot).filter(([key]) => key !== "dataUrl"))),
    videoThumbnails: (page.videoThumbnails || []).map((shot) => Object.fromEntries(Object.entries(shot).filter(([key]) => key !== "dataUrl"))),
  };
  // CF35-2 (additive, capped): carry observed layout into data/pages.json.
  // Screenshot dataUrl stripping above never touches these fields; the caps
  // below bound pack size without inventing geometry. semanticStyles rides
  // the ...page spread untouched (left as-is by design).
  if (Array.isArray(page.sectionLayouts)) {
    cleaned.sectionLayouts = page.sectionLayouts.slice(0, 20).map((layout) => {
      const entry = {};
      if (layout.heading !== undefined) entry.heading = layout.heading;
      if (layout.y !== undefined) entry.y = layout.y;
      if (layout.height !== undefined) entry.height = layout.height;
      if (layout.columns !== undefined) entry.columns = layout.columns;
      if (layout.background !== undefined) entry.background = layout.background;
      if (layout.textAlign !== undefined) entry.textAlign = layout.textAlign;
      entry.components = Array.isArray(layout.components) ? layout.components.slice(0, 12) : [];
      return entry;
    });
  }
  if (page.geometry && typeof page.geometry === "object") {
    cleaned.geometry = {
      ...page.geometry,
      containerWidths: Array.isArray(page.geometry.containerWidths) ? page.geometry.containerWidths.slice(0, 5) : page.geometry.containerWidths,
    };
  }
  if (Array.isArray(page.layoutSamples)) {
    cleaned.layoutSamples = page.layoutSamples.slice(0, 8);
  }
  return cleaned;
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

// CF34-local: semantic color aliases over the raw frequency inventory.
// CF35-1 (accent-first): frequency ranks surfaces (white page bg, dark
// text), never brand — so brand/* is scored by saturation, not count:
// accent score = saturation * log(1+count) * roleBonus, where roleBonus is
// 2.0 when the value appears in any page semanticStyles entry with role
// button/link/heading-1/heading-2 color (whitespace-insensitive,
// case-insensitive), else 1.0. Top scorer wins brand/primary; the highest
// runner-up in a different hue family (hue differs >30 degrees, or one
// side is achromatic) wins brand/secondary. Neutrals (isNeutralColor) can
// never be brand/*: darkest -> ink, lightest -> paper, most-frequent light
// neutral -> surface/base, most-frequent mid neutral -> surface/muted.
// Case-insensitive dedupe (e.g. "#9F58FA" + "#9f58fa" cluster to one alias)
// while `inventory` keeps every raw spelling untouched. Dependency-free.
function aliasInventory(inventory, pages) {
  const colors = inventory?.colors || [];
  const groups = new Map();
  for (const token of colors) {
    const raw = String(token?.value ?? "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const entry = groups.get(key) || { value: raw, count: 0, pages: [] };
    entry.count += Number(token.count || 1);
    for (const page of token.pages || []) if (!entry.pages.includes(page)) entry.pages.push(page);
    groups.set(key, entry);
  }
  // Representative spelling: highest single-token count wins (first-seen
  // breaks ties), so "#9F58FA" (count 5) beats "#9f58fa" (count 3).
  const seen = new Map();
  for (const token of colors) {
    const key = String(token?.value ?? "").trim().toLowerCase();
    if (!key || !groups.has(key)) continue;
    const best = seen.get(key);
    if (best == null || Number(token.count || 1) > Number(best.count || 1)) seen.set(key, token);
  }
  for (const [key, entry] of groups) {
    const best = seen.get(key);
    if (best) entry.value = String(best.value).trim();
  }
  const ranked = [...groups.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const aliases = {};
  if (ranked.length === 0) return aliases;
  // Brand/*: accent-first scoring over chromatic (non-neutral) candidates.
  // Unparseable var()/currentcolor/Tailwind tw-opacity composites (e.g.
  // "rgb(159 88 250/var(--tw-text-opacity,1))") carry no plain channels, so
  // colorSaturation() returns null and they stay in the raw inventory
  // without ever winning a brand alias.
  const accentRoles = new Set(["button", "link", "heading-1", "heading-2"]);
  const normalizeColor = (value) => String(value).toLowerCase().replace(/\s+/g, "");
  const roleColors = new Set();
  for (const page of pages || []) {
    for (const sample of page?.semanticStyles || []) {
      if (!sample || !accentRoles.has(sample.role) || sample.color == null) continue;
      roleColors.add(normalizeColor(sample.color));
    }
  }
  const scored = [];
  for (const entry of ranked) {
    // Brand/* is reserved for true accents: real extractor data carries
    // off-by-one channels (cline.bot near-black text "rgb(21, 21, 22)",
    // higgsfield.ai dark slate "rgb(19, 21, 23)") that strict grayscale
    // misses but read as surfaces, never brand. Below MIN_ACCENT a color
    // is surface-class even when technically chromatic.
    const saturation = colorSaturation(entry.value);
    if (saturation == null || saturation < MIN_ACCENT_SATURATION) continue;
    const roleBonus = roleColors.has(normalizeColor(entry.value)) ? 2.0 : 1.0;
    scored.push({ entry, hue: colorHue(entry.value), score: saturation * Math.log(1 + entry.count) * roleBonus });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.value.localeCompare(b.entry.value));
  const hueDistance = (a, b) => {
    if (a == null || b == null) return 180;
    const diff = Math.abs(a - b) % 360;
    return diff > 180 ? 360 - diff : diff;
  };
  if (scored.length > 0) {
    aliases["brand/primary"] = scored[0].entry.value;
    const runner = scored.find((item) => item !== scored[0] && hueDistance(item.hue, scored[0].hue) > 30);
    if (runner) aliases["brand/secondary"] = runner.entry.value;
  }
  const used = new Set(Object.values(aliases).map((value) => String(value).toLowerCase()));
  const neutrals = ranked
    .map((entry) => ({ entry, lightness: colorLightness(entry.value) }))
    .filter((item) => item.lightness != null && isSurfaceNeutral(item.entry.value));
  if (neutrals.length > 0) {
    const byLight = [...neutrals].sort((a, b) => a.lightness - b.lightness);
    const fresh = byLight.filter((item) => !used.has(String(item.entry.value).toLowerCase()));
    const pool = fresh.length > 0 ? fresh : byLight;
    if (pool.length === 1) {
      // A single neutral serves the side of the scale it sits on.
      if (pool[0].lightness < 0.5) aliases["ink"] = pool[0].entry.value;
      else aliases["paper"] = pool[0].entry.value;
    } else {
      aliases["ink"] = pool[0].entry.value;
      const lightest = pool[pool.length - 1].entry.value;
      if (lightest !== aliases["ink"]) aliases["paper"] = lightest;
    }
    // Surface roles from the same neutral scale: the most-frequent light
    // neutral is the page background (-> surface/base, which may
    // legitimately coincide with paper); the most-frequent mid-tone neutral
    // (-> surface/muted) covers dividers/wells. Spellings already claimed
    // by brand/* or ink are skipped; when no neutral fits the band the key
    // is omitted rather than invented.
    const claimed = (value) => Object.values(aliases).some((current) => String(current).toLowerCase() === String(value).toLowerCase());
    const brandInkClaimed = (value) => [aliases["brand/primary"], aliases["brand/secondary"], aliases["ink"]]
      .filter(Boolean).some((current) => String(current).toLowerCase() === String(value).toLowerCase());
    const byCount = [...neutrals].sort((a, b) => b.entry.count - a.entry.count || a.entry.value.localeCompare(b.entry.value));
    const base = byCount.find((item) => item.lightness >= 0.5 && !brandInkClaimed(item.entry.value));
    if (base) aliases["surface/base"] = base.entry.value;
    const muted = byCount.find((item) => item.lightness > 0.2 && item.lightness < 0.85 && !claimed(item.entry.value));
    if (muted) aliases["surface/muted"] = muted.entry.value;
  }
  return aliases;
}

// HSL lightness in [0,1], or null when the value is not a parseable color.
function colorLightness(value) {
  const text = String(value ?? "").trim().toLowerCase();
  let match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (match) {
    let hex = match[1];
    if (hex.length <= 4) hex = [...hex].map((ch) => ch + ch).join("");
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
  }
  match = /^rgba?\(\s*([^)]+)\)$/.exec(text);
  if (match) {
    const parts = match[1].split(",").map((part) => part.trim());
    if (parts.length < 3) return null;
    const channel = (part) => part.endsWith("%") ? (parseFloat(part) / 100) : (parseFloat(part) / 255);
    const [r, g, b] = parts.map(channel);
    if (![r, g, b].every(Number.isFinite)) return null;
    return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
  }
  match = /^hsla?\(\s*([^)]+)\)$/.exec(text);
  if (match) {
    const parts = match[1].split(",").map((part) => part.trim());
    if (parts.length < 3) return null;
    const light = parts[2].endsWith("%") ? parseFloat(parts[2]) / 100 : parseFloat(parts[2]);
    return Number.isFinite(light) ? Math.min(Math.max(light, 0), 1) : null;
  }
  if (text === "black") return 0;
  if (text === "white") return 1;
  return null;
}

// Plain RGB channels in [0,1], or null when the value carries no plain
// channels: var() refs, currentcolor, and space-separated Tailwind
// tw-opacity composites ("rgb(159 88 250/var(--tw-text-opacity,1))").
// Shared by colorSaturation()/colorHue() so all three parse identically.
function parseRgb01(value) {
  const text = String(value ?? "").trim().toLowerCase();
  let match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (match) {
    let hex = match[1];
    if (hex.length <= 4) hex = [...hex].map((ch) => ch + ch).join("");
    return [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255];
  }
  match = /^rgba?\(\s*([^)]+)\)$/.exec(text);
  if (match) {
    if (!match[1].includes(",")) return null;
    const parts = match[1].split(",").map((part) => part.trim());
    if (parts.length < 3) return null;
    const channel = (part) => part.endsWith("%") ? (parseFloat(part) / 100) : (parseFloat(part) / 255);
    const [r, g, b] = parts.map(channel);
    if (![r, g, b].every(Number.isFinite)) return null;
    return [r, g, b];
  }
  if (text === "black") return [0, 0, 0];
  if (text === "white") return [1, 1, 1];
  return null;
}

// HSL saturation in [0,1], or null when the value is not a parseable color
// (same grammar as colorLightness: hex, comma rgb()/rgba(),
// comma hsl()/hsla(), black/white keywords).
function colorSaturation(value) {
  const channels = parseRgb01(value);
  if (channels) {
    const [r, g, b] = channels;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return 0;
    return (max - min) / (1 - Math.abs(max + min - 1));
  }
  const text = String(value ?? "").trim().toLowerCase();
  const match = /^hsla?\(\s*([^)]+)\)$/.exec(text);
  if (match) {
    if (!match[1].includes(",")) return null;
    const parts = match[1].split(",").map((part) => part.trim());
    if (parts.length < 3) return null;
    const sat = parts[1].endsWith("%") ? parseFloat(parts[1]) / 100 : parseFloat(parts[1]);
    return Number.isFinite(sat) ? Math.min(Math.max(sat, 0), 1) : null;
  }
  return null;
}

// Hue in degrees [0,360), or null for achromatic/unparseable values.
function colorHue(value) {
  const channels = parseRgb01(value);
  if (channels) {
    const [r, g, b] = channels;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return null;
    let hue;
    if (max === r) hue = ((g - b) / (max - min)) % 6;
    else if (max === g) hue = (b - r) / (max - min) + 2;
    else hue = (r - g) / (max - min) + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
    return hue;
  }
  const text = String(value ?? "").trim().toLowerCase();
  const match = /^hsla?\(\s*([^)]+)\)$/.exec(text);
  if (match) {
    if (!match[1].includes(",")) return null;
    const parts = match[1].split(",").map((part) => part.trim());
    if (parts.length < 3) return null;
    const hue = parseFloat(parts[0]);
    if (!Number.isFinite(hue)) return null;
    return ((hue % 360) + 360) % 360;
  }
  return null;
}

// Neutral = grayscale (r == g == b) or zero-saturation hsl, plus black/white.
// isSurfaceNeutral widens that to near-grayscale (saturation below
// NEUTRAL_SATURATION_MAX): off-by-one extractor channels such as
// "rgb(21, 21, 22)" read as surfaces. The gap between NEUTRAL_SATURATION_MAX
// and MIN_ACCENT_SATURATION is a deliberate dead zone — muted in-between
// tones win no alias rather than a wrong one.
function isNeutralColor(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "black" || text === "white") return true;
  let match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (match) {
    let hex = match[1];
    if (hex.length <= 4) hex = [...hex].map((ch) => ch + ch).join("");
    return hex.slice(0, 2) === hex.slice(2, 4) && hex.slice(2, 4) === hex.slice(4, 6);
  }
  match = /^rgba?\(\s*([^)]+)\)$/.exec(text);
  if (match) {
    const parts = match[1].split(",").map((part) => part.trim()).slice(0, 3);
    const nums = parts.map((part) => part.endsWith("%") ? parseFloat(part) : parseFloat(part));
    if (!nums.every(Number.isFinite)) return false;
    return nums[0] === nums[1] && nums[1] === nums[2];
  }
  match = /^hsla?\(\s*([^)]+)\)$/.exec(text);
  if (match) {
    const parts = match[1].split(",").map((part) => part.trim());
    if (parts.length < 2) return false;
    return parseFloat(parts[1]) === 0;
  }
  return false;
}

const NEUTRAL_SATURATION_MAX = 0.12;
const MIN_ACCENT_SATURATION = 0.15;

function isSurfaceNeutral(value) {
  if (isNeutralColor(value)) return true;
  const saturation = colorSaturation(value);
  return saturation != null && saturation < NEUTRAL_SATURATION_MAX;
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
  // Semantic aliases ride alongside (never replace) the raw token-N keys.
  output.aliases = aliasInventory(inventory, analysis.pages);
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

// CF34-local Task 5 (additive): layered theme.v2 + Tailwind v4 @theme +
// responsive-pairs manifest + SVG annotation overlays (no raster drawing,
// no native deps). All helpers are dependency-free and capped.

// CSS var-safe name: "brand/primary" -> "brand-primary".
function cssVarName(raw, fallback = "token") {
  const clean = String(raw ?? "").toLowerCase().replace(/\//g, "-").replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return clean || fallback;
}

function parsePx(value) {
  const match = /^\s*(\d*\.?\d+)\s*px\s*$/i.exec(String(value ?? ""));
  if (!match) return null;
  const num = parseFloat(match[1]);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function themeV2Files(inventory, pages) {
  const aliases = aliasInventory(inventory, pages);
  const topColors = (inventory.colors || []).slice(0, 12);
  const topFontSizes = (inventory.fontSizes || []).slice(0, 8);
  const topSpacing = (inventory.spacing || []).slice(0, 8);
  const firstFace = (pages || []).flatMap((page) => page.typography?.fontFaces || [])[0]?.family?.replace(/["'\\;]/g, "") || "";
  const lines = [];
  for (const [name, value] of Object.entries(aliases)) {
    lines.push(`  --${cssVarName(name)}: ${value}; /* observed alias ${name} */`);
  }
  topColors.forEach((token, index) => lines.push(`  --color-${index + 1}: ${token.value}; /* ${token.source}/${token.confidence}; ${token.count} observation${token.count === 1 ? "" : "s"} */`));
  topFontSizes.forEach((token, index) => lines.push(`  --font-size-${index + 1}: ${token.value}; /* ${token.source}/${token.confidence} */`));
  topSpacing.forEach((token, index) => lines.push(`  --spacing-${index + 1}: ${token.value}; /* ${token.source}/${token.confidence} */`));
  lines.push(firstFace ? `  --font-family-base: ${firstFace}, system-ui, sans-serif;` : `  --font-family-base: system-ui, sans-serif;`);
  // CF35-3: observed page canvas is the authoritative body background.
  // --page-bg carries the observed value; the base body rule prefers it and
  // falls back to the previous --paper chain when absent. Additive: theme.css untouched.
  const observedPageBg = (pages || []).map((page) => page?.pageCanvasColor).find((value) => typeof value === "string" && value.trim());
  if (observedPageBg) {
    lines.push(`  --page-bg: ${observedPageBg}; /* observed page canvas — paint body this FIRST */`);
  } else {
    lines.push(`  /* No page canvas color observed — body falls back to --paper. */`);
  }
  // Fluid type from observed min/max font sizes (honest: needs >= 2 sizes).
  const pxSizes = topFontSizes.map((token) => parsePx(token.value)).filter((num) => num != null);
  const minPx = pxSizes.length > 0 ? Math.min(...pxSizes) : null;
  const maxPx = pxSizes.length > 0 ? Math.max(...pxSizes) : null;
  if (minPx != null && maxPx != null && maxPx > minPx) {
    const midRem = (((minPx + maxPx) / 2 / 16).toFixed(3));
    lines.push(`  --font-size-fluid: clamp(${minPx}px, ${midRem}rem + 1vw, ${maxPx}px); /* fluid range from observed min/max font sizes */`);
  } else {
    lines.push(`  /* No fluid type range — fewer than 2 distinct observed px font sizes. */`);
  }
  // Dark scheme only when dark tokens were actually observed; else comment.
  const hasDark = (inventory.colors || []).some((token) => {
    const lightness = colorLightness(token.value);
    return lightness != null && lightness < 0.25;
  });
  const darkBlock = hasDark
    ? `@media (prefers-color-scheme: dark) {\n  @layer tokens {\n    :root {\n      /* Dark tokens observed (lightness < 0.25 present) — verify against the live page before shipping. */\n      color-scheme: dark;\n    }\n  }\n}`
    : `/* No dark tokens observed — dark scheme omitted. Verify against the live page before adding one. */`;
  const bodyBackgroundDecl = observedPageBg
    ? `    background: var(--page-bg, var(--paper, var(--color-1, #ffffff)));`
    : `    background: var(--paper, var(--color-1, #ffffff));`;
  const themeV2 = `@layer tokens, base, components;\n\n@layer tokens {\n  :root {\n${lines.join("\n")}\n  }\n}\n\n@layer base {\n  body {\n${bodyBackgroundDecl}\n    color: var(--ink, #111111);\n    font-family: var(--font-family-base);\n    font-size: var(--font-size-1, 16px);\n  }\n}\n\n@layer components {\n  .btn {\n    background: var(--brand-primary, var(--color-1, #111111));\n    color: var(--paper, #ffffff);\n    padding: var(--spacing-1, 8px) var(--spacing-2, 16px);\n  }\n}\n\n${darkBlock}\n`;
  // Tailwind v4: @theme tokens from the same capped data. The file is ESM
  // that exports the token maps plus a copy-paste `themeCss` snippet, so
  // the literal "@theme" is present for both machines and humans.
  const colorEntries = Object.fromEntries(topColors.map((token, index) => [`--color-${index + 1}`, token.value]));
  for (const [name, value] of Object.entries(aliases)) colorEntries[`--color-${cssVarName(name)}`] = value;
  const fontEntries = Object.fromEntries(topFontSizes.map((token, index) => [`--font-${index + 1}`, token.value]));
  fontEntries["--font-base"] = firstFace ? `${firstFace}, system-ui, sans-serif` : "system-ui, sans-serif";
  const spacingEntries = Object.fromEntries(topSpacing.map((token, index) => [`--spacing-${index + 1}`, token.value]));
  const themeCssBlock = `@theme {\n${Object.entries(colorEntries).map(([key, value]) => `  ${key}: ${value};`).join("\n")}\n${Object.entries(fontEntries).map(([key, value]) => `  ${key}: ${value};`).join("\n")}\n${Object.entries(spacingEntries).map(([key, value]) => `  ${key}: ${value};`).join("\n")}\n}`;
  const tailwindV4 = `// Tailwind CSS v4 theme tokens (observed; capped top values + aliases).\n// Usage in CSS:\n//   @import "tailwindcss";\n//   ${"@theme"} { ... } — copy the exported themeCss block below.\n// Source: data/tokens.json (aliases + per-category token-N keys).\nexport const themeCss = \`${themeCssBlock.replace(/`/g, "\\`")}\`;\nexport const theme = {\n  colors: ${JSON.stringify(Object.fromEntries(topColors.map((token, index) => [`color-${index + 1}`, token.value])), null, 2)},\n  fonts: ${JSON.stringify(Object.fromEntries(topFontSizes.map((token, index) => [`font-${index + 1}`, token.value])), null, 2)},\n  spacing: ${JSON.stringify(Object.fromEntries(topSpacing.map((token, index) => [`spacing-${index + 1}`, token.value])), null, 2)},\n  aliases: ${JSON.stringify(aliases)},\n};\n`;
  return { themeV2, tailwindV4 };
}

// CF36-2 @font-face pack file (local-full only): downloaded font binaries
// ship under assets/fonts/* via the existing downloaded-asset fan-out in
// buildDocumentationFiles (Uint8Array content or dataUrl wire form — no new
// branch needed), and this file wires them up as @font-face rules. Font
// entries that stayed URL references get an honest comment, never a fake
// rule. Hosted/lite runs collect no font assets, so this file is then a
// comment-only header — same code path, no behavior fork.
function fontsCss(assets) {
  const fonts = (assets || []).filter((asset) => asset && asset.kind === "font");
  const downloaded = fonts.filter((asset) => asset.source === "downloaded" && typeof asset.localPath === "string");
  const referenced = fonts.filter((asset) => !(asset.source === "downloaded" && typeof asset.localPath === "string"));
  const formatFor = (localPath) => {
    const lower = String(localPath || "").toLowerCase();
    if (lower.endsWith(".woff2")) return "woff2";
    if (lower.endsWith(".woff")) return "woff";
    if (lower.endsWith(".ttf")) return "truetype";
    return "opentype";
  };
  const lines = [
    "/* Observed @font-face files (CF36-2, downloaded at capture time on local-full runs only).",
    ` * ${downloaded.length} of ${fonts.length} observed file(s) shipped under assets/fonts/; the rest are URL references (see comments below).`,
    " * Pair with theme.css --font-family-base when rebuilding type. */",
  ];
  for (const asset of downloaded) {
    const family = String(asset.fontFamily || asset.alt || "unknown").replace(/["\\]/g, "").slice(0, 120) || "unknown";
    const weight = String(asset.fontWeight || "400").replace(/[^a-z0-9\s]/gi, "").trim().slice(0, 20) || "400";
    lines.push(`@font-face {\n  font-family: "${family}";\n  font-weight: ${weight};\n  font-style: normal;\n  font-display: swap;\n  src: url("${asset.localPath}") format("${formatFor(asset.localPath)}");\n} /* observed on ${asset.usedOn || "unknown page"}; original: ${asset.url || "unknown URL"} */`);
  }
  if (referenced.length > 0) {
    lines.push("/* Reference-only (not downloaded — URL reference; verify against the live page before shipping):");
    for (const asset of referenced.slice(0, 20)) {
      lines.push(` * - ${asset.fontFamily || asset.alt || "unknown"} ${asset.fontWeight || ""} — ${asset.url || "unknown URL"}${asset.skipReason ? ` (${asset.skipReason})` : ""}`);
    }
    lines.push(" */");
  } else if (downloaded.length === 0) {
    lines.push("/* No @font-face files observed (or this run predates font capture / is a hosted-lite pack). */");
  }
  return `${lines.join("\n")}\n`;
}

function hasShotMeta(shot) {  if (!shot || typeof shot !== "object") return false;
  return shot.kind != null || shot.width != null || shot.height != null || shot.bytes != null;
}

// Responsive pairs: desktop/mobile screenshot paths per page where shot
// metadata is present (cleanPage strips dataUrl, so kind/width/height
// presence is the signal). Never throws; empty pairs carry an honest note.
function buildResponsivePairs(pages, schemaVersion) {
  const pairs = [];
  for (const page of (pages || []).slice(0, 20)) {
    const desktopMeta = hasShotMeta(page.screenshot) ? page.screenshot : null;
    const mobileMeta = hasShotMeta(page.mobileScreenshot) ? page.mobileScreenshot : null;
    if (!desktopMeta && !mobileMeta) continue;
    const desktop = desktopMeta ? shotPath(page, "desktop", null, desktopMeta) : null;
    const mobile = mobileMeta ? shotPath(page, "mobile", null, mobileMeta) : null;
    const status = desktop && mobile ? "paired" : desktop ? "desktop-only" : "mobile-only";
    pairs.push({
      page: page.path,
      desktop,
      mobile,
      status,
      desktopSize: desktopMeta ? { width: desktopMeta.width ?? null, height: desktopMeta.height ?? null } : null,
      mobileSize: mobileMeta ? { width: mobileMeta.width ?? null, height: mobileMeta.height ?? null } : null,
    });
    if (pairs.length >= 20) break;
  }
  const note = pairs.length === 0
    ? "No desktop/mobile screenshot metadata observed — no pairs to compare. Verify responsive behavior against the live page."
    : pairs.every((entry) => entry.status !== "paired")
      ? "Only single-variant captures observed (no desktop+mobile pair on the same page). Pair entries list the observed variant; verify the missing variant against the live page."
      : "Desktop/mobile pairs by page path; screenshot binaries live under screenshots/ (see screenshots/manifest.json).";
  return { schemaVersion: schemaVersion || "0.2.0", pairs: pairs.slice(0, 20), note };
}

const xmlEscape = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Annotated overlays: SVG manifest only (no raster drawing, no native
// deps). Section x/y/width/height geometry is not available in the docs
// renderer (sectionLayouts carry y/height/textAlign at most), so overlays
// list heading order as <text> elements — honest, no fake rects.
function buildAnnotatedOverlays(pages) {
  const overlays = {};
  let total = 0;
  for (const page of (pages || []).slice(0, 10)) {
    const sections = (page.content?.sections || []).slice(0, 10);
    if (sections.length === 0) continue;
    const layouts = page.sectionLayouts || [];
    const names = sections.map((section, index) => {
      const heading = typeof section.heading === "string" ? section.heading : section.heading?.text || "(unheaded)";
      const role = section.role || "section";
      const layout = layouts[index] || {};
      const geom = Number.isFinite(Number(layout.y)) && Number.isFinite(Number(layout.height))
        ? ` (y≈${layout.y}, h≈${layout.height})`
        : "";
      return { label: `${index + 1}. [${role}] ${heading}${geom}`, index };
    });
    for (const item of names) {
      if (total >= 20) break;
      const base = slug(page.path);
      const zipPath = `screenshots/annotated/${base}-${item.index + 1}.svg`;
      const height = 60 + names.length * 24;
      const rows = names.map((row, rowIndex) => `    <text x="16" y="${56 + rowIndex * 24}" font-family="monospace" font-size="13" fill="${rowIndex === item.index ? "#f59e0b" : "#e5e7eb"}">${xmlEscape(row.label)}</text>`).join("\n");
      overlays[zipPath] = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}" role="img" aria-label="${xmlEscape(`Section order overlay for ${page.path}`)}">\n  <rect x="0" y="0" width="800" height="${height}" fill="#111827" opacity="0.92"/>\n  <text x="16" y="24" font-family="monospace" font-size="14" font-weight="bold" fill="#ffffff">${xmlEscape(`Overlay: ${page.path} section ${item.index + 1}/${names.length}`)}</text>\n  <text x="16" y="40" font-family="monospace" font-size="11" fill="#9ca3af">Order-only overlay — no section rect geometry observed; do not use for pixel placement.</text>\n${rows}\n</svg>\n`;
      total += 1;
    }
    if (total >= 20) break;
  }
  return overlays;
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
  if (variant === "video") return `screenshots/videos/${base}-${index + 1}.${ext}`;
  return `screenshots/sections/${base}-${index + 1}.${ext}`;
}

// Placement: which layout section a playing-state frame belongs to, so a
// rebuild can composite it over the blank video band in section screenshots.
function sectionIndexForShot(layouts, y) {
  const top = Number(y);
  if (!Number.isFinite(top) || !Array.isArray(layouts)) return -1;
  for (let i = 0; i < layouts.length; i += 1) {
    const layout = layouts[i] || {};
    const ly = Number(layout.y);
    const lh = Number(layout.height);
    if (!Number.isFinite(ly) || !Number.isFinite(lh) || lh <= 0) continue;
    if (top >= ly && top < ly + lh) return i;
  }
  return -1;
}

// CF34-local: machine-readable motion timeline — one row per observed
// transition/animation/keyframe. Per-row timing carries no selector in the
// extractor (see SnapshotMotion): observed selectors ride the page-level
// animatedSelectors list, so rows borrow from it positionally and fall back
// to "unknown" rather than inventing a target. scrollTrigger stays
// "unknown" unless sticky/fixed rules were observed on the page, in which
// case it is marked inferred (pinned scroll scenes misrender as blank
// bands). Dependency-free, no imports.
function motionTimeline(pages) {
  const rows = [];
  for (const page of pages) {
    const motion = page.motion || {};
    const selectors = Array.isArray(motion.animatedSelectors) ? motion.animatedSelectors.filter(Boolean) : [];
    const observed = Array.isArray(page.observedInteractions) ? page.observedInteractions : [];
    const pinned = observed.some((item) => item && item.kind === "sticky-fixed");
    const scrollTrigger = pinned
      ? "inferred: sticky/fixed rules observed — verify scroll trigger against the live page"
      : "unknown";
    const at = (index) => selectors[index] || selectors[0] || "unknown";
    for (const item of motion.transitions || []) {
      rows.push({
        page: page.path,
        element: at(rows.filter((row) => row.page === page.path).length),
        selector: at(rows.filter((row) => row.page === page.path).length),
        kind: "transition",
        property: item?.property || "",
        keyframes: null,
        duration: item?.duration || "",
        easing: item?.easing || "",
        delay: item?.delay || "",
        scrollTrigger,
      });
    }
    for (const item of motion.animations || []) {
      rows.push({
        page: page.path,
        element: at(rows.filter((row) => row.page === page.path).length),
        selector: at(rows.filter((row) => row.page === page.path).length),
        kind: "animation",
        property: item?.name || "",
        keyframes: item?.name || "",
        duration: item?.duration || "",
        easing: item?.easing || "",
        delay: item?.delay || "",
        scrollTrigger,
      });
    }
    // Declared keyframes with no animation row stay visible as their own
    // rows so the timeline never silently drops observed names.
    const named = new Set((motion.animations || []).map((item) => item?.name).filter(Boolean));
    for (const name of motion.keyframes || []) {
      if (!name || named.has(name)) continue;
      rows.push({
        page: page.path,
        element: "unknown",
        selector: "unknown",
        kind: "keyframes",
        property: name,
        keyframes: name,
        duration: "",
        easing: "",
        delay: "",
        scrollTrigger,
      });
    }
  }
  return rows;
}

// CSS timing ("0.6s", "200ms") to GSAP seconds; unparseable falls back to
// 0.5 with the observed raw value kept in the snippet comment.
function gsapSeconds(value) {
  const match = /^\s*(\d*\.?\d+)\s*(ms|s)\s*$/i.exec(String(value ?? ""));
  if (!match) return 0.5;
  const amount = parseFloat(match[1]);
  if (!Number.isFinite(amount)) return 0.5;
  return match[2].toLowerCase() === "ms" ? amount / 1000 : amount;
}

// Common CSS easings to GSAP ease names; functional easings
// (cubic-bezier/steps) have no GSAP literal, so map to a neutral default
// and keep the observed value in the snippet comment.
function gsapEaseName(easing) {
  const key = String(easing ?? "").trim().toLowerCase();
  if (key === "linear") return "none";
  if (key === "ease") return "power1.out";
  if (key === "ease-in") return "power2.in";
  if (key === "ease-out") return "power2.out";
  if (key === "ease-in-out") return "power2.inOut";
  if (key === "step-start" || key === "step-end") return "steps(1)";
  return "power1.out";
}

// One GSAP snippet per timeline row: transitions become gsap.to,
// animations/keyframes become gsap.from (entrance-like). Prop placeholders
// must be replaced with the observed end-state; timings are observed.
function gsapSnippet(row) {
  const target = row.selector && row.selector !== "unknown"
    ? String(row.selector).replace(/"/g, "'")
    : ".your-selector";
  const duration = gsapSeconds(row.duration);
  const ease = gsapEaseName(row.easing);
  const delay = gsapSeconds(row.delay);
  const delayPart = delay > 0 ? `, delay: ${delay}` : "";
  const observed = [row.kind, row.property || row.keyframes || "", row.duration || "?", String(row.easing || "?"), `delay ${row.delay || "?"}`].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const lines = [
    `// Observed ${observed} on ${row.page}${row.selector === "unknown" ? " (no selector observed — replace .your-selector)" : ""}; scrollTrigger: ${row.scrollTrigger}. Rebuild only — nothing was replayed.`,
  ];
  if (row.kind === "animation" || row.kind === "keyframes") {
    lines.push(`gsap.from("${target}", { duration: ${duration}, ease: "${ease}"${delayPart} });`);
  } else {
    lines.push(`gsap.to("${target}", { duration: ${duration}, ease: "${ease}"${delayPart} });`);
  }
  return lines.join("\n");
}

// CF34-local: per-page timeline tables plus GSAP transcription. Pages with
// no rows get honest no-motion copy, never invented motion.
function motionTimelineMd(pages, timeline) {
  return pages.map((page) => {
    const rows = timeline.filter((row) => row.page === page.path);
    if (rows.length === 0) return `## ${md(page.path)}\n\nNo observed motion on this page.`;
    const table = `| Element | Kind | Keyframes/property | Duration | Easing | Delay | Scroll trigger |\n|---|---|---|---|---|---|---|\n`
      + rows.map((row) => `| \`${code(row.selector)}\` | ${md(row.kind)} | \`${code(row.keyframes || row.property || "—")}\` | \`${code(row.duration || "—")}\` | \`${code(row.easing || "—")}\` | \`${code(row.delay || "—")}\` | ${md(row.scrollTrigger)} |`).join("\n");
    const snippets = rows.map((row) => fence(gsapSnippet(row))).join("\n\n");
    return `## ${md(page.path)}\n\n${table}\n\n${snippets}`;
  }).join("\n\n");
}

// CF16: machine-readable section layout — geometry, alignment, columns,
// background, and media/form/table boxes per section, so a rebuild knows
// composition without eyeballing screenshots.
// CF35-2: sections are y-ordered (null y sorts last) for machine consumers;
// `section` is the 1-based document-order index, `order` is the 0-based twin
// kept for backward compatibility. Never invents geometry.
// CF35-3: observed page canvas color (page.pageCanvasColor) is the
// authoritative body background. Single string per page, no cap needed.
function pageCanvasBackground(page) {
  const raw = page?.pageCanvasColor;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function buildLayout(pages) {
  const entries = (pages || []).map((page) => {
      const sections = page.content?.sections || [];
      const layouts = page.sectionLayouts || [];
      const rows = sections.slice(0, 20).map((section, index) => {
        const layout = layouts[index] || {};
        return {
          section: index + 1,
          order: index,
          heading: section.heading || layout.heading || "",
          y: layout.y ?? null,
          height: layout.height ?? null,
          textAlign: layout.textAlign || "",
          columns: layout.columns || "",
          background: layout.background || "",
          components: (layout.components || []).slice(0, 12),
        };
      });
      rows.sort((a, b) => {
        const ay = typeof a.y === "number" && Number.isFinite(a.y) ? a.y : null;
        const by = typeof b.y === "number" && Number.isFinite(b.y) ? b.y : null;
        if (ay == null && by == null) return a.order - b.order;
        if (ay == null) return 1;
        if (by == null) return -1;
        return ay - by || a.order - b.order;
      });
      return {
        path: page.path,
        viewport: page.viewport || null,
        bodyBackground: pageCanvasBackground(page),
        sections: rows,
      };
    });
  return {
    bodyBackground: entries.map((entry) => entry.bodyBackground).find((value) => value != null) ?? null,
    pages: entries,
  };
}

// CF34-local: grouped component inventory from fingerprint repeats plus
// repeated section roles. A kind/role observed ≥2 times (by summed count)
// becomes one reusable component entry {name, count, pages}. Dependency-free.
function componentInventory(pages) {
  const groups = new Map();
  const add = (name, pagePath, weight, extra) => {
    const key = String(name || "").trim();
    if (!key || !pagePath) return;
    const entry = groups.get(key) || { name: key, count: 0, pages: [], examples: [], signatures: [] };
    entry.count += Number(weight || 1);
    if (!entry.pages.includes(pagePath)) entry.pages.push(pagePath);
    if (extra?.example && !entry.examples.includes(extra.example) && entry.examples.length < 5) entry.examples.push(extra.example);
    if (extra?.signature && !entry.signatures.includes(extra.signature) && entry.signatures.length < 5) entry.signatures.push(extra.signature);
    groups.set(key, entry);
  };
  for (const page of pages || []) {
    for (const pattern of page.content?.components || []) {
      if (!pattern || !pattern.kind) continue;
      add(pattern.kind, page.path, Number(pattern.count || 1), { example: (pattern.examples || [])[0], signature: pattern.signature });
    }
    for (const section of page.content?.sections || []) {
      if (!section || !section.role) continue;
      add(`section:${section.role}`, page.path, 1, { example: section.heading || null });
    }
  }
  return [...groups.values()]
    .filter((entry) => entry.count >= 2)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function buildComponentsMd(components) {
  const lines = ["# Components", ""];
  lines.push("Reusable inventory grouped from component fingerprints and repeated section roles (observed ≥2 times). Build each once, reuse across pages. Machine-readable source: `data/components.json` (`components` array).", "");
  if (!components || components.length === 0) {
    lines.push("(no repeated components observed — every fingerprint and section role appeared once)");
    return lines.join("\n");
  }
  for (const entry of components) {
    lines.push(`## ${md(entry.name)} (×${entry.count})`, "");
    lines.push(`Pages: ${entry.pages.map((page) => `\`${code(page)}\``).join(", ")}`);
    if ((entry.signatures || []).length > 0) lines.push(`Fingerprints: ${(entry.signatures || []).map((sig) => `\`${code(sig)}\``).join(", ")}`);
    if ((entry.examples || []).length > 0) lines.push(`Examples: ${(entry.examples || []).map((example) => md(example)).join("; ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

// CF35-2: layout-carrying REBUILD helpers (dependency-free, no imports).
// describeColumns turns an observed grid-columns value into a rebuild-ready
// spec ("2 columns: 729.469px + 530.516px"); 'none'/single/empty means the
// section rendered as one column. Raw tokens are preserved verbatim so
// evidence (e.g. "729") stays greppable. Never invents: unknown input falls
// back to "single column" only for the explicit single-value cases.
function describeColumns(columns) {
  const raw = String(columns ?? "").trim();
  if (!raw || /^(none|single)$/i.test(raw)) return "single column";
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return `single column (\`${code(raw)}\`)`;
  return `${tokens.length} columns: ${tokens.join(" + ")}`;
}

function hasLayoutEvidence(layout) {
  if (!layout || typeof layout !== "object") return false;
  if (Number.isFinite(Number(layout.y)) && String(layout.y) !== "") return true;
  if (Number.isFinite(Number(layout.height)) && String(layout.height) !== "") return true;
  const cols = String(layout.columns ?? "").trim();
  if (cols && !/^(none|single)$/i.test(cols)) return true;
  if (String(layout.background ?? "").trim()) return true;
  if (Array.isArray(layout.components) && layout.components.length > 0) return true;
  if (String(layout.textAlign ?? "").trim()) return true;
  return false;
}

// Largest observed heading role on the page by font size (fallback: first
// heading sample). Returns the semanticStyles sample or null when no
// heading role was sampled — callers render an honest fallback, never type
// pulled from frequency or thin air.
function largestHeadingType(page) {
  const headings = (page?.semanticStyles || []).filter((sample) => sample && String(sample.role || "").startsWith("heading"));
  if (headings.length === 0) return null;
  const size = (sample) => parsePx(sample?.fontSize) ?? 0;
  return [...headings].sort((a, b) => size(b) - size(a))[0];
}

// CF17: ordered agent build spec — global theme, then sections in order with
// copy, layout, assets, and behaviors, then explicit known gaps.
// CF34-local ordering: 1) Tokens refs (data/tokens.json aliases),
// 2) Layout shell (observed nav/footer), 3) per-section blocks with
// screenshot path + token refs + copy + acceptance checkbox each.
function buildRebuildMd(analysis, pages, assets, inventory, components) {
  const lines = [`# Rebuild guide — ${md(analysis.request.hostname)}`, ""];
  lines.push(`Source: ${md(analysis.request.url)}. Rebuild desktop-first at ${pages[0]?.viewport?.width || 1440}px, then verify at 390px where mobile captures exist. Apply \`theme.css\` values first (prefer \`observed\` confidence). Heading wraps (⏎) are marked in \`information-architecture.md\`; raw indices in \`data/pages.json\` \`headings[].breaks\`.`, "");
  // 1) Tokens first: aliases ride alongside raw token-N keys, never replace them.
  const aliases = aliasInventory(inventory || tokenInventory(pages), pages);
  const aliasRefs = Object.entries(aliases).map(([name, value]) => `${name} \`${code(value)}\``).join(", ");
  lines.push("## 1. Tokens — apply before any section", "");
  lines.push(`Apply \`theme.css\` values first (prefer \`observed\` confidence). Canonical source: \`data/tokens.json\` (\`aliases\` + per-category token-N keys); semantic samples in \`design-tokens.md\` under "Key observed roles".${aliasRefs ? ` Observed aliases: ${aliasRefs}.` : " No semantic aliases observed."}`);
  lines.push("");
  // 2) Layout shell: observed chrome shared across pages.
  // CF35-3: authoritative body background from observed page canvas color.
  // surface/* tokens are section/card surfaces, never the page.
  lines.push("## 2. Layout shell — nav/footer chrome", "");
  const shellPages = (pages || []).filter((page) => page.nav && (page.nav.header?.length || page.nav.primary?.length || page.nav.footer?.length));
  if (shellPages.length === 0) {
    lines.push("(no observed navigation chrome — every page ships sections only; verify against the live page)");
  } else {
    for (const page of shellPages) {
      const nav = page.nav || {};
      const fmt = (links) => (links || []).map((link) => `${link.text || link.href || "(unlabelled)"}`).join(" / ") || "—";
      lines.push(`- \`${code(page.path)}\` header: ${md(fmt(nav.header))}; primary: ${md(fmt(nav.primary))}; footer: ${md(fmt(nav.footer))} (observed navigation; full hrefs in \`data/navigation.json\`)`);
    }
  }
  const canvasByPage = (pages || []).map((page) => ({ path: page.path, color: pageCanvasBackground(page) })).filter((entry) => entry.color);
  if (canvasByPage.length === 0) {
    lines.push("Body background: body background not observed — no page canvas color captured; verify against the live page and screenshots before choosing a body background.");
  } else {
    const distinct = [...new Set(canvasByPage.map((entry) => entry.color))];
    if (distinct.length === 1) {
      lines.push(`Body background: \`${code(distinct[0])}\` (observed page canvas — paint <body> this FIRST; surface/* tokens are section/card surfaces, not the page)`);
    } else {
      for (const entry of canvasByPage) lines.push(`Body background (\`${code(entry.path)}\`): \`${code(entry.color)}\` (observed page canvas — paint <body> this FIRST; surface/* tokens are section/card surfaces, not the page)`);
    }
  }
  lines.push("");
  // 3) Per-section blocks in document order.
  pages.forEach((page) => {
    const sections = page.content?.sections || [];
    const layouts = page.sectionLayouts || [];
    const shots = page.sectionShots || [];
    const pageAssets = assets.filter((asset) => asset && asset.usedOn === page.url);
    sections.slice(0, 20).forEach((section, index) => {
      const layout = layouts[index] || {};
      const heading = typeof section.heading === "string" ? section.heading : section.heading?.text;
      lines.push(`## Section ${index + 1}: ${md(heading || "Untitled")} (\`${code(page.path)}\`)`, "");
      const shot = shots[index];
      const shotRef = shot ? shotPath(page, "section", index, shot) : `screenshots/sections/${slug(page.path)}-${index + 1}.webp`;
      lines.push(`Screenshot: \`${code(shotRef)}\`${shot ? ` (${shot.width || "?"}×${shot.height || "?"})` : " (expected capture path; no binary in this pack)"} — match geometry against \`data/layout.json\`.`);
      const styles = section.sectionStyles || {};
      const styleBits = [`bg \`${code(styles.backgroundColor || layout.background || "transparent")}\``, `text \`${code(styles.color || "inherit")}\``, `font \`${code(styles.fontSize || "inherit")}\``, `padding \`${code(styles.padding || "inherit")}\``, `radius \`${code(styles.borderRadius || "inherit")}\``].join(", ");
      lines.push(`Tokens: see \`data/tokens.json\` aliases${aliasRefs ? ` (${aliasRefs})` : ""}; section style: ${styleBits}.`);
      const copy = (page.content?.blocks || []).filter((block) => block.sectionIndex === index).slice(0, 8);
      const copyText = copy.map((block) => md(block.text).slice(0, 120)).join(" / ") || (section.textExcerpt ? md(section.textExcerpt).slice(0, 300) : "(see pages/*.md for verbatim text)");
      lines.push(`Copy: ${copyText}`);
      // CF35-2: observed geometry per section — position, columns spec,
      // background, components, and the page's largest heading type. Absent
      // layout renders an honest fallback, never invented single-column copy.
      if (!hasLayoutEvidence(layout)) {
        lines.push(`Layout: layout not observed — no section geometry captured for this section; verify against \`${code(shotRef)}\` and the live page.`);
      } else {
        const yNum = Number(layout.y);
        const hNum = Number(layout.height);
        const position = Number.isFinite(yNum) && Number.isFinite(hNum)
          ? `position y=${layout.y}px, height=${layout.height}px`
          : Number.isFinite(yNum)
            ? `position y=${layout.y}px, height not observed`
            : Number.isFinite(hNum)
              ? `position y not observed, height=${layout.height}px`
              : `position not observed`;
        const columnsSpec = describeColumns(layout.columns);
        const bg = String(layout.background ?? "").trim() ? `\`${code(layout.background)}\`` : "not observed";
        const comps = (layout.components || []).map((c) => `${c.kind || "node"} ${c.w ?? "?"}x${c.h ?? "?"}`).join(", ") || "no observed components";
        const align = String(layout.textAlign ?? "").trim() ? `, align ${md(layout.textAlign)}` : "";
        lines.push(`Layout: ${position}; columns ${columnsSpec}${align}; background ${bg}; components: ${md(comps)}`);
      }
      const typeSample = largestHeadingType(page);
      if (typeSample) {
        lines.push(`Type: ${md(typeSample.role)} — ${md(typeSample.fontFamily || "unknown family")} ${code(typeSample.fontSize || "?")}, weight ${code(typeSample.fontWeight || "?")}, tracking ${code(typeSample.letterSpacing || "?")} (largest observed heading role on \`${code(page.path)}\`)`);
      } else {
        lines.push(`Type: type not observed on this page — no heading semanticStyles sampled; verify against the live page.`);
      }
      const local = pageAssets.filter((asset) => asset.source === "downloaded" && asset.localPath);
      const refs = pageAssets.filter((asset) => asset.source !== "downloaded").length;
      lines.push(`Assets: ${local.map((asset) => `prefer \`${code(asset.localPath)}\``).join(", ") || "no downloaded assets"}${refs > 0 ? `; ${refs} URL reference(s) — recreate, do not hotlink` : ""}`);
      const tabs = (page.content?.tabSets || []).map((set) => set.tabs.map((tab) => `${tab.label}${tab.selected ? "*" : ""}`).join("/")).join("; ");
      if (tabs) lines.push(`Tabs: ${md(tabs)} (* = default; show all panels unless only one is visible)`);
      lines.push(`- [ ] Section ${index + 1} matches \`${code(shotRef)}\` at ${pages[0]?.viewport?.width || 1440}px with tokens above and verbatim copy.`);
      lines.push("");
    });
  });
  if ((components || []).length > 0) {
    lines.push("## Components — build once, reuse", "");
    for (const entry of components) lines.push(`- ${md(entry.name)} ×${entry.count} on ${entry.pages.map((page) => `\`${code(page)}\``).join(", ")} (see \`components.md\` + \`data/components.json\`)`);
    lines.push("");
  }
  const skipped = assets.filter((asset) => asset && asset.source !== "downloaded");
  const reasons = {};
  for (const asset of skipped) reasons[asset.skipReason || "unknown"] = (reasons[asset.skipReason || "unknown"] || 0) + 1;
  lines.push("## Known gaps", "");
  lines.push(`- ${skipped.length} reference-only asset(s): ${Object.entries(reasons).map(([reason, count]) => `${count}× ${reason}`).join(", ") || "none"}.`);
  for (const line of analysis.limitations || []) lines.push(`- Limitation: ${md(line).slice(0, 200)}`);
  lines.push("", "Verify each section against `data/layout.json` and `screenshots/` before calling the rebuild done.");
  return lines.join("\n");
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
    (page.videoShots || []).forEach((shot, index) => add(page, "video", index, shot, shotPath(page, "video", index, shot)));
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

function pageMarkdown(page) {  const blocks = page.content?.blocks || [];
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
  const motion = pages.map((page) => `## ${md(page.path)}\n\nTransitions:\n${(page.motion?.transitions || []).map((item) => `- ${md(item.property)} — ${md(item.duration)} ${md(item.easing)} delay ${md(item.delay)}`).join("\n") || "- none observed"}\n\nAnimations:\n${(page.motion?.animations || []).map((item) => `- ${md(item.name)} — ${md(item.duration)} ${md(item.easing)} delay ${md(item.delay)}`).join("\n") || "- none observed"}\n\nKeyframes: ${(page.motion?.keyframes || []).map(md).join(", ") || "none observed"}\n\nRotating text (heading re-sample ~5s later):\n${(page.content?.rotatingText || []).map((item) => `- ${md(item.label)}: "${md(item.before)}" → "${md(item.after)}" — cycle through these variants on a timer, do not ship a static headline`).join("\n") || "- no heading-text rotation observed"}`).join("\n\n");
  // CF34-local: timeline rows + per-page tables with one GSAP snippet per
  // animated row; machine-readable source ships as data/motion.json.
  const timeline = motionTimeline(pages);
  const timelineMd = motionTimelineMd(pages, timeline);
  const hover = pages.map((page) => `## ${md(page.path)}\n\n${(page.hoverStates || []).map((state) => `- ${code(state.trigger)} \`${code(state.selector)}\` → ${(state.changedProperties || []).map(code).join(", ") || "unspecified changes"}`).join("\n") || "- no hover/focus/active rules observed"}`).join("\n\n");
  const responsive = pages.map((page) => {
    const comparison = page.responsiveComparison;
    return `## ${md(page.path)}\n\nStatus: ${md(comparison?.status || "unknown")}${comparison?.status === "dom-only" ? " — DOM comparison from an extract-only 390px pass; no mobile screenshot" : ""}\n\nDesktop: ${comparison?.desktopViewport?.width || page.viewport?.width || "unknown"}×${comparison?.desktopViewport?.height || page.viewport?.height || "unknown"}; mobile: ${comparison?.mobileViewport ? `${comparison.mobileViewport.width}×${comparison.mobileViewport.height}` : "not captured"}.\n\n${md(comparison?.note || "No comparison available.")}\n\n${(comparison?.layoutChanges || []).filter((item) => item.changed).map((item) => `- ${md(item.role)}: ${item.desktop ? `${item.desktop.width}×${item.desktop.height} ${md(item.desktop.display)} columns ${md(item.desktop.columns)}` : "not present"} → ${item.mobile ? `${item.mobile.width}×${item.mobile.height} ${md(item.mobile.display)} columns ${md(item.mobile.columns)}` : "not present"}`).join("\n") || "No differences in the sampled layout roles."}`;
  }).join("\n\n");
  const assetLines = assets.map((asset) => `- [${md(asset.kind)}] ${md(asset.url)} — ${md(asset.alt)} (used on ${md(asset.usedOn)})${asset.source === "downloaded" && asset.localPath ? ` — downloaded to \`${code(asset.localPath)}\`` : ""}${(asset.kind === "video" || asset.kind === "audio") && asset.readyState != null && asset.readyState < 2 ? " — first frame not ready at capture" : ""}`);
  const downloadedAssets = assets.filter((asset) => asset && asset.source === "downloaded" && typeof asset.localPath === "string");
  const downloadedPosters = downloadedAssets.filter((asset) => asset.kind === "poster");
  const downloadedSvgs = downloadedAssets.filter((asset) => asset.kind !== "poster");
  const embedLines = pages.flatMap((page) => (page.embeds || []).map((embed) => `- [${md(embed.kind)}] ${md(embed.domain)} — ${md(embed.url)}${embed.title ? ` — "${md(embed.title)}"` : ""} (embedded on ${md(page.path)})`));
  const videoLines = pages.flatMap((page) => (page.videos || []).map((video) => `- ${md(page.path)}: \`${code(video.url || "inline")}\`${video.poster ? ` — poster \`${code(video.poster)}\`` : " — no poster captured"}${video.autoplay ? " — autoplay" : ""}${video.muted ? " muted" : ""}${video.loop ? " loop" : ""}${video.playsinline ? " playsinline" : ""} — render the poster frame; wire tap/click-to-play, never a blank band`));
  const playingLines = pages.flatMap((page) => (page.videoShots || []).map((shot, index) => {
    const section = sectionIndexForShot(page.sectionLayouts, shot.y);
    const place = section >= 0
      ? ` — belongs in section ${section + 1}; composite over the blank video band near page y≈${shot.y}px`
      : "";
    return `- ${md(page.path)}: \`${code(shotPath(page, "video", index, shot))}\` (${shot.width}×${shot.height})${shot.label ? ` — ${md(shot.label)}` : ""} — motion-verified playing-state frame (in-page autoplay, click-to-play, or isolated player render); paused reference, wire tap-to-replay${place}`;
  }));
  // CF25: fetched thumbnails stand in for facades that never played. They
  // composite over the same blank bands (placement rides the thumbnail
  // entry), but the wording never claims a playing state. Asset files ship
  // under assets/ via the normal poster fan-out; match them by label.
  const thumbnailAssetByLabel = new Map();
  for (const asset of assets) {
    if (asset?.kind !== "poster" || asset?.source !== "downloaded" || typeof asset?.localPath !== "string") continue;
    const match = /^Fetched video thumbnail for '(.*)'$/.exec(String(asset.alt || ""));
    if (match) thumbnailAssetByLabel.set(match[1], asset.localPath);
  }
  const thumbnailLines = pages.flatMap((page) => (page.videoThumbnails || []).map((shot) => {
    const label = String(shot.label || "").startsWith("thumbnail: ") ? String(shot.label).slice(11) : String(shot.label || "video");
    const section = sectionIndexForShot(page.sectionLayouts, shot.y);
    const place = section >= 0
      ? ` — belongs in section ${section + 1}; composite over the blank video band near page y≈${shot.y}px`
      : "";
    const file = thumbnailAssetByLabel.get(label);
    return `- ${md(page.path)}: ${file ? `\`${code(file)}\` ` : ""}(${shot.width}×${shot.height}) — ${md(shot.label || "thumbnail")}${place} — fetched fallback thumbnail, not a playing-state frame; prefer live embed, wire tap-to-play`;
  }));
  const pageEmbeds = pages.flatMap((page) => (page.embeds || []).map((embed) => ({ ...embed, embeddedOn: page.path })));
  const coverage = pages.flatMap((page) => coverageList(page).map(([key, item]) => `- ${md(page.path)} / ${md(key)}: ${item.emittedCount}/${item.sourceCount}; cap ${item.cap}${item.deduplicatedCount ? `; ${item.deduplicatedCount} collapsed` : ""}; ${item.truncated ? `partial (${md(item.reason || "truncated")})` : "complete within cap"}`));
  const docs = {
    "README.md": `# Website analysis — ${md(analysis.request.hostname)}\n\nSource: ${md(analysis.request.url)}  \nPages: ${analysis.pagesAnalyzed}/${analysis.pagesSelected} selected; ${analysis.pagesDiscovered} discovered  \nScreenshot captures: ${analysis.screenshotsCaptured}; binaries included: ${manifest.shots.filter((shot) => shot.hasBinary).length}/${manifest.shots.length}  \nBrowser time: ${analysis.browserSecondsUsed}s  \nObservation status: ${analysis.integrityPassed ? "valid" : "partial/failed"}\n\n## Analyzed pages\n\n${pageRows.join("\n")}\n\n## Important interpretation\n\nJSON records are canonical bounded observations. Samples are evidence, not exhaustive CSS or interaction replay. See \`data/report.json\` for caps, omissions, warnings, and confidence.\n`,
    "website-overview.md": `# Website overview\n\n${md(pages[0]?.title || analysis.request.hostname)} at ${md(analysis.request.url)}.\n${pages[0]?.social?.ogTitle ? `\nShare title: ${md(pages[0].social.ogTitle)}\n` : ""}${pages[0]?.social?.ogDescription ? `\nShare description: ${md(pages[0].social.ogDescription)}\n` : ""}${stackInfo.marks.length > 0 || stackInfo.generator ? `\nDetected stack: ${stackInfo.marks.join("; ") || "unknown"}${stackInfo.generator && !stackInfo.marks.join(" ").toLowerCase().includes(stackGenFirst.toLowerCase()) ? ` — generator meta: ${md(stackInfo.generator)}` : ""}\n` : ""}${pages[0]?.social?.themeColor ? `\nTheme color: \`${code(pages[0].social.themeColor)}\`\n` : ""}\n${pageRows.join("\n")}\n\nObserved primary navigation is in \`data/navigation.json\`; observed affordances are in \`data/interactions.json\`.\n`,
    "information-architecture.md": `# Information architecture\n\n⏎ marks where a heading wraps to a new rendered line at the captured viewport — reproduce these breaks (raw word indices in \`data/pages.json\` \`headings[].breaks\`).\n\n${pages.map((page) => `## ${md(page.title)} (\`${code(page.path)}\`)\n\n${(page.headings || []).map((heading) => `${"#".repeat(Math.min(Math.max(heading.level, 1), 6))} ${md(withBreaks(heading))}${heading.truncated ? " _(heading clipped; see capture coverage)_" : ""}`).join("\n")}\n`).join("\n")}`,
    "design-tokens.md": `# Design tokens\n\nTokens are frequency-ranked observations across the selected pages, with source/confidence. Values are not asserted to be a complete design system.\n\n## Key observed roles\n\n${keyRoles(pages, inventory).join("\n") || "No semantic style samples observed."}\n\n## All observed values\n\n${categoryRows.join("\n")}\n\n${tokenRows.join("\n") || "No token values observed."}\n\nSemantic samples by page/role are in \`data/tokens.json\`.\n`,
    "typography.md": `# Typography\n\nTypeface usage is ranked from computed-style sampling (inferred confidence); \`@font-face\` declarations are observed where stylesheets are accessible.\n\n${pages.map((page) => `## ${md(page.path)}\n\nFont faces:\n${(page.typography?.fontFaces || []).map((face) => `- ${md(face.family)} — ${md(face.weight)}; ${md(face.src)}`).join("\n") || "- none observed"}\n\nTypefaces in use:\n${(page.typography?.fontFamilies || []).map((entry) => `- \`${code(entry.value)}\` — ${entry.count} sampled elements; ${code(entry.confidence)}`).join("\n") || "- none observed"}\n\nSemantic samples:\n${(page.semanticStyles || []).map((sample) => `- ${md(sample.role)}: ${md(sample.fontFamily)} ${md(sample.fontSize)} / ${md(sample.lineHeight)}, weight ${md(sample.fontWeight)}, tracking ${md(sample.letterSpacing)}`).join("\n") || "- none observed"}`).join("\n\n")}\n`,
    "content-style.md": `# Content and voice\n\nTone summaries are page-level heuristics. Verbatim visible text is below; inspect \`data/pages.json\` for order, roles, controls, and per-collection completeness. Initially hidden/collapsed DOM copy is separately labelled and was not treated as visible or activated.\n\n${allBlocks.join("\n\n") || "No content blocks observed."}\n\n## Initially hidden or collapsed copy\n\n${hiddenBlocks.join("\n\n") || "No hidden semantic copy observed."}\n`,
    "imagery-and-video.md": `# Imagery and video\n\nAssets (${assets.length} listed of ${analysis.assetCount} observed):\n\n${assetLines.join("\n") || "No media assets observed."}\n\n${downloadedSvgs.length > 0 ? `${downloadedSvgs.length} SVG asset(s) were downloaded at capture time and ship under \`assets/\` — prefer the local copy, with the remote URL as fallback: ${downloadedSvgs.map((asset) => `\`${code(asset.localPath)}\``).join(", ")}. ` : "No SVG assets were downloaded at capture time. "}${downloadedPosters.length > 0 ? `${downloadedPosters.length} poster asset(s) (video frames) were downloaded at capture time and ship under \`assets/\`: ${downloadedPosters.map((asset) => `\`${code(asset.localPath)}\``).join(", ")}. ` : ""}Remaining media entries are URL references only; raster binaries were not fetched. Motion note: videos are URL references and canvas scenes are single static frames — treat screenshots of those regions as posters, not the experience.\n\n## Videos\n\n${videoLines.join("\n") || "No video elements observed."}\n\n## Playing-state captures\n\n${playingLines.join("\n") || "No playing-state captures (facades never played in-page or isolated, or the run predates video capture)."}\n\n## Fallback thumbnails\n\n${thumbnailLines.join("\n") || "No fallback thumbnails (every played facade rendered, or no thumbnail resolved)."}\n\n## Embedded frames\n\n${embedLines.join("\n") || "No embedded frames observed."}\n`,
    "motion-and-interactions.md": `# Motion and interactions\n\nTransitions, animations, and keyframe names are computed/CSSOM observations; JavaScript-driven interactions were not replayed.\n\n${motion}\n\n## Motion timeline\n\nMachine-readable source: \`data/motion.json\`. One row per observed transition, animation, or declared keyframe; \`scrollTrigger\` is \`unknown\` unless sticky/fixed rules were observed on the page (marked inferred — verify against the live page).\n\n${timelineMd}\n\nRebuild each animated block with GSAP using the observed timings above (replace the prop placeholders with the observed end-state). Nothing was replayed; verify against the live page.\n\n## Hover and focus states\n\nDeclared hover/focus/active rules are static CSS evidence of state changes; nothing was hovered or activated during capture.\n\n${hover}\n\n## Interaction affordances\n\n${interactions.join("\n") || "None detected."}\n\nBehavior was not clicked or replayed. Structured controls and ARIA relationships are in \`data/interactions.json\`.\n`,
    "responsive-behavior.md": `# Responsive behavior\n\nEvidence is limited to CSS media queries plus actual desktop/mobile observations where mobile capture succeeded.\n\nMobile comparison with screenshots: ${pages.filter((page) => page.responsiveComparison?.status === "captured").map((page) => `\`${code(page.path)}\``).join(", ") || "none"}. DOM-only comparison (extract-only 390px pass, no screenshot): ${pages.filter((page) => page.responsiveComparison?.status === "dom-only").map((page) => `\`${code(page.path)}\``).join(", ") || "none"}. No comparison: ${pages.filter((page) => page.responsiveComparison?.status !== "captured" && page.responsiveComparison?.status !== "dom-only").map((page) => `\`${code(page.path)}\` (${code(page.responsiveComparison?.status || "unknown")})`).join(", ") || "none"}. Screenshot binaries are limited to the homepage plus one representative page by the Free-tier screenshot budget; DOM-only passes cost browser time instead of bytes.\n\n${pages.map((page) => `## ${md(page.path)}\n\n${(page.breakpoints?.mediaQueries || []).map((entry) => `- ${md(entry.query)} → ${entry.changedProperties.map(md).join(", ")}`).join("\n") || "No accessible media-query rules observed."}`).join("\n\n")}\n\n${responsive}\n`,
    "implementation-plan.md": `# Reconstruction guidance\n\nSource: ${md(analysis.request.url)}. Rebuild desktop-first at 1440px, then verify at 390px where mobile captures exist.\n\n## 1. Apply the observed theme\n\n- Paste \`theme.css\` (or \`tailwind.config.js\`) values; every value carries source/confidence — prefer \`observed\` over \`inferred\`.\n- Body text/background and heading/button roles are mapped in \`design-tokens.md\` under "Key observed roles".\n\n## 2. Rebuild pages in priority order\n\n${pages.map((page) => {
    const desktop = page.screenshot ? `\`${shotPath(page, "desktop", null, page.screenshot)}\` (${page.screenshot.width}×${page.screenshot.height})` : "no desktop capture";
    const mobile = page.mobileScreenshot ? `; mobile \`${shotPath(page, "mobile", null, page.mobileScreenshot)}\` (${page.mobileScreenshot.width}×${page.mobileScreenshot.height})` : page.responsiveComparison?.status === "dom-only" ? "; DOM-only mobile comparison, no screenshot" : "; no mobile capture";
    const partial = coverageList(page).filter(([, item]) => item.truncated).map(([name, item]) => `${name} (${item.emittedCount}/${item.sourceCount}; ${item.reason || "capped"})`);
    return `- \`${code(page.path)}\` — implement from \`pages/${slug(page.path)}.md\`; reference ${desktop}${mobile}. ${(page.content?.components || []).length} component patterns, ${(page.content?.controls || []).length} controls. Coverage: ${partial.length > 0 ? "PARTIAL — " + partial.map((entry) => code(entry)).join("; ") : "complete within caps"}.`;
  }).join("\n")}\n\n## 3. Components and interactions\n\n- Repeat patterns: \`data/components.json\` (occurrence counts plus representative examples per page).\n- Static affordances: \`data/interactions.json\`. Nothing was clicked or replayed — implement behavior intentionally.\n\n## 4. Verify and record gaps\n\n- Compare at the recorded viewport sizes against \`screenshots/\`.\n- Any collection marked partial in \`data/report.json\` coverage is incomplete evidence, not an exhaustive spec.\n`,
    "data/pages.json": json(pages.map(cleanPage)),
    "data/tokens.json": json(w3cTokens(inventory, analysis)),
    "data/components.json": json({ schemaVersion: analysis.schemaVersion, components: componentInventory(pages), pages: pages.map((page) => ({ path: page.path, count: page.content?.components?.length || 0, sourcePatterns: page.content?.coverage?.components || null, patterns: page.content?.components || [] })), note: "Pattern fingerprints are heuristics based on semantic structure and safe class hints; not a source framework component tree. components[] groups fingerprints + repeated section roles with count >= 2." }),
    "components.md": buildComponentsMd(componentInventory(pages)),
    "data/navigation.json": json({ homepage: analysis.request.url, selectedPages: (analysis.selection?.candidates || []).filter((candidate) => candidate.selected).map((candidate) => ({ path: candidate.path, url: candidate.url, label: candidate.label, priority: candidate.priority, reason: candidate.reason })), observed: pages.map((page) => ({ path: page.path, header: page.nav?.header || [], primary: page.nav?.primary || [], footer: page.nav?.footer || [] })) }),
    "data/selection.json": json(analysis.selection || { maxPages: analysis.request.maxPages, pagesDiscovered: analysis.pagesDiscovered, pagesSelected: analysis.pagesSelected, candidates: [] }),
    "data/interactions.json": json({ schemaVersion: analysis.schemaVersion, pages: pages.map((page) => ({ path: page.path, affordances: page.observedInteractions || [], hoverStates: page.hoverStates || [], controls: page.content?.controls || [], formActions: page.formActions || [], coverage: { controls: page.content?.coverage?.controls || null, interactions: page.content?.coverage?.interactions || null }, limitation: "Static DOM affordances and declared CSS state rules only; no source JavaScript behavior was replayed, no form was submitted." })) }),
    "data/motion.json": json({ schemaVersion: analysis.schemaVersion, timeline, pages: pages.map((page) => ({ path: page.path, rows: timeline.filter((row) => row.page === page.path), scrollTriggersInferred: timeline.some((row) => row.page === page.path && String(row.scrollTrigger).startsWith("inferred")) })), note: "One row per observed transition/animation/keyframe; scrollTrigger is 'unknown' unless sticky/fixed rules were observed (marked inferred). Timings are observed CSS values; GSAP snippets in motion-and-interactions.md are rebuild transcriptions, never replayed behavior." }),
    "data/assets.json": json({ assets: assets.map((asset) => asset && (asset.content instanceof Uint8Array || typeof asset.dataUrl === "string") ? { ...asset, content: undefined, dataUrl: undefined } : asset), count: assets.length, sourceCount: analysis.assetCount, complete: assets.length === analysis.assetCount, embeds: pageEmbeds, embedCount: pageEmbeds.length }),
    "data/report.json": json({ schemaVersion: analysis.schemaVersion, sourceUrl: analysis.request.url, pagesDiscovered: analysis.pagesDiscovered, pagesSelected: analysis.pagesSelected, pagesAnalyzed: analysis.pagesAnalyzed, screenshotsCaptured: analysis.screenshotsCaptured, screenshotBytesCaptured: analysis.screenshotBytesTotal, screenshotBinariesIncluded: manifest.shots.filter((shot) => shot.hasBinary).length, browserSecondsUsed: analysis.browserSecondsUsed, timings: analysis.timings, issues: analysis.issues, warnings: analysis.warnings, limitations: analysis.limitations, coverage, observationIntegrityPassed: analysis.integrityPassed, packageIntegrityPassed: true }),
    "screenshots/manifest.json": json(manifest),
    "data/layout.json": json(buildLayout(pages)),
    "REBUILD.md": buildRebuildMd(analysis, pages, assets, inventory, componentInventory(pages)),
  };
  const { theme, tailwind } = themeFiles(inventory, pages);
  docs["theme.css"] = theme;
  docs["tailwind.config.js"] = tailwind;
  // CF36-2 (additive): fonts.css wires downloaded @font-face files; the
  // assets/fonts/* binaries themselves ride the existing fan-out below.
  docs["fonts.css"] = fontsCss(assets);
  // CF34-local Task 5 (additive): theme.v2 + v4 @theme + responsive pairs + SVG overlays.
  const { themeV2, tailwindV4 } = themeV2Files(inventory, pages);
  docs["theme.v2.css"] = themeV2;
  docs["tailwind.theme.mjs"] = tailwindV4;
  docs["data/responsive-pairs.json"] = json(buildResponsivePairs(pages, analysis.schemaVersion));
  for (const [zipPath, svg] of Object.entries(buildAnnotatedOverlays(pages))) docs[zipPath] = svg;
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
  // CF13: downloaded SVG text rides the manifest (data/assets.json keeps the
  // full entries, content included) and is fanned out here into inert
  // assets/ files for the ZIP. Strings are valid file contents: the ZIP
  // writers (worker createStoreZip, web vendor mirror) UTF-8 encode them.
  // CF14: downloaded poster rasters ride as Uint8Array bytes (never
  // text-decoded); the ZIP writer stores raw bytes. data/assets.json keeps
  // metadata only so binaries are never duplicated into JSON.
  // Poster bytes cannot cross the JSON API as Uint8Array, so the pipeline
  // re-encodes them as dataUrl strings (local dev, like screenshots); decode
  // them back here. data/assets.json strips dataUrl for the same reason it
  // strips raw bytes.
  // CF36-2: font binaries ride the exact same two branches above
  // (Uint8Array content or dataUrl wire form into assets/fonts/*) — verified,
  // no new branch needed; fonts.css references the emitted localPaths.
  const sizeOf = (contents) => contents instanceof Uint8Array ? contents.byteLength : new TextEncoder().encode(contents).byteLength;
  for (const asset of assets) {
    if (asset && asset.source === "downloaded" && typeof asset.localPath === "string" && (typeof asset.content === "string" || asset.content instanceof Uint8Array)) {
      files[asset.localPath] = asset.content;
    } else if (asset && asset.source === "downloaded" && typeof asset.localPath === "string" && typeof asset.dataUrl === "string") {
      const bytes = dataUrlBytes(asset.dataUrl);
      if (bytes) files[asset.localPath] = bytes;
    }
  }
  const validationIssues = validateDocumentationPackage(files, screenshotFiles);
  if (validationIssues.length > 0) throw new Error(`Generated documentation failed validation: ${validationIssues.join("; ")}`);
  const byteLength = Object.values(files).reduce((total, contents) => total + sizeOf(contents), 0);
  if (byteLength > MAX_DOCUMENTATION_BYTES) {
    // Failure-path-only accounting: rank files so the error tells the user
    // WHERE the weight is (usually data/pages.json + content-style.md +
    // data/selection.json on news-scale sites), not just the total.
    const ranked = Object.entries(files)
      .map(([name, contents]) => [name, sizeOf(contents)])
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
  const required = ["data/pages.json", "data/tokens.json", "data/selection.json", "data/components.json", "data/navigation.json", "data/interactions.json", "data/assets.json", "data/report.json", "data/layout.json", "REBUILD.md", "screenshots/manifest.json", "theme.css", "tailwind.config.js", "README.md"];
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
    if (Array.isArray(assets.assets)) {
      for (const asset of assets.assets) {
        if (asset && asset.source === "downloaded" && !(typeof asset.localPath === "string" && asset.localPath in files)) {
          issues.push(`Downloaded asset missing file entry: ${asset.localPath || asset.url}`);
        }
      }
    }
    const manifest = JSON.parse(files["screenshots/manifest.json"] || "{}");
    const layout = JSON.parse(files["data/layout.json"] || "{}");
    const rebuild = files["REBUILD.md"] || "";
    for (const page of pages) {
      // buildLayout caps sections at 20 per page; mirror the cap here, and
      // skip pages from captures that predate sectionLayouts entirely.
      const expected = Math.min((page.content?.sections || []).length, 20);
      const got = (layout.pages || []).find((entry) => entry.path === page.path);
      if (got && page.sectionLayouts && got.sections.length !== expected) issues.push(`Layout section count mismatch for ${page.path}: layout.json has ${got.sections.length}, pages.json has ${expected}.`);
    }
    const headers = (rebuild.match(/^## Section \d+: /gm) || []).length;
    // buildRebuildMd caps sections at 20 per page, like buildLayout.
    const wanted = pages.reduce((total, page) => total + Math.min((page.content?.sections || []).length, 20), 0);
    if (headers !== wanted) issues.push(`REBUILD.md has ${headers} section headers for ${wanted} content sections.`);
    const binaryPaths = new Set(Object.keys(screenshotFiles));
    for (const shot of manifest.shots || []) {
      const exists = binaryPaths.has(shot.zipPath);
      if (Boolean(shot.hasBinary) !== exists) issues.push(`Screenshot manifest mismatch: ${shot.zipPath} hasBinary=${Boolean(shot.hasBinary)}, ZIP entry present=${exists}`);
    }
    for (const name of binaryPaths) if (!manifest.shots?.some((shot) => shot.zipPath === name && shot.hasBinary)) issues.push(`Unindexed screenshot binary: ${name}`);
  } catch { /* invalid JSON is reported above */ }
  return issues;
}
