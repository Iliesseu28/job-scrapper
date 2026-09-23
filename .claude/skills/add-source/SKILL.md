---
name: add-source
description: Adds a new job source (API, ATS, RSS feed or job site) to Job scrapper — collector, registry entry, profile settings, test and README row. Use when the user asks to scrape a site or plug in an API that isn't in the sources table yet.
---

# Add a job source

Before anything: can it be done **without code**?
- a company career page on a supported ATS → add it to `profile/companies.yaml`;
- an RSS/Atom feed → `rss.feeds` in `profile/sources.yaml`;
- a board with a public JSON list → `boards.list` in `profile/sources.yaml`.

If yes, do that and stop.

Otherwise:

1. **Check you may.** Prefer an official API. For a website, read its `robots.txt` and terms of use; if scraping is forbidden, or the site uses bot protection (Cloudflare challenge, DataDome, captcha), stop and tell the user. Never add a bypass.
2. **Look at one real response** with `curl -s` (JSON endpoint, or a result page and one offer page). Prefer schema.org `JobPosting` blocks when the site has them (`collecteParJobPosting` in `_shared.mjs` does most of the work).
3. **Write the collector** in `scraping/sources/<id>.mjs`, modelled on a similar one (`jooble.mjs` for a keyed API, `jobs-lu.mjs` for HTML with JSON-LD, `jobroom-ch.mjs` for a paginated public API):
   - signature `(http, options) → Promise<Offer[]>`, all network calls through the injected `http`;
   - respect the collection window (`fenetreCollecte`, `horsFenetre`, `pageEpuisee`) so daily runs only read new offers;
   - cap pages, pause between requests, return `[]` (not throw) when a key is missing.
4. **Export it** from `scraping/sources/index.mjs`.
5. **Register it** in `scraping/registry.mjs`: `id`, `label`, `region`, `kind` (`api` | `ats` | `feed` | `site-api` | `html`), `keys` (env variable names), `note`, and `run(http, ctx)` that maps the English settings of `profile/sources.yaml` to the collector options.
6. **Keys** → add them to `.env.example` with a comment saying where to get them.
7. **Test** → `tests/sources/<id>.test.mjs` with a small fixture and a fake `http`; no network in tests.
8. **README** → add a row to the sources table, id in backticks (a test checks every registry id is documented).
9. `npm test`, then `npm run collect -- --source <id> --days 7` for a real check.
