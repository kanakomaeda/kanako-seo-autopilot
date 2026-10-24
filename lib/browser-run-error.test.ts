import test from "node:test";
import assert from "node:assert/strict";
import { fetchBrowserRunHtml } from "./browser-run";

test("Browser Run exposes a sanitized HTTP 422/code 5009 rendering failure", async () => {
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
  process.env.CLOUDFLARE_BROWSER_RUN_ALLOWED_HOSTS = "app.emergent.sh";
  globalThis.fetch = (async () => new Response(JSON.stringify({
    success: false,
    errors: [{ code: 5009, message: "Network error when attempting to load page." }],
  }), { status: 422, headers: { "Content-Type": "application/json" } })) as typeof fetch;

  try {
    await assert.rejects(
      fetchBrowserRunHtml("https://app.emergent.sh/"),
      /Browser Run could not render this page \(HTTP 422\) code 5009: Network error when attempting to load page\./,
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
