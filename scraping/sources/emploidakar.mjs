import { decodeEntitesHtml } from '../html-entities.mjs';
import { UA, cut } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 11 quater. EmploiDakar — HTML (plugin WordPress « WP Job Manager »)
// ---------------------------------------------------------------------------
// Ajouté le 15/08/2026. Sénégal n'avait que 3 offres actives. Structure de
// plugin WordPress standard : balisage stable et prévisible.
async function collecteEmploiDakar(http, { queries }) {
  const out = [];
  // &#038; est l'entité décimale de « & », très fréquente dans ce thème
  // WordPress (« Data &#038; IA ») ; decodeEntitesHtml décode aussi les
  // entités nommées (&amp;, &eacute;…) que la version précédente ignorait.
  const decode = (s) => !s ? s : decodeEntitesHtml(s).replace(/\s+/g, ' ').trim();

  for (const q of queries) {
    let html;
    try {
      html = await http({
        method: 'GET', brut: true,
        url: `https://www.emploidakar.com/?s=${encodeURIComponent(q)}&post_type=job_listing`,
        headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'fr-FR,fr;q=0.9' },
      });
    } catch (e) { continue; }
    if (typeof html !== 'string') continue;

    const parts = html.split(/(<li class="post-(\d+) job_listing)/);
    for (let i = 1; i < parts.length; i += 3) {
      const id = parts[i + 1];
      const card = parts[i] + (parts[i + 2] || '');
      if (!id) continue;
      const tM = card.match(/<h3>([\s\S]*?)<\/h3>/);
      const hrefM = card.match(/<a href="([^"]+)">/);
      if (!tM || !hrefM) continue;
      // Structure « page de recherche » : <ul class="meta"><li class="location">
      // …</li><li class="company">…</li></ul> — différente de la structure de
      // l'accueil (<div class="company"><strong>) repérée au premier essai.
      const compM = card.match(/class="company">\s*([\s\S]*?)<\/li>/);
      const locM = card.match(/class="location">\s*([\s\S]*?)<\/li>/);
      const dateM = card.match(/<time datetime="([^"]+)"/);
      const lieu = locM ? decode(locM[1]) : null;
      out.push({
        source_name: 'emploidakar',
        source_offer_id: id,
        title: cut(decode(tM[1]), 500),
        company: compM ? decode(compM[1]) : null,
        location: lieu || 'Sénégal',
        city: lieu ? lieu.split(',')[0].trim() : null,
        country: 'Senegal',
        contract_type: null,
        remote: null,
        salary: null,
        description: null,
        url: hrefM[1],
        contact_email: null,
        publication_date: dateM ? dateM[1] : null,
        raw: { requete: q },
      });
    }
  }
  return out;
}

export { collecteEmploiDakar };
