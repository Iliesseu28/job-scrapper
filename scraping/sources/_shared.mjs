import { decodeEntitesHtml } from '../html-entities.mjs';
import { collecteJobsLu } from './jobs-lu.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Retire les balises HTML D'ABORD, décode les entités ENSUITE, jamais l'inverse :
// décoder avant le retrait des balises laisserait passer une vraie balise <script>
// dans le texte final si la source arrive déjà échappée ("&lt;script&gt;"), puisque
// le retrait de balises ne tourne alors qu'une fois, sur le texte encore encodé, et
// ne la verrait jamais. Un second retrait de balises après le décodage referme cette
// porte : toute séquence qui ressemble à une balise UNE FOIS décodée est retirée elle
// aussi, qu'elle vienne du HTML d'origine ou d'une entité qui vient d'être décodée.
// L'ancienne version de cette fonction remplaçait en plus les entités par une espace
// au lieu de les décoder (ex. "M&uuml;ller" devenait "M ller") : corrigé le 05/09/2026.
const clean = (s) => (typeof s === 'string'
  ? decodeEntitesHtml(s.replace(/<[^>]+>/g, ' ')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  : null);
const cut = (s, n) => (s ? String(s).slice(0, n) : null);

// ---------------------------------------------------------------------------
// 0. Fenêtre de collecte incrémentale (06/09/2026)
// ---------------------------------------------------------------------------
// Avant : chaque passage redemandait aux sources la même première page (100
// offres, tri pertinence ou date), tous les matins. Résultat : on relisait les
// mêmes offres chaque jour ET on ratait tout ce qui dépassait la page 1 les
// jours chargés (WTTJ « AI Engineer » : 1 300 offres sur 3 jours, 100 lues).
// Maintenant chaque collecteur pagine jusqu'à la date `depuis` de la fenêtre,
// puis s'arrête :
//   fenêtre = jours écoulés depuis la fin du dernier passage + margeJours,
//   plafonnée à fraicheurJours ; sans historique (premier passage) : fraicheurJours.
// La marge couvre les offres publiées en retard par les sources et un passage
// qui aurait échoué. Tout ce qui est plus vieux que `depuis` est déjà en base
// (ou déjà rejeté) : le relire ne ferait que réécrire la même ligne — c'est
// exactement l'effort en trop qu'on supprime.
const MARGE_JOURS_DEFAUT = 2;
function fenetreCollecte({ fraicheurJours = 10, margeJours = MARGE_JOURS_DEFAUT, dernierPassage = null, joursForces = null, maintenant = Date.now() } = {}) {
  const now = typeof maintenant === 'number' ? maintenant : new Date(maintenant).getTime();
  const plafond = Math.max(1, Math.ceil(Number(fraicheurJours) || 10));
  const marge = Number.isFinite(Number(margeJours)) && Number(margeJours) >= 0 ? Number(margeJours) : MARGE_JOURS_DEFAUT;
  let jours = plafond;
  let raison = 'no previous run: full window';
  if (Number(joursForces) > 0) {
    jours = Math.min(plafond, Math.ceil(Number(joursForces)));
    raison = 'forced window';
  } else if (dernierPassage) {
    const t = new Date(dernierPassage).getTime();
    if (Number.isFinite(t) && t <= now) {
      const ecoules = (now - t) / 86400000;
      jours = Math.max(1, Math.min(plafond, Math.round(ecoules) + marge));
      raison = `last run ${ecoules.toFixed(1)} days ago + ${marge}-day margin`;
    }
  }
  // Borne posée au début du jour (UTC) : les sources qui ne donnent que le jour
  // de publication (APEC, HelloWork, Free-Work…) se comparent sans effet d'heure.
  const d = new Date(now - jours * 86400000);
  const depuisMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return {
    jours, heures: jours * 24,
    depuis: new Date(depuisMs).toISOString(), depuisMs, depuisSecondes: Math.floor(depuisMs / 1000),
    dernierPassage: dernierPassage || null, margeJours: marge, raison,
  };
}

// `true` si la date est connue ET antérieure à la fenêtre. Une date absente ou
// illisible n'exclut jamais une offre : dans le doute, on la garde.
const horsFenetre = (date, fenetre) => {
  if (!fenetre || !date) return false;
  const t = Date.parse(String(date));
  return Number.isFinite(t) && t < fenetre.depuisMs;
};
// `true` quand TOUTE une page de résultats triés par date est antérieure à la
// fenêtre : inutile de demander la suivante.
const pageEpuisee = (dates, fenetre) => !!fenetre && dates.length > 0 && dates.every((x) => horsFenetre(x, fenetre));
// Dédoublonnage dans un même passage : la même offre ressort pour plusieurs
// requêtes (« AI Engineer » puis « Machine Learning Engineer »…) ; on ne
// l'envoie qu'une fois à l'écriture. Rend `true` si l'offre est nouvelle.
const ajouter = (out, vus, offre) => {
  const k = offre.source_offer_id ? String(offre.source_offer_id) : null;
  if (k) { if (vus.has(k)) return false; vus.add(k); }
  out.push(offre);
  return true;
};

// « il y a 3 heures », « hier », « Publié il y a 29 jours », « Aujourd'hui »…
// → jour de publication ISO (YYYY-MM-DD), ou null si la tournure est inconnue.
function dateRelativeFr(texte, maintenant = Date.now()) {
  if (!texte) return null;
  const t = String(texte).toLowerCase().replace(/\s+/g, ' ').trim();
  let ms;
  if (/aujourd.hui|l.instant|minute|heure/.test(t)) {
    const m = t.match(/(\d+)\s*heure/);
    ms = maintenant - (m ? Number(m[1]) * 3600000 : 0);
  } else if (/\bhier\b/.test(t)) {
    ms = maintenant - 86400000;
  } else {
    const m = t.match(/(\d+)\+?\s*(jour|semaine|mois|an)/);
    if (!m) return null;
    ms = maintenant - Number(m[1]) * { jour: 1, semaine: 7, mois: 30, an: 365 }[m[2]] * 86400000;
  }
  return new Date(ms).toISOString().slice(0, 10);
}

// Free-Work affiche « Publiée le 08/24/2026 » : mois/jour/année, à l'américaine.
function dateFreeWork(texte) {
  const s = String(texte || '').trim();
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : dateRelativeFr(s);
}
// ============================================================================
// CINQ SOURCES FRANCOPHONES DE PLUS — Talent.com, JobTeaser, LesJeudis,
// jobs.lu, JobScout24 (Suisse). Ajoutées le 06/09/2026.
// ----------------------------------------------------------------------------
// D'où elles viennent : prospection Firecrawl + Perplexity + curl du
// 06/09/2026. Sept sites tenaient sur le papier ; cinq ont
// passé la vérification HTTP réelle (page de liste lisible par un GET simple,
// fiche exploitable), deux ont été écartés (Eluta : liste rendue en JavaScript ;
// ChooseYourBoss : recherche derrière un formulaire POST + captcha).
//
// Le point commun des quatre premières : chaque fiche porte un bloc
// schema.org JobPosting, exactement comme Free-Work et Espresso-Jobs. Plutôt
// que de recopier une quatrième fois la même lecture de JSON-LD, elle est
// mise en commun ci-dessous (`lireJobPosting`, `offreDepuisJobPosting`,
// `collecteParJobPosting`). jobs.lu n'a pas de JSON-LD : sa fiche est un
// HTML ASP.NET très stable (<dt>/<dd>), lue à la main dans `collecteJobsLu`.
//
// Ce qu'on a appris en vérifiant (à relire avant de toucher aux regex) :
//   · Talent.com met son JobPosting dans une enveloppe `@graph`, et certaines
//     fiches (offres reprises d'autres sites) n'en ont AUCUN : on retombe alors
//     sur la carte de la page de liste (titre, entreprise, lieu) + la
//     <meta name="description"> de la fiche. Le domaine `ca.talent.com`
//     répond 403 depuis la France : il n'est pas dans la liste par défaut.
//   · LesJeudis livre la description déjà échappée (« &lt;strong&gt; ») —
//     d'où l'ordre balises-puis-entités-puis-balises de `clean`, jamais l'inverse.
//   · JobScout24 met le mot-clé dans le CHEMIN (/fr/jobs/<slug>/?p=N), pas
//     dans la query string ; ses dates ont 7 décimales (« .1830000 »), Date.parse
//     les lit quand même.
//   · jobs.lu redirige vers en.jobs.lu et affiche 40 offres par page ; la date
//     de liste est « 02 Sep » ou « Today », la fiche donne « 02 September 2026 ».
// ============================================================================

const UA_NAVIGATEUR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const ENTETES_FR = { 'User-Agent': UA_NAVIGATEUR, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5' };

// Cherche un JobPosting dans les <script type="application/ld+json"> d'une page :
// objet seul, tableau d'objets, ou enveloppe { "@graph": [...] } (Talent.com).
// Rend le premier JobPosting qui a un titre, sinon null.
function lireJobPosting(html) {
  const blocs = String(html || '').match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g) || [];
  for (const b of blocs) {
    const brut = b.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/, '');
    let d;
    try { d = JSON.parse(brut); } catch (e) { continue; }
    const pile = Array.isArray(d) ? [...d] : [d];
    while (pile.length) {
      const o = pile.shift();
      if (!o || typeof o !== 'object') continue;
      if (o['@type'] === 'JobPosting' && o.title) return o;
      if (Array.isArray(o['@graph'])) pile.push(...o['@graph']);
    }
  }
  return null;
}

