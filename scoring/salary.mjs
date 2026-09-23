// ============================================================================
// SALARY — reads the pay out of the ad text when the source gives none.
// Returns a short normalised string (« 45–60 k€/an », « TJM 500 € ») or null.
// Deliberately cautious: a number without a currency or a pay word nearby is
// ignored, and so are amounts outside plausible bounds.
// ============================================================================

// ---------------------------------------------------------------------------
// Rémunération lue dans le texte quand la source ne la donne pas (v3, 2026-08-31).
// Rend une chaîne courte et normalisée — « 45–60 k€/an », « dès 50 k€/an »,
// « TJM 500 € », « 3 500 €/mois » — ou null. Volontairement prudent : un nombre
// sans devise ni mot de salaire à proximité (« 10k users », « 3 000 clients »)
// n'est pas retenu, un montant suivi de « million », « users »… ou précédé de
// « panier », « CA », « budget »… non plus, et les montants hors des bornes
// plausibles sont ignorés (20–400 k/an, 150–3 000 €/jour, 1 000–15 000 €/mois).
// Vérifié sur 1 000 annonces réelles ; cas de test dans tests/salary.test.mjs.
// ---------------------------------------------------------------------------
const MOTS_SALAIRE = /(salaire|salary|r[ée]mun[ée]ration|remuneration|package|brut|gross|fixe|compensation|\bpay\b|\bpaie\b|\bloon\b|tjm|taux journalier|daily rate|per annum|annuel|par an|k€|chf|€|\$|£)/i;
const PAS_UN_SALAIRE = /^\s?(millions?|milliards?|billions?|mrd\b|bn\b|m\b|users?|utilisateurs?|clients?|customers?|employees?|employ[ée]s?|salari[ée]s?|collaborateurs?|requests?|requ[êe]tes?|tokens?|rows?|lignes?|documents?|appels?|calls?|downloads?|visiteurs?|visitors?|abonn[ée]s?|followers?|\+?\s?(users|clients))/i;
const PAS_UN_SALAIRE_AVANT = /(panier|chiffre d.affaires|\bca\b|budget|revenues?|revenus?|lev[ée]e de fonds|raised|funding|\barr\b|\bmrr\b|deals?|contrats? de|march[ée] de|valuation|valorisation|financement|investi|[ée]conomies?|savings?)[^.]{0,40}$/i;
const ENTITES = { euro: '€', nbsp: ' ', agrave: 'à', aacute: 'á', eacute: 'é', egrave: 'è', ecirc: 'ê', ugrave: 'ù', ucirc: 'û', ocirc: 'ô', icirc: 'î', ccedil: 'ç', amp: '&', ndash: '–', mdash: '—', quot: '"', apos: '\'', rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»' };
const decoderEntites = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
  }
  const v = ENTITES[e.toLowerCase()];
  return v !== undefined ? v : m;
});
const DEVISES = '€|euros?|eur|chf|\\$|£|usd';
const SEP = '\\s?(?:-|–|—|à|a|to|et|and|\\/)\\s?';

