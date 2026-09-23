---
name: run-scan
description: Runs the daily Job scrapper pipeline (collect → filter → details → AI score) and summarises what's new and worth applying to. Use when the user says "scan", "any new jobs?", "run the scrapper".
---

# Run a scan and report

1. `npm run check` — stop and explain if the profile or the AI key is broken.
2. `npm run scan` (add `-- --source a,b` or `-- --days N` only if the user asks). It can take a few minutes; let it finish.
3. Read the output and report, in the user's language:
   - sources: how many offers each returned, which failed and why (one line each; suggest the `source-doctor` agent for real errors, not for missing keys);
   - funnel: collected → new → kept by the filter → scored → at the keep threshold;
   - AI cost line (tokens, provider) as printed;
   - the best new offers: read `data/offers.json` with a node one-liner and list the offers scored in this run at or above `scoring.keepThreshold`, best first — title, company, city, score, one-line reason, URL. Ten at most.
4. Finish with: `npm run view` to go through them.

Never paste the whole `offers.json`; never print environment variables.
