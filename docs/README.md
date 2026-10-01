# Site Stripper — Documentation Index

This directory contains the authoritative specification, architecture docs, and chronological implementation plans for Site Stripper.

---

## Authoritative Specification (Source of Truth)

* **[`01-PRD.md`](./01-PRD.md)** — **Authoritative Product & Technical Specification**
  * Start here. Covers goals, Free-tier Cloudflare constraints, backend abstractions, extraction traps/mitigations, canonical schemas, numeric limits, security controls, and full definitions of done.

---

## Implementation Plans & Historical Records (`plans/`)

The [`plans/`](./plans/) directory tracks design RFCs and implementation roadmaps in chronological order.

| Date | File | Phase / Topic | Status |
| :--- | :--- | :--- | :--- |
| **2026-09-22** | [`2026-09-22-cf06-bounded-multi-page-analysis.md`](./plans/2026-09-22-cf06-bounded-multi-page-analysis.md) | Multi-page loop, session hygiene, wall/byte budgets | **Completed** |
| **2026-09-22** | [`2026-09-22-cf07-token-style-extraction.md`](./plans/2026-09-22-cf07-token-style-extraction.md) | CSSOM tokens, font inspection, responsive breakpoints | **Completed** |
| **2026-09-22** | [`2026-09-22-cf08-content-and-media.md`](./plans/2026-09-22-cf08-content-and-media.md) | Verbatim content, media manifest, code/table blocks | **Completed** |
| **2026-09-22** | [`2026-09-22-cf09-cf12-sequential.md`](./plans/2026-09-22-cf09-cf12-sequential.md) | Client document generation, ZIP packaging, acceptance tests | **Completed** |
| **2026-09-23** | [`2026-09-23-documentation-fidelity.md`](./plans/2026-09-23-documentation-fidelity.md) | Evidence-first docs: canonical observation schema + client-side rendering (design RFC merged in) | **Completed** |
| **2026-09-26** | [`2026-09-26-ui-cinematic-overhaul.md`](./plans/2026-09-26-ui-cinematic-overhaul.md) | Dark cinematic overhaul design + implementation (merged archive) | *Superseded* |
| **2026-09-27** | [`2026-09-27-cline-reskin.md`](./plans/2026-09-27-cline-reskin.md) | UI redesign to `cline.bot` light-first design language | **Active / Live** |
| **2026-09-27** | [`2026-09-27-cf13-asset-rehydration.md`](./plans/2026-09-27-cf13-asset-rehydration.md) | SVG download at capture, Next.js optimizer unwrap | **Completed** |
| **2026-09-29** | [`2026-09-29-fidelity-pack.md`](./plans/2026-09-29-fidelity-pack.md) | CF14–CF20: posters, behaviors, layout.json, REBUILD.md, breaks, budget split, rotation | **Completed** |
| **2026-09-30** | [`2026-09-30-video-capture.md`](./plans/2026-09-30-video-capture.md) | CF21–CF25: three-tier facade capture, pager, compositing, thumbnail fallback (figma 10/10) | **Completed** |
| **2026-10-01** | [`2026-10-01-cf26-hosted-binaries-spike.md`](./plans/2026-10-01-cf26-hosted-binaries-spike.md) | CF26: hosted binaries default-on (62–87 ms CPU measured, `?binaries=0` opts out) | **Completed** |

---

## Architectural Principles to Remember

1. **Free-Tier Limits Rule Everything**:
   - 10 ms CPU per Worker invocation — no Markdown formatting, ZIP compression, or image transcoding in Worker JS.
   - 10 browser-minutes/day — sequential tabs, immediate tab close, tracker blocking.
2. **Canonical Observations**:
   - `data/pages.json` is canonical. Markdown, tokens, and theme configs are client projections of those records.
3. **Dual-Environment Parity**:
   - Every feature must work both locally via `npm run dev:local -w worker` and remotely in Cloudflare Workers / Browser Rendering.
