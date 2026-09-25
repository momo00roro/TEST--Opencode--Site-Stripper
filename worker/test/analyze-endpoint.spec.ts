import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/app";
import {
  jsonRequest,
  makeEnv,
  makeFakeLauncher,
  mockDoh,
  mockSiteFetch,
  mockSiteFetchWithDoh,
} from "./helpers";
import { parseAnalyzeRequest } from "../src/validation/analyze-request";
import { runAnalysis } from "../src/pipeline/analysis";

describe("POST /api/analyze", () => {
  it("runs the homepage analysis against the injected browser backend", async () => {
    const { launcher } = makeFakeLauncher("fake");
    // other.example keeps discovery empty (snapshot links are cross-origin
    // here) while DoH resolves it for request + redirect validation.
    const request = jsonRequest({ url: "https://other.example/", maxPages: 3, includeMobile: false });

    const response = await handleRequest(request, makeEnv(), {
      launcher,
      fetchImpl: mockSiteFetchWithDoh({}, { a: ["93.184.216.34"] }),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, any>;
    expect(body.backend).toBe("fake");
    expect(body.integrityPassed).toBe(true);
    expect(body.request.maxPages).toBe(3);
    expect(body.request.includeMobile).toBe(false);
    // Discovery follows the landed (apex snapshot) origin, so the snapshot's
    // same-site links are analyzed, not dropped.
    expect(body.pagesAnalyzed).toBe(3);
    expect(body.pages).toHaveLength(3);
    expect(body.pages[0].title).toBe("Example");
    expect(body.pages[0].navLinkCount).toBe(1);
    expect(body.pages[0].screenshot.kind).toBe("webp");
    expect(body.pages[0].screenshot.dataUrl).toBeUndefined();
    expect(body.selection.pagesSelected).toBe(3);
    expect(body.selection.candidates[0].path).toBe("/");
    expect(body.selection.candidates[0].selectedBecause).toContain("homepage");
  });

  it("returns bounded observations without duplicate Worker-rendered documentation", async () => {
    const { launcher } = makeFakeLauncher("fake");
    const request = jsonRequest({ url: "https://other.example/", maxPages: 2, includeMobile: false });

    const response = await handleRequest(request, makeEnv(), {
      launcher,
      fetchImpl: mockSiteFetchWithDoh({}, { a: ["93.184.216.34"] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");

    const body = (await response.json()) as Record<string, any>;
    expect(body.schemaVersion).toBe("0.2.0");
    expect(body.packageFiles).toBeUndefined();
    expect(body.packageWarnings).toBeUndefined();
    expect(body.pages[0].content.blocks).toBeDefined();
    expect(body.pages[0].semanticStyles).toBeDefined();
    expect(body.pages[0].responsiveComparison.status).toBe("not-requested");
    expect(body.screenshotBytesTotal).toBeLessThanOrEqual(6 * 1024 * 1024);
    expect(JSON.stringify(body).length).toBeLessThan(1024 * 1024);
  });

  it("streams NDJSON progress then the result when requested", async () => {
    const { launcher } = makeFakeLauncher("fake");
    const request = new Request("https://api.example.test/api/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/x-ndjson",
      },
      body: JSON.stringify({ url: "https://other.example/", maxPages: 2, includeMobile: false }),
    });

    const response = await handleRequest(request, makeEnv(), {
      launcher,
      fetchImpl: mockSiteFetchWithDoh({}, { a: ["93.184.216.34"] }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("ndjson");

    const text = await response.text();
    const events = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    expect(events.some((event) => event.type === "progress" && event.phase === "homepage")).toBe(true);
    expect(events.some((event) => event.type === "progress" && event.phase === "page")).toBe(true);
    const pageEvents = events.filter((event) => event.type === "page");
    expect(pageEvents).toHaveLength(2);
    expect(pageEvents[0].page.content.blocks).toBeDefined();
    const final = events[events.length - 1];
    expect(final.type).toBe("result");
    expect(final.result.integrityPassed).toBe(true);
    expect(final.result.pages).toBeUndefined();
  });

  it("returns a structured 400 for invalid JSON", async () => {
    const response = await handleRequest(jsonRequest("{oops"), makeEnv());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_JSON" } });
  });

  it("rejects oversized request bodies", async () => {
    const big = JSON.stringify({ url: "https://93.184.216.34/", padding: "x".repeat(9000) });
    const response = await handleRequest(jsonRequest(big), makeEnv());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_BODY" } });
  });

  it("returns a structured 403 for private targets", async () => {
    const response = await handleRequest(
      jsonRequest({ url: "http://169.254.169.254/latest/meta-data" }),
      makeEnv(),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "PRIVATE_TARGET" } });
  });

  it("explains when no browser backend is configured", async () => {
    const response = await handleRequest(
      jsonRequest({ url: "https://93.184.216.34/" }),
      makeEnv(),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "INTERNAL" } });
  });

  it("does not leak internal error details for unexpected failures", async () => {
    const launcher = {
      name: "boom",
      launch: async () => {
        throw new Error("secret internal detail");
      },
    };

    const response = await handleRequest(jsonRequest({ url: "https://other.example/" }), makeEnv(), {
      launcher,
      fetchImpl: mockSiteFetchWithDoh({}, { a: ["93.184.216.34"] }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("secret internal detail");
  });

  it("rejects GET", async () => {
    const response = await handleRequest(
      new Request("https://api.example.test/api/analyze"),
      makeEnv(),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});

describe("runAnalysis", () => {
  it("inlines the homepage screenshot when an encoder is provided", async () => {
    const { launcher } = makeFakeLauncher("local");
    const parsed = await parseAnalyzeRequest(
      jsonRequest({ url: "https://example.com/" }),
      { fetchImpl: mockDoh({ a: ["93.184.216.34"] }) },
    );

    const result = await runAnalysis(launcher, parsed, {
      encodeBase64: (bytes) => `b64:${bytes.byteLength}`,
      fetchImpl: mockDoh({ a: ["93.184.216.34"] }),
    });

    expect(result.backend).toBe("local");
    expect(result.pages[0]?.screenshot?.dataUrl).toBe("data:image/webp;base64,b64:1024");
  });

  it("omits the inline screenshot when it exceeds the cap", async () => {
    const { launcher } = makeFakeLauncher("local");
    const parsed = await parseAnalyzeRequest(
      jsonRequest({ url: "https://example.com/" }),
      { fetchImpl: mockDoh({ a: ["93.184.216.34"] }) },
    );

    const result = await runAnalysis(launcher, parsed, {
      encodeBase64: (bytes) => `b64:${bytes.byteLength}`,
      maxInlineImageBytes: 10,
      fetchImpl: mockDoh({ a: ["93.184.216.34"] }),
    });

    expect(result.pages[0]?.screenshot?.dataUrl).toBeUndefined();
    expect(result.pages[0]?.screenshot?.bytes).toBe(1024);
  });

  it("closes the browser session even when capture fails", async () => {
    let closed = false;
    const failing = {
      name: "failing",
      launch: async () => ({
        newPage: async () => {
          throw new Error("boom");
        },
        close: async () => {
          closed = true;
        },
      }),
    };

    await expect(runAnalysis(failing, {
      target: {
        raw: "https://example.com/",
        url: new URL("https://example.com/"),
        origin: "https://example.com",
        hostname: "example.com",
      },
      resolvedIps: ["93.184.216.34"],
      maxPages: 10,
      includeMobile: true,
    })).rejects.toThrow(/Browser capture failed/);

    expect(closed).toBe(true);
  });
});
