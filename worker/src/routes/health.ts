import { LIMITS, SCHEMA_VERSION } from "../config/limits";
import { json } from "../http/response";
import type { Env } from "../types";

export function handleHealth(env: Env): Response {
  return json(
    {
      status: "ok",
      service: "site-stripper-api",
      schemaVersion: SCHEMA_VERSION,
      environment: env.ENVIRONMENT ?? "unknown",
      time: new Date().toISOString(),
      features: {
        browserRendering: Boolean(env.BROWSER),
        maxPages: LIMITS.maxPagesHardMax,
      },
    },
    200,
    { "cache-control": "no-store" },
  );
}
