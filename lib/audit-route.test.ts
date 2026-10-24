import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/audit/route";

test("fails closed with 503 when the trusted client IP header is missing", async () => {
  const request = new Request("https://example.test/api/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" }),
  });

  const response = await POST(request);

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("retry-after"), "5");
  assert.deepEqual(await response.json(), {
    error: "The audit service is temporarily unavailable. Please try again shortly.",
  });
});

test("does not trust x-forwarded-for as a substitute for the trusted client IP", async () => {
  const request = new Request("https://example.test/api/audit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.8",
    },
    body: JSON.stringify({ url: "https://example.com" }),
  });

  const response = await POST(request);

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("retry-after"), "5");
});
