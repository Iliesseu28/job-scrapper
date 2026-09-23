import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProfile, buildConfig } from '../pipeline/config.mjs';
import { buildFilter, dedupe, writtenIn, norm } from '../scoring/filter.mjs';

// The example profile shipped in profile/ drives these tests: they also prove it is coherent.
const cfg = buildConfig(loadProfile(), {});
const filter = buildFilter(cfg);
const today = new Date().toISOString();
const offer = (o) => ({ source_name: 'boards', title: 'AI Engineer', company: 'Acme', city: 'Paris', country: 'France', description: 'We build LLM agents and automation.', publication_date: today, ...o });

test('a golden title in the target area is kept, with a priority', () => {
  const r = filter(offer({}));
  assert.equal(r.filter_status, 'kept');
  assert.ok(r.priority >= 3);
});

test('contracts: always rejected, and "freelance only" rejected unless a permanent contract is also offered', () => {
  assert.match(filter(offer({ title: 'AI Engineer Internship' })).filter_reason, /contract rejected/);
  assert.equal(filter(offer({ contract_type: 'Freelance' })).filter_status, 'rejected');
  assert.equal(filter(offer({ contract_type: 'Freelance, Permanent' })).filter_status, 'kept');
});

test('senior titles are rejected, junior ones are not', () => {
  assert.match(filter(offer({ title: 'Senior AI Engineer' })).filter_reason, /senior/);
  assert.equal(filter(offer({ title: 'Junior AI Engineer' })).filter_status, 'kept');
});

test('languages: a required level you do not have, and ads written in a language you do not read', () => {
  assert.match(filter(offer({ description: 'LLM agents. Fluent German required.' })).filter_reason, /language required/);
  const german = 'Wir suchen dich! Deine Aufgaben: LLM agents. Ihr Profil: du bist neugierig. Bewerbung per Mail. Vollzeit.';
  assert.match(filter(offer({ description: german })).filter_reason, /ad written in german/);
});

test('freshness uses the publication date and the per-source override', () => {
  const old = new Date(Date.now() - 20 * 86400000).toISOString();
  assert.match(filter(offer({ publication_date: old })).filter_reason, /too old/);
  assert.equal(filter(offer({ publication_date: old, source_name: 'ats' })).filter_status, 'kept');   // ats: 30 days
});

test('field: a target title needs domain signals in the text; an off-target title is rejected', () => {
  assert.equal(filter(offer({ title: 'Software Engineer', description: 'Build LLM features and AI agents.' })).filter_status, 'kept');
  assert.match(filter(offer({ title: 'Software Engineer', description: 'Build a billing system in Java.' })).filter_reason, /no domain signal/);
  assert.match(filter(offer({ title: 'Accountant', description: 'Ledgers.' })).filter_reason, /neither a target title/);
});

test('conditional titles pass only with two strong signals', () => {
  assert.equal(filter(offer({ title: 'Product Manager', description: 'Own our agentic platform: AI agents and workflow automation.' })).filter_status, 'kept');
  assert.match(filter(offer({ title: 'Product Manager', description: 'Own the checkout. We use AI a bit.' })).filter_reason, /heart of this role/);
});

test('geography: excluded places lose, target places win, remote-only is kept, a sponsor phrase opens the door', () => {
  assert.match(filter(offer({ city: 'New York', country: 'United States' })).filter_reason, /excluded location/);
  assert.match(filter(offer({ city: 'Madrid', country: 'Spain' })).filter_reason, /outside your target area/);
  assert.equal(filter(offer({ city: 'Madrid', country: 'Spain', description: 'LLM agents. Visa sponsorship available.' })).filter_status, 'kept');
  assert.equal(filter(offer({ city: null, country: null, location: 'Remote' })).filter_status, 'kept');
  assert.equal(filter(offer({ city: 'Genève', country: 'CH' })).filter_status, 'kept');   // accents ignored, ISO code read in the country field
});

test('an empty rule list switches the rule off', () => {
  const open = buildFilter({ ...cfg, filter: { ...cfg.filter, domainSignals: [], goldenTitles: [], targetTitles: [], conditionalTitles: [], location: { ...cfg.filter.location, target: [], countryCodes: [], excluded: [] } } });
  assert.equal(open({ ...offer({ title: 'Accountant', description: 'Ledgers.', city: 'Madrid', country: 'Spain' }) }).filter_status, 'kept');
});

test('dedupe keeps the richest copy of the same job', () => {
  const a = offer({ source_name: 'rss', description: 'short' });
  const b = offer({ source_name: 'ats', description: 'a much longer description of the same job' });
  const out = dedupe([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source_name, 'ats');
});

test('writtenIn recognises French and English ads', () => {
  const fr = norm('Nous recherchons pour notre équipe une personne qui sera chargée du développement de la plateforme et des agents, avec vous dans une entreprise que nous aimons, pour les clients et par la qualité.');
  assert.equal(writtenIn(fr, 'fr'), true);
  assert.equal(writtenIn(fr, 'en'), false);
});
