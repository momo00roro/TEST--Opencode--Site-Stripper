import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localhostHostValidation, localhostOriginValidation } from "@modelcontextprotocol/node";
import { handleRequest } from "../src/app.js";
import type { AnalysisResult } from "../src/pipeline/analysis.js";
import type { Env } from "../src/types.js";
import { createAgentMcpHandler } from "./agent-mcp.js";
import { createAgentStateStore, type AgentActivityResponse } from "./agent-state.js";
import { createLocalLauncher, describeLocalBackend } from "./launcher.js";
import { resolveLocalStaticPath } from "./static.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const webRoot = resolve(here, "..", "..", "web");
const port = Number(process.env.PORT ?? 8787);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const launcher = createLocalLauncher();
const env: Env = {
  ENVIRONMENT: "local",
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? "",
};
const agentStateStore = createAgentStateStore();
const agentMcpHandler = createAgentMcpHandler({
  stateStore: agentStateStore,
  analyze: async (input) => {
    const request = new Request(`http://127.0.0.1:${port}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const response = await handleRequest(request, env, {
      launcher,
      encodeBase64: (bytes) => Buffer.from(bytes).toString("base64"),
      capture: "full",
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const errorPayload = payload && typeof payload === "object"
        ? (payload as { error?: { message?: unknown } }).error
        : undefined;
      const message = errorPayload && typeof errorPayload.message === "string"
        ? errorPayload.message
        : `Analysis request failed with status ${response.status}.`;
      throw new Error(message);
    }
    if (!payload || typeof payload !== "object") throw new Error("The analyzer returned an invalid response.");
    return payload as AnalysisResult;
  },
});
const validateMcpHost = localhostHostValidation();
const validateMcpOrigin = localhostOriginValidation();

async function readBody(req: IncomingMessage): Promise<Uint8Array | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(chunk as Uint8Array);
  if (chunks.length === 0) return undefined;
  return Buffer.concat(chunks);
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  return headers;
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const target = resolveLocalStaticPath(pathname, webRoot);
  if (!target) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      res.writeHead(404).end("Not found");
      return;
    }
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `localhost:${port}`}`);

  if (url.pathname === "/mcp") {
    if (!validateMcpHost(req, res) || !validateMcpOrigin(req, res)) return;
    try {
      await agentMcpHandler(req, res);
    } catch (error) {
      console.error("MCP request failed:", error instanceof Error ? error.message : error);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end("MCP request failed.");
    }
    return;
  }

  if (url.pathname === "/api/agent/activity") {
    if (req.method !== "GET") {
      res.writeHead(405, { allow: "GET", "cache-control": "no-store" }).end("Method not allowed");
      return;
    }
    const activity: AgentActivityResponse = {
      mcpEndpoint: `http://127.0.0.1:${port}/mcp`,
      ...agentStateStore.getSnapshot(),
    };
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    }).end(JSON.stringify(activity));
    return;
  }

  if (url.pathname === "/health" || url.pathname.startsWith("/api/")) {
    try {
      const body = await readBody(req);
      const request = new Request(url.toString(), {
        method: req.method ?? "GET",
        headers: toHeaders(req),
        ...(body ? { body: Uint8Array.from(body).buffer } : {}),
      });

      const response = await handleRequest(request, env, {
        launcher,
        encodeBase64: (bytes) => Buffer.from(bytes).toString("base64"),
        // Local is the most capable build (CF32): opened-up budgets, full
        // video cap. The hosted route passes "lite" instead.
        capture: "full",
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      res.writeHead(response.status, headers);
      // Stream chunk-by-chunk so the NDJSON progress feed reaches the browser
      // in real time; a buffered write would freeze the UI until completion.
      const reader = response.body?.getReader();
      if (reader) {
        let aborted = false;
        req.on("close", () => {
          aborted = true;
          reader.cancel().catch(() => undefined);
        });

        try {
          while (!aborted) {
            const { done, value } = await reader.read();
            if (done || aborted) break;
            if (value && res.writable) {
              res.write(Buffer.from(value));
            }
          }
        } catch (streamError) {
          console.warn("Stream interrupted:", streamError instanceof Error ? streamError.message : streamError);
        } finally {
          if (res.writable) res.end();
        }
      } else {
        res.end(Buffer.from(await response.arrayBuffer()));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      if (res.writable && !res.headersSent) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: { code: "INTERNAL", message } }));
      }
    }
    return;
  }

  await serveStatic(url.pathname, res);
});

server.on("error", (err) => {
  console.error("Server socket error:", err);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception in local server:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection in local server:", err);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`site-stripper local server running at http://127.0.0.1:${port}`);
  console.log(`backend: ${describeLocalBackend()}`);
  console.log(`serving UI from ${webRoot}`);
});

