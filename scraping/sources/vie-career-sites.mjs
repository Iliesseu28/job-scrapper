import { decodeEntitesHtml } from '../html-entities.mjs';
import { clean, ajouter, collecteParJobPosting } from './_shared.mjs';
import { MOIS_EN } from './jobs-lu.mjs';

// ============================================================================
// VIE — Volontariat International en Entreprise (radar du 06/09/2026). Civiweb (source `vie`) prend
// déjà 100 % du catalogue officiel ; ici on ajoute les VIE que les groupes
// publient sur leurs propres sites carrières et ceux relayés par Engagement
// Jeunes. ⚠️ Certains de ces sites (Veolia, Sanofi) interdisent `/search-jobs/`
// dans leur robots.txt : désactivée par défaut, à n'activer qu'en connaissance
// de cause (voir « Responsible use » dans le README).
//   · engagement_jeunes : liste filtrée contrat VIE (`contrat[]=6`), 20 cartes
//     par page triées par date, « Publiée le jj/mm/aaaa » lisible dès la liste,
//     fiche avec JSON-LD JobPosting complet.
//   · vie_entreprises : sites carrières lus par mot-clé (SuccessFactors, Radancy,
//     Avature, Crédit Agricole). Le mot-clé « VIE » est bruité (« auxiliaire de
//     vie », descriptions contenant « vie »…) : seuls les intitulés VIE sont
//     suivis (filtreLien), et une page de liste sans intitulé VIE arrête la série.
// ============================================================================

// « VIE », « V.I.E », « V.I.E. », « (VIE) », « VIE/PANGEO », « Volontariat
// International » — mais pas « auxiliaire de vie », « aide à la vie », « qualité
// de vie » : le sigle en capitales est exigé, « de/la/en vie » en minuscules refusé.
const estTitreVIE = (t) => {
  const s = String(t || '');
  if (/volontariat international/i.test(s)) return true;
  if (/\bauxiliaire\b|\baide[- ]/i.test(s)) return false;
  return /\bV\.?\s?I\.?\s?E\b/.test(s) && !/\b(de|la|en|à|of)\s+[Vv]ie\b/.test(s);
};

// Dates rencontrées sur ces sites → jour ISO (YYYY-MM-DD), sans passer par
// Date.parse quand il se trompe : « 03/07/2026 » (jj/mm/aaaa, Crédit Agricole ;
// Date.parse lirait le 7 mars), « 2026-8-5 » (Radancy), « 29 Aug 2026 » (liste
// SuccessFactors), « Sat Aug 29 02:00:00 UTC 2026 » (fiche SuccessFactors).
// Une forme inconnue est rendue telle quelle : une date illisible n'exclut jamais.
function normaliserDateVIE(s) {
  if (!s) return null;
  const t = String(s).trim();
  const iso = (a, m, j) => `${a}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
  let m;
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return iso(m[3], m[2], m[1]);
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(T\S*)?$/))) return iso(m[1], m[2], m[3]) + (m[4] || '');
  if ((m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/)) && MOIS_EN[m[2].toLowerCase()]) return iso(m[3], MOIS_EN[m[2].toLowerCase()], m[1]);
  if ((m = t.match(/^[A-Za-z]{3},?\s+([A-Za-z]{3})\s+(\d{1,2})\s+[\d:]+\s+[A-Z]{3,4}\s+(\d{4})$/)) && MOIS_EN[m[1].toLowerCase()]) return iso(m[3], MOIS_EN[m[1].toLowerCase()], m[2]);
  return t;
}

// Intitulé affiché pour un lien, tel qu'il apparaît dans la page de liste : le
// premier texte non vide après `href="<chemin>"` — ancre SuccessFactors et
// Crédit Agricole, <h2> ou <span> Radancy, ancre sur plusieurs lignes Avature.
function titreListeVIE(htmlListe, chemin) {
  const html = String(htmlListe || '');
  const i = html.indexOf(chemin + '"');
  if (i < 0) return null;
  const m = html.slice(i, i + 1500).match(/^[^>]*>\s*(?:<[^>]+>\s*)*([^<]+)</);
  return m ? clean(decodeEntitesHtml(m[1])) : null;
}

// --- Sites carrières des groupes ----------------------------------------------
// Fiche SuccessFactors : microdata schema.org sans JSON-LD (itemprop="title",
// <meta itemprop="datePosted" content="Sat Aug 29 02:00:00 UTC 2026">,
// hiringOrganization, streetAddress « Salzgitter, DE », description jusqu'au
// bouton « Apply »). Ligne de liste : <span class="jobDate">29 Aug 2026</span>.
function dateListeSuccessFactors(htmlListe, chemin) {
  const html = String(htmlListe || '');
  const i = html.indexOf(chemin + '"');
  if (i < 0) return null;
  const m = html.slice(i, i + 4000).match(/class="jobDate[^"]*"[^>]*>\s*([^<]+?)\s*</);
  return m ? normaliserDateVIE(m[1]) : null;
}
function repliSuccessFactors({ id, url, page, htmlListe, chemin }, site) {
  const meta = (k) => { const m = page.match(new RegExp(`itemprop="${k}"[^>]*content="([^"]*)"`)); return m ? clean(decodeEntitesHtml(m[1])) : null; };
  const t = page.match(/itemprop="title"[^>]*>([^<]+)</);
  const title = t ? clean(decodeEntitesHtml(t[1])) : titreListeVIE(htmlListe, chemin);
  if (!title) return null;
  const desc = page.match(/itemprop="description"[^>]*>([\s\S]*?)<a [^>]*class="[^"]*\bapply\b/);
  const adresse = meta('streetAddress');
  const [ville, pays] = adresse ? adresse.split(',').map((x) => x.trim()) : [null, null];
  return {
    source_name: 'vie_entreprises', source_offer_id: id,
    title: title.slice(0, 500), company: meta('hiringOrganization') || site.nom || null,
    location: adresse || null, city: ville || null, country: pays || null,
    contract_type: 'VIE', remote: null, salary: null,
    description: desc ? texteHtmlVIE(desc[1]).slice(0, 6000) || null : null,
    url, contact_email: null, publication_date: normaliserDateVIE(meta('datePosted')),
    raw: { site: site.nom, moteur: 'successfactors', sans_jobposting: true },
  };
}

