import { isIP } from "node:net";

/** Returns true for IPv4 ranges that must not be fetched by the public audit service. */
export function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113);
}

/** Expand a validated IPv6 literal to eight 16-bit words for range checks. */
function ipv6Words(ip: string): number[] | null {
  const value = ip.toLowerCase().split("%")[0];
  if (isIP(value) !== 6) return null;

  // Convert an embedded dotted IPv4 tail into its equivalent two IPv6 words.
  let normalized = value;
  const ipv4Tail = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
  if (ipv4Tail) {
    const octets = ipv4Tail[1].split(".").map(Number);
    if (octets.some(n => n < 0 || n > 255)) return null;
    const replacement = ((octets[0] << 8) | octets[1]).toString(16) + ":" +
      ((octets[2] << 8) | octets[3]).toString(16);
    normalized = normalized.slice(0, ipv4Tail.index) + (normalized[ipv4Tail.index] === ":" ? ":" : "") + replacement;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const parseHalf = (half: string) => half ? half.split(":").map(part => {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return NaN;
    return Number.parseInt(part, 16);
  }) : [];
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? "");
  if ([...left, ...right].some(n => !Number.isFinite(n))) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  return [...left, ...Array(Math.max(0, missing)).fill(0), ...right];
}

/**
 * Conservatively blocks local, documentation, transition, and special-use IPv6 ranges.
 * Checks expanded and compressed forms so alternate textual spellings cannot bypass filtering.
 */
export function isPrivateIPv6(ip: string): boolean {
  const words = ipv6Words(ip);
  if (!words) return true;

  const allZeroPrefix = words.slice(0, 5).every(word => word === 0);
  // IPv4-mapped IPv6 (::ffff:a.b.c.d), including hexadecimal and expanded forms.
  if (allZeroPrefix && words[5] === 0xffff) {
    const a = words[6] >> 8;
    const b = words[6] & 0xff;
    const c = words[7] >> 8;
    const d = words[7] & 0xff;
    return isPrivateIPv4(`${a}.${b}.${c}.${d}`);
  }

  const first = words[0];
  const second = words[1];
  return words.every(word => word === 0) ||
    (words.slice(0, 7).every(word => word === 0) && words[7] === 1) ||
    (first & 0xfe00) === 0xfc00 || // Unique-local fc00::/7
    (first & 0xffc0) === 0xfe80 || // Link-local fe80::/10
    (first & 0xff00) === 0xff00 || // Multicast ff00::/8
    (first === 0x2001 && second === 0x0db8) || // Documentation 2001:db8::/32
    (first === 0x2001 && second === 0x0000) || // Teredo 2001:0000::/32
    (first === 0x2001 && (second & 0xfff0) === 0x0010) || // ORCHID 2001:0010::/28
    (first === 0x2001 && (second & 0xfff0) === 0x0020) || // ORCHIDv2 2001:0020::/28
    first === 0x2002; // 6to4 2002::/16
}

export function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  return !normalized || normalized === "localhost" || normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") || normalized.endsWith(".internal");
}

export function parsePublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter a valid full URL, such as https://example.com.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }
  if (url.username || url.password) {
    throw new Error("URLs containing usernames or passwords are not allowed.");
  }
  if (!url.hostname || isBlockedHostname(url.hostname)) {
    throw new Error("Only publicly accessible websites are supported.");
  }
  return url;
}
