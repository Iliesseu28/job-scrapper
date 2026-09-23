import { UA, clean, cut } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 31. WELCOMEKIT — ATS Welcome to the Jungle pour cabinets & scale-ups IA
// ---------------------------------------------------------------------------
const ORGANISATIONS_WELCOMEKIT_DEFAUT = [
  { ref: 'qZoxLlg', nom: 'Start The F*** Up' },
  { ref: 'p6N2p17', nom: 'Converteo' },
  { ref: 'V9QjYep', nom: 'AI Builders' },
  { ref: 'w2m9yYx', nom: 'Saegus' },
  { ref: 'ywzggQO', nom: 'VONA' },
  { ref: 'jbPRwql', nom: 'Thélio' },
  { ref: 'kGyKZaZ', nom: 'Axionable' },
  { ref: 'ed0GlxQ', nom: 'Monsieur Guiz' },
  { ref: 'XW0r87a', nom: 'Ekinox' },
  { ref: '1pgQlV6', nom: 'Wivoo' },
  { ref: '1V9a04d', nom: 'eXalt' },
  { ref: 'MBW42I', nom: 'AI SISTERS' },
  { ref: '6pAM3PW', nom: 'Health Data Hub' },
  { ref: 'ci7AvS',  nom: 'beta.gouv.fr' },
  { ref: 'Ym2KqyP', nom: 'Square Management' },
  { ref: 'RGzpkrp', nom: 'Zenika' },
  { ref: 'TDwWSb',  nom: 'Klint' },
  { ref: 'YbjPgJ',  nom: 'Newadvise' },
  { ref: 'MmjSdU',  nom: 'iQo' },
  { ref: 'NQt3T9',  nom: 'INOCO' },
  { ref: 'drDV7Pa', nom: 'WITH' },
  { ref: 'DJwrDqm', nom: 'WedR' },
];

async function collecteWelcomeKit(http, { organisations = null, maxOffres = 400, fenetre = null } = {}) {
  const orgs = Array.isArray(organisations) && organisations.length ? organisations : ORGANISATIONS_WELCOMEKIT_DEFAUT;
  const out = [];
  const vus = new Set();
  const dateMin = fenetre && fenetre.depuisDate ? new Date(fenetre.depuisDate) : null;

  for (const org of orgs) {
    const ref = typeof org === 'string' ? org : (org.ref || org.reference || org.slug);
    const nomDefaut = typeof org === 'object' ? org.nom : null;
    try {
      const d = await http({
        method: 'GET',
        url: `https://www.welcomekit.co/api/v1/embed?organization_reference=${ref}`,
        headers: { 'User-Agent': UA }
      });
      const nomEntreprise = (d && d.name) || nomDefaut || ref;
      for (const j of ((d && d.jobs) || [])) {
        const id = j.reference || String(j.id);
        if (!id || vus.has(id)) continue;
        vus.add(id);

        if (dateMin && j.published_at) {
          const dt = new Date(j.published_at);
          if (!Number.isNaN(dt.getTime()) && dt < dateMin) continue;
        }

        const ville = j.office?.city || null;
        const pays = j.office?.country?.fr || j.office?.country?.en || 'France';
        const typeContrat = j.contract_type?.fr || j.contract_type?.en || null;
        const salaire = j.salary
          ? `${j.salary.min || ''}${j.salary.max ? '-' + j.salary.max : ''} ${j.salary.currency || 'EUR'}`.trim()
          : null;
        const jobUrl = j.websites_urls?.[0]?.url || `https://www.welcometothejungle.com/companies/${(d && d.slug) || ref}/jobs/${j.slug}`;

        out.push({
          source_name: 'welcomekit',
          source_offer_id: `wk:${ref}:${id}`,
          title: cut(j.name, 500),
          company: nomEntreprise,
          location: [ville, pays].filter(Boolean).join(', ') || null,
          city: ville,
          country: pays,
          contract_type: typeContrat,
          remote: j.remote ? 'remote' : null,
          salary: salaire || null,
          description: cut(clean([j.description, j.profile].filter(Boolean).join('\n\n')), 8000),
          url: jobUrl,
          contact_email: null,
          publication_date: j.published_at || null,
          raw: { ats: 'welcomekit', org_reference: ref, org_name: nomEntreprise }
        });
        if (out.length >= maxOffres) return out;
      }
    } catch (e) {
      // Une organisation en échec ne coupe pas les autres
    }
  }
  return out;
}

export { ORGANISATIONS_WELCOMEKIT_DEFAUT, collecteWelcomeKit };
