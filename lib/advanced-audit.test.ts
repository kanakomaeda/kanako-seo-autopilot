import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAdvancedHtml } from "./advanced-audit";

test("reports missing social preview metadata as informational findings", () => {
  const findings = analyzeAdvancedHtml('<html><head><title>Example</title></head><body><a href="/about">About</a></body></html>', "https://example.com/");
  assert.ok(findings.some(f => f.id === "social-preview-metadata" && f.severity === "info"));
  assert.ok(findings.some(f => f.id === "twitter-card-missing" && f.severity === "info"));
});

test("counts same-host and external links and flags unsafe new-tab links", () => {
  const html = '<html><head><meta property="og:title" content="A title"><meta property="og:description" content="A description"><meta property="og:image" content="/preview.png"><meta name="twitter:card" content="summary_large_image"></head><body><a href="/about">About</a><a href="https://other.example/path" target="_blank">Other</a><a href="https://ads.example/" rel="sponsored">Ad</a></body></html>';
  const findings = analyzeAdvancedHtml(html, "https://example.com/");
  const links = findings.find(f => f.id === "link-distribution");
  assert.ok(links?.detail.includes("1 same-host link(s)"));
  assert.ok(links?.detail.includes("2 external link(s)"));
  assert.ok(findings.some(f => f.id === "blank-link-rel"));
  assert.ok(findings.some(f => f.id === "nofollow-links"));
  assert.ok(!findings.some(f => f.id === "social-preview-metadata"));
  assert.ok(!findings.some(f => f.id === "twitter-card-missing"));
});

test("flags suspicious cross-host canonical and reports hreflang alternates", () => {
  const html = '<html><head><link rel="canonical" href="https://wrong.example/page"><link rel="alternate" hreflang="fr" href="https://example.com/fr"></head><body></body></html>';
  const findings = analyzeAdvancedHtml(html, "https://example.com/page");
  assert.ok(findings.some(f => f.id === "canonical-cross-host" && f.severity === "warning"));
  assert.ok(findings.some(f => f.id === "hreflang-present"));
});
