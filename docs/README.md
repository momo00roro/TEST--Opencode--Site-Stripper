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
| **2026-10-02** | [`2026-10-02-cf28-native-video-capture.md`](./plans/2026-10-02-cf28-native-video-capture.md) | CF28: native `<video>` muted force-play + stale-clip guard + top-left clip origin (affinity 4/4 production, higgsfield 12-take scale run) | **Completed** |
| **2026-10-03** | [`2026-10-03-capture-budget-optimization.md`](./plans/2026-10-03-capture-budget-optimization.md) | CF29: capture budget optimization — measure-first investigation of the ~3 min/run video-heavy burn | *Resolved → CF30* |
| **2026-10-04** | [`2026-10-04-cf30-native-base64-and-orphan-guard.md`](./plans/2026-10-04-cf30-native-base64-and-orphan-guard.md) | CF30: Chromium-native base64 (Trap 4, drops Worker-side encoding) + 90 s browser-session orphan guard | **Completed** |
| **2026-10-05** | [`2026-10-04-cf30-native-base64-and-orphan-guard.md`](./plans/2026-10-04-cf30-native-base64-and-orphan-guard.md) (CF31 section) | CF31: extract-only mode (`?screenshots=0`) — observations without binaries, doubles as the 1102 diagnostic | **Completed** |
| **2026-10-06** | [`2026-10-06-cf34-local-fidelity.md`](./plans/2026-10-06-cf34-local-fidelity.md) | CF34: local-full fidelity track — design RFC + TDD implementation record merged (section shots, canvas, fonts, placeholders); hosted lite byte-identical | **Completed** |
| **2026-10-08** | [`2026-10-08-cf39-promptability-directives.md`](./plans/2026-10-08-cf39-promptability-directives.md) | CF39–CF40: pack→agent promptability directives (display face, treatments, CTA fills, icons, tab panels) + eval harness (`scripts/eval/`) | **Completed** |
| **2026-10-09** | [`2026-10-09-cf43-cf44-drift-surface-expansion.md`](./plans/2026-10-09-cf43-cf44-drift-surface-expansion.md) | CF41–CF44: drift guard, headline positions, `design-system.md` expansion kit, `expand-check.mjs` | **Completed** |
| **2026-10-10** | [`2026-10-10-cf45-cf46-taste-hover-replay.md`](./plans/2026-10-10-cf45-cf46-taste-hover-replay.md) | CF45–CF46: taste capture (CTA/tile/tab/hover/eyebrow/margins) + observed hover replay + h3/h4 roles | **Completed** |
| **2026-10-11** | [`2026-10-11-cf47-eye-detail.md`](./plans/2026-10-11-cf47-eye-detail.md) | CF47: eye-comparison detail capture — rendered heading weight, CTA borders, nav chrome (brand/dropdowns/actions), scroll strips, prose links, placeholder rotation, `capturedAt` recency | **Completed** |

---

## Supporting references

* **[`images/`](./images/)** — screenshots embedded in the root README
  (localhost app, rebuild gallery, cline/base44 clones, mobile 390 px).
  Captured headless via `puppeteer-core` + `sharp`; re-shoot any time with
  the same flow.
* **`../scripts/eval/README.md`** — the live eval harness contract
  (`PROMPT.md`, `score.mjs` ≥92 gate, `expand-check.mjs`, `build-pack.mjs`,
  `capture-once.ts`, `regen-docs.mjs`).
* **`../.archive/`** — gitignored local history: superseded packs/rebuilds,
  plus `scripts-eval-probes/` (16 retired one-off measurement scripts, indexed).

---

## Architectural Principles to Remember

1. **Free-Tier Limits Rule Everything**:
   - 10 ms CPU per Worker invocation — no Markdown formatting, ZIP compression, or image transcoding in Worker JS.
   - 10 browser-minutes/day — sequential tabs, immediate tab close, tracker blocking.
2. **Canonical Observations**:
   - `data/pages.json` is canonical. Markdown, tokens, and theme configs are client projections of those records.
3. **Dual-Environment Parity**:
   - Every feature must work both locally via `npm run dev:local -w worker` and remotely in Cloudflare Workers / Browser Rendering.
