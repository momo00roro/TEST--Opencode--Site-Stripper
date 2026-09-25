import { createCloudflareLauncher } from "../browser/launcher";
import type { SessionLauncher } from "../browser/types";
import { ApiError } from "../http/errors";
import { json } from "../http/response";
import { runAnalysis, type AnalysisProgress } from "../pipeline/analysis";
import { parseAnalyzeRequest } from "../validation/analyze-request";
import type { Env } from "../types";

export interface AnalyzeRouteDeps {
  fetchImpl?: typeof fetch;
  launcher?: SessionLauncher;
  encodeBase64?: (bytes: Uint8Array) => string;
}

export function resolveLauncher(env: Env, deps: AnalyzeRouteDeps): SessionLauncher {
  if (deps.launcher) return deps.launcher;
  if (env.BROWSER) return createCloudflareLauncher(env.BROWSER);
  throw new ApiError(
    "INTERNAL",
    500,
    "No browser backend is configured. Deploy with the Browser Rendering binding, or run `npm run dev:local`.",
  );
}

/** Clients that accept NDJSON get a live progress stream; everyone else gets one JSON body. */
function wantsStream(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/x-ndjson");
}

function errorPayload(error: unknown): { code: string; message: string } {
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  return { code: "INTERNAL", message: "Unexpected server error." };
}

export async function handleAnalyze(
  request: Request,
  env: Env,
  deps: AnalyzeRouteDeps = {},
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const parsed = await parseAnalyzeRequest(request, { fetchImpl });
  const launcher = resolveLauncher(env, deps);

  if (!wantsStream(request)) {
    const result = await runAnalysis(launcher, parsed, {
      encodeBase64: deps.encodeBase64,
      fetchImpl,
    });
    return json(result, 200, { "cache-control": "no-store" });
  }

  // Streaming NDJSON: one progress line per event, then a final result line.
  // Nothing is buffered beyond a single small line, so this stays CPU-cheap.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown): void => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          // Client disconnected; the analysis continues and is discarded.
        }
      };
      const onProgress = (event: AnalysisProgress): void => {
        send({ type: "progress", ...event });
      };

      runAnalysis(launcher, parsed, {
        encodeBase64: deps.encodeBase64,
        fetchImpl,
        onProgress,
      })
        .then((result) => {
          // Keep each serialized observation bounded to one page instead of
          // JSON-stringifying all 10 pages into a single Worker chunk.
          const { pages, ...summary } = result;
          for (const page of pages) send({ type: "page", page });
          send({ type: "result", result: summary });
        })
        .catch((error: unknown) => send({ type: "error", error: errorPayload(error) }))
        .finally(() => {
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
