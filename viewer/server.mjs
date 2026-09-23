// ============================================================================
// VIEWER — a local web page to go through your scored offers.
//   npm run view   →   http://localhost:4321
// Reads data/ (written by the pipeline) and records what you do with each offer
// (saved / applied / hidden) in data/decisions.json. Listens on 127.0.0.1 only:
// nothing is exposed to your network. No dependency, no build step.
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOffers, loadRuns, loadDecisions, setDecision, DATA_DIR } from '../pipeline/store.mjs';
import { loadEnv, loadProfile, buildConfig } from '../pipeline/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = loadEnv();
const PORT = Number(env.VIEWER_PORT) || 4321;
const STATUSES = ['saved', 'applied', 'hidden', 'none'];
const FIELDS = ['key', 'title', 'company', 'city', 'country', 'location', 'contract_type', 'remote', 'salary', 'salary_guess', 'url',
  'source_name', 'publication_date', 'first_seen_at', 'ai_status', 'ai_score', 'ai_verdict', 'ai_reasons', 'company_type', 'employer_type', 'keyword_hits'];

function threshold() {
  try { return buildConfig(loadProfile(), env).scoring.keepThreshold; } catch { return 4; }
}

function state() {
  const db = loadOffers();
  const offers = Object.values(db.offers)
    .filter((o) => o.filter_status === 'kept')
    .map((o) => Object.fromEntries(FIELDS.map((k) => [k, o[k] ?? null])));
  const runs = loadRuns().slice(-5).reverse().map((r) => ({
    command: r.command, finished_at: r.finished_at,
    collect: r.collect ? { collected: r.collect.collected, new: r.collect.new, kept: r.collect.kept, sources: r.collect.sources } : null,
    scoring: r.scoring || null,
  }));
  return { offers, decisions: loadDecisions(), runs, keepThreshold: threshold(), total: Object.keys(db.offers).length, dataDir: DATA_DIR };
}

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return send(res, 200, fs.readFileSync(path.join(HERE, 'index.html')), 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, state());
  if (req.method === 'POST' && url.pathname === '/api/decision') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      try {
        const { key, status } = JSON.parse(body || '{}');
        if (typeof key !== 'string' || !STATUSES.includes(status)) return send(res, 400, { error: 'expected { key, status: saved|applied|hidden|none }' });
        return send(res, 200, { key, decision: setDecision(key, status) });
      } catch { return send(res, 400, { error: 'invalid JSON' }); }
    });
    return;
  }
  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Job scrapper viewer → http://localhost:${PORT}`);
  console.log(`reading ${DATA_DIR}  (Ctrl+C to stop)`);
});
