// ============================================================================
// STAGE 1 — COLLECTION
// Runs every enabled source, one after the other, and returns all offers in the
// common format plus a log line per source.
//
// Common offer format (every collector returns it):
//   { source_name, source_offer_id, title, company, location, city, country,
//     contract_type, remote, salary, description, url, contact_email,
//     publication_date, raw }
//
// Incremental window: paginated sources only go back to the last successful run
// (+ a 2-day margin), capped at freshnessDays. The first run reads the full window.
// A source that fails never stops the run: its error is logged and we move on.
// ============================================================================
import { SOURCES } from './registry.mjs';
import { countingHttp } from './http.mjs';
import { fenetreCollecte } from './sources/_shared.mjs';

/** Why a source will not run: not enabled, or keys missing from .env. null = it runs. */
export function skipReason(source, cfg) {
  if (!cfg.enabledSources.includes(source.id)) return 'not enabled';
  const missing = source.keys.filter((k) => !String(cfg.env[k] || '').trim());
  return missing.length ? 'missing in .env: ' + missing.join(', ') : null;
}

/**
 * cfg      — pipeline/config.mjs buildConfig()
 * options  — { only: [ids], lastRunAt: ISO, forceDays: n, seen: (id) => Set, onSource: (id, log) => void }
 */
export async function collect(http, cfg, options = {}) {
  const window = fenetreCollecte({ fraicheurJours: cfg.freshnessDays, dernierPassage: options.lastRunAt || null, joursForces: options.forceDays || null });
  // Four collectors (Station F, WelcomeKit, Job Bank, jobup) read `depuisDate`.
  window.depuisDate = window.depuis;
  const warnings = {};
  const log = { _window: { days: window.jours, since: window.depuis, reason: window.raison } };
  const offers = [];
  const selected = options.only && options.only.length ? SOURCES.filter((s) => options.only.includes(s.id)) : SOURCES;

  for (const source of selected) {
    // --source x runs x even when it is not in `enabled`; its keys are still required.
    const reason = skipReason(source, options.only && options.only.length ? { ...cfg, enabledSources: options.only } : cfg);
    if (reason) { log[source.id] = { status: 'skipped', reason }; continue; }
    const counted = countingHttp(http);
    const ctx = {
      env: cfg.env, queries: cfg.queries, sources: cfg.sources, companies: cfg.companies, freshnessDays: cfg.freshnessDays, window,
      seen: (id) => (options.seen ? options.seen(id) : null),
      warn: (m) => { (warnings[source.id] = warnings[source.id] || []).length < 20 && warnings[source.id].push(String(m).slice(0, 200)); },
    };
    const t0 = Date.now();
    try {
      const found = await source.run(counted, ctx);
      offers.push(...found);
      log[source.id] = { status: 'ok', collected: found.length, ms: Date.now() - t0, calls: counted.counter.calls };
    } catch (e) {
      log[source.id] = { status: 'error', collected: 0, ms: Date.now() - t0, calls: counted.counter.calls, error: String(e.message || e).slice(0, 300) };
    }
    if (warnings[source.id]) log[source.id].warnings = warnings[source.id];
    if (options.onSource) options.onSource(source.id, log[source.id]);
  }
  return { offers, log, window };
}
