// ============================================================================
// STAGE 2 — THE DETERMINISTIC FILTER
// ----------------------------------------------------------------------------
// Free, instant, reproducible. Its job is NOT to pick the good offers — that is
// the AI's job in stage 3. Its job is to remove, beyond any discussion, what has
// nothing to do there, so the AI is never paid to read noise.
//
// Golden rule: when in doubt, KEEP. An offer kept by mistake costs a fraction of
// a cent. An offer rejected by mistake is lost forever.
//
// Every rule reads profile/criteria.yaml and profile/titles.yaml (through
// pipeline/config.mjs). An empty list switches its rule off.
// ============================================================================

/** Lower-case, no accents, straight quotes, single spaces. */
export const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’']/g, "'").replace(/\s+/g, ' ');

/** company|title|city → 16 hex chars (two FNV-1a passes). Same offer on two sources = same hash. */
export function dedupHash(o) {
  const base = [norm(o.company), norm(o.title), norm(o.city || o.location)].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < base.length; i++) { h ^= base.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  const a = (h >>> 0).toString(16).padStart(8, '0');
  let g = 0x1000193;
  for (let i = base.length - 1; i >= 0; i--) { g ^= base.charCodeAt(i); g = Math.imul(g, 0x811c9dc5); }
  return a + (g >>> 0).toString(16).padStart(8, '0');
}

// Patterns can be written with accents in the profile; texts are compared without them.
const rx = (items, flags = 'i') => {
  const l = (items || []).filter((x) => String(x).trim());
  return l.length ? new RegExp('(' + l.map((x) => norm(String(x))).join('|') + ')', flags) : null;
};
const hit = (r, s) => Boolean(r) && r.test(s);
const first = (r, s) => (r ? (s.match(r) || [])[0] : null);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Language an ad is written in: count function words (text already normalised).
const WORDS = {
  fr: /\b(le|la|les|des|une|vous|nous|pour|avec|dans|sur|sont|et|du|aux|cette|votre|notre|vos|nos|qui|que|par|sera|etre|leur|leurs|ainsi|afin|chez|mais|dont|egalement|equipe|entreprise|poste|competences|recherche|developpement|candidat|candidature|profil)\b/g,
  en: /\b(the|and|you|we|our|with|for|will|are|is|of|in|on|this|that|your|have|be|as|at|from|by|or|an|to|team|role|skills|work|working|about|who|what|their|they|has|not|can|all|more)\b/g,
};
export function writtenIn(text, lang) {
  const other = lang === 'fr' ? 'en' : 'fr';
  const a = (text.match(WORDS[lang]) || []).length;
  const b = (text.match(WORDS[other]) || []).length;
  return a >= 12 && a * 2 >= b;
}

const REMOTE = /remote|t[ée]l[ée]travail|teletravail|distanciel|home.?office|anywhere|worldwide/i;

/**
 * Compiles the rules once and returns filter(offer) →
 *   { filter_status: 'kept' | 'rejected', filter_reason, keyword_hits, priority }
 */
