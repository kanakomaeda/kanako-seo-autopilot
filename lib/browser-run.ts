import { isIP } from "node:net";
import { isBlockedHostname, parsePublicHttpUrl } from "./url-security";

const MAX_RENDERED_HTML_BYTES = 1_000_000;
const BROWSER_RUN_TIMEOUT_MS = 40_000;

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

  // Restrict this browser session to the exact hostname being audited, even if
  // the operator has trusted additional hosts for separate audits.
  const targetHost = url.hostname.toLowerCase().replace(/\.$/, "");
  const allowedPatterns = [targetHost].map(
    // Cloudflare expects a regex literal string, with one backslash escaping each slash.
    (host) => `/^https?:${String.fromCharCode(92)}/${String.fromCharCode(92)}/${escapeRegex(host)}(?::${String.fromCharCode(92)}d+)?(?:${String.fromCharCode(92)}/|$)/`,
  );
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-rendering/content?cacheTTL=0`;

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
        // Avoid failing navigation solely because analytics or other requests keep
        // the network busy; give client-side rendering a short settle period instead.
        gotoOptions: { waitUntil: "domcontentloaded", timeout: 30_000 },
        waitForTimeout: 2_000,
        rejectResourceTypes: ["image", "media", "font"],
        allowRequestPattern: allowedPatterns,
      }),
      signal: AbortSignal.timeout(BROWSER_RUN_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new Error("Browser Run could not render this page within the time limit.");
  }

  const responseText = await response.text();
  if (!response.ok) {
    // Surface a short, sanitized upstream error without exposing headers or secrets.
    let detail = "";
    try {
      const payload = JSON.parse(responseText) as { errors?: Array<{ code?: unknown; message?: unknown }> };
      const first = payload.errors?.[0];
      const code = typeof first?.code === "number" ? ` code ${first.code}` : "";
      const message = typeof first?.message === "string"
        ? first.message.replace(/https?:\/\/\S+/gi, "[URL]").replace(/[\r\n\t]+/g, " ").slice(0, 180)
        : "";
      detail = `${code}${message ? `: ${message}` : ""}`;
    } catch {
      // Do not expose raw upstream response bodies.
    }
    throw new Error(`Browser Run could not render this page (HTTP ${response.status})${detail}.`);
  }
  let html = responseText;
  try {
    const data = JSON.parse(responseText) as {
      success?: boolean;
      errors?: unknown[];
      result?: unknown;
      meta?: { finalUrl?: unknown; redirectChain?: Array<{ url?: unknown }> };
    };
    if ("success" in data || "result" in data || "errors" in data) {
      if (data.success !== true || typeof data.result !== "string") {
        throw new Error("Browser Run returned an unsuccessful rendering response.");
      }
      const allowedFinalUrl = new URL(rawUrl);
      if (typeof data.meta?.finalUrl === "string") {
        const finalUrl = new URL(data.meta.finalUrl);
        if (finalUrl.hostname.toLowerCase() !== allowedFinalUrl.hostname.toLowerCase() ||
            (finalUrl.protocol !== "http:" && finalUrl.protocol !== "https:")) {
          throw new Error("Browser Run redirected outside the requested hostname.");
        }
      }
      for (const redirect of data.meta?.redirectChain ?? []) {
        if (typeof redirect.url !== "string" ||
            new URL(redirect.url).hostname.toLowerCase() !== allowedFinalUrl.hostname.toLowerCase()) {
          throw new Error("Browser Run redirected outside the requested hostname.");
        }
      }
      html = data.result;
    }
  } catch (error) {
    if (error instanceof Error &&
        (error.message.includes("unsuccessful rendering") || error.message.includes("redirected outside"))) {
      throw error;
    }
    // Some deployments return HTML directly rather than the JSON response envelope.
    if (!responseText.trimStart().startsWith("<")) {
      throw new Error("Browser Run returned an invalid rendering response.");
    }
    html = responseText;
  }
  if (!html.trim()) throw new Error("Browser Run returned an empty page.");
  if (Buffer.byteLength(html, "utf8") > MAX_RENDERED_HTML_BYTES) {
    throw new Error("The rendered page is too large to audit (maximum 1 MB).");
  }
  if (!/<(?:!doctype\s+html|html|head|body)\b/i.test(html)) {
    throw new Error("Browser Run did not return a valid HTML document.");
  }
  return html;
}
