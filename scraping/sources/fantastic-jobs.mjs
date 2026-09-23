import { clean, cut } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 10. Fantastic Jobs — LinkedIn + ATS, essai gratuit 50 appels/semaine
// ---------------------------------------------------------------------------
// La SEULE source qui donne des offres LinkedIn de façon licite (on ne veut
// pas — et ne doit pas — automatiser LinkedIn directement).
// Champs enrichis précieux : e-mail du recruteur, sponsoring de visa,
// niveau d'expérience, mode de travail.
//
// ⚠️ QUOTA TRÈS SERRÉ : 50 appels/semaine. `budget` est le nombre d'appels
// autorisés pour CE passage, calculé en amont depuis la base. À 0, on ne fait
// rien du tout — mieux vaut sauter un passage que griller le quota de la semaine.
async function collecteFantasticJobs(http, { apiKey, requetes, budget = 0, offresParAppel = 25 }) {
  if (!apiKey || budget <= 0) return [];
  const out = [];
  let appels = 0;
  for (const r of requetes) {
    if (appels >= budget) break;
    const qs = [
      'title=' + encodeURIComponent(r.titres),
      'location=' + encodeURIComponent(r.lieu),
      'time_frame=' + encodeURIComponent(r.fenetre || '7d'),
      // Le quota du fournisseur se compte en OFFRES rendues, pas en appels :
      // demander 100 d'un coup consommait un quart du quota hebdomadaire.
      'limit=' + encodeURIComponent(String(offresParAppel)),
    ].join('&');
    let d;
    try {
      d = await http({
        method: 'GET', url: `https://data.fantastic.jobs/v1/active-ats?${qs}`,
        headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' },
      });
    } catch (e) { appels++; continue; }
    appels++;
    const lignes = Array.isArray(d) ? d : (d.data || d.results || []);
    for (const o of lignes) {
      if (!o.id || !o.title) continue;
      const villes = o.cities_derived || [];
      const pays = o.countries_derived || [];
      out.push({
        source_name: 'fantastic_jobs',
        source_offer_id: String(o.id),
        title: cut(o.title, 500),
        company: o.organization || null,
        location: (o.locations_derived || [])[0] || null,
        city: villes[0] || null,
        country: pays[0] || null,
        contract_type: o.ai_employment_type?.[0] || o.employment_type?.[0] || null,
        remote: o.ai_work_arrangement || o.location_type || null,
        salary: o.ai_salary_value
          ? `${o.ai_salary_min_value || o.ai_salary_value}-${o.ai_salary_max_value || ''} ${o.ai_salary_currency || ''}`.trim()
          : (o.salary || null),
        description: cut(clean([
          o.ai_core_responsibilities, o.ai_requirements_summary,
          o.ai_key_skills ? 'Compétences : ' + [].concat(o.ai_key_skills).join(', ') : null,
        ].filter(Boolean).join('\n\n')), 8000),
        url: o.url || null,
        contact_email: o.ai_hiring_manager_email_address || null,
        publication_date: o.date_posted || o.date_created || null,
        raw: {
          requete: r.lieu, source_origine: o.source, via: o.source_type,
          experience: o.ai_experience_level, visa: o.ai_visa_sponsorship,
          recruteur: o.ai_hiring_manager_name, langue: o.ai_job_language,
        },
      });
    }
  }
  return out;
}

export { collecteFantasticJobs };
