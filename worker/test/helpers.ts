import { expect } from "vitest";
import type { PageSnapshot } from "../src/browser/snapshot-script";
import type {
  AnalysisSession,
  BrowserPage,
  BrowserViewport,
  GotoOptions,
  ScreenshotOptions,
  SessionLauncher,
} from "../src/browser/types";
import type { Env } from "../src/types";
import type { FetchLike } from "../src/validation/doh";

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return { ENVIRONMENT: "test", ALLOWED_ORIGINS: "", ...overrides };
}

export function jsonRequest(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://api.example.test/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

export interface DohRecords {
  a?: string[];
  aaaa?: string[];
  fail?: boolean;
}

export function mockDoh(records: DohRecords): FetchLike {
  return async (input: string): Promise<Response> => {
    if (records.fail) throw new Error("dns unavailable");
    const url = new URL(input);
    const type = url.searchParams.get("type");
    const name = url.searchParams.get("name") ?? "";
    const list = type === "AAAA" ? (records.aaaa ?? []) : (records.a ?? []);
    const answerType = type === "AAAA" ? 28 : 1;
    return new Response(
      JSON.stringify({ Status: 0, Answer: list.map((data) => ({ name, type: answerType, data })) }),
      { status: 200, headers: { "content-type": "application/dns-json" } },
    );
  };
}

export function expectErrorCode(payload: unknown, code: string): void {
  expect(payload).toMatchObject({ error: { code } });
}

export interface MockRoute {
  status?: number;
  body?: string;
  contentType?: string;
}

export function mockSiteFetchWithDoh(
  routes: Record<string, MockRoute> = {},
  records: DohRecords = {},
): typeof fetch {
  const doh = mockDoh(records);
  const site = mockSiteFetch(routes);
  const handler = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as { url: string }).url;
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
      return doh(url, init);
    }
    return (site as unknown as (input: unknown, init?: RequestInit) => Promise<Response>)(input, init);
  };
  return handler as unknown as typeof fetch;
}

export function mockSiteFetch(routes: Record<string, MockRoute> = {}): typeof fetch {
  const handler = async (input: RequestInfo | URL): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const route = routes[url];
    if (!route) return new Response("", { status: 404 });
    return new Response(route.body ?? "", {
      status: route.status ?? 200,
      headers: { "content-type": route.contentType ?? "text/plain; charset=utf-8" },
    });
  };
  return handler as unknown as typeof fetch;
}

export const SAMPLE_SNAPSHOT: PageSnapshot = {
  url: "https://example.com/",
  title: "Example",
  metaDescription: null,
  lang: "en",
  direction: "ltr",
  headings: [{ level: 1, text: "Hi", truncated: false, breaks: [] }],
  links: [
    { href: "https://example.com/about", text: "About", inNav: true, inHeader: true, inFooter: false },
    { href: "https://example.com/x", text: "X", inNav: false, inHeader: false, inFooter: false },
  ],
  bodyBackgroundColor: "rgb(255, 255, 255)",
  bodyColor: "rgb(0, 0, 0)",
  bodyFontFamily: "sans-serif",
  pageCanvasColor: "rgb(255, 255, 255)",
  roleCounts: {},
  sectionCount: 2,
  formCount: 0,
  imageCount: 1,
  domElementCount: 42,
  viewport: { width: 1440, height: 900 },
  tokens: {
    colors: [],
    fontSizes: [],
    spacing: [],
    radii: [],
    borders: [],
    shadows: [],
    gradients: [],
    icons: [],
    customProperties: [],
  },
  typography: { fontFaces: [], fontFamilies: [], lineHeights: [], letterSpacings: [] },
  semanticStyles: [],
  layoutSamples: [],
  breakpoints: { mediaQueries: [] },
  motion: { transitions: [], animations: [], keyframes: [], animatedSelectors: [] },
  geometry: { containerWidths: [], sampledElements: 0 },
  content: {
    blocks: [],
    hiddenBlocks: [],
    controls: [],
    components: [],
    coverage: {},
    sections: [],
    tone: { avgSentenceWords: 0, questionCount: 0, ctaCount: 0, voice: "unknown" },
    tabSets: [],
    footerGroups: [],
    rotatingText: [],
  },
  coverage: {},
  assets: [],
  embeds: [],
  videos: [],
  sectionLayouts: [],
  social: { ogTitle: null, ogDescription: null, twitterCard: null, generator: null, themeColor: null },
  hoverStates: [],
  formActions: [],
  sectionRects: [],
  observedInteractions: [],
  limitations: [],
};

