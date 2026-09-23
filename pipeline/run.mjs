#!/usr/bin/env node
// ============================================================================
// JOB SCRAPPER — command line
//
//   npm run scan                       collect → filter → details → score (the daily run)
//   npm run collect [-- --source wttj] collect + filter only (no AI, no cost)
//   npm run filter                     re-apply the filter to every stored offer (after a profile change)
//   npm run score  [-- --limit 30]     score kept offers that have no score yet
//   npm run sources                    every source, and whether it will run for you
//   npm run check                      validate profile/ and .env
//   npm run stats                      what is in data/
//
// Options: --source <id[,id]>  --days <n> (force the collection window)  --limit <n>  --rescore  --keys <key[,key]> (score these offers only)
// ============================================================================
import { loadAll } from './config.mjs';
import { loadOffers, saveOffers, mergeOffers, seenIds, prune, appendRun, lastCollectAt, loadRuns, loadDecisions } from './store.mjs';
import { http } from '../scraping/http.mjs';
import { SOURCES, SOURCE_IDS } from '../scraping/registry.mjs';
import { collect, skipReason } from '../scraping/collect.mjs';
import { enrichirDescriptions } from '../scraping/details.mjs';
import { buildFilter, dedupHash } from '../scoring/filter.mjs';
import { extractSalary } from '../scoring/salary.mjs';
import { createLLM } from '../scoring/llm.mjs';
import { scoreOffers } from '../scoring/score.mjs';

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args[0] : 'scan';
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : fallback; };
const say = (...m) => console.log(...m);
const bold = (s) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);

function load() {
  let loaded;
  try { loaded = loadAll({ registryIds: SOURCE_IDS }); } catch (e) { console.error('✗ ' + e.message); process.exit(1); }
  const { check } = loaded;
  for (const w of check.warnings) say(dim('! ' + w));
  if (check.errors.length) {
    for (const e of check.errors) console.error('✗ ' + e);
    console.error(`\n${check.errors.length} problem(s) in profile/ — fix them and run again.`);
    process.exit(1);
  }
  return loaded;
}

// --- Stage 2: filter (and the pay read in the text) -----------------------------------------
function applyFilter(db, cfg, keys) {
  const filter = buildFilter(cfg);
  const reasons = {};
  let kept = 0;
  for (const k of keys) {
    const o = db.offers[k];
    if (!o) continue;
    o.dedup_hash = o.dedup_hash || dedupHash(o);
    if (!o.salary && !o.salary_guess) { const g = extractSalary(o.description); if (g) o.salary_guess = g; }
    Object.assign(o, filter(o));
    if (o.filter_status === 'kept') kept++;
    else { const r = String(o.filter_reason).split(':')[0].trim(); reasons[r] = (reasons[r] || 0) + 1; }
  }
  return { kept, rejected: keys.length - kept, reasons };
}

/** Same job on two sources: only the richest copy goes to the AI (the others keep their filter status). */
function scoringQueue(db, cfg, { rescore = false, limit, keys = null } = {}) {
  if (keys) return keys.map((k) => db.offers[k]).filter(Boolean);
  const maxAge = cfg.scoring.maxAgeDays;
  const byHash = new Map();
  for (const o of Object.values(db.offers)) {
    if (o.filter_status !== 'kept') continue;
    if (!rescore && o.ai_status === 'scored') continue;
    if (!cfg.scoring.scoreWithoutDescription && !String(o.description || '').trim()) continue;
    const date = Date.parse(o.publication_date || o.first_seen_at);
    if (maxAge && Number.isFinite(date) && Date.now() - date > maxAge * 86400000) continue;
    const ex = byHash.get(o.dedup_hash);
    if (!ex || String(o.description || '').length > String(ex.description || '').length) byHash.set(o.dedup_hash, o);
  }
  return [...byHash.values()].sort((a, b) => (b.priority || 0) - (a.priority || 0)).slice(0, Number(limit) || cfg.scoring.maxPerRun);
}

