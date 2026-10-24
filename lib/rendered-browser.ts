import chromium from "@sparticuz/chromium";
import { chromium as playwrightChromium } from "playwright-core";

type PublicAddress = { address: string; family: 4 | 6 };
const MAX_RENDERED_HTML = 1_000_000;
const MAX_REQUESTS = 60;

/**
 * Render only the target origin. Chromium's resolver is pinned to the address
 * already validated by the audit route; cross-origin resources and redirects
 * are blocked to avoid turning the browser into an SSRF proxy.
 */
export async function renderPublicPage(
  target: URL,
  address: PublicAddress,
): Promise<{ html: string; finalUrl: string } | null> {
  // Chromium's host resolver mapping is deliberately limited to DNS hostnames.
  // Literal-IP targets remain supported by the initial-HTML audit only.
  if (/^[\[\]]/.test(target.hostname) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(target.hostname) || target.hostname.includes(":")) {
    return null;
  }

  let browser: Awaited<ReturnType<typeof playwrightChromium.launch>> | undefined;
  try {
    const resolverRule = `MAP ${target.hostname} ${address.address},EXCLUDE localhost`;
    browser = await playwrightChromium.launch({
      args: [...chromium.args, `--host-resolver-rules=${resolverRule}`],
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
      userAgent: "Mozilla/5.0 (compatible; KanakoSEOAutoPilot/1.3; +rendered-page-audit)",
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
        // Same-origin only: no third-party calls, data URLs, file URLs, or
        // redirects to another host/protocol are allowed in this browser.
        if (requested.origin !== target.origin || !["http:", "https:"].includes(requested.protocol)) {
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
    // Give client-side hydration time to populate the DOM, and scroll in a few
    // bounded steps to trigger common lazy-loaded sections. Do not wait for
    // networkidle: analytics and long-polling can keep it open indefinitely.
    await page.evaluate(async () => {
      const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      let previousTextLength = -1;
      let stableSamples = 0;
      for (let step = 0; step < 8; step += 1) {
        const textLength = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().length;
        if (textLength > 0 && textLength === previousTextLength) stableSamples += 1;
        else stableSamples = 0;
        previousTextLength = textLength;

        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo(0, Math.min(maxScroll, step * Math.max(400, Math.floor(window.innerHeight * 0.8))));
        await pause(250);
        if (step >= 2 && stableSamples >= 2) break;
      }
      window.scrollTo(0, 0);
      await pause(300);
    });
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
