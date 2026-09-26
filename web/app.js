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

// Fix 4 — environment pill derived from the same API_BASE value at runtime.
(function initEnvPill() {
  const pill = document.getElementById("env-pill");
  if (!pill) return;
  const isLocal = API_BASE === "";
  pill.hidden = false;
  pill.innerHTML = isLocal
    ? "<strong>Localhost</strong>: screenshots included via local Chrome/Edge capture"
    : "<strong>Cloudflare</strong>: metadata-only, screenshots excluded by design";
})();

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

// --- Task 4: analysis theater (phase timeline, keyword-mapped) ---
// Five UI phases mapped by keyword over EXISTING progress messages only.
// Unknown messages keep the nearest (current) phase lit.
const PHASE_IDS = ["phase-validate", "phase-capture", "phase-discover", "phase-document", "phase-package"];
let activePhaseIndex = -1;

function phaseIndexForMessage(message) {
  const text = String(message ?? "").toLowerCase();
  if (/validat|dns|resolv|opening browser|^starting/.test(text)) return 0;
  if (/robot|sitemap|discover|select/.test(text)) return 2;
  if (/analyz|compar/.test(text)) return 3;
  if (/captur|homepage|mobile|viewport/.test(text)) return 1;
  if (/document|token|content|structure/.test(text)) return 3;
  if (/complete|packag|assembl|zip|download/.test(text)) return 4;
  return -1;
}

function paintPhases() {
  for (let i = 0; i < PHASE_IDS.length; i += 1) {
    const el = document.getElementById(PHASE_IDS[i]);
    if (!el) continue;
    el.classList.toggle("phase--done", i < activePhaseIndex);
    el.classList.toggle("phase--active", i === activePhaseIndex);
    if (i === activePhaseIndex) el.setAttribute("aria-current", "step");
    else el.removeAttribute("aria-current");
  }
}

function updatePhasesForMessage(message) {
  const mapped = phaseIndexForMessage(message);
  if (mapped === -1) return;
  // Never walk backwards: unknown/out-of-order messages keep nearest phase.
  if (mapped > activePhaseIndex) {
    activePhaseIndex = mapped;
    paintPhases();
  }
}

function resetPhases() {
  activePhaseIndex = -1;
  paintPhases();
}

function completePhases() {
  activePhaseIndex = PHASE_IDS.length - 1;
  paintPhases();
}

let progressTimer = null;
let progressValue = 0;

