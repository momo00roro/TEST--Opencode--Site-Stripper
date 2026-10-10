// CF44 expansion adherence: does new work stay inside the pack's UI system?
// node scripts/eval/expand-check.mjs --pack <PACK> --rebuild <DIR> [--base <CLEAN-CLONE-DIR>] [--label n]
// Checks: anti-cheat (no <script>, no external URLs) + fonts ⊆ shipped faces
// + colors within tolerance of observed palette + radii on observed scale +
// every HTML page renders error-free at 1440px with no h-overflow at 390px.
// With --base, only NEW violations vs the clean clone fail the run.
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import puppeteer from "file:///C:/Users/Admin/Desktop/Coding-Projects/2026-09__TEST--Opencode--Site-Stripper/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "emoji", "math", "fangsong", "ui-monospace", "ui-sans-serif", "ui-serif", "ui-rounded", "inherit", "initial", "unset", "menlo", "consolas", "monaco", "courier new", "courier", "segoe ui", "roboto", "helvetica", "helvetica neue", "arial", "tahoma", "verdana", "georgia", "times new roman", "times", "apple-system", "blinkmacsystemfont", "inter fallback", "space grotesk fallback"]);
const BARE_COLOR_FNS = new Set(["rgb", "rgba", "hsl", "hsla"]);
const ALLOWED_COLOR_NAMES = new Set(["transparent", "currentcolor", "inherit", "initial", "unset", "white", "black"]);
const SHAPE_RADII = new Set(["50%", "100%", "999px", "9999px"]);

function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "1";
  }
  return out;
}

async function listFiles(dir, exts, base = dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await listFiles(full, exts, base, out);
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

function parseColor(raw) {
  let s = String(raw).trim().toLowerCase();
  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length === 4) hex = hex.slice(0, 3).split("").map((c) => c + c).join("");
    if (hex.length === 6) hex += "ff";
    if (hex.length !== 8) return null;
    const n = parseInt(hex, 16);
    return [n >> 24 & 255, n >> 16 & 255, n >> 8 & 255, (n & 255) / 255];
  }
  const m = s.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
  if (!m) return null;
  const parts = m[2].split(/[\s,]+/).filter(Boolean).map((p) => p.replace(/^\/$/, ""));
  const nums = parts.map((p) => p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p));
  if (m[1].startsWith("hsl")) {
    const h = ((nums[0] % 360) + 360) % 360 / 360;
    const s2 = Math.min(Math.max(nums[1] > 1 ? nums[1] / 100 : nums[1], 0), 1);
    const l = Math.min(Math.max(nums[2] > 1 ? nums[2] / 100 : nums[2], 0), 1);
    const f = (n) => { const k = (n + h * 12) % 12; const a = s2 * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1))); };
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255), nums[3] ?? 1];
  }
  const rgb = nums.slice(0, 3).map((v) => v <= 1 && parts.some((p) => p.includes("%")) ? Math.round(v * 255) : Math.round(v));
  return [rgb[0], rgb[1], rgb[2], nums[3] ?? 1];
}

function colorDist(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]) * 255;
}

function normRadius(raw) {
  let s = String(raw).trim().toLowerCase().split(/\s+/)[0];
  if (s.endsWith("rem")) { const v = parseFloat(s); return Number.isFinite(v) ? `${v * 16}px` : s; }
  return s;
}

