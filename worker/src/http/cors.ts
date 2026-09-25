import type { Env } from "../types";

export function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  const configured = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const origin = request.headers.get("origin");

  if (configured.length === 0) {
    headers.set("access-control-allow-origin", "*");
  } else if (origin && configured.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.append("vary", "Origin");
  } else if (!origin) {
    headers.set("access-control-allow-origin", configured[0]!);
  }

  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-max-age", "86400");
  return headers;
}

export function attachCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(request, env)) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}