function setProgress(current, total, message) {
  statusPanel.hidden = false;
  updatePhasesForMessage(message);
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
  updatePhasesForMessage(label);
  const startedAt = Date.now();
  progressWrap.hidden = false;
  progressWrap.classList.add("progress-wrap--indeterminate");
  progressValue = Math.max(progressValue, 4);
  progressFill.style.width = `${progressValue}%`;
  progressTimer = setInterval(() => {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    progressValue = Math.min(progressValue + 0.6, 96);
    progressFill.style.width = `${progressValue}%`;
    progressMeta.textContent = `${label} - ${seconds}s elapsed`;
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
  resetPhases();
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

function candidateCard(candidate) {
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
}

// Fix 1 — selection sub-tabs: same data flow, only split rendering by selected flag.
let selectionTab = "selected";

function paintSelectionTabs() {
  const selectedTab = document.getElementById("selection-tab-selected");
  const excludedTab = document.getElementById("selection-tab-excluded");
  const selectedPanel = document.getElementById("candidate-list");
  const excludedPanel = document.getElementById("candidate-list-excluded");
  const isSelected = selectionTab !== "excluded";
  if (selectedTab) {
    selectedTab.setAttribute("aria-selected", String(isSelected));
    selectedTab.tabIndex = isSelected ? 0 : -1;
  }
  if (excludedTab) {
    excludedTab.setAttribute("aria-selected", String(!isSelected));
    excludedTab.tabIndex = !isSelected ? 0 : -1;
  }
  if (selectedPanel) selectedPanel.hidden = !isSelected;
  if (excludedPanel) excludedPanel.hidden = isSelected;
}

function setSelectionTab(next, focusTab = false) {
  selectionTab = next === "excluded" ? "excluded" : "selected";
  paintSelectionTabs();
  if (focusTab) {
    document.getElementById(selectionTab === "excluded" ? "selection-tab-excluded" : "selection-tab-selected")?.focus();
  }
}

document.getElementById("selection-tab-selected")?.addEventListener("click", () => setSelectionTab("selected"));
document.getElementById("selection-tab-excluded")?.addEventListener("click", () => setSelectionTab("excluded"));
for (const tabId of ["selection-tab-selected", "selection-tab-excluded"]) {
  document.getElementById(tabId)?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    setSelectionTab(tabId === "selection-tab-selected" ? "excluded" : "selected", true);
  });
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

  const selected = candidates.filter((c) => c.status === "selected" || c.selected);
  const excluded = candidates.filter((c) => !(c.status === "selected" || c.selected));
  const excludedList = document.getElementById("candidate-list-excluded");

  candidateList.innerHTML = selected.map(candidateCard).join("");
  if (excludedList) excludedList.innerHTML = excluded.map(candidateCard).join("");
  paintSelectionTabs();

  selectionPanel.hidden = false;
}

// --- Task 5: results showcase (featured + filmstrip + overlay viewer) ---
// Keeps `screenshot-container` ID. Empty state when shots.added === 0
// (no dataUrl). Overlay: arrow-key nav, Esc close, focus returns to opener.
let showcaseShots = [];
let showcaseIndex = 0;
let showcaseOpener = null;

function collectShowcaseShots(pages) {
  const shots = [];
  for (const page of pages || []) {
    const path = page?.path ?? "/";
    if (page?.screenshot?.dataUrl) {
      shots.push({ src: page.screenshot.dataUrl, label: `${path} - desktop`, tag: "desktop" });
    }
    if (page?.mobileScreenshot?.dataUrl) {
      shots.push({ src: page.mobileScreenshot.dataUrl, label: `${path} - mobile`, tag: "mobile" });
    }
    (page?.sectionShots || []).forEach((shot, index) => {
      if (!shot?.dataUrl) return;
      shots.push({
        src: shot.dataUrl,
        label: `${path} - ${shot.heading || `section ${index + 1}`}`,
        tag: "section",
      });
    });
  }
  return shots;
}

function ensureShowcaseOverlay() {
  let overlay = document.getElementById("showcase-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "showcase-overlay";
  overlay.className = "showcase-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="showcase-overlay__backdrop" data-close="true"></div>
    <div class="showcase-overlay__dialog" role="dialog" aria-modal="true" aria-label="Screenshot viewer">
      <button type="button" class="showcase-overlay__close" aria-label="Close viewer">×</button>
      <button type="button" class="showcase-overlay__prev" aria-label="Previous screenshot">‹</button>
      <figure class="showcase-overlay__figure">
        <img id="showcase-overlay-img" alt="" />
        <figcaption id="showcase-overlay-cap"></figcaption>
      </figure>
      <button type="button" class="showcase-overlay__next" aria-label="Next screenshot">›</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".showcase-overlay__close")?.addEventListener("click", closeShowcaseViewer);
  overlay.querySelector(".showcase-overlay__prev")?.addEventListener("click", () => showShowcaseIndex(showcaseIndex - 1));
  overlay.querySelector(".showcase-overlay__next")?.addEventListener("click", () => showShowcaseIndex(showcaseIndex + 1));
  overlay.querySelector(".showcase-overlay__backdrop")?.addEventListener("click", closeShowcaseViewer);
  return overlay;
}

function showShowcaseIndex(next) {
  if (showcaseShots.length === 0) return;
  showcaseIndex = (next + showcaseShots.length) % showcaseShots.length;
  const shot = showcaseShots[showcaseIndex];
  const overlay = ensureShowcaseOverlay();
  const img = overlay.querySelector("#showcase-overlay-img");
  const cap = overlay.querySelector("#showcase-overlay-cap");
  if (img) {
    img.src = shot.src;
    img.alt = shot.label;
  }
  if (cap) cap.textContent = `${shot.label} (${showcaseIndex + 1}/${showcaseShots.length})`;
}

function openShowcaseViewer(index, opener) {
  if (showcaseShots.length === 0) return;
  showcaseOpener = opener ?? document.activeElement;
  showShowcaseIndex(index);
  const overlay = ensureShowcaseOverlay();
  overlay.hidden = false;
  document.body.classList.add("showcase-open");
  overlay.querySelector(".showcase-overlay__close")?.focus();
}

function closeShowcaseViewer() {
  const overlay = document.getElementById("showcase-overlay");
  if (overlay) overlay.hidden = true;
  document.body.classList.remove("showcase-open");
  if (showcaseOpener && typeof showcaseOpener.focus === "function") {
    showcaseOpener.focus();
  }
  showcaseOpener = null;
}

document.addEventListener("keydown", (event) => {
  const overlay = document.getElementById("showcase-overlay");
  if (!overlay || overlay.hidden) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeShowcaseViewer();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    showShowcaseIndex(showcaseIndex + 1);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    showShowcaseIndex(showcaseIndex - 1);
  }
});

