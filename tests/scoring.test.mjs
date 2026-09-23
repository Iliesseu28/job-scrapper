import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readResults, llmSettings, createLLM } from '../scoring/llm.mjs';
import { scoreOffers, group } from '../scoring/score.mjs';

const ctx = {
  texts: { profile: 'PROFILE', rules: 'RULES' },
  scoring: { batchSize: 12, detailsThreshold: 3.5, descriptionChars: 500, outputLanguage: 'English', strategy: 'single-pass', pauseMs: 0 },
};

/** A fake model: scores each offer by the number in its title, and records every call. */
function fakeLLM() {
  const calls = [];
  return {
    calls,
    call: async ({ system, user }) => {
      calls.push({ system, user });
      const offers = [...user.matchAll(/--- OFFER (\d+) ---\nTitle: [^\n]*?(\d(?:\.\d)?)\/5/g)];
      const results = offers.map(([, i, s]) => ({ i: Number(i), score: Number(s), verdict: 'apply', reason: 'r', company_type: 'startup', employer_type: 'direct', summary: 'S', pros: '- p', cons: '- c' }));
      return { text: JSON.stringify({ results }), usage: { input: 100, cached: 50, output: 20, total: 120 } };
    },
  };
}
const o = (key, title, extra = {}) => ({ key, title, company: 'Acme', source_name: 'ats', description: 'desc', ...extra });

test('readResults accepts an object, a bare array, fenced JSON and a cut answer', () => {
  assert.deepEqual(readResults('{"results":[{"i":0}]}'), [{ i: 0 }]);
  assert.deepEqual(readResults('[{"i":1}]'), [{ i: 1 }]);
  assert.deepEqual(readResults('```json\n{"results":[{"i":2}]}\n```'), [{ i: 2 }]);
  assert.deepEqual(readResults('{"results":[{"i":0,"score":4},{"i":1,"sco'), [{ i: 0, score: 4 }]);
  assert.throws(() => readResults('no json here'), /unreadable/);
});

test('llmSettings explains what is missing', () => {
  assert.throws(() => llmSettings({}), /AI_PROVIDER is not set/);
  assert.throws(() => llmSettings({ AI_PROVIDER: 'gemini' }), /AI_API_KEY is empty/);
  assert.throws(() => llmSettings({ AI_PROVIDER: 'nope', AI_API_KEY: 'x' }), /unknown/);
  assert.equal(llmSettings({ AI_PROVIDER: 'ollama' }).base, 'http://localhost:11434/v1');
  assert.throws(() => llmSettings({ AI_PROVIDER: 'custom', AI_API_KEY: 'x', AI_MODEL: 'm' }), /AI_BASE_URL/);
});

test('each provider gets its own request shape, and the stable prefix goes in the system part', async () => {
  const seen = [];
  const http = async (req) => {
    seen.push(req);
    if (req.url.includes('generativelanguage')) return { candidates: [{ content: { parts: [{ text: '{"results":[]}' }] } }], usageMetadata: { promptTokenCount: 10 } };
    if (req.url.includes('anthropic')) return { content: [{ type: 'text', text: '{"results":[]}' }], usage: { input_tokens: 5, cache_read_input_tokens: 5, output_tokens: 1 } };
    return { choices: [{ message: { content: '{"results":[]}' } }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } };
  };
  await createLLM(http, { AI_PROVIDER: 'gemini', AI_API_KEY: 'k' }).call({ system: 'SYS', user: 'U' });
  const a = await createLLM(http, { AI_PROVIDER: 'anthropic', AI_API_KEY: 'k' }).call({ system: 'SYS', user: 'U' });
  await createLLM(http, { AI_PROVIDER: 'mistral', AI_API_KEY: 'k' }).call({ system: 'SYS', user: 'U' });
  assert.equal(seen[0].body.systemInstruction.parts[0].text, 'SYS');
  assert.equal(seen[1].body.system[0].cache_control.type, 'ephemeral');
  assert.equal(a.usage.cached, 5);
  assert.equal(seen[2].body.messages[0].content, 'SYS');
  assert.equal(seen[2].body.response_format.type, 'json_object');
});

test('twins (same company + title) are scored once and inherit the score', async () => {
  const llm = fakeLLM();
  const offers = [o('a', 'AI Engineer 4.5/5', { city: 'Paris' }), o('b', 'AI Engineer 4.5/5', { city: 'Lyon' }), o('c', 'Data Clerk 1/5')];
  assert.equal(group(offers).representatives.length, 2);
  const r = await scoreOffers(llm, ctx, offers);
  assert.equal(llm.calls.length, 1);
  assert.equal(r.stats.copied, 1);
  assert.deepEqual(r.results.map((x) => x.ai_score), [4.5, 4.5, 1]);
  assert.equal(r.results[1].ai_reasons.copied_from, 'a');
});

test('details are kept only at or above the threshold', async () => {
  const r = await scoreOffers(fakeLLM(), ctx, [o('a', 'Good 4/5'), o('b', 'Weak 2/5')]);
  assert.equal(r.results[0].ai_reasons.summary, 'S');
  assert.equal(r.results[1].ai_reasons.summary, undefined);
  assert.equal(r.stats.detailed, 1);
});

test('offers are sent in batches and the profile is identical on every call (cacheable)', async () => {
  const llm = fakeLLM();
  const offers = Array.from({ length: 30 }, (_, i) => o('k' + i, `Job ${i} 3/5`, { company: 'C' + i }));
  const r = await scoreOffers(llm, ctx, offers);
  assert.equal(llm.calls.length, 3);
  assert.ok(llm.calls.every((c) => c.system === llm.calls[0].system));
  assert.equal(r.usage.total.cached, 150);
});

test('a failed batch is reported and does not stop the others', async () => {
  let n = 0;
  const flaky = { call: async (args) => { if (n++ === 0) throw new Error('HTTP 400 bad'); return fakeLLM().call(args); } };
  const errors = [];
  const offers = Array.from({ length: 13 }, (_, i) => o('k' + i, `Job ${i} 3/5`, { company: 'C' + i }));
  const r = await scoreOffers(flaky, ctx, offers, { onError: (e) => errors.push(e.message) });
  assert.equal(errors.length, 1);
  assert.equal(r.stats.errors, 12);
  assert.equal(r.results[12].ai_status, 'scored');
});
