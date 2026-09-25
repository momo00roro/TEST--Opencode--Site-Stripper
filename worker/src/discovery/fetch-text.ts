export interface TextFetchResult {
  ok: boolean;
  status?: number;
  text: string;
  error?: string;
}

export async function fetchText(
  url: string,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  timeoutMs: number,
  maxBytes = 1_000_000,
): Promise<TextFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "text/plain, application/xml, text/xml, */*" },
    });

    if (!response.ok) {
      return { ok: false, status: response.status, text: "" };
    }

    const text = await response.text();
    return { ok: true, status: response.status, text: text.slice(0, maxBytes) };
  } catch (error) {
    return { ok: false, text: "", error: error instanceof Error ? error.message : "fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}
