import { decodeEntitesHtml } from '../html-entities.mjs';
import { UA, cut } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 11 bis. Rekrute — HTML (pas d'API, pas de JSON-LD par offre)
// ---------------------------------------------------------------------------
// Ajouté le 15/08/2026. Le plus gros job board du Maroc, une des zones
// prioritaires. Même approche que HelloWork : découpage sur les cartes,
// aucun format structuré à extraire.
// Format constant du titre : « Poste | Ville (Pays) » — c'est de là qu'on
// tire la ville, le champ ne l'annonce nulle part ailleurs sur la carte.
async function collecteRekrute(http, { queries, pagesParRequete = 2 }) {
  const out = [];
  const decode = (s) => !s ? s : decodeEntitesHtml(s).replace(/\s+/g, ' ').trim();

  for (const q of queries) {
    for (let p = 1; p <= pagesParRequete; p++) {
      let html;
      try {
        html = await http({
          method: 'GET', brut: true,
          url: `https://www.rekrute.com/offres.html?keyword=${encodeURIComponent(q)}&st=d${p > 1 ? '&p=' + p : ''}`,
          headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-FR,fr;q=0.9' },
        });
      } catch (e) { continue; }
      if (typeof html !== 'string') continue;

      const parts = html.split(/(<li class="post-id" id="\d+")/);
      for (let i = 1; i < parts.length; i += 2) {
        const card = parts[i] + (parts[i + 1] || '');
        const idM = parts[i].match(/id="(\d+)"/);
        if (!idM) continue;
        const tM = card.match(/class='titreJob' href="([^"]+)">\s*([\s\S]*?)<\/a>/);
        if (!tM) continue;
        const compM = card.match(/alt="([^"]+)"\s+title="[^"]*"\s+class="photo"/);
        const descM = card.match(/color:\s*#5b5b5b[^>]*>\s*([\s\S]*?)<\/span>/);
        const dateM = card.match(/Publication\s*:\s*du\s*<span>([^<]+)<\/span>/);
        // Le titre suit toujours « Poste | Ville (Pays) » — c'est le seul
        // endroit où la ville apparaît sur la carte de résultats.
        const titreBrut = decode(tM[2]);
        const [poste, lieuBrut] = titreBrut.split('|').map((s) => s && s.trim());
        const villeM = (lieuBrut || '').match(/^([^(]+)/);
        const ville = villeM ? villeM[1].trim() : null;
        let date = null;
        if (dateM) {
          const [j, m, a] = dateM[1].trim().split('/');
          if (j && m && a) date = `${a}-${m}-${j}`;
        }
        out.push({
          source_name: 'rekrute',
          source_offer_id: idM[1],
          title: cut(poste || titreBrut, 500),
          company: compM ? decode(compM[1]) : null,
          location: ville ? `${ville}, Maroc` : 'Maroc',
          city: ville,
          country: 'Morocco',
          contract_type: null,
          remote: null,
          salary: null,
          description: descM ? cut(decode(descM[1]), 4000) : null,
          url: 'https://www.rekrute.com' + tM[1],
          contact_email: null,
          publication_date: date,
          raw: { requete: q },
        });
      }
    }
  }
  return out;
}

export { collecteRekrute };
