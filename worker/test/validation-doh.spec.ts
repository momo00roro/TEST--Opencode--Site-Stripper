import { describe, expect, it } from "vitest";
import { resolveHostViaDoh } from "../src/validation/doh";

function hangingFetch(): Promise<Response> {
  return new Promise(() => undefined);
}

describe("resolveHostViaDoh", () => {
  it("merges A and AAAA answers", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: string) => {
      seen.push(input);
      const type = new URL(input).searchParams.get("type");
      const data = type === "AAAA" ? ["::1"] : ["93.184.216.34"];
      const answerType = type === "AAAA" ? 28 : 1;
      return new Response(
        JSON.stringify({ Status: 0, Answer: data.map((address) => ({ name: "example.com", type: answerType, data: address })) }),
        { status: 200, headers: { "content-type": "application/dns-json" } },
      );
    }) as unknown as (input: string, init?: RequestInit) => Promise<Response>;

    const ips = await resolveHostViaDoh("example.com", fetchImpl, 1000);
    expect(ips.sort()).toEqual(["93.184.216.34", "::1"]);
    expect(seen).toHaveLength(2);
  });

  it("retries a transient DoH failure once per query type", async () => {
    const seen: string[] = [];
    let calls = 0;
    const fetchImpl = (async (input: string) => {
      seen.push(input);
      calls += 1;
      const type = new URL(input).searchParams.get("type");
      if (type === "A" && calls === 1) throw new Error("transient blip");
      const data = type === "AAAA" ? [] : ["93.184.216.34"];
      return new Response(
        JSON.stringify({ Status: 0, Answer: data.map((address) => ({ name: "example.com", type: type === "AAAA" ? 28 : 1, data: address })) }),
        { status: 200, headers: { "content-type": "application/dns-json" } },
      );
    }) as unknown as (input: string, init?: RequestInit) => Promise<Response>;

    const ips = await resolveHostViaDoh("example.com", fetchImpl, 1000);
    expect(ips).toEqual(["93.184.216.34"]);
    expect(seen.filter((url) => /type=A$/.test(url))).toHaveLength(2);
  });

  it("fails closed within the timeout when DoH hangs", async () => {
    const start = Date.now();
    const ips = await resolveHostViaDoh(
      "example.com",
      hangingFetch as unknown as (input: string, init?: RequestInit) => Promise<Response>,
      20,
    );
    expect(ips).toEqual([]);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
