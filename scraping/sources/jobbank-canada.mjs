import { UA, clean, cut } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 32. JOB BANK CANADA — Guichet-Emplois Canada (Gouvernement du Canada)
// ---------------------------------------------------------------------------
const REQUETES_JOBBANK_CANADA_DEFAUT = [
  'intelligence artificielle',
  'machine learning',
  'automatisation',
  'data engineer',
  'stage',
  'solutions engineer',
];

async function collecteJobBankCanada(http, {
  queries = null,
  pagesMax = 2,
  maxOffres = 60,
  fenetre = null,
} = {}) {
  const reqs = Array.isArray(queries) && queries.length ? queries : REQUETES_JOBBANK_CANADA_DEFAUT;
  const out = [];
  const vus = new Set();
  const dateMin = fenetre && fenetre.depuisDate ? new Date(fenetre.depuisDate) : null;

  for (const q of reqs) {
    for (let page = 1; page <= pagesMax; page++) {
      const url = `https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring=${encodeURIComponent(q)}&fprov=QC&sort=D&page=${page}`;
      let html;
      try {
        html = await http({ url, headers: { 'User-Agent': UA }, brut: true });
      } catch (e) {
        break;
      }
      if (typeof html !== 'string') break;

      const articles = [...html.matchAll(/<article[^>]*id="article-(\d+)"[^>]*>([\s\S]*?)<\/article>/gi)];
      if (!articles.length) break;

      for (const [_, id, block] of articles) {
        if (!id || vus.has(id)) continue;
        vus.add(id);

        const titleMatch = block.match(/<span class="noctitle">([^<]+)<\/span>/i) || block.match(/<a[^>]*class="resultJobItem"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
        const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null;
        if (!title) continue;

        const companyMatch = block.match(/<li class="business">([^<]+)<\/li>/i);
        const company = companyMatch ? companyMatch[1].replace(/\s+/g, ' ').trim() : null;

        const locationMatch = block.match(/<li class="location">([\s\S]*?)<\/li>/i);
        let city = null;
        let location = null;
        if (locationMatch) {
          const locText = locationMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          location = locText;
          const parts = locText.split(/\s*,\s*|\s*\(|\)/);
          city = parts[0]?.trim() || null;
        }

        const dateMatch = block.match(/<li class="date">([^<]+)<\/li>/i);
        const dateStr = dateMatch ? dateMatch[1].replace(/\s+/g, ' ').trim() : null;
        const pubDate = dateStr ? new Date(dateStr) : null;
        const pubIso = pubDate && !Number.isNaN(pubDate.getTime()) ? pubDate.toISOString() : null;

        if (dateMin && pubDate && !Number.isNaN(pubDate.getTime()) && pubDate < dateMin) {
          continue;
        }

        const salaryMatch = block.match(/<li class="salary">([^<]+)<\/li>/i);
        const salary = salaryMatch ? salaryMatch[1].replace(/\s+/g, ' ').trim() : null;

        const linkMatch = block.match(/<a[^>]*class="resultJobItem"[^>]*href="([^"]+)"/i);
        const relativeUrl = linkMatch ? linkMatch[1].split(';')[0] : `/jobsearch/jobposting/${id}`;
        const jobUrl = `https://www.jobbank.gc.ca${relativeUrl}`;

        out.push({
          source_name: 'jobbank_canada',
          source_offer_id: id,
          title: cut(title, 500),
          company,
          location: location || 'Québec, Canada',
          city: city || 'Montréal',
          country: 'Canada',
          contract_type: /stage|stagiaire|intern/i.test(title + ' ' + q) ? 'Stage' : 'Permanent',
          remote: /télétravail|telework|remote/i.test(location || '') ? 'remote' : null,
          salary,
          description: cut(clean(`${title} chez ${company || 'Entreprise'}\nLieu : ${location || 'Québec'}\nSalaire : ${salary || 'Non précisé'}\nSource : Guichet-Emplois Canada`), 8000),
          url: jobUrl,
          contact_email: null,
          publication_date: pubIso,
          raw: { requete: q, id }
        });
        if (out.length >= maxOffres) return out;
      }
    }
  }
  return out;
}

export { REQUETES_JOBBANK_CANADA_DEFAUT, collecteJobBankCanada };
