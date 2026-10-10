// Build a full extraction pack (docs + data + theme + assets + screenshots)
// from a captured analysis JSON, mirroring web/app.js ZIP assembly in Node.
// node build-pack.mjs <analysisJson> <outPackDir>
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { buildDocumentationFiles, validateDocumentationPackage } from "../../web/package-docs.mjs";

const SRC = resolve(process.argv[2]);
const OUT = resolve(process.argv[3]);
if (!SRC || !OUT) { console.error("usage: build-pack.mjs <analysisJson> <outPackDir>"); process.exit(1); }

const analysis = JSON.parse(await readFile(SRC, "utf8"));

function dataUrlToBytes(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  if (/;base64/i.test(header)) return Uint8Array.from(Buffer.from(body, "base64"));
  return Uint8Array.from(Buffer.from(decodeURIComponent(body), "binary"));
}
function shotSlug(p) {
  const clean = String(p || "/").replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9/_-]+/g, "-").replace(/\/+/g, "-").toLowerCase();
  return clean || "home";
}
function shotExt(kind) { return kind === "jpeg" ? "jpg" : kind || "webp"; }

// app.js collectScreenshotFiles(analysis.pages)
function collectScreenshotFiles(pages) {
  const files = {};
  let added = 0;
  for (const page of pages || []) {
    const slug = shotSlug(page?.path);
    const desktop = page?.screenshot;
    if (desktop?.dataUrl) { const b = dataUrlToBytes(desktop.dataUrl); if (b) { files[`screenshots/desktop/${slug}.${shotExt(desktop.kind)}`] = b; added++; } }
    const mobile = page?.mobileScreenshot;
    if (mobile?.dataUrl) { const b = dataUrlToBytes(mobile.dataUrl); if (b) { files[`screenshots/mobile/${slug}.${shotExt(mobile.kind)}`] = b; added++; } }
    (page?.sectionShots || []).forEach((shot, index) => { if (!shot?.dataUrl) return; const b = dataUrlToBytes(shot.dataUrl); if (b) { files[`screenshots/sections/${slug}-${index + 1}.${shotExt(shot.kind)}`] = b; added++; } });
    (page?.videoShots || []).forEach((shot, index) => { if (!shot?.dataUrl) return; const b = dataUrlToBytes(shot.dataUrl); if (b) { files[`screenshots/videos/${slug}-${index + 1}.${shotExt(shot.kind)}`] = b; added++; } });
  }
  return { files, added };
}

const shots = collectScreenshotFiles(analysis.pages);
const documentation = buildDocumentationFiles(analysis, shots.files);
const issues = validateDocumentationPackage(documentation.files, shots.files);
if (issues.length) { console.error("validation failed:", issues.join("; ")); process.exit(1); }

const merged = Object.assign({}, documentation.files, shots.files);
// raw analysis rides along like the reference packs (regen-docs.mjs source)
merged["response.json"] = await readFile(SRC);
let written = 0, bytes = 0;
for (const [name, contents] of Object.entries(merged)) {
  const dest = join(OUT, name);
  await mkdir(dirname(dest), { recursive: true });
  const buf = contents instanceof Uint8Array ? contents : Buffer.from(String(contents), "utf8");
  await writeFile(dest, buf);
  written++; bytes += buf.byteLength;
}
console.log(`built pack -> ${OUT}`);
console.log(`files=${written} bytes=${bytes} | docs=${Object.keys(documentation.files).length} screenshots=${shots.added}`);
if (existsSync(join(OUT, "response.json"))) console.log("note: response.json already present in output");
