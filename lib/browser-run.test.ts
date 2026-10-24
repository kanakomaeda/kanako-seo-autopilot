import test from "node:test";
import assert from "node:assert/strict";
import { fetchBrowserRunHtml } from "./browser-run";

test("Browser Run remains disabled unless explicitly enabled", async () => {
  const previous = process.env.CLOUDFLARE_BROWSER_RUN_ENABLED;
  delete process.env.CLOUDFLARE_BROWSER_RUN_ENABLED;
  try {
    assert.equal(await fetchBrowserRunHtml("https://example.com"), null);
  } finally {
    if (previous === undefined) delete process.env.CLOUDFLARE_BROWSER_RUN_ENABLED;
    else process.env.CLOUDFLARE_BROWSER_RUN_ENABLED = previous;
  }
});

test("Browser Run refuses to render hosts that are not explicitly allowlisted", async () => {
  const previous = {
    enabled: process.env.CLOUDFLARE_BROWSER_RUN_ENABLED,
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
    hosts: process.env.CLOUDFLARE_BROWSER_RUN_ALLOWED_HOSTS,
  };
  process.env.CLOUDFLARE_BROWSER_RUN_ENABLED = "true";
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  process.env.CLOUDFLARE_BROWSER_RUN_ALLOWED_HOSTS = "trusted.example";
  try {
    assert.equal(await fetchBrowserRunHtml("https://example.com"), null);
    assert.equal(await fetchBrowserRunHtml("https://sub.trusted.example"), null);
  } finally {
    for (const [key, value] of [
      ["CLOUDFLARE_BROWSER_RUN_ENABLED", previous.enabled],
      ["CLOUDFLARE_ACCOUNT_ID", previous.account],
      ["CLOUDFLARE_API_TOKEN", previous.token],
      ["CLOUDFLARE_BROWSER_RUN_ALLOWED_HOSTS", previous.hosts],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Browser Run parses rendered HTML from the Cloudflare response envelope", async () => {
  const previous = {
    enabled: process.env.CLOUDFLARE_BROWSER_RUN_ENABLED,
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
    hosts: process.env.CLOUDFLARE_BROWSER_RUN_ALLOWED_HOSTS,
  };
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestBody = "";
  process.env.CLOUDFLARE_BROWSER_RUN_ENABLED = "true";
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  process.env.CLOUDFLARE_BROWSER_RUN_ALLOWED_HOSTS = "trusted.example,other.trusted.example";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = String(input);
    requestBody = String(init?.body ?? "");
    return new Response(JSON.stringify({
      success: true,
      result: "<!doctype html><html><head><title>Rendered title</title></head><body><h1>Rendered content</h1></body></html>",
      meta: { finalUrl: "https://trusted.example/page", redirectChain: [] },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const html = await fetchBrowserRunHtml("https://trusted.example/page");
    assert.match(requestedUrl, /browser-rendering\/content\?cacheTTL=0$/);
    const parsedBody = JSON.parse(requestBody) as { allowRequestPattern?: string[]; gotoOptions?: { waitUntil?: string; timeout?: number }; waitForTimeout?: number };
    assert.deepEqual(parsedBody.allowRequestPattern, ["/^https?:\\/\\/trusted\\.example(?::\\d+)?(?:\\/|$)/"]);
    assert.deepEqual(parsedBody.gotoOptions, { waitUntil: "domcontentloaded", timeout: 15_000 });
    assert.equal(parsedBody.waitForTimeout, 2_000);
    const patternLiteral = parsedBody.allowRequestPattern?.[0];
    assert.ok(patternLiteral);
    assert.ok(patternLiteral.startsWith("/") && patternLiteral.endsWith("/"));
    const pattern = new RegExp(patternLiteral.slice(1, -1));
    assert.equal(pattern.test("https://trusted.example/page"), true);
    assert.equal(pattern.test("https://trusted.example.evil.test/page"), false);
    assert.equal(pattern.test("https://other.trusted.example/page"), false);
    assert.match(html ?? "", /Rendered title/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [
      ["CLOUDFLARE_BROWSER_RUN_ENABLED", previous.enabled],
      ["CLOUDFLARE_ACCOUNT_ID", previous.account],
      ["CLOUDFLARE_API_TOKEN", previous.token],
      ["CLOUDFLARE_BROWSER_RUN_ALLOWED_HOSTS", previous.hosts],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Browser Run rejects a response that reports a redirect to another hostname", async () => {
  const previous = {
    enabled: process.env.CLOUDFLARE_BROWSER_RUN_ENABLED,
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
    hosts: process.env.CLOUDFLARE_BROWSER_RUN_ALLOWED_HOSTS,
  };
  const originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_BROWSER_RUN_ENABLED = "true";
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  process.env.CLOUDFLARE_BROWSER_RUN_ALLOWED_HOSTS = "trusted.example";
  globalThis.fetch = (async () => new Response(JSON.stringify({
    success: true,
    result: "<html><body>content</body></html>",
    meta: { finalUrl: "https://other.example/page", redirectChain: [] },
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  try {
    await assert.rejects(
      fetchBrowserRunHtml("https://trusted.example/page"),
      /redirected outside the requested hostname/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [
      ["CLOUDFLARE_BROWSER_RUN_ENABLED", previous.enabled],
      ["CLOUDFLARE_ACCOUNT_ID", previous.account],
      ["CLOUDFLARE_API_TOKEN", previous.token],
      ["CLOUDFLARE_BROWSER_RUN_ALLOWED_HOSTS", previous.hosts],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
