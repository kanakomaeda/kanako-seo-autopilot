import type { Finding } from "./audit";

function readAttributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([\\w:-]+)\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag))) result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  return result;
}

function metaValue(html: string, key: string, attribute: "name" | "property" = "property"): string {
  const tags = html.match(/<meta\\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const attrs = readAttributes(tag);
    if ((attrs[attribute] ?? "").toLowerCase() === key.toLowerCase()) return (attrs.content ?? "").trim();
  }
  return "";
}

export function analyzeAdvancedHtml(html: string, pageUrl: string): Finding[] {
  const findings: Finding[] = [];
  const add = (id: string, title: string, detail: string, recommendation: string) =>
    findings.push({ id, title, severity: "info", detail, recommendation });

  const ogTitle = metaValue(html, "og:title");
  const ogDescription = metaValue(html, "og:description");
  const ogImage = metaValue(html, "og:image");
  const twitterCard = metaValue(html, "twitter:card", "name");
  const socialMissing = [
    !ogTitle && "Open Graph title",
    !ogDescription && "Open Graph description",
    !ogImage && "Open Graph image",
  ].filter(Boolean) as string[];
  if (socialMissing.length) {
    add("social-preview-metadata", "Social sharing metadata incomplete",
      `Missing ${socialMissing.join(", ")} in the initial HTML.`,
      "Add accurate Open Graph title, description, and image metadata to improve link previews on supported social platforms. These are not direct ranking factors.");
  }
  if (!twitterCard) {
    add("twitter-card-missing", "Twitter/X card metadata not detected",
      "No twitter:card meta tag was found in the initial HTML.",
      "Consider adding twitter:card and verify the final link preview; some platforms may fall back to Open Graph metadata.");
  }

  let hostname = "";
  try { hostname = new URL(pageUrl).hostname.toLowerCase(); } catch { /* caller validates the URL */ }
  const anchors = (html.match(/<a\\b[^>]*>/gi) ?? []).map(readAttributes);
  let internal = 0;
  let external = 0;
  let relative = 0;
  let nofollow = 0;
  let unsafeBlank = 0;
  for (const anchor of anchors) {
    const href = (anchor.href ?? "").trim();
    if (!href) continue;
    const rel = (anchor.rel ?? "").toLowerCase().split(/\\s+/);
    if (rel.includes("nofollow") || rel.includes("sponsored") || rel.includes("ugc")) nofollow++;
    if ((anchor.target ?? "").toLowerCase() === "_blank" && !rel.includes("noopener") && !rel.includes("noreferrer")) unsafeBlank++;
    if (/^(?:mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try {
      const destination = new URL(href, pageUrl);
      if (!/^https?:$/.test(destination.protocol)) continue;
      if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("//")) relative++;
      if (destination.hostname.toLowerCase() === hostname) internal++;
      else external++;
    } catch { /* invalid links are covered by the base audit where possible */ }
  }
  add("link-distribution", "Initial HTML link distribution",
    `Found ${internal} same-host link(s), ${external} external link(s), and ${relative} relative URL(s) across ${anchors.length} anchor element(s). Counts only reflect fetched HTML, not rendered links.`,
    "Review whether important pages are reachable through descriptive internal links and ensure external destinations are relevant. This count is informational, not a target or ranking score.");
  if (nofollow) {
    add("nofollow-links", "Qualified outbound or user-generated links detected",
      `${nofollow} link(s) include rel=nofollow, sponsored, or ugc in the initial HTML.`,
      "Confirm link qualification is intentional. These attributes can be appropriate for paid links and untrusted user-generated content.");
  }
  if (unsafeBlank) {
    add("blank-link-rel", "New-tab links may need safer rel attributes",
      `${unsafeBlank} link(s) use target=_blank without noopener or noreferrer.`,
      "Consider rel=\"noopener\" for links opening a new tab, particularly when linking to untrusted destinations.");
  }

  const hreflangLinks = (html.match(/<link\\b[^>]*>/gi) ?? []).map(readAttributes)
    .filter(attrs => (attrs.rel ?? "").toLowerCase().split(/\\s+/).includes("alternate") && Boolean(attrs.hreflang));
  if (hreflangLinks.length) {
    const invalid = hreflangLinks.filter(attrs => {
      try { return !/^https?:$/.test(new URL(attrs.href ?? "").protocol); } catch { return true; }
    }).length;
    add("hreflang-present", "Language alternates detected",
      `Found ${hreflangLinks.length} alternate link(s) with hreflang; ${invalid} have a missing or invalid absolute URL.`,
      "Verify language/region codes, reciprocal annotations, and canonical URLs for each language version.");
  }

  const canonicalTag = (html.match(/<link\\b[^>]*>/gi) ?? []).map(readAttributes)
    .find(attrs => (attrs.rel ?? "").toLowerCase().split(/\\s+/).includes("canonical"));
  if (canonicalTag?.href && hostname) {
    try {
      const canonicalHost = new URL(canonicalTag.href, pageUrl).hostname.toLowerCase();
      if (canonicalHost && canonicalHost !== hostname) {
        findings.push({
          id: "canonical-cross-host",
          title: "Canonical points to a different host",
          severity: "warning",
          detail: `The canonical URL host is ${canonicalHost}, while the audited page host is ${hostname}.`,
          recommendation: "Confirm this cross-host canonical is intentional. An incorrect canonical can cause search engines to consolidate signals to the wrong URL.",
        });
      }
    } catch {
      findings.push({
        id: "canonical-invalid",
        title: "Canonical URL appears invalid",
        severity: "warning",
        detail: "The canonical href could not be parsed as a valid URL.",
        recommendation: "Use a valid absolute canonical URL and verify it matches the preferred indexable page.",
      });
    }
  }
  return findings;
}
