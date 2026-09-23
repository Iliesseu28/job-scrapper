import { decodeEntitesHtml } from '../html-entities.mjs';
import { UA, cut, horsFenetre, pageEpuisee, ajouter, dateRelativeFr } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 7. HelloWork — HTML (pas d'API publique)
// ---------------------------------------------------------------------------
async function collecteHelloWork(http, { queries, pagesParRequete = 2, fenetre = null, pagesMax = 5 }) {
  const out = [];
  const vus = new Set();
  // Résultats triés par date (st=date) : avec une fenêtre, on tourne les pages
  // jusqu'à ce qu'une page entière soit plus vieille qu'elle (ou vide).
  const nbPagesMax = fenetre ? pagesMax : pagesParRequete;
  for (const q of queries) {
    for (let p = 1; p <= nbPagesMax; p++) {
      let html;
      try {
        html = await http({
          method: 'GET', brut: true,
          url: `https://www.hellowork.com/fr-fr/emploi/recherche.html?k=${encodeURIComponent(q)}&st=date&d=all&p=${p}`,
          headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-FR,fr;q=0.9' },
        });
      } catch (e) { break; }
      if (typeof html !== 'string') break;
      // Parseur de la page de résultats HelloWork — éprouvé en production
      // "Scraping HelloWork", éprouvé en production. HelloWork ne publie ni API
      // ni JSON-LD sur cette page : on découpe sur les cartes <li>.
      const decode = (s) => !s ? s : decodeEntitesHtml(s).replace(/\s+/g, ' ').trim();

      const parts = html.split(/(<li[^>]*data-id-storage-item-id="\d+")/);
      const dates = [];
      let cartes = 0;
      for (let i = 1; i < parts.length; i += 2) {
        const card = parts[i] + (parts[i + 1] || '');
        const idM = card.match(/data-id-storage-item-id="(\d+)"/);
        if (!idM) continue;
        cartes++;
        // Chaque carte porte son ancienneté (« il y a 3 heures », « hier »,
        // « il y a 2 jours ») : c'est notre seule date de publication ici.
        const dM = card.match(/(il y a \d+\+?\s*(?:minute|heure|jour|semaine|mois|an)s?|aujourd.hui|hier|à l.instant)/i);
        const publiee = dM ? dateRelativeFr(dM[1]) : null;
        dates.push(publiee);
        if (horsFenetre(publiee, fenetre)) continue;
        const tM = card.match(/name="title" value="([^"]*)"/)
          || card.match(/data-cy="offerTitle"[^>]*?\stitle="([^"]+)"/)
          || card.match(/<p class="typo-l[^"]*">([^<]+)<\/p>/);
        if (!tM || !tM[1].trim()) continue;
        const cM = card.match(/name="company" value="([^"]*)"/)
          || card.match(/<p class="typo-s inline">([^<]+)<\/p>/)
          || card.match(/<img[^>]+alt="([^"]+?) recrutement"/);
        const cityM = card.match(/data-cy="localisationCard"[\s\S]*?>\s*([^<]+?)\s*<\/div>/);
        const salM = card.match(/typo-s-bold[^>]*>\s*([^<]*?(?:&#x20AC;|&#8364;|€|\/ mois|\/ an)[^<]*?)\s*<\/div>/i);
        let remote = null, tagM;
        const tagRe = /data-cy="(?:contractCard|contractTag)"[\s\S]*?>\s*([^<]+?)\s*<\/div>/g;
        const tags = [];
        while ((tagM = tagRe.exec(card)) !== null) {
          const t = decode(tagM[1]); tags.push(t);
          if (/t[ée]l[ée]travail|remote|hybride|distanciel/i.test(t)) remote = t;
        }
        const ville = cityM ? decode(cityM[1]) : null;
        ajouter(out, vus, {
          source_name: 'hellowork',
          source_offer_id: idM[1],
          title: cut(decode(tM[1]), 500),
          company: cM && cM[1].trim() ? decode(cM[1]) : null,
          location: ville, city: ville && ville.includes(' - ') ? ville.split(' - ')[0].trim() : ville,
          country: 'France',
          contract_type: tags.find(t => /cdi|cdd|stage|freelance|int[ée]rim|alternance/i.test(t)) || null,
          remote, salary: salM ? decode(salM[1]) : null,
          description: null,   // la description n'est pas dans la page de résultats
          url: 'https://www.hellowork.com/fr-fr/emplois/' + idM[1] + '.html',
          contact_email: null, publication_date: publiee,
          raw: { requete: q, tags, anciennete: dM ? dM[1] : null },
        });
      }
      if (cartes === 0 || pageEpuisee(dates, fenetre)) break;
    }
  }
  return out;
}

export { collecteHelloWork };
