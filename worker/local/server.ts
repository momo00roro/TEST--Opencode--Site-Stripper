import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { handleRequest } from "../src/app.js";
import type { Env } from "../src/types.js";
import { createLocalLauncher, describeLocalBackend } from "./launcher.js";

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
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = resolve(join(webRoot, relative));

  if (!target.startsWith(webRoot + sep) && target !== webRoot) {
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

  if (url.pathname === "/health" || url.pathname.startsWith("/api/")) {
    try {
      const body = await readBody(req);
      const request = new Request(url.toString(), {
        method: req.method ?? "GET",
        headers: toHeaders(req),
        ...(body ? { body } : {}),
      });

      const response = await handleRequest(request, env, {
        launcher,
        encodeBase64: (bytes) => Buffer.from(bytes).toString("base64"),
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

server.listen(port, () => {
  console.log(`site-stripper local server running at http://localhost:${port}`);
  console.log(`backend: ${describeLocalBackend()}`);
  console.log(`serving UI from ${webRoot}`);
});

