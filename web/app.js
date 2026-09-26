import { buildDocumentationFiles, validateDocumentationPackage } from "./package-docs.mjs";

const META_API_BASE =
  document.querySelector('meta[name="api-base"]')?.getAttribute("content") ?? "";
// Local dev serves this same UI from the API server itself, so same-origin
// must win there: the meta tag points at production, and `??` does not fall
// through on a non-empty string. Without this, a localhost run silently posts
// to the hosted Worker and returns a metadata-only ZIP (Trap 4) with no
// inline screenshots, even though the local encoder supports them.
const API_BASE =
  window.SITE_STRIPPER_API_BASE ??
  (location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? ""
    : META_API_BASE);

const form = document.getElementById("analyze-form");
const submit = document.getElementById("submit");
const statusPanel = document.getElementById("status");
const statusText = document.getElementById("status-text");
const progressWrap = document.getElementById("progress-wrap");
const progressFill = document.getElementById("progress-fill");
const progressMeta = document.getElementById("progress-meta");
const selectionPanel = document.getElementById("selection-summary");
const selectionStats = document.getElementById("selection-stats");
const candidateList = document.getElementById("candidate-list");
const screenshotPanel = document.getElementById("screenshot-preview");
const screenshotContainer = document.getElementById("screenshot-container");
const pagesPanel = document.getElementById("pages-panel");
const pagesList = document.getElementById("pages-list");
const budgetPanel = document.getElementById("budget");
const budgetFill = document.getElementById("budget-fill");
const budgetText = document.getElementById("budget-text");
const downloadPanel = document.getElementById("download-panel");
const downloadButton = document.getElementById("download");
const packageInfo = document.getElementById("package-info");
const resultPanel = document.getElementById("result");
const resultBody = document.getElementById("result-body");

let lastAnalyzedPages = [];
let lastAnalysis = null;

function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function shotSlug(path) {
  const clean = String(path || "/").replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9/_-]+/g, "-").replace(/\/+/g, "-").toLowerCase();
  return clean || "home";
}

function shotExt(kind) {
  return kind === "jpeg" ? "jpg" : kind || "webp";
}

// The ZIP is assembled in the browser (no Worker encoding). Screenshot
// binaries ride along from the response's inline dataUrls, so a local run
// yields the full PRD package (screenshots/desktop|mobile|sections).
function collectScreenshotFiles(pages) {
  const files = {};
  let added = 0;
  for (const page of pages || []) {
    const slug = shotSlug(page?.path);
    const desktop = page?.screenshot;
    if (desktop?.dataUrl) {
      const bytes = dataUrlToBytes(desktop.dataUrl);
      if (bytes) {
        files[`screenshots/desktop/${slug}.${shotExt(desktop.kind)}`] = bytes;
        added += 1;
      }
    }
    const mobile = page?.mobileScreenshot;
    if (mobile?.dataUrl) {
      const bytes = dataUrlToBytes(mobile.dataUrl);
      if (bytes) {
        files[`screenshots/mobile/${slug}.${shotExt(mobile.kind)}`] = bytes;
        added += 1;
      }
    }
    (page?.sectionShots || []).forEach((shot, index) => {
      if (!shot?.dataUrl) return;
      const bytes = dataUrlToBytes(shot.dataUrl);
      if (bytes) {
        files[`screenshots/sections/${slug}-${index + 1}.${shotExt(shot.kind)}`] = bytes;
        added += 1;
      }
    });
  }
  return { files, added };
}

function setStatus(message, variant = "info") {
  statusPanel.hidden = false;
  statusText.textContent = message;
  statusPanel.classList.toggle("status--error", variant === "error");
}

let progressTimer = null;
let progressValue = 0;

function setProgress(current, total, message) {
  statusPanel.hidden = false;
  progressWrap.hidden = false;
  progressWrap.classList.remove("progress-wrap--indeterminate");
  if (total > 0) {
    const pct = Math.min(Math.max((current / total) * 100, 2), 100);
    progressValue = Math.max(progressValue, pct);
    progressFill.style.width = `${progressValue}%`;
    progressMeta.textContent = `${message} (${current}/${total})`;
  } else {
    progressWrap.classList.add("progress-wrap--indeterminate");
    progressMeta.textContent = message;
  }
}

