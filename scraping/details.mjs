// ============================================================================
// DETAILS — second pass of the collection.
// « On scrape une fois pour retenir les meilleures offres, et pour les
// meilleures seulement on récupère aussi les descriptions. »
// ----------------------------------------------------------------------------
// Certaines sources ne livrent pas le texte de l'offre au premier temps :
// HelloWork (page de résultats : rien du tout), Welcome to the Jungle (index
// Algolia : un extrait d'environ 500 caractères). Or sans texte, la notation
// saute l'offre (« aucune description fournie par la source ») et le modèle
// plafonne à 4.0. Ici, pour les offres GARDÉES par le filtre et pas encore
// notées, on ouvre la fiche publique et on lit son bloc schema.org JobPosting
// (description entière, date, contrat, lieu) : une requête par fiche, jamais
// plus de `maxParPasse` fiches ni plus de `budgetMs` par passage.
//
// Sondes du 08/09/2026 :
//   · HelloWork répond en 200-500 ms avec un JobPosting complet (4 500 à
//     6 600 caractères) : 142 fiches lues sur 169 au rattrapage, les 27 autres
//     étaient des offres expirées (la page devient une liste d'offres voisines,
//     sans JobPosting) ;
//   · WTTJ donne le même genre de fiche (4 700 à 7 000 caractères) MAIS il est
//     derrière AWS WAF : après une vingtaine de requêtes rapprochées il sert un
//     défi anti-robot en HTTP 200 (`gokuProps`, page de 2 450 caractères). D'où
//     `pauseParSource` et l'arrêt automatique d'une source qui bloque ;
//   · Adzuna : même AWS WAF, mais dès la première requête (« Human
//     Verification », HTTP 405) — pas relue, on garde l'extrait de l'API ;
//   · APEC : DataDome (403) sur le webservice de détail — idem.
// Même signature `http` que les collecteurs de scraping/sources/.
// ============================================================================
import { decodeEntitesHtml } from './html-entities.mjs';

/** Réglages par défaut (profile/sources.yaml → details ; clé absente = ces valeurs). */
const FICHES_DEFAUT = { sources: ['hellowork', 'wttj'], longueurMin: 1500, maxParPasse: 80, budgetMs: 90000, pauseMs: 250, pauseParSource: { wttj: 2000 }, timeoutMs: 15000, blocagesAvantArret: 2 };