async function runScoring(db, cfg, run) {
  const queue = scoringQueue(db, cfg, { rescore: Boolean(opt('rescore')), limit: opt('limit'), keys: opt('keys') ? String(opt('keys')).split(',') : null });
  if (!queue.length) { say('Scoring: nothing new to score.'); return; }
  let llm;
  try { llm = createLLM(http, cfg.env); } catch (e) { say('Scoring skipped — ' + e.message); run.scoring = { skipped: e.message }; return; }
  say(`\n${bold('Scoring')} ${queue.length} offer(s) with ${llm.provider} / ${llm.model}…`);
  const t0 = Date.now();
  const r = await scoreOffers(llm, { texts: cfg.texts, scoring: cfg.scoring }, queue, {
    onBatch: (batch) => {
      for (const o of batch) if (db.offers[o.key]) Object.assign(db.offers[o.key], o);
      saveOffers(db);
      process.stdout.write(dim(batch.map((o) => o.ai_score).join(' ') + '  '));
    },
    onError: (e) => say('\n' + dim('batch failed: ' + String(e.message).slice(0, 160))),
  });
  // Propagate to the other copies of the same job (same dedup hash, other source).
  const scoredByHash = new Map(r.results.filter((o) => o.ai_status === 'scored').map((o) => [o.dedup_hash, o]));
  for (const o of Object.values(db.offers)) {
    const s = scoredByHash.get(o.dedup_hash);
    if (s && o.key !== s.key && o.filter_status === 'kept' && o.ai_status !== 'scored') {
      Object.assign(o, { ai_status: 'scored', ai_score: s.ai_score, ai_verdict: s.ai_verdict, ai_reasons: { ...s.ai_reasons, copied_from: s.key }, ai_scored_at: s.ai_scored_at, company_type: s.company_type, employer_type: s.employer_type });
    }
  }
  saveOffers(db);
  const u = r.usage.total;
  say(`\n${r.stats.offers} offers → ${r.stats.groups} distinct jobs scored, ${r.stats.copied} twins copied, ${r.stats.detailed} detailed, ${r.stats.errors} errors — ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  say(dim(`tokens: ${u.input} in (${u.cached} cached), ${u.output} out, ${u.calls} calls`));
  run.scoring = { provider: llm.provider, model: llm.model, ...r.stats, usage: r.usage.total };
}

async function runCollect(db, cfg, run) {
  const only = opt('source') ? String(opt('source')).split(',') : null;
  say(bold('Collecting') + (only ? ' from ' + only.join(', ') : '') + '…');
  const r = await collect(http, cfg, {
    only, lastRunAt: only ? null : lastCollectAt(), forceDays: Number(opt('days')) || null,
    seen: (id) => seenIds(db, id, cfg.freshnessDays + 5),
    onSource: (id, l) => say(l.status === 'ok' ? `  ✓ ${id.padEnd(18)} ${String(l.collected).padStart(5)} offers  ${dim(l.calls + ' calls, ' + l.ms + ' ms')}`
      : l.status === 'error' ? `  ✗ ${id.padEnd(18)} ${dim(l.error)}` : dim(`  - ${id.padEnd(18)} ${l.reason}`)),
  });
  say(dim(`window: ${r.window.jours} day(s) — ${r.window.raison}`));
  const added = mergeOffers(db, r.offers);
  const f = applyFilter(db, cfg, added);
  say(`${r.offers.length} collected → ${added.length} new → ${bold(f.kept + ' kept')} by the filter`);
  if (f.rejected) say(dim('rejected: ' + Object.entries(f.reasons).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} (${v})`).join(', ')));

  // Second pass: full descriptions for kept offers whose source gave only a snippet.
  const kept = added.map((k) => db.offers[k]).filter((o) => o && o.filter_status === 'kept').sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const details = cfg.sources.details || {};
  if (kept.length && cfg.enabledSources.some((s) => (details.sources || ['hellowork', 'wttj']).includes(s))) {
    const d = await enrichirDescriptions(http, kept, { ...(details.sources ? { sources: details.sources } : {}), ...(details.maxPerRun ? { maxParPasse: details.maxPerRun } : {}) });
    if (d.stats.lues) say(dim(`details: ${d.stats.enrichies}/${d.stats.lues} descriptions completed`));
    // Descriptions are completed in place: re-filter those offers with their full text.
    if (d.stats.enrichies) applyFilter(db, cfg, kept.map((o) => o.key));
  }
  const removed = prune(db);
  saveOffers(db);
  run.collect = { ok: !only, window: r.window.jours, sources: r.log, collected: r.offers.length, new: added.length, kept: f.kept, pruned: removed };
}

// --- Commands ------------------------------------------------------------------------------
async function main() {
  if (command === 'sources') {
    const { cfg } = load();
    say(bold('Sources') + dim('  (✓ runs · - skipped)\n'));
    for (const s of SOURCES) {
      const why = skipReason(s, cfg);
      say(`${why ? dim('-') : '✓'} ${s.id.padEnd(18)} ${s.kind.padEnd(9)} ${s.region.padEnd(32)} ${why ? dim(why) : ''}`);
    }
    return;
  }
  if (command === 'check') {
    const { cfg } = load();
    say(`✓ profile/ is valid — ${cfg.enabledSources.length} sources enabled, ${cfg.companies.length} companies`);
    try { const l = createLLM(http, cfg.env); say(`✓ AI provider: ${l.provider} / ${l.model}`); } catch (e) { say('! ' + e.message); }
    return;
  }
  if (command === 'stats') {
    const db = loadOffers();
    const all = Object.values(db.offers);
    const decisions = loadDecisions();
    const scored = all.filter((o) => o.ai_status === 'scored');
    say(`${all.length} offers stored · ${all.filter((o) => o.filter_status === 'kept').length} kept · ${scored.length} scored · ${scored.filter((o) => o.ai_score >= 4).length} at 4+ · ${Object.keys(decisions).length} decisions`);
    const last = loadRuns().pop();
    if (last) say(dim(`last run: ${last.finished_at}`));
    return;
  }

  const { cfg } = load();
  const db = loadOffers();
  const run = { command, started_at: new Date().toISOString() };
  if (command === 'filter') {
    const f = applyFilter(db, cfg, Object.keys(db.offers));
    saveOffers(db);
    say(`${Object.keys(db.offers).length} offers → ${bold(f.kept + ' kept')}`);
    console.table(Object.fromEntries(Object.entries(f.reasons).sort((a, b) => b[1] - a[1])));
    return;
  }
  if (command === 'scan' || command === 'collect') await runCollect(db, cfg, run);
  if (command === 'scan' || command === 'score') await runScoring(db, cfg, run);
  if (!['scan', 'collect', 'score'].includes(command)) { say(`unknown command "${command}" — see the header of pipeline/run.mjs`); process.exit(1); }
  run.finished_at = new Date().toISOString();
  appendRun(run);
  if (command !== 'collect') say(`\nDone. Open the results with ${bold('npm run view')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
