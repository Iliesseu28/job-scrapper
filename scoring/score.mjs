// ============================================================================
// STAGE 3 — THE AI PASS
// ----------------------------------------------------------------------------
// Only sees what survived the filter. Reads the real mission of each offer and
// weighs it against the candidate's profile, following profile/scoring-rules.md.
//
// What keeps it cheap and reliable:
//   1. ONE OFFER = ONE SCORE. The same job posted in three cities or on two
//      sources is grouped by (company, title): one representative is scored,
//      the twins inherit its score.
//   2. BATCHES. 12 offers per call by default: the profile is sent once per
//      batch, not once per offer.
//   3. STABLE PREFIX. Profile + rules go in the system part, byte-for-byte
//      identical on every call, so providers can cache it.
//   4. NO THINKING. Grading against an explicit scale needs no reasoning tokens
//      (billed as output); they are switched off where the provider allows it.
//   5. DETAILS ONLY WHEN WORTH IT. Summary / pros / cons are written only for
//      offers at or above detailsThreshold. Most offers score low; nobody reads
//      three paragraphs about them.
//   6. STRICT FORMAT. A JSON schema (where supported) and a tolerant reader: a
//      cut answer still yields every complete object.
// ============================================================================
import { emptyUsage, addUsage, readResults } from './llm.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// --- Grouping: same company + same title = same offer for the AI -----------------------
const normText = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\(?\b(h\/f|f\/h|m\/f|f\/m|h\/f\/x|f\/h\/x|m\/w\/d|w\/m\/d|x\/f\/h|m\/f\/d)\b\)?/g, ' ')
  .replace(/[^a-z0-9一-鿿]+/g, ' ').trim();
export const groupKey = (o) => normText(o.company) + '|' + normText(o.title);

/** Groups by groupKey; the representative is the offer with the longest description. */
export function group(offers) {
  const groups = new Map();
  for (const o of offers) {
    const k = groupKey(o);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  }
  const representatives = [];
  for (const g of groups.values()) {
    g.sort((a, b) => (b.description || '').length - (a.description || '').length);
    representatives.push(g[0]);
  }
  return { representatives, groups };
}

export const COMPANY_TYPES = ['startup', 'scaleup', 'sme', 'large_company', 'public_sector', 'nonprofit', 'unknown'];
export const EMPLOYER_TYPES = ['direct', 'consulting', 'staffing', 'unknown'];
export const VERDICTS = ['apply', 'maybe', 'no'];
const oneOf = (v, allowed) => (allowed.includes(String(v || '')) ? String(v) : 'unknown');

// --- What the model reads ---------------------------------------------------------------
export function offerBlock(offers, descriptionChars = 1800, withScore = false) {
  return offers.map((o, i) => {
    const d = String(o.description || '').replace(/\s+/g, ' ').slice(0, descriptionChars);
    const score = withScore && o.ai_score != null ? `\nScore already given: ${o.ai_score}/5${o.ai_reasons && o.ai_reasons.reason ? ' — ' + o.ai_reasons.reason : ''}` : '';
    return `--- OFFER ${i} ---
Title: ${o.title}
Company: ${o.company || 'unknown'}
Location: ${[o.city, o.country].filter(Boolean).join(', ') || o.location || 'not given'}
Contract: ${o.contract_type || 'not given'}${o.remote ? ' | remote: ' + o.remote : ''}
Source: ${o.source_name}${o.salary ? ' | pay: ' + o.salary : o.salary_guess ? ' | pay (read in the text): ' + o.salary_guess : ''}${score}
Description: ${d || '(the source gave no description — judge on title and company, stay careful: do not go above 4.0 without a description)'}`;
  }).join('\n\n');
}

const TYPES_FORMAT = `- "company_type": ONE word among ${COMPANY_TYPES.join(' | ')} (see the rules). Does NOT change the score.
- "employer_type": ONE word among ${EMPLOYER_TYPES.join(' | ')} (see the rules). Does NOT change the score.`;

const DETAIL_WRITING = (lang) => `They are written FOR THE CANDIDATE, not for a recruiter: they are shown as-is on a card. Plain words, no formality, no empty words ("dynamic environment", "exciting mission", "major player"…). Write them in ${lang}.
  · "summary": 5 to 10 short lines (one idea per line, separated by \\n) explaining WHAT THE JOB IS day to day, linked to what the candidate already knows (their profile) rather than to the ad's vocabulary. The mission only, never the company's decor.
  · "pros": 2 to 5 bullets ("- " + \\n), the POSITIVE points of this offer for THIS candidate: remote, team size, stack, pay if known, fit with their background. Never copied keywords.
  · "cons": same format, the NEGATIVE points or the real risk of THIS offer (skill not proven, seniority, distant sector, language, contract type…), without drama and without inventing. "- none" if nothing real.`;

