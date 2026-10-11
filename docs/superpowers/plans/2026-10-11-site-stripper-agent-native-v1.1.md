# Site Stripper Agent-Native v1.1 Implementation Plan

> **Execution method:** Native, inline execution in the current concept branch with `superpowers:executing-plans`. Work through the tasks in order because they share the state and MCP contracts below. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Visual DNA Studio concept with a local MCP connection that lets coding agents analyze public sites and use Site Stripper evidence directly.

**Architecture:** Extend the existing local Node server with a loopback-only Streamable HTTP MCP endpoint and an in-memory run/activity store. MCP tools reuse the existing analysis API and document generator; the app UI reports real tool activity and exposes per-agent setup, ZIP download, and prompt-copy fallback. The marketing site explains the agent workflow without adding a Site Stripper-owned model call or hosted AI provider.

**Tech Stack:** Existing TypeScript/Node local server, existing Cloudflare Worker analysis API, HTML/CSS/ES modules, the official MCP TypeScript server and Node adapter packages, Zod v4.

**Spec:** [`docs/superpowers/specs/2026-10-11-site-stripper-agent-native-concept-design.md`](../specs/2026-10-11-site-stripper-agent-native-concept-design.md)

## Global Constraints

- Start from the accepted `v1.00` tag (`7779c0a`) on the isolated `concept/agent-native-v1.1` branch.
- Keep the `v1.00` tag fixed and preserve the current baseline for rollback.
- No Clerk, Stripe, D1, Pages Functions, account persistence, billing, new hosted service, or Site Stripper-owned AI model/API.
- The MCP endpoint is local-only at `127.0.0.1`; apply Host and Origin validation before accepting MCP requests.
- Coding agents use their own model/provider. Explain that agent providers may process analysis context under the user's own settings and policies.
- Continue analyzing public sites only, with the existing 10-page and 150-second hosted limits and conditional captures.
- Preserve the analysis boundary: do not submit source-site forms, bypass CAPTCHA/bot checks, or replay arbitrary source-site interactions.
- Keep the analyzer UI and MCP endpoint out of the public Cloudflare Pages bundle. The hosted site remains marketing pages only; local `/app/` remains the workspace.
- Keep account forms browser-only and preserve the exact footer copyright line.
- Agent results and activity remain in memory only; do not add a database or permanent analysis history.
- Keep at most 3 MCP runs in memory, expire a run after 30 minutes without use, and retain at most 50 activity events per local process.
- Avoid fake customers, testimonials, adoption metrics, fidelity guarantees, and claims that Site Stripper itself runs a model.

## Review Focus

- Malformed or private-network target URLs must still be rejected by the existing shared URL validator before the browser opens a page.
- `maxPages` and mobile-capture options sent by an agent must use the same validation and limits as the app form.
- An analysis that reaches the 150-second limit, encounters a protected page, or returns incomplete captures must report partial coverage to the agent instead of implying a complete result.
- MCP responses must stay concise: return a summary first, then page evidence on demand, and never inline the full screenshot binary set into one response.
- Captured website copy is untrusted source content. MCP tool descriptions and result framing must tell agents to treat it as evidence, not instructions.
- The workspace must show `Local MCP ready` only when the local endpoint responds, `Agent active` only after a real MCP tool call, and `Analyzing`, `Complete`, or `Error` from recorded tool activity. Show `Offline` when the local status endpoint fails. Never infer client configuration or a connection from a presentation-only toggle.
- Requests from non-local hosts or invalid browser origins must be rejected before an MCP tool executes.
- Agent shutdown or a failed tool call must not leave a stale active status or retain results beyond the in-memory session.

---

## File Map