/** Fiches qu'on sait lire : forme d'URL attendue par source (garde-fou : jamais une requête vers un autre site). */
const URLS_FICHES = {
  hellowork: /^https:\/\/www\.hellowork\.com\/fr-fr\/emplois\/\d+\.html/i,
  wttj: /^https:\/\/www\.welcometothejungle\.com\/[a-z]{2}\/companies\/[^/]+\/jobs\/[^/?#]+/i,
};

const UA_FICHES = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const ENTETES_FICHES = { 'User-Agent': UA_FICHES, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-FR,fr;q=0.9' };

/**
 * Le JobPosting d'une page HTML, ou null. On découpe sur </script> et on lit
 * chaque bloc ld+json (objet seul, tableau, ou @graph). Une expression « tout
 * sauf < » raterait les blocs dont le JSON contient lui-même un « < » — vu sur
 * HelloWork le 08/09/2026.
 */
function jobPostingDe(html) {
  if (html != null && typeof html !== 'string') html = (typeof Buffer !== 'undefined' && Buffer.isBuffer(html)) ? html.toString('utf8') : String(html);
  if (!html) return null;
  for (const morceau of html.split('</script>')) {
    const i = morceau.indexOf('ld+json');
    if (i < 0) continue;
    const brut = morceau.slice(morceau.indexOf('>', i) + 1).trim();
    if (!brut) continue;
    let json;
    try { json = JSON.parse(brut); } catch (e) { continue; }
    const liste = Array.isArray(json) ? json : (json && Array.isArray(json['@graph']) ? json['@graph'] : [json]);
    const jp = liste.find((x) => x && (x['@type'] === 'JobPosting' || (Array.isArray(x['@type']) && x['@type'].includes('JobPosting'))));
    if (jp) return jp;
  }
  return null;
}

/**
 * Page de défi anti-robot servie À LA PLACE de la fiche, souvent avec un code
 * 200 : sans ce test elle passerait pour une fiche vide. Vue chez WTTJ et
 * Adzuna (AWS WAF : `gokuProps`, `awsWafCookieDomainList`) et à l'APEC
 * (DataDome). N'est consultée que si la page ne porte AUCUN JobPosting : une
 * vraie fiche qui parlerait de captcha ne peut donc pas être prise pour un défi.
 */
function estDefiRobot(html) {
  return /awsWafCookieDomainList|gokuProps|captcha-sdk|challenge-platform|Human Verification|DataDome/i.test(String(html || '').slice(0, 6000));
}

/**
 * Texte lisible d'un champ HTML du JobPosting : fins de paragraphe gardées
 * comme sauts de ligne, balises retirées AVANT le décodage des entités puis
 * encore après (une entité décodée peut dessiner une balise), espaces repliés.
 */
function texteFiche(v, max = 8000) {
  const s = v == null ? '' : (typeof v === 'string' ? v : (v.name || ''));
  const t = decodeEntitesHtml(String(s).replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>|<\/h[1-6]>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/<[^>]+>/g, ' ').replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return t ? t.slice(0, max) : null;
}

/** Les champs d'un JobPosting dans le format d'offre commun ; null sans description. */
function champsJobPosting(jp) {
  if (!jp) return null;
  const description = texteFiche(jp.description);
  if (!description) return null;
  const types = Array.isArray(jp.employmentType) ? jp.employmentType : (jp.employmentType ? [jp.employmentType] : []);
  const lieu = Array.isArray(jp.jobLocation) ? jp.jobLocation[0] : jp.jobLocation;
  const adresse = (lieu && lieu.address) || {};
  const date = jp.datePosted && !Number.isNaN(Date.parse(jp.datePosted)) ? new Date(jp.datePosted).toISOString() : null;
  return {
    description,
    publication_date: date,
    contract_type: types.map((t) => String(t).trim()).filter(Boolean).join(', ') || null,
    city: texteFiche(adresse.addressLocality, 200),
    valide_jusqu_au: jp.validThrough || null,
  };
}

/**
 * Ouvre une fiche. Trois issues, aucune ne lève : `fiche` (les champs lus, null
 * si la page ne porte pas de JobPosting — offre expirée par exemple), `erreur`
 * (la page ne s'ouvre pas) ou `bloquee` (défi anti-robot au lieu de la fiche).
 */
async function lireFiche(http, url, { timeoutMs = FICHES_DEFAUT.timeoutMs } = {}) {
  let html;
  try { html = await http({ method: 'GET', url, headers: ENTETES_FICHES, brut: true, timeout: timeoutMs }); }
  catch (e) {
    const m = String((e && e.message) || e).slice(0, 160);
    // Un défi peut aussi arriver avec un code d'erreur : Adzuna répond 405, DataDome 403.
    return { fiche: null, erreur: m, bloquee: /HTTP (403|405|429)\b/.test(m) };
  }
  const jp = jobPostingDe(html);
  if (!jp && estDefiRobot(html)) return { fiche: null, erreur: null, bloquee: true };
  return { fiche: champsJobPosting(jp), erreur: null, bloquee: false };
}

/** Faut-il relire cette offre ? Source relisible, URL de la forme attendue, texte absent ou plus court que longueurMin. */
function aRelire(o, cfg) {
  if (!o || !Array.isArray(cfg.sources) || !cfg.sources.includes(o.source_name)) return false;
  const re = URLS_FICHES[o.source_name];
  if (!re || !re.test(String(o.url || ''))) return false;
  return String(o.description || '').trim().length < cfg.longueurMin;
}

/**
 * Deuxième temps : complète EN PLACE la description (et la date de publication
 * ou le contrat s'ils manquent) des offres relisibles, dans l'ordre reçu (le
 * pipeline les trie par priorité), jusqu'à `maxParPasse` fiches ou `budgetMs`.
 * Rend les correctifs appliqués ({ id, corps }) et les compteurs du
 * passage. Aucune erreur ne remonte : une fiche illisible laisse l'offre telle
 * quelle. Une source qui sert `blocagesAvantArret` défis anti-robot est laissée
 * tranquille pour le reste du passage (ses offres restent candidates pour la
 * fois suivante). Hooks facultatifs : apresFiche(o, corps), surErreur(msg, o).
 */
async function enrichirDescriptions(http, offres, cfgFiches, hooks = {}) {
  const cfg = { ...FICHES_DEFAUT, ...(cfgFiches || {}) };
  const t0 = Date.now();
  const stats = { candidates: 0, lues: 0, enrichies: 0, sansGain: 0, echecs: 0, bloquees: 0, budgetEpuise: false, sourcesArretees: [], ms: 0, parSource: {} };
  const patches = [];
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  // Chaque source a son rythme : WTTJ bloque à une vingtaine de requêtes rapprochées.
  const pauseDe = (src) => { const p = (cfg.pauseParSource || {})[src]; return p == null ? cfg.pauseMs : p; };
  for (const o of offres || []) {
    if (!aRelire(o, cfg)) continue;
    stats.candidates++;
    if (stats.sourcesArretees.indexOf(o.source_name) >= 0) continue;
    if (stats.lues >= cfg.maxParPasse) continue;
    if (Date.now() - t0 > cfg.budgetMs) { stats.budgetEpuise = true; continue; }
    if (stats.lues > 0) { const p = pauseDe(o.source_name); if (p > 0) await attendre(p); }
    stats.lues++;
    const ps = stats.parSource[o.source_name] || (stats.parSource[o.source_name] = { lues: 0, enrichies: 0 });
    ps.lues++;
    const { fiche, erreur, bloquee } = await lireFiche(http, o.url, cfg);
    if (bloquee) {
      stats.bloquees++;
      ps.bloquees = (ps.bloquees || 0) + 1;
      if (ps.bloquees >= cfg.blocagesAvantArret && stats.sourcesArretees.indexOf(o.source_name) < 0) stats.sourcesArretees.push(o.source_name);
      if (hooks.surErreur) await hooks.surErreur('defi anti-robot au lieu de la fiche' + (erreur ? ' (' + erreur + ')' : ''), o);
      continue;
    }
    if (erreur) { stats.echecs++; if (hooks.surErreur) await hooks.surErreur(erreur, o); continue; }
    // Pas de JobPosting (offre expirée : la page devient une liste d'offres voisines),
    // ou un texte qui n'apporte rien de plus que ce qu'on a déjà : on ne remplace jamais
    // un texte par un plus court (l'extrait Algolia de WTTJ vaut mieux qu'une fiche
    // tronquée).
    if (!fiche || fiche.description.length <= String(o.description || '').trim().length) { stats.sansGain++; continue; }
    const corps = { description: fiche.description };
    if (!o.publication_date && fiche.publication_date) corps.publication_date = fiche.publication_date;
    if (!o.contract_type && fiche.contract_type) corps.contract_type = fiche.contract_type;
    Object.assign(o, corps);
    patches.push({ id: o.id, corps });
    stats.enrichies++; ps.enrichies++;
    if (hooks.apresFiche) await hooks.apresFiche(o, corps);
  }
  stats.ms = Date.now() - t0;
  return { stats, patches };
}

export { FICHES_DEFAUT, URLS_FICHES, jobPostingDe, estDefiRobot, texteFiche, champsJobPosting, lireFiche, aRelire, enrichirDescriptions };