// Elapsed-time heartbeat: between server events the bar creeps forward and the
// timer shows, so a long page never looks frozen.
function startProgressHeartbeat(label) {
  stopProgressHeartbeat();
  const startedAt = Date.now();
  progressWrap.hidden = false;
  progressWrap.classList.add("progress-wrap--indeterminate");
  progressValue = Math.max(progressValue, 4);
  progressFill.style.width = `${progressValue}%`;
  progressTimer = setInterval(() => {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    progressValue = Math.min(progressValue + 0.6, 96);
    progressFill.style.width = `${progressValue}%`;
    progressMeta.textContent = `${label} — ${seconds}s elapsed`;
  }, 1000);
}

function stopProgressHeartbeat() {
  if (progressTimer !== null) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

function resetProgress() {
  stopProgressHeartbeat();
  progressValue = 0;
  progressWrap.hidden = true;
  progressWrap.classList.remove("progress-wrap--indeterminate");
  progressFill.style.width = "0%";
  progressMeta.textContent = "";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function renderSelection(selection, discovery) {
  if (!selection || !Array.isArray(selection.candidates)) {
    selectionPanel.hidden = true;
    return;
  }

  const { pagesDiscovered = 0, pagesSelected = 0, maxPages = 10, candidates = [] } = selection;
  const sitemaps = discovery?.sitemapsChecked?.length ?? 0;
  const robots = discovery?.robotsFound ? "Found" : "Missing / Default";

  selectionStats.innerHTML = `
    <span>Discovered: <strong>${pagesDiscovered}</strong></span>
    <span>Selected: <strong>${pagesSelected}</strong> / ${maxPages}</span>
    <span>Robots.txt: <strong>${robots}</strong></span>
    <span>Sitemaps checked: <strong>${sitemaps}</strong></span>
  `;

  candidateList.innerHTML = candidates
    .map((candidate) => {
      const isSelected = candidate.status === "selected" || candidate.selected;
      const statusBadge = isSelected
        ? `<span class="badge badge--selected">Priority ${candidate.priority ?? 1}</span>`
        : `<span class="badge badge--excluded">Excluded</span>`;

      const sourceBadges = (candidate.sources || [])
        .map((src) => `<span class="badge badge--source">${escapeHtml(src)}</span>`)
        .join(" ");

      const reason = escapeHtml(candidate.reason || candidate.selectedBecause || candidate.excludedReason || "");

      return `
        <div class="candidate-item ${isSelected ? "candidate-item--selected" : ""}">
          <div class="candidate-header">
            <span class="candidate-title">
              ${statusBadge}
              ${escapeHtml(candidate.label || candidate.path)}
              <span class="candidate-path">${escapeHtml(candidate.path)}</span>
            </span>
            <div class="candidate-badges">
              ${sourceBadges}
              <span class="badge badge--source">Score ${candidate.score ?? 0}</span>
            </div>
          </div>
          <div class="candidate-reason">${reason}</div>
        </div>
      `;
    })
    .join("");

  selectionPanel.hidden = false;
}

function renderScreenshot(pages) {
  const withShots = (pages || []).filter((p) => p?.screenshot?.dataUrl || p?.screenshot);
  const sectionShots = (pages?.[0]?.sectionShots || []).filter((s) => s?.dataUrl);
  if (withShots.length === 0 && sectionShots.length === 0) {
    screenshotPanel.hidden = true;
    return;
  }
  const pageFigures = withShots
    .slice(0, 10)
    .map((page) => {
      if (page?.screenshot?.dataUrl) {
        return `<figure><img src="${page.screenshot.dataUrl}" alt="Screenshot of ${escapeHtml(page.path)}" loading="lazy" /><figcaption>${escapeHtml(page.path)}</figcaption></figure>`;
      }
      const meta = page?.screenshot;
      return `<figure class="shot-meta"><figcaption>${escapeHtml(page.path)} — ${escapeHtml(meta?.kind ?? "no")} screenshot, ${meta?.bytes ?? 0} bytes</figcaption></figure>`;
    })
    .join("");
  const sectionFigures = sectionShots
    .map((shot, index) => `<figure><img src="${shot.dataUrl}" alt="Section ${index + 1}" loading="lazy" /><figcaption>Section: ${escapeHtml(shot.heading || `part ${index + 1}`)}</figcaption></figure>`)
    .join("");
  screenshotContainer.innerHTML =
    pageFigures +
    (sectionFigures ? `<h3>Homepage sections</h3><div class="section-shots">${sectionFigures}</div>` : "");
  screenshotPanel.hidden = false;
}

const DAILY_BROWSER_SECONDS = 600;

function renderBudget(body) {
  const used = Number(body?.browserSecondsUsed ?? 0);
  const pages = Number(body?.pagesAnalyzed ?? 0);
  const avg = pages > 0 ? used / pages : 10;
  const remaining = Math.max(DAILY_BROWSER_SECONDS - used, 0);
  const pct = Math.min((used / DAILY_BROWSER_SECONDS) * 100, 100);
  budgetFill.style.width = `${pct}%`;
  budgetFill.classList.toggle("budget-fill--hot", pct > 80);
  budgetText.textContent = `This analysis used ~${used}s browser time (~${avg.toFixed(1)}s/page). Roughly ${Math.floor(remaining / Math.max(avg, 1))} similar analyses remain in today's 600s shared budget.`;
  budgetPanel.hidden = false;
}

function renderPages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    pagesPanel.hidden = true;
    return;
  }
  pagesList.innerHTML = pages
    .map((page) => {
      const colors = (page?.tokens?.colors || []).slice(0, 5).map((t) => escapeHtml(t.value)).join(", ");
      const reason = escapeHtml(page?.selectedBecause || "");
      const tone = page?.content?.tone;
      const assets = page?.assets?.length ?? 0;
      const limits = (page?.limitations || page?.styleLimitations || []).map((l) => `<li>${escapeHtml(l)}</li>`).join("");
      return `
        <div class="page-card">
          <div class="page-head"><strong>${escapeHtml(page?.title || page?.path)}</strong><span class="candidate-path">${escapeHtml(page?.path)}</span></div>
          <div class="page-reason">Priority ${page?.priority ?? "-"} — ${reason}</div>
          <div class="page-meta">Tokens: ${colors || "none"} · Tone: ${escapeHtml(tone?.voice ?? "unknown")} · Assets: ${assets}</div>
          ${limits ? `<ul class="page-limits">${limits}</ul>` : ""}
        </div>`;
    })
    .join("");
  pagesPanel.hidden = false;
}

