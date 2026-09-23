import { UA, clean, cut } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 30. STATION F — campus de 1 000+ startups à Paris (WelcomeKit CMS)
// ---------------------------------------------------------------------------
// The Algolia app id and search-only key are the ones the public job board sends
// from every visitor's browser. They are read from .env (STATIONF_ALGOLIA_APP_ID /
// STATIONF_ALGOLIA_KEY) rather than written here: see the README, "Sources".
async function collecteStationF(http, { appId, apiKey, queries = [''], hitsParRequete = 100, fenetre = null, pagesMax = 5 } = {}) {
  if (!appId || !apiKey) return [];
  const STATIONF_APP_ID = appId;
  const STATIONF_API_KEY = apiKey;
  const headers = {
    'User-Agent': UA,
    'Content-Type': 'application/json',
    'X-Algolia-Application-Id': STATIONF_APP_ID,
    'X-Algolia-API-Key': STATIONF_API_KEY,
    'Referer': 'https://jobs.stationf.co/',
  };
  const out = [];
  const vus = new Set();
  const url = `https://${STATIONF_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/wk_cms_jobs_production_careers/query`;
  const dateMin = fenetre && fenetre.depuisDate ? new Date(fenetre.depuisDate) : null;
  const nbPagesMax = fenetre ? pagesMax : 2;

  for (const q of queries) {
    for (let page = 0; page < nbPagesMax; page++) {
      let d;
      try {
        d = await http({
          method: 'POST', url, headers, body: {
            query: q,
            hitsPerPage: hitsParRequete,
            page,
            removeStopWords: false,
            attributesToRetrieve: ['name', 'slug', 'organization', 'offices', 'contract_type', 'published_at', 'remote', 'salary_min', 'salary_max', 'salary_currency', 'profession', 'description', 'profile', 'reference']
          }
        });
      } catch (e) { break; }
      const hits = (d && d.hits) || [];
      if (!hits.length) break;
      for (const h of hits) {
        const id = h.reference || h.slug || String(h.objectID);
        if (!id || vus.has(id)) continue;
        vus.add(id);

        if (dateMin && h.published_at) {
          const dt = new Date(h.published_at);
          if (!Number.isNaN(dt.getTime()) && dt < dateMin) continue;
        }
        const org = h.organization || {};
        const office = (h.offices || [])[0] || {};
        const salaire = [h.salary_min, h.salary_max].filter(Boolean).join('-');
        const devise = h.salary_currency || 'EUR';
        const orgSlug = org.slug || '';
        const jobSlug = h.slug || '';
        const urlJob = `https://jobs.stationf.co/companies/${orgSlug}/jobs/${jobSlug}`;
        out.push({
          source_name: 'stationf',
          source_offer_id: id,
          title: cut(h.name, 500),
          company: org.name || null,
          location: [office.city, office.country || 'France'].filter(Boolean).join(', ') || null,
          city: office.city || null,
          country: office.country || 'France',
          contract_type: h.contract_type || null,
          remote: h.remote || null,
          salary: salaire ? `${salaire} ${devise}` : null,
          description: cut(clean([h.description, h.profile].filter(Boolean).join('\n\n')), 8000),
          url: urlJob,
          contact_email: null,
          publication_date: h.published_at || null,
          raw: { source: 'stationf', requete: q }
        });
      }
      if (hits.length < hitsParRequete) break;
    }
  }
  return out;
}

export { collecteStationF };
