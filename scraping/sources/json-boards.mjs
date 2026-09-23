import { UA, clean, cut } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 14. Job boards télétravail en JSON — 5 sites, un seul collecteur
// ---------------------------------------------------------------------------
// Ajouté le 15/08/2026. Ces sites publient tous une API JSON libre, plus riche
// que leur flux RSS (salaire, pays, séniorité). Chacun garde son propre
// `source_name` pour rester lisible dans les statistiques.
// RemoteOK place un objet de mentions légales en première position du tableau :
// il n'a pas de titre, la boucle l'écarte naturellement.
async function collecteBoardsJSON(http, { boards }) {
  const out = [];
  for (const b of boards) {
    let d;
    try {
      d = await http({ method: 'GET', url: b.url, headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: b.timeout || 15000 });
    } catch (e) { continue; }
    const lot = b.chemin ? (d[b.chemin] || []) : (Array.isArray(d) ? d : []);
    for (const o of lot) {
      // Chaque site nomme ses champs autrement. On accepte tous les noms
      // rencontrés plutôt que d'écrire un collecteur par site.
      const titre = o.title || o.position;
      const lien = o.url || o.apply_url || o.applicationLink || o.guid;
      if (!titre || !lien) continue;
      const lieu = o.location || o.candidate_required_location
        || (Array.isArray(o.locationRestrictions) ? o.locationRestrictions.join(', ') : null)
        || (Array.isArray(o.countries) ? o.countries.join(', ') : null) || null;
      // Les dates arrivent en trois formats selon le site : ISO, timestamp
      // Unix en secondes, ou rien du tout.
      let date = o.created_at || o.publication_date || o.pub_date || o.pubDate || o.date || null;
      if (typeof date === 'number') date = new Date(date * 1000).toISOString();
      const sal = o.salary || (o.minSalary ? `${o.minSalary}-${o.maxSalary || ''} ${o.currency || ''}`.trim() : null)
        || (o.salary_min ? `${o.salary_min}-${o.salary_max}` : null);
      out.push({
        source_name: b.nom,
        source_offer_id: String(o.id || o.slug || lien).slice(0, 200),
        title: cut(clean(titre), 500),
        company: o.company_name || o.company || o.companyName || null,
        location: lieu,
        city: null,
        country: lieu,
        contract_type: o.job_type || o.employmentType
          || (Array.isArray(o.job_types) ? o.job_types.join(', ') : null) || null,
        remote: 'Remote',
        salary: sal,
        description: cut(clean(o.description || o.excerpt), 8000),
        url: lien,
        contact_email: null,
        publication_date: date,
        raw: {
          board: b.nom,
          tags: (o.tags || o.categories || []).slice(0, 12),
          niveau: Array.isArray(o.seniority) ? o.seniority.join(', ') : null,
        },
      });
    }
  }
  return out;
}

export { collecteBoardsJSON };
