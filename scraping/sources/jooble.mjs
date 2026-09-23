import { clean, cut } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 9. Jooble — agrégateur, 60+ pays, gratuit
// ---------------------------------------------------------------------------
// Trouvé le 15/08/2026 : comble d'un coup le Maghreb, le Canada et une partie
// du Moyen-Orient, qu'aucune autre source ne couvrait. Inscription self-service
// (moins d'une minute) sur jooble.org/api/about — voir le README, section « Sources ».
async function collecteJooble(http, { apiKey, requetes }) {
  if (!apiKey) return [];
  const out = [];
  for (const { motsCles, lieu } of requetes) {
    let d;
    try {
      // fr.jooble.org, pas jooble.org : le domaine générique renvoie 403.
      d = await http({
        method: 'POST', url: `https://fr.jooble.org/api/${apiKey}`,
        headers: { 'Content-Type': 'application/json' },
        body: { keywords: motsCles, location: lieu || '' },
      });
    } catch (e) { continue; }
    for (const o of (d.jobs || [])) {
      if (!o.id || !o.title) continue;
      out.push({
        source_name: 'jooble',
        source_offer_id: String(o.id),
        title: cut(clean(o.title), 500),
        company: o.company || null,
        location: o.location || null,
        city: (o.location || '').split(',')[0]?.trim() || null,
        country: lieu || null,
        contract_type: o.type || null,
        remote: null,
        salary: o.salary || null,
        description: cut(clean(o.snippet), 8000),
        url: o.link || null, contact_email: null,
        publication_date: o.updated || null,
        raw: { requete: motsCles, lieu_demande: lieu },
      });
    }
  }
  return out;
}

export { collecteJooble };
