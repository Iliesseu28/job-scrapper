import { UA, clean, cut } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 11 sexies. Emploitic — HTML avec JSON structuré embarqué (Next.js)
// ---------------------------------------------------------------------------
// Ajouté le 15/08/2026. Le plus gros job board d'Algérie, à zéro aujourd'hui.
// La recherche par mot-clé filtre vraiment côté serveur (contrairement à
// Hiredly) : on économise des appels en ne demandant que ce qui compte.
async function collecteEmploitic(http, { queries, pagesParRequete = 2 }) {
  const out = [];
  for (const q of queries) {
    for (let p = 1; p <= pagesParRequete; p++) {
      let html;
      try {
        html = await http({
          method: 'GET', brut: true,
          url: `https://emploitic.com/offres-d-emploi?search=${encodeURIComponent(q)}&page=${p}`,
          headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'fr-FR,fr;q=0.9' },
        });
      } catch (e) { continue; }
      if (typeof html !== 'string') continue;
      const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) continue;
      let data;
      try { data = JSON.parse(m[1]); } catch (e) { continue; }
      const sr = data.props && data.props.pageProps && data.props.pageProps.searchResult;
      const lignes = (sr && sr.data) || [];
      if (!lignes.length) break;
      for (const o of lignes) {
        if (!o.id || !o.title) continue;
        const lieu = (o.location && o.location[0] && o.location[0].label) || null;
        const contrat = (o.contractType && o.contractType[0] && o.contractType[0].label) || null;
        out.push({
          source_name: 'emploitic',
          source_offer_id: o.id,
          title: cut(o.title, 500),
          // Beaucoup d'offres sont publiées de façon anonyme (cabinet de
          // recrutement) : company n'a alors qu'un secteur, pas de nom.
          company: (o.company && o.company.name) || null,
          location: lieu || 'Algérie',
          city: lieu ? lieu.split(',')[0].trim() : null,
          country: 'Algeria',
          contract_type: contrat,
          remote: o.workMode === 'remote' ? 'Remote' : null,
          salary: null,
          description: cut(clean(o.description), 6000),
          url: 'https://emploitic.com/offres-d-emploi/' + o.alias,
          contact_email: null,
          publication_date: o.publishedAt || null,
          raw: { requete: q, jobLevel: o.jobLevel, workMode: o.workMode },
        });
      }
      if (p >= (sr.totalPages || 1)) break;
    }
  }
  return out;
}

export { collecteEmploitic };