export interface FakePageState {
  viewports: BrowserViewport[];
  gotos: Array<{ url: string; options?: GotoOptions }>;
  scrolls: number;
  screenshots: ScreenshotOptions[];
  clicks: Array<{ x: number; y: number }>;
  keys: string[];
}

export interface FakePageOptions {
  height?: number;
  bytes?: number;
  failTypes?: string[];
  headingTexts?: Array<{ label: string; text: string }>;
  lazySweep?: { settled: number; pending: number; failed?: number; videosPending?: number };
  videoTarget?: { status: string; x?: number; y?: number; label?: string; streamUrl?: string; rectY?: number; rectHeight?: number; rectX?: number; rectWidth?: number; uid?: string };
  videoPlayer?: { started: boolean; x?: number; y?: number; width?: number; height?: number };
  autoplayPlayer?: { started: boolean; x?: number; y?: number; width?: number; height?: number };
  /**
   * Ordered facade answers consumed per facadeClickTarget call (models
   * carousel DOM states across page-turns; null = "none"). When exhausted,
   * falls back to videoTargetAt/videoTarget/facadeCount. Copied, not mutated.
   */
  facadeSequence?: Array<{ status: string; x?: number; y?: number; label?: string; streamUrl?: string; rectY?: number; rectHeight?: number; rectX?: number; rectWidth?: number; uid?: string } | null>;
  /**
   * Index-pinned facade answers (models distinct per-index facades without a
   * sequence). Checked after facadeSequence, before videoTarget/facadeCount.
   */
  videoTargetAt?: Record<number, { status: string; x?: number; y?: number; label?: string; streamUrl?: string; rectY?: number; rectHeight?: number; rectX?: number; rectWidth?: number; uid?: string }>;
  /**
   * Ordered carousel next-arrow answers consumed per pager call.
   * Empty/absent means no pager target. The array is copied, not mutated.
   */
  carouselNexts?: Array<{ x: number; y: number }>;
  /**
   * How many facades exist: facadeClickTarget(index) reports "none" for
   * index >= facadeCount. Default is unbounded (every index is a target),
   * which models pages with more facades than the clip cap.
   */
  facadeCount?: number;
  /**
   * Fill each screenshot with its call index so consecutive shots differ
   * (simulates motion for the isolated two-frame check). Default screenshots
   * are zero-filled and therefore identical.
   */
  variedShots?: boolean;
  /**
   * With variedShots, zero-fill the first N shots (slow-booting stream:
   * static frames before motion starts). The adaptive poll must catch the
   * first differing pair; a fixed two-shot dwell would reject it.
   */
  staticShots?: number;
}

