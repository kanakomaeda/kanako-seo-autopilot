# Kanako SEO AutoPilot

A lightweight, evidence-aware SEO audit app.

## What it does
- Fetches a public page's initial HTML and attempts a bounded headless-Chromium render to inspect the resulting DOM.
- Uses the rendered DOM when rendering succeeds; otherwise falls back to initial HTML and preserves the low-evidence score safeguard.
- Reports an **Initial HTML checks score**, not a ranking prediction or a complete SEO score.
- Withholds the numerical score when the initial HTML provides too little evidence.
- Separates evidence coverage from the score and labels whether findings came from rendered DOM or initial HTML.
- Checks titles, descriptions, headings, canonical hints, viewport/language declarations, image alt attributes, robots noindex, and JSON-LD structured data.
- Adds social preview checks for Open Graph and Twitter/X card metadata.
- Performs bounded, same-host discovery checks for robots.txt and sitemap.xml, including sitemap-index and root Disallow observations.
- Summarizes same-host and external links, qualified links (nofollow/sponsored/ugc), safer new-tab link attributes, hreflang alternates, and suspicious cross-host canonical URLs.
- Informational findings do not reduce the score.
- Suggestions only: it never edits the audited website.

## Important limitations
This version audits one URL at a time. It attempts a bounded headless-Chromium render (short navigation/wait budgets, capped requests and HTML size) and permits same-origin browser requests only; cross-origin resources are blocked as a security precaution. Some sites may not fully render under these restrictions, so the API falls back to initial HTML and labels the evidence mode. User-interaction-driven or delayed content may still be missed. It does not crawl an entire site, verify every redirect, measure Core Web Vitals, query Google Search Console, or check live indexing/backlink data. Robots and sitemap discovery is a lightweight check, not exhaustive validation. No rankings are guaranteed.

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
The API accepts public HTTP(S) URLs only, rejects private/reserved IP ranges, pins the initial HTTP request to a validated address, limits downloaded HTML, and rate-limits audit requests. Browser rendering pins the target hostname to the validated address, restricts requests to the original origin, blocks service workers and downloads, caps resource requests, and uses bounded timeouts. Rendering can fail safely to initial-HTML mode. Never commit API tokens or production secrets to the repository.
