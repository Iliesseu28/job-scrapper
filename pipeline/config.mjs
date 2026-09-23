// ============================================================================
// CONFIG — reads profile/ and .env, checks them, and hands every stage the
// same `cfg` object. This is the only place that knows where files live.
//
//   profile/criteria.yaml   hard rules (filter) + scoring settings
//   profile/titles.yaml     search queries and wanted / unwanted titles
//   profile/sources.yaml    which sources run, and their settings
//   profile/companies.yaml  career pages read through their ATS
//   profile/profile.md      who you are        → sent to the AI
//   profile/scoring-rules.md how to grade       → sent to the AI
//   .env                    API keys (never committed)
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Reads a .env file without dependencies. Variables already set in the shell win. */
export function loadEnv(file = path.join(ROOT, '.env')) {
  const env = { ...process.env };
  if (!fs.existsSync(file)) return env;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    if (!(k in process.env)) env[k] = v;
  }
  return env;
}

const PROFILE_FILES = ['criteria.yaml', 'titles.yaml', 'sources.yaml', 'companies.yaml', 'profile.md', 'scoring-rules.md'];

/** Loads the profile folder. Throws a readable error on a missing file or broken YAML. */
export function loadProfile(dir = path.join(ROOT, 'profile')) {
  const read = (f) => {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) throw new Error(`missing profile file: ${path.relative(ROOT, p)}`);
    return fs.readFileSync(p, 'utf8');
  };
  const y = (f) => {
    try { return yaml.load(read(f)) || {}; } catch (e) {
      if (String(e.message).startsWith('missing profile file')) throw e;
      throw new Error(`${f}: invalid YAML — ${e.reason || e.message}${e.mark ? ` (line ${e.mark.line + 1})` : ''}`);
    }
  };
  return {
    criteria: y('criteria.yaml'),
    titles: y('titles.yaml'),
    sources: y('sources.yaml'),
    companies: (y('companies.yaml').companies) || [],
    profileText: read('profile.md'),
    rulesText: read('scoring-rules.md'),
  };
}

const list = (v) => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && String(x).trim() !== '') : []);

/** Every regex-like list is compiled once here so a typo is reported with its file and key. */
function checkPatterns(problems, file, key, values) {
  for (const v of list(values)) {
    try { new RegExp(String(v), 'i'); } catch (e) { problems.push(`${file} → ${key}: "${v}" is not a valid pattern (${e.message})`); }
  }
}

/**
 * Checks a loaded profile. Returns { errors, warnings } — errors stop a run,
 * warnings are printed. Also used by the Claude Code hook after each profile edit.
 */
export function validateProfile(p, env = {}, registryIds = []) {
  const errors = [];
  const warnings = [];
  const c = p.criteria || {};
  const t = p.titles || {};
  const s = p.sources || {};

  if (!t.searchQueries || (!list(t.searchQueries.english).length && !list(t.searchQueries.local).length)) {
    errors.push('titles.yaml → searchQueries: give at least one query (english or local)');
  }
  for (const k of ['domainSignals', 'goldenTitles', 'targetTitles', 'conditionalTitles', 'strongSignals', 'rejectedTitles']) checkPatterns(errors, 'titles.yaml', k, t[k]);
  const loc = c.location || {};
  for (const k of ['target', 'excluded', 'acceptElsewhereIf']) checkPatterns(errors, 'criteria.yaml', 'location.' + k, loc[k]);
  const ct = c.contracts || {};
  for (const k of ['alwaysReject', 'rejectUnlessAlsoOffered', 'acceptedWords']) checkPatterns(errors, 'criteria.yaml', 'contracts.' + k, ct[k]);
  checkPatterns(errors, 'criteria.yaml', 'seniority.rejectTitles', (c.seniority || {}).rejectTitles);
  const lg = c.languages || {};
  for (const k of ['rejectIfRequired', 'rejectIfWorkingLanguageIs', 'workingLanguageOk']) checkPatterns(errors, 'criteria.yaml', 'languages.' + k, lg[k]);
  checkPatterns(errors, 'criteria.yaml', 'rejectIfMainlyAbout', c.rejectIfMainlyAbout);
  checkPatterns(errors, 'criteria.yaml', 'priorityBoost', c.priorityBoost);
  if (loc.acceptElsewhereIfWrittenIn && !['fr', 'en'].includes(String(loc.acceptElsewhereIfWrittenIn))) {
    errors.push('criteria.yaml → location.acceptElsewhereIfWrittenIn: only "fr" or "en" (or empty)');
  }
  if (!list(loc.target).length && !list(loc.countryCodes).length) warnings.push('criteria.yaml → location.target is empty: every location is accepted');
  if (!Number(c.freshnessDays)) warnings.push('criteria.yaml → freshnessDays missing: 10 days used');

  const enabled = list(s.enabled);
  if (!enabled.length) errors.push('sources.yaml → enabled: list at least one source (see `npm run sources`)');
  for (const id of enabled) if (registryIds.length && !registryIds.includes(id)) errors.push(`sources.yaml → enabled: unknown source "${id}" (see \`npm run sources\`)`);
  if (enabled.includes('ats') && !p.companies.length) warnings.push('companies.yaml is empty: the "ats" source has nothing to read');
  for (const co of p.companies) {
    if (!co || !co.slug || !co.ats) errors.push(`companies.yaml: every company needs "ats" and "slug" (${JSON.stringify(co)})`);
  }
  if (p.profileText.trim().length < 200) warnings.push('profile.md is very short: the AI scores much better with a real profile');
  if (/Alex Martin/.test(p.profileText)) warnings.push('profile.md still describes the example candidate (Alex Martin): write your own profile');
  return { errors, warnings };
}

