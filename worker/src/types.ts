export interface BrowserBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
  BROWSER?: BrowserBinding;
  ALLOWED_ORIGINS?: string;
  ENVIRONMENT?: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface WorkerExport {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}
