import type { SnapshotAsset } from "../browser/snapshot-script";
import { LIMITS } from "../config/limits";
import { assertPublicTarget, parseHttpUrl } from "../validation/url";

// CF13 asset rehydration: after the manifest is built, the API layer (not the
// browser) downloads eligible SVGs with plain fetch and stores the raw text
// on the manifest entry. Worker-safe: text only, no base64, no DOM.

export const REHYDRATABLE_KINDS = new Set(["logo", "icon", "hero"]);

const SVG_CONTENT_TYPE = "image/svg+xml";

export interface RehydrateOptions {
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  origin: string;
  // Optional override for the CF02-equivalent target check (tests, or
  // callers with their own validator). Defaults to parseHttpUrl +
  // assertPublicTarget semantics plus a same-origin requirement.
  validate?: (url: string) => Promise<void> | void;
  // Optional cap overrides (tests); production always uses LIMITS.
  perFileCap?: number;
  totalCap?: number;
  maxFiles?: number;
}

export interface RehydrateSummary {
  assets: SnapshotAsset[];
  downloaded: number;
  skipped: number;
  skippedOversize: number;
  skippedUnresolvable: number;
  totalBytes: number;
}

// Resolve a Next.js optimizer URL (`/_next/image?url=<path>`) to the
// underlying same-origin absolute URL. Plain same-origin URLs pass through
// resolved to absolute form. Returns null when the entry is cross-origin or
// otherwise unresolvable. Srcset-style values (`"url 1x, url 2x"`) resolve
// from their first candidate.
export function unwrapOptimizerUrl(raw: string, origin: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Srcset-style: first candidate wins, descriptor (if any) is dropped.
  const first = trimmed.split(",")[0]!.trim().split(/\s+/)[0]!;
  if (!first) return null;

  let parsed: URL;
  try {
    parsed = new URL(first, origin);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.origin !== origin) return null;

  if (parsed.pathname === "/_next/image") {
    const inner = parsed.searchParams.get("url");
    if (!inner) return null;
    let resolved: URL;
    try {
      resolved = new URL(inner, origin);
    } catch {
      return null;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    if (resolved.origin !== origin) return null;
    return resolved.toString();
  }

  return parsed.toString();
}

function slugify(value: string): string {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "asset";
}

// Deterministic ZIP-relative filename: manifest-order number plus a slug from
// the alt text (falling back to the unwrapped URL basename, never the
// optimizer path), always `.svg`.
export function assetFilename(asset: SnapshotAsset, index: number, resolvedUrl?: string): string {
  let base = String(asset.alt ?? "").trim();
  if (!base) {
    try {
      const path = new URL(resolvedUrl ?? asset.url, "http://localhost").pathname;
      const leaf = path.split("/").filter(Boolean).pop() ?? "";
      base = leaf.replace(/\.[a-z0-9]+$/i, "");
    } catch {
      base = "";
    }
  }
  const number = String(index + 1).padStart(2, "0");
  return `assets/${number}-${slugify(base)}.svg`;
}

async function readBodyCapped(
  response: Response,
  perFileCap: number,
): Promise<{ ok: true; text: string } | { ok: false; reason: "oversize" | "unreadable" }> {
  try {
    if (response.body) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          size += value.byteLength;
          if (size > perFileCap) {
            try {
              await reader.cancel();
            } catch {
              // Cancelling is best-effort; the oversize verdict stands.
            }
            return { ok: false, reason: "oversize" };
          }
          chunks.push(value);
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // Lock release is best-effort after a capped read.
        }
      }
      const merged = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { ok: true, text: new TextDecoder().decode(merged) };
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > perFileCap) {
      return { ok: false, reason: "oversize" };
    }
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