// Fiche Avature (TotalEnergies) : ni JSON-LD ni date. Titre dans og:title,
// champs <dt>Pays</dt><dd>…</dd> (Pays, Ville, Lieu de travail, Société
// employeur, Type de contrat), texte dans les blocs `js_collapsible__content`.
function repliAvature({ id, url, page, htmlListe, chemin }, site) {
  const og = page.match(/<meta property="og:title" content="([^"]*)"/);
  const title = og ? clean(decodeEntitesHtml(og[1])) : titreListeVIE(htmlListe, chemin);
  if (!title) return null;
  const champ = (label) => { const m = page.match(new RegExp(`${label}\\s*</dt>\\s*<dd[^>]*>\\s*([^<]+)`)); return m ? clean(decodeEntitesHtml(m[1])) : null; };
  const pays = champ('Pays'), ville = champ('Ville') || champ('Lieu de travail');
  const parts = page.split('js_collapsible__content'); parts.shift();
  const blocs = parts.map((p) => { const fin = p.search(/js_collapsible__header|<\/section>|<footer/); return texteHtmlVIE(p.slice(p.indexOf('>') + 1, fin > 0 ? fin : 8000)); }).filter(Boolean);
  return {
    source_name: 'vie_entreprises', source_offer_id: id,
    title: title.slice(0, 500), company: champ('Société employeur') || site.nom || null,
    location: [ville, pays].filter(Boolean).join(', ') || null, city: ville || null, country: pays || null,
    contract_type: 'VIE', remote: null, salary: null,
    description: blocs.join('\n\n').slice(0, 6000) || null,
    url, contact_email: null, publication_date: null,
    raw: { site: site.nom, moteur: 'avature', sans_jobposting: true, sans_date: true },
  };
}
// HTML de fiche → texte (balises retirées, entités décodées, blancs repliés).
const texteHtmlVIE = (h) => clean(decodeEntitesHtml(String(h || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')));

// Un « moteur » par gabarit de site carrières : pages de liste pour une requête,
// forme des liens de fiche, identifiant, et quoi faire quand la fiche n'a pas
// de JSON-LD. Un site = { nom, moteur, base, requete, lang?, pages?, maxOffres? }
// dans profil/sources.yaml (`sitesVIE`).
const MOTEURS_VIE = {
  // SuccessFactors (SAP) — Alstom, CMA CGM : /search/?q=<mot>&startrow=N, 25 par page.
  successfactors: {
    pages: (s) => Array.from({ length: s.pages || 1 }, (_, i) => `${s.base}/search/?q=${encodeURIComponent(s.requete)}${i ? `&startrow=${i * 25}` : ''}`),
    regexLien: /\/job\/[A-Za-z0-9%._~-]+\/\d+\/?/g,
    id: (c) => c.replace(/\/$/, '').replace(/^.*\//, ''),
    dateListe: dateListeSuccessFactors,
    repli: repliSuccessFactors,
  },
  // Radancy — Veolia, Vinci, Sanofi : /<lang>/search-jobs/<mot>, ~45 cartes, la
  // page 2 perd le mot-clé (une seule page). Fiche JSON-LD, dates parfois « 2026-8-5 ».
  radancy: {
    pages: (s) => [`${s.base}/${s.lang || 'en'}/search-jobs/${encodeURIComponent(s.requete)}`],
    regexLien: /\/[a-z]{2}(?:-[a-z]{2})?\/job\/[A-Za-z0-9%._~-]+\/[A-Za-z0-9%._~-]+\/\d+\/\d+/g,
    id: (c) => c.replace(/^.*\//, ''),
  },
  // Avature — TotalEnergies : /<lang>/careers/SearchJobs/<mot>?jobOffset=N, 20 par page.
  avature: {
    pages: (s) => Array.from({ length: s.pages || 1 }, (_, i) => `${s.base}/${s.lang || 'fr_FR'}/careers/SearchJobs/${encodeURIComponent(s.requete)}${i ? `?jobOffset=${i * 20}` : ''}`),
    regexLien: /\/[a-z]{2}_[A-Z]{2}\/careers\/JobDetail\/[A-Za-z0-9%._~-]+\/\d+/g,
    id: (c) => c.replace(/^.*\//, ''),
    repli: repliAvature,
  },
  // Crédit Agricole (site maison) : /fr/nos-offres/?keyword=<mot>, une seule
  // page (la pagination perd le mot-clé) ; fiche JSON-LD, datePosted en jj/mm/aaaa.
  credit_agricole: {
    pages: (s) => [`${s.base}/fr/nos-offres/?keyword=${encodeURIComponent(s.requete)}`],
    regexLien: /\/fr\/nos-offres-emploi\/\d+-[A-Za-z0-9%._~-]+\/?/g,
    id: (c) => c.replace(/^\/fr\/nos-offres-emploi\/(\d+)-.*$/, '$1'),
  },
};

// `maxOffres` = fiches lues PAR SITE (s.maxOffres le surcharge), `budgetMs` =
// budget de temps pour l'ensemble des sites. Identifiant `<hôte>:<id>` : les
// numéros SuccessFactors ou Radancy ne sont pas uniques d'un groupe à l'autre.
async function collecteSitesVIE(http, { sites = [], maxOffres = 30, budgetMs = 120000, timeout = 20000, fenetre = null, dejaVus = null } = {}) {
  const out = [];
  const vus = new Set();
  const stats = {};
  const dateLimite = Date.now() + budgetMs;
  for (const site of sites) {
    const cle = (site && (site.nom || site.base)) || '?';
    const moteur = MOTEURS_VIE[site && site.moteur];
    if (!moteur || !site.base) { stats[cle] = { erreur: `moteur inconnu ou base absente : ${site && site.moteur}` }; continue; }
    if (Date.now() > dateLimite) { stats[cle] = { budgetEpuise: true, saute: true }; continue; }
    const s = { requete: 'VIE', ...site, base: String(site.base).replace(/\/+$/, '') };
    const hote = s.base.replace(/^https?:\/\//, '');
    let lot;
    try {
      lot = await collecteParJobPosting(http, {
        source_name: 'vie_entreprises', series: [moteur.pages(s)], regexLien: moteur.regexLien,
        urlFiche: (c) => s.base + c,
        idFiche: (c) => `${hote}:${moteur.id(c)}`,
        maxOffres: s.maxOffres || maxOffres, dateLimite, timeout, fenetre, dejaVus,
        filtreLien: (c, htmlListe) => estTitreVIE(titreListeVIE(htmlListe, c)),
        dateListe: moteur.dateListe ? (c, htmlListe) => moteur.dateListe(htmlListe, c) : null,
        raw: () => ({ site: s.nom || hote, moteur: s.moteur }),
        repli: moteur.repli ? (ctx) => moteur.repli(ctx, s) : null,
        enrichir: (offre) => {
          offre.publication_date = normaliserDateVIE(offre.publication_date);
          offre.contract_type = 'VIE';   // l'intitulé a passé estTitreVIE : c'est un VIE quoi qu'en dise le JSON-LD
          // Radancy : le hiringOrganization du JSON-LD reprend l'intitulé (« VIE/PANGEO HSE REFERENT…, GERMANY, VIE/PANGEO ») → nom du site.
          if (!offre.company || s.moteur === 'radancy') offre.company = s.nom || offre.company || null;
          return offre;
        },
      });
    } catch (e) { stats[cle] = { erreur: String(e.message || e).slice(0, 160) }; continue; }   // un site KO ne coupe pas les autres
    stats[cle] = lot.stats;
    for (const o of lot) ajouter(out, vus, o);
  }
  out.stats = stats;
  return out;
}

export { estTitreVIE, normaliserDateVIE, titreListeVIE, dateListeSuccessFactors, repliSuccessFactors, repliAvature, texteHtmlVIE, MOTEURS_VIE, collecteSitesVIE };
