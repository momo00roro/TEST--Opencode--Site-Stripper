import type { SnapshotAsset } from "../browser/snapshot-script";
import { LIMITS } from "../config/limits";
import { assertPublicTarget, parseHttpUrl } from "../validation/url";

// CF13 asset rehydration: after the manifest is built, the API layer (not the
// browser) downloads eligible SVGs with plain fetch and stores the raw text
// on the manifest entry. Worker-safe: text only, no base64, no DOM.

export const REHYDRATABLE_KINDS = new Set(["logo", "icon", "hero", "poster", "font"]);

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

// CF36-2 @font-face file downloads (local-full only; hosted/lite never
// collects font entries, so their behavior is byte-identical). @font-face
// files usually live on cross-origin font CDNs (fonts.gstatic.com), so font
// kind gets the same carve-out as posters: assertPublicTarget (the real SSRF
// guard) always applies, but the same-origin equality check is skipped.
// Same-origin URLs are still preferred first at collection time —
// collectFontAssets partitions same-origin before cross-origin — so first-
// party self-hosted fonts win the shared caps. Distinct URLs only, capped at
// MAX_FONT_DOWNLOADS; only woff2/woff/ttf/otf URL patterns (never
// extension-trusted alone: the content-type sniff below must also agree, and
// data: URLs are skipped at collection time).
export const MAX_FONT_DOWNLOADS = 16;

const FONT_EXT_RE = /\.(woff2|woff|ttf|otf)(\?|#|$)/i;

/** url() targets inside an @font-face src value, in order. Skips data:. */
export function extractFontUrls(src: string): string[] {
  const out: string[] = [];
  if (typeof src !== "string") return out;
  const re = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src)) !== null) {
    const url = match[1]!.trim();
    if (url && !/^data:/i.test(url)) out.push(url);
  }
  return out;
}

function isFontUrl(raw: string): boolean {
  const url = String(raw ?? "").trim();
  if (!url || /^data:/i.test(url)) return false;
  try {
    const parsed = new URL(url, "http://localhost");
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return FONT_EXT_RE.test(parsed.pathname) || FONT_EXT_RE.test(url);
  } catch {
    return false;
  }
}

