# CF13 — Asset rehydration (download critical SVGs at capture time)

Status: specified 2026-09-27 (GMT+8). Not implemented.

## Problem (proven by dogfood)

Two rebuild experiments (`.testing/2026-09-27__ronniechanjr.com/`,
`.testing/2026-09-27__cline.bot/`, ~85–90% static similarity) shared one
visible gap class: **image assets referenced by URL but unusable at rebuild
time**. The cline.bot provider-icon grid rendered empty and the nav logo
doubled because all 31 SVG URLs are Next.js optimizer URLs
(`/_next/image?url=/assets/...`) that 404 outside the source site.
`data/assets.json` records URLs faithfully; it preserves nothing.

Measured cost of fixing: 31 SVGs ≈ 100–150 KB total (~2% of the 6 MB
screenshot cap, ~0.5% of the 24 MiB doc cap) via ~31 cheap `fetch`
subrequests (no browser-minutes).

## Design

After the manifest is built, the API layer (not the browser) downloads
eligible assets with plain `fetch` and stores bytes in the pack under
`assets/`; the manifest gains a `localPath`. The client ZIP includes the
`assets/` directory; document renderers prefer `localPath` with the remote
URL as fallback.

### Eligibility (all must hold)

1. `kind` is `logo`, `icon`, or `hero`.
2. Same-origin with the analyzed site after redirect resolution; reuse the
   CF02 target validator (no private/loopback/link-local, HTTP(S) only,
   standard ports).
3. Optimizer URLs are unwrapped first: `/_next/image?url=<path>` (and
   `srcset` equivalents) resolve to the underlying same-origin `<path>`;
   unresolvable entries stay `reference-only`.
4. Byte cap: 50 KB per file, 512 KB total, max 40 files per analysis.
   First-come (document order: header → hero → content → footer), never
   exceed; shortfall is recorded, never an error.
5. Content check: response `content-type` must be `image/svg+xml` (sniffed,
   not extension-trusted). Non-SVG kinds are out of scope for CF13.

### Manifest shape (additive)

Each `data/assets.json` entry gains:

```json
{"localPath":"assets/03-samsung.svg","bytes":2412,"source":"downloaded"}
```

Entries not downloaded carry `"source":"reference-only"` and no `localPath`.
`report.json.limitations` notes counts: downloaded / skipped-oversize /
skipped-unresolvable, with reasons.

### Safety

- SVGs ship as inert files inside the ZIP; renderers reference them via
  `<img src>`, never inline their markup into generated documents (no
  script-execution surface in the pack).
- Downloads use `fetch` subrequests, counted against the 50-per-request
  budget; batch after page analysis, not per tab. Reuse Cache API entries
  where a sibling analysis already fetched the same URL.
- Worker CPU: stream bytes to the response without base64 in Worker JS
  (Trap 4 applies to asset bytes exactly as it does to screenshots);
  base64/inlining happens client-side or via the local Node encoder only.

### Limits (add to `worker/src/config/limits.ts`)

| Limit | Value |
| --- | --- |
| Per-asset download cap | 50 KB |
| Total asset download cap | 512 KB |
| Max downloaded assets | 40 |
| Eligible kinds | `logo`, `icon`, `hero` |
| Eligible type | `image/svg+xml` only |

### Tests (mirror existing conventions)

- Unit: optimizer-URL unwrapping (valid, malformed, cross-origin → skip);
  cap enforcement (oversize single file, total overflow, count overflow);
  manifest shape (`localPath`/`bytes`/`source` present and consistent).
- Fake-backend: all-skipped pack still validates (no `localPath` required).
- Acceptance: rebuild-fidelity checklist — a pack with `source:downloaded`
  entries must render its logo/icon grid with zero external requests
  (assert in the `.testing` harness, not in vitest).

## Non-goals

Raster downloads (PNG/JPEG/WebP), video posters, fonts, `srcset`
resolution beyond the `url=` unwrap, rewriting generated Markdown to embed
bytes. Those reuse this pipeline later; CF13 is SVG-only.
