import { collecteParJobPosting } from './_shared.mjs';

// ----------------------------------------------------------------------------
// JOBSCOUT24 — Suisse (toutes régions, offres en français et en allemand).
// Le mot-clé va dans le chemin : `/fr/jobs/<mots-en-slug>/?p=N`, 18 fiches
// par page, fiche `/fr/job/<uuid>/`.
// ----------------------------------------------------------------------------
const slugJobScout24 = (q) => String(q).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function collecteJobScout24(http, { queries = [], pages = 2, maxOffres = 40, budgetMs = 60000, timeout = 20000, fenetre = null, dejaVus = null } = {}) {
  const BASE = 'https://www.jobscout24.ch';
  return collecteParJobPosting(http, {
    source_name: 'jobscout24', maxOffres, budgetMs, timeout, fenetre, dejaVus, paysDefaut: 'CH', deviseDefaut: 'CHF',
    series: queries.map((q) => Array.from({ length: pages }, (_, i) => `${BASE}/fr/jobs/${slugJobScout24(q)}/?p=${i + 1}`)),
    regexLien: /\/fr\/job\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//g,
    urlFiche: (c) => BASE + c,
    idFiche: (c) => c.replace(/\/$/, '').split('/').pop(),
  });
}

export { slugJobScout24, collecteJobScout24 };
