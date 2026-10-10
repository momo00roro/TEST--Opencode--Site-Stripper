import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_FILES = ["index.html", "landing.css", "favicon.svg", "mock-account.js"];
const PUBLIC_DIRECTORIES = ["features", "how-it-works", "sample-pack", "faq", "sign-up", "sign-in"];

async function copyTree(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourceEntry = join(source, entry.name);
    const destinationEntry = join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(sourceEntry, destinationEntry);
    else if (entry.isFile()) await copyFile(sourceEntry, destinationEntry);
  }
}

export async function copyPublicSite(sourceRoot, outputRoot) {
  const source = resolve(sourceRoot);
  const output = resolve(outputRoot);
  await mkdir(output, { recursive: true });
  for (const file of PUBLIC_FILES) {
    await copyFile(join(source, file), join(output, file));
  }
  for (const directory of PUBLIC_DIRECTORIES) {
    await copyTree(join(source, directory), join(output, directory));
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const repositoryRoot = resolve(dirname(scriptPath), "..");
  const outputRoot = resolve(repositoryRoot, "dist", "site");
  if (outputRoot !== resolve(repositoryRoot, "dist/site")) {
    throw new Error("Refusing to clear a generated directory outside dist/site.");
  }
  await rm(outputRoot, { recursive: true, force: true });
  await copyPublicSite(resolve(repositoryRoot, "web"), outputRoot);
  console.log(`Built public marketing site at ${outputRoot}`);
}
