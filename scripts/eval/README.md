# Eval harness — 1-prompt rebuild contract + scoring

Live tools (run from the repo root):

| Tool | Purpose |
|---|---|
| `PROMPT.md` | The fixed 1–3 prompt contract a fresh agent follows (rebuild → self-check → expand) |
| `score.mjs` | Composite fidelity gate ≥ 92 (`.4L+.25T+.2C+.15M`); anti-cheat; mobile 390 px report |
| `expand-check.mjs` | New-section/page adherence: tokens, radii, fonts, 1440/390 renders, `--base` diff |
| `build-pack.mjs` | Assemble a complete scorable pack from a live analysis (mirrors `web/app.js` ZIP logic) |
| `capture-once.ts` | Real full capture with current code (`npx tsx scripts/eval/capture-once.ts <url>`) |
| `regen-docs.mjs` | Regenerate a pack's docs from its `response.json` (no re-capture) |

Retired one-off probes (pixel measuring, asset injection, consistency checks)
live in gitignored `.archive/scripts-eval-probes/` with an index README.
