import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHtml, scoreFindings, type Finding } from "./audit";

const finding = (severity: Finding["severity"]): Finding => ({
  id: severity, title: severity, severity, detail: "", recommendation: "",
});

test("informational findings do not reduce the initial HTML score", () => {
  assert.equal(scoreFindings([finding("info")]), 100);
});
test("warnings and critical findings affect the initial HTML score", () => {
  assert.equal(scoreFindings([finding("warning"), finding("critical")]), 84);
});
test("JavaScript-heavy shell lowers evidence coverage and marks missing signals provisional", () => {
  const result = analyzeHtml('<html lang="en"><head><title>A descriptive app title</title><meta name="viewport" content="width=device-width"><meta name="description" content="A useful description for the application shell."></head><body><div id="root"></div><script src="/one.js"></script><script src="/two.js"></script></body></html>');
  assert.equal(result.limitedEvidence, true);
  assert.ok(result.coverage < 100);
  assert.ok(result.findings.some(f => f.id === "js-shell" && f.severity === "info"));
  assert.ok(result.findings.some(f => f.id === "h1-missing" && f.severity === "info"));
  assert.ok(result.findings.some(f => f.id === "content-sparse" && f.severity === "info"));
  assert.equal(result.score, 100, "provisional informational findings must not imply confirmed SEO failures");
});
test("missing structured data alone is informational", () => {
  const result = analyzeHtml('<html lang="en"><head><title>A clear descriptive page title</title><meta name="viewport" content="width=device-width"><meta name="description" content="A useful description for this example page."></head><body><h1>Hello</h1><p>' + "Useful content ".repeat(30) + '</p></body></html>');
  assert.ok(result.findings.some(f => f.id === "structured-data" && f.severity === "info"));
  assert.equal(result.score, 100);
});
test("detects noindex and missing image alt without claiming rendered-page coverage", () => {
  const result = analyzeHtml('<html lang="en"><head><title>A sufficiently descriptive title for testing</title><meta name="viewport" content="width=device-width"><meta name="description" content="A sufficiently useful description for a test page."><meta name="robots" content="noindex"></head><body><h1>Test page</h1><p>' + "Useful content ".repeat(30) + '</p><img src="/photo.jpg"></body></html>');
  assert.equal(result.robotsNoindex, true);
  assert.equal(result.imagesWithoutAlt, 1);
  assert.equal(result.limitedEvidence, false);
  assert.ok(result.findings.some(f => f.id === "noindex" && f.severity === "critical"));
  assert.ok(result.findings.some(f => f.id === "image-alt" && f.severity === "warning"));
});

test("rendered-page audits label findings as rendered evidence", () => {
  const result = analyzeHtml("<html><head></head><body></body></html>", true);
  assert.equal(result.scoreLabel, "Rendered page checks score");
  assert.ok(result.findings.some((f) => f.id === "title-missing" && f.detail.includes("rendered page")));
  assert.ok(result.findings.some((f) => f.id === "content-sparse" && f.title.includes("rendered page")));
});
