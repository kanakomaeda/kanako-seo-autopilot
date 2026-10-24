# Kanako SEO AutoPilot

A lightweight, evidence-aware SEO audit app.

## What it does
- Fetches a public page's initial HTML and checks on-page SEO signals.
- Reports an **Initial HTML checks score**, not a ranking prediction or a complete SEO score.
- Withholds the numerical score when the initial HTML provides too little evidence.
- Separates evidence coverage from the score and flags JavaScript-heavy pages where initial HTML may be incomplete.
- Checks titles, descriptions, headings, canonical hints, viewport/language declarations, image alt attributes, robots noindex, and JSON-LD structured data.
- Adds social preview checks for Open Graph and Twitter/X card metadata.
- Performs bounded, same-host discovery checks for robots.txt and sitemap.xml, including sitemap-index and root Disallow observations.
- Summarizes same-host and external links, qualified links (nofollow/sponsored/ugc), safer new-tab link attributes, hreflang alternates, and suspicious cross-host canonical URLs.
- Informational findings do not reduce the score.
- Suggestions only: it never edits the audited website.

## Important limitations
This version audits one URL's fetched initial HTML. It does not yet run a rendered browser, crawl an entire site, verify every redirect, measure Core Web Vitals, query Google Search Console, or check live indexing/backlink data. Robots and sitemap discovery is a lightweight check, not exhaustive validation. JavaScript-heavy page findings remain provisional until rendered-page verification. No rankings are guaranteed.

## Run locally
Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Checks
```bash
npm test
npm run lint
npm run build
```

## Security notes
The API accepts public HTTP(S) URLs only, rejects private/reserved IP ranges, pins the request to a validated address, does not follow redirects, applies a timeout, limits downloaded HTML, and rate-limits audit requests. Never commit API tokens or production secrets to the repository.
