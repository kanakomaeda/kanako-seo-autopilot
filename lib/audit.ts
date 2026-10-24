export type Severity = "critical" | "warning" | "info";
export type Finding = { id: string; title: string; severity: Severity; detail: string; recommendation: string };
export type AuditInput = { title: string; description: string; h1Count: number; wordCount: number; canonical: boolean; robotsNoindex: boolean; viewport: boolean; lang: boolean; imageCount: number; imagesWithoutAlt: number; scriptCount: number; structuredData: boolean };
export type AuditResult = AuditInput & { score: number; coverage: number; limitedEvidence: boolean; findings: Finding[]; scoreLabel: "Initial HTML checks score" | "Rendered page checks score" };

export function scoreFindings(findings: Finding[]): number {
  const penalty: Record<Severity, number> = { critical: 12, warning: 4, info: 0 };
  return Math.max(0, Math.min(100, 100 - findings.reduce((sum, finding) => sum + penalty[finding.severity], 0)));
}

export function analyzeHtml(html: string, rendered = false): AuditResult {
  const sourceLabel = rendered ? "rendered page" : "initial HTML";
  const getTag = (tag: string) => html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "i"))?.[1] ?? "";
  const title = getTag("title").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
  const description = html.match(/<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*>/i)?.[1]
    ?? html.match(/<meta\b[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*\bname\s*=\s*["']description["'][^>]*>/i)?.[1] ?? "";
  const textOnly = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&");
  const words = textOnly.trim().split(/\s+/).filter(Boolean);
  const h1Count = (html.match(/<h1\b/gi) ?? []).length;
  const images = html.match(/<img\b[^>]*>/gi) ?? [];
  const scripts = html.match(/<script\b/gi) ?? [];
  const canonical = /<link\b[^>]*rel\s*=\s*["']canonical["']/i.test(html);
  const robotsNoindex = /<meta\b[^>]*name\s*=\s*["']robots["'][^>]*content\s*=\s*["'][^"']*noindex/i.test(html);
  const viewport = /<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(html);
  const lang = /<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i.test(html);
  const structuredData = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["']/i.test(html);
  const imagesWithoutAlt = images.filter(img => !/\balt\s*=\s*["'][^"']*["']/i.test(img)).length;
  const limitedEvidence = words.length < 35 && scripts.length >= 2;
  const findings: Finding[] = [];
  const add = (id: string, title: string, severity: Severity, detail: string, recommendation: string) => findings.push({ id, title, severity, detail, recommendation });
  if (!title) add("title-missing", "Missing title tag", "critical", `No title was found in the ${sourceLabel}.`, "Add a unique, descriptive title in the page HTML.");
  else if (title.length < 15 || title.length > 60) add("title-length", "Review title length", "warning", `Title contains ${title.length} characters.`, "Review whether the title is concise, descriptive, and useful in search results.");
  if (!description) add("description-missing", "Missing meta description", "warning", `No meta description was found in the ${sourceLabel}.`, "Consider adding a relevant summary for search-result snippets.");
  if (h1Count === 0) add("h1-missing", "No H1 found", limitedEvidence ? "info" : "warning", limitedEvidence ? `No H1 was found in the ${sourceLabel}.` : `No H1 heading was found in the ${sourceLabel}.`, rendered ? "Confirm that the page has a clear main heading in its rendered content." : "Verify the rendered page and use a clear main heading.");
  if (h1Count > 1) add("h1-multiple", "Multiple H1 headings", "info", `Found ${h1Count} H1 headings.`, "Check that heading hierarchy clearly communicates the page's main topic.");
  if (words.length < 35) add("content-sparse", rendered ? "Little readable text in rendered page" : "Little readable text in initial HTML", limitedEvidence ? "info" : "warning", `Only about ${words.length} words were extracted from the ${sourceLabel}.`, rendered ? "Confirm whether important content requires interaction or additional loading." : "Verify the rendered page before concluding that content is missing.");
  if (!canonical) add("canonical-missing", "Canonical tag not found", "info", `No canonical link was found in the ${sourceLabel}.`, "Add a canonical URL when the page needs an explicit preferred URL.");
  if (!viewport) add("viewport-missing", "Viewport meta tag not found", "warning", `Mobile viewport metadata was not found in the ${sourceLabel}.`, "Add a responsive viewport meta tag.");
  if (!lang) add("lang-missing", "HTML language not declared", "warning", `The root HTML element in the ${sourceLabel} has no language attribute.`, "Set an appropriate lang attribute on the html element.");
  if (imagesWithoutAlt > 0) add("image-alt", "Images missing alt attributes", "warning", `${imagesWithoutAlt} of ${images.length} images lack an alt attribute.`, "Add useful alt text to informative images; use empty alt text for decorative images.");
  if (robotsNoindex) add("noindex", "Noindex directive detected", "critical", "A robots meta directive appears to prevent indexing.", "Confirm that blocking indexing is intentional.");
  if (limitedEvidence) add("js-shell", rendered ? "Limited evidence in rendered page" : "Limited evidence — verify rendered page", "info", `The ${sourceLabel} contains only ${words.length} words and ${scripts.length} script tags. Important content may load with JavaScript.`, rendered ? "Review whether content needs interaction, authentication, or additional loading." : "Review the page in a rendered browser before relying on missing-content or heading findings.");
  if (!structuredData) add("structured-data", "Structured data not detected", "info", `No JSON-LD structured data was found in the ${sourceLabel}.`, "Add relevant structured data only if it accurately describes the page; this is not required for every page.");
  const measured = findings.filter(f => f.severity !== "info");
  const coverage = Math.max(10, Math.min(100, Math.round(100 * (1 - (limitedEvidence ? 0.45 : 0) - (words.length < 10 ? 0.2 : 0)))));
  return { title, description, h1Count, wordCount: words.length, canonical, robotsNoindex, viewport, lang, imageCount: images.length, imagesWithoutAlt, scriptCount: scripts.length, structuredData, score: scoreFindings(measured), coverage, limitedEvidence, findings, scoreLabel: rendered ? "Rendered page checks score" : "Initial HTML checks score" };
}