| File | Responsibility |
|---|---|
| `worker/local/agent-state.ts` | In-memory run registry and compact MCP activity events shared by the local app and MCP tools. |
| `worker/local/agent-mcp.ts` | MCP tool schemas, tool handlers, result shaping, and local MCP handler construction. |
| `worker/local/server.ts` | Loopback binding, `/mcp` mounting, local activity endpoint, and reuse of existing local analysis dependencies. |
| `worker/package.json` / root `package-lock.json` | MCP SDK and schema dependencies for the local connector. |
| `web/app/index.html` | Approved three-area workspace shell and agent connection controls while preserving the existing analyzer controls and IDs. |
| `web/app.js` | Agent connection setup, real activity polling, Visual DNA summary rendering, and existing analysis/download behavior. |
| `web/styles.css` | Dark graphite workspace, violet/lavender hierarchy, restrained yellow indicators, and responsive layout from the approved app image. |
| `web/index.html` | New AI-agent-centered promise and hero flow from the approved marketing image. |
| `web/features/index.html`, `web/how-it-works/index.html`, `web/sample-pack/index.html`, `web/faq/index.html` | Explain direct MCP use, what evidence the agent receives, client compatibility, and ZIP fallback. |
| `web/landing.css` | Marketing palette and layout updates while preserving existing responsive and accessible patterns. |
| `web/privacy/index.html`, `web/terms/index.html` | Explain the local agent handoff and third-party agent-provider handling without claiming Site Stripper runs an LLM. |
| `README.md`, `docs/01-PRD.md`, `docs/README.md` | Document the stable baseline, local MCP setup, route boundaries, data flow, and agent-mediated AI claim. |

## Task 1: Add a bounded local run store

**Files:** Create `worker/local/agent-state.ts`.

**Interfaces:**

- `AgentRunRecord` stores a run ID, creation and last-use times, normalized source URL, run status, and the validated analysis result or a short failure summary in memory.
- `AgentActivityEvent` stores an event ID, timestamp, event type, optional run ID, and short user-facing summary.
- `AgentStateStore` exposes `beginRun`, `completeRun`, `failRun`, `getRun`, `recordActivity`, `getRecentActivity`, and `getSnapshot`; it owns no disk or browser-storage writes.
- Store at most 3 runs and 50 activity events in memory. Expire idle completed/failed runs after 30 minutes, checking expiry on reads and writes; never evict an in-progress run. If all 3 slots are active, reject a new analysis with a recoverable capacity message. Process exit clears all state.

Use these method signatures so MCP handlers and the local status endpoint share one contract:

```ts
export type AgentRunId = string;
export type AgentActivityInput = Omit<AgentActivityEvent, "id" | "at">;
export type AgentRunStatus = "analyzing" | "complete" | "failed";

export interface AgentRunRecord {
  id: AgentRunId;
  createdAt: number;
  lastUsedAt: number;
  sourceUrl: string;
  status: AgentRunStatus;
  result?: AnalysisResult;
  failureSummary?: string;
}

export interface AgentActivitySnapshot {
  activeRunIds: AgentRunId[];
  lastAgentCallAt?: number;
  events: AgentActivityEvent[];
}

export interface AgentStateStore {
  beginRun(sourceUrl: string): AgentRunId;
  completeRun(runId: AgentRunId, result: AnalysisResult): void;
  failRun(runId: AgentRunId, summary: string): void;
  getRun(runId: AgentRunId): AgentRunRecord | undefined;
  recordActivity(event: AgentActivityInput): AgentActivityEvent;
  getRecentActivity(limit?: number): AgentActivityEvent[];
  getSnapshot(): AgentActivitySnapshot;
}
```

Use the existing analysis result type at the store boundary:

```ts
import type { AnalysisResult } from "../src/pipeline/analysis.js";

export interface AgentActivityEvent {
  id: string;
  at: number;
  kind: "analysis-started" | "analysis-complete" | "analysis-failed" | "evidence-read";
  runId?: string;
  summary: string;
}
```