async function collectViolations(dir) {
  const violations = { cheat: [], fonts: [], colors: [], radii: [] };
  const htmlFiles = await listFiles(dir, [".html"]);
  const cssFiles = await listFiles(dir, [".css"]);
  for (const file of htmlFiles) {
    const text = await readFile(file, "utf8");
    if (/<script[\s>]/i.test(text)) violations.cheat.push(`${file}: <script>`);
    const urls = [...text.matchAll(/(href|src)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[2]);
    for (const url of [...new Set(urls)].slice(0, 5)) violations.cheat.push(`${file}: external ${url}`);
  }
  const families = new Map();
  const colors = new Map();
  const radii = new Map();
  const sizes = new Map();
  for (const file of cssFiles) {
    const text = await readFile(file, "utf8");
    for (const m of text.matchAll(/font-family\s*:\s*([^;{}]+)/gi)) {
      if (m[1].includes("var(")) continue;
      for (const fam of m[1].split(",")) {
        const name = fam.trim().replace(/^["']|["']$/g, "").toLowerCase();
        if (name && !GENERIC_FAMILIES.has(name) && !name.includes("(")) families.set(name, (families.get(name) || 0) + 1);
      }
    }
    const stripped = text.replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const m of stripped.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g)) {
      const key = m[0].toLowerCase().replace(/\s+/g, "");
      colors.set(key, (colors.get(key) || 0) + 1);
    }
    for (const m of stripped.matchAll(/[a-z-]*color\s*:\s*([a-z]+)/gi)) {
      const name = m[1].toLowerCase();
      if (!ALLOWED_COLOR_NAMES.has(name) && !BARE_COLOR_FNS.has(name)) colors.set(name, (colors.get(name) || 0) + 1);
    }
    for (const m of stripped.matchAll(/border-radius\s*:\s*([^;{}]+)/gi)) {
      const key = normRadius(m[1]);
      radii.set(key, (radii.get(key) || 0) + 1);
    }
    // CF45 taste advisory: font-size steps outside the observed scale are
    // reported (never failing) — type-scale discipline is core taste, but
    // responsive sizes are legitimately novel.
    for (const m of stripped.matchAll(/font-size\s*:\s*([^;{}]+)/gi)) {
      const key = m[1].trim().toLowerCase().split(/\s+/)[0];
      if (/^[\d.]+(px|r?em|%)$/.test(key)) sizes.set(key, (sizes.get(key) || 0) + 1);
    }
  }
  return { violations, families, colors, radii, sizes, htmlFiles };
}

function paletteFromPack(packDir, pagesJson, tokensJson, fontsCss) {
  const palette = [];
  const push = (raw) => { const c = parseColor(raw); if (c) palette.push(c); };
  for (const value of Object.values(tokensJson.aliases || {})) push(value);
  for (const token of Object.values(tokensJson.colors || {})) push(token.value);
  for (const sample of tokensJson.semanticSamples || []) { push(sample.color); push(sample.backgroundColor); }
  for (const page of pagesJson.pages || pagesJson || []) {
    const p = page.pages ? page : page;
    for (const fill of p.ctaFills || []) push(fill.bg);
    for (const treatment of p.imageTreatments || []) push(treatment.tileBg);
    for (const flag of p.iconFlags || []) push(flag.color);
    if (p.pageCanvasColor) push(p.pageCanvasColor);
  }
  const radii = new Set(["0", "0px"]);
  for (const token of Object.values(tokensJson.radii || {})) radii.add(normRadius(token.value));
  for (const page of pagesJson.pages || pagesJson || []) {
    const p = page.pages ? page : page;
    for (const fill of p.ctaFills || []) if (fill.radius) radii.add(normRadius(fill.radius));
    for (const treatment of p.imageTreatments || []) if (treatment.tileRadius) radii.add(normRadius(treatment.tileRadius));
  }
  const shipped = new Set([...fontsCss.matchAll(/font-family:\s*"([^"]+)"/g)].map((m) => m[1].toLowerCase()));
  const scale = new Set(Object.values(tokensJson.fontSizes || {}).map((t) => String(t.value || "").trim().toLowerCase()).filter(Boolean));
  return { palette, radii, shipped, scale };
}

async function renderChecks(dir, htmlFiles) {
  const browser = await puppeteer.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", args: ["--no-sandbox"] });
  const results = [];
  try {
    for (const file of htmlFiles) {
      const url = "file:///" + resolve(file).replace(/\\/g, "/");
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 }).catch((e) => errors.push("load: " + String(e).slice(0, 120)));
      await new Promise((r) => setTimeout(r, 600));
      await page.setViewport({ width: 390, height: 844 });
      await new Promise((r) => setTimeout(r, 400));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      results.push({ file, errors, overflow390: overflow });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function main() {
  const { pack, rebuild, base, label } = args();
  if (!pack || !rebuild) { console.error("usage: expand-check.mjs --pack <PACK> --rebuild <DIR> [--base <DIR>] [--label n]"); process.exit(2); }
  const packDir = resolve(pack);
  const pagesJson = JSON.parse(await readFile(join(packDir, "data/pages.json"), "utf8"));
  const tokensJson = JSON.parse(await readFile(join(packDir, "data/tokens.json"), "utf8"));
  const fontsCss = await readFile(join(packDir, "fonts.css"), "utf8");
  const { palette, radii, shipped, scale } = paletteFromPack(packDir, pagesJson, tokensJson, fontsCss);

  const target = await collectViolations(resolve(rebuild));
  let baseKeys = null;
  let baseSizes = null;
  if (base) {
    const b = await collectViolations(resolve(base));
    baseKeys = new Set([...b.families.keys()].map((k) => "f:" + k).concat([...b.colors.keys()].map((k) => "c:" + k), [...b.radii.keys()].map((k) => "r:" + k)));
    baseSizes = new Set(b.sizes.keys());
  }
  const isNew = (kind, key) => !baseKeys || !baseKeys.has(kind + ":" + key);

  const fontViolations = [...target.families.keys()].filter((f) => ![...shipped].some((s) => f === s || f.startsWith(s + " ") || f.includes(s))).filter((f) => isNew("f", f));
  const colorViolations = [];
  for (const [raw] of target.colors) {
    if (ALLOWED_COLOR_NAMES.has(raw)) continue;
    const c = parseColor(raw);
    if (!c) { if (isNew("c", raw)) colorViolations.push({ raw, note: "unparsed" }); continue; }
    const best = Math.min(...palette.map((p) => colorDist(c, p)));
    if (!(best <= 36) && isNew("c", raw)) colorViolations.push({ raw, best: Math.round(best) });
  }
  const radiusViolations = [...target.radii.keys()].filter((r) => !radii.has(r) && !SHAPE_RADII.has(r)).filter((r) => isNew("r", r));

  // CF45 taste advisory (never failing): type sizes outside the observed
  // scale. Base sizes are grandfathered from the advisory too.
  const sizeAdvisory = [...target.sizes.keys()].filter((s) => !scale.has(s) && (!baseSizes || !baseSizes.has(s))).slice(0, 12);

  const renders = await renderChecks(resolve(rebuild), target.htmlFiles);
  const renderIssues = renders.filter((r) => r.errors.length > 0 || r.overflow390 > 1);

  const report = {
    label: label || "expand",
    pack: packDir,
    rebuild: resolve(rebuild),
    base: base ? resolve(base) : null,
    cheat: target.violations.cheat,
    fonts: { shipped: [...shipped], violations: fontViolations },
    colors: { paletteSize: palette.length, violations: colorViolations.slice(0, 15), total: colorViolations.length },
    radii: { observed: [...radii], violations: radiusViolations },
    typeScale: { observed: [...scale].slice(0, 20), advisoryUnobserved: sizeAdvisory },
    renders: renders.map((r) => ({ file: r.file.split("\\").pop(), errors: r.errors, overflow390: r.overflow390 })),
    pass: target.violations.cheat.length === 0 && fontViolations.length === 0 && colorViolations.length === 0 && radiusViolations.length === 0 && renderIssues.length === 0,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

await main();
