import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import chromium from "@sparticuz/chromium";
import { chromium as playwrightChromium } from "playwright-core";
import { isPrivateIPv4, isPrivateIPv6 } from "./ip-validation";

type PublicAddress = { address: string; family: 4 | 6 };
const MAX_RENDERED_HTML = 1_000_000;
const MAX_REQUESTS = 60;
const MAX_EXTERNAL_RESOURCE_ORIGINS = 10;

function resolverAddress(address: PublicAddress): string {
  return address.family === 6 ? `[${address.address}]` : address.address;
}

function getResourceUrls(html: string, baseUrl: URL): URL[] {
  const urls: URL[] = [];
  const tagPattern = /<(script|link|img|source|video|audio)\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html))) {
    const tag = match[0];
    const tagName = match[1].toLowerCase();
    const rel = tag.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/i);
    const isResourceLink = tagName !== "link" ||
      /(?:^|\s)(?:stylesheet|preload|modulepreload)(?:\s|$)/i.test(rel?.[1] ?? rel?.[2] ?? rel?.[3] ?? "");
    if (!isResourceLink) continue;
    const attrName = tagName === "link" ? "href" : "src";
    const attr = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, "i").exec(tag);
    const raw = (attr?.[1] ?? attr?.[2] ?? attr?.[3] ?? "").replace(/&amp;/gi, "&").trim();
    if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) continue;
    try {
      const url = new URL(raw, baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      if (baseUrl.protocol === "https:" && url.protocol !== "https:") continue;
      if (url.username || url.password || url.port && !["80", "443"].includes(url.port)) continue;
      if (url.origin !== baseUrl.origin) urls.push(url);
    } catch {
      // Ignore malformed resource references; they are not allowed by the browser route.
    }
  }
  return urls;
}

async function resolveResourceHost(hostname: string): Promise<PublicAddress | null> {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!normalized || isIP(normalized) !== 0 ||
      normalized === "localhost" || normalized.endsWith(".localhost") ||
      normalized.endsWith(".local") || normalized.endsWith(".internal")) return null;
  try {
    const addresses = await lookup(normalized, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(a =>
      a.family === 4 ? isPrivateIPv4(a.address) : isPrivateIPv6(a.address))) return null;
    const chosen = addresses.find(a => a.family === 4) ?? addresses.find(a => a.family === 6);
    if (!chosen || (chosen.family !== 4 && chosen.family !== 6)) return null;
    return { address: chosen.address, family: chosen.family };
  } catch {
    return null;
  }
}

export async function renderPublicPage(
  target: URL,
  address: PublicAddress,
  initialHtml = "",
): Promise<{ html: string; finalUrl: string } | null> {
  // Chromium's host resolver mapping is deliberately limited to DNS hostnames.
  // Literal-IP targets remain supported by the initial-HTML audit only.
  if (/^[\[\]]/.test(target.hostname) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(target.hostname) || target.hostname.includes(":")) {
    return null;
  }

  let browser: Awaited<ReturnType<typeof playwrightChromium.launch>> | undefined;
  try {
    // Allow only external origins explicitly referenced as static resources by
    // the fetched HTML. Resolve and pin each host to a public IP before Chromium
    // starts; do not grant arbitrary third-party or private-network access.
    const resourceUrls = getResourceUrls(initialHtml, target);
    const resourceHosts = [...new Set(resourceUrls.map(url => url.hostname.toLowerCase()))]
      .filter(host => host !== target.hostname.toLowerCase())
      .slice(0, MAX_EXTERNAL_RESOURCE_ORIGINS);
    const resolvedResources = await Promise.all(resourceHosts.map(async hostname => ({
      hostname,
      address: await resolveResourceHost(hostname),
    })));
    const allowedOrigins = new Set([target.origin]);
    const resolverRules = [`MAP ${target.hostname} ${resolverAddress(address)}`];
    for (const resource of resolvedResources) {
      if (!resource.address) continue;
      resolverRules.push(`MAP ${resource.hostname} ${resolverAddress(resource.address)}`);
      for (const url of resourceUrls) {
        if (url.hostname.toLowerCase() === resource.hostname) allowedOrigins.add(url.origin);
      }
    }
    resolverRules.push("EXCLUDE localhost");
    browser = await playwrightChromium.launch({
      args: [...chromium.args, `--host-resolver-rules=${resolverRules.join(",")}`],
      executablePath: await chromium.executablePath(),
      headless: true,
      timeout: 5_000,
    });
    const context = await browser.newContext({
      javaScriptEnabled: true,
      serviceWorkers: "block",
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      viewport: { width: 1365, height: 900 },
      // Use a normal Chromium UA so legitimate CDN/WAF rules don't treat the
      // render request as a custom crawler. This is still a read-only audit.
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(6_000);
    page.setDefaultTimeout(2_000);
    let requestCount = 0;
    await page.route("**/*", async route => {
      const requestUrl = route.request().url();
      requestCount += 1;
      if (requestCount > MAX_REQUESTS || route.request().method() !== "GET") {
        await route.abort("blockedbyclient");
        return;
      }
      try {
        const requested = new URL(requestUrl);
        // Same-origin plus pinned, public static-resource origins only. Dynamic
        // third-party requests, redirects to unlisted origins, and non-web URLs
        // remain blocked to preserve the SSRF boundary.
        if (!allowedOrigins.has(requested.origin) || !["http:", "https:"].includes(requested.protocol)) {
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    const response = await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 6_000 });
    if (!response || response.status() < 200 || response.status() >= 400) return null;

    // Client-rendered content can appear several seconds after DOMContentLoaded.
    // Keep waiting when the DOM is still nearly empty; only stop early after a
    // meaningful amount of text has appeared and then remained stable. Scroll
    // in bounded steps to trigger common lazy-loaded sections without relying
    // on networkidle, which can hang on analytics or long-polling requests.
    // Pass the browser-side function as source text so the TypeScript test
    // runner cannot inject its Node-only __name helper into the page context.
    await page.evaluate(`async () => {
      const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      let previousTextLength = -1;
      let stableSamples = 0;
      for (let step = 0; step < 14; step += 1) {
        const textLength = (document.body?.innerText ?? "").replace(/\\s+/g, " ").trim().length;
        if (textLength >= 35 && textLength === previousTextLength) stableSamples += 1;
        else stableSamples = 0;
        previousTextLength = textLength;

        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        const stride = Math.max(400, Math.floor(window.innerHeight * 0.8));
        window.scrollTo(0, Math.min(maxScroll, step * stride));
        await pause(400);
        if (step >= 5 && textLength >= 35 && stableSamples >= 2) break;
      }
      window.scrollTo(0, 0);
      await pause(300);
    }`);

    const html = await page.content();
    if (!html || Buffer.byteLength(html, "utf8") > MAX_RENDERED_HTML) return null;
    const final = new URL(page.url());
    if (final.origin !== target.origin) return null;
    return { html, finalUrl: final.toString() };
  } catch {
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