// Fix 2 — screenshots grid + Desktop/Mobile tabs. Same collectShowcaseShots
// data flow; only the presentation is split. Overlay viewer unchanged.
let screenshotTab = "desktop";
let lastScreenshotPages = [];

function paintScreenshotTabs() {
  const desktopTab = document.getElementById("shots-tab-desktop");
  const mobileTab = document.getElementById("shots-tab-mobile");
  const isDesktop = screenshotTab !== "mobile";
  if (desktopTab) {
    desktopTab.setAttribute("aria-selected", String(isDesktop));
    desktopTab.tabIndex = isDesktop ? 0 : -1;
  }
  if (mobileTab) {
    mobileTab.setAttribute("aria-selected", String(!isDesktop));
    mobileTab.tabIndex = !isDesktop ? 0 : -1;
  }
}

function setScreenshotTab(next, focusTab = false) {
  screenshotTab = next === "mobile" ? "mobile" : "desktop";
  renderShotGrid();
  if (focusTab) {
    document.getElementById(screenshotTab === "mobile" ? "shots-tab-mobile" : "shots-tab-desktop")?.focus();
  }
}

document.getElementById("shots-tab-desktop")?.addEventListener("click", () => setScreenshotTab("desktop"));
document.getElementById("shots-tab-mobile")?.addEventListener("click", () => setScreenshotTab("mobile"));
for (const tabId of ["shots-tab-desktop", "shots-tab-mobile"]) {
  document.getElementById(tabId)?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    setScreenshotTab(tabId === "shots-tab-desktop" ? "mobile" : "desktop", true);
  });
}

function shotEmptyState(device) {
  const isMobile = device === "mobile";
  const title = isMobile ? "No mobile screenshots in this pack" : "No desktop screenshots in this pack";
  const body = isMobile
    ? "This run has no mobile captures: enable mobile screenshots or run locally where Chrome/Edge capture is available."
    : "This run returned metadata only: the host cannot capture pixels, so there is nothing to preview. Download the ZIP for tokens, content, and structure.";
  return `
    <div class="showcase-empty">
      <div class="showcase-empty__art" aria-hidden="true">◌</div>
      <p class="showcase-empty__title">${title}</p>
      <p class="showcase-empty__body">${body}</p>
    </div>`;
}

function renderShotGrid() {
  if (!screenshotContainer) return;
  const allShots = collectShowcaseShots(lastScreenshotPages);
  const isMobile = screenshotTab === "mobile";
  // Section shots ride with Desktop so no capture is lost by filtering.
  const shots = isMobile
    ? allShots.filter((shot) => shot.tag === "mobile")
    : allShots.filter((shot) => shot.tag !== "mobile");
  showcaseShots = shots;
  paintScreenshotTabs();
  if (shots.length === 0) {
    screenshotContainer.innerHTML = shotEmptyState(screenshotTab);
    return;
  }
  screenshotContainer.innerHTML = `
    <div class="shot-grid">
      ${shots
        .map((shot, index) => {
          const featured = index === 0 ? `<span class="showcase__badge">Featured</span>` : "";
          return `<figure class="shot-card${isMobile ? " shot-card--mobile" : ""}">
            <button type="button" class="shot-card__open" data-index="${index}" aria-label="Open ${escapeHtml(shot.label)}">
              <img src="${shot.src}" alt="${escapeHtml(shot.label)}" loading="lazy" />
            </button>
            <figcaption>${featured}<span class="shot-card__tag">${escapeHtml(shot.tag)}</span> ${escapeHtml(shot.label)}</figcaption>
          </figure>`;
        })
        .join("")}
    </div>`;
  screenshotContainer.querySelectorAll("[data-index]").forEach((btn) => {
    btn.addEventListener("click", () => openShowcaseViewer(Number(btn.getAttribute("data-index") || 0), btn));
  });
}

