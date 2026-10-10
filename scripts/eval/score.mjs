// Pack→rebuild fidelity scorer (pixels primary, rubric secondary).
// node score.mjs --pack <packDir> --rebuild <rebuildDir> [--out report.json] [--label name]
// Pixels: each full-page and per-section comparison averages exact-pixel similarity
// with a multi-scale perceptual similarity (grids 16/32/64), so sub-glyph AA and
// small text offsets reflect perceptual fidelity instead of dominating the score.
import { createServer } from "node:http";
import { readFile, writeFile, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve, basename } from "node:path";
import sharp from "sharp";
import puppeteer from "file:///C:/Users/Admin/Desktop/Coding-Projects/2026-09__TEST--Opencode--Site-Stripper/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

function arg(name, def) { const i = process.argv.indexOf("--" + name); return i >= 0 ? process.argv[i + 1] : def; }
const PACK = resolve(arg("pack"));
const REBUILD = resolve(arg("rebuild"));
const OUT = arg("out", join(REBUILD, "..", `${basename(REBUILD)}-score.json`));
const LABEL = arg("label", basename(REBUILD));

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".json": "application/json", ".md": "text/markdown" };

async function serveAndRender(dir, width = 1440, tag = "") {
  const server = createServer(async (req, res) => {
    try { const p = req.url === "/" ? "/index.html" : decodeURIComponent(req.url.split("?")[0]); const b = await readFile(join(dir, p)); res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" }); res.end(b); }
    catch { res.writeHead(404).end("nf"); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle2", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 1200));
  const shot = join(REBUILD, "..", tag ? `${LABEL}-${tag}-render.png` : `${LABEL}-render.png`);
  await page.screenshot({ path: shot, fullPage: true });
  const html = await page.content();
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());
  const geom = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, bodyBg: getComputedStyle(document.body).backgroundColor, imgs: [...document.images].map((i) => i.getAttribute("src")) }));
  await browser.close(); server.close();
  return { shot, html, text, geom, errors };
}

async function gray(path, width) {
  const { data, info } = await sharp(path).resize({ width, fit: "inside" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const f = new Float32Array(info.width * info.height);
  for (let i = 0; i < f.length; i++) f[i] = data[i] / 255;
  return { data: f, w: info.width, h: info.height };
}
async function grayFill(path, w, h) {
  const { data, info } = await sharp(path).resize(w, h, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const f = new Float32Array(info.width * info.height);
  for (let i = 0; i < f.length; i++) f[i] = data[i] / 255;
  return { data: f, w: info.width, h: info.height };
}
function blockSSIM(a, b, w, h, block = 16) {
  const C1 = 0.01 ** 2, C2 = 0.03 ** 2; let tot = 0, n = 0;
  for (let by = 0; by + block <= h; by += block) for (let bx = 0; bx + block <= w; bx += block) {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0; const m = block * block;
    for (let y = 0; y < block; y++) for (let x = 0; x < block; x++) { const i = (by + y) * w + (bx + x); const va = a[i], vb = b[i]; sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; }
    const ma = sa / m, mb = sb / m, va = saa / m - ma * ma, vb = sbb / m - mb * mb, cov = sab / m - ma * mb;
    tot += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
  }
  return n ? tot / n : 0;
}
function pixelMatch(a, b, n, tol = 0.06) { let c = 0; for (let i = 0; i < n; i++) if (Math.abs(a[i] - b[i]) <= tol) c++; return c / n; }
// Perceptual similarity: exact-pixel SSIM is dominated by sub-glyph anti-aliasing
// and 1-3px text offsets (a clone can contain every glyph yet score low). Average
// the same SSIM/pixel-match across coarse power-of-two grids where AA vanishes,
// so the term reflects composition/colour structure rather than glyph raster.
const PERCEPTUAL_GRIDS = [16, 32, 64];
function gridAverage(a, w, h, gw, gh) {
  const out = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const x0 = Math.floor(x * w / gw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / gw));
    const y0 = Math.floor(y * h / gh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * h / gh));
    let s = 0, n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += a[yy * w + xx]; n++; }
    out[y * gw + x] = s / n;
  }
  return { data: out, w: gw, h: gh };
}
function perceptualScore(a, w, h, b) {
  let ssim = 0, match = 0, score = 0;
  for (const g of PERCEPTUAL_GRIDS) {
    const rows = Math.max(2, Math.round(g * (h / w)));
    const pa = gridAverage(a, w, h, g, rows), pb = gridAverage(b, w, h, g, rows);
    const s = Math.max(0, blockSSIM(pa.data, pb.data, g, rows, Math.max(2, Math.floor(g / 16))));
    const m = pixelMatch(pa.data, pb.data, g * rows, 0.06);
    ssim += s / PERCEPTUAL_GRIDS.length; match += m / PERCEPTUAL_GRIDS.length; score += (0.4 * s + 0.6 * m) / PERCEPTUAL_GRIDS.length;
  }
  return { ssim, match, score };
}
async function colorHist(path, w = 480) {
  const { data } = await sharp(path).resize({ width: w, fit: "inside" }).raw().removeAlpha().toBuffer({ resolveWithObject: true });
  const bins = new Float32Array(8 * 8 * 8);
  for (let i = 0; i + 2 < data.length; i += 3) { const r = data[i] >> 5, g = data[i + 1] >> 5, b = data[i + 2] >> 5; bins[r * 64 + g * 8 + b]++; }
  const s = bins.reduce((x, y) => x + y, 0) || 1; for (let i = 0; i < bins.length; i++) bins[i] /= s;
  return bins;
}
function histSim(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]); return s; }
async function avgColor(path, w = 200) { const { data, info } = await sharp(path).resize({ width: w, fit: "inside" }).raw().removeAlpha().toBuffer({ resolveWithObject: true }); let r = 0, g = 0, b = 0; const n = info.width * info.height; for (let i = 0; i < data.length; i += 3) { r += data[i]; g += data[i + 1]; b += data[i + 2]; } return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]; }

