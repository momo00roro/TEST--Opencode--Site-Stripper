# Site Stripper — Website Analysis Pack

An AI-ready website-analysis pack generator. Point at a public URL and get screenshots, design tokens, content guidance, responsive behavior, interaction notes, Markdown documentation, and JSON data — everything an AI coding agent needs to rebuild a site at 80–90%+ fidelity.

Cloudflare Pages + Workers on the **Free tier only**. No VPS, Docker, external browser service, database, or AI API in production.

## How it works

```text
Static UI (web/) ──POST /api/analyze──▶ Worker API ──▶ Browser Rendering (Chromium)
        │                                       │  one session, sequential tabs,
        │                                       ▼  close each tab immediately
        │                          Bounded versioned observations (no docs, no ZIP)
        ▼
Browser renders Markdown/JSON/theme files, validates the package,
assembles a STORE ZIP client-side, triggers download
```

Heavy work runs inside Chromium (`page.evaluate`) or the client — never in Worker JavaScript (10 ms CPU budget). The Worker validates, sequences, and passes observations through.

## Quickstart (local)

Requires Node ≥ 20 and an installed Chrome/Edge.

```sh
npm install
npm run dev -w worker        # served UI + API on http://localhost:8787
```

Or on the standing local port with auto-restart:

```sh
./start-server.bat           # http://localhost:8917
```

Analyze a site from the form (up to 10 pages), inspect screenshots and raw JSON, then download the ZIP.

## Commands

```sh
npm run typecheck -w worker  # tsc --noEmit, must be clean
npm test -w worker           # vitest, 230 tests across 16 files
npm run dev:remote -w worker # local code vs remote Cloudflare resources (hosted verification)
npm run deploy -w worker     # deploy the Worker API (manual fallback)
npm run deploy:ui            # deploy the Pages UI (manual fallback)
```

## Deployment (GitHub Actions CI)

Pushes to `master` deploy automatically via `.github/workflows/deploy.yml`:
typecheck → test → deploy Worker API → deploy Pages UI. A red suite blocks
the deploy. Watch runs under the repo's **Actions** tab.

Live deployment (verified 2026-09-26, GMT+8):

- Front end UI: `https://site-stripper-ui.pages.dev`
- Backend API: `https://site-stripper-api.momo00roro.workers.dev`

The UI's `<meta name="api-base">` in `web/index.html` points at the Worker
URL (same-origin does not apply once UI and API live on different domains).
Per-deployment preview URLs look like `https://<hash>.site-stripper-ui.pages.dev`
(e.g. `59fbd3cb`); those are snapshots of one deploy, not production — always
verify against the canonical `site-stripper-ui.pages.dev` domain.

### Why GitHub Actions instead of Cloudflare's "Connect Git repository" button?

Both paths ship the same files. The difference is who runs the checks and how
many deployers exist:

- **GitHub Actions (what we use):** every push runs `typecheck` + the full
  230-test suite first; a red suite blocks the deploy. One deployer (repo-pinned
  Wrangler v4 on Node 22 via `npx`, in CI) pushes both the Worker and the Pages
  UI, including the `--branch master` flag so the upload promotes the
  production environment instead of a preview. Secrets live only as GitHub
  Actions secrets (`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`); values are
  never committed.
- **Cloudflare Git integration (deliberately NOT connected):** Cloudflare would
  auto-build on every push with no typecheck/test gate, using its own Wrangler
  version and Pages build settings instead of ours. Running both at once means
  two deployers race for production. That is why Settings → Build → Git
  repository is intentionally left empty (Direct Upload via CI only).

ELI10: connecting the repo in Cloudflare's dashboard is like giving the printer
its own "print every draft" button — it skips the teacher checking your homework
(typecheck + tests) and two printers fight over the same paper. GitHub Actions
is the one printer that only prints after homework passes.

### ELI10: the whole deployment, in 5 lines