- [x] Define the TypeScript records using the existing `AnalysisResult` type from `worker/src`.
- [x] Implement a bounded in-memory map and ordered event list; return copies so callers cannot mutate stored state accidentally.
- [x] Use constants `MAX_AGENT_RUNS = 3`, `MAX_AGENT_ACTIVITY_EVENTS = 50`, and `AGENT_RUN_IDLE_TTL_MS = 30 * 60 * 1000`; when the map is full, evict the least-recently-used completed/failed run only.
- [x] Make missing or expired run IDs return `undefined` from the store; MCP handlers convert that to a structured, recoverable tool error. Keep the store contract and MCP protocol error separate.
- [x] Update `lastUsedAt` on access. Do not expire an active analysis; expire completed/failed runs after 30 minutes idle.
- [x] Generate the run ID and record `analysis-started` before calling the analyzer so the local activity panel can show real progress. Record completion or failure with the same ID.
- [x] Keep the store instance in the local server process and inject it into the MCP handler and activity endpoint.
- [x] Run `npm run typecheck -w worker` and commit with `git commit -m "feat: add in-memory agent run state"`.

## Task 2: Implement the local MCP endpoint and tools

**Files:** Create `worker/local/agent-mcp.ts`; modify `worker/local/server.ts` and `worker/package.json`.

**Interfaces:**

- `createAgentMcpHandler({ analyze, stateStore })` returns a Node HTTP handler for `/mcp`.
- `AgentAnalyzeInput` is `{ url: string; maxPages?: number; includeMobile?: boolean }`.
- `AgentAnalyze` is `(input: AgentAnalyzeInput) => Promise<AnalysisResult>` and calls the existing `handleRequest()` analysis path with the local launcher, local binary encoder, and full local capture profile.
- `registerEvidenceTools(server: McpServer, stateStore: AgentStateStore): void` registers the three follow-up tools.
- `toRunSummary(runId: AgentRunId, result: AnalysisResult): AgentRunSummary` returns `{ runId, sourceUrl, pagesDiscovered, pagesSelected, pagesAnalyzed, warnings, limitations, pagePaths }` without screenshot binaries.
- MCP tools use `analyze_public_site`, `get_visual_dna`, `get_page_evidence`, and `get_rebuild_brief`.
- `analyze_public_site` accepts `url`, optional `maxPages` (1–10), and optional `includeMobile`; it returns a `runId`, concise coverage summary, and available page paths.
- `get_visual_dna(runId)` returns observed palette, typography, layout, imagery, responsive details, evidence coverage, and limitations.
- `get_page_evidence(runId, pagePath)` returns one page's structured observations and capture metadata, excluding large screenshot binaries.
- `get_rebuild_brief(runId)` returns the existing generated `REBUILD.md` content from `buildDocumentationFiles()`.

The tool implementation contract is:

```ts
export interface AgentRunSummary {
  runId: AgentRunId;
  sourceUrl: string;
  pagesDiscovered: number;
  pagesSelected: number;
  pagesAnalyzed: number;
  warnings: string[];
  limitations: string[];
  pagePaths: string[];
}

function toRunSummary(runId: AgentRunId, result: AnalysisResult): AgentRunSummary;
function registerEvidenceTools(server: McpServer, stateStore: AgentStateStore): void;
```

