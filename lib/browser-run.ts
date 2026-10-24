import { isIP } from "node:net";
import { isBlockedHostname, parsePublicHttpUrl } from "./url-security";

const MAX_RENDERED_HTML_BYTES = 1_000_000;
const BROWSER_RUN_TIMEOUT_MS = 6_000;

function parseAllowedHosts(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase().replace(/\.$/, ""))
      .filter((host) => {
        if (!host || host.includes("/") || host.includes(":") || isIP(host)) return false;
        if (isBlockedHostname(host)) return false;
        return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) && !host.includes("..");
      }),
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Browser Run is deliberately opt-in and restricted to exact hostnames controlled
 * by the operator. It is not enabled merely because API credentials exist.
 *
 * Cloudflare resolves the destination independently from this app, so local DNS
 * pinning alone cannot protect the remote browser from DNS rebinding. Keep this
 * feature disabled unless the hostname is explicitly trusted in the server-side
 * CLOUDFLARE_BROWSER_RUN_ALLOWED_HOSTS allowlist. Browser requests are limited to
 * those exact hosts to prevent redirects and third-party subresource requests
 * from expanding the remote browser's network reach.
 */
export async function fetchBrowserRunHtml(rawUrl: string): Promise<string | null> {
  if (process.env.CLOUDFLARE_BROWSER_RUN_ENABLED !== "true") return null;

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) {
    throw new Error("Browser Run is enabled but its server credentials are missing.");
  }

  const url = parsePublicHttpUrl(rawUrl);
  const allowedHosts = parseAllowedHosts(process.env.CLOUDFLARE_BROWSER_RUN_ALLOWED_HOSTS);
  if (!allowedHosts.has(url.hostname.toLowerCase().replace(/\.$/, ""))) return null;

  const allowedPatterns = [...allowedHosts].map(
    (host) => `/^https?:\\/\\/${escapeRegex(host)}(?::\\d+)?(?:\\/|$)/i`,
  );
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-run/content`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        Accept: "text/html,application/xhtml+xml,application/json",
      },
      body: JSON.stringify({
        url: url.toString(),
        gotoOptions: { waitUntil: "networkidle2", timeout: 5_000 },
        rejectResourceTypes: ["image", "media", "font"],
        allowRequestPattern: allowedPatterns,
        cacheTTL: 0,
      }),
      signal: AbortSignal.timeout(BROWSER_RUN_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new Error("Browser Run could not render this page within the time limit.");
  }

  if (!response.ok) {
    // Avoid returning upstream details, which may contain request metadata.
    throw new Error(`Browser Run could not render this page (HTTP ${response.status}).`);
  }

  const html = await response.text();
  if (!html.trim()) throw new Error("Browser Run returned an empty page.");
  if (Buffer.byteLength(html, "utf8") > MAX_RENDERED_HTML_BYTES) {
    throw new Error("The rendered page is too large to audit (maximum 1 MB).");
  }
  if (html.trimStart().startsWith("{")) {
    try {
      const data = JSON.parse(html) as { success?: boolean; errors?: unknown[] };
      if (data.success === false || data.errors?.length) {
        throw new Error("Browser Run returned an unsuccessful rendering response.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("unsuccessful rendering")) throw error;
      // A valid HTML page may start with a JSON-like text node; continue to normal HTML validation.
    }
  }
  if (!/<(?:!doctype\s+html|html|head|body)\b/i.test(html)) {
    throw new Error("Browser Run did not return a valid HTML document.");
  }
  return html;
}
