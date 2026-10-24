import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { NextResponse } from "next/server";
import { analyzeHtml, scoreFindings } from "@/lib/audit";
import { analyzeAdvancedHtml } from "@/lib/advanced-audit";
import { analyzeDiscovery } from "@/lib/discovery-audit";
import { isPrivateIPv4, isPrivateIPv6 } from "@/lib/ip-validation";
import { enforceAuditRateLimit } from "@/lib/rate-limit-response";
import { renderPublicPage } from "@/lib/rendered-browser";

export const runtime = "nodejs";
export const maxDuration = 30;

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    if (isPrivateIPv4(normalized)) throw new Error("Private or reserved IP addresses are not allowed.");
    return { address: normalized, family: 4 };
  }
  if (ipVersion === 6) {
    if (isPrivateIPv6(normalized)) throw new Error("Private or reserved IP addresses are not allowed.");
    return { address: normalized, family: 6 };
  }
  if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost") ||
      normalized.endsWith(".local") || normalized.endsWith(".internal")) {
    throw new Error("Only publicly accessible websites are supported.");
  }
  let addresses;
  try { addresses = await lookup(normalized, { all: true, verbatim: true }); }
  catch { throw new Error("The website hostname could not be resolved."); }
  if (!addresses.length || addresses.some(a => a.family === 4 ? isPrivateIPv4(a.address) : isPrivateIPv6(a.address))) {
    throw new Error("This hostname does not resolve exclusively to public IP addresses.");
  }
  const chosen = addresses[0];
  if (chosen.family !== 4 && chosen.family !== 6) throw new Error("The website hostname did not resolve to a supported IP address.");
  return { address: chosen.address, family: chosen.family };
}
async function validatePublicUrl(raw: string): Promise<{ url: URL; address: { address: string; family: 4 | 6 } }> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Enter a valid full URL, such as https://example.com."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS URLs are supported.");
  if (url.username || url.password) throw new Error("URLs containing usernames or passwords are not allowed.");
  if (!url.hostname) throw new Error("Enter a valid public website hostname.");
  const address = await resolvePublicAddress(url.hostname);
  url.hash = "";
  return { url, address };
}
function fetchPinnedHtml(url: URL, address: { address: string; family: 4 | 6 }): Promise<{ response: IncomingMessage; html: string }> {
  return new Promise((resolve, reject) => {
    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = requestFn(url, {
      method: "GET",
      headers: {
        "User-Agent": "KanakoSEOAutoPilot/1.2 (+initial-html-audit)",
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "Connection": "close",
      },
      // Pin the socket to the IP address already checked above. The URL hostname remains
      // unchanged for HTTP Host, TLS SNI, and certificate validation.
      lookup: ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
        if (options?.all) callback(null, [{ address: address.address, family: address.family }]);
        else callback(null, address.address, address.family);
      }) as never,
      servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : url.hostname,
      timeout: 10000,
    }, response => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.resume();
        reject(new Error("This page redirects. Enter the final destination URL directly; redirects are not followed for safety."));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`The website returned HTTP ${status}.`));
        return;
      }
      const type = response.headers["content-type"] ?? "";
      if (!type.toLowerCase().includes("text/html") && !type.toLowerCase().includes("application/xhtml+xml")) {
        response.resume();
        reject(new Error("The URL did not return an HTML page."));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = 1_000_000 - total;
        if (remaining <= 0) { response.destroy(); return; }
        const part = buffer.subarray(0, remaining);
        chunks.push(part);
        total += part.length;
        if (part.length < buffer.length || total >= 1_000_000) response.destroy();
      });
      response.on("end", () => resolve({ response, html: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", error => {
        // A size-limited response may be intentionally stopped after the first 1 MB.
        if (total >= 1_000_000) resolve({ response, html: Buffer.concat(chunks).toString("utf8") });
        else reject(error);
      });
    });
    req.on("timeout", () => req.destroy(new Error("The website took too long to respond. Try again later.")));
    req.on("error", reject);
    req.end();
  });
}
function fetchPinnedText(url: URL, address: { address: string; family: 4 | 6 }): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = requestFn(url, {
      method: "GET",
      headers: { "User-Agent": "KanakoSEOAutoPilot/1.2 (+robots-sitemap-check)", "Accept": "text/plain,application/xml,text/xml,*/*;q=0.1", "Connection": "close" },
      lookup: ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
        if (options?.all) callback(null, [{ address: address.address, family: address.family }]);
        else callback(null, address.address, address.family);
      }) as never,
      servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : url.hostname,
      timeout: 1800,
    }, response => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = 200_000 - total;
        if (remaining <= 0) { response.destroy(); return; }
        const part = buffer.subarray(0, remaining);
        chunks.push(part);
        total += part.length;
        if (part.length < buffer.length || total >= 200_000) response.destroy();
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", error => {
        if (total >= 200_000) resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") });
        else reject(error);
      });
    });
    req.on("timeout", () => req.destroy(new Error("Discovery request timed out.")));
    req.on("error", reject);
    req.end();
  });
}
async function inspectRobotsAndSitemap(url: URL, address: { address: string; family: 4 | 6 }) {
  let robots: { status: number; text: string } | null = null;
  try { robots = await fetchPinnedText(new URL("/robots.txt", url.origin), address); } catch { /* optional discovery check */ }
  let sitemapUrl = new URL("/sitemap.xml", url.origin);
  const sitemapDirective = robots?.text.split(/\r?\n/).map(line => line.trim()).find(line => /^sitemap\s*:/i.test(line));
  if (sitemapDirective) {
    try {
      const candidate = new URL(sitemapDirective.replace(/^sitemap\s*:\s*/i, ""), url.origin);
      // Do not fetch a cross-host sitemap URL from robots.txt.
      if (candidate.protocol === url.protocol && candidate.hostname.toLowerCase() === url.hostname.toLowerCase()) sitemapUrl = candidate;
    } catch { /* fall back to the standard sitemap path */ }
  }
  let sitemap: { status: number; text: string } | null = null;
  try { sitemap = await fetchPinnedText(sitemapUrl, address); } catch { /* optional discovery check */ }
  return analyzeDiscovery({
    robotsStatus: robots?.status ?? null,
    robotsText: robots?.text ?? "",
    sitemapStatus: sitemap?.status ?? null,
    sitemapText: sitemap?.text ?? "",
  });
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.url !== "string" || body.url.length > 2048) {
      return NextResponse.json({ error: "Enter a URL under 2,048 characters." }, { status: 400 });
    }
    const raw = body.url.trim();
    // Vercel supplies x-real-ip at the trusted edge. Do not derive the
    // rate-limit identity from x-forwarded-for, which can be client-spoofed.
    const clientIp = request.headers.get("x-real-ip")?.trim();
    if (!clientIp) {
      // Do not put unrelated visitors into a shared "unknown" rate-limit bucket.
      return NextResponse.json(
        { error: "The audit service is temporarily unavailable. Please try again shortly." },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } },
      );
    }

    const rateLimitGate = await enforceAuditRateLimit(clientIp);
    if (rateLimitGate.response) return rateLimitGate.response;

    const { url, address } = await validatePublicUrl(raw);
    const { response, html: initialHtml } = await fetchPinnedHtml(url, address);
    const [rendered, discoveryFindings] = await Promise.all([
      renderPublicPage(url, address, initialHtml),
      inspectRobotsAndSitemap(url, address),
    ]);
    // Prefer the browser DOM when it rendered successfully. If it did not, retain
    // the initial-HTML result and its existing limited-evidence score safeguards.
    const auditHtml = rendered?.html ?? initialHtml;
    const auditUrl = rendered?.finalUrl ?? url.toString();
    const baseResult = analyzeHtml(auditHtml);
    const advancedFindings = analyzeAdvancedHtml(auditHtml, auditUrl);
    const findings = [...baseResult.findings, ...advancedFindings, ...discoveryFindings];
    const score = baseResult.score === null
      ? null
      : scoreFindings(findings.filter(f => f.severity !== "info"));
    return NextResponse.json({
      ...baseResult, findings, score, url: raw, finalUrl: auditUrl, status: response.statusCode ?? 200,
      evidenceMode: rendered ? "rendered" : "initial-html",
      renderedPage: Boolean(rendered),
      fetchedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The audit could not be completed.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
