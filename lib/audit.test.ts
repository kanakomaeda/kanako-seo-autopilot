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
test("reads meta attributes regardless of order and decodes title entities", () => {
  const result = analyzeHtml('<html lang="en"><head><title>Research &amp; SEO: a useful page title</title><meta content="A useful summary for this page." name="description"><meta content="width=device-width" name="viewport"><link href="https://example.com/preferred" hreflang="en" rel="alternate"><link href="https://example.com/page" rel="canonical"></head><body><h1>Useful heading</h1><a title="No destination"></a><img src="/decorative.svg" alt=""><p>' + "Useful content ".repeat(30) + '</p></body></html>');
  assert.equal(result.title, "Research & SEO: a useful page title");
  assert.equal(result.description, "A useful summary for this page.");
  assert.equal(result.canonical, true);
  assert.equal(result.canonicalUrl, "https://example.com/page");
  assert.equal(result.linksCount, 1);
  assert.equal(result.linksWithoutHref, 1);
  assert.equal(result.imagesWithoutAlt, 0, "an explicit empty alt attribute is valid for decorative images");
});
test("detects googlebot noindex directive and empty H1 headings", () => {
  const result = analyzeHtml('<html lang="en"><head><title>A sufficiently descriptive title for testing</title><meta name="viewport" content="width=device-width"><meta name="description" content="A sufficiently useful description for a test page."><meta content="noindex,follow" name="googlebot"></head><body><h1> </h1><p>' + "Useful content ".repeat(30) + '</p></body></html>');
  assert.equal(result.robotsNoindex, true);
  assert.equal(result.metaRobots, "noindex,follow");
  assert.equal(result.headingsWithoutText, 1);
  assert.ok(result.findings.some(f => f.id === "heading-empty"));
});
