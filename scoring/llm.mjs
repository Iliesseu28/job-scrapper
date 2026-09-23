// ============================================================================
// LLM — one function to call any provider with a plain API key.
//
//   AI_PROVIDER = gemini | anthropic | openai | mistral | groq | deepseek | openrouter | ollama | custom
//   AI_API_KEY  = the provider's key (not needed for ollama)
//   AI_MODEL    = optional; a sensible default per provider
//   AI_BASE_URL = only for "custom" (any OpenAI-compatible endpoint)
//
// call({ system, user, schema, maxTokens }) → { text, usage }
//   · `system` is the stable part (profile + scoring rules). It is sent first and
//     byte-for-byte identical on every call, so providers can cache it:
//     implicit caching on Gemini / OpenAI, an explicit cache_control on Anthropic.
//   · `schema` (Gemini dialect) is enforced where the provider supports it; the
//     others get JSON mode + the format written in the prompt.
//   · usage = { calls, input, cached, output, thinking, total } — for the run log.
// Retries on 429 / 5xx with a growing pause.
// ============================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OPENAI_COMPATIBLE = {
  openai: { base: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  mistral: { base: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  groq: { base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  deepseek: { base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openrouter: { base: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash' },
  ollama: { base: 'http://localhost:11434/v1', model: 'llama3.1' },
  custom: { base: '', model: '' },
};
const DEFAULT_MODEL = { gemini: 'gemini-2.5-flash', anthropic: 'claude-haiku-4-5', ...Object.fromEntries(Object.entries(OPENAI_COMPATIBLE).map(([k, v]) => [k, v.model])) };
export const PROVIDERS = ['gemini', 'anthropic', ...Object.keys(OPENAI_COMPATIBLE)];

/** Reads the provider settings from the environment. Throws a readable error when incomplete. */
export function llmSettings(env) {
  const provider = String(env.AI_PROVIDER || '').trim().toLowerCase();
  if (!provider) throw new Error('AI_PROVIDER is not set in .env (gemini, anthropic, openai, mistral, groq, deepseek, openrouter, ollama or custom)');
  if (!PROVIDERS.includes(provider)) throw new Error(`AI_PROVIDER "${provider}" is unknown — use one of: ${PROVIDERS.join(', ')}`);
  const apiKey = String(env.AI_API_KEY || '').trim();
  if (!apiKey && provider !== 'ollama') throw new Error(`AI_API_KEY is empty in .env (the ${provider} key)`);
  const model = String(env.AI_MODEL || '').trim() || DEFAULT_MODEL[provider];
  if (!model) throw new Error('AI_MODEL is required with AI_PROVIDER=custom');
  const base = provider === 'custom' ? String(env.AI_BASE_URL || '').trim() : (OPENAI_COMPATIBLE[provider] || {}).base;
  if (provider === 'custom' && !base) throw new Error('AI_BASE_URL is required with AI_PROVIDER=custom');
  return { provider, apiKey, model, base: base ? base.replace(/\/+$/, '') : null };
}

export const emptyUsage = () => ({ calls: 0, input: 0, cached: 0, output: 0, thinking: 0, total: 0 });
export function addUsage(u, x) {
  u.calls += 1;
  for (const k of ['input', 'cached', 'output', 'thinking', 'total']) u[k] += x[k] || 0;
  return u;
}

// --- One request per provider family ---------------------------------------------------
async function callGemini(http, s, { system, user, schema, maxTokens, thinkingOff, timeout }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.2, maxOutputTokens: maxTokens, responseMimeType: 'application/json',
      ...(schema ? { responseSchema: schema } : {}),
      // Scoring with an explicit grid needs no "thinking": those tokens are billed as output.
      ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  };
  const d = await http({ method: 'POST', url, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.apiKey }, body, timeout });
  const text = ((d && d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || []).map((p) => p.text || '').join('');
  const m = (d && d.usageMetadata) || {};
  return { text, usage: { input: m.promptTokenCount, cached: m.cachedContentTokenCount, output: m.candidatesTokenCount, thinking: m.thoughtsTokenCount, total: m.totalTokenCount } };
}

async function callAnthropic(http, s, { system, user, maxTokens, timeout }) {
  const body = {
    model: s.model, max_tokens: maxTokens, temperature: 0.2,
    // The stable prefix is marked cacheable: later calls read it at a fraction of the price.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  };
  const d = await http({
    method: 'POST', url: 'https://api.anthropic.com/v1/messages', body, timeout,
    headers: { 'Content-Type': 'application/json', 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01' },
  });
  const text = ((d && d.content) || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const u = (d && d.usage) || {};
  const input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  return { text, usage: { input, cached: u.cache_read_input_tokens || 0, output: u.output_tokens || 0, total: input + (u.output_tokens || 0) } };
}

async function callOpenAICompatible(http, s, { system, user, maxTokens, timeout, noTemperature }) {
  const body = {
    model: s.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
    ...(s.provider === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    ...(noTemperature ? {} : { temperature: 0.2 }),
  };
  const headers = { 'Content-Type': 'application/json' };
  if (s.apiKey) headers.Authorization = 'Bearer ' + s.apiKey;
  const d = await http({ method: 'POST', url: s.base + '/chat/completions', headers, body, timeout });
  const text = (d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
  const u = (d && d.usage) || {};
  return {
    text,
    usage: {
      input: u.prompt_tokens, output: u.completion_tokens, total: u.total_tokens,
      cached: (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || u.prompt_cache_hit_tokens || 0,
      thinking: (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0,
    },
  };
}

/** Creates the client. `http` is the shared HTTP function (scraping/http.mjs). */
export function createLLM(http, env, { timeout = 90000 } = {}) {
  const s = llmSettings(env);
  const state = { thinkingOff: true, noTemperature: false };
  async function call({ system, user, schema = null, maxTokens = 8192 }) {
    let lastError;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const args = { system, user, schema, maxTokens, timeout, thinkingOff: state.thinkingOff, noTemperature: state.noTemperature };
        if (s.provider === 'gemini') return await callGemini(http, s, args);
        if (s.provider === 'anthropic') return await callAnthropic(http, s, args);
        return await callOpenAICompatible(http, s, args);
      } catch (e) {
        lastError = e;
        const msg = String(e.message || e);
        const code = Number((msg.match(/HTTP (\d{3})/) || [])[1]) || 0;
        // Some models refuse a setting instead of ignoring it: drop it once and retry.
        if (code === 400 && /thinking/i.test(msg) && state.thinkingOff) { state.thinkingOff = false; continue; }
        if (code === 400 && /temperature/i.test(msg) && !state.noTemperature) { state.noTemperature = true; continue; }
        if (!(code === 429 || code >= 500) || attempt === 4) throw e;
        await sleep(attempt * 8000);
      }
    }
    throw lastError;
  }
  return { ...s, call };
}

/**
 * Reads the model's JSON answer. Accepts { "results": [...] }, a bare array, or —
 * when the answer was cut — every complete object that can still be read.
 */
export function readResults(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const pick = (j) => (Array.isArray(j) ? j : j && Array.isArray(j.results) ? j.results : null);
  try { const r = pick(JSON.parse(t)); if (r) return r; } catch { /* keep trying */ }
  for (const m of [t.match(/\{[\s\S]*\}/), t.match(/\[[\s\S]*\]/)]) {
    if (!m) continue;
    try { const r = pick(JSON.parse(m[0])); if (r) return r; } catch { /* keep trying */ }
  }
  const objects = [];
  for (const b of t.match(/\{[^{}]*\}/g) || []) { try { objects.push(JSON.parse(b)); } catch { /* cut */ } }
  if (objects.length) return objects;
  throw new Error('unreadable AI answer: ' + t.slice(0, 200));
}
