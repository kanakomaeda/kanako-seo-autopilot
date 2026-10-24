import type { Finding } from "./audit";

export type DiscoveryInput = {
  robotsStatus: number | null;
  robotsText: string;
  sitemapStatus: number | null;
  sitemapText: string;
};

export function analyzeDiscovery(input: DiscoveryInput): Finding[] {
  const findings: Finding[] = [];
  const add = (id: string, title: string, detail: string, recommendation: string) =>
    findings.push({ id, title, severity: "info", detail, recommendation });

  if (input.robotsStatus === 200) {
    const sitemapLines = input.robotsText.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => /^sitemap\s*:/i.test(line));
    const blockedRoot = input.robotsText.split(/\r?\n/).some(line => /^\s*disallow\s*:\s*\/\s*(?:#.*)?$/i.test(line));
    add("robots-txt", "robots.txt is reachable",
      `The site's robots.txt returned HTTP 200 and contains ${sitemapLines.length} Sitemap directive(s).${blockedRoot ? " A root Disallow rule was detected; verify that it is intentional." : ""}`,
      "Review robots.txt rules against the site's intended crawl policy. A Disallow rule is not the same as a noindex directive and does not guarantee removal from search results.");
  } else {
    add("robots-txt-unavailable", "robots.txt was not confirmed",
      input.robotsStatus === null ? "The robots.txt request could not be completed within the audit's limited discovery check." : `robots.txt returned HTTP ${input.robotsStatus}.`,
      "Check whether https://your-domain/robots.txt is intentionally absent or blocked. Not every site requires a custom robots.txt file.");
  }

  const hasSitemap = input.sitemapStatus === 200 && /<(?:urlset|sitemapindex)\b/i.test(input.sitemapText);
  if (hasSitemap) {
    const urlCount = (input.sitemapText.match(/<url\b/gi) ?? []).length;
    const childSitemapCount = (input.sitemapText.match(/<sitemap\b/gi) ?? []).length;
    const isIndex = /<sitemapindex\b/i.test(input.sitemapText);
    add("sitemap-detected", "XML sitemap detected",
      isIndex
        ? `The sitemap index returned HTTP 200 and lists ${childSitemapCount} child sitemap entry/entries in the fetched XML.`
        : `The sitemap returned HTTP 200 and contains ${urlCount} URL entry/entries in the fetched XML.`,
      "Confirm the sitemap includes preferred canonical URLs and excludes redirected, noindex, or non-canonical pages. This is a lightweight sample, not a complete sitemap validation.");
  } else {
    add("sitemap-not-confirmed", "XML sitemap was not confirmed",
      input.sitemapStatus === null ? "The sitemap request could not be completed within the audit's limited discovery check." : `The sitemap check returned HTTP ${input.sitemapStatus} or did not contain a recognized XML sitemap root.`,
      "Check the sitemap URL listed in robots.txt or the site's documented sitemap location. A sitemap is useful but its absence is not automatically an SEO error.");
  }
  return findings;
}
