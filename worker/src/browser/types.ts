export interface BrowserViewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}

export type WaitUntil = "load" | "domcontentloaded" | "networkidle0" | "networkidle2";

export interface GotoOptions {
  waitUntil?: WaitUntil;
  timeout?: number;
}

export interface ScreenshotClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotOptions {
  type?: "webp" | "jpeg" | "png";
  quality?: number;
  clip?: ScreenshotClip;
  captureBeyondViewport?: boolean;
  fullPage?: boolean;
  /**
   * Encode inside Chromium, never in the Worker. `base64` returns the CDP
   * base64 string the Worker can pass straight through without spending CPU
   * on encoding (Trap 4). Both real backends (`@cloudflare/puppeteer` and
   * local `puppeteer-core`) honor it; capture always requests `base64`.
   */
  encoding?: "base64" | "binary";
}

export interface BrowserPage {
  setViewport(viewport: BrowserViewport): Promise<void>;
  goto(url: string, options?: GotoOptions): Promise<unknown>;
  /**
   * Strings are evaluated as scripts; function references are serialized by
   * the backend. Capture code always passes strings (see `toInPageScript`)
   * so transformer-injected helpers resolve via the in-page shim.
   */
  evaluate<T>(fn: (() => T) | string): Promise<T>;
  screenshot(options?: ScreenshotOptions): Promise<Uint8Array | ArrayBuffer | string>;
  close(): Promise<void>;
}

export interface AnalysisSession {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

export interface LaunchOptions {
  keepAliveMs?: number;
}

export type BackendName = "cloudflare" | "local" | string;

export interface SessionLauncher {
  readonly name: BackendName;
  launch(options?: LaunchOptions): Promise<AnalysisSession>;
}
