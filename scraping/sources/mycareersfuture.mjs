import { UA, cut, horsFenetre, pageEpuisee, ajouter } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 11. MyCareersFuture — portail public du gouvernement de Singapour
// ---------------------------------------------------------------------------
// Ajouté le 15/08/2026. Comble le trou « Asie », la zone la moins couverte.
// Sans clé, sans compte. Le salaire est OBLIGATOIRE sur ce portail : c'est la
// seule source qui donne systématiquement une fourchette chiffrée.
// Attention : la recherche ne renvoie PAS la description. On reconstruit un
// texte à partir des compétences et catégories, ce qui suffit au filtre — le
// portail étiquette « AI Agents », « Machine Learning » etc. de façon fiable.
async function collecteMyCareersFuture(http, { requetes, parRequete = 100, fenetre = null, pagesMax = 5 }) {
  const out = [];
  const vus = new Set();
  // sortBy=new_posting_date : les plus récentes d'abord, pour pouvoir s'arrêter
  // dès qu'une page entière est antérieure à la fenêtre.
  const nbPagesMax = fenetre ? pagesMax : 1;
  for (const q of requetes) {
    for (let page = 0; page < nbPagesMax; page++) {
      let d;
      try {
        d = await http({
          method: 'POST',
          url: 'https://api.mycareersfuture.gov.sg/v2/search?limit=' + parRequete + '&page=' + page + (fenetre ? '&sortBy=new_posting_date' : ''),
          headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: { search: q, sessionId: '', limit: parRequete, page },
        });
      } catch (e) { break; }
      const res = (d && d.results) || [];
      const dates = [];
      for (const o of res) {
        const id = o.metadata?.jobPostId || o.uuid;
        if (!id) continue;
        const publiee = o.metadata?.newPostingDate || null;
        dates.push(publiee);
        if (horsFenetre(publiee, fenetre)) continue;
        const a = o.address || {};
        const comp = o.postedCompany || o.hiringCompany || {};
        const sal = o.salary || {};
        // Le portail ne rend pas la description dans la recherche : on assemble
        // les compétences et catégories pour que le filtre ait de la matière.
        const bouts = [
          (o.categories || []).map((c) => c.category).join(', '),
          (o.positionLevels || []).map((p) => p.position).join(', '),
          (o.skills || []).map((s) => s.skill).join(', '),
        ].filter(Boolean);
        ajouter(out, vus, {
          source_name: 'mycareersfuture',
          source_offer_id: String(id),
          title: cut(o.title, 500),
          company: comp.name || null,
          location: a.isOverseas ? (a.overseasCountry || 'Overseas') : 'Singapore',
          city: a.isOverseas ? null : 'Singapore',
          country: a.isOverseas ? (a.overseasCountry || null) : 'Singapore',
          contract_type: (o.employmentTypes || []).map((e) => e.employmentType).join(', ') || null,
          remote: (o.flexibleWorkArrangements || []).map((f) => f.flexibleWorkArrangement || f).join(', ') || null,
          salary: sal.minimum ? `${sal.minimum}-${sal.maximum} SGD/${sal.type?.salaryType || 'Monthly'}` : null,
          description: cut(bouts.join(' — '), 8000),
          url: o.metadata?.jobDetailsUrl || 'https://www.mycareersfuture.gov.sg/job/' + o.uuid,
          contact_email: null,
          publication_date: publiee,
          raw: { requete: q, candidatures: o.metadata?.totalNumberJobApplication, uen: comp.uen },
        });
      }
      if (res.length < parRequete || pageEpuisee(dates, fenetre)) break;
    }
  }
  return out;
}

export { collecteMyCareersFuture };