function fontExtFromUrl(raw: string): string | null {
  const match = /\.((?:woff2|woff|ttf|otf))(?:[?#]|$)/i.exec(String(raw ?? ""));
  if (!match) return null;
  const ext = match[1]!.toLowerCase();
  return ext === "woff2" ? ".woff2" : ext === "woff" ? ".woff" : ext === "ttf" ? ".ttf" : ".otf";
}

// Content-type sniff for font binaries (never extension-trusted alone).
// Known font MIME types map to extensions; an unrecognized-but-harmless
// type (e.g. application/octet-stream, or a missing content-type) falls back
// to the URL extension; text/html (and anything else) rejects.
function sniffFontExt(contentType: string, target: string): string | null {
  const lowered = String(contentType ?? "").toLowerCase();
  if (/text\/html/.test(lowered)) return null;
  if (lowered.includes("font/woff2")) return ".woff2";
  if (lowered.includes("font/woff") || lowered.includes("application/font-woff") || lowered.includes("application/x-font-woff")) return ".woff";
  if (lowered.includes("font/ttf") || lowered.includes("application/x-font-ttf") || lowered.includes("font/sfnt")) {
    return /\.otf(\?|#|$)/i.test(target) ? ".otf" : ".ttf";
  }
  if (lowered.includes("font/otf") || lowered.includes("application/x-font-otf") || lowered.includes("font/collection")) return ".otf";
  if (lowered.includes("application/octet-stream") || lowered.trim() === "") return fontExtFromUrl(target);
  if (lowered.includes("font") || lowered.includes("opentype") || lowered.includes("truetype")) return fontExtFromUrl(target);
  return null;
}

export function fontMimeForExt(ext: string): string {
  return ext === ".woff2" ? "font/woff2"
    : ext === ".woff" ? "font/woff"
    : ext === ".ttf" ? "font/ttf"
    : "font/otf";
}

// Deterministic ZIP-relative font filename:
// assets/fonts/<family>-<weight>.<ext>, slugified, with a numeric suffix on
// collision (same family+weight shipped in multiple subsets/files).
export function fontFilename(
  asset: SnapshotAsset,
  target: string,
  ext: string,
  taken: Set<string>,
): string {
  void target;
  const family = slugify(String(asset.fontFamily ?? asset.alt ?? "font")).slice(0, 40) || "font";
  const weight = String(asset.fontWeight ?? "400").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12) || "400";
  const base = `assets/fonts/${family}-${weight}`;
  let candidate = `${base}${ext}`;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}${ext}`;
    suffix += 1;
  }
  taken.add(candidate);
  return candidate;
}

interface FontFaceSource {
  typography?: {
    fontFaces?: Array<{ family?: unknown; src?: unknown; weight?: unknown }> | null;
    fontFamilies?: Array<{ value?: unknown }> | null;
  } | null;
  url?: unknown;
  path?: unknown;
}

/**
 * Collect distinct @font-face file URLs from pages' typography snapshots in
 * document order, same-origin first (then cross-origin), capped at
 * MAX_FONT_DOWNLOADS. Returns kind:"font" manifest entries the rehydrate
 * pipeline downloads like every other asset. Callers gate this on
 * local-full only; hosted/lite never calls it, so their packs are unchanged.
 */
const IGNORED_FAMILY = /^(sans-serif|serif|monospace|cursive|fantasy|system-ui|-apple-system|ui-sans-serif|ui-serif|ui-monospace|inherit|initial|unset)$/i;

/** Family names (lowercased) actually rendered on a page, from computed styles.
 * Excludes generic keywords and *Fallback shims so only real families count. */
function usedFamiliesOf(page: FontFaceSource): Set<string> {
  const out = new Set<string>();
  for (const fam of page?.typography?.fontFamilies ?? []) {
    for (const token of String(fam?.value ?? "").split(",")) {
      const name = token.replace(/["']/g, "").trim().toLowerCase();
      if (name && !IGNORED_FAMILY.test(name) && !/fallback$/.test(name)) out.add(name);
    }
  }
  return out;
}

export function collectFontAssets(
  pages: FontFaceSource[],
  origin: string,
  maxFiles: number = MAX_FONT_DOWNLOADS,
): SnapshotAsset[] {
  const seen = new Set<string>();
  const ranked: { entry: SnapshotAsset; key: number[] }[] = [];
  let order = 0;
  for (const page of pages ?? []) {
    const faces = page?.typography?.fontFaces ?? [];
    const usedFamilies = usedFamiliesOf(page);
    const usedOn = typeof page?.url === "string" && page.url ? page.url
      : typeof page?.path === "string" && page.path ? page.path
      : origin;
    for (const face of faces) {
      const family = String(face?.family ?? "unknown").replace(/["']/g, "").trim().slice(0, 120) || "unknown";
      const weight = String(face?.weight ?? "400").trim().slice(0, 20) || "400";
      // CF38: a family that is merely DECLARED (e.g. a self-hosted face whose
      // files 404, or a phantom var font) can outrank the families the page
      // actually renders and exhaust the download cap. Rank rendered families
      // first, then same-origin, then woff2 over woff/ttf/otf.
      const renderedFam = usedFamilies.has(family.toLowerCase()) ? 0 : 1;
      for (const raw of extractFontUrls(String(face?.src ?? ""))) {
        if (!isFontUrl(raw)) continue;
        let absolute: string;
        try {
          absolute = new URL(raw, origin).toString();
        } catch {
          continue;
        }
        if (!/^https?:/i.test(absolute) || seen.has(absolute)) continue;
        seen.add(absolute);
        const ext = fontExtFromUrl(absolute) ?? "";
        const sameOrigin = (() => { try { return new URL(absolute).origin === origin ? 0 : 1; } catch { return 1; } })();
        const entry: SnapshotAsset = {
          url: absolute,
          kind: "font",
          alt: `${family} ${weight}`.slice(0, 140),
          width: null,
          height: null,
          usedOn,
          fontFamily: family,
          fontWeight: weight,
        };
        ranked.push({ entry, key: [renderedFam, sameOrigin, ext === ".woff2" ? 0 : 1, order] });
        order += 1;
      }
    }
  }
  ranked.sort((a, b) => {
    for (let i = 0; i < 3; i += 1) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
    return a.key[3] - b.key[3];
  });
  return ranked.slice(0, Math.max(0, maxFiles)).map((item) => item.entry);
}

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
  // content-type sniffing as posters. CF36-3: the flag also extends the
  // poster cross-origin carve-out (assertPublicTarget only, no
  // same-origin) to hero/image raster kinds. Same-origin stays the rule
  // for SVG/logo/icon (identity assets must be first-party).
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
    // guard below instead of the same-origin rule. CF36-2 font kind shares
    // the carve-out (fonts.gstatic.com and friends). CF36-3: hero/image
    // raster kinds share it too, but ONLY when allowRasterKinds (local-full)
    // is set — hosted/lite keeps today's same-origin behavior byte-identically.
    // SVG/logo/icon never get the carve-out (identity assets stay first-party).
    const rasterCarveout = allowRasterKinds && (asset.kind === "hero" || asset.kind === "image");
    const crossOriginOk = asset.kind === "poster" || asset.kind === "font" || rasterCarveout;
    const target =
      unwrapOptimizerUrl(asset.url, options.origin) ??
      (crossOriginOk ? resolveCrossOriginPosterTarget(asset.url) : null);
    const eligible =
      REHYDRATABLE_KINDS.has(asset.kind) ||
      (asset.kind === "image" &&
        target !== null &&
        (isSvgTarget(target) || allowRasterKinds));
    return { asset, base, referenceOnly, target, eligible, posterKind: asset.kind === "poster", fontKind: asset.kind === "font", rasterCarveout };
  });

  type Planned = (typeof planned)[number];

  // Tracks claimed assets/fonts/* paths so same family+weight collisions
  // (subset files) get deterministic numeric suffixes via fontFilename.
  const usedFontPaths = new Set<string>();

  const attempt = async (index: number, entry: Planned): Promise<void> => {
    const { asset, base, referenceOnly, target, posterKind, fontKind, rasterCarveout } = entry;
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
      // CF36-2 fonts get the same carve-out (fonts.gstatic.com and friends).
      // CF36-3: hero/image raster kinds get it too when allowRasterKinds
      // (local-full) is set; SVG/logo/icon never do.
      try {
        if (options.validate) {
          await options.validate(target);
        } else {
          const parsed = parseHttpUrl(target);
          if (!posterKind && !fontKind && !rasterCarveout && parsed.origin !== options.origin) {
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
        // CF36-2: fonts ask for font MIME types.
        const rasterEligible = allowRasterKinds && (asset.kind === "hero" || asset.kind === "image");
        response = await options.fetchImpl(target, {
          headers: {
            accept: posterKind
              ? "image/jpeg,image/png,image/webp"
              : fontKind
                ? "font/woff2,font/woff,font/ttf,font/otf,application/font-woff,*/*;q=0.8"
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
      // poster carve-out as above: public-target, not same-origin. Fonts
      // share the carve-out (CDN-to-CDN redirects are normal for fonts).
      // CF36-3: hero/image raster kinds share it when allowRasterKinds is set.
      if (response.url) {
        try {
          if (new URL(response.url).origin !== options.origin) {
            if (!posterKind && !fontKind && !rasterCarveout) {
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
      } else if (fontKind) {
        // CF36-2: font binaries are sniffed by content-type (never
        // extension-trusted alone); anything non-font stays a reference.
        const fontExt = sniffFontExt(contentType, target);
        if (!fontExt) {
          done(referenceOnly("non-font-content-type"));
          return;
        }
        ext = fontExt;
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
        : fontKind ? fontMimeForExt(ext)
        : "image/svg+xml";
      done({
        ...base,
        source: "downloaded",
        // CF36-2: fonts ship under assets/fonts/<family>-<weight>.<ext>;
        // every other kind keeps today's manifest-order assets/NN-slug path.
        localPath: fontKind ? fontFilename(asset, target, ext, usedFontPaths) : assetFilename(asset, index, target, ext),
        bytes,
        contentType: mime,
        // Raster + font bytes ride Uint8Array so the analysis dataUrl path
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
    // Phase B: split budget — eligible non-poster assets (logos, icons,
    // CF36-2 fonts) download first in document order so CDN poster frames
    // can never starve identity assets; posters use the remaining files and
    // bytes. Filenames keep manifest (document) order regardless of
    // download order (fonts use family-weight names under assets/fonts/).
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