function renderScreenshot(pages) {
  lastScreenshotPages = Array.isArray(pages) ? pages : [];
  renderShotGrid();
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

function coveragePct(entry) {
  if (!entry || typeof entry !== "object") return null;
  const emitted = Number(entry.emittedCount ?? 0);
  const source = Number(entry.sourceCount ?? 0);
  if (!Number.isFinite(emitted) || !Number.isFinite(source) || source <= 0) return null;
  return Math.min(Math.max((emitted / source) * 100, 0), 100);
}

function renderPages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    pagesPanel.hidden = true;
    return;
  }
  pagesList.innerHTML = pages
    .map((page) => {
      const reason = escapeHtml(page?.selectedBecause || "");
      const tone = page?.content?.tone;
      const assets = page?.assets?.length ?? 0;
      const limits = (page?.limitations || page?.styleLimitations || []).map((l) => `<li>${escapeHtml(l)}</li>`).join("");
      const colors = (page?.tokens?.colors || []).slice(0, 6);
      const fonts = (page?.typography?.fontFamilies || []).slice(0, 3);
      const fontSizes = (page?.tokens?.fontSizes || []).slice(0, 3);
      const colorChips = colors
        .map((t) => {
          const value = String(t?.value ?? "");
          return `<span class="token-chip"><span class="color-dot" style="background:${escapeHtml(value)}"></span>${escapeHtml(value)}</span>`;
        })
        .join("");
      const fontChips = [...fonts.map((f) => String(f?.family ?? f ?? "")).filter(Boolean), ...fontSizes.map((t) => String(t?.value ?? ""))]
        .slice(0, 4)
        .map((name) => `<span class="token-chip token-chip--font">${escapeHtml(name)}</span>`)
        .join("");
      const coverage = page?.coverage && typeof page.coverage === "object" ? page.coverage : page?.content?.coverage;
      const bars = coverage && typeof coverage === "object"
        ? Object.entries(coverage)
            .slice(0, 4)
            .map(([key, entry]) => {
              const pct = coveragePct(entry);
              if (pct === null) return "";
              return `<div class="coverage"><span class="coverage__label">${escapeHtml(key)}</span><span class="coverage__track"><span class="coverage__fill" style="width:${pct.toFixed(0)}%"></span></span><span class="coverage__pct">${pct.toFixed(0)}%</span></div>`;
            })
            .join("")
        : "";
      return `
        <div class="page-card">
          <div class="page-head"><strong>${escapeHtml(page?.title || page?.path)}</strong><span class="candidate-path">${escapeHtml(page?.path)}</span></div>
          <div class="page-reason">Priority ${page?.priority ?? "-"}: ${reason}</div>
          ${(colorChips || fontChips) ? `<div class="token-chips">${colorChips}${fontChips}</div>` : ""}
          ${bars ? `<div class="coverage-list">${bars}</div>` : ""}
          <div class="page-meta">Tone: ${escapeHtml(tone?.voice ?? "unknown")} · Assets: ${assets}</div>
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
  const statsEl = document.getElementById("deliverable-stats");
  if (statsEl) {
    statsEl.innerHTML = `
      <span class="deliverable__stat"><strong>${lastAnalyzedPages.length}</strong> pages</span>
      <span class="deliverable__stat"><strong>${shotCount}</strong> binaries</span>
      <span class="deliverable__stat"><strong>${screenshotCaptures}</strong> captures</span>`;
  }
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
  completePhases();
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
        // Theater wiring only: light the matching phase; parsing unchanged.
        updatePhasesForMessage(event.message ?? "Working…");
        // Re-arm the elapsed heartbeat so the bar keeps moving between events.
        const label = event.message ?? "Working";
        stopProgressHeartbeat();
        const startedAt = Date.now();
        progressTimer = setInterval(() => {
          const seconds = Math.round((Date.now() - startedAt) / 1000);
          progressValue = Math.min(progressValue + 0.6, 96);
          progressFill.style.width = `${progressValue}%`;
          progressMeta.textContent = `${label} - ${seconds}s elapsed`;
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
// reduced-motion preference - so CDN-blocked / no-JS / reduced-motion stays
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
      { y: 12, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.6, ease: "power3.out", overwrite: true },
    );
  } catch {
    // Motion is decorative: never break analysis on animation failure.
  }
})();

