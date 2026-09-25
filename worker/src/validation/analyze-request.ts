import { LIMITS } from "../config/limits";
import { ApiError, badRequest } from "../http/errors";
import type { FetchLike } from "./doh";
import { assertPublicTarget, parseHttpUrl, type NormalizedUrl } from "./url";

export interface AnalyzeRequest {
  target: NormalizedUrl;
  resolvedIps: string[];
  maxPages: number;
  includeMobile: boolean;
}

export interface ParseDeps {
  fetchImpl: FetchLike;
}

function clampMaxPages(value: unknown): number {
  if (value === undefined || value === null) return LIMITS.maxPagesDefault;
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
    throw badRequest("INVALID_BODY", "`maxPages` must be a finite number.");
  }
  const rounded = Math.floor(numeric);
  return Math.min(Math.max(rounded, 1), LIMITS.maxPagesHardMax);
}

function readIncludeMobile(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== "boolean") {
    throw badRequest("INVALID_BODY", "`includeMobile` must be a boolean.");
  }
  return value;
}

export async function parseAnalyzeRequest(
  request: Request,
  deps: ParseDeps,
): Promise<AnalyzeRequest> {
  const text = await request.text();

  // Fail fast on oversized bodies so a hostile client cannot force the
  // 128 MB isolate to buffer arbitrarily large payloads.
  if (text.length > 8 * 1024) {
    throw badRequest("INVALID_BODY", "Request body is too large; keep it under 8 KB.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest("INVALID_JSON", "Request body must be valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw badRequest("INVALID_BODY", "Request body must be a JSON object.");
  }

  const body = parsed as Record<string, unknown>;
  const target = parseHttpUrl(body.url);
  const maxPages = clampMaxPages(body.maxPages);
  const includeMobile = readIncludeMobile(body.includeMobile);
  const resolvedIps = await assertPublicTarget(target, deps.fetchImpl);

  return { target, resolvedIps, maxPages, includeMobile };
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
