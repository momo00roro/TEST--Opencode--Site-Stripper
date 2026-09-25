import { describe, expect, it } from "vitest";
import {
  ipLiteralKind,
  isBlockedIpLiteral,
  parseIPv4,
  parseIPv6,
} from "../src/validation/ip";

describe("parseIPv4", () => {
  it("parses valid addresses", () => {
    expect(parseIPv4("1.2.3.4")).toEqual([1, 2, 3, 4]);
  });

  it("rejects malformed input", () => {
    expect(parseIPv4("256.1.1.1")).toBeNull();
    expect(parseIPv4("1.2.3")).toBeNull();
    expect(parseIPv4("not-an-ip")).toBeNull();
  });
});

describe("parseIPv6", () => {
  it("parses a full address", () => {
    expect(parseIPv6("2001:0db8:0000:0000:0000:0000:0000:0001")).toHaveLength(8);
  });

  it("expands the double-colon", () => {
    const groups = parseIPv6("2001:db8::1");
    expect(groups).toHaveLength(8);
    expect(groups?.[0]).toBe(0x2001);
    expect(groups?.[7]).toBe(1);
  });

  it("unwraps IPv4-mapped addresses", () => {
    const groups = parseIPv6("::ffff:127.0.0.1");
    expect(groups).toHaveLength(8);
    expect(isBlockedIpLiteral("::ffff:127.0.0.1")).toBe(true);
  });

  it("strips a zone id", () => {
    expect(parseIPv6("fe80::1%eth0")).not.toBeNull();
  });
});

describe("blocked ranges", () => {
  const blocked = [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.5.5",
    "172.31.255.254",
    "192.0.2.10",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
  ];

  it.each(blocked)("blocks %s", (ip) => {
    expect(isBlockedIpLiteral(ip)).toBe(true);
  });

  const allowed = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.0.1", "172.32.0.1", "2606:4700::1111"];

  it.each(allowed)("allows %s", (ip) => {
    expect(isBlockedIpLiteral(ip)).toBe(false);
  });
});

describe("ipLiteralKind", () => {
  it("detects families and brackets", () => {
    expect(ipLiteralKind("1.1.1.1")).toBe("v4");
    expect(ipLiteralKind("[::1]")).toBe("v6");
    expect(ipLiteralKind("example.com")).toBeNull();
  });
});