export function makeFakePage(options: FakePageOptions = {}): {
  page: BrowserPage;
  state: FakePageState;
} {
  const state: FakePageState = { viewports: [], gotos: [], scrolls: 0, screenshots: [], clicks: [], keys: [] };
  const failTypes = new Set(options.failTypes ?? []);
  let shotCalls = 0;
  const facadeQueue = [...(options.facadeSequence ?? [])];
  const carouselQueue = [...(options.carouselNexts ?? [])];

  const page: BrowserPage & {
    mouse: { click(x: number, y: number): Promise<void> };
    keyboard: { press(key: string): Promise<void> };
  } = {
    async setViewport(viewport) {
      state.viewports.push(viewport);
    },
    async goto(url, gotoOptions) {
      state.gotos.push({ url, options: gotoOptions });
      return null;
    },
    async evaluate<T>(fn: (() => T) | string): Promise<T> {
      // Capture code ships evaluations as shimmed strings (toInPageScript);
      // detect the extractor by its unmistakable in-page marker either way.
      const src = typeof fn === "string" ? fn : Function.prototype.toString.call(fn);
      if (src.includes("maxHeadings")) {
        const viewport = state.viewports[state.viewports.length - 1];
        return {
          ...SAMPLE_SNAPSHOT,
          viewport: { width: viewport?.width ?? 1440, height: viewport?.height ?? 900 },
        } as unknown as T;
      }
      if (src.includes("collectHeadingTexts")) {
        return (options.headingTexts ?? []) as unknown as T;
      }
      if (src.includes("facadeClickTarget")) {
        if (facadeQueue.length > 0) {
          const next = facadeQueue.shift();
          return ((next ?? { status: "none", x: 0, y: 0, label: "" }) as unknown) as T;
        }
        // The facade index rides as the trailing literal: ...(fn)(N).
        const at = /\((\d+)\)$/.exec(src)?.[1];
        const facadeIndex = at === undefined ? 0 : Number(at);
        const pinned = options.videoTargetAt?.[facadeIndex];
        if (pinned) return pinned as unknown as T;
        if (facadeIndex >= (options.facadeCount ?? Number.POSITIVE_INFINITY)) {
          return { status: "none", x: 0, y: 0, label: "" } as unknown as T;
        }
        return (options.videoTarget ?? { status: "none", x: 0, y: 0, label: "" }) as unknown as T;
      }
      if (src.includes("awaitVideoPlayer")) {
        return (options.videoPlayer ?? { started: false, x: 0, y: 0, width: 0, height: 0 }) as unknown as T;
      }
      if (src.includes("awaitAutoplayVideo")) {
        return (options.autoplayPlayer ?? { started: false, x: 0, y: 0, width: 0, height: 0 }) as unknown as T;
      }
      if (src.includes("pageVideoCarousel")) {
        const next = carouselQueue.shift();
        return ((next ? { status: "target", ...next } : { status: "none", x: 0, y: 0 }) as unknown) as T;
      }
      if (src.includes("scrollIntoView")) {
        return (options.lazySweep ?? { settled: 0, pending: 0 }) as unknown as T;
      }
      state.scrolls += 1;
      return (options.height ?? 4000) as unknown as T;
    },
    async screenshot(shotOptions = {}) {
      state.screenshots.push(shotOptions);
      if (shotOptions.type && failTypes.has(shotOptions.type)) {
        throw new Error(`${shotOptions.type} unsupported`);
      }
      const size = options.bytes ?? 1024;
      if (options.variedShots) {
        shotCalls += 1;
        if (shotCalls <= (options.staticShots ?? 0)) return new Uint8Array(size);
        return new Uint8Array(size).fill(shotCalls % 256);
      }
      return new Uint8Array(size);
    },
    // Trusted-input surface for click-to-play capture (both real backends
    // are puppeteer pages with .mouse/.keyboard; see trustedClick in capture.ts).
    mouse: {
      async click(x: number, y: number) {
        state.clicks.push({ x, y });
      },
    },
    keyboard: {
      async press(key: string) {
        state.keys.push(key);
      },
    },
    async close() {},
  };

  return { page, state };
}

export function makeFakeLauncher(name = "fake", pageOptions: FakePageOptions = {}): {
  launcher: SessionLauncher;
  state: FakePageState & { readonly opened: number; readonly closed: number };
} {
  const { page, state } = makeFakePage(pageOptions);
  const counter = { opened: 0, closed: 0 };
  const session: AnalysisSession = {
    async newPage() {
      counter.opened += 1;
      return page;
    },
    async close() {
      counter.closed += 1;
    },
  };
  return {
    launcher: { name, launch: async () => session },
    state: {
      viewports: state.viewports,
      gotos: state.gotos,
      scrolls: state.scrolls,
      screenshots: state.screenshots,
      clicks: state.clicks,
      keys: state.keys,
      get opened() {
        return counter.opened;
      },
      get closed() {
        return counter.closed;
      },
    },
  };
}
