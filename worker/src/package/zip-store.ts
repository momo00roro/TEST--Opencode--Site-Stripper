import { LIMITS } from "../config/limits";

export interface StoreZipResult {
  bytes: Uint8Array;
  warnings: string[];
  fileCount: number;
  totalBytes: number;
}

function crc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crc32Table();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[((crc ^ data[i]!) & 0xff) as number]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sanitizeName(name: string): string {
  return name
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => (part === ".." || part === "." || part === "" ? "_" : part))
    .join("/")
    .replace(/^\/+/, "")
    .slice(0, 200);
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

/**
 * STORE-only ZIP writer (no deflate, no encryption, no ZIP64).
 * Source implementation mirrored by the Pages client (`web/vendor/zip-store.js`).
 * Production archive assembly runs only in the user's browser; this source
 * remains unit-tested alongside the vendored client writer.
 */
export function createStoreZip(files: Record<string, string | Uint8Array>): StoreZipResult {
  const warnings: string[] = [];
  const encoder = new TextEncoder();
  const entries: { name: Uint8Array; data: Uint8Array; crc: number }[] = [];

  for (const [rawName, content] of Object.entries(files)) {
    const name = sanitizeName(rawName);
    if (!name || name === "_") continue;
    const data = typeof content === "string" ? encoder.encode(content) : content;
    entries.push({ name: encoder.encode(name), data, crc: crc32(data) });
  }

  let totalBytes = 0;
  for (const entry of entries) totalBytes += 30 + entry.name.length + entry.data.length;
  totalBytes += entries.length * 46;
  for (const entry of entries) totalBytes += entry.name.length;
  totalBytes += 22;

  if (totalBytes > LIMITS.zipWarnBytes) {
    warnings.push(
      `ZIP size ${totalBytes} bytes exceeds the ${LIMITS.zipWarnBytes} byte warn cap; download may be heavy.`,
    );
  }

  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);
  let offset = 0;
  const centralOffsets: number[] = [];

  for (const entry of entries) {
    centralOffsets.push(offset);
    // Local file header
    writeU32(view, offset, 0x04034b50);
    writeU16(view, offset + 4, 20);
    writeU16(view, offset + 6, 0x0800);
    writeU16(view, offset + 8, 0);
    writeU16(view, offset + 10, 0);
    writeU16(view, offset + 12, 0);
    writeU32(view, offset + 14, entry.crc);
    writeU32(view, offset + 18, entry.data.length);
    writeU32(view, offset + 22, entry.data.length);
    writeU16(view, offset + 26, entry.name.length);
    writeU16(view, offset + 28, 0);
    offset += 30;
    out.set(entry.name, offset);
    offset += entry.name.length;
    out.set(entry.data, offset);
    offset += entry.data.length;
  }

  const centralStart = offset;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i] as { name: Uint8Array; data: Uint8Array; crc: number };
    // NOTE: central-directory field offsets differ from local headers:
    // crc sits at +16 here (not +18).
    writeU32(view, offset, 0x02014b50);
    writeU16(view, offset + 4, 20);
    writeU16(view, offset + 6, 20);
    writeU16(view, offset + 8, 0x0800);
    writeU16(view, offset + 10, 0);
    writeU16(view, offset + 12, 0);
    writeU16(view, offset + 14, 0);
    writeU32(view, offset + 16, entry.crc);
    writeU32(view, offset + 20, entry.data.length);
    writeU32(view, offset + 24, entry.data.length);
    writeU16(view, offset + 28, entry.name.length);
    writeU16(view, offset + 30, 0);
    writeU16(view, offset + 32, 0);
    writeU16(view, offset + 34, 0);
    writeU16(view, offset + 36, 0);
    writeU32(view, offset + 38, 0);
    writeU32(view, offset + 42, centralOffsets[i] as number);
    offset += 46;
    out.set(entry.name, offset);
    offset += entry.name.length;
  }
  const centralSize = offset - centralStart;

  writeU32(view, offset, 0x06054b50);
  writeU16(view, offset + 4, 0);
  writeU16(view, offset + 6, 0);
  writeU16(view, offset + 8, entries.length);
  writeU16(view, offset + 10, entries.length);
  writeU32(view, offset + 12, centralSize);
  writeU32(view, offset + 16, centralStart);
  writeU16(view, offset + 20, 0);

  return { bytes: out, warnings, fileCount: entries.length, totalBytes };
}
