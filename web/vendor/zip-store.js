// Vendored from worker/src/package/zip-store.ts — keep in sync.
// STORE-only ZIP writer (no deflate). Global: createStoreZip(files) -> { bytes, warnings, fileCount, totalBytes }.
(function (global) {
  "use strict";
  var ZIP_WARN_BYTES = 25 * 1024 * 1024;

  function crcTable() {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  }
  var TABLE = crcTable();

  function crc32(data) {
    var crc = 0xffffffff;
    for (var i = 0; i < data.length; i++) crc = TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function sanitize(name) {
    return String(name)
      .replace(/\\/g, "/")
      .split("/")
      .map(function (p) { return p === ".." || p === "." || p === "" ? "_" : p; })
      .join("/")
      .replace(/^\/+/, "")
      .slice(0, 200);
  }

  function createStoreZip(files) {
    var warnings = [];
    var encoder = new TextEncoder();
    var entries = [];
    for (var rawName of Object.keys(files)) {
      var name = sanitize(rawName);
      if (!name || name === "_") continue;
      var content = files[rawName];
      var data = typeof content === "string" ? encoder.encode(content) : content;
      entries.push({ name: encoder.encode(name), data: data, crc: crc32(data) });
    }
    var total = 22;
    for (var e of entries) total += 30 + e.name.length + e.data.length + 46 + e.name.length;
    if (total > ZIP_WARN_BYTES) {
      warnings.push("ZIP size " + total + " bytes exceeds the " + ZIP_WARN_BYTES + " byte warn cap; download may be heavy.");
    }
    var out = new Uint8Array(total);
    var view = new DataView(out.buffer);
    var off = 0;
    var centralOffsets = [];
    function u16(o, v) { view.setUint16(o, v, true); }
    function u32(o, v) { view.setUint32(o, v >>> 0, true); }
    for (var entry of entries) {
      centralOffsets.push(off);
      u32(off, 0x04034b50); u16(off + 4, 20); u16(off + 6, 0x0800); u16(off + 8, 0);
      u16(off + 10, 0); u16(off + 12, 0); u32(off + 14, entry.crc);
      u32(off + 18, entry.data.length); u32(off + 22, entry.data.length);
      u16(off + 26, entry.name.length); u16(off + 28, 0);
      off += 30;
      out.set(entry.name, off); off += entry.name.length;
      out.set(entry.data, off); off += entry.data.length;
    }
    var centralStart = off;
    for (var i = 0; i < entries.length; i++) {
      var en = entries[i];
      // NOTE: central-directory offsets differ from local headers (crc at +16).
      u32(off, 0x02014b50); u16(off + 4, 20); u16(off + 6, 20);
      u16(off + 8, 0x0800); u16(off + 10, 0); u16(off + 12, 0); u16(off + 14, 0);
      u32(off + 16, en.crc); u32(off + 20, en.data.length); u32(off + 24, en.data.length);
      u16(off + 28, en.name.length); u16(off + 30, 0); u16(off + 32, 0);
      u16(off + 34, 0); u16(off + 36, 0); u32(off + 38, 0); u32(off + 42, centralOffsets[i]);
      off += 46;
      out.set(en.name, off); off += en.name.length;
    }
    var centralSize = off - centralStart;
    u32(off, 0x06054b50); u16(off + 4, 0); u16(off + 6, 0);
    u16(off + 8, entries.length); u16(off + 10, entries.length);
    u32(off + 12, centralSize); u32(off + 16, centralStart); u16(off + 20, 0);
    return { bytes: out, warnings: warnings, fileCount: entries.length, totalBytes: total };
  }

  global.createStoreZip = createStoreZip;
})(typeof window !== "undefined" ? window : globalThis);
