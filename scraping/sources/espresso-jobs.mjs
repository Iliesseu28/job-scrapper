import { decodeEntitesHtml } from '../html-entities.mjs';
import { UA, horsFenetre, ajouter, dateRelativeFr } from './_shared.mjs';

// ============================================================================
// ESPRESSO-JOBS — emplois tech au Québec
// ----------------------------------------------------------------------------
// Trouvé le 17/08/2026, et intégré au deuxième essai.
//
// Première approche (abandonnée) : passer par le sitemap `.xml.gz`. Elle marche
// en local mais rend ZÉRO dans un bac à sable n8n — le bac à sable n'y décompresse pas le
// gzip. Vérifié dans le journal d'exécution : « espresso_jobs : 0 en 559 ms ».
//
// Approche retenue : la page de recherche `/emploi?keyword=...&page_no=N` est
// rendue PAR LE SERVEUR et contient les URL complètes des offres (21 par page).
// Aucun gzip, aucune dépendance exotique. Les fiches portent un schema.org
// JobPosting complet, salaire en dollars canadiens compris.
// ============================================================================
async function collecteEspressoJobs(http, { queries = [], pages = 1, maxOffres = 40, fenetre = null, dejaVus = null, pagesMax = 5 } = {}) {
  const BASE = 'https://www.espresso-jobs.com';
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
  const entetes = { 'User-Agent': UA, 'Accept-Language': 'fr-CA,fr;q=0.9' };

  // 1) Les pages de recherche donnent le lien de chaque offre et, juste après,
  //    son ancienneté (<span class="publish-time">Publié il y a 29 jours</span>,
  //    « hier », « Aujourd'hui » — vérifié le 06/09/2026). Même logique que
  //    Free-Work : on ne descend sur une fiche que si elle est nouvelle en base
  //    et dans la fenêtre. Chaque requête a ses propres pages (l'ancien plafond
  //    global coupait dès la première requête).
  const candidats = new Map();   // chemin → jour de publication (ou null si inconnu)
  const nbPages = fenetre ? Math.max(pages, pagesMax) : pages;
  const re = /href="(?:https:\/\/www\.espresso-jobs\.com)?(\/emploi\/\d+\/[a-z0-9-]+)"|class="publish-time"[^>]*>([^<]*)</g;
  for (const q of queries) {
    for (let p = 1; p <= nbPages; p++) {
      const url = `${BASE}/emploi?keyword=${encodeURIComponent(q)}&page_no=${p}`;
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
          candidats.set(courant, dateRelativeFr(m[2]));
        }
      }
      if (nouveaux === 0) break;
    }
  }

  // 2) une requête par fiche, on lit le JobPosting — seulement pour ce qui vaut le coup
  const texte = (v) => (typeof v === 'string' ? v : (v && v.name) || null);
  const out = [];
  const vus = new Set();
  const stats = { liens: candidats.size, dejaConnues: 0, tropVieilles: 0, fichesLues: 0 };
  for (const [chemin, publiee] of candidats) {
    const id = (chemin.match(/\/emploi\/(\d+)\//) || [])[1] || chemin;
    if (dejaVus && dejaVus.has(id)) { stats.dejaConnues++; continue; }
    if (horsFenetre(publiee, fenetre)) { stats.tropVieilles++; continue; }
    if (stats.fichesLues >= maxOffres) break;
    stats.fichesLues++;
    let page;
    try { page = await http({ url: BASE + chemin, headers: entetes, brut: true }); } catch (e) { continue; }

    let jp = null;
    for (const b of page.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g) || []) {
      const brut = b.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/, '');
      try {
        const d = JSON.parse(brut);
        for (const o of (Array.isArray(d) ? d : [d])) {
          if (o && o['@type'] === 'JobPosting') { jp = o; break; }
        }
      } catch (e) { /* bloc illisible */ }
      if (jp) break;
    }
    if (!jp || !jp.title) continue;

    const adr = ((jp.jobLocation || {}).address) || {};
    let salaire = null;
    const bs = jp.baseSalary;
    if (bs && bs.value) {
      const v = bs.value;
      const montant = v.value || (v.minValue && v.maxValue ? `${v.minValue} - ${v.maxValue}` : v.minValue || v.maxValue);
      if (montant) salaire = `${montant} ${bs.currency || 'CAD'}${v.unitText ? ' / ' + v.unitText : ''}`;
    }
    // Balises retirées AVANT, entités décodées ENSUITE (jamais l'inverse), puis
    // un second retrait au cas où une entité décodée dessine elle-même une balise.
    const description = decodeEntitesHtml(String(jp.description || '').replace(/<[^>]+>/g, ' ')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const types = Array.isArray(jp.employmentType) ? jp.employmentType : (jp.employmentType ? [jp.employmentType] : []);
    const ville = decodeEntitesHtml(adr.addressLocality) || null;

    ajouter(out, vus, {
      source_name: 'espresso_jobs',
      source_offer_id: id,
      title: decodeEntitesHtml(jp.title).slice(0, 500),
      company: decodeEntitesHtml(texte(jp.hiringOrganization)),
      location: ville,
      city: ville,
      // Site 100 % québécois : on le dit explicitement, sinon la règle
      // « Canada = Québec uniquement » du filtre écarterait ces offres.
      country: 'Canada (Québec)',
      contract_type: types.join(', ') || null,
      remote: /t[ée]l[ée]travail|remote|hybride/i.test(description) ? 'mentionné dans l’annonce' : null,
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

export { collecteEspressoJobs };
