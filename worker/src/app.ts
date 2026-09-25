import { attachCors, corsHeaders } from "./http/cors";
import { errorResponse, methodNotAllowed, notFound } from "./http/response";
import { handleAnalyze, type AnalyzeRouteDeps } from "./routes/analyze";
import { handleHealth } from "./routes/health";
import type { Env } from "./types";

const ROUTES = new Map<string, readonly string[]>([
  ["/health", ["GET", "HEAD"]],
  ["/api/analyze", ["POST"]],
]);

export async function handleRequest(
  request: Request,
  env: Env,
  deps: AnalyzeRouteDeps = {},
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  try {
    const allowed = ROUTES.get(url.pathname);
    let response: Response;

    if (!allowed) {
      response = notFound();
    } else if (!allowed.includes(request.method)) {
      response = methodNotAllowed([...allowed]);
    } else if (url.pathname === "/health") {
      response = handleHealth(env);
    } else {
      response = await handleAnalyze(request, env, deps);
    }

    return attachCors(response, request, env);
  } catch (error) {
    return attachCors(errorResponse(error), request, env);
  }
}
