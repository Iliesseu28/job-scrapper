import { clean, ajouter, collecteParJobPosting, rotationDuJour } from './_shared.mjs';

// ----------------------------------------------------------------------------
// TALENT.COM — agrégateur, un domaine par pays (fr., be., ch., lu., ma., tn.,
// sn., ci.). Recherche `/jobs?k=<mots>&l=<pays en anglais>&p=N`, 20 cartes par
// page, fiche `/view?id=<id>`. Chaque domaine a son propre plafond `maxOffres`.
// ----------------------------------------------------------------------------
const DOMAINES_TALENT_DEFAUT = [
  { domaine: 'fr', lieu: 'France', pays: 'France' },
  { domaine: 'be', lieu: 'Belgium', pays: 'Belgique' },
  { domaine: 'ch', lieu: 'Switzerland', pays: 'Suisse' },
  { domaine: 'lu', lieu: 'Luxembourg', pays: 'Luxembourg' },
];

// Carte d'une offre dans la page de liste Talent.com (repli sans JobPosting).
function carteTalent(htmlListe, id) {
  const i = String(htmlListe || '').indexOf(`data-new-id="${id}"`);
  if (i < 0) return null;
  let bloc = htmlListe.slice(i, i + 12000);
  const fin = bloc.indexOf('</article>');
  if (fin > 0) bloc = bloc.slice(0, fin);
  const champ = (cls) => { const m = bloc.match(new RegExp(`JobCard_${cls}__[^"]*"[^>]*>([^<]*)<`)); return m ? clean(m[1]) : null; };
  // Pied de carte : <time class="JobCard_timeText__…" dateTime="2026-07-16T08:48:59Z"> —
  // seule date fiable côté fr. (les fiches fr n'ont souvent ni JSON-LD ni datePosted).
  const dt = bloc.match(/<time[^>]*dateTime="([^"]+)"/i);
  return { title: champ('title'), company: champ('company'), location: champ('location'), date: dt ? dt[1] : null };
}

async function collecteTalent(http, { queries = [], domaines = DOMAINES_TALENT_DEFAUT, pages = 1, maxOffres = 40, budgetMs = 90000, timeout = 20000, jour = undefined, fenetre = null, dejaVus = null } = {}) {
  const out = [];
  const vus = new Set();
  const stats = {};
  // maxOffres est un plafond GLOBAL (tous domaines confondus) réparti à parts
  // égales, budgetMs est partagé entre les domaines. Rotation quotidienne des
  // requêtes et des domaines : les derniers ne sont pas toujours sacrifiés.
  const dateLimite = Date.now() + budgetMs;
  const domainesTries = rotationDuJour(domaines.filter((d) => d && d.domaine), jour);
  const requetes = rotationDuJour(queries, jour);
  const parDomaine = Math.max(1, Math.ceil(maxOffres / Math.max(1, domainesTries.length)));
  for (const d of domainesTries) {
    const dom = d.domaine;
    if (out.length >= maxOffres) break;
    if (Date.now() > dateLimite) { stats[dom] = { budgetEpuise: true, saute: true }; continue; }
    const BASE = `https://${dom}.talent.com`;
    const series = requetes.map((q) => Array.from({ length: pages }, (_, i) => `${BASE}/jobs?k=${encodeURIComponent(q)}&l=${encodeURIComponent(d.lieu || '')}&p=${i + 1}`));
    let lot;
    try {
      lot = await collecteParJobPosting(http, {
        source_name: 'talent', series, maxOffres: Math.min(parDomaine, maxOffres - out.length), fenetre, dejaVus, dateLimite, timeout,
        regexLien: /\/view\?id=\d+/g,
        urlFiche: (c) => BASE + c,
        idFiche: (c) => c.replace(/^.*=/, ''),
        paysDefaut: d.pays || null,
        raw: () => ({ domaine: dom }),
        dateListe: (chemin, htmlListe) => (carteTalent(htmlListe, chemin.replace(/^.*=/, '')) || {}).date,
        enrichir: (offre, { id, htmlListe }) => {
          if (!offre.publication_date) { const c = carteTalent(htmlListe, id); if (c && c.date) offre.publication_date = c.date; }
          return offre;
        },
        repli: ({ id, url, page, htmlListe }) => {
          const carte = carteTalent(htmlListe, id) || {};
          const h1 = page.match(/<h1[^>]*>([^<]+)</);
          const meta = page.match(/<meta name="description" content="([^"]*)"/);
          const title = carte.title || (h1 ? clean(h1[1]) : null);
          if (!title) return null;
          const lieu = carte.location || null;
          return {
            source_name: 'talent', source_offer_id: id,
            title: title.slice(0, 500), company: carte.company || null,
            location: lieu, city: lieu ? lieu.split(',')[0].trim() : null, country: d.pays || null,
            contract_type: null, remote: null, salary: null,
            description: meta ? clean(meta[1]) : null,
            url, contact_email: null, publication_date: carte.date || null,
            raw: { domaine: dom, sans_jobposting: true },
          };
        },
      });
    } catch (e) { continue; }   // un domaine KO (403, DNS) ne coupe pas les autres
    stats[dom] = lot.stats;
    for (const o of lot) ajouter(out, vus, o);
  }
  out.stats = stats;
  return out;
}

export { DOMAINES_TALENT_DEFAUT, carteTalent, collecteTalent };
