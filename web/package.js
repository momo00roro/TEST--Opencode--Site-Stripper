// Client-side bundle assembly (CF10). Depends on ./vendor/zip-store.js (global createStoreZip).
// Worker never compresses: this runs in the user's browser, outside Cloudflare compute.
(function (global) {
  "use strict";
  var ZIP_WARN_BYTES = 25 * 1024 * 1024;

  function buildZip(packageFiles) {
    if (typeof global.createStoreZip !== "function") {
      return { bytes: null, warnings: ["ZIP writer unavailable (vendor/zip-store.js missing)."] };
    }
    var result = global.createStoreZip(packageFiles || {});
    var warnings = result.warnings.slice();
    if (result.totalBytes > ZIP_WARN_BYTES) {
      warnings.push("Package exceeds 25MB; screenshots were capped server-side.");
    }
    return { bytes: result.bytes, warnings: warnings, fileCount: result.fileCount, totalBytes: result.totalBytes };
  }

  function downloadZip(bytes, filename) {
    var blob = new Blob([bytes], { type: "application/zip" });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename || "website-analysis.zip";
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      anchor.remove();
    }, 1000);
  }

  global.buildZip = buildZip;
  global.downloadZip = downloadZip;
})(typeof window !== "undefined" ? window : globalThis);
