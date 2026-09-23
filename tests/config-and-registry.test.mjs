import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadProfile, validateProfile, buildConfig } from '../pipeline/config.mjs';
import { SOURCES, SOURCE_IDS } from '../scraping/registry.mjs';
import { collect, skipReason } from '../scraping/collect.mjs';

test('the example profile is valid', () => {
  const { errors } = validateProfile(loadProfile(), {}, SOURCE_IDS);
  assert.deepEqual(errors, []);
});

test('profile problems are reported with their file and key', () => {
  const p = loadProfile();
  const broken = { ...p, titles: { ...p.titles, goldenTitles: ['ai (engineer'] }, sources: { enabled: ['ats', 'nope'] } };
  const { errors } = validateProfile(broken, {}, SOURCE_IDS);
  assert.ok(errors.some((e) => e.startsWith('titles.yaml → goldenTitles')));
  assert.ok(errors.some((e) => e.includes('unknown source "nope"')));
});

test('every source has a unique id, a kind, a region and a collector', () => {
  assert.equal(new Set(SOURCE_IDS).size, SOURCE_IDS.length);
  for (const s of SOURCES) {
    assert.ok(['api', 'ats', 'feed', 'site-api', 'html'].includes(s.kind), s.id);
    assert.ok(s.region && s.label && typeof s.run === 'function', s.id);
  }
});

test('every key a source needs is documented in .env.example, and every source in the README', () => {
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const s of SOURCES) {
    for (const k of s.keys) assert.match(example, new RegExp('^#?\\s*' + k + '=', 'm'), `${k} missing from .env.example`);
    assert.ok(readme.includes('`' + s.id + '`'), `${s.id} missing from the README`);
  }
});

test('a source without its key is skipped with the missing variable named', () => {
  const cfg = buildConfig(loadProfile(), {});
  const adzuna = SOURCES.find((s) => s.id === 'adzuna');
  assert.match(skipReason(adzuna, cfg), /ADZUNA_APP_ID/);
  assert.equal(skipReason(SOURCES.find((s) => s.id === 'hellowork'), cfg), 'not enabled');
});

test('a failing source never stops the collection', async () => {
  const cfg = { ...buildConfig(loadProfile(), {}), enabledSources: ['rss', 'boards'] };
  cfg.sources = { rss: { feeds: [{ name: 'x', url: 'https://example.test/feed' }] }, boards: { list: [{ name: 'b', url: 'https://example.test/api' }] } };
  const http = async (req) => {
    if (req.url.includes('/feed')) throw new Error('HTTP 500 down');
    return [{ id: 1, title: 'AI Engineer', company_name: 'Acme', url: 'https://example.test/1', location: 'Remote' }];
  };
  const r = await collect(http, cfg, {});
  assert.equal(r.log.rss.status, 'ok');           // the RSS collector swallows a dead feed
  assert.equal(r.log.boards.status, 'ok');
  assert.equal(r.log.adzuna.status, 'skipped');
});
