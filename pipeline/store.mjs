// ============================================================================
// STORE — everything lives in plain JSON files under data/ (git-ignored).
//   data/offers.json     every offer ever collected, keyed, with its filter and AI results
//   data/runs.json       one line per run: window, sources, counts, tokens (last 100 runs)
//   data/decisions.json  what you did in the viewer: saved / applied / hidden
// No database to install. Writes go through a temp file + rename, so a crash
// mid-write never leaves a half-written file.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';

export const DATA_DIR = process.env.JOBSCRAPER_DATA_DIR ? path.resolve(process.env.JOBSCRAPER_DATA_DIR) : path.join(ROOT, 'data');
const file = (name) => path.join(DATA_DIR, name);

function readJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}
function writeJSON(name, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, file(name));
}

/** Stable key of an offer: source + its id at the source (or its dedup hash when the source gives none). */
export const offerKey = (o) => (o.source_offer_id ? `${o.source_name}:${o.source_offer_id}` : `${o.source_name}:#${o.dedup_hash}`);

export function loadOffers() { return readJSON('offers.json', { version: 1, offers: {} }); }
export function saveOffers(db) { writeJSON('offers.json', db); }

/**
 * Merges freshly collected offers. New ones are added; known ones get their
 * last_seen_at refreshed and missing fields filled — their filter and AI results
 * are kept. Returns the keys of the offers that are new.
 */
export function mergeOffers(db, offers, now = new Date().toISOString()) {
  const added = [];
  for (const o of offers) {
    const key = offerKey(o);
    const known = db.offers[key];
    if (!known) {
      const { raw, ...rest } = o;
      db.offers[key] = { ...rest, key, first_seen_at: now, last_seen_at: now };
      added.push(key);
      continue;
    }
    known.last_seen_at = now;
    for (const k of ['description', 'publication_date', 'contract_type', 'salary', 'city', 'country', 'url']) {
      if (!known[k] && o[k]) known[k] = o[k];
      if (k === 'description' && o[k] && String(o[k]).length > String(known[k] || '').length) known[k] = o[k];
    }
  }
  return added;
}

/** Ids already stored for a source (recent ones only): sources that cost one request per offer skip them. */
export function seenIds(db, source, days) {
  const since = Date.now() - days * 86400000;
  const ids = new Set();
  for (const o of Object.values(db.offers)) {
    if (o.source_name === source && o.source_offer_id && Date.parse(o.last_seen_at) >= since) ids.add(String(o.source_offer_id));
  }
  return ids;
}

/** Drops rejected or never-scored offers not seen for `days` days, so the file stays small. */
export function prune(db, days = 45) {
  const limit = Date.now() - days * 86400000;
  const decisions = loadDecisions();
  let removed = 0;
  for (const [k, o] of Object.entries(db.offers)) {
    if (decisions[k]) continue;
    if (Date.parse(o.last_seen_at) < limit && (o.filter_status === 'rejected' || o.ai_status !== 'scored' || (o.ai_score ?? 0) < 3)) { delete db.offers[k]; removed++; }
  }
  return removed;
}

export function loadRuns() { return readJSON('runs.json', []); }
export function appendRun(run) {
  const runs = loadRuns();
  runs.push(run);
  writeJSON('runs.json', runs.slice(-100));
}
/** End of the last run that collected successfully: start of the next incremental window. */
export function lastCollectAt() {
  const r = loadRuns().filter((x) => x.collect && x.collect.ok).pop();
  return r ? r.finished_at : null;
}

export function loadDecisions() { return readJSON('decisions.json', {}); }
export function setDecision(key, status) {
  const d = loadDecisions();
  if (!status || status === 'none') delete d[key]; else d[key] = { status, at: new Date().toISOString() };
  writeJSON('decisions.json', d);
  return d[key] || null;
}
