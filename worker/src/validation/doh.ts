export interface DohAnswer {
  name: string;
  type: number;
  data: string;
}

export interface DohResponse {
  Status?: number;
  Answer?: DohAnswer[];
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const A_RECORD = 1;
const AAAA_RECORD = 28;

export async function resolveHostViaDoh(
  hostname: string,
  fetchImpl: FetchLike,
  timeoutMs = 5_000,
): Promise<string[]> {
  const ips = new Set<string>();

  for (const type of ["A", "AAAA"] as const) {
    const endpoint =
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`;
    let payload: DohResponse | null = null;
    // One retry per query type: a single transient DoH blip must not fail
    // an otherwise public hostname (a likely cause of flaky apex rejections).
    for (let attempt = 0; attempt < 2 && payload === null; attempt += 1) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`DoH query timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      });
      try {
        const response = await Promise.race([
          fetchImpl(endpoint, {
            headers: { accept: "application/dns-json" },
            signal: controller.signal,
          }),
          timeout,
        ]);
        if (!response.ok) continue;
        payload = (await response.json()) as DohResponse;
      } catch {
        continue;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
    for (const answer of payload?.Answer ?? []) {
      if (answer.type === A_RECORD || answer.type === AAAA_RECORD) {
        ips.add(answer.data);
      }
    }
  }

  return [...ips];
}
