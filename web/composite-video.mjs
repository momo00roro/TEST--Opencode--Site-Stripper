/**
 * Client-side video-still compositing (CF23).
 *
 * Bot-gated players never paint inside the captured page, so section
 * screenshots can contain blank video bands while motion-verified playing
 * frames exist as separate video shots. This module draws each placed frame
 * over its band: pure geometry (planComposites/coverRect, unit-tested) plus
 * a browser compositor that patches section dataUrls in place, so the
 * showcase AND the ZIP both ship complete sections with zero Worker CPU.
 *
 * Runs entirely in the visitor's browser. Honest by construction: only
 * motion-verified frames with measured placement boxes are drawn; anything
 * missing (binary, placement, decode, scale) is skipped and reported.
 */

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Pure: match placed video frames to the section shots containing them.
 * Covers motion-verified videoShots AND fetched-fallback videoThumbnails
 * (CF25): both carry placement boxes; plans are marked so the compositor can
 * draw from the right list and report them honestly.
 * Returns [{ sectionIndex, videoIndex, thumb, dest }] with dest in
 * section-image page pixels (x/y relative to the section origin).
 */
export function planComposites(page) {
  const plans = [];
  const sections = page?.sectionShots || [];
  const planList = (videos, thumb) => {
    (videos || []).forEach((video, videoIndex) => {
      if (!video?.dataUrl) return;
      const p = video?.placement;
      if (!p) return;
      const px = finiteNumber(p.x);
      const py = finiteNumber(p.y);
      const pw = finiteNumber(p.width);
      const ph = finiteNumber(p.height);
      if (px === null || py === null || pw === null || ph === null || pw <= 0 || ph <= 0) return;
      const center = py + ph / 2;
      sections.forEach((section, sectionIndex) => {
        if (!section?.dataUrl) return;
        const sy = finiteNumber(section?.y);
        const sh = finiteNumber(section?.height);
        if (sy === null || sh === null || sh <= 0) return;
        if (center < sy || center >= sy + sh) return;
        plans.push({ sectionIndex, videoIndex, thumb, dest: { x: px, y: py - sy, w: pw, h: ph } });
      });
    });
  };
  planList(page?.videoShots, false);
  planList(page?.videoThumbnails, true);
  return plans;
}

/**
 * Pure: cover-fit crop of a srcW×srcH frame into dst {w,h}.
 * Returns source pixels {sx,sy,sw,sh}, or null on bad geometry.
 */
export function coverRect(srcW, srcH, dst) {
  const sw = Number(srcW);
  const sh = Number(srcH);
  const dw = Number(dst?.w);
  const dh = Number(dst?.h);
  if (![sw, sh, dw, dh].every((n) => Number.isFinite(n) && n > 0)) return null;
  const scale = Math.max(dw / sw, dh / sh);
  const cw = dw / scale;
  const ch = dh / scale;
  return { sx: (sw - cw) / 2, sy: (sh - ch) / 2, sw: cw, sh: ch };
}

function dataUrlToBytes(dataUrl) {
  const text = String(dataUrl || "");
  const comma = text.indexOf(",");
  if (comma === -1) return null;
  try {
    const bin = atob(text.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function browserDeps() {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  return {
    loadImage: (dataUrl) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = dataUrl;
    }),
    createCanvas: (w, h) => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(Math.round(w), 1);
      canvas.height = Math.max(Math.round(h), 1);
      return canvas;
    },
  };
}

/**
 * Composite placed video stills into section shots, patching
 * sectionShot {dataUrl, bytes, kind, composited} in place. Idempotent per
 * analysis object (marks __composited). Never throws: failures land in
 * stats.skipped with reasons.
 */
export async function compositeSectionStills(analysis, deps) {
  const stats = { composited: 0, thumbnails: 0, skipped: [], total: Number(analysis?.__compositedTotal) || 0 };
  try {
    if (!analysis || analysis.__composited) {
      stats.cached = true;
      return stats;
    }
    const resolved = deps || browserDeps();
    if (!resolved) {
      stats.unavailable = true;
      return stats;
    }
    const pages = Array.isArray(analysis?.pages) ? analysis.pages : [];
    for (const page of pages) {
      const plans = planComposites(page);
      if (plans.length === 0) continue;
      const bySection = new Map();
      for (const plan of plans) {
        if (!bySection.has(plan.sectionIndex)) bySection.set(plan.sectionIndex, []);
        bySection.get(plan.sectionIndex).push(plan);
      }
      const pageWidth = Number(page?.viewport?.width) || 1440;
      for (const [sectionIndex, items] of bySection) {
        const section = page.sectionShots[sectionIndex];
        try {
          const base = await resolved.loadImage(section.dataUrl);
          const natW = Number(base?.width) || 0;
          const natH = Number(base?.height) || 0;
          if (!(natW > 0 && natH > 0)) {
            for (const item of items) stats.skipped.push({ section: sectionIndex, video: item.videoIndex, reason: "section-undecodable" });
            continue;
          }
          // Section pixels must match page pixels 1:1 (deviceScaleFactor 1);
          // anything else means stale/mismatched binaries — skip honestly.
          const scale = natW / pageWidth;
          if (!(scale >= 0.9 && scale <= 1.1)) {
            for (const item of items) stats.skipped.push({ section: sectionIndex, video: item.videoIndex, reason: "scale-mismatch" });
            continue;
          }
          const canvas = resolved.createCanvas(natW, natH);
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            for (const item of items) stats.skipped.push({ section: sectionIndex, video: item.videoIndex, reason: "no-2d-context" });
            continue;
          }
          ctx.drawImage(base, 0, 0);
          let drew = 0;
          for (const item of items) {
            try {
              const source = item.thumb ? page.videoThumbnails : page.videoShots;
              const video = source[item.videoIndex];
              const frame = await resolved.loadImage(video.dataUrl);
              const fw = Number(frame?.width) || 0;
              const fh = Number(frame?.height) || 0;
              if (!(fw > 0 && fh > 0)) {
                stats.skipped.push({ section: sectionIndex, video: item.videoIndex, reason: "frame-undecodable" });
                continue;
              }
              const dst = {
                x: item.dest.x * scale,
                y: item.dest.y * scale,
                w: item.dest.w * scale,
                h: item.dest.h * scale,
              };
              const crop = coverRect(fw, fh, dst);
              if (!crop) {
                stats.skipped.push({ section: sectionIndex, video: item.videoIndex, reason: "bad-geometry" });
                continue;
              }
              ctx.drawImage(frame, crop.sx, crop.sy, crop.sw, crop.sh, dst.x, dst.y, dst.w, dst.h);
              drew += 1;
              if (item.thumb) stats.thumbnails += 1;
            } catch {
              stats.skipped.push({ section: sectionIndex, video: item.videoIndex, reason: "frame-failed" });
            }
          }
          if (drew === 0) continue;
          const out = canvas.toDataURL("image/webp", 0.82);
          const bytes = dataUrlToBytes(out);
          if (!bytes) {
            for (const item of items) stats.skipped.push({ section: sectionIndex, video: item.videoIndex, reason: "encode-failed" });
            continue;
          }
          section.dataUrl = out;
          section.bytes = bytes.byteLength;
          section.kind = "webp";
          section.composited = true;
          stats.composited += 1;
        } catch {
          for (const item of items) stats.skipped.push({ section: sectionIndex, video: item.videoIndex, reason: "section-failed" });
        }
      }
    }
    analysis.__composited = true;
    analysis.__compositedTotal = stats.total + stats.composited;
    stats.total = analysis.__compositedTotal;
    return stats;
  } catch {
    return stats;
  }
}
