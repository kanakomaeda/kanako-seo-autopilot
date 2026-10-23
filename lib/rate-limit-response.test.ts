import test from "node:test";
import assert from "node:assert/strict";
import { rateLimitUnavailableResponse } from "./rate-limit-response";

test("returns a no-store 503 with a retry hint when rate limiting is unavailable", async () => {
  const response = rateLimitUnavailableResponse();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("retry-after"), "5");
  assert.deepEqual(await response.json(), {
    error: "The audit service is temporarily unavailable. Please try again shortly.",
  });
});
