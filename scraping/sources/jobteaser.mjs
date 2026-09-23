import { collecteParJobPosting } from './_shared.mjs';

// ----------------------------------------------------------------------------
// JOBTEASER — jeunes diplômés, stages, alternances et VIE (France surtout).
// Recherche `/fr/job-offers?q=<mots>&page=N`, 22 fiches par page,
// fiche `/fr/job-offers/<uuid>-<slug>` avec JobPosting complet (salaire,
// TELECOMMUTE, ville, région).
// ----------------------------------------------------------------------------
async function collecteJobTeaser(http, { queries = [], pages = 1, maxOffres = 60, budgetMs = 60000, timeout = 20000, fenetre = null, dejaVus = null } = {}) {
  const BASE = 'https://www.jobteaser.com';
  return collecteParJobPosting(http, {
    source_name: 'jobteaser', maxOffres, budgetMs, timeout, fenetre, dejaVus, paysDefaut: 'France',
    series: queries.map((q) => Array.from({ length: pages }, (_, i) => `${BASE}/fr/job-offers?q=${encodeURIComponent(q)}&page=${i + 1}`)),
    regexLien: /\/fr\/job-offers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[a-z0-9-]*/g,
    urlFiche: (c) => BASE + c,
    idFiche: (c) => c.split('/').pop().slice(0, 36),
  });
}

export { collecteJobTeaser };
