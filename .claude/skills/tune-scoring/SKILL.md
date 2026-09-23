---
name: tune-scoring
description: Adjusts how the AI scores offers — the scale, the rules, cost settings, provider and model — by editing profile/scoring-rules.md, profile/profile.md and the scoring block of criteria.yaml. Use when scores feel too generous, too harsh, or too expensive.
---

# Tune the AI scoring

The LLM sees, for each batch: `profile/profile.md` + `profile/scoring-rules.md` (a stable prefix, cached by the providers that support it) then the offers. Code in `scoring/score.mjs` does not need to change.

1. **Find the problem with examples.** Pick 5–10 offers from `data/offers.json` whose score the user disagrees with (ask, or use the ones they hid/saved in `data/decisions.json`). Put the score, the reasons and the user's opinion side by side.
2. **Fix the cause, in the right file:**
   - the model misunderstands who the user is → `profile/profile.md` (a missing strength, a refusal not written down);
   - the scale is applied inconsistently → `profile/scoring-rules.md` (add a rule with a concrete example, e.g. "a sales role with an AI product is 2 at most");
   - offers that should never reach the AI → it's a filter problem: use the `filter-tuner` agent instead.
3. **Re-score only the examples** to check: `npm run score -- --keys <key1,key2,…>` (each offer's `key` field in `data/offers.json`). Compare before/after.
4. **Cost knobs** (`criteria.yaml → scoring`): `maxPerRun`, `batchSize`, `descriptionChars`, `detailsThreshold`, `maxAgeDays`. Say the expected effect on tokens before changing them.
5. **Provider / model**: set `AI_PROVIDER` and `AI_MODEL` in `.env` — the user does it, you only name the values (`gemini`, `anthropic`, `openai`, `mistral`, `groq`, `deepseek`, `openrouter`, `ollama`, `custom` + `AI_BASE_URL`).

Report the change and its measured effect on the examples.