export function buildFilter(cfg) {
  const f = cfg.filter;
  const rSignal = rx(f.domainSignals);
  const rSignalAll = rx(f.domainSignals, 'gi');
  const rGolden = rx(f.goldenTitles);
  const rTarget = rx(f.targetTitles);
  const rRejectedTitle = rx(f.rejectedTitles);
  const rConditional = rx(f.conditionalTitles);
  const rStrongAll = rx(f.strongSignals, 'gi');
  const rAlways = rx(f.contracts.alwaysReject);
  const rUnless = rx(f.contracts.rejectUnlessAlsoOffered);
  const rAccepted = rx(f.contracts.acceptedWords);
  const rSenior = rx(f.seniorityTitles);
  const rLangRequired = rx(f.languages.rejectIfRequired);
  const rWorkLang = rx(f.languages.rejectIfWorkingLanguageIs);
  const rWorkLangOk = rx(f.languages.workingLanguageOk);
  const foreign = Object.entries(f.languages.foreignAdWords || {})
    .filter(([, words]) => Array.isArray(words) && words.length)
    .map(([lang, words]) => [lang, rx(words, 'gi')]);
  const rMainly = rx(f.rejectIfMainlyAbout);
  const rBoost = rx(f.priorityBoost);
  const loc = f.location;
  const rTargetPlace = loc.target.length ? new RegExp('(' + loc.target.map((p) => norm(p).replace(/\\b/g, '\u0000')).map((p) => escapeKeepingBoundaries(p)).join('|') + ')', 'i') : null;
  const rCodes = loc.countryCodes.length ? new RegExp('^\\s*(' + loc.countryCodes.map((c) => escape(norm(c))).join('|') + ')\\s*$', 'i') : null;
  const rExcluded = rx(loc.excluded);
  const rElsewhere = rx(loc.acceptElsewhereIf);
  const noDomainRule = !rSignal;
  const noTitleRule = !rGolden && !rTarget && !rConditional;

  return function filter(o) {
    const title = norm(o.title);
    const text = norm([o.title, o.description].filter(Boolean).join(' ')).slice(0, 6000);
    const contract = norm(o.contract_type);
    const reject = (reason) => ({ filter_status: 'rejected', filter_reason: reason, keyword_hits: [], priority: 0 });

    const hits = rSignalAll ? [...new Set((text.match(rSignalAll) || []).map((s) => s.trim()))].slice(0, 12) : [];
    const signalInTitle = hit(rSignal, title);
    const golden = hit(rGolden, title);
    const target = hit(rTarget, title);
    const conditional = !golden && hit(rConditional, title);
    const strong = conditional && rStrongAll ? [...new Set((text.match(rStrongAll) || []).map((s) => s.trim()))] : [];
    const conditionalOk = conditional && (signalInTitle || strong.length >= 2);

    // --- 0. Contracts ------------------------------------------------------------
    const titleAndContract = norm([o.title, o.contract_type].filter(Boolean).join(' '));
    if (hit(rAlways, titleAndContract)) return reject('contract rejected: ' + first(rAlways, titleAndContract));
    if (hit(rUnless, contract) && !hit(rAccepted, contract)) return reject('contract rejected: ' + first(rUnless, contract));
    if (hit(rUnless, title) && !hit(rAccepted, title)) return reject('contract rejected: ' + first(rUnless, title));

    // --- 1. Seniority in the title -------------------------------------------------
    if (hit(rSenior, title)) return reject('senior role: ' + first(rSenior, title));

    // --- 2. Languages ----------------------------------------------------------------
    if (hit(rLangRequired, text)) return reject('language required: ' + first(rLangRequired, text));
    if (hit(rWorkLang, text) && !hit(rElsewhere, text)) return reject('working language: ' + first(rWorkLang, text));
    if (!hit(rWorkLangOk, text)) {
      for (const [lang, r] of foreign) {
        const found = [...new Set((text.match(r) || []).map((s) => s.toLowerCase()))];
        if (found.length >= 3) return reject(`ad written in ${lang}: ` + found.slice(0, 5).join(', '));
      }
    }

    // --- 3. Freshness (publication date, not collection date) ------------------------
    if (o.publication_date) {
      const d = new Date(o.publication_date);
      if (!Number.isNaN(d.getTime())) {
        const days = (Date.now() - d.getTime()) / 86400000;
        const limit = Math.max(cfg.freshnessDays, Number(cfg.freshnessDaysBySource[o.source_name]) || 0);
        if (days > limit) return reject(`too old (> ${limit} days)`);
      }
    }

    // --- 4. Unwanted titles (spared when the title is also wanted) --------------------
    if (hit(rRejectedTitle, title) && !target && !golden && !signalInTitle && !conditionalOk) {
      return reject('unwanted title: ' + first(rRejectedTitle, title));
    }

    // --- 5. The job must be in your field ------------------------------------------------
    if (noDomainRule) {
      if (!noTitleRule && !golden && !target && !conditionalOk) return reject('title not in your target list');
    } else if (conditional && !signalInTitle) {
      if (strong.length < 2) return reject('your field is not at the heart of this role' + (strong.length ? ': ' + strong.join(', ') : ''));
    } else if (!golden) {
      if (!signalInTitle && hits.length < 2) {
        return reject(target ? 'title ok but no domain signal in the text' : 'neither a target title nor a domain signal');
      }
      if (!target && !signalInTitle) return reject('title off target, domain only mentioned in the text');
    }

    // --- 6. Mainly about something you do not want -------------------------------------
    if (hit(rMainly, text) && !signalInTitle && !golden) return reject('mainly about: ' + first(rMainly, text));

    // --- 7. Geography --------------------------------------------------------------------
    // Real place, without the remote words: "Remote" alone is not a place.
    const place = norm([o.city, o.location, o.country].filter(Boolean).join(' '));
    const placeWithoutRemote = place.replace(new RegExp(REMOTE.source, 'gi'), '').replace(/full|100%|hybrid[e]?|[-–,/()]/gi, ' ').trim();
    const knownPlace = placeWithoutRemote.length > 0;
    const isRemote = REMOTE.test(norm([o.city, o.location, o.country, o.remote].filter(Boolean).join(' ')));
    const country = norm(o.country || '').trim();
    const inTarget = knownPlace && (hit(rTargetPlace, placeWithoutRemote) || hit(rCodes, country));
    const acceptElsewhere = hit(rElsewhere, text) || (loc.acceptElsewhereIfWrittenIn ? writtenIn(text, loc.acceptElsewhereIfWrittenIn) : false);
    if (knownPlace) {
      if (hit(rExcluded, place) && !acceptElsewhere) return reject('excluded location: ' + (o.country || o.location || o.city));
      if (!inTarget && (rTargetPlace || rCodes) && !acceptElsewhere) return reject('outside your target area: ' + (o.country || o.location || o.city));
    } else if (isRemote && !loc.remoteIsTarget && !acceptElsewhere) {
      return reject('remote only, and remoteIsTarget is off');
    }

    // --- 8. Priority: the order in which the AI reads kept offers --------------------------
    // The AI budget per run is capped: the best candidates go first, the rest wait.
    let priority = 1;
    if (target || conditionalOk) priority = 2;
    if (golden) priority = 3;
    if (hit(rBoost, titleAndContract)) priority += 1;
    if (isRemote) priority += 1;
    if (hits.length >= 4) priority += 1;
    return { filter_status: 'kept', filter_reason: null, keyword_hits: hits, priority };
  };
}

// Location words are plain words (accents stripped), except \b which users write
// to mean "whole word": keep those, escape everything else.
function escapeKeepingBoundaries(p) {
  return p.split('\u0000').map(escape).join('\\b');
}

/** Keeps the richest copy of each offer seen on several sources. */
export function dedupe(offers) {
  const RANK = { ats: 5, vie: 5, wttj: 4, apec: 3, hellowork: 2, adzuna: 2, rss: 1 };
  const m = new Map();
  for (const o of offers) {
    if (!o.title || !String(o.title).trim()) continue;
    const h = dedupHash(o);
    o.dedup_hash = h;
    const ex = m.get(h);
    if (!ex) { m.set(h, o); continue; }
    const better = (RANK[o.source_name] || 0) > (RANK[ex.source_name] || 0)
      || ((o.description || '').length > (ex.description || '').length * 1.5);
    if (better) m.set(h, o);
  }
  return [...m.values()];
}
