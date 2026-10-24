import { isPrivateIPv4, isPrivateIPv6 } from "./ip-validation";

/** Normalize and reject local-only hostnames before attempting DNS resolution. */
export function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  return !normalized ||
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal");
}

/** Parse only public-web URL forms. IP-range checks are performed by the resolver. */
export function parsePublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter a valid full URL, such as https://example.com.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
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

/** A shared helper for tests that verify an address cannot be fetched by the public audit. */
export function isBlockedIpLiteral(ip: string): boolean {
  if (ip.includes(":")) return isPrivateIPv6(ip);
  return isPrivateIPv4(ip);
}