function renderPackage(body) {
  lastAnalysis = body;
  lastAnalyzedPages = body?.pages ?? [];
  if (!Array.isArray(lastAnalyzedPages) || lastAnalyzedPages.length === 0) {
    downloadPanel.hidden = true;
    return;
  }
  const shotCount = (body?.pages || []).reduce((total, page) => {
    return total
      + (page?.screenshot?.dataUrl ? 1 : 0)
      + (page?.mobileScreenshot?.dataUrl ? 1 : 0)
      + (page?.sectionShots || []).filter((shot) => shot?.dataUrl).length;
  }, 0);
  const screenshotCaptures = (body?.pages || []).reduce((total, page) => total
    + Number(Boolean(page?.screenshot))
    + Number(Boolean(page?.mobileScreenshot))
    + (page?.sectionShots || []).length, 0);
  packageInfo.textContent = `${lastAnalyzedPages.length} page observations; ${screenshotCaptures} screenshot captures (${shotCount} binaries available). Documentation rendering and ZIP assembly run in your browser; no Cloudflare compute is used.`;
  downloadPanel.hidden = false;
}

downloadButton?.addEventListener("click", () => {
  if (!lastAnalysis || typeof window.buildZip !== "function") {
    setStatus("Package not ready yet.", "error");
    return;
  }
  setStatus("Assembling ZIP in your browser…");
  try {
    const shots = collectScreenshotFiles(lastAnalyzedPages);
    const documentation = buildDocumentationFiles(lastAnalysis, shots.files);
    const validationIssues = validateDocumentationPackage(documentation.files, shots.files);
    if (validationIssues.length > 0) {
      setStatus(`Package validation failed: ${validationIssues.join("; ")}`, "error");
      return;
    }
    const merged = Object.assign({}, documentation.files, shots.files);
    const result = window.buildZip(merged);
    if (!result.bytes) {
      setStatus((result.warnings || []).join("; ") || "ZIP assembly failed.", "error");
      return;
    }
    const note = shots.added > 0 ? ` with ${shots.added} screenshots` : " (no inline screenshots to include)";
    if (result.warnings.length > 0) setStatus(`ZIP ready${note} with warnings: ${result.warnings.join("; ")}`);
    else setStatus(`ZIP ready${note} (${result.fileCount} files, ${documentation.byteLength.toLocaleString()} documentation bytes).`);
    window.downloadZip(result.bytes, "website-analysis.zip");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "ZIP assembly failed.", "error");
  }
});

