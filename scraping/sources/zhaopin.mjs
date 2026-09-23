import { decodeEntitesHtml } from '../html-entities.mjs';
import { UA, cut } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 11 septies. Zhaopin — HTML rendu côté serveur (Vue SSR)
// ---------------------------------------------------------------------------
// Ajouté le 15/08/2026. Le plus grand job board de Chine, à zéro aujourd'hui.
// Offres et villes en mandarin, non traduites : le poste et le profil restent
// en chinois jusque dans la base. C'est la seule source du pipeline dans une
// langue que tout le monde ne lit pas — à activer seulement si ça a un sens pour toi.
async function collecteZhaopin(http, { queries, pagesParRequete = 2 }) {
  const out = [];
  const decode = (s) => !s ? s : decodeEntitesHtml(s).replace(/\s+/g, ' ').trim();

  for (const q of queries) {
    for (let p = 1; p <= pagesParRequete; p++) {
      let html;
      try {
        html = await http({
          method: 'GET', brut: true,
          url: `https://sou.zhaopin.com/?jl=&kw=${encodeURIComponent(q)}&p=${p}`,
          headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'zh-CN,zh;q=0.9' },
        });
      } catch (e) { continue; }
      if (typeof html !== 'string') continue;

      const parts = html.split(/(<a href="(http:\/\/www\.zhaopin\.com\/jobdetail\/[^"]+)"[^>]*class="jobinfo__name")/);
      for (let i = 1; i < parts.length; i += 3) {
        const url = parts[i + 1];
        const card = parts[i] + (parts[i + 2] || '');
        if (!url) continue;
        const idM = url.match(/jobdetail\/([A-Za-z0-9]+)\.htm/);
        const tM = card.match(/class="jobinfo__name">([^<]+)</);
        const compM = card.match(/class="companyinfo__name[^"]*"[^>]*>\s*([\s\S]*?)<\/a>/);
        const locM = card.match(/location-image">\s*<\/span>\s*<span>([^<]+)</) || card.match(/location-image"[^>]*>\s*<span>([^<]+)</);
        const salM = card.match(/class="jobinfo__salary">\s*([\s\S]*?)<\/p>/);
        if (!idM || !tM) continue;
        out.push({
          source_name: 'zhaopin',
          source_offer_id: idM[1],
          title: cut(decode(tM[1]), 500),
          company: compM ? decode(compM[1]) : null,
          location: locM ? decode(locM[1]) : 'China',
          city: locM ? decode(locM[1]).split('·')[0] : null,
          country: 'China',
          contract_type: null,
          remote: null,
          salary: salM ? decode(salM[1]) : null,
          description: null,
          url,
          contact_email: null,
          publication_date: null,
          raw: { requete: q },
        });
      }
    }
  }
  return out;
}

export { collecteZhaopin };
