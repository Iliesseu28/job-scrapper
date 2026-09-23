import { UA, clean, cut, horsFenetre, pageEpuisee, ajouter } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 3. APEC — webservice CMS public (cadres, grands groupes)
// ---------------------------------------------------------------------------
async function collecteAPEC(http, { queries, parRequete = 100, fenetre = null, pagesMax = 10 }) {
  const url = 'https://www.apec.fr/cms/webservices/rechercheOffre';
  const headers = { 'User-Agent': UA, 'Content-Type': 'application/json', 'Accept': 'application/json' };
  const out = [];
  const vus = new Set();
  // Tri par date décroissante : on avance de page en page (startIndex) et on
  // s'arrête dès qu'une page entière est antérieure à la fenêtre.
  const nbPagesMax = fenetre ? pagesMax : 1;
  for (const q of queries) {
    for (let page = 0; page < nbPagesMax; page++) {
      let d;
      try {
        d = await http({ method: 'POST', url, headers, body: {
          motsCles: q,
          sorts: [{ type: 'DATE', direction: 'DESCENDING' }],
          pagination: { startIndex: page * parRequete, range: parRequete },
        }});
      } catch (e) { break; }
      const res = (d && d.resultats) || [];
      const dates = [];
      for (const r of res) {
        const id = String(r.numeroOffre || r.id || '');
        if (!id) continue;
        dates.push(r.datePublication || null);
        if (horsFenetre(r.datePublication, fenetre)) continue;
        ajouter(out, vus, {
          source_name: 'apec',
          source_offer_id: id,
          title: cut(r.intitule, 500),
          company: r.nomCommercial || null,
          location: r.lieuTexte || null,
          city: (r.lieuTexte || '').split(' - ')[0]?.trim() || null,
          country: 'France',
          contract_type: r.nomTypeContrat || null,
          // APEC renvoie un code interne, pas un libellé : on n'affiche pas un nombre brut.
          remote: r.idNomTeletravail && !/^\d+$/.test(String(r.idNomTeletravail)) ? r.idNomTeletravail : null,
          salary: r.salaireTexte || null,
          description: cut(clean(r.texteOffre), 8000),
          url: 'https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/' + id,
          contact_email: null,
          publication_date: r.datePublication || null,
          raw: { requete: q, secteur: r.secteurActivite, duree_mois: r.contractDuration },
        });
      }
      if (res.length < parRequete || pageEpuisee(dates, fenetre)) break;
    }
  }
  return out;
}

export { collecteAPEC };
