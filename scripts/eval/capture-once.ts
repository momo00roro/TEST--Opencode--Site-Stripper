// Direct full capture using CURRENT code (bypasses the stale dev server).
// npx tsx scripts/eval/capture-once.ts [url] [outJson]
import { writeFile } from "node:fs/promises";
import { handleRequest } from "../../worker/src/app.js";
import { createLocalLauncher } from "../../worker/local/launcher.js";
import type { Env } from "../../worker/src/types.js";

const url = process.argv[2] || "https://cline.bot/";
const out = process.argv[3] || "C:/Users/Admin/AppData/Local/Temp/opencode/eval/direct-analysis.json";

async function main(): Promise<void> {
  const launcher = createLocalLauncher();
  const env: Env = { ENVIRONMENT: "local", ALLOWED_ORIGINS: "" };
  const request = new Request("http://127.0.0.1/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, maxPages: 1, includeMobile: true }),
  });
  const response = await handleRequest(request, env, {
    launcher,
    encodeBase64: (bytes) => Buffer.from(bytes).toString("base64"),
    capture: "full",
  });
  const text = await response.text();
  await writeFile(out, text);

  let body: any;
  try { body = JSON.parse(text); } catch { console.log("non-JSON", response.status, text.slice(0, 300)); process.exit(1); }
  const assets = body.assets || [];
  const fonts = assets.filter((a: any) => a.kind === "font");
  const canvases = assets.filter((a: any) => /canvas-\d+\.png$/.test(a.localPath || ""));
  const page = (body.pages || [])[0] || {};
  console.log("status", response.status, "bytes", text.length);
  console.log("fonts shipped:", fonts.filter((a: any) => a.source === "downloaded").map((a: any) => `${a.fontFamily} ${a.fontWeight} -> ${a.localPath}`).join(" | ") || "NONE");
  console.log("font refs:", fonts.filter((a: any) => a.source !== "downloaded").map((a: any) => a.fontFamily).join(",") || "none");
  console.log("canvas stills:", canvases.map((a: any) => `${a.localPath} ${a.width}x${a.height} rectY=${a.rectY} ${(a.dataUrl || "").slice(0, 22)}`).join(" | ") || "NONE");
  console.log("sectionShots", (page.sectionShots || []).length);
}

void main();
