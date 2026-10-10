// Regenerate pack docs from a captured response.json (no re-capture).
// node regen-docs.mjs <srcPackDir> <outPackDir>
import { readFile, writeFile, mkdir, cp, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { buildDocumentationFiles } from "../../web/package-docs.mjs";

const SRC = resolve(process.argv[2]);
const OUT = resolve(process.argv[3]);

const analysis = JSON.parse(await readFile(join(SRC, "response.json"), "utf8"));

// attach downloaded asset binaries so validation passes and fonts/images ship
for (const asset of analysis.assets || []) {
  if (asset && asset.source === "downloaded" && asset.localPath) {
    const p = join(SRC, asset.localPath);
    if (existsSync(p)) asset.content = await readFile(p);
  }
}

// screenshot binaries keyed by zipPath (for annotated overlays / manifest)
const shotFiles = {};
const manifestPath = join(SRC, "screenshots/manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const shot of manifest.shots || []) {
    if (shot.hasBinary && shot.zipPath) {
      const p = join(SRC, shot.zipPath);
      if (existsSync(p)) shotFiles[shot.zipPath] = await readFile(p);
    }
  }
}

const { files } = buildDocumentationFiles(analysis, shotFiles);

// copy the source pack (assets/screenshots/etc.) then overwrite generated docs
await cp(SRC, OUT, { recursive: true });
// remove stale docs we regenerate
for (const name of Object.keys(files)) {
  const dest = join(OUT, name);
  await mkdir(dirname(dest), { recursive: true });
  const contents = files[name];
  await writeFile(dest, contents instanceof Uint8Array ? contents : String(contents));
}
console.log(`regenerated ${Object.keys(files).length} files -> ${OUT}`);
console.log("REBUILD.md bytes:", String(files["REBUILD.md"] || "").length);
