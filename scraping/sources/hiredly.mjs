import { UA, cut } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 11 ter. Hiredly — HTML avec JSON structuré embarqué (Next.js)
// ---------------------------------------------------------------------------
// Ajouté le 15/08/2026. Le plus gros job board de Malaisie — zone qui n'avait
// quasiment rien (4 offres, toutes VIE, aucune retenue). Le paramètre
// ?query= est ignoré côté serveur (toujours la même liste) ; en revanche les
// catégories /jobs-in-{slug} filtrent vraiment — on ne lit que Information
// Technology et Engineering. Bien plus fiable qu'un découpage HTML : c'est
// du JSON structuré.
async function collecteHiredly(http, { pages = 4, categories = ['information-technology', 'engineering'] }) {
  const out = [];
  for (const cat of categories) {
  for (let p = 1; p <= pages; p++) {
    let html;
    try {
      html = await http({
        method: 'GET', brut: true,
        url: `https://www.hiredly.com/jobs-in-${cat}?page=${p}`,
        headers: { 'User-Agent': UA, Accept: 'text/html' },
      });
    } catch (e) { continue; }
    if (typeof html !== 'string') continue;
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) continue;
    let data;
    try { data = JSON.parse(m[1]); } catch (e) { continue; }
    const lignes = (data.props && data.props.pageProps && data.props.pageProps.jobs) || [];
    for (const o of lignes) {
      if (!o.id || !o.title || o.expired) continue;
      out.push({
        source_name: 'hiredly',
        source_offer_id: String(o.id),
        title: cut(o.title, 500),
        company: (o.company && o.company.name) || null,
        location: [o.location, o.stateRegion].filter(Boolean).join(', ') || 'Malaysia',
        city: o.location || null,
        country: 'Malaysia',
        contract_type: o.jobType || null,
        remote: null,
        salary: o.salary && o.salary !== 'Undisclosed' ? o.salary : null,
        description: null,
        url: o.externalJobUrl || ('https://www.hiredly.com/jobs/' + o.slug),
        contact_email: null,
        publication_date: o.activeAt || null,
        raw: { minExp: o.minYearsExperience, maxExp: o.maxYearsExperience, skills: (o.skills || []).slice(0, 10) },
      });
    }
  }
  }
  return out;
}

export { collecteHiredly };
