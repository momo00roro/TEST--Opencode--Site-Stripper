import type { SnapshotAsset } from "../browser/snapshot-script";
import { LIMITS } from "../config/limits";
import { assertPublicTarget, parseHttpUrl } from "../validation/url";

// CF13 asset rehydration: after the manifest is built, the API layer (not the
// browser) downloads eligible SVGs with plain fetch and stores the raw text
// on the manifest entry. Worker-safe: text only, no base64, no DOM.

export const REHYDRATABLE_KINDS = new Set(["logo", "icon", "hero", "poster"]);

// Defense-in-depth for manifests captured before the snapshot classifier
// learned SVG <img> elements: a kind:"image" entry whose unwrapped target is
// an .svg file (provider logos under /assets/images/home/models/) is treated
// as rehydratable. Non-SVG images (photos, pixels, PNG/JPG) stay excluded,
// and the content-type check below still rejects anything that is not SVG.
function isSvgTarget(target: string): boolean {
  try {
    return /\.svg$/i.test(new URL(target).pathname);
  } catch {
    return false;
  }
}

// Poster-kind fallback for plain cross-origin absolute URLs (CDN hosts).
// Still requires absolute HTTP(S), standard ports, no credentials — the
// same-origin equality check is skipped, but assertPublicTarget below is not.
function resolveCrossOriginPosterTarget(raw: string): string | null {
  try {
    return parseHttpUrl(raw).raw;
  } catch {
    return null;
  }
}

const SVG_CONTENT_TYPE = "image/svg+xml";

// CF25 fallback thumbnails: facades that never played (wall/byte skips) and
// captured no poster would leave blank bands. For Vimeo embeds the public
// oEmbed endpoint yields a thumbnail_url with one tiny JSON fetch — zero
// browser-minutes, plain Node fetch like every other rehydration download.

