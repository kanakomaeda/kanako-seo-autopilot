import test from "node:test";
import assert from "node:assert/strict";
import { fetchAuditHtmlWithFallback } from "./audit-html-fallback";

test("falls back to initial HTML and preserves the Browser Run warning", async () => {
  let fallbackCalls = 0;
  const result = await fetchAuditHtmlWithFallback(
    async () => { throw new Error("Browser Run could not render this page (HTTP 422) code 5009: Network error when attempting to load page."); },
    async () => {
      fallbackCalls += 1;
      return { html: "<html><title>Initial HTML</title></html>", status: 200 };
    },
  );

  assert.equal(fallbackCalls, 1);
  assert.equal(result.html, "<html><title>Initial HTML</title></html>");
  assert.equal(result.status, 200);
  assert.equal(result.rendered, false);
  assert.match(result.renderWarning ?? "", /HTTP 422\) code 5009/);
});

test("does not show a render warning when Browser Run succeeds", async () => {
  let fallbackCalls = 0;
  const result = await fetchAuditHtmlWithFallback(
    async () => "<html><title>Rendered HTML</title></html>",
    async () => {
      fallbackCalls += 1;
      return { html: "fallback", status: 200 };
    },
  );

  assert.equal(fallbackCalls, 0);
  assert.equal(result.html, "<html><title>Rendered HTML</title></html>");
  assert.equal(result.status, 200);
  assert.equal(result.rendered, true);
  assert.equal(result.renderWarning, undefined);
});

test("propagates initial-HTML fetch failure instead of pretending an audit succeeded", async () => {
  await assert.rejects(
    fetchAuditHtmlWithFallback(
      async () => { throw new Error("Browser Run failed"); },
      async () => { throw new Error("The website returned HTTP 403."); },
    ),
    /The website returned HTTP 403\./,
  );
});
