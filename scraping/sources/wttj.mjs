import { UA, clean, cut, ajouter } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 2. Welcome to the Jungle — index Algolia public
// ---------------------------------------------------------------------------
// Clés publiques du moteur de recherche du site (search-only, en clair dans
// leur JS). Une requête par mot-clé, on déduplique ensuite.
async function collecteWTTJ(http, { appId, apiKey, queries, hitsParRequete = 100, fenetre = null, pagesMax = 10, filtres = [], indices = null }) {
  const headers = {
    'User-Agent': UA, 'Content-Type': 'application/json',
    'X-Algolia-Application-Id': appId, 'X-Algolia-API-Key': apiKey,
    'Referer': 'https://www.welcometothejungle.com/',
  };
  const out = [];
  const vus = new Set();
  // Avec une fenêtre : filtre serveur sur la date de publication (attribut
  // numérique `published_at_timestamp`, en secondes — vérifié le 06/09/2026) et
  // pagination jusqu'à épuisement (Algolia plafonne à 1 000 résultats = 10 pages).
  // Sans fenêtre (appel direct, test local) : première page seulement, comme avant.
  const filtreDate = fenetre ? { numericFilters: [`published_at_timestamp >= ${fenetre.depuisSecondes}`] } : {};
  const nbPagesMax = fenetre ? pagesMax : 1;
  // Passes par facette (radar VIE du 06/09/2026) : requête vide + `filters`
  // Algolia, ex. `contract_type:vie` → toutes les offres VIE de l'index, quel
  // que soit l'intitulé (34 le 06/09/2026, invisibles pour les requêtes de titres).
  const passes = [...queries.map((q) => ({ q, filters: null })), ...filtres.map((f) => ({ q: '', filters: f }))];
  const listeIndices = Array.isArray(indices) && indices.length ? indices : ['wttj_jobs_production_fr'];
  for (const idx of listeIndices) {
    const url = `https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/${idx}/query`;
    const langUrl = idx.endsWith('_en') ? 'en' : 'fr';
    for (const { q, filters } of passes) {
      for (let page = 0; page < nbPagesMax; page++) {
        let d;
        try {
          d = await http({ method: 'POST', url, headers, body: {
            query: q, ...(filters ? { filters } : {}), hitsPerPage: hitsParRequete, page,
            // Algolia traite « ai » comme un mot vide français (j'ai) et cherchait
            // donc « Engineer » tout seul : 1 323 résultats en 3 jours au lieu de 417,
            // sans un seul vrai poste IA en tête. Mesuré le 06/09/2026.
            removeStopWords: false,
            ...filtreDate,
            attributesToRetrieve: ['name','slug','organization','offices','contract_type','published_at','remote','salary_min','salary_max','salary_currency','profession','description','profile','reference'],
          }});
        } catch (e) { break; }
        const hits = (d && d.hits) || [];
        for (const h of hits) {
          const org = h.organization || {};
          const office = (h.offices || [])[0] || {};
          const orgSlug = org.slug || org.reference || '';
          ajouter(out, vus, {
            source_name: 'wttj',
            source_offer_id: h.reference || h.slug || null,
            title: cut(h.name, 500),
            company: org.name || null,
            location: [office.city, office.country].filter(Boolean).join(', ') || null,
            city: office.city || null,
            country: office.country || null,
            contract_type: h.contract_type || null,
            remote: h.remote || null,
            salary: (h.salary_min ? `${h.salary_min}-${h.salary_max || ''} ${h.salary_currency || ''}`.trim() : null),
            description: cut(clean([h.description, h.profile].filter(Boolean).join('\n\n')), 8000),
            url: orgSlug && h.slug ? `https://www.welcometothejungle.com/${langUrl}/companies/${orgSlug}/jobs/${h.slug}` : null,
            contact_email: null,
            publication_date: h.published_at || null,
            raw: { requete: filters ? `filtre ${filters}` : q, metier: h.profession, index: idx },
          });
        }
        const nbPages = Number(d && d.nbPages) || 0;
        if (hits.length < hitsParRequete || page + 1 >= nbPages) break;
      }
    }
  }
  return out;
}

export { collecteWTTJ };
