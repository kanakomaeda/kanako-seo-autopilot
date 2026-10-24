export type Severity = "critical" | "warning" | "info";
export type Finding = { id: string; title: string; severity: Severity; detail: string; recommendation: string };
export type AuditInput = { title: string; description: string; h1Count: number; wordCount: number; canonical: boolean; robotsNoindex: boolean; viewport: boolean; lang: boolean; imageCount: number; imagesWithoutAlt: number; scriptCount: number; structuredData: boolean; canonicalUrl: string; metaRobots: string; headingsWithoutText: number; linksCount: number; linksWithoutHref: number };
export type AuditResult = AuditInput & { score: number | null; coverage: number; limitedEvidence: boolean; findings: Finding[]; scoreLabel: "Initial HTML checks score" };

export function scoreFindings(findings: Finding[]): number {
  const penalty: Record<Severity, number> = { critical: 12, warning: 4, info: 0 };
  return Math.max(0, Math.min(100, 100 - findings.reduce((sum, finding) => sum + penalty[finding.severity], 0)));
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag))) result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  return result;
}
function decodeEntities(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}
export function analyzeHtml(html: string): AuditResult {
  const tags = (name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];
  const firstTag = (name: string) => tags(name)[0] ?? "";
  const meta = tags("meta").map(attributes);
  const links = tags("link").map(attributes);
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title = decodeEntities((titleMatch?.[1] ?? "").replace(/<[^>]+>/g, "")).trim();
  const description = meta.find(m => (m.name ?? "").toLowerCase() === "description")?.content?.trim() ?? "";
  const textOnly = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  const words = decodeEntities(textOnly).trim().split(/\s+/).filter(Boolean);
  const h1Tags = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1\s*>/gi) ?? [];
  const h1Count = h1Tags.length;
  const headingsWithoutText = h1Tags.filter(h => !h.replace(/<[^>]+>/g, "").trim()).length;
  const images = tags("img").map(attributes);
  const scripts = tags("script");
  const canonicalLink = links.find(l => (l.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  const canonicalUrl = canonicalLink?.href ?? "";
  const robots = meta.filter(m => (m.name ?? "").toLowerCase() === "robots" || (m.name ?? "").toLowerCase() === "googlebot")
    .map(m => m.content ?? "").join(", ").toLowerCase();
  const robotsNoindex = /(?:^|[\s,])noindex(?:$|[\s,])/i.test(robots);
  const viewport = meta.some(m => (m.name ?? "").toLowerCase() === "viewport");
  const htmlTag = firstTag("html");
  const lang = Boolean(attributes(htmlTag).lang?.trim());
  const structuredData = scripts.some(s => /\btype\s*=\s*["']application\/ld\+json["']/i.test(s));
  const imagesWithoutAlt = images.filter(img => !Object.prototype.hasOwnProperty.call(img, "alt")).length;
  const anchors = tags("a").map(attributes);
  const limitedEvidence = words.length < 35 && scripts.length >= 2;
  const findings: Finding[] = [];
  const add = (id: string, title: string, severity: Severity, detail: string, recommendation: string) => findings.push({ id, title, severity, detail, recommendation });
  if (!title) add("title-missing", "Missing title tag", "critical", "No title was found in the initial HTML.", "Add a unique, descriptive title in the page HTML.");
  else if (title.length < 15 || title.length > 60) add("title-length", "Review title length", "warning", `Title contains ${title.length} characters; length alone does not determine ranking.`, "Review whether the title is concise, descriptive, and useful to searchers.");
  if (!description) add("description-missing", "Missing meta description", "warning", "No meta description was found in the initial HTML.", "Consider adding an accurate page summary; search engines may generate a different snippet.");
  if (h1Count === 0) add("h1-missing", "No H1 found", limitedEvidence ? "info" : "warning", limitedEvidence ? "No H1 was found in initial HTML; the rendered page may add it with JavaScript." : "No H1 heading was found in the initial HTML.", "Verify the rendered page and use a clear main heading where appropriate.");
  if (headingsWithoutText > 0) add("heading-empty", "Empty H1 heading", "warning", `${headingsWithoutText} H1 heading(s) contain no readable text in the fetched HTML.`, "Add meaningful heading text or remove empty heading elements.");
  if (h1Count > 1) add("h1-multiple", "Multiple H1 headings", "info", `Found ${h1Count} H1 headings. Multiple H1s are not automatically an SEO error.`, "Check that the heading hierarchy clearly communicates the page's main topic.");
  if (words.length < 35) add("content-sparse", "Little readable text in initial HTML", limitedEvidence ? "info" : "warning", `Only about ${words.length} words were extracted from the initial HTML.`, "Verify the rendered page before concluding that content is missing.");
  if (!canonicalLink) add("canonical-missing", "Canonical tag not found", "info", "No canonical link was found in the initial HTML; not every page needs one.", "Add a canonical URL when the page has duplicate or preferred-URL considerations.");
  if (!viewport) add("viewport-missing", "Viewport meta tag not found", "warning", "Mobile viewport metadata was not found.", "Add a responsive viewport meta tag.");
  if (!lang) add("lang-missing", "HTML language not declared", "warning", "The root HTML element has no language attribute.", "Set an appropriate BCP 47 lang attribute on the html element.");
  if (imagesWithoutAlt > 0) add("image-alt", "Images missing alt attributes", "warning", `${imagesWithoutAlt} of ${images.length} images lack an alt attribute. Empty alt is valid for decorative images.`, "Add useful alt text to informative images; use alt=\"\" for decorative images.");
  if (robotsNoindex) add("noindex", "Noindex directive detected", "critical", `The page's meta robots directives include noindex (${robots}).`, "Confirm that preventing indexing is intentional. This audit checks the fetched page response, not whether search engines have indexed it.");
  if (limitedEvidence) add("js-shell", "Limited evidence — verify rendered page", "info", `Initial HTML contains only ${words.length} words and ${scripts.length} script tags. Important content may load with JavaScript.`, "Review the page in a rendered browser before relying on missing-content or heading findings.");
  if (!structuredData) add("structured-data", "Structured data not detected", "info", "No JSON-LD structured data was found in the initial HTML; structured data is not required on every page.", "Add relevant structured data only when it accurately describes visible page content and meets search engine guidelines.");
  if (anchors.some(a => !a.href?.trim())) add("link-href-missing", "Link without href", "warning", `${anchors.filter(a => !a.href?.trim()).length} anchor element(s) have no href attribute in the initial HTML.`, "Use real links with valid destinations for navigation; use buttons for actions.");
  const measured = findings.filter(f => f.severity !== "info");
  const coverage = Math.max(10, Math.min(100, Math.round(100 * (1 - (limitedEvidence ? 0.45 : 0) - (words.length < 10 ? 0.2 : 0)))));
  return {
    title, description, h1Count, wordCount: words.length, canonical: Boolean(canonicalLink), canonicalUrl,
    robotsNoindex, metaRobots: robots, viewport, lang, imageCount: images.length, imagesWithoutAlt,
    scriptCount: scripts.length, structuredData, headingsWithoutText, linksCount: anchors.length,
    linksWithoutHref: anchors.filter(a => !a.href?.trim()).length, score: limitedEvidence ? null : scoreFindings(measured), coverage,
    limitedEvidence, findings, scoreLabel: "Initial HTML checks score",
  };
}
