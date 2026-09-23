import { UA, cut } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 13. artificialintelligencejobs.co — agrégateur 100 % IA
// ---------------------------------------------------------------------------
// Ajouté le 15/08/2026. ~18 400 offres IA, sans clé. Fortement orienté
// États-Unis (hors périmètre) mais 1 100+ offres en Europe et 220 sur Paris —
// le filtre pays s'occupe du reste. Deux appels suffisent pour l'essentiel.
async function collecteAIJobs(http, { pages = 3, parPage = 200, region = 'europe' }) {
  const out = [];
  for (let p = 0; p < pages; p++) {
    let d;
    try {
      d = await http({
        method: 'GET',
        url: `https://artificialintelligencejobs.co/api/jobs?region=${encodeURIComponent(region)}&limit=${parPage}&offset=${p * parPage}`,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
    } catch (e) { break; }
    const lot = d.jobs || [];
    if (!lot.length) break;
    for (const o of lot) {
      if (!o.url) continue;
      out.push({
        source_name: 'aijobs',
        // L'API ne donne pas d'identifiant : l'URL se termine par un hachage
        // stable côté fournisseur, on s'en sert comme clé.
        source_offer_id: String(o.url).split('/').pop(),
        title: cut(o.title, 500),
        company: o.company || null,
        location: o.location || (o.remote ? 'Remote' : null),
        city: (o.location || '').split(',')[0]?.trim() || null,
        country: (o.location || '').split(',').pop()?.trim() || null,
        contract_type: null,
        remote: o.remote ? 'Remote' : null,
        salary: o.salary || null,
        description: null,   // l'API ne rend que le titre et les métadonnées
        url: o.apply_url || o.url,
        contact_email: null,
        publication_date: o.posted || null,
        raw: { region: o.region, niveau: o.level, categorie: o.category },
      });
    }
    if (lot.length < parPage) break;
  }
  return out;
}

export { collecteAIJobs };
