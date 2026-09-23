# Job scrapper — notes for Claude Code

Collects job offers from 32 sources, drops what obviously doesn't fit with rules from `profile/`, then asks an LLM to score the rest against the user's profile. Everything runs locally; offers live in `data/` as JSON.

## Map

| Folder | Role | Who edits it |
|---|---|---|
| `profile/` | The user's profile: who they are, what they want, which sources to read | the user (or the `profile-coach` agent) |
| `scraping/` | One collector per source (`sources/`), the registry, the collection window, HTTP | contributors |
| `scoring/` | Deterministic filter, salary parser, LLM client, AI scoring | contributors |
| `pipeline/` | Command line (`run.mjs`), config loading/validation, local JSON store | contributors |
| `viewer/` | Local web page to review offers (`npm run view`) | contributors |
| `tests/` | `node:test`, no network | contributors |

Flow: `collect` (scraping/collect.mjs) → `applyFilter` (scoring/filter.mjs) → details second pass (scraping/details.mjs) → `scoreOffers` (scoring/score.mjs) → `data/offers.json` → viewer.

## Commands

```
npm run check            validate profile/ and .env (no network)
npm run sources          which sources will run, which are skipped and why
npm run collect          collect + filter, no AI   (-- --source a,b  -- --days N)
npm run filter           re-apply the filter to stored offers (after a profile edit)
npm run score            AI scoring of kept offers  (-- --limit N  -- --rescore  -- --keys k1,k2)
npm run scan             collect → filter → details → score (the daily run)
npm run stats            totals
npm run view             http://localhost:4321
npm test                 all tests (`node --test tests/*.test.mjs tests/sources/*.test.mjs`)
```

## Rules

- **The user adapts the tool through `profile/` and `.env` only.** If a request can be met by a profile setting, do that rather than changing code. Anything new a user must be able to set goes into the YAML files with a documented default, never hard-coded.
- **Never read, print or edit `.env`** (a hook blocks it). Ask the user to fill in values; `npm run check` shows which keys are set.
- `profile/profile.md` is sent to the AI provider: no phone number, email, address or date of birth in it.
- Collectors take the injected `http` and return the common offer shape; they return `[]` when a key is missing instead of throwing.
- No bypass of bot protection (Cloudflare, DataDome, captcha) and no source whose terms forbid automated access. Sources of kind `html` stay off by default.
- A new source needs: collector + `index.mjs` export + registry entry + `.env.example` keys + test + README row (see the `add-source` skill). A test fails if a registry id is missing from the README.
- Comments and parameter names inside the older collectors are in French; new code is in English.

## Claude Code setup in this repo

- Hooks (`.claude/hooks/`): `protect-secrets.mjs` blocks access to `.env` and key-looking strings in edits; `check-after-edit.mjs` validates `profile/` after each edit and runs the tests after a code edit.
- Agents: `profile-coach` (build the profile from a CV), `source-doctor` (repair a broken source), `filter-tuner` (tune the filter from real results).
- Skills: `setup-profile`, `run-scan`, `add-source`, `tune-scoring`.
