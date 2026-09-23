// ============================================================================
// ENTITÉS HTML — décodage sans dépendance externe
// ----------------------------------------------------------------------------
// Les flux d'offres (RSS, pages scrapées, JSON-LD) arrivent souvent avec des
// entités HTML jamais décodées : "M&uuml;ller" au lieu de "Müller",
// "&euro;1.2B" au lieu de "€1.2B". `decodeEntitesHtml` répare ça.
//
// ⚠️ Toujours décoder les entités APRÈS avoir retiré les balises HTML, jamais
// avant : décoder en premier ferait de "&lt;script&gt;" une vraie balise
// <script> une fois le retrait de balises appliqué ensuite. L'ordre correct
// (retirer les balises, PUIS décoder) est appliqué par les appelants de ce
// module, pas ici — cette fonction ne fait que décoder le texte qu'on lui donne.
// ============================================================================

// Table des entités nommées les plus courantes. Une entité absente de cette
// table est laissée telle quelle (jamais remplacée par du vide) : mieux vaut
// un "&zwj;" non décodé qu'un texte tronqué.
const NOMMEES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  // &nbsp; devient une espace NORMALE (pas U+00A0) : le reste du moteur
  // découpe le texte sur /\s+/, une espace insécable romprait ce découpage.
  nbsp: ' ',
  euro: '€', pound: '£', yen: '¥', cent: '¢', curren: '¤',
  copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', sbquo: '‚',
  ldquo: '“', rdquo: '”', bdquo: '„',
  bull: '•', middot: '·', deg: '°', plusmn: '±', times: '×', divide: '÷',
  sect: '§', para: '¶', laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿',

  // Lettres accentuées latin-1 (minuscules)
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ',
  ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  ntilde: 'ñ',
  ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', yuml: 'ÿ', szlig: 'ß',

  // Lettres accentuées latin-1 (majuscules)
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ',
  Ccedil: 'Ç',
  Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë',
  Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï',
  Ntilde: 'Ñ',
  Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø',
  Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü',
  Yacute: 'Ý',
};

// Une seule passe : numériques (décimal + hexa) puis nommées.
function decodeUnePasse(s) {
  return s.replace(/&(#x[0-9A-Fa-f]+|#\d+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (entiere, corps) => {
    if (corps[0] === '#') {
      const estHexa = corps[1] === 'x' || corps[1] === 'X';
      const code = estHexa ? parseInt(corps.slice(2), 16) : parseInt(corps.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0) return entiere;
      try { return String.fromCodePoint(code); } catch { return entiere; }
    }
    if (Object.prototype.hasOwnProperty.call(NOMMEES, corps)) return NOMMEES[corps];
    const enMinuscules = corps.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(NOMMEES, enMinuscules)) return NOMMEES[enMinuscules];
    return entiere; // entité inconnue : laissée telle quelle
  });
}

/**
 * Décode les entités HTML d'une chaîne. Répète le décodage (jusqu'à 3 passes)
 * pour rattraper le double encodage (&amp;uuml; -> &uuml; -> ü), s'arrête dès
 * que la chaîne ne change plus.
 */
function decodeEntitesHtml(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  for (let i = 0; i < 3; i++) {
    const suivant = decodeUnePasse(out);
    if (suivant === out) break;
    out = suivant;
  }
  return out;
}

// Export sur une seule ligne : un assembleur de nœuds n8n retire
// les lignes import/export au mot près pour inliner ce fichier dans un nœud —
// un export étalé sur plusieurs lignes casserait l'inlining (voir assembler.mjs).
export { decodeEntitesHtml };