// ---- pack ground truth: section shots + y offsets, derived from the PACK's
// own data/layout.json (not hardcoded), so any site's ZIP scores correctly.
// Alignment mirrors package-docs alignSectionShots: walk layout sections in
// order, consume each section shot when heights match (2%); sections without
// a matching shot are skipped, never forced.
const layoutJson = JSON.parse(await readFile(join(PACK, "data/layout.json"), "utf8"));
const layoutSections = ((layoutJson.pages || [])[0]?.sections || []).filter((s) => Number.isFinite(Number(s?.y)) && Number.isFinite(Number(s?.height)));
if (layoutSections.length === 0) throw new Error(`pack has no usable layout sections: ${join(PACK, "data/layout.json")}`);
const sectionShotFiles = (await readdir(join(PACK, "screenshots/sections"))).filter((f) => /\.webp$/i.test(f)).sort();
const sectionShotHeights = [];
for (const file of sectionShotFiles) {
  const meta = await sharp(join(PACK, "screenshots/sections", file)).metadata();
  if (meta.height) sectionShotHeights.push({ file, h: meta.height });
}
const PACK_SECTIONS = [];
{
  let si = 0;
  for (let li = 0; li < layoutSections.length && si < sectionShotHeights.length; li += 1) {
    const sec = layoutSections[li];
    const lh = Number(sec.height);
    const sh = sectionShotHeights[si].h;
    if (Math.abs(lh - sh) <= Math.max(4, sh * 0.02)) {
      const heading = String(sec.heading || "").trim();
      PACK_SECTIONS.push({ name: heading ? heading.slice(0, 48) : `section-${li + 1}`, shot: `screenshots/sections/${sectionShotHeights[si].file}`, y: Number(sec.y), h: lh });
      si += 1;
    }
  }
}
if (PACK_SECTIONS.length === 0) throw new Error("no section shots align with pack layout (height mismatch)");
console.error(`sections: ${PACK_SECTIONS.map((s) => `${s.name} y${s.y} h${s.h}`).join(" | ")}`);

// ---- render agent ----
const render = await serveAndRender(REBUILD, 1440);
const packFull = join(PACK, "screenshots/desktop/home.webp");
const packGray = await gray(packFull, 720);
const PH = (await sharp(packFull).metadata()).height;
const PW = (await sharp(packFull).metadata()).width;

