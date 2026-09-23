import { UA, clean, cut, ajouter } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 4. Adzuna — agrégateur multi-pays (couvre l'international)
// ---------------------------------------------------------------------------
async function collecteAdzuna(http, { appId, appKey, pays, queries, maxJours = 21, fenetre = null, pagesMax = 6, parPage = 50 }) {
  const out = [];
  const vus = new Set();
  // max_days_old = la fenêtre elle-même : le serveur ne rend que le neuf. On
  // enchaîne les pages (search/1, search/2…) tant que `count` en annonce d'autres.
  const jours = fenetre ? fenetre.jours : maxJours;
  const nbPagesMax = fenetre ? pagesMax : 1;
  for (const p of pays) {
    for (const q of queries) {
      // Encodage à la main : le code reste compatible avec les environnements
      // sans URLSearchParams (nœuds Code n8n, par exemple).
      const qs = [
        'app_id=' + encodeURIComponent(appId),
        'app_key=' + encodeURIComponent(appKey),
        'what=' + encodeURIComponent(q),
        'results_per_page=' + parPage, 'sort_by=date',
        'max_days_old=' + encodeURIComponent(String(jours)),
      ].join('&');
      for (let page = 1; page <= nbPagesMax; page++) {
        let d;
        try {
          d = await http({ method: 'GET', url: `https://api.adzuna.com/v1/api/jobs/${p}/search/${page}?${qs}`, headers: { 'User-Agent': UA } });
        } catch (e) { break; }
        const res = (d && d.results) || [];
        for (const o of res) {
          if (!o.id || !o.title) continue;
          const area = o.location?.area || [];
          ajouter(out, vus, {
            source_name: 'adzuna',
            source_offer_id: String(o.id),
            title: cut(clean(o.title), 500),
            company: o.company?.display_name || null,
            location: o.location?.display_name || null,
            city: area.length >= 3 ? area[area.length - 1] : null,
            country: area[0] || p.toUpperCase(),
            contract_type: o.contract_time || o.contract_type || null,
            remote: null,
            salary: o.salary_min ? `${Math.round(o.salary_min)}-${Math.round(o.salary_max || o.salary_min)}` : null,
            description: cut(clean(o.description), 8000),
            url: `https://www.adzuna.${p === 'gb' ? 'co.uk' : p}/details/${o.id}`,
            contact_email: null,
            publication_date: o.created || null,
            raw: { requete: q, pays: p, categorie: o.category?.tag },
          });
        }
        const total = Number(d && d.count) || 0;
        if (res.length < parPage || page * parPage >= total) break;
      }
    }
  }
  return out;
}

export { collecteAdzuna };
