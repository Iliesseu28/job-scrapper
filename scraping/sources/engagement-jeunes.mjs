import { collecteParJobPosting } from './_shared.mjs';

// --- Engagement Jeunes -------------------------------------------------------
// Carte de liste : la date « Publiée le jj/mm/aaaa » suit la première ancre de
// l'offre (la même ancre est répétée plus loin pour la version mobile).
function dateCarteEngagementJeunes(htmlListe, chemin) {
  const html = String(htmlListe || '');
  const i = html.indexOf(chemin);
  if (i < 0) return null;
  const m = html.slice(i, i + 4000).match(/Publiée le (\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

async function collecteEngagementJeunes(http, { pages = 5, maxOffres = 60, budgetMs = 60000, timeout = 20000, fenetre = null, dejaVus = null } = {}) {
  const BASE = 'https://www.engagement-jeunes.com';
  return collecteParJobPosting(http, {
    source_name: 'engagement_jeunes', maxOffres, budgetMs, timeout, fenetre, dejaVus,
    // Pas de mot-clé : le filtre contrat suffit, le filtre titres du moteur fait le tri.
    series: [Array.from({ length: pages }, (_, i) => `${BASE}/fr/offres-emploi.html?contrat%5B%5D=6&page=${i + 1}`)],
    regexLien: /\/fr\/detail-offre\/\d+\/[a-z0-9-]+\.html/g,
    urlFiche: (c) => BASE + c,
    idFiche: (c) => c.replace(/^\/fr\/detail-offre\/(\d+)\/.*$/, '$1'),
    dateListe: (c, htmlListe) => dateCarteEngagementJeunes(htmlListe, c),
    enrichir: (offre, { chemin, htmlListe }) => {
      if (!offre.publication_date) offre.publication_date = dateCarteEngagementJeunes(htmlListe, chemin);
      offre.contract_type = 'VIE';   // la liste est filtrée sur ce contrat
      return offre;
    },
  });
}

export { dateCarteEngagementJeunes, collecteEngagementJeunes };