function renderResult(body) {
  const browserSec = body?.browserSecondsUsed ?? 0;
  setStatus(`Analysis complete (${browserSec}s browser time used).`);

  renderSelection(body?.selection, body?.discovery);
  renderScreenshot(body?.pages);
  renderPages(body?.pages);
  renderBudget(body);
  renderPackage(body);

  resultPanel.hidden = false;
  resultBody.textContent = JSON.stringify(body, null, 2);
}

// Reads an NDJSON progress feed: `{type:"progress"}` lines update the bar
// live, the `{type:"result"}` line carries the final payload.
async function consumeStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;
  let failure = null;
  const pages = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (event.type === "progress") {
        setProgress(event.current ?? 0, event.total ?? 0, event.message ?? "Working…");
        // Re-arm the elapsed heartbeat so the bar keeps moving between events.
        const label = event.message ?? "Working";
        stopProgressHeartbeat();
        const startedAt = Date.now();
        progressTimer = setInterval(() => {
          const seconds = Math.round((Date.now() - startedAt) / 1000);
          progressValue = Math.min(progressValue + 0.6, 96);
          progressFill.style.width = `${progressValue}%`;
          progressMeta.textContent = `${label} — ${seconds}s elapsed`;
        }, 1000);
        statusText.textContent = event.message ?? "Working…";
      } else if (event.type === "result") {
        result = event.result;
      } else if (event.type === "page") {
        if (event.page && typeof event.page.path === "string") pages.push(event.page);
      } else if (event.type === "error") {
        failure = event.error?.message ?? "Analysis failed.";
      }
    }
  }

  if (failure) throw new Error(failure);
  if (!result) throw new Error("The analysis stream ended without a result.");
  return { ...result, pages };
}

async function onSubmit(event) {
  event.preventDefault();
  const data = new FormData(form);

  const rawMaxPages = Number(data.get("maxPages") ?? 10);
  const payload = {
    url: String(data.get("url") ?? "").trim(),
    maxPages: Math.min(Math.max(Number.isFinite(rawMaxPages) ? Math.floor(rawMaxPages) : 10, 1), 10),
    includeMobile: data.get("includeMobile") !== null,
  };

  submit.disabled = true;
  resultPanel.hidden = true;
  selectionPanel.hidden = true;
  screenshotPanel.hidden = true;
  pagesPanel.hidden = true;
  budgetPanel.hidden = true;
  downloadPanel.hidden = true;
  lastAnalyzedPages = [];
  lastAnalysis = null;
  resetProgress();
  setStatus("Validating target, resolving DNS, and opening browser session…");
  startProgressHeartbeat("Starting");

  try {
    const response = await fetch(`${API_BASE}/api/analyze`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/x-ndjson",
      },
      body: JSON.stringify(payload),
    });

    const contentType = response.headers.get("content-type") ?? "";
    let body;

    if (response.ok && contentType.includes("ndjson") && response.body) {
      body = await consumeStream(response);
    } else {
      body = await response.json();
      if (!response.ok) {
        stopProgressHeartbeat();
        setStatus(body?.error?.message ?? `Request failed (${response.status}).`, "error");
        return;
      }
    }

    stopProgressHeartbeat();
    progressWrap.hidden = true;
    renderResult(body);
  } catch (error) {
    stopProgressHeartbeat();
    progressWrap.hidden = true;
    setStatus(error instanceof Error ? error.message : "Network error.", "error");
  } finally {
    submit.disabled = false;
  }
}

form.addEventListener("submit", onSubmit);

// --- Task 3: entrance motion (GSAP, reduced-motion + no-CDN safe) ---
// Appended block only: API_BASE / fetch / NDJSON / ZIP paths above are untouched.
// Pre-animation hidden states live in styles.css under `.js-motion` ONLY, and
// this class is added here only when GSAP is present AND the user has no
// reduced-motion preference — so CDN-blocked / no-JS / reduced-motion stays
// fully visible with zero console errors.
(function initMotion() {
  try {
    if (!window.gsap) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    document.documentElement.classList.add("js-motion");
    window.gsap.fromTo(
      ".hero > *",
      { y: 28, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.9, stagger: 0.09, ease: "power3.out", overwrite: true },
    );
  } catch {
    // Motion is decorative: never break analysis on animation failure.
  }
})();