/** Comme extraireSalaire, mais rend aussi le passage du texte qui a servi : { valeur, contexte }. */
function extraireSalaireDetail(texte) {
  if (!texte) return null;
  const t = decoderEntites(String(texte)).replace(/[   ]/g, ' ').replace(/\s+/g, ' ');
  const devise = (s) => /chf/i.test(s || '') ? 'CHF' : /\$|usd/i.test(s || '') ? '$' : /£|gbp/i.test(s || '') ? '£' : '€';
  const avant = (m) => t.slice(Math.max(0, m.index - 60), m.index);
  const apres = (m) => t.slice(m.index + m[0].length, m.index + m[0].length + 30);
  const prefixe = (m) => /(à partir de|a partir de|dès|from|minimum|min\.?|au moins|starting at)\s*$/i.test(avant(m)) ? 'dès '
    : /(jusqu.à|up to|maximum|max\.?)\s*$/i.test(avant(m)) ? 'jusqu’à ' : '';
  const milliers = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fini = (m, valeur) => ({ valeur, contexte: t.slice(Math.max(0, m.index - 50), m.index + m[0].length + 30) });

  // 1. Taux journalier (freelance) : « TJM : 500 », « TJM 400 - 450€ », « 650€/jour », « daily rate 600 »
  const m = t.match(/\bTJM\b[^\d€$]{0,25}(\d{3,4})(?:\s?€)?(?:\s?(?:-|–|—|à|a|to|et)\s?(\d{3,4}))?/i)
    || t.match(/(?<!\d)(\d{3,4})\s?(?:€|eur|euros)\s?(?:\/|par|per|by)\s?(?:jour|j\b|day|jr\b)/i)
    || t.match(/(?:taux journalier|daily rate)[^\d]{0,20}(\d{3,4})(?:\s?(?:-|–|à|to)\s?(\d{3,4}))?/i);
  if (m) {
    const a = +m[1], b = m[2] ? +m[2] : null;
    if (a >= 150 && a <= 3000) return fini(m, 'TJM ' + a + (b && b > a && b <= 3000 ? '–' + b : '') + ' €');
  }

  // 2. Montants en « k » : « 45-60k », « 50 K€ et 60 K€ », « €75–100K », « $120k-$150k », « jusqu'à 100K »
  const reK = new RegExp(
    '(?<d1>€|\\$|£|chf\\s?)?(?<!\\d)(?<a>\\d{2,3})(?<ka>\\s?[kK](?![a-zA-Z])(?:\\s?(?<d2>' + DEVISES + '))?)?'
    + '(?:' + SEP + '(?:€|\\$|£|chf\\s?)?(?<b>\\d{2,3})\\s?[kK](?![a-zA-Z])(?:\\s?(?<d3>' + DEVISES + '))?)?', 'gi');
  for (const x of t.matchAll(reK)) {
    const g = x.groups;
    if (!g.ka && !g.b) continue;                                  // un nombre quelconque
    const dev = g.d1 || g.d2 || g.d3;
    // sans devise : il faut un mot de salaire juste avant, ou une fourchette « entre 65 et 95K »
    if (!dev && !MOTS_SALAIRE.test(avant(x)) && !(g.b && /(entre|between)\s*$/i.test(avant(x)))) continue;
    if (PAS_UN_SALAIRE_AVANT.test(avant(x))) continue;            // « panier moyen 100K€ », « CA de 5 M€ »… non
    if (PAS_UN_SALAIRE.test(apres(x))) continue;                  // « 100K users », « 5k€ de CA »… non
    if (/(mois|month|mensuel)/i.test(apres(x))) continue;         // « 5k/mois » : trop rare pour être fiable
    const a = +g.a, b = g.b && +g.b > a && +g.b <= 400 ? +g.b : null;
    if (a < 20 || a > 400) continue;
    return fini(x, (b ? '' : prefixe(x)) + (b ? a + '–' + b : a) + ' k' + devise(dev) + '/an');
  }

  // 3. Montants en clair : « 45 000 € », « €52,000 », « CHF 106,000 », « 40 000euros et 45 000euros », « $5,000.00 - $7,000.00 per month »
  const reClair = new RegExp(
    '(?<d1>€|\\$|£|chf\\s?)?(?<!\\d)(?<a1>\\d{1,3})[ .,’\'](?<a2>\\d{3})(?!\\d)(?:[.,]\\d{2}(?!\\d))?(?:\\s?(?<d2>' + DEVISES + '))?'
    + '(?:' + SEP + '(?:€|\\$|£|chf\\s?)?(?<b1>\\d{1,3})[ .,’\'](?<b2>\\d{3})(?!\\d)(?:[.,]\\d{2}(?!\\d))?(?:\\s?(?<d3>' + DEVISES + '))?)?', 'gi');
  for (const x of t.matchAll(reClair)) {
    const g = x.groups;
    const dev = g.d1 || g.d2 || g.d3;
    if (!dev) continue;                                           // sans devise : un chiffre quelconque
    if (PAS_UN_SALAIRE_AVANT.test(avant(x))) continue;            // « panier moyen 100K€ », « CA de 5 M€ »… non
    if (PAS_UN_SALAIRE.test(apres(x))) continue;                  // « $133,077 million » : un chiffre d'affaires
    const a = +(g.a1 + g.a2), bBrut = g.b1 ? +(g.b1 + g.b2) : null;
    const d = devise(dev);
    if (/(mois|month|mensuel)/i.test(apres(x))) {
      if (a < 1000 || a > 15000) continue;
      const b = bBrut && bBrut > a && bBrut <= 15000 ? bBrut : null;
      return fini(x, (b ? '' : prefixe(x)) + milliers(b ? a + '–' + b : a) + ' ' + d + '/mois');
    }
    if (a < 20000 || a > 400000) continue;
    const k = (n) => Math.round(n / 1000);
    const b = bBrut && bBrut > a && bBrut <= 400000 ? bBrut : null;
    return fini(x, (b ? '' : prefixe(x)) + (b ? k(a) + '–' + k(b) : k(a)) + ' k' + d + '/an');
  }
  return null;
}

function extraireSalaire(texte) {
  const d = extraireSalaireDetail(texte);
  return d ? d.valeur : null;
}

export { extraireSalaire as extractSalary, extraireSalaireDetail as extractSalaryDetail };
