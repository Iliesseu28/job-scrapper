import { UA, clean, cut } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 5. ATS — pages carrières en direct (le canal le plus frais)
// ---------------------------------------------------------------------------
// Les entreprises publient sur leur ATS plusieurs jours avant les job boards.
// Endpoints publics, sans clé, sans risque de blocage.
async function collecteATS(http, { entreprises, avertir = null }) {
  const out = [];
  for (const e of entreprises) {
    try {
      if (e.ats === 'ashby') {
        const d = await http({ method: 'GET', url: `https://api.ashbyhq.com/posting-api/job-board/${e.slug}?includeCompensation=true`, headers: { 'User-Agent': UA } });
        for (const j of (d.jobs || [])) {
          out.push({
            source_name: 'ats', source_offer_id: `ashby:${e.slug}:${j.id}`,
            title: cut(j.title, 500), company: e.nom,
            location: j.location || null, city: j.address?.postalAddress?.addressLocality || j.location || null,
            country: j.address?.postalAddress?.addressCountry || e.pays || null,
            contract_type: j.employmentType || null,
            remote: j.isRemote ? 'remote' : (j.workplaceType || null),
            salary: j.compensation?.compensationTierSummary || null,
            description: cut(clean(j.descriptionPlain || j.descriptionHtml), 8000),
            url: j.jobUrl || j.applyUrl || null, contact_email: null,
            publication_date: j.publishedAt || null,
            raw: { ats: 'ashby', entreprise_slug: e.slug, equipe: j.team, departement: j.department },
          });
        }
      } else if (e.ats === 'greenhouse') {
        const d = await http({ method: 'GET', url: `https://boards-api.greenhouse.io/v1/boards/${e.slug}/jobs?content=true`, headers: { 'User-Agent': UA } });
        for (const j of (d.jobs || [])) {
          out.push({
            source_name: 'ats', source_offer_id: `gh:${e.slug}:${j.id}`,
            title: cut(j.title, 500), company: e.nom,
            location: j.location?.name || null, city: j.location?.name || null,
            country: e.pays || null, contract_type: null, remote: null, salary: null,
            description: cut(clean(j.content), 8000),
            url: j.absolute_url || null, contact_email: null,
            publication_date: j.updated_at || j.first_published || null,
            raw: { ats: 'greenhouse', entreprise_slug: e.slug },
          });
        }
      } else if (e.ats === 'lever') {
        const d = await http({ method: 'GET', url: `https://api.lever.co/v0/postings/${e.slug}?mode=json`, headers: { 'User-Agent': UA } });
        for (const j of (d || [])) {
          out.push({
            source_name: 'ats', source_offer_id: `lever:${e.slug}:${j.id}`,
            title: cut(j.text, 500), company: e.nom,
            location: j.categories?.location || null, city: j.categories?.location || null,
            country: e.pays || null, contract_type: j.categories?.commitment || null,
            remote: /remote/i.test(j.workplaceType || j.categories?.location || '') ? 'remote' : null,
            salary: null,
            description: cut(clean(j.descriptionPlain || j.description), 8000),
            url: j.hostedUrl || j.applyUrl || null, contact_email: null,
            publication_date: j.createdAt ? new Date(j.createdAt).toISOString() : null,
            raw: { ats: 'lever', entreprise_slug: e.slug, equipe: j.categories?.team },
          });
        }
      } else if (e.ats === 'smartrecruiters') {
        // L'API rend 100 offres par appel et annonce `totalFound` : on pagine par
        // `offset` (plafond 20 pages). Jusqu'au 06/09/2026 seule la première page
        // était lue — Alten en publie ~1 100, Devoteam ~940 : on en ratait 90 %.
        let offset = 0, total = null, tours = 0;
        while (tours++ < 20) {
          const d = await http({ method: 'GET', url: `https://api.smartrecruiters.com/v1/companies/${e.slug}/postings?limit=100&offset=${offset}`, headers: { 'User-Agent': UA } });
          const lot = d.content || [];
          if (total === null) total = Number(d.totalFound) || lot.length;
          for (const j of lot) {
          out.push({
            source_name: 'ats', source_offer_id: `sr:${e.slug}:${j.id}`,
            title: cut(j.name, 500), company: e.nom,
            location: [j.location?.city, j.location?.country].filter(Boolean).join(', ') || null,
            city: j.location?.city || null, country: j.location?.country || e.pays || null,
            contract_type: j.typeOfEmployment?.label || null,
            remote: j.location?.remote ? 'remote' : null, salary: null,
            description: null,
            url: `https://jobs.smartrecruiters.com/${e.slug}/${j.id}`, contact_email: null,
            publication_date: j.releasedDate || null,
            raw: { ats: 'smartrecruiters', entreprise_slug: e.slug },
          });
          }
          offset += lot.length;
          if (!lot.length || offset >= total) break;
        }
      } else if (e.ats === 'recruitee') {
        const d = await http({ method: 'GET', url: `https://${e.slug}.recruitee.com/api/offers/`, headers: { 'User-Agent': UA } });
        for (const j of (d.offers || [])) {
          out.push({
            source_name: 'ats', source_offer_id: `rec:${e.slug}:${j.id}`,
            title: cut(j.title, 500), company: e.nom,
            location: j.location || null, city: j.city || null,
            country: j.country || e.pays || null, contract_type: j.employment_type_code || null,
            remote: j.remote ? 'remote' : null, salary: null,
            description: cut(clean(j.description), 8000),
            url: j.careers_url || j.url || null, contact_email: null,
            publication_date: j.published_at || j.created_at || null,
            raw: { ats: 'recruitee', entreprise_slug: e.slug },
          });
        }
      } else if (e.ats === 'workable') {
        const d = await http({ method: 'GET', url: `https://apply.workable.com/api/v1/widget/accounts/${e.slug}?details=true`, headers: { 'User-Agent': UA } });
        for (const j of (d.jobs || [])) {
          out.push({
            source_name: 'ats', source_offer_id: `wk:${e.slug}:${j.shortcode || j.id}`,
            title: cut(j.title, 500), company: e.nom,
            location: [j.city, j.country].filter(Boolean).join(', ') || null,
            city: j.city || null, country: j.country || e.pays || null,
            contract_type: j.employment_type || null,
            remote: j.telecommuting ? 'remote' : null, salary: null,
            description: cut(clean([j.description, j.requirements].filter(Boolean).join('\n\n')), 8000),
            url: j.url || j.application_url || null, contact_email: null,
            publication_date: j.published_on || j.created_at || null,
            raw: { ats: 'workable', entreprise_slug: e.slug, departement: j.department },
          });
        }
      } else if (e.ats === 'teamtailor') {
        // `/jobs.json` est un JSON Feed 1.1 : { items: [{ id, title, url, date_published,
        // content_html, _jobposting: <schema.org JobPosting> }] }. Jusqu'au 06/09/2026 le
        // code lisait `d.jobs || d` — un objet sans `.jobs`, donc jamais une offre
        // (vérifié sur ml6.teamtailor.com : 14 offres, 0 lue).
        const d = await http({ method: 'GET', url: `https://${e.slug}.teamtailor.com/jobs.json`, headers: { 'User-Agent': UA } });
        const items = Array.isArray(d) ? d : (d.items || d.jobs || []);
        for (const j of items) {
          const jp = j._jobposting || {};
          const adr = (jp.jobLocation && jp.jobLocation.address) || {};
          const ville = adr.addressLocality || j.location || null;
          const types = Array.isArray(jp.employmentType) ? jp.employmentType : (jp.employmentType ? [jp.employmentType] : []);
          out.push({
            source_name: 'ats', source_offer_id: `tt:${e.slug}:${j.id}`,
            title: cut(j.title || jp.title, 500), company: e.nom,
            location: [ville, adr.addressCountry].filter(Boolean).join(', ') || null, city: ville, country: adr.addressCountry || e.pays || null,
            contract_type: types.join(', ') || null,
            remote: jp.jobLocationType === 'TELECOMMUTE' ? 'remote' : null, salary: null,
            description: cut(clean(j.content_html || j.body || jp.description), 8000),
            url: j.url || jp.url || null, contact_email: null,
            publication_date: j.date_published || j.created_at || jp.datePosted || null,
            raw: { ats: 'teamtailor', entreprise_slug: e.slug },
          });
        }
      } else if (e.ats === 'welcomekit') {
        const d = await http({ method: 'GET', url: `https://www.welcomekit.co/api/v1/embed?organization_reference=${e.slug}`, headers: { 'User-Agent': UA } });
        for (const j of ((d && d.jobs) || [])) {
          const ville = j.office?.city || null;
          const pays = j.office?.country?.fr || j.office?.country?.en || e.pays || 'France';
          const types = j.contract_type?.fr || j.contract_type?.en || null;
          const salaire = j.salary ? `${j.salary.min || ''}${j.salary.max ? '-' + j.salary.max : ''} ${j.salary.currency || 'EUR'}`.trim() : null;
          out.push({
            source_name: 'ats', source_offer_id: `wk:${e.slug}:${j.reference || j.id}`,
            title: cut(j.name, 500), company: (d && d.name) || e.nom,
            location: [ville, pays].filter(Boolean).join(', ') || null, city: ville, country: pays,
            contract_type: types,
            remote: j.remote ? 'remote' : null, salary: salaire || null,
            description: cut(clean([j.description, j.profile].filter(Boolean).join('\n\n')), 8000),
            url: j.websites_urls?.[0]?.url || `https://www.welcometothejungle.com/companies/${(d && d.slug) || e.slug}/jobs/${j.slug}`,
            contact_email: null,
            publication_date: j.published_at || null,
            raw: { ats: 'welcomekit', entreprise_slug: e.slug },
          });
        }
      }
    } catch (err) {
      // Une entreprise KO ne fait jamais tomber la collecte — mais on le signale,
      // sinon un slug mort passe inaperçu pendant des semaines (Black Forest Labs,
      // 404 Greenhouse jusqu'au 06/09/2026 : l'ATS avait changé pour Ashby).
      if (avertir) avertir(`${e.ats}:${e.slug} — ${String((err && err.message) || err).slice(0, 160)}`);
    }
  }
  return out;
}

export { collecteATS };