export async function rehydrateAssets(
  assets: SnapshotAsset[],
  options: RehydrateOptions,
): Promise<RehydrateSummary> {
  const perFileCap = options.perFileCap ?? LIMITS.maxAssetDownloadBytesPerFile;
  const totalCap = options.totalCap ?? LIMITS.maxAssetDownloadBytesTotal;
  const maxFiles = options.maxFiles ?? LIMITS.maxAssetDownloads;

  const out: SnapshotAsset[] = [];
  let downloaded = 0;
  let skippedOversize = 0;
  let skippedUnresolvable = 0;
  let totalBytes = 0;

  const finish = (): RehydrateSummary => ({
    assets: out,
    downloaded,
    skipped: out.length - downloaded,
    skippedOversize,
    skippedUnresolvable,
    totalBytes,
  });

  try {
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index]!;
      // Strip any previous CF13 annotation so re-runs are idempotent; the
      // verdict below re-attaches exactly one consistent set of fields.
      const {
        localPath: _localPath,
        bytes: _bytes,
        source: _source,
        skipReason: _skipReason,
        content: _content,
        ...base
      } = asset;
      void _localPath;
      void _bytes;
      void _source;
      void _skipReason;
      void _content;
      const referenceOnly = (skipReason: string): SnapshotAsset => ({
        ...base,
        source: "reference-only",
        skipReason,
      });

      try {
        if (!REHYDRATABLE_KINDS.has(asset.kind)) {
          out.push(referenceOnly("ineligible-kind"));
          continue;
        }
        if (downloaded >= maxFiles) {
          out.push(referenceOnly("count-cap"));
          continue;
        }
        if (totalBytes >= totalCap) {
          out.push(referenceOnly("total-cap"));
          continue;
        }

        const target = unwrapOptimizerUrl(asset.url, options.origin);
        if (!target) {
          skippedUnresolvable += 1;
          out.push(referenceOnly("unresolvable-url"));
          continue;
        }

        // CF02-equivalent check: same-origin plus the public-target validator
        // (no private/loopback/link-local, HTTP(S) only, standard ports).
        try {
          if (options.validate) {
            await options.validate(target);
          } else {
            const parsed = parseHttpUrl(target);
            if (parsed.origin !== options.origin) throw new Error("cross-origin asset");
            await assertPublicTarget(parsed, options.fetchImpl);
          }
        } catch {
          skippedUnresolvable += 1;
          out.push(referenceOnly("validation-failed"));
          continue;
        }

        let response: Response;
        try {
          response = await options.fetchImpl(target, {
            headers: { accept: SVG_CONTENT_TYPE },
            redirect: "follow",
          });
        } catch {
          out.push(referenceOnly("fetch-failed"));
          continue;
        }
        if (!response.ok) {
          out.push(referenceOnly("fetch-failed"));
          continue;
        }
        // Redirects are followed by fetch: re-check the landed origin.
        if (response.url) {
          try {
            if (new URL(response.url).origin !== options.origin) {
              skippedUnresolvable += 1;
              out.push(referenceOnly("cross-origin-redirect"));
              continue;
            }
          } catch {
            skippedUnresolvable += 1;
            out.push(referenceOnly("unresolvable-url"));
            continue;
          }
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes(SVG_CONTENT_TYPE)) {
          out.push(referenceOnly("non-svg-content-type"));
          continue;
        }

        // Cheap pre-check before streaming the body.
        const declared = Number(response.headers.get("content-length") ?? "");
        if (Number.isFinite(declared) && declared > 0 && declared > perFileCap) {
          skippedOversize += 1;
          out.push(referenceOnly("oversize"));
          continue;
        }

        const body = await readBodyCapped(response, perFileCap);
        if (!body.ok) {
          if (body.reason === "oversize") skippedOversize += 1;
          out.push(referenceOnly(body.reason === "oversize" ? "oversize" : "fetch-failed"));
          continue;
        }

        const bytes = new TextEncoder().encode(body.text).byteLength;
        if (totalBytes + bytes > totalCap) {
          out.push(referenceOnly("total-cap"));
          continue;
        }
        totalBytes += bytes;
        downloaded += 1;
        out.push({
          ...base,
          source: "downloaded",
          localPath: assetFilename(asset, index, target),
          bytes,
          content: body.text,
        });
      } catch {
        // Shortfall is recorded, never thrown: one bad asset must not fail
        // the analysis.
        out.push(referenceOnly("fetch-failed"));
      }
    }
  } catch {
    // Catastrophic failure (e.g. bad options): every entry stays a URL
    // reference rather than failing the run.
    while (out.length < assets.length) {
      const asset = assets[out.length]!;
      const {
        localPath: _lp,
        bytes: _b,
        source: _s,
        skipReason: _sr,
        content: _c,
        ...base
      } = asset;
      void _lp;
      void _b;
      void _s;
      void _sr;
      void _c;
      out.push({ ...base, source: "reference-only", skipReason: "rehydration-error" });
    }
  }

  return finish();
}
