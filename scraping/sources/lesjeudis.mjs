import { collecteParJobPosting } from './_shared.mjs';

// ----------------------------------------------------------------------------
// LESJEUDIS — job board tech historique (France). Recherche
// `/jobs?search=<mots>&page=N`, 10 fiches par page, fiche `/fr/job/<slug>-<id>`.
// ----------------------------------------------------------------------------
async function collecteLesJeudis(http, { queries = [], pages = 2, maxOffres = 40, budgetMs = 60000, timeout = 20000, fenetre = null, dejaVus = null } = {}) {
  const BASE = 'https://lesjeudis.com';
  return collecteParJobPosting(http, {
    source_name: 'lesjeudis', maxOffres, budgetMs, timeout, fenetre, dejaVus, paysDefaut: 'France',
    series: queries.map((q) => Array.from({ length: pages }, (_, i) => `${BASE}/jobs?search=${encodeURIComponent(q)}&page=${i + 1}`)),
    regexLien: /\/(?:fr\/job|offers)\/[a-z0-9-]+-[a-z0-9]+/g,
    urlFiche: (c) => BASE + c,
    idFiche: (c) => c.replace(/^.*-([a-z0-9]+)$/, '$1'),
  });
}

export { collecteLesJeudis };
