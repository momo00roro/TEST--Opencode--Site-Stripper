import { describe, expect, it } from "vitest";
import { ApiError } from "../src/http/errors";
import { parseAnalyzeRequest } from "../src/validation/analyze-request";
import { assertPublicTarget, parseHttpUrl } from "../src/validation/url";
import { jsonRequest, mockDoh } from "./helpers";

async function expectApiError(promise: Promise<unknown>, code: string, status?: number) {
  try {
    await promise;
    throw new Error(`expected ApiError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    const api = error as ApiError;
    expect(api.code).toBe(code);
    if (status !== undefined) expect(api.status).toBe(status);
  }
}

describe("parseHttpUrl", () => {
  it("accepts http and https", () => {
    expect(parseHttpUrl("https://example.com/a?b=1").hostname).toBe("example.com");
    expect(parseHttpUrl("http://example.com").origin).toBe("http://example.com");
  });

  it("trims and strips the fragment", () => {
    const parsed = parseHttpUrl("  https://example.com/path#section  ");
    expect(parsed.url.hash).toBe("");
    expect(parsed.raw).toBe("https://example.com/path#section");
  });

  it("rejects empty input", async () => {
    await expectApiError(Promise.resolve().then(() => parseHttpUrl("   ")), "MISSING_URL", 400);
    await expectApiError(Promise.resolve().then(() => parseHttpUrl(42)), "MISSING_URL", 400);
  });

  it("rejects non-http protocols", async () => {
    await expectApiError(
      Promise.resolve().then(() => parseHttpUrl("ftp://example.com")),
      "UNSUPPORTED_PROTOCOL",
    );
    await expectApiError(
      Promise.resolve().then(() => parseHttpUrl("file:///etc/passwd")),
      "UNSUPPORTED_PROTOCOL",
    );
  });

  it("rejects credentials", async () => {
    await expectApiError(
      Promise.resolve().then(() => parseHttpUrl("https://user:pass@example.com")),
      "CREDENTIALS_NOT_ALLOWED",
    );
  });

  it("rejects non-standard ports", async () => {
    await expectApiError(
      Promise.resolve().then(() => parseHttpUrl("https://example.com:8080")),
      "PORT_NOT_ALLOWED",
    );
  });

  it("allows explicit web ports", () => {
    expect(parseHttpUrl("https://example.com:443").url.port).toBe("");
    expect(parseHttpUrl("http://example.com:80").url.port).toBe("");
  });
});

describe("assertPublicTarget", () => {
  it("allows public IP literals without resolving", async () => {
    const target = parseHttpUrl("https://93.184.216.34/");
    const never = () => {
      throw new Error("should not resolve");
    };
    await expect(assertPublicTarget(target, never)).resolves.toEqual(["93.184.216.34"]);
  });

  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5/",
    "http://192.168.0.1/",
    "http://[::1]/",
    "http://localhost/",
    "http://foo.internal/",
  ])("blocks %s", async (url) => {
    const target = parseHttpUrl(url);
    await expectApiError(assertPublicTarget(target, mockDoh({})), "PRIVATE_TARGET", 403);
  });

  it("blocks hostnames that resolve to private addresses", async () => {
    const target = parseHttpUrl("https://sneaky.example.com/");
    const doh = mockDoh({ a: ["93.184.216.34", "10.0.0.1"] });
    await expectApiError(assertPublicTarget(target, doh), "PRIVATE_TARGET", 403);
  });

  it("allows hostnames that resolve publicly", async () => {
    const target = parseHttpUrl("https://example.com/");
    const doh = mockDoh({ a: ["93.184.216.34"], aaaa: ["2606:4700::1111"] });
    await expect(assertPublicTarget(target, doh)).resolves.toHaveLength(2);
  });

  it("fails when the host cannot be resolved", async () => {
    const target = parseHttpUrl("https://nowhere.example.com/");
    await expectApiError(assertPublicTarget(target, mockDoh({})), "HOST_RESOLUTION_FAILED", 400);
  });

  it("fails when DNS is unavailable", async () => {
    const target = parseHttpUrl("https://nowhere.example.com/");
    await expectApiError(assertPublicTarget(target, mockDoh({ fail: true })), "HOST_RESOLUTION_FAILED");
  });
});

describe("parseAnalyzeRequest", () => {
  it("applies defaults", async () => {
    const request = jsonRequest({ url: "https://93.184.216.34/" });
    const parsed = await parseAnalyzeRequest(request, { fetchImpl: mockDoh({}) });
    expect(parsed.maxPages).toBe(10);
    expect(parsed.includeMobile).toBe(true);
  });

  it("clamps maxPages to the hard maximum", async () => {
    const request = jsonRequest({ url: "https://93.184.216.34/", maxPages: 999 });
    const parsed = await parseAnalyzeRequest(request, { fetchImpl: mockDoh({}) });
    expect(parsed.maxPages).toBe(10);
  });

  it("clamps maxPages to the minimum", async () => {
    const request = jsonRequest({ url: "https://93.184.216.34/", maxPages: 0 });
    const parsed = await parseAnalyzeRequest(request, { fetchImpl: mockDoh({}) });
    expect(parsed.maxPages).toBe(1);
  });

  it("rejects invalid JSON", async () => {
    const request = jsonRequest("{not json");
    await expectApiError(
      parseAnalyzeRequest(request, { fetchImpl: mockDoh({}) }),
      "INVALID_JSON",
      400,
    );
  });

  it("rejects array bodies", async () => {
    const request = jsonRequest([1, 2, 3]);
    await expectApiError(parseAnalyzeRequest(request, { fetchImpl: mockDoh({}) }), "INVALID_BODY", 400);
  });

  it("rejects a missing url", async () => {
    const request = jsonRequest({ maxPages: 5 });
    await expectApiError(parseAnalyzeRequest(request, { fetchImpl: mockDoh({}) }), "MISSING_URL", 400);
  });

  it("rejects a non-boolean includeMobile", async () => {
    const request = jsonRequest({ url: "https://93.184.216.34/", includeMobile: "yes" });
    await expectApiError(parseAnalyzeRequest(request, { fetchImpl: mockDoh({}) }), "INVALID_BODY", 400);
  });
});
