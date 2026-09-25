import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/app";
import { makeEnv } from "./helpers";

function request(path: string, method = "GET", headers: Record<string, string> = {}): Request {
  return new Request(`https://api.example.test${path}`, { method, headers });
}

describe("GET /health", () => {
  it("returns an ok status with feature flags", async () => {
    const response = await handleRequest(request("/health"), makeEnv());
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.status).toBe("ok");
    expect(body.service).toBe("site-stripper-api");
    expect(body.features.browserRendering).toBe(false);
    expect(body.features.maxPages).toBe(10);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports the browser binding when present", async () => {
    const env = makeEnv({ BROWSER: { fetch: async () => new Response("") } });
    const response = await handleRequest(request("/health"), env);
    const body = (await response.json()) as Record<string, any>;
    expect(body.features.browserRendering).toBe(true);
  });

  it("rejects non-GET methods", async () => {
    const response = await handleRequest(request("/health", "POST"), makeEnv());
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("routing", () => {
  it("returns 404 for unknown routes", async () => {
    const response = await handleRequest(request("/nope"), makeEnv());
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("answers CORS preflight", async () => {
    const response = await handleRequest(request("/api/analyze", "OPTIONS"), makeEnv());
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("adds CORS headers to normal responses", async () => {
    const response = await handleRequest(request("/health"), makeEnv());
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("honours an allow-list of origins", async () => {
    const env = makeEnv({ ALLOWED_ORIGINS: "https://ui.example.test" });
    const allowed = await handleRequest(
      request("/health", "GET", { origin: "https://ui.example.test" }),
      env,
    );
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://ui.example.test");

    const denied = await handleRequest(
      request("/health", "GET", { origin: "https://evil.example.test" }),
      env,
    );
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});
