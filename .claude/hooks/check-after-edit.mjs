#!/usr/bin/env node
// PostToolUse hook — immediate feedback after an edit.
//   profile/*          → validate the profile (bad regex, unknown source, missing query…)
//   scraping/, scoring/, pipeline/, tests/ → run the test suite (offline, ~2 s)
// Problems are sent back to Claude (exit 2) so they get fixed in the same turn.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const file = path.resolve(String((input.tool_input || {}).file_path || ''));
const rel = path.relative(root, file).split(path.sep).join('/');
if (!rel || rel.startsWith('..')) process.exit(0);

if (rel.startsWith('profile/')) {
  const { loadProfile, validateProfile } = await import(pathToFileURL(path.join(root, 'pipeline/config.mjs')).href);
  const { SOURCE_IDS } = await import(pathToFileURL(path.join(root, 'scraping/registry.mjs')).href);
  let errors;
  try { errors = validateProfile(loadProfile(path.join(root, 'profile')), {}, SOURCE_IDS).errors; } catch (e) { errors = [e.message]; }
  if (errors.length) {
    process.stderr.write('The profile has problems — fix them before going on:\n' + errors.map((e) => '  - ' + e).join('\n') + '\n');
    process.exit(2);
  }
  process.exit(0);
}

if (/^(scraping|scoring|pipeline|tests)\/.*\.mjs$/.test(rel)) {
  // Explicit file list: Node 20 does not expand globs given to --test.
  const tests = fs.readdirSync(path.join(root, 'tests'), { recursive: true })
    .map((f) => String(f).split(path.sep).join('/')).filter((f) => f.endsWith('.test.mjs')).map((f) => 'tests/' + f);
  const r = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, encoding: 'utf8', timeout: 110000 });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) {
    const failed = out.split('\n').filter((l) => /^not ok|^# fail|error:/.test(l)).slice(0, 15).join('\n');
    process.stderr.write(`Tests fail after editing ${rel}:\n${failed}\nRun \`npm test\` for the details.\n`);
    process.exit(2);
  }
}
process.exit(0);
