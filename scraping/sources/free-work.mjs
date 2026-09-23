import { decodeEntitesHtml } from '../html-entities.mjs';
import { UA, horsFenetre, ajouter, dateFreeWork } from './_shared.mjs';

// ============================================================================
// FREE-WORK — offres tech France (CDI + freelance)
// ----------------------------------------------------------------------------
// Trouvé le 17/08/2026 en testant les job boards francophones un par un.
// Pourquoi celui-là et pas les autres :
//   · robots.txt n'interdit que /login, /logout et /fw-deals — les pages
//     d'offres sont explicitement explorables ;
//   · les résultats de recherche sont rendus PAR LE SERVEUR (pas de JavaScript
//     à exécuter), 16 offres par page, pagination `?page=N` fonctionnelle ;
//   · chaque fiche porte un bloc **schema.org JobPosting** complet : intitulé,
//     entreprise, ville, code postal, date de publication, type de contrat,
//     description entière ET **salaire** — c'est la seule source francophone
//     testée qui donne le salaire de façon structurée.
//
// Le salaire compte double ici : c'est la condition des postes « faire adopter
// l'IA » (voir scoring/), et la plupart des sources n'en donnent aucun.
//
// Coût : une requête par page de résultats + une par offre. On plafonne
// volontairement (voir `maxOffres`) pour rester un visiteur poli.
// ============================================================================
async function collecteFreeWork(http, { queries = [], pages = 1, maxOffres = 45, fenetre = null, dejaVus = null, pagesMax = 5 } = {}) {
  const BASE = 'https://www.free-work.com';
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
  const entetes = { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' };

  // 1) Pages de résultats : le lien de chaque offre + sa date « Publiée le
  //    08/24/2026 » (la première balise <time> qui suit le lien, vérifié le
  //    06/09/2026). Le tri est par pertinence, pas par date : on lit donc toutes
  //    les pages, mais on ne descend PAS sur une fiche déjà en base (`dejaVus`)
  //    ni antérieure à la fenêtre. C'est là qu'est l'économie : une requête par
  //    fiche évitée, contre une seule par page de liste.
  //    Avant (jusqu'au 06/09/2026), un plafond global de liens coupait la
  //    boucle dès la première requête ; chaque requête a maintenant ses pages.
  const candidats = new Map();   // chemin → jour de publication (ou null si inconnu)
  const nbPages = fenetre ? Math.max(pages, pagesMax) : pages;
  const re = /(\/fr\/tech-it\/job-mission\/[a-z0-9-]+\/[a-z0-9-]+)|<time[^>]*>([^<]*)<\/time>/g;
  for (const q of queries) {
    for (let p = 1; p <= nbPages; p++) {
      const url = `${BASE}/fr/tech-it/jobs?query=${encodeURIComponent(q)}&page=${p}`;
      let html;
      try { html = await http({ url, headers: entetes, brut: true }); } catch (e) { break; }
      if (typeof html !== 'string') break;
      let nouveaux = 0, courant = null, m;
      re.lastIndex = 0;
      while ((m = re.exec(html)) !== null) {
        if (m[1]) {
          courant = m[1];
          if (!candidats.has(courant)) { candidats.set(courant, null); nouveaux++; }
        } else if (courant && candidats.get(courant) === null) {
          candidats.set(courant, dateFreeWork(m[2]));
        }
      }
      if (nouveaux === 0) break;   // page vide ou déjà vue : fin de la pagination
    }
  }

  // 2) Chaque fiche porte son JobPosting : c'est lui qu'on lit, pas le HTML.
  //    Une requête par fiche, seulement pour ce qui vaut le coup.
  const texte = (v) => (typeof v === 'string' ? v : (v && v.name) || null);
  const out = [];
  const vus = new Set();
  const stats = { liens: candidats.size, dejaConnues: 0, tropVieilles: 0, fichesLues: 0 };
  for (const [chemin, publiee] of candidats) {
    const id = chemin.split('/').pop();
    if (dejaVus && dejaVus.has(id)) { stats.dejaConnues++; continue; }
    if (horsFenetre(publiee, fenetre)) { stats.tropVieilles++; continue; }
    if (stats.fichesLues >= maxOffres) break;
    stats.fichesLues++;
    let page;
    try { page = await http({ url: BASE + chemin, headers: entetes, brut: true }); } catch (e) { continue; }

    let jp = null;
    const blocs = page.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g) || [];
    for (const b of blocs) {
      const brut = b.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/, '');
      try {
        const d = JSON.parse(brut);
        if (d && d['@type'] === 'JobPosting') { jp = d; break; }
      } catch (e) { /* bloc illisible : on passe */ }
    }
    if (!jp || !jp.title) continue;

    const lieu = jp.jobLocation && jp.jobLocation.address ? jp.jobLocation.address : {};
    // Le salaire arrive en objet MonetaryAmount ; on le rend lisible tel quel.
    let salaire = null;
    const bs = jp.baseSalary;
    if (bs && bs.value) {
      const v = bs.value;
      const montant = v.value || (v.minValue && v.maxValue ? `${v.minValue} - ${v.maxValue}` : v.minValue || v.maxValue);
      if (montant) salaire = `${montant} ${bs.currency || 'EUR'}${v.unitText ? ' / ' + v.unitText : ''}`;
    }
    const types = Array.isArray(jp.employmentType) ? jp.employmentType : (jp.employmentType ? [jp.employmentType] : []);
    // Balises retirées AVANT, entités décodées ENSUITE (jamais l'inverse), puis
    // un second retrait au cas où une entité décodée dessine elle-même une balise.
    const description = decodeEntitesHtml(String(jp.description || '').replace(/<[^>]+>/g, ' ')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const ville = decodeEntitesHtml(lieu.addressLocality) || null;

    ajouter(out, vus, {
      source_name: 'free_work',
      source_offer_id: id,
      title: decodeEntitesHtml(jp.title).slice(0, 500),
      company: decodeEntitesHtml(texte(jp.hiringOrganization)),
      location: [ville, lieu.postalCode].filter(Boolean).join(' ') || null,
      city: ville,
      country: lieu.addressCountry ? texte(lieu.addressCountry) : 'France',
      contract_type: types.join(', ') || null,
      // Free-Work n'a pas de champ « télétravail » structuré : le mot vit dans
      // la description, où la passe IA le trouvera.
      remote: /t[ée]l[ée]travail|remote|distanciel/i.test(description) ? 'mentionné dans l’annonce' : null,
      salary: salaire,
      description: description.slice(0, 6000) || null,
      url: BASE + chemin,
      contact_email: null,
      publication_date: jp.datePosted || publiee || null,
      raw: { valide_jusqu_au: jp.validThrough || null, publiee_liste: publiee },
    });
  }
  out.stats = stats;
  return out;
}

export { collecteFreeWork };
