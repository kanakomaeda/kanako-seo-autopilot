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