// anti-cheat: did the rebuild embed a pack screenshot?
const cheatHits = [];
if (/screenshots\/|\/home(-\d+)?\.webp|mobile\/home/.test(render.html)) cheatHits.push("references-pack-screenshot");
if (render.geom.imgs.some((s) => s && /(screenshots|home-\d\.webp|desktop\/home)/.test(s))) cheatHits.push("img-src-screenshot");
if (/https?:\/\//.test(render.html)) cheatHits.push("external-url");
if (/<script/i.test(render.html)) cheatHits.push("script-tag");

// full-page: stretch agent to pack height for layout SSIM
const agentStretch = await grayFill(render.shot, 720, packGray.h);
const fullSSIM = Math.max(0, blockSSIM(packGray.data, agentStretch.data, 720, packGray.h, 16));
const fullPixelMatch = pixelMatch(packGray.data, agentStretch.data, 720 * packGray.h, 0.06);
const perceptualFull = perceptualScore(packGray.data, 720, packGray.h, agentStretch.data);
const agentNative = await gray(render.shot, 720);
const AH = render.geom.h;
const heightRatio = AH / PH;

// per-section: slice the stretched agent at pack y offsets (scaled to 720 width domain)
const sections = [];
for (const s of PACK_SECTIONS) {
  const sw = await gray(join(PACK, s.shot), 720);
  const y0 = Math.round((s.y / PH) * agentStretch.h), y1 = Math.round(((s.y + s.h) / PH) * agentStretch.h);
  const sh = await grayFill(render.shot, 720, packGray.h); // reuse stretched buffer below
  const slice = new Float32Array(720 * sw.h);
  for (let y = 0; y < sw.h; y++) { const sy = Math.min(agentStretch.h - 1, y0 + Math.round((y / sw.h) * (y1 - y0))); for (let x = 0; x < 720; x++) slice[y * 720 + x] = agentStretch.data[sy * 720 + x]; }
  const ssim = Math.max(0, blockSSIM(sw.data, slice, 720, sw.h, 16));
  const pm = pixelMatch(sw.data, slice, 720 * sw.h, 0.06);
  const rawScore = 0.4 * ssim * 100 + 0.6 * pm * 100;
  const perceptual = perceptualScore(sw.data, 720, sw.h, slice);
  const score = 0.5 * rawScore + 0.5 * perceptual.score * 100;
  sections.push({ name: s.name, ssim: +(ssim * 100).toFixed(1), pixelMatch: +(pm * 100).toFixed(1), rawScore: +rawScore.toFixed(1), perceptual: +(perceptual.score * 100).toFixed(1), score: +score.toFixed(1) });
}
const sectionRawAvg = sections.reduce((a, b) => a + b.rawScore, 0) / sections.length;
const sectionPerceptualAvg = sections.reduce((a, b) => a + b.perceptual, 0) / sections.length;
const sectionAvg = 0.5 * sectionRawAvg + 0.5 * sectionPerceptualAvg;

// tokens/palette
const packHist = await colorHist(packFull), agentHist = await colorHist(render.shot);
const paletteSim = +((histSim(packHist, agentHist)) * 100).toFixed(1);
const packAvg = await avgColor(packFull), agentAvg = await avgColor(render.shot);

// copy recall vs pack page copy
let copyRecall = null;
try {
  const pagesJson = JSON.parse(await readFile(join(PACK, "data/pages.json"), "utf8"));
  const page0 = Array.isArray(pagesJson) ? pagesJson[0] : pagesJson.pages?.[0];
  // reference = visible content blocks only (headings/paragraphs/list-items)
  const refText = (page0?.content?.blocks || []).filter((b) => ["heading", "paragraph", "list-item"].includes(b.kind)).map((b) => b.text).join(" ")
    || (page0?.content?.sections || []).map((s) => s.textExcerpt || "").join(" ");
  const STOP = new Set(["the", "and", "your", "with", "that", "this", "for", "are", "you", "our", "use", "can", "from", "all", "any", "into", "its", "see", "how", "they", "them", "has", "have", "was", "were", "will", "not", "but", "out", "who", "own", "across", "while", "when", "then", "than", "upon", "per"]);
  const words = new Set((refText.match(/[A-Za-z][A-Za-z'’]{2,}/g) || []).map((w) => w.toLowerCase()).filter((w) => !STOP.has(w)));
  const agentWords = new Set((render.text.match(/[A-Za-z][A-Za-z'’]{2,}/g) || []).map((w) => w.toLowerCase()));
  let hit = 0; for (const w of words) if (agentWords.has(w)) hit++;
  copyRecall = +((hit / Math.max(1, words.size)) * 100).toFixed(1);
} catch { copyRecall = null; }

// motion: per CF34 §1 rubric, credit = "video = poster + placement, never fake
// playback". A static rebuild that preserves the video band and places the
// poster is CORRECT behavior, so it earns near-full credit; shipping JS motion
// would be the violation. No poster at all is the real penalty.
// CF40 interactions checklist: verifiable zero-JS affordances (functional tab
// controls, dismissable overlay via checkbox+label, hover micro-interactions).
// Each is +2, capped so motion tops at 94 — static can never fully replicate
// JS motion, but omitting these affordances is a real fidelity gap.
const hasPoster = render.geom.imgs.some((s) => s && /poster|video/i.test(s));
const hasVideoBand = /(poster|video|play)/i.test(render.html);
const baseMotion = hasPoster ? 88 : (hasVideoBand ? 70 : 45);
let cssText = "";
for (const cssName of ["style.css", "styles.css"]) {
  try { cssText = await readFile(join(REBUILD, cssName), "utf8"); break; } catch { /* try next */ }
}
if (!cssText) {
  const styleTags = [...render.html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  cssText = styleTags;
}
const ix = { tabs: false, dismiss: false, hover: 0, bonus: 0 };
if (/role="tablist"/.test(render.html) && ((render.html.match(/role="tab"/g) || []).length >= 2)) ix.tabs = true;
if (/type="checkbox"/.test(render.html) && /for="cookie/i.test(render.html) && /:checked/.test(cssText)) ix.dismiss = true;
ix.hover = (cssText.match(/:hover/g) || []).length;
if (ix.tabs) ix.bonus += 2;
if (ix.dismiss) ix.bonus += 2;
if (ix.hover >= 3) ix.bonus += 2;
const motion = Math.min(94, baseMotion + ix.bonus);

// composite (rubric weights)
const heightScore = 100 * Math.max(0, 1 - Math.abs(1 - heightRatio) * 2);
const rawPixel = 0.4 * fullSSIM * 100 + 0.6 * fullPixelMatch * 100;
const perceptualPixel = perceptualFull.score * 100;
const fullPixel = 0.5 * rawPixel + 0.5 * perceptualPixel;
const layout = +(0.50 * fullPixel + 0.30 * sectionAvg + 0.20 * heightScore).toFixed(1);
const tokens = +(0.6 * paletteSim + 0.4 * (packAvg[0] && Math.abs(packAvg[0] - agentAvg[0]) < 12 && Math.abs(packAvg[2] - agentAvg[2]) < 12 ? 100 : 60)).toFixed(1);
const copy = copyRecall == null ? 50 : copyRecall;
const composite = +(0.40 * layout + 0.25 * tokens + 0.20 * copy + 0.15 * motion).toFixed(1);

// ---- mobile (390px): reported fidelity for the responsive pass, NOT part of
// the ≥92 composite gate (desktop-first product). Agents must still verify it
// per PROMPT (no overflow, stacked columns vs the pack mobile screenshot).
let mobile = null;
try {
  const mobPath = join(PACK, "screenshots/mobile/home.webp");
  await stat(mobPath);
  const mobRender = await serveAndRender(REBUILD, 390, "mobile");
  const mobPack = await gray(mobPath, 360);
  const mobAgent = await grayFill(mobRender.shot, 360, mobPack.h);
  const mSSIM = Math.max(0, blockSSIM(mobPack.data, mobAgent.data, 360, mobPack.h, 16));
  const mPM = pixelMatch(mobPack.data, mobAgent.data, 360 * mobPack.h, 0.06);
  const mRaw = 0.4 * mSSIM + 0.6 * mPM;
  const mPerc = perceptualScore(mobPack.data, 360, mobPack.h, mobAgent.data);
  const mFull = 0.5 * mRaw + 0.5 * mPerc.score;
  const mMeta = await sharp(mobPath).metadata();
  const mHeightRatio = mobRender.geom.h / mMeta.height;
  const mHeightScore = 100 * Math.max(0, 1 - Math.abs(1 - mHeightRatio) * 2);
  mobile = {
    width: 390, height: mobRender.geom.h, packHeight: mMeta.height,
    heightRatio: +mHeightRatio.toFixed(3), fullPixel: +(mFull * 100).toFixed(1),
    score: +((0.7 * mFull * 100 + 0.3 * mHeightScore)).toFixed(1),
  };
} catch { mobile = null; }

const report = {
  label: LABEL, pack: PACK, rebuild: REBUILD,
  rendered: { width: 1440, height: AH, packHeight: PH, heightRatio: +heightRatio.toFixed(3) },
  antiCheat: { ok: cheatHits.length === 0, hits: cheatHits },
  pixels: {
    fullSSIM: +(fullSSIM * 100).toFixed(1), fullPixelMatch: +(fullPixelMatch * 100).toFixed(1),
    rawPixel: +rawPixel.toFixed(1),
    perceptualFull: { ssim: +(perceptualFull.ssim * 100).toFixed(1), match: +(perceptualFull.match * 100).toFixed(1), score: +perceptualPixel.toFixed(1) },
    fullPixel: +fullPixel.toFixed(1),
    sectionRawAvg: +sectionRawAvg.toFixed(1), sectionPerceptualAvg: +sectionPerceptualAvg.toFixed(1),
    sectionAvg: +sectionAvg.toFixed(1), sections,
  },
  tokens: { paletteSim, packAvg, agentAvg, bodyBg: render.geom.bodyBg },
  copy: { recall: copyRecall },
  motion: { score: motion, hasPoster, interactions: ix },
  mobile,
  pageErrors: render.errors,
  score: { layout, tokens, copy, motion, composite },
};
await writeFile(resolve(OUT), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
