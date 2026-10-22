# Kanako SEO AutoPilot

A fresh, lightweight SEO audit app built independently of Lovable.

## What it does
- Fetches a public page's initial HTML and checks basic on-page SEO signals.
- Reports an **Initial HTML checks score**, not a ranking prediction or a complete SEO score.
- Separates evidence coverage from the score and flags JavaScript-heavy pages where the initial HTML may be incomplete.
- Informational findings do not reduce the score.
- Suggestions only: it never edits the audited website.

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
The API only accepts public HTTP(S) URLs, rejects private/reserved IP ranges, does not follow redirects, applies a timeout and limits downloaded HTML. This is a starter audit, not a substitute for rendered-browser analysis, Search Console, backlink data, indexing checks, or Core Web Vitals.

No API keys are required for the initial version.