const SINGLE_PASS_FORMAT = (threshold, lang) => `Answer ONLY with a JSON object {"results": [...]}, one object per offer, in the SAME ORDER:
{"results":[{"i":0,"score":4.5,"verdict":"apply","reason":"...","company_type":"startup","employer_type":"direct","summary":"...","pros":"- ...\\n- ...","cons":"- ..."}]}
- "score": 0 to 5 following the scale above, one decimal allowed.
- "verdict": "apply" if score ≥ 4; "maybe" if 3 ≤ score < 4; "no" otherwise, or as soon as a rule imposes "no".
- "reason": ONE short sentence (20 words max), plain words, in ${lang}: the main reason for the score.
${TYPES_FORMAT}
- "summary", "pros", "cons": write them ONLY if the score is ≥ ${threshold}. Below ${threshold}, put exactly "" (empty string) in these three fields.
  ${DETAIL_WRITING(lang)}
No text before or after the JSON.`;

const SCORE_ONLY_FORMAT = (lang) => `Answer ONLY with a JSON object {"results": [...]}, one object per offer, in the SAME ORDER:
{"results":[{"i":0,"score":4.5,"verdict":"apply","reason":"...","company_type":"startup","employer_type":"direct"}]}
- "score": 0 to 5 following the scale above, one decimal allowed.
- "verdict": "apply" if score ≥ 4; "maybe" if 3 ≤ score < 4; "no" otherwise, or as soon as a rule imposes "no".
- "reason": ONE short sentence (20 words max), plain words, in ${lang}: the main reason for the score.
${TYPES_FORMAT}
No text before or after the JSON.`;

const DETAILS_FORMAT = (lang) => `Every offer below ALREADY has its score (shown). Do not discuss it. For each one write three texts.
  ${DETAIL_WRITING(lang)}
Answer ONLY with a JSON object {"results": [...]}, one object per offer, in the SAME ORDER:
{"results":[{"i":0,"summary":"...","pros":"- ...\\n- ...","cons":"- ..."}]}`;

// Gemini-style schemas (enforced by Gemini; the other providers rely on JSON mode + the prompt)
const wrap = (props, required) => ({ type: 'OBJECT', properties: { results: { type: 'ARRAY', items: { type: 'OBJECT', properties: props, required } } }, required: ['results'] });
const SCORE_PROPS = {
  i: { type: 'INTEGER' }, score: { type: 'NUMBER' }, verdict: { type: 'STRING', enum: VERDICTS }, reason: { type: 'STRING' },
  company_type: { type: 'STRING', enum: COMPANY_TYPES }, employer_type: { type: 'STRING', enum: EMPLOYER_TYPES },
};
const DETAIL_PROPS = { summary: { type: 'STRING' }, pros: { type: 'STRING' }, cons: { type: 'STRING' } };
export const SCHEMA_SINGLE_PASS = wrap({ ...SCORE_PROPS, ...DETAIL_PROPS }, [...Object.keys(SCORE_PROPS), ...Object.keys(DETAIL_PROPS)]);
export const SCHEMA_SCORE_ONLY = wrap(SCORE_PROPS, Object.keys(SCORE_PROPS));
export const SCHEMA_DETAILS = wrap({ i: { type: 'INTEGER' }, ...DETAIL_PROPS }, ['i', ...Object.keys(DETAIL_PROPS)]);

const systemText = (ctx) => `${ctx.texts.profile}\n\n${ctx.texts.rules}`;
const asText = (v) => { const s = Array.isArray(v) ? v.join('\n') : v == null ? '' : String(v); return s.trim() ? s : null; };

/** Turns one answer object into the fields stored on the offer. */
function applyScore(o, n, s, now) {
  if (!n || typeof n.score !== 'number') return { ...o, ai_status: 'error' };
  const score = Math.max(0, Math.min(5, Math.round(n.score * 10) / 10));
  const verdict = VERDICTS.includes(n.verdict) ? n.verdict : score >= 4 ? 'apply' : score >= 3 ? 'maybe' : 'no';
  const details = score >= s.detailsThreshold
    ? Object.fromEntries(Object.entries({ summary: asText(n.summary), pros: asText(n.pros), cons: asText(n.cons) }).filter(([, v]) => v))
    : {};
  return {
    ...o, ai_status: 'scored', ai_score: score, ai_verdict: verdict, ai_scored_at: now,
    ai_reasons: { reason: String(n.reason || '').slice(0, 300), ...details },
    company_type: oneOf(n.company_type, COMPANY_TYPES), employer_type: oneOf(n.employer_type, EMPLOYER_TYPES),
  };
}

const find = (results, i) => results.find((x) => x && x.i === i) || results[i];