/** Builds the object every stage reads. */
export function buildConfig(p, env) {
  const c = p.criteria || {};
  const t = p.titles || {};
  const sc = c.scoring || {};
  return {
    candidate: (c.candidate || {}).name || 'the candidate',
    freshnessDays: Number(c.freshnessDays) || 10,
    freshnessDaysBySource: c.freshnessDaysBySource || {},
    queries: { english: list((t.searchQueries || {}).english), local: list((t.searchQueries || {}).local) },
    filter: {
      domainSignals: list(t.domainSignals), goldenTitles: list(t.goldenTitles), targetTitles: list(t.targetTitles),
      conditionalTitles: list(t.conditionalTitles), strongSignals: list(t.strongSignals), rejectedTitles: list(t.rejectedTitles),
      location: {
        target: list((c.location || {}).target), countryCodes: list((c.location || {}).countryCodes), excluded: list((c.location || {}).excluded),
        remoteIsTarget: (c.location || {}).remoteIsTarget !== false, acceptElsewhereIf: list((c.location || {}).acceptElsewhereIf),
        acceptElsewhereIfWrittenIn: (c.location || {}).acceptElsewhereIfWrittenIn || null,
      },
      contracts: { alwaysReject: list((c.contracts || {}).alwaysReject), rejectUnlessAlsoOffered: list((c.contracts || {}).rejectUnlessAlsoOffered), acceptedWords: list((c.contracts || {}).acceptedWords) },
      seniorityTitles: list((c.seniority || {}).rejectTitles),
      languages: {
        rejectIfRequired: list((c.languages || {}).rejectIfRequired), rejectIfWorkingLanguageIs: list((c.languages || {}).rejectIfWorkingLanguageIs),
        foreignAdWords: (c.languages || {}).foreignAdWords || {}, workingLanguageOk: list((c.languages || {}).workingLanguageOk),
      },
      rejectIfMainlyAbout: list(c.rejectIfMainlyAbout),
      priorityBoost: list(c.priorityBoost),
    },
    scoring: {
      maxPerRun: sc.maxPerRun ?? 150, keepThreshold: sc.keepThreshold ?? 4.0, detailsThreshold: sc.detailsThreshold ?? 3.5,
      batchSize: sc.batchSize ?? 12, descriptionChars: sc.descriptionChars ?? 1800, maxAgeDays: sc.maxAgeDays ?? 7,
      scoreWithoutDescription: Boolean(sc.scoreWithoutDescription), outputLanguage: sc.outputLanguage || 'English',
      strategy: sc.strategy || 'single-pass',
    },
    texts: { profile: p.profileText, rules: p.rulesText },
    sources: p.sources || {},
    enabledSources: list((p.sources || {}).enabled),
    companies: p.companies,
    env,
  };
}

/** Shortcut used by the CLI: load, check, build. */
export function loadAll({ profileDir, registryIds = [] } = {}) {
  const env = loadEnv();
  const profile = loadProfile(profileDir || path.join(ROOT, 'profile'));
  const check = validateProfile(profile, env, registryIds);
  return { env, profile, check, cfg: buildConfig(profile, env) };
}