// Un champ schema.org est tantôt une chaîne, tantôt un objet { name } : on veut le texte.
const texteSchema = (v) => (typeof v === 'string' ? v : (v && typeof v === 'object' && v.name) || null);

// JobPosting → offre normalisée. Même lecture que Free-Work et Espresso-Jobs.
function offreDepuisJobPosting(jp, { source_name, source_offer_id, url, paysDefaut = null, deviseDefaut = 'EUR', raw = {} }) {
  const lieu = (Array.isArray(jp.jobLocation) ? jp.jobLocation[0] : jp.jobLocation) || {};
  const adr = lieu.address || {};
  let salaire = null;
  const bs = jp.baseSalary;
  if (bs && bs.value) {
    const v = bs.value;
    const montant = v.value || (v.minValue && v.maxValue ? `${v.minValue} - ${v.maxValue}` : v.minValue || v.maxValue);
    if (montant) salaire = `${montant} ${bs.currency || deviseDefaut}${v.unitText ? ' / ' + v.unitText : ''}`;
  }
  const description = clean(String(jp.description || '')) || '';
  const types = Array.isArray(jp.employmentType) ? jp.employmentType : (jp.employmentType ? [jp.employmentType] : []);
  const ville = decodeEntitesHtml(adr.addressLocality) || null;
  const pays = texteSchema(adr.addressCountry) || paysDefaut;
  const teletravail = jp.jobLocationType === 'TELECOMMUTE' || /t[ée]l[ée]travail|remote|distanciel|hybride/i.test(description);
  return {
    source_name,
    source_offer_id,
    title: decodeEntitesHtml(jp.title).slice(0, 500),
    company: decodeEntitesHtml(texteSchema(jp.hiringOrganization)),
    location: [ville, adr.addressRegion, pays].filter(Boolean).join(', ') || null,
    city: ville,
    country: pays,
    contract_type: types.join(', ') || null,
    remote: teletravail ? 'mentionné dans l’annonce' : null,
    salary: salaire,
    description: description.slice(0, 6000) || null,
    url,
    contact_email: null,
    publication_date: jp.datePosted || null,
    raw: { valide_jusqu_au: jp.validThrough || null, ...raw },
  };
}

