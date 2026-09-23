---
name: setup-profile
description: First-time setup of Job scrapper for a new user — install, .env, profile from a CV or a description, first collection. Use when someone just cloned the repo or says "set this up for me".
---

# Set up Job scrapper for a new user

Goal: from a fresh clone to a first list of scored offers in the viewer, without editing any code.

1. **Install** — `node --version` (needs ≥ 20), then `npm install`.
2. **Keys** — if `.env` doesn't exist, copy it: `cp .env.example .env`. You must not read or edit `.env` (a hook blocks it). Tell the user which lines to fill in:
   - one AI provider: `AI_PROVIDER` + `AI_API_KEY` (Gemini has a free tier: aistudio.google.com/apikey);
   - optional free source keys: Adzuna, France Travail, Jooble (links in the README).
3. **Profile** — hand over to the `profile-coach` agent with what the user gave you (CV text, LinkedIn summary, or their answers). It writes `profile/`.
4. **Check** — `npm run check` must print "profile/ is valid" and the AI provider. `npm run sources` shows which sources will run and which are skipped (missing key, disabled).
5. **First run, no AI** — `npm run collect -- --days 7`. Read the per-source log and the number kept. If fewer than ~10 offers are kept, run the `filter-tuner` agent before scoring.
6. **Score a small batch** — `npm run score -- --limit 30`, check the cost line, then `npm run scan` for the full run.
7. **Look at the results** — `npm run view`, open http://localhost:4321.

End with the daily routine: `npm run scan` then `npm run view` (or a cron / Task Scheduler entry running `npm run scan`).
