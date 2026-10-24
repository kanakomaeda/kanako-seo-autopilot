import test from "node:test";
import assert from "node:assert/strict";
import { enforceAuditRateLimit } from "./rate-limit-response";

test("fails closed with a no-store 503 when the rate-limit service throws", async () => {
  const gate = await enforceAuditRateLimit("203.0.113.8", async () => {
    throw new Error("simulated Redis outage");
  });
  assert.ok(gate.response);
  assert.equal(gate.response.status, 503);
  assert.equal(gate.response.headers.get("cache-control"), "no-store");
  assert.equal(gate.response.headers.get("retry-after"), "5");
  assert.deepEqual(await gate.response.json(), {
    error: "The audit service is temporarily unavailable. Please try again shortly.",
  });
});

test("returns 429 with retry headers when the rate limit is exceeded", async () => {
  const gate = await enforceAuditRateLimit("203.0.113.8", async () => ({
    allowed: false,
    retryAfterSeconds: 7,
  }));
  assert.ok(gate.response);
  assert.equal(gate.response.status, 429);
  assert.equal(gate.response.headers.get("retry-after"), "7");
  assert.equal(gate.response.headers.get("x-ratelimit-limit"), "10");
  assert.equal(gate.response.headers.get("x-ratelimit-remaining"), "0");
});

test("allows the audit to continue when the rate limit check passes", async () => {
  const gate = await enforceAuditRateLimit("203.0.113.8", async () => ({
    allowed: true,
    remaining: 9,
  }));
  assert.equal(gate.response, undefined);
  assert.deepEqual(gate.result, { allowed: true, remaining: 9 });
});