/** Numeric Vimeo id from a watch or player URL, or null. */
export function vimeoVideoId(raw: string): string | null {
  try {
    const parsed = new URL(String(raw ?? ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    const match = /^(?:www\.)?vimeo\.com$/.test(host)
      ? parsed.pathname.match(/(?:^|\/)(\d+)(?:\/|$)/)
      : host === "player.vimeo.com"
        ? parsed.pathname.match(/^\/video\/(\d+)(?:\/|$)/)
        : null;
    return match ? match[1]! : null;
  } catch {
    return null;
  }
}

/** oEmbed lookup URL for a Vimeo video URL, or null when it has no Vimeo id. */
export function vimeoOEmbedUrl(videoUrl: string): string | null {
  const id = vimeoVideoId(videoUrl);
  if (!id) return null;
  return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${id}`)}`;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Resolve a Vimeo stream URL to its thumbnail_url via oEmbed. Returns null
 * for non-Vimeo URLs, fetch failures, bad JSON, or missing/invalid
 * thumbnails. Never throws — shortfall is the caller's honest skip.
 */
export async function fetchVimeoThumbnailUrl(streamUrl: string, fetchImpl: FetchLike): Promise<string | null> {
  const lookup = vimeoOEmbedUrl(streamUrl);
  if (!lookup) return null;
  try {
    const response = await fetchImpl(lookup, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null) as { thumbnail_url?: unknown } | null;
    const thumb = typeof body?.thumbnail_url === "string" ? body.thumbnail_url : "";
    if (!thumb) return null;
    try {
      const parsed = new URL(thumb);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      return parsed.toString();
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

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
  // CF36-1 local-full only: when true, hero + image kinds also accept
  // raster bytes (image/jpeg, image/png, image/webp) with the same
  // content-type sniffing as posters. The same-origin rule still applies
  // to hero/image (only poster kind gets the cross-origin carve-out).
  allowRasterKinds?: boolean;
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
// optimizer path). Extension defaults to `.svg`; raster kinds pass the
// sniffed content-type extension instead.
export function assetFilename(asset: SnapshotAsset, index: number, resolvedUrl?: string, ext = ".svg"): string {
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
  return `assets/${number}-${slugify(base)}${ext}`;
}

async function readBodyCapped(
  response: Response,
  perFileCap: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: "oversize" | "unreadable" }> {
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
      return { ok: true, bytes: merged };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > perFileCap) {
      return { ok: false, reason: "oversize" };
    }
    return { ok: true, bytes };
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
  // CF36-1: local-full raster gate. Hosted (flag unset) keeps today's
  // SVG-only behavior for hero/image byte-identically.
  const allowRasterKinds = options.allowRasterKinds === true;

  const out: SnapshotAsset[] = new Array(assets.length);
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

  // Phase A: resolve targets and eligibility without fetching or consuming
  // caps, so Phase B can order downloads.
  const planned = assets.map((asset) => {
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
    // Unwrap before the kind gate so kind:"image" entries pointing at
    // .svg files can be recognized as rehydratable below. Unresolvable
    // targets stay ineligible without consuming caps. Cross-origin
    // targets stay ineligible too — except poster kind, whose CDN hosts
    // (Sanity, Vimeo thumbs) are validated by the public-target SSRF
    // guard below instead of the same-origin rule.
    const target =
      unwrapOptimizerUrl(asset.url, options.origin) ??
      (asset.kind === "poster" ? resolveCrossOriginPosterTarget(asset.url) : null);
    const eligible =
      REHYDRATABLE_KINDS.has(asset.kind) ||
      (asset.kind === "image" &&
        target !== null &&
        (isSvgTarget(target) || allowRasterKinds));
    return { asset, base, referenceOnly, target, eligible, posterKind: asset.kind === "poster" };
  });

  type Planned = (typeof planned)[number];

  const attempt = async (index: number, entry: Planned): Promise<void> => {
    const { asset, base, referenceOnly, target, posterKind } = entry;
    const done = (result: SnapshotAsset): void => {
      out[index] = result;
    };
    try {
      if (downloaded >= maxFiles) {
        done(referenceOnly("count-cap"));
        return;
      }
      if (totalBytes >= totalCap) {
        done(referenceOnly("total-cap"));
        return;
      }

      if (!target) {
        skippedUnresolvable += 1;
        done(referenceOnly("unresolvable-url"));
        return;
      }

      // CF02-equivalent check: same-origin plus the public-target validator
      // (no private/loopback/link-local, HTTP(S) only, standard ports).
      // CF14 posters usually live on third-party CDNs (Sanity, Vimeo
      // thumbs), so poster kind skips the same-origin equality check —
      // but ALWAYS keeps assertPublicTarget, the actual SSRF guard.
      try {
        if (options.validate) {
          await options.validate(target);
        } else {
          const parsed = parseHttpUrl(target);
          if (!posterKind && parsed.origin !== options.origin) {
            throw new Error("cross-origin asset");
          }
          await assertPublicTarget(parsed, options.fetchImpl);
        }
      } catch {
        skippedUnresolvable += 1;
        done(referenceOnly("validation-failed"));
        return;
      }

      let response: Response;
      try {
        // CF36-1: raster-eligible hero/image ask for SVG or raster; every
        // other non-poster kind keeps today's SVG-only accept header.
        const rasterEligible = allowRasterKinds && (asset.kind === "hero" || asset.kind === "image");
        response = await options.fetchImpl(target, {
          headers: {
            accept: posterKind
              ? "image/jpeg,image/png,image/webp"
              : rasterEligible
                ? "image/svg+xml,image/jpeg,image/png,image/webp"
                : SVG_CONTENT_TYPE,
          },
          redirect: "follow",
        });
      } catch {
        done(referenceOnly("fetch-failed"));
        return;
      }
      if (!response.ok) {
        done(referenceOnly("fetch-failed"));
        return;
      }
      // Redirects are followed by fetch: re-check the landed URL. Same
      // poster carve-out as above: public-target, not same-origin.
      if (response.url) {
        try {
          if (new URL(response.url).origin !== options.origin) {
            if (!posterKind) {
              skippedUnresolvable += 1;
              done(referenceOnly("cross-origin-redirect"));
              return;
            }
            await assertPublicTarget(parseHttpUrl(response.url), options.fetchImpl);
          }
        } catch {
          skippedUnresolvable += 1;
          done(referenceOnly("unresolvable-url"));
          return;
        }
      }

      // CF14: posters ship raster bytes (content-type sniffed, never
      // extension-trusted); every other kind must be SVG text — except
      // CF36-1 local-full, where hero/image also accept raster bytes with
      // the same sniffing as posters.
      const contentType = response.headers.get("content-type") ?? "";
      const lowered = contentType.toLowerCase();
      const sniffRaster = (): string | null => {
        if (lowered.includes("image/jpeg")) return ".jpg";
        if (lowered.includes("image/png")) return ".png";
        if (lowered.includes("image/webp")) return ".webp";
        return null;
      };
      let ext = ".svg";
      if (posterKind) {
        const raster = sniffRaster();
        if (!raster) {
          done(referenceOnly("non-image-content-type"));
          return;
        }
        ext = raster;
      } else if (allowRasterKinds && (asset.kind === "hero" || asset.kind === "image")) {
        const raster = sniffRaster();
        if (raster) {
          ext = raster;
        } else if (!lowered.includes(SVG_CONTENT_TYPE)) {
          done(referenceOnly("non-svg-content-type"));
          return;
        }
      } else if (!lowered.includes(SVG_CONTENT_TYPE)) {
        done(referenceOnly("non-svg-content-type"));
        return;
      }

      // Cheap pre-check before streaming the body.
      const declared = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > 0 && declared > perFileCap) {
        skippedOversize += 1;
        done(referenceOnly("oversize"));
        return;
      }

      const body = await readBodyCapped(response, perFileCap);
      if (!body.ok) {
        if (body.reason === "oversize") skippedOversize += 1;
        done(referenceOnly(body.reason === "oversize" ? "oversize" : "fetch-failed"));
        return;
      }

      const bytes = body.bytes.byteLength;
      if (totalBytes + bytes > totalCap) {
        done(referenceOnly("total-cap"));
        return;
      }
      totalBytes += bytes;
      downloaded += 1;
      const mime =
        ext === ".jpg" ? "image/jpeg"
        : ext === ".png" ? "image/png"
        : ext === ".webp" ? "image/webp"
        : "image/svg+xml";
      done({
        ...base,
        source: "downloaded",
        localPath: assetFilename(asset, index, target, ext),
        bytes,
        contentType: mime,
        // Raster bytes ride Uint8Array so the analysis dataUrl path
        // (encodeBase64 local-only, reference-only revert hosted) applies
        // exactly like posters; SVG stays decoded text.
        content: ext === ".svg" ? new TextDecoder().decode(body.bytes) : body.bytes,
      });
    } catch {
      // Shortfall is recorded, never thrown: one bad asset must not fail
      // the analysis.
      done(referenceOnly("fetch-failed"));
    }
  };

  try {
    // Phase B: split budget — eligible non-poster assets (logos, icons)
    // download first in document order so CDN poster frames can never starve
    // identity assets; posters use the remaining files and bytes. Filenames
    // keep manifest (document) order regardless of download order.
    const passes = [false, true];
    for (const wantPoster of passes) {
      for (let index = 0; index < planned.length; index += 1) {
        const entry = planned[index]!;
        if (!entry.eligible) {
          if (out[index] === undefined) out[index] = entry.referenceOnly("ineligible-kind");
          continue;
        }
        if (entry.posterKind !== wantPoster || out[index] !== undefined) continue;
        await attempt(index, entry);
      }
    }
  } catch {
    // Catastrophic failure (e.g. bad options): every unfilled entry stays a
    // URL reference rather than failing the run.
    for (let index = 0; index < assets.length; index += 1) {
      if (out[index] !== undefined) continue;
      const asset = assets[index]!;
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
      out[index] = { ...base, source: "reference-only", skipReason: "rehydration-error" };
    }
  }

  return finish();
}
