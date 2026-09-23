import { UA, clean, cut } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 1. VIE — Business France / Civiweb
// ---------------------------------------------------------------------------
// La clé X-API-KEY est la clé publique du front (servie dans le HTML de chaque
// page de mon-vie-via.businessfrance.fr). Elle est passée en paramètre pour
// ne jamais être écrite en dur dans le dépôt.
// Stratégie : le catalogue VIE fait ~800 offres au total. On prend TOUT et on
// filtre chez nous — bien plus fiable que la recherche plein-texte du site.
async function collecteVIE(http, { apiKey }) {
  const B = 'https://civiweb-api-prd.azurewebsites.net/api/Offers/search';
  const headers = {
    'User-Agent': UA, 'Content-Type': 'application/json', 'Accept': 'application/json',
    'X-API-KEY': apiKey, 'Referer': 'https://mon-vie-via.businessfrance.fr/',
  };
  const body = (skip, limit) => ({
    limit, skip, query: '', missionsDurations: [], specializationsIds: [],
    countriesIds: [], companiesIds: [], entreprisesIds: [], studiesLevelIds: [],
    gerographicZones: [],
  });

  const out = [];
  const PAGE = 200;
  let skip = 0, total = null, garde = 0;
  while (garde++ < 15) {
    const d = await http({ method: 'POST', url: B, headers, body: body(skip, PAGE) });
    if (total === null) total = d.count || 0;
    const rows = d.result || [];
    if (!rows.length) break;
    for (const r of rows) {
      out.push({
        source_name: 'vie',
        source_offer_id: String(r.id),
        title: cut(r.missionTitle, 500),
        company: r.organizationName || null,
        location: [r.cityName, r.countryName].filter(Boolean).join(', ') || null,
        city: r.cityName || null,
        country: r.countryName || null,
        contract_type: r.missionType || 'VIE',
        remote: r.teleworkingAvailable ? 'possible' : null,
        salary: r.indemnite ? String(r.indemnite) + ' EUR/mois' : null,
        description: cut(clean([r.missionDescription, r.missionProfile].filter(Boolean).join('\n\n')), 8000),
        url: 'https://mon-vie-via.businessfrance.fr/offres/' + r.id,
        contact_email: r.contactEmail || null,
        publication_date: r.startBroadcastDate || r.creationDate || null,
        raw: {
          duree_mois: r.missionDuration, secteur: r.activitySectorN1,
          debut: r.missionStartDate, fin: r.missionEndDate,
          candidats: r.candidateCounter, vues: r.viewCounter,
          specialisation: r.specialization, reference: r.reference,
        },
      });
    }
    skip += PAGE;
    if (skip >= total) break;
  }
  return out;
}

export { collecteVIE };
