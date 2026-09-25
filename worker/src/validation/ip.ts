const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseIPv4(input: string): number[] | null {
  const match = IPV4_RE.exec(input);
  if (!match) return null;
  const parts: number[] = [];
  for (let i = 1; i <= 4; i += 1) {
    const value = Number(match[i]);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    parts.push(value);
  }
  return parts;
}

function inV4Range(parts: number[], cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const baseParts = parseIPv4(base!)!;
  const bits = Number(bitsRaw ?? 32);
  let value = 0;
  let baseValue = 0;
  for (let i = 0; i < 4; i += 1) {
    value = (value << 8) | parts[i]!;
    baseValue = (baseValue << 8) | baseParts[i]!;
  }
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((value ^ baseValue) & mask) === 0;
}

const BLOCKED_V4_RANGES = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "255.255.255.255/32",
];

export function isBlockedIPv4(parts: number[]): boolean {
  return BLOCKED_V4_RANGES.some((range) => inV4Range(parts, range));
}

export function parseIPv6(input: string): number[] | null {
  let text = input.trim().toLowerCase();
  const zoneIndex = text.indexOf("%");
  if (zoneIndex !== -1) text = text.slice(0, zoneIndex);
  if (text.length === 0 || text.includes(":::")) return null;

  const doubleColon = text.split("::");
  if (doubleColon.length > 2) return null;

  const parseGroups = (segment: string): number[] | null => {
    if (segment.length === 0) return [];
    const raw = segment.split(":");
    const groups: number[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const token = raw[i]!;
      if (token.includes(".")) {
        const v4 = parseIPv4(token);
        if (!v4 || i !== raw.length - 1) return null;
        groups.push((v4[0]! << 8) | v4[1]!);
        groups.push((v4[2]! << 8) | v4[3]!);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(token)) return null;
      groups.push(Number.parseInt(token, 16));
    }
    return groups;
  };

  if (doubleColon.length === 2) {
    const head = parseGroups(doubleColon[0]!);
    const tail = parseGroups(doubleColon[1]!);
    if (!head || !tail) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
  }

  const groups = parseGroups(text);
  if (!groups || groups.length !== 8) return null;
  return groups;
}

export function isBlockedIPv6(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  const embedded = [(g6 >> 8) & 0xff, g6 & 0xff, (g7 >> 8) & 0xff, g7 & 0xff];
  const headZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;

  if (headZero && g5 === 0xffff) {
    return isBlockedIPv4(embedded);
  }

  if (headZero && g5 === 0) {
    if (g6 === 0 && g7 === 0) return true;
    if (g6 === 0 && g7 === 1) return true;
    return isBlockedIPv4(embedded);
  }

  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isBlockedIPv4(embedded);
  }

  if ((g0 & 0xfe00) === 0xfc00) return true;
  if ((g0 & 0xffc0) === 0xfe80) return true;
  if ((g0 & 0xff00) === 0xff00) return true;
  if (g0 === 0x2001 && g1 === 0x0db8) return true;
  if (g0 === 0x2002) return true;

  return false;
}

export function ipLiteralKind(host: string): "v4" | "v6" | null {
  if (parseIPv4(host)) return "v4";
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (bare.includes(":") && parseIPv6(bare)) return "v6";
  return null;
}

export function isBlockedIpLiteral(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const v4 = parseIPv4(bare);
  if (v4) return isBlockedIPv4(v4);
  const v6 = parseIPv6(bare);
  if (v6) return isBlockedIPv6(v6);
  return false;
}
