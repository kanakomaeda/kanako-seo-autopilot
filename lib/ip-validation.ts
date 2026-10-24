import { isIP } from "node:net";

function parseIPv6(ip: string): bigint | null {
  let value = ip.toLowerCase().split("%")[0];
  if (isIP(value) !== 6) return null;

  // Convert an embedded dotted-decimal tail into two hexadecimal groups first.
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = value.slice(lastColon + 1).split(".").map(Number);
    if (ipv4.length !== 4 || ipv4.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const high = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const low = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    value = value.slice(0, lastColon + 1) + high + ":" + low;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((acc, group) => (acc << 16n) | BigInt(parseInt(group, 16)), 0n);
}

function hasPrefix(address: bigint, prefix: bigint, bits: number): boolean {
  return (address >> BigInt(128 - bits)) === (prefix >> BigInt(128 - bits));
}

export function isPrivateIPv6(ip: string): boolean {
  const parsed = parseIPv6(ip);
  // Invalid input is never considered safe.
  if (parsed === null) return true;

  // IPv4-mapped IPv6: ::ffff:0:0/96. Classify the embedded IPv4 address
  // using the same denylist as ordinary IPv4 URLs.
  if (parsed >> 32n === 0xffffn) {
    const v4 = Number(parsed & 0xffffffffn);
    return isPrivateIPv4Number(v4);
  }

  // Only accept globally allocated unicast space (2000::/3). This blocks
  // unspecified, loopback, unique-local, link-local, multicast, and other
  // non-global/reserved ranges by default.
  if (!hasPrefix(parsed, 0x20000000000000000000000000000000n, 3)) return true;

  // Explicitly block special-purpose/documentation and transition ranges.
  return hasPrefix(parsed, 0x20010db8000000000000000000000000n, 32) ||
    hasPrefix(parsed, 0x20010000000000000000000000000000n, 23) ||
    hasPrefix(parsed, 0x20020000000000000000000000000000n, 16);
}

function isPrivateIPv4Number(ip: number): boolean {
  const a = (ip >>> 24) & 255;
  const b = (ip >>> 16) & 255;
  const c = (ip >>> 8) & 255;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return isPrivateIPv4Number(parts.reduce((acc, part) => (acc * 256 + part) >>> 0, 0));
}
