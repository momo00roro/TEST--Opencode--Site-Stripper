import { ApiError } from "./errors";

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(`${JSON.stringify(data)}\n`, {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function notFound(): Response {
  return json(new ApiError("NOT_FOUND", 404, "Route not found.").toJSON(), 404);
}

export function methodNotAllowed(allow: string[]): Response {
  const response = json(
    new ApiError("METHOD_NOT_ALLOWED", 405, "Method not allowed for this route.").toJSON(),
    405,
  );
  response.headers.set("allow", allow.join(", "));
  return response;
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return json(error.toJSON(), error.status);
  }
  // Never leak raw internal error text (stack hints, binding details) to the
  // client; unexpected failures return a generic, machine-readable 500.
  return json(new ApiError("INTERNAL", 500, "Unexpected server error.").toJSON(), 500);
}
