import { describe, expect, it } from "vitest";
import { isSameSiteOrigin } from "../src/discovery/paths";

describe("isSameSiteOrigin", () => {
  it("accepts identical origins", () => {
    expect(isSameSiteOrigin("https://example.com/", "https://example.com/")).toBe(true);
    expect(isSameSiteOrigin("https://example.com/a", "https://example.com/b")).toBe(true);
  });

  it("accepts the www/apex alias pair", () => {
    expect(isSameSiteOrigin("https://www.example.com/", "https://example.com/")).toBe(true);
    expect(isSameSiteOrigin("https://example.com/", "https://www.example.com/")).toBe(true);
  });

  it("rejects different hosts, schemes, and ports", () => {
    expect(isSameSiteOrigin("https://other.example.com/", "https://example.com/")).toBe(false);
    expect(isSameSiteOrigin("https://a.example.com/", "https://b.example.com/")).toBe(false);
    expect(isSameSiteOrigin("http://example.com/", "https://example.com/")).toBe(false);
    expect(isSameSiteOrigin("https://example.com:8443/", "https://example.com/")).toBe(false);
    expect(isSameSiteOrigin("https://www.evil.com/", "https://example.com/")).toBe(false);
  });

  it("rejects unparseable inputs", () => {
    expect(isSameSiteOrigin(":::not a url", "https://example.com/")).toBe(false);
    expect(isSameSiteOrigin("https://example.com/", "")).toBe(false);
  });
});
