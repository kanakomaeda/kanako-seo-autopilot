import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDiscovery } from "./discovery-audit";

test("reports reachable robots and a sitemap index without treating them as ranking factors", () => {
  const findings = analyzeDiscovery({
    robotsStatus: 200,
    robotsText: "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml",
    sitemapStatus: 200,
    sitemapText: '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/posts.xml</loc></sitemap></sitemapindex>',
  });
  assert.ok(findings.some(f => f.id === "robots-txt" && f.severity === "info"));
  assert.ok(findings.some(f => f.id === "sitemap-detected" && f.detail.includes("1 child sitemap")));
});

test("does not claim a robots disallow directive is noindex", () => {
  const findings = analyzeDiscovery({
    robotsStatus: 200,
    robotsText: "User-agent: *\nDisallow: /",
    sitemapStatus: 404,
    sitemapText: "",
  });
  const robots = findings.find(f => f.id === "robots-txt");
  assert.ok(robots?.detail.includes("root Disallow"));
  assert.ok(robots?.recommendation.includes("not the same as a noindex"));
  assert.ok(findings.some(f => f.id === "sitemap-not-confirmed"));
});
