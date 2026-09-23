import { clean, cut, ajouter } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 8. France Travail — API v2, officielle, gratuite (1M appels/mois)
// ---------------------------------------------------------------------------
// Contrairement à La Bonne Alternance (agrège France Travail mais UNIQUEMENT
// les offres d'alternance), cette API donne accès à TOUT le catalogue :
// VIE, CDI, CDD, freelance.
// Inscription self-service sur francetravail.io — voir le README, section « Sources ».
async function collecteFranceTravail(http, { clientId, clientSecret, queries, maxJours = 21, fenetre = null, pagesMax = 4, parPage = 150 }) {
  if (!clientId || !clientSecret) return [];

  const tokenBody = [
    'grant_type=client_credentials',
    'client_id=' + encodeURIComponent(clientId),
    'client_secret=' + encodeURIComponent(clientSecret),
    'scope=' + encodeURIComponent('api_offresdemploiv2 o2dsoffre'),
  ].join('&');

  const tok = await http({
    method: 'POST',
    url: 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody, brut: true,
  });
  // Certains clients HTTP (n8n) rendent parfois un objet déjà analysé là où fetch rend du texte : on
  // accepte les deux, sinon le jeton est perdu sans le moindre message d'erreur.
  let token = null;
  if (tok && typeof tok === 'object') token = tok.access_token;
  else { try { token = JSON.parse(tok).access_token; } catch (e) { token = null; } }
  if (!token) return [];

  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
  const out = [];
  const vus = new Set();
  // minCreationDate = début de la fenêtre ; on enchaîne les tranches de 150
  // (range=0-149, 150-299…) tant qu'elles sont pleines.
  const depuis = fenetre ? fenetre.depuis : new Date(Date.now() - maxJours * 86400000).toISOString();
  const nbPagesMax = fenetre ? pagesMax : 1;
  for (const q of queries) {
    for (let page = 0; page < nbPagesMax; page++) {
      const debut = page * parPage;
      const qs = [
        'motsCles=' + encodeURIComponent(q),
        `range=${debut}-${debut + parPage - 1}`,
        'sort=1',                          // tri par date de création décroissante
        // Format exact exigé par l'API : secondes précises + suffixe Z. Sans le Z,
        // l'API ne renvoie aucune erreur mais silencieusement zéro résultat.
        'maxCreationDate=' + encodeURIComponent(new Date().toISOString().slice(0, 19) + 'Z'),
        'minCreationDate=' + encodeURIComponent(depuis.slice(0, 19) + 'Z'),
      ].join('&');
      let d;
      try {
        d = await http({ method: 'GET', url: `https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${qs}`, headers });
      } catch (e) { break; }
      // 204 sans corps quand il n'y a rien : http() rend alors null.
      const res = (d && d.resultats) || [];
      for (const o of res) {
        if (!o.id || !o.intitule) continue;
        const lieu = o.lieuTravail || {};
        ajouter(out, vus, {
          source_name: 'france_travail',
          source_offer_id: String(o.id),
          title: cut(o.intitule, 500),
          company: o.entreprise?.nom || null,
          location: lieu.libelle || null,
          city: (lieu.libelle || '').replace(/^\d+\s*-\s*/, '') || null,
          country: 'France',
          contract_type: o.typeContratLibelle || o.typeContrat || null,
          remote: /t[ée]l[ée]travail/i.test(o.description || '') ? 'possible' : null,
          salary: o.salaire?.libelle || null,
          description: cut(clean(o.description), 8000),
          url: o.origineOffre?.urlOrigine || `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`,
          contact_email: o.contact?.courriel || null,
          publication_date: o.dateCreation || null,
          raw: { requete: q, rome: o.romeCode, experience: o.experienceLibelle },
        });
      }
      if (res.length < parPage) break;
    }
  }
  return out;
}

export { collecteFranceTravail };
