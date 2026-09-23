import { UA, clean, cut } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 33. JOBUP.CH — N°1 de l'emploi en Suisse Romande (JobCloud)
// ---------------------------------------------------------------------------
const REQUETES_JOBUP_CH_DEFAUT = [
  'intelligence artificielle',
  'machine learning',
  'automatisation',
  'solutions engineer',
  'agent ia',
  'développeur ia',
  'stage',
];

async function collecteJobupCH(http, {
  queries = null,
  rows = 20,
  maxOffres = 60,
  fenetre = null,
} = {}) {
  const reqs = Array.isArray(queries) && queries.length ? queries : REQUETES_JOBUP_CH_DEFAUT;
  const out = [];
  const vus = new Set();
  const dateMin = fenetre && fenetre.depuisDate ? new Date(fenetre.depuisDate) : null;

  for (const q of reqs) {
    const url = `https://www.jobup.ch/api/v1/public/search?query=${encodeURIComponent(q)}&rows=${rows}`;
    let data;
    try {
      data = await http({ url, headers: { 'User-Agent': UA } });
    } catch (e) {
      continue;
    }
    const docs = (data && data.documents) || [];
    for (const d of docs) {
      const id = d.job_id || d.id;
      if (!id || vus.has(id)) continue;
      vus.add(id);

      const pubStr = d.publication_date || d.initial_publication_date || null;
      const pubDate = pubStr ? new Date(pubStr) : null;
      const pubIso = pubDate && !Number.isNaN(pubDate.getTime()) ? pubDate.toISOString() : null;

      if (dateMin && pubDate && !Number.isNaN(pubDate.getTime()) && pubDate < dateMin) {
        continue;
      }

      const place = d.place ? String(d.place).trim() : null;
      const title = cut(d.title, 500);
      const company = d.company_name ? String(d.company_name).trim() : null;
      const detailUrl = d._links?.detail_fr?.href || `https://www.jobup.ch/fr/emplois/detail/${id}/`;

      out.push({
        source_name: 'jobup_ch',
        source_offer_id: id,
        title,
        company,
        location: place ? `${place}, Suisse` : 'Suisse Romande',
        city: place || 'Genève',
        country: 'Suisse',
        contract_type: /stage|intern|stagiaire/i.test(title + ' ' + q) ? 'Stage' : 'CDI',
        remote: /remote|télétravail|home office/i.test(place || '') ? 'remote' : null,
        salary: null,
        description: cut(clean(`${title} chez ${company || 'Entreprise'}\nLieu : ${place || 'Suisse Romande'}\n${d.preview || ''}`), 8000),
        url: detailUrl,
        contact_email: null,
        publication_date: pubIso,
        raw: { requete: q, slug: d.slug }
      });
      if (out.length >= maxOffres) return out;
    }
  }
  return out;
}

export { REQUETES_JOBUP_CH_DEFAUT, collecteJobupCH };
