import puppeteer from "puppeteer-core";
import type { AnalysisSession, SessionLauncher } from "../src/browser/types.js";
import { resolveChromePath } from "./chrome.js";

/**
 * Chrome flags for local captures. `--autoplay-policy=no-user-gesture-required`
 * lets scroll-triggered muted autoplay (figma-style `vimeo-video` facades and
 * native `autoplay` videos) start in headless Chrome the way they do in a
 * hand-driven browser, where scrolling alone boots playback. `--mute-audio`
 * keeps that playback silent. Both only affect the local backend; Cloudflare
 * Browser Rendering controls its own flags.
 */
export const LOCAL_CHROME_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--autoplay-policy=no-user-gesture-required",
  "--mute-audio",
];

export function createLocalLauncher(): SessionLauncher {
  return {
    name: "local",
    async launch(): Promise<AnalysisSession> {
      const executablePath = resolveChromePath();
      const browser = await puppeteer.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        args: [...LOCAL_CHROME_ARGS],
      });
      return browser as unknown as AnalysisSession;
    },
  };
}

export function describeLocalBackend(): string {
  const executablePath = resolveChromePath();
  return executablePath
    ? `local Chrome: ${executablePath}`
    : "local Chrome: not found (set CHROME_PATH)";
}