1. You `git push` your homework to GitHub.
2. A robot (Actions) checks it: spelling (typecheck), then all 230 quiz answers (tests).
3. Fail = stop, nothing ships. Pass = keep going.
4. Robot mails the brain (Worker API) then the face (Pages UI) to Cloudflare's computers.
5. Your site updates at `site-stripper-ui.pages.dev`, talking to the brain at
   `site-stripper-api.momo00roro.workers.dev`.

### One-time setup (already done — recorded here, never edit secrets in code)

1. `npx wrangler login`, then `npx wrangler whoami` to confirm the account.
2. First-time Pages project: `npx wrangler pages project create site-stripper-ui --production-branch master`
   (the Worker deploys without pre-creation; CI uses repo-pinned Wrangler v4
   on Node 22 — not `cloudflare/wrangler-action`, which ships a stale v3).
3. GitHub repo → Settings → Secrets and variables → Actions — two secrets
   (names are case-sensitive; values are never committed):
   - `CLOUDFLARE_ACCOUNT_ID` — from Workers & Pages Overview in dash.cloudflare.com
   - `CLOUDFLARE_API_TOKEN` — custom token with **Account | Workers Scripts | Edit**
     and **Account | Cloudflare Pages | Edit** (minted once under My Profile → API Tokens)

### Useful terminal commands

```sh
git push origin master                    # deploy (triggers CI)
npx wrangler whoami                       # confirm Cloudflare identity
npx --prefix worker wrangler tail         # live Worker logs (repo root)
```

Monitor browser-minute usage at dash.cloudflare.com → **Compute → Browser Run**
(free quota: 10 min/day, hard stop with 429s until UTC midnight).

## Output package

```text
website-analysis/
  README.md  website-overview.md  information-architecture.md
  design-tokens.md  typography.md  content-style.md
  imagery-and-video.md  motion-and-interactions.md
  responsive-behavior.md  implementation-plan.md
  pages/*.md  screenshots/{desktop,mobile,sections}/
  data/{pages,tokens,components,navigation,interactions,assets,selection,report}.json
  theme.css  tailwind.config.js
```

`data/pages.json` is canonical. Every Markdown file is a projection of the same bounded observations — never a second source. Each value carries source/confidence (`observed` / `inferred` / `unknown`), every capped collection reports source/emitted/cap/truncation, and gaps (bot challenges, video regions, pin scenes, pruned fields) are explicit limitations, not silent omissions.

## Key limits (Free-tier driven)

| Limit | Value |
|---|---|
| Pages per analysis | 10 max (homepage + 9) |
| Per-page extraction payload | 512 KB hard / 350 KB warn |
| Screenshots | 10 desktop, 2 mobile, 6 homepage sections; 6 MB total |
| Mobile | screenshots for homepage + 1 representative page; extract-only DOM comparisons for the rest |
| Wall budget | 90 s, hard — partial reports beyond it |
| Client documentation cap | 24 MiB (explicit error, never silent truncation) |
| Browser budget | ~600 s/day shared → roughly 5–8 full analyses |

Never performed: form submits, control clicks, CAPTCHA solving, behavior replay. Bot-verification pages are recorded as evidence with remaining captures skipped.

## Docs

- `docs/01-PRD.md` — authoritative product/technical spec (read this first)
- `docs/plans/` — design and implementation plans (historical record)
- `.examples/` — real captured packages from verification runs

## Status

All CF01–CF12 implemented; `npm run typecheck` clean; 230/230 tests. Verified against 15+ live archetypes (portfolios, Shopify/WooCommerce, docs sites, CJK, RTL, single-pagers, award sites, bot walls). Hosted production verified 2026-09-26 (GMT+8): canonical UI `https://site-stripper-ui.pages.dev` serves wired `api-base`, Worker `/health` reports `schemaVersion` 0.2.0, and `https://example.com` (max pages 1) produced a downloadable ZIP (extracted to gitignored `.examples/2026-09-26__example.com/`).
