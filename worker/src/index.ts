import { handleRequest } from "./app";
import type { Env, WorkerExport } from "./types";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies WorkerExport;

export { handleRequest };
