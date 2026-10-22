import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { NextResponse } from "next/server";
import { analyzeHtml } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 15;

function isPrivateIPv4(ip: string): boolean {
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
function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase().split("%")[0];
  if (s.startsWith("::ffff:")) return isPrivateIPv4(s.slice(7));
  return s === "::" || s === "::1" || s.startsWith("fc") || s.startsWith("fd") ||
    /^fe[89ab]/.test(s) || s.startsWith("ff") || s.startsWith("2001:db8");
}
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
    const { url, address } = await validatePublicUrl(raw);
    const { response, html } = await fetchPinnedHtml(url, address);
    const result = analyzeHtml(html);
    return NextResponse.json({
      ...result, url: raw, finalUrl: url.toString(), status: response.statusCode ?? 200,
      fetchedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The audit could not be completed.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
