import { afterEach, describe, expect, it } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyPublicSite } from "../../scripts/build-public-site.mjs";

const publicFiles = ["index.html", "landing.css", "favicon.svg", "mock-account.js"];
const publicDirectories = ["features", "how-it-works", "sample-pack", "faq", "sign-up", "sign-in", "terms", "privacy"];
const temporaryRoots: string[] = [];

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("allowlisted public site build", () => {
  it("copies marketing routes and excludes analyzer code and unrelated files", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "site-stripper-public-build-"));
    temporaryRoots.push(sandbox);
    const source = join(sandbox, "web");
    const output = join(sandbox, "dist", "site");

    for (const file of publicFiles) {
      const path = join(source, file);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, file);
    }
    for (const directory of publicDirectories) {
      const path = join(source, directory, "index.html");
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, directory);
    }
    for (const file of ["sign-up/complete/index.html", "sign-in/complete/index.html", "sample-pack/assets/example-home.webp", "sample-pack/files.json", "sample-pack/preview.json"]) {
      const path = join(source, file);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, file);
    }
    for (const file of ["app/index.html", "app.js", "package.js", "package-docs.mjs", "composite-video.mjs", "styles.css", "vendor/zip-store.js", "private-notes.txt"]) {
      const path = join(source, file);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "must not be published");
    }

    await copyPublicSite(source, output);

    for (const file of publicFiles) await expect(access(join(output, file))).resolves.toBeUndefined();
    for (const directory of publicDirectories) await expect(access(join(output, directory, "index.html"))).resolves.toBeUndefined();
    for (const file of ["sign-up/complete/index.html", "sign-in/complete/index.html", "sample-pack/assets/example-home.webp", "sample-pack/files.json", "sample-pack/preview.json"]) {
      await expect(access(join(output, file))).resolves.toBeUndefined();
    }
    for (const file of ["app/index.html", "app.js", "package.js", "package-docs.mjs", "composite-video.mjs", "styles.css", "vendor/zip-store.js", "private-notes.txt"]) {
      expect(await exists(join(output, file))).toBe(false);
    }
    expect(await readFile(join(output, "sample-pack/assets/example-home.webp"))).toEqual(await readFile(join(source, "sample-pack/assets/example-home.webp")));
  });
});
