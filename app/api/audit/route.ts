import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { NextResponse } from "next/server";
import { analyzeHtml } from "@/lib/audit";
import { fetchBrowserRunHtml } from "@/lib/browser-run";
import { isPrivateIPv4, isPrivateIPv6 } from "@/lib/ip-validation";
import { isBlockedHostname, parsePublicHttpUrl } from "@/lib/url-security";
import { enforceAuditRateLimit } from "@/lib/rate-limit-response";

export const runtime = "nodejs";
export const maxDuration = 15;

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
  if (isBlockedHostname(normalized)) {
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
  const url = parsePublicHttpUrl(raw);
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
        "User-Agent": "KanakoSEOAutoPilot/1.1 (+initial-html-audit)",
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
    let renderedHtml: string | null = null;
    let renderWarning: string | undefined;
    try {
      renderedHtml = await fetchBrowserRunHtml(url.toString());
    } catch (error) {
      // Browser rendering is an enhancement, not a requirement for a safe audit.
      // Fall back to the pinned-IP HTML fetch and clearly label the evidence.
      renderWarning = error instanceof Error ? error.message : "Browser rendering failed; used initial HTML instead.";
    }
    let html: string;
    let status = 200;
    if (renderedHtml !== null) {
      html = renderedHtml;
    } else {
      const fetched = await fetchPinnedHtml(url, address);
      html = fetched.html;
      status = fetched.response.statusCode ?? 200;
    }
    const rendered = renderedHtml !== null;
    const result = analyzeHtml(html, rendered);
    return NextResponse.json({
      ...result, url: raw, finalUrl: url.toString(), status, renderMode: rendered ? "rendered" : "initial-html",
      ...(renderWarning ? { renderWarning } : {}),
      fetchedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The audit could not be completed.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