// Moteur commun : pages de liste → liens de fiches → une requête par fiche.
//   series    : une liste d'URL de pages PAR REQUÊTE ; dans une série, on
//               s'arrête dès qu'une page n'apporte plus aucun lien nouveau.
//   regexLien : trouve les chemins de fiches dans le HTML d'une page de liste.
//   urlFiche / idFiche : chemin → URL absolue / identifiant stable.
//   repli     : ({ chemin, id, url, page, htmlListe }) → offre ou null, quand la
//               fiche n'a pas de JobPosting (Talent.com).
// Le plafond `maxOffres` compte les FICHES LUES, pas les offres rendues : c'est
// lui qui borne le nombre de requêtes HTTP, donc la politesse envers le site.
async function collecteParJobPosting(http, {
  source_name, series, regexLien, urlFiche, idFiche, entetes = ENTETES_FR, maxOffres = 40,
  fenetre = null, dejaVus = null, paysDefaut = null, deviseDefaut = 'EUR', repli = null, raw = null,
  budgetMs = 60000, dateLimite = null, timeout = 20000, enrichir = null, dateListe = null, filtreLien = null,
}) {
  // Garde-fous (06/09/2026, la sonde est restée 2 h sur Talent) : budget de temps
  // global (budgetMs, ou dateLimite quand plusieurs appels partagent un budget),
  // timeout par requête, et on cesse de lire les pages de liste dès qu'on tient
  // 4 fois plus de liens que de fiches à lire. Un site lent ne bloque plus le nœud 1.
  const limite = dateLimite || (Date.now() + budgetMs);
  const epuise = () => Date.now() > limite;
  let budgetEpuise = false, erreursListe = 0, derniereErreur = null;
  const liens = new Map();   // chemin → HTML de la page de liste où il a été vu (pour le repli)
  const ecartes = new Set();  // liens refusés par filtreLien : ni relus, ni comptés comme nouveaux
  listes: for (const serie of series) {
    for (const url of serie) {
      if (epuise()) { budgetEpuise = true; break listes; }
      if (liens.size >= Math.max(60, maxOffres * 6)) break listes;
      let html;
      try { html = await http({ url, headers: entetes, brut: true, timeout }); } catch (e) { erreursListe++; derniereErreur = String(e.message || e).slice(0, 160); break; }
      if (typeof html !== 'string') break;
      let nouveaux = 0, m;
      const re = new RegExp(regexLien.source, 'g');
      while ((m = re.exec(html)) !== null) {
        if (liens.has(m[0]) || ecartes.has(m[0])) continue;
        if (filtreLien && !filtreLien(m[0], html)) { ecartes.add(m[0]); continue; }
        liens.set(m[0], html); nouveaux++;
      }
      if (nouveaux === 0) break;
    }
  }

  const out = [];
  const vus = new Set();
  const stats = { liens: liens.size, dejaConnues: 0, tropVieilles: 0, fichesLues: 0, sansJobPosting: 0, budgetEpuise, erreursListe, derniereErreur };
  for (const [chemin, htmlListe] of liens) {
    const id = idFiche(chemin);
    if (dejaVus && dejaVus.has(id)) { stats.dejaConnues++; continue; }
    // Date lisible dès la liste (carte Talent) : une offre hors fenêtre n'est pas lue.
    if (dateListe && fenetre) { const dl = dateListe(chemin, htmlListe); if (dl && horsFenetre(dl, fenetre)) { stats.tropVieilles++; continue; } }
    if (stats.fichesLues >= maxOffres) break;
    if (epuise()) { stats.budgetEpuise = true; break; }
    stats.fichesLues++;
    const url = urlFiche(chemin);
    let page;
    try { page = await http({ url, headers: entetes, brut: true, timeout }); } catch (e) { continue; }
    if (typeof page !== 'string') continue;
    const jp = lireJobPosting(page);
    let offre = null;
    if (jp) {
      offre = offreDepuisJobPosting(jp, { source_name, source_offer_id: id, url, paysDefaut, deviseDefaut, raw: raw ? raw(chemin) : {} });
    } else if (repli) {
      stats.sansJobPosting++;
      offre = repli({ chemin, id, url, page, htmlListe });
    }
    if (offre && enrichir) offre = enrichir(offre, { chemin, id, url, page, htmlListe }) || offre;
    if (!offre || !offre.title) continue;
    if (horsFenetre(offre.publication_date, fenetre)) { stats.tropVieilles++; continue; }
    ajouter(out, vus, offre);
  }
  stats.ecartes = ecartes.size;
  out.stats = stats;
  return out;
}

// Décale une liste d'un cran par jour : sur plusieurs passages, chaque requête et
// chaque domaine passent en premier à leur tour (même idée que la rotation des
// requêtes Fantastic Jobs). `jour` explicite = tests déterministes.
function rotationDuJour(liste, jour = Math.floor(Date.now() / 86400000)) {
  const n = liste.length;
  if (n < 2) return liste.slice();
  const k = ((jour % n) + n) % n;
  return liste.slice(k).concat(liste.slice(0, k));
}

export { UA, clean, cut, MARGE_JOURS_DEFAUT, fenetreCollecte, horsFenetre, pageEpuisee, ajouter, dateRelativeFr, dateFreeWork, UA_NAVIGATEUR, ENTETES_FR, lireJobPosting, texteSchema, offreDepuisJobPosting, collecteParJobPosting, rotationDuJour };
