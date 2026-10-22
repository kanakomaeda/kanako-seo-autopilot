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

/**
 * Conservative IPv6 filtering for local, link-local, multicast, documentation,
 * transition, and other special-use ranges that should not be fetched by this service.
 */
export function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase().split("%")[0];
  if (s.startsWith("::ffff:")) {
    const mapped = s.slice(7);
    if (isIP(mapped) === 4) return isPrivateIPv4(mapped);
    // Hexadecimal IPv4-mapped forms are intentionally rejected rather than guessed.
    return true;
  }
  return s === "::" || s === "::1" ||
    s.startsWith("fc") || s.startsWith("fd") ||
    /^fe[89ab]/.test(s) || s.startsWith("ff") ||
    s.startsWith("2001:db8") || // documentation
    s.startsWith("2001:0:") || // Teredo transition
    s.startsWith("2001:10:") || // deprecated ORCHID
    s.startsWith("2001:20:") || // ORCHIDv2
    s.startsWith("2002:"); // 6to4 transition may encode IPv4 destinations
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
