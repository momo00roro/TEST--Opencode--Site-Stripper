import puppeteer from "puppeteer-core";
import type { AnalysisSession, SessionLauncher } from "../src/browser/types.js";
import { resolveChromePath } from "./chrome.js";

export function createLocalLauncher(): SessionLauncher {
  return {
    name: "local",
    async launch(): Promise<AnalysisSession> {
      const executablePath = resolveChromePath();
      const browser = await puppeteer.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
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
