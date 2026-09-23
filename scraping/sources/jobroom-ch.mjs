import { UA, clean, cut, ajouter } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 12. job-room.ch — service public de l'emploi suisse (SECO)
// ---------------------------------------------------------------------------
// Ajouté le 15/08/2026. La Suisse est un pays cible et n'était couverte que
// marginalement par Adzuna. API officielle, sans clé.
// Le moteur renvoie les mots cherchés entourés de <em> dans le titre : on les
// retire, sinon le titre stocké en base est illisible.
async function collecteJobRoomCH(http, { requetes, parRequete = 100, fenetre = null, pagesMax = 5 }) {
  const out = [];
  const vus = new Set();
  // sort=date_desc + onlineSince (en jours) : le serveur borne lui-même la
  // fenêtre (vérifié le 06/09/2026) ; on tourne les pages tant qu'elles sont pleines.
  const nbPagesMax = fenetre ? pagesMax : 1;
  for (const q of requetes) {
    for (let page = 0; page < nbPagesMax; page++) {
      let d;
      try {
        d = await http({
          method: 'POST',
          url: 'https://api.job-room.ch/jobadservice/api/jobAdvertisements/_search?page=' + page + '&size=' + parRequete + (fenetre ? '&sort=date_desc' : ''),
          headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: fenetre ? { keywords: [q], onlineSince: fenetre.jours } : { keywords: [q] },
        });
      } catch (e) { break; }
      const items = Array.isArray(d) ? d : [];
      for (const item of items) {
        const a = item.jobAdvertisement || item;
        const c = a.jobContent || {};
        const desc = (c.jobDescriptions || [])[0] || {};
        const loc = c.location || {};
        const comp = c.company || {};
        const canal = c.applyChannel || {};
        if (!a.id || !desc.title) continue;
        ajouter(out, vus, {
          source_name: 'jobroom_ch',
          source_offer_id: String(a.id),
          title: cut(clean(desc.title), 500),
          company: comp.name || null,
          location: [loc.city, loc.cantonCode].filter(Boolean).join(', ') || 'Suisse',
          city: loc.city || null,
          country: loc.countryIsoCode || 'CH',
          contract_type: c.employment?.permanent ? 'CDI' : 'CDD',
          remote: null,
          salary: null,
          description: cut(clean(desc.description), 8000),
          // formUrl pointe vers le site d'origine (jobs.ch, etc.) ; à défaut on
          // renvoie sur la fiche job-room, qui reste consultable.
          url: canal.formUrl || c.externalUrl || 'https://www.job-room.ch/job-seeker/job-detail/' + a.id,
          contact_email: canal.emailAddress || null,
          publication_date: a.publication?.startDate || (a.createdTime || '').slice(0, 10) || null,
          raw: {
            requete: q,
            taux: c.employment ? `${c.employment.workloadPercentageMin}-${c.employment.workloadPercentageMax}%` : null,
            metiers: (c.occupations || []).map((o) => o.avamOccupationCode).filter(Boolean),
          },
        });
      }
      if (items.length < parRequete) break;
    }
  }
  return out;
}

export { collecteJobRoomCH };