async function scoreBatch(llm, ctx, batch, singlePass) {
  const s = ctx.scoring;
  const format = singlePass ? SINGLE_PASS_FORMAT(s.detailsThreshold, s.outputLanguage) : SCORE_ONLY_FORMAT(s.outputLanguage);
  const r = await llm.call({
    system: systemText(ctx), user: `${format}\n\n${offerBlock(batch, s.descriptionChars)}`,
    schema: singlePass ? SCHEMA_SINGLE_PASS : SCHEMA_SCORE_ONLY, maxTokens: singlePass ? 8192 : 2048,
  });
  const results = readResults(r.text);
  const now = new Date().toISOString();
  return { scored: batch.map((o, i) => applyScore(o, find(results, i), s, now)), usage: r.usage };
}

async function detailBatch(llm, ctx, batch) {
  const s = ctx.scoring;
  const r = await llm.call({ system: systemText(ctx), user: `${DETAILS_FORMAT(s.outputLanguage)}\n\n${offerBlock(batch, s.descriptionChars, true)}`, schema: SCHEMA_DETAILS, maxTokens: 8192 });
  const results = readResults(r.text);
  return {
    detailed: batch.map((o, i) => {
      const d = find(results, i);
      if (!d) return o;
      const extra = Object.fromEntries(Object.entries({ summary: asText(d.summary), pros: asText(d.pros), cons: asText(d.cons) }).filter(([, v]) => v));
      return { ...o, ai_reasons: { ...(o.ai_reasons || {}), ...extra } };
    }),
    usage: r.usage,
  };
}

/** Copies a representative's result onto its twins (other city / other source). */
function copyTo(twin, from) {
  return {
    ...twin, ai_status: from.ai_status, ai_score: from.ai_score, ai_verdict: from.ai_verdict, ai_scored_at: from.ai_scored_at,
    ai_reasons: { ...(from.ai_reasons || {}), copied_from: from.key || null },
    company_type: from.company_type, employer_type: from.employer_type,
  };
}

/**
 * Scores `offers` (already filtered). ctx = { texts, scoring }.
 * hooks.onBatch(offers) receives results as they come, twins included, so the
 * caller can save progress; hooks.onError(error, batch) reports failed batches.
 * Returns { results, usage, stats }.
 */
export async function scoreOffers(llm, ctx, offers, hooks = {}) {
  const s = ctx.scoring;
  const singlePass = s.strategy !== 'two-pass';
  const usage = { scoring: emptyUsage(), details: emptyUsage() };
  const { representatives, groups } = group(offers);
  const done = new Map();
  let errors = 0, copied = 0, detailed = 0;
  const keyOf = (o) => o.key ?? o;

  const spread = (o, out) => {
    done.set(keyOf(o), o); out.push(o);
    for (const twin of groups.get(groupKey(o)) || []) {
      if (twin === o || (twin.key != null && twin.key === o.key)) continue;
      const c = copyTo(twin, o); done.set(keyOf(twin), c); out.push(c); copied++;
    }
  };

  for (const batch of chunks(representatives, s.batchSize || 12)) {
    let r;
    try { r = await scoreBatch(llm, ctx, batch, singlePass); addUsage(usage.scoring, r.usage); } catch (e) {
      errors += batch.length; if (hooks.onError) await hooks.onError(e, batch); continue;
    }
    const out = [];
    for (const o of r.scored) {
      if (o.ai_status !== 'scored') { errors++; continue; }
      if (o.ai_reasons && o.ai_reasons.summary) detailed++;
      spread(o, out);
    }
    if (hooks.onBatch && out.length) await hooks.onBatch(out);
    await sleep(s.pauseMs ?? 500);
  }

  if (!singlePass) {
    const toDetail = representatives.map((o) => done.get(keyOf(o))).filter((o) => o && o.ai_status === 'scored' && o.ai_score >= s.detailsThreshold && String(o.description || '').trim());
    for (const batch of chunks(toDetail, Math.max(1, Math.floor((s.batchSize || 12) / 2)))) {
      let r;
      try { r = await detailBatch(llm, ctx, batch); addUsage(usage.details, r.usage); } catch (e) {
        if (hooks.onError) await hooks.onError(e, batch); continue;   // the score exists; the card shows the reason instead
      }
      const out = [];
      for (const o of r.detailed) { if (o.ai_reasons && o.ai_reasons.summary) detailed++; spread(o, out); }
      if (hooks.onBatch && out.length) await hooks.onBatch(out);
      await sleep(s.pauseMs ?? 500);
    }
  }

  const total = emptyUsage();
  for (const k of Object.keys(total)) total[k] = usage.scoring[k] + usage.details[k];
  return {
    results: offers.map((o) => done.get(keyOf(o)) || { ...o, ai_status: 'error' }),
    usage: { ...usage, total },
    stats: { offers: offers.length, groups: representatives.length, copied, detailed, errors, strategy: singlePass ? 'single-pass' : 'two-pass' },
  };
}
