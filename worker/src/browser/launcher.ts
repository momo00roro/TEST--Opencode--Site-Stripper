import puppeteer from "@cloudflare/puppeteer";
import { LIMITS } from "../config/limits";
import type { BrowserBinding } from "../types";
import type { AnalysisSession, LaunchOptions, SessionLauncher } from "./types";

export function createCloudflareLauncher(binding: BrowserBinding): SessionLauncher {
  return {
    name: "cloudflare",
    async launch(options: LaunchOptions = {}): Promise<AnalysisSession> {
      const keepAliveMs = Math.min(
        options.keepAliveMs ?? LIMITS.browserKeepAliveMs,
        LIMITS.browserKeepAliveMs,
      );
      const browser = await puppeteer.launch(binding as never, { keep_alive: keepAliveMs });
      return browser as unknown as AnalysisSession;
    },
  };
}
