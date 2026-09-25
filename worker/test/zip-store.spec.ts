import { describe, expect, it } from "vitest";
import { createStoreZip } from "../src/package/zip-store";

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] as number) | ((bytes[offset + 1] as number) << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] as number) |
      ((bytes[offset + 1] as number) << 8) |
      ((bytes[offset + 2] as number) << 16) |
      ((bytes[offset + 3] as number) << 24)) >>>
    0
  );
}

describe("createStoreZip (CF10)", () => {
  it("writes correct CRC32 checksums (known vector)", () => {
    // CRC32("hello") = 0x3610a686 — guards the hand-rolled table.
    const { bytes } = createStoreZip({ "a.txt": "hello" });
    expect(readU32(bytes, 14)).toBe(0x3610a686);
  });

  it("writes PK headers with a readable central directory", () => {
    const { bytes, fileCount, warnings } = createStoreZip({
      "a.txt": "hello",
      "docs/b.txt": "world".repeat(100),
    });

    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(fileCount).toBe(2);
    expect(warnings).toEqual([]);

    // EOCD is the last 22 bytes; file count lives at +8/+10.
    const eocd = bytes.length - 22;
    expect(readU32(bytes, eocd)).toBe(0x06054b50);
    expect(readU16(bytes, eocd + 8)).toBe(2);
    expect(readU16(bytes, eocd + 10)).toBe(2);

    // First local header declares STORE method + name.
    expect(readU32(bytes, 0)).toBe(0x04034b50);
    expect(readU16(bytes, 8)).toBe(0);
    const nameLen = readU16(bytes, 26);
    const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLen));
    expect(name).toBe("a.txt");
    const size = readU32(bytes, 22);
    const data = new TextDecoder().decode(bytes.slice(30 + nameLen, 30 + nameLen + size));
    expect(data).toBe("hello");
  });

  it("writes a fully parseable central directory (Explorer-compatible)", () => {
    const input: Record<string, string> = {
      "a.txt": "hello",
      "docs/b.txt": "world".repeat(100),
      "pages/home.md": "# Home",
    };
    const { bytes } = createStoreZip(input);
    const names = Object.keys(input);

    const eocd = bytes.length - 22;
    const count = readU16(bytes, eocd + 8);
    const cdSize = readU32(bytes, eocd + 12);
    const cdOff = readU32(bytes, eocd + 16);
    expect(count).toBe(names.length);
    expect(cdOff + cdSize).toBe(eocd);

    // Walk every central entry at the SPEC offsets (crc +16, sizes +20/+24,
    // name length +28, extra/comment +30/+32, local offset +42).
    let off = cdOff;
    names.forEach((expectedName, index) => {
      expect(readU32(bytes, off)).toBe(0x02014b50);
      expect(readU16(bytes, off + 10)).toBe(0); // STORE method
      const entrySize = readU32(bytes, off + 20);
      expect(entrySize).toBe(readU32(bytes, off + 24));
      const fnLen = readU16(bytes, off + 28);
      expect(readU16(bytes, off + 30)).toBe(0); // no extra field
      expect(readU16(bytes, off + 32)).toBe(0); // no comment
      const entryName = new TextDecoder().decode(bytes.slice(off + 46, off + 46 + fnLen));
      expect(entryName).toBe(expectedName);
      // The stored local-header offset must point at a real local header
      // carrying the same name.
      const localOff = readU32(bytes, off + 42);
      expect(readU32(bytes, localOff)).toBe(0x04034b50);
      const localNameLen = readU16(bytes, localOff + 26);
      const localName = new TextDecoder().decode(bytes.slice(localOff + 30, localOff + 30 + localNameLen));
      expect(localName).toBe(expectedName);
      off += 46 + fnLen;
      void index;
    });
    expect(off).toBe(eocd);
  });

  it("sanitizes traversal names and warns above the ZIP cap", () => {
    const big = "x".repeat(1024);
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i += 1) files[`f${i}.txt`] = big;
    const clean = createStoreZip({ "../evil.txt": "ok", "a.txt": "1" });
    expect(clean.fileCount).toBe(2);

    // Force the warn path with a payload above 25MB.
    const huge = createStoreZip({ "big.bin": "y".repeat(26 * 1024 * 1024) });
    expect(huge.warnings.some((w) => w.includes("ZIP size"))).toBe(true);
    expect(huge.totalBytes).toBeGreaterThan(25 * 1024 * 1024);
  });
});