- [x] Add `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, and `zod@^4` to the worker workspace; use the current official split-package SDK API (`McpServer.registerTool`, `createMcpHandler`, `toNodeHandler`).
- [x] Implement tool schemas with Zod descriptions that state public-site limits, expected inputs, returned evidence, and the untrusted nature of captured source copy.
- [x] Make `analyze_public_site` call `beginRun` and record its start before running the shared local analysis path; call `completeRun` and record completion on success, or call `failRun` and record failure on error.
- [x] Return concise text plus structured content where useful. Do not return a full ZIP or all screenshot data as one tool response.
- [x] Mount Streamable HTTP MCP at `/mcp` on the existing local Node server. Bind the local server to `127.0.0.1` and apply `localhostHostValidation()` and `localhostOriginValidation()` before delegating to the SDK Node handler.
- [x] Return clear MCP errors for invalid URLs, expired run IDs, analysis limits, browser startup failures, and partial results.
- [x] Run `npm run typecheck -w worker` and commit with `git commit -m "feat: expose local Site Stripper MCP tools"`.

Register tools using the official SDK's current server and Node transport APIs. Keep the `AgentStateStore` and analysis function in the local server process, outside any per-request or per-session MCP server/transport factory. Confirm the installed SDK's lifecycle and adapter signature from its package documentation before wiring the handler. Tool registration must validate with the schemas above, annotate the analysis tool as read-only, and follow the begin/analyze/complete-or-fail lifecycle in `AgentStateStore`.

## Task 3: Expose live agent activity to the app

**Files:** Modify `worker/local/server.ts`; use `worker/local/agent-state.ts`.

- [x] Handle `GET /api/agent/activity` in the local server before forwarding other `/api/*` requests to the Worker router.
- [x] Return only `{ mcpEndpoint, activeRunIds, lastAgentCallAt?, events }` for the current process. Set `Cache-Control: no-store`.
- [x] Define `AgentActivityResponse extends AgentActivitySnapshot` with `mcpEndpoint: string`; return this exact shape from the app endpoint.
- [x] Treat a successful status response as “Local MCP ready”; use recent tool activity for “Agent active.” Show “Analyzing,” “Complete,” or “Error” from actual events, and show “Offline” when the request fails.
- [x] Do not expose agent credentials, raw request headers, or user account information.
- [x] Leave the hosted Worker route map unchanged; MCP and activity remain local-only.
- [x] Run `npm run typecheck -w worker` and commit with `git commit -m "feat: add local agent activity endpoint"`.

Mount `/mcp` before the existing static and Worker API branches. Use the official SDK's localhost Host and Origin validation utilities in the correct middleware/handler form supported by the pinned package versions, before dispatching MCP requests. Answer `/api/agent/activity` from the same `AgentStateStore` instance used by MCP tools and set `Cache-Control: no-store`.

## Task 4: Rebuild the local app workspace around the approved screen

**Files:** Modify `web/app/index.html`, `web/app.js`, and `web/styles.css`.

- [x] Restructure the app into a left navigation rail, source-page/evidence area, central Visual DNA profile, and right agent activity panel matching `docs/images/concepts/v1.1/agent-workspace.png`.
- [x] Preserve or deliberately update every DOM ID read by the current `web/app.js`; keep URL validation, progress, page selection, screenshot tabs, ZIP generation, raw JSON, and theme behavior working.
- [x] Add Agent connections controls with current configuration snippets for Claude Code, Codex, Cursor, OpenCode, and a generic MCP-compatible client. Use `http://127.0.0.1:<current-port>/mcp` so the setup follows the port actually serving the app.
- [x] Add copy-to-clipboard behavior with a visible fallback if clipboard access is unavailable. Show “Open in agent” only where a supported client handoff exists; otherwise use “Copy agent prompt.” Do not claim the browser can edit another application's configuration or launch every local agent.
- [x] Use the app-facing activity snapshot `{ mcpEndpoint: string; activeRunIds: string[]; lastAgentCallAt?: number; events: AgentActivityEvent[] }`. Render “Local MCP ready” when the endpoint responds and “Agent active” only after an MCP tool call; never infer agent activity from a user-selected badge. Show “Analyzing” whenever `activeRunIds` is non-empty.
- [x] Poll `/api/agent/activity` while the app is visible and render real activity events. If the endpoint fails, show a reconnect/setup state instead of a connected badge.
- [x] Add the `Visual DNA` summary after analysis, using existing observations only. Label observed versus unavailable evidence and preserve capture limitations.
- [x] Keep `Download ZIP` and `Copy agent prompt` available as fallbacks. Do not put raw passwords, account data, or credentials in agent config snippets.
- [x] Match the approved palette and screen structure; use responsive stacked panels at narrow widths and preserve keyboard focus/reduced-motion support.
- [x] Commit with `git commit -m "feat: add agent-native visual DNA workspace"`.

Keep a stable DOM boundary for the live agent panel:

```html
<section id="agent-panel" aria-labelledby="agent-panel-title">
  <h2 id="agent-panel-title">Agent activity</h2>
  <p id="agent-connection-state" role="status" aria-live="polite">Local MCP status unavailable</p>
  <ol id="agent-activity" aria-label="Agent activity"></ol>
  <button id="copy-agent-prompt" type="button">Copy agent prompt</button>
</section>
```

Poll `/api/agent/activity` same-origin while the page is visible and stop polling while hidden. Insert activity strings with `textContent`, since page titles and URLs originate from analyzed sites. The endpoint confirms that the local MCP service is reachable; only recorded MCP tool calls may change the UI to `Agent active`.

## Task 5: Update the marketing story and integration explanation

**Files:** Modify `web/index.html`, `web/features/index.html`, `web/how-it-works/index.html`, `web/sample-pack/index.html`, `web/faq/index.html`, and `web/landing.css`.

- [x] Rebuild the homepage hero from `docs/images/concepts/v1.1/marketing-home.png`: short product claim, source-to-Visual-DNA-to-agent visual, and clear Connect/Explore actions.
- [x] Add an `Agent integrations` navigation anchor to a new section on `how-it-works`; avoid creating a new route solely for this section.
- [x] Explain MCP in plain language: the coding agent can request Site Stripper analysis and focused evidence directly; Site Stripper does not supply the LLM.
- [x] Explicitly include Claude Code, Codex, OpenCode, Cursor, and “any other AI agent that supports MCP.”
- [x] Describe the ZIP and prompt as a manual handoff fallback, not as the primary agent connection.
- [x] Keep limits accurate: public sites only, up to 10 selected pages, 150 seconds hosted, and captures when available. Keep the 93.2/100 evaluation qualified as one measured setup, not a promise.
- [x] Keep the analyzer UI and local MCP endpoint out of the public Pages bundle. Do not add a public route that exposes the analyzer.
- [x] Run `npm run build:site` and commit with `git commit -m "feat: present direct AI agent integrations"`.

Use this core claim: “Site Stripper captures a website's visual DNA and connects it directly to the AI coding agent you use.” Supporting copy must say the connected agent performs model reasoning from the observed evidence; Site Stripper does not run a model itself.

## Task 6: Update privacy, terms, and project documentation

**Files:** Modify `web/privacy/index.html`, `web/terms/index.html`, `README.md`, `docs/01-PRD.md`, and `docs/README.md`.

- [x] Explain that Site Stripper calls no model API; the connected agent's provider handles model inference and may process the evidence the user gives it.
- [x] Explain that MCP is available only through the local app and that the local bridge keeps run state in memory, with no account history or database.
- [x] State that the local bridge holds at most three runs in memory and expires each run after 30 minutes without use; no result is written to disk by the bridge.
- [x] Preserve the existing legal identity/contact/jurisdiction placeholders and describe the relevant agent data flow accurately.
- [x] Document MCP endpoint setup, supported client config links, tool names, route boundaries, local-only availability, and the `v1.00` rollback tag.
- [x] Update the docs index to link this implementation plan when the plan is approved and execution begins.
- [x] Run `git diff --check` and commit with `git commit -m "docs: describe the local agent workflow"`.

## Task 7: Build and review the concept branch

**Files:** No new source files beyond those listed above.

- [x] Run `npm run typecheck -w worker` and resolve type errors.
- [x] Run `npm run build:site` and confirm the Pages bundle still excludes `web/app/`, MCP server code, and local activity endpoints.
- [x] Review the local app at `/app/` on the configured local port (default `8787`; `start-server.bat` uses `8917`) against the approved image and confirm the existing analyzer actions remain present.
- [x] Review the homepage and all linked marketing pages against the approved marketing image at desktop and mobile widths.
- [x] Inspect `git diff --check`, `git status --short --branch`, and the `v1.00` tag; do not move the tag or deploy the concept branch to production.
- [x] Keep all implementation commits on `concept/agent-native-v1.1`. Keep promotion to `master` as a separate user decision after reviewing the working result.

Use `npm run typecheck -w worker` and `npm run build:site` as the local command checks. The existing GitHub Actions workflow runs the full test suite when a change is later pushed to its configured deployment branch.

## Execution Handoff

- The user selected Native execution. Implement inline on `concept/agent-native-v1.1`, following the tasks in order and without delegating to subagents.
- Do not edit or move the `v1.00` tag. Keep this concept isolated until the user reviews the working result and separately approves promotion.
- The concept design is approved. Review this implementation plan before product-code changes begin; adjust the scope if the contract, data flow, or launch boundary is inaccurate.
