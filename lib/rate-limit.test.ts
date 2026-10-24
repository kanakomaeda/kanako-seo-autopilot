import test from "node:test";
import assert from "node:assert/strict";
import { checkAuditRateLimit } from "./rate-limit";

function fakeResponse(result: unknown, ok = true) {
  return { ok, json: async () => ({ result }) } as Response;
}

test("allows a request under the limit and sends an atomic Redis EVAL", async () => {
  let request: RequestInit | undefined;
  const result = await checkAuditRateLimit("203.0.113.8", {
    url: "https://example.upstash.io",
    token: "test-token",
    limit: 10,
    windowMs: 60_000,
    fetcher: async (_input, init) => {
      request = init;
      return fakeResponse([1, 9, 60_000]);
    },
  });
  assert.deepEqual(result, { allowed: true, remaining: 9 });
  assert.equal(request?.method, "POST");
  assert.equal((request?.headers as Record<string, string>).Authorization, "Bearer test-token");
  const body = JSON.parse(String(request?.body));
  assert.equal(body[0], "EVAL");
  assert.equal(body[2], 1);
  assert.match(body[3], /^seo-audit:rate:[a-f0-9]{64}$/);
});

test("rejects an over-limit request and returns retry duration", async () => {
  const result = await checkAuditRateLimit("203.0.113.8", {
    url: "https://example.upstash.io",
    token: "test-token",
    fetcher: async () => fakeResponse([0, 0, 1500]),
  });
  assert.deepEqual(result, { allowed: false, retryAfterSeconds: 2 });
});

test("fails closed when the rate limiter is not configured", async () => {
  await assert.rejects(
    checkAuditRateLimit("203.0.113.8", { url: "", token: "" }),
    /not configured/,
  );
});

test("fails closed when Redis returns an error status", async () => {
  await assert.rejects(
    checkAuditRateLimit("203.0.113.8", {
      url: "https://example.upstash.io",
      token: "test-token",
      fetcher: async () => fakeResponse(null, false),
    }),
    /request failed/,
  );
});

test("fails closed when Redis returns malformed data", async () => {
  await assert.rejects(
    checkAuditRateLimit("203.0.113.8", {
      url: "https://example.upstash.io",
      token: "test-token",
      fetcher: async () => fakeResponse(["bad"]),
    }),
    /invalid result/,
  );
});
