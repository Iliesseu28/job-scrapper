// Radar VIE du 06/09/2026 : Engagement Jeunes, sites carrières des groupes
// (SuccessFactors, Radancy, Avature, Crédit Agricole) et facette WTTJ.
// Les gabarits HTML reproduisent les pages relevées le 06/09/2026 (voir
// outils/journal-des-sources.md → « Radar VIE »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collecteEngagementJeunes, collecteSitesVIE, collecteWTTJ, estTitreVIE, normaliserDateVIE,
} from '../../scraping/sources/index.mjs';

// Faux client HTTP : route exacte d'abord, puis préfixe (clé terminée par *) ;
// une route absente lève comme un vrai 404. Journal des requêtes dans .appels.
function fauxHttp(routes) {
  const appels = [];
  const valeur = (v, req) => (typeof v === 'function' ? v(req) : v);
  const http = async (req) => {
    appels.push(req);
    if (Object.prototype.hasOwnProperty.call(routes, req.url)) return valeur(routes[req.url], req);
    const prefixe = Object.keys(routes).find((k) => k.endsWith('*') && req.url.startsWith(k.slice(0, -1)));
    if (prefixe) return valeur(routes[prefixe], req);
    throw new Error(`404 ${req.url}`);
  };
  http.appels = appels;
  http.urls = () => appels.map((r) => r.url);
  return http;
}
const ldjson = (o) => `<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', ...o })}</script></head><body></body></html>`;
// Fenêtre glissante : tout ce qui est antérieur au 25/08/2026 est trop vieux (la fiche Alstom du 29/08 doit passer).
const DEPUIS = Date.parse('2026-08-25T00:00:00Z');
const FENETRE = { depuisMs: DEPUIS, depuisSecondes: Math.floor(DEPUIS / 1000), depuisISO: '2026-08-25' };

// ---------------------------------------------------------------- unitaires
test('estTitreVIE : sigle en capitales, pas « auxiliaire de vie »', () => {
  for (const t of ['VIE Digital Communications Specialist (f/m/d)', 'V.I.E. Business Developer', 'VIE/PANGEO HSE REFERENT GERMANY M/W',
    'Client Service Officer – Desk Portugal (VIE) H/F', 'VIE – Ingénieur Inspection (H/F) – Angola', 'Volontariat International en Entreprise - Data']) {
    assert.equal(estTitreVIE(t), true, t);
  }
  for (const t of ['AUXILIAIRE DE VIE', 'Auxiliaire de vie', 'Aide à la vie quotidienne', 'Qualité de vie au travail - chargé de mission',
    'Développeur C Linux (H/F)', 'Ingénieur Process (H/F)', 'Client Services Officer – Personal banking Desk (H/F)', '', null]) {
    assert.equal(estTitreVIE(t), false, String(t));
  }
});

test('normaliserDateVIE : jj/mm/aaaa, 2026-8-5, « 29 Aug 2026 », « Sat Aug 29 … UTC 2026 »', () => {
  assert.equal(normaliserDateVIE('03/07/2026'), '2026-07-03');            // Crédit Agricole (Date.parse dirait le 7 mars)
  assert.equal(normaliserDateVIE('2026-8-5'), '2026-08-05');              // Radancy
  assert.equal(normaliserDateVIE('29 Aug 2026'), '2026-08-29');           // liste SuccessFactors
  assert.equal(normaliserDateVIE('Sat Aug 29 02:00:00 UTC 2026'), '2026-08-29'); // fiche SuccessFactors
  assert.equal(normaliserDateVIE('2026-09-04T00:00:00+02:00'), '2026-09-04T00:00:00+02:00'); // ISO conservé
  assert.equal(normaliserDateVIE('2026-09-04'), '2026-09-04');
  assert.equal(normaliserDateVIE('bientôt'), 'bientôt');                  // illisible : rendu tel quel, n'exclut jamais
  assert.equal(normaliserDateVIE(null), null);
  assert.equal(normaliserDateVIE(''), null);
});


// ---------------------------------------------------------------- Engagement Jeunes
const EJ = 'https://www.engagement-jeunes.com';
const carteEJ = (id, slug, titre, date, lieu) => `
<article class="card"><header><h2><a class="text-decoration-none font-16-21" title="${titre}" target="_blank" href="/fr/detail-offre/${id}/${slug}.html">${titre}</a></h2>
<a href="/fr/company/123/schneider-electric.html">Schneider Electric</a></header><div><p class="text-muted mb-0">Publiée le ${date}</p></div>
<a class="d-md-none" href="/fr/detail-offre/${id}/${slug}.html">${titre}</a>
<dl><dt>Contrat</dt><dd>VIE</dd><dt>Localisation</dt><dd>${lieu}</dd></dl></article>`;

test('Engagement Jeunes : liste VIE, date de carte, fiche JSON-LD, vieille carte non relue', async () => {
  const http = fauxHttp({
    [`${EJ}/fr/offres-emploi.html?contrat%5B%5D=6&page=1`]: carteEJ(111, 'vie-quality-engineer', 'VIE Quality Engineer', '05/09/2026', 'Zalaegerszeg, Hongrie')
      + carteEJ(222, 'vie-data-analyst', 'VIE Data Analyst', '01/07/2026', 'Madrid, Espagne'),
    [`${EJ}/fr/offres-emploi.html?contrat%5B%5D=6&page=2`]: '<html><body>Aucune offre</body></html>',
    [`${EJ}/fr/detail-offre/111/vie-quality-engineer.html`]: ldjson({
      title: 'VIE Quality Engineer', datePosted: '2026-09-05T00:00:00+02:00',
      hiringOrganization: { '@type': 'Organization', name: 'Schneider Electric' },
      jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Zalaegerszeg', addressCountry: 'HU' } },
      description: '<p>Mission qualité en usine.</p>',
    }),
  });
  const r = await collecteEngagementJeunes(http, { pages: 2, fenetre: FENETRE });
  assert.equal(r.length, 1);
  assert.equal(r[0].source_name, 'engagement_jeunes');
  assert.equal(r[0].source_offer_id, '111');
  assert.equal(r[0].url, `${EJ}/fr/detail-offre/111/vie-quality-engineer.html`);
  assert.equal(r[0].title, 'VIE Quality Engineer');
  assert.equal(r[0].contract_type, 'VIE');
  assert.ok(String(r[0].publication_date).startsWith('2026-09-05'), r[0].publication_date);
  assert.equal(r.stats.tropVieilles, 1, JSON.stringify(r.stats));
  assert.equal(http.urls().length, 3, http.urls().join('\n'));                 // 2 pages de liste + 1 fiche
  assert.ok(!http.urls().some((u) => u.includes('/222/')), 'la carte du 01/07 ne doit pas être relue');
});

// ---------------------------------------------------------------- SuccessFactors (Alstom, CMA CGM)
const SF = 'https://jobsearch.alstom.example';
const LISTE_SF = `<table><tbody>
<tr><td><span class="jobTitle hidden-phone"><a href="/job/Berlin-VIE-Digital-Communications-Specialist-%28f-m-d%29/111/" class="jobTitle-link">VIE Digital Communications Specialist (f/m/d)</a></span>
<span class="jobTitle visible-phone"><a class="jobTitle-link" href="/job/Berlin-VIE-Digital-Communications-Specialist-%28f-m-d%29/111/">VIE Digital Communications Specialist (f/m/d)</a></span></td>
<td><span class="jobLocation">Berlin, DE</span></td><td><span class="jobDate visible-phone">29 Aug 2026</span></td></tr>
<tr><td><a href="/job/Paris-Developpeur-C-Linux/222/" class="jobTitle-link">Développeur C Linux (H/F)</a></td><td><span class="jobDate">01 Sep 2026</span></td></tr>
<tr><td><a href="/job/Lyon-Auxiliaire-de-vie/333/" class="jobTitle-link">AUXILIAIRE DE VIE</a></td><td><span class="jobDate">02 Sep 2026</span></td></tr>
<tr><td><a href="/job/Madrid-VIE-Project-Engineer/444/" class="jobTitle-link">VIE Project Engineer</a></td><td><span class="jobDate">10 Jan 2026</span></td></tr>
</tbody></table>`;
const FICHE_SF = `<html><body><div itemscope itemtype="http://schema.org/JobPosting">
<h1 id="job-title" itemprop="title">VIE Digital Communications Specialist (f/m/d)</h1>
<meta itemprop="datePosted" content="Sat Aug 29 02:00:00 UTC 2026">
<meta itemprop="hiringOrganization" content="Alstom">
<span itemprop="jobLocation" itemscope><span itemprop="address" itemscope><meta itemprop="streetAddress" content="Berlin, DE"></span></span>
<span itemprop="description" class="jobdescription"><p>Req ID:<span>509897</span></p><p>Mission &amp; tâches : communication digitale.</p></span>
<div><a class="btn btn-primary btn-large btn-lg apply dialogApplyBtn " href="/talentcommunity/apply/1/">Apply now</a></div>
</div></body></html>`;
const ALSTOM = { nom: 'Alstom', moteur: 'successfactors', base: SF, requete: 'VIE', pages: 2 };

test('SuccessFactors : ancres doublées, intitulés non VIE écartés dès la liste, fiche microdata, date de liste', async () => {
  const http = fauxHttp({
    [`${SF}/search/?q=VIE`]: LISTE_SF,
    [`${SF}/search/?q=VIE&startrow=25`]: '<html><body>No results</body></html>',
    [`${SF}/job/Berlin-VIE-Digital-Communications-Specialist-%28f-m-d%29/111/`]: FICHE_SF,
  });
  const r = await collecteSitesVIE(http, { sites: [ALSTOM], fenetre: FENETRE });
  assert.equal(r.length, 1, JSON.stringify(r.stats));
  const o = r[0];
  assert.equal(o.source_name, 'vie_entreprises');
  assert.equal(o.source_offer_id, 'jobsearch.alstom.example:111');
  assert.equal(o.title, 'VIE Digital Communications Specialist (f/m/d)');
  assert.equal(o.company, 'Alstom');
  assert.equal(o.city, 'Berlin');
  assert.equal(o.country, 'DE');
  assert.equal(o.publication_date, '2026-08-29');
  assert.equal(o.contract_type, 'VIE');
  assert.ok(o.description.includes('Mission & tâches'), o.description);
  assert.ok(!o.description.includes('<p>'), o.description);
  assert.equal(o.raw.moteur, 'successfactors');
  assert.equal(o.raw.site, 'Alstom');
  assert.equal(r.stats.Alstom.ecartes, 2, JSON.stringify(r.stats));          // Développeur C, Auxiliaire de vie
  assert.equal(r.stats.Alstom.tropVieilles, 1, JSON.stringify(r.stats));     // VIE Project Engineer du 10 janvier
  assert.equal(r.stats.Alstom.sansJobPosting, 1);
  const urls = http.urls();
  assert.equal(urls.length, 3, urls.join('\n'));                             // 2 pages de liste + 1 fiche
  assert.ok(!urls.some((u) => /\/(222|333|444)\//.test(u)), urls.join('\n'));
});

test('collecteSitesVIE : un site en erreur ou inconnu ne coupe pas les autres', async () => {
  const http = fauxHttp({
    [`${SF}/search/?q=VIE`]: LISTE_SF,
    [`${SF}/search/?q=VIE&startrow=25`]: '',
    [`${SF}/job/Berlin-VIE-Digital-Communications-Specialist-%28f-m-d%29/111/`]: FICHE_SF,
  });
  const r = await collecteSitesVIE(http, { sites: [
    { nom: 'Inconnu', moteur: 'workday', base: 'https://x.example' },
    { nom: 'Panne', moteur: 'radancy', base: 'https://panne.example' },
    ALSTOM,
  ], fenetre: FENETRE });   // sans fenêtre, la fiche 444 (janvier) serait lue elle aussi
  assert.equal(r.length, 1);
  assert.match(r.stats.Inconnu.erreur, /moteur inconnu/);
  assert.equal(r.stats.Panne.erreursListe, 1, JSON.stringify(r.stats.Panne));
  assert.equal(r.stats.Alstom.fichesLues, 1);
});

// ---------------------------------------------------------------- Radancy (Veolia, Vinci, Sanofi)
const RD = 'https://jobs.veolia.example';
const LISTE_RD = `<ul>
<li><a href="/en/job/marl/vie-pangeo-hse-referent-germany-m-w/3091/555" data-job-id="555"><h2>VIE/PANGEO HSE REFERENT GERMANY M/W </h2><span class="job-location">Marl, Germany</span></a></li>
<li><a href="/en/job/paris/auxiliaire-de-vie/3091/666" data-job-id="666"><h2>Auxiliaire de vie</h2><span class="job-location">Paris, France</span></a></li>
<li><a href="/en/job/north-melbourne/vie-design-corrosion-engineer/1440/777" data-job-id="777" class="search-results--link"><span class="search-results--link-jobtitle">VIE Design Corrosion Engineer</span></a></li>
</ul>`;

test('Radancy : titre dans <h2> ou <span>, JSON-LD, date « 2026-8-5 » normalisée', async () => {
  const http = fauxHttp({
    [`${RD}/en/search-jobs/VIE`]: LISTE_RD,
    [`${RD}/en/job/marl/vie-pangeo-hse-referent-germany-m-w/3091/555`]: ldjson({
      title: 'VIE/PANGEO HSE REFERENT GERMANY M/W', datePosted: '2026-8-5', employmentType: 'FULL_TIME',
      hiringOrganization: { '@type': 'Organization', name: 'Veolia' },
      jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Marl', addressCountry: 'DE' } },
      description: 'HSE referent.',
    }),
    [`${RD}/en/job/north-melbourne/vie-design-corrosion-engineer/1440/777`]: ldjson({
      title: 'VIE Design Corrosion Engineer', datePosted: '2026-09-02',
      hiringOrganization: { '@type': 'Organization', name: 'Vinci Construction' },
      jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Melbourne', addressCountry: 'AU' } },
      description: 'Corrosion.',
    }),
  });
  const r = await collecteSitesVIE(http, { sites: [{ nom: 'Veolia', moteur: 'radancy', base: RD + '/', lang: 'en' }] });
  assert.deepEqual(r.map((o) => o.source_offer_id).sort(), ['jobs.veolia.example:555', 'jobs.veolia.example:777']);
  const hse = r.find((o) => o.source_offer_id.endsWith(':555'));
  assert.equal(hse.publication_date, '2026-08-05');
  assert.equal(hse.contract_type, 'VIE');                                    // l'intitulé prime sur employmentType
  assert.equal(hse.raw.moteur, 'radancy');
  assert.equal(r.stats.Veolia.ecartes, 1);
  assert.ok(!http.urls().some((u) => u.includes('/666')), http.urls().join('\n'));
});

// ---------------------------------------------------------------- Avature (TotalEnergies)
const AV = 'https://jobs.total.example';
const LISTE_AV = `<div class="article__header__text">
<h3 class="article__header__text__title title title--04"><a class="link" href="${AV}/fr_FR/careers/JobDetail/VIE-Ing-nieur-Inspection-H-F-Angola/83649">
 VIE – Ingénieur Inspection (H/F) – Angola
 </a></h3></div>
<div class="article__header__text">
<h3 class="article__header__text__title title title--04"><a class="link" href="${AV}/fr_FR/careers/JobDetail/Ing-nieur-Process-H-F/83650">
 Ingénieur Process (H/F)
 </a></h3></div>`;
const FICHE_AV = `<html><head><meta property="og:title" content="VIE – Ingénieur Inspection (H/F) – Angola">
<title>VIE – Ingénieur Inspection (H/F) – Angola - Job detail | Careers Portal - TotalEnergies</title></head><body><section>
<dl><dt class="article__content__view__field__label"> Pays </dt> <dd class="article__content__view__field__value"> Angola </dd>
<dt class="article__content__view__field__label"> Ville </dt> <dd class="article__content__view__field__value"> Luanda </dd>
<dt class="article__content__view__field__label"> Société employeur </dt> <dd class="article__content__view__field__value"> TotalEnergies EP Angola </dd>
<dt class="article__content__view__field__label"> Type de contrat </dt> <dd class="article__content__view__field__value"> VIE </dd></dl>
<div class="js_collapsible__header">Contexte et environnement</div><div class="article__content js_collapsible__content"><p>Filiale angolaise du groupe.</p></div>
<div class="js_collapsible__header">Activités</div><div class="article__content js_collapsible__content"><p>Inspection des installations.</p></div>
</section><footer>pied</footer></body></html>`;

test('Avature : ancre sur plusieurs lignes, og:title, champs dt/dd, pas de date', async () => {
  const http = fauxHttp({
    [`${AV}/fr_FR/careers/SearchJobs/VIE`]: LISTE_AV,
    [`${AV}/fr_FR/careers/SearchJobs/VIE?jobOffset=20`]: '',
    [`${AV}/fr_FR/careers/JobDetail/VIE-Ing-nieur-Inspection-H-F-Angola/83649`]: FICHE_AV,
  });
  const r = await collecteSitesVIE(http, { sites: [{ nom: 'TotalEnergies', moteur: 'avature', base: AV, lang: 'fr_FR', pages: 2 }], fenetre: FENETRE });
  assert.equal(r.length, 1, JSON.stringify(r.stats));
  const o = r[0];
  assert.equal(o.source_offer_id, 'jobs.total.example:83649');
  assert.equal(o.title, 'VIE – Ingénieur Inspection (H/F) – Angola');
  assert.equal(o.country, 'Angola');
  assert.equal(o.city, 'Luanda');
  assert.equal(o.company, 'TotalEnergies EP Angola');
  assert.equal(o.contract_type, 'VIE');
  assert.equal(o.publication_date, null);                                    // sans date : jamais exclu par la fenêtre
  assert.ok(o.description.includes('Filiale angolaise') && o.description.includes('Inspection des installations'), o.description);
  assert.ok(!o.description.includes('pied'), o.description);
  assert.equal(o.raw.sans_date, true);
  assert.equal(http.urls().length, 3, http.urls().join('\n'));
});

// ---------------------------------------------------------------- Crédit Agricole
const CA = 'https://groupecreditagricole.example';
const CHEMIN_CA = '/fr/nos-offres-emploi/1478-170478-127-client-service-officer--desk-portugal-vie-hf-reference--2026-113931--/';
const LISTE_CA = `<div class="offers">
<article class="card offer detail" data-gtm-jobTitle="Client Service Officer – Desk Portugal (VIE) H/F" data-gtm-jobContract="VIE" data-gtm-jobPublishDate="Mis à jour le 06/09/2026">
<h3 class="offer-title"><a href="${CA}${CHEMIN_CA}">Client Service Officer – Desk Portugal (VIE) H/F</a></h3></article>
<article class="card offer detail" data-gtm-jobContract="CDI"><h3 class="offer-title"><a href="${CA}/fr/nos-offres-emploi/577-170478-client-services-officer-personal-banking/">Client Services Officer – Personal banking Desk (H/F)</a></h3></article>
</div>`;

test('Crédit Agricole : mot-clé bruité filtré sur le titre, datePosted jj/mm/aaaa', async () => {
  const http = fauxHttp({
    [`${CA}/fr/nos-offres/?keyword=VIE`]: LISTE_CA,
    [`${CA}${CHEMIN_CA}`]: ldjson({
      title: 'Client Service Officer – Desk Portugal (VIE) H/F', datePosted: '03/07/2026', employmentType: 'VIE',
      hiringOrganization: { '@type': 'Organization', name: 'CA Indosuez' },
      jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Lisbonne', addressCountry: 'PT' } },
      description: 'Desk Portugal.',
    }),
  });
  const r = await collecteSitesVIE(http, { sites: [{ nom: 'Crédit Agricole', moteur: 'credit_agricole', base: CA }] });
  assert.equal(r.length, 1, JSON.stringify(r.stats));
  assert.equal(r[0].source_offer_id, 'groupecreditagricole.example:1478');
  assert.equal(r[0].publication_date, '2026-07-03');                         // pas le 7 mars
  assert.equal(r[0].contract_type, 'VIE');
  assert.equal(r.stats['Crédit Agricole'].ecartes, 1);
  assert.ok(!http.urls().some((u) => u.includes('/577-')), http.urls().join('\n'));
});

// ---------------------------------------------------------------- WTTJ : facette contract_type:vie
test('collecteWTTJ : une passe par facette, requête vide + filters, dédoublonnée avec les requêtes', async () => {
  const corps = [];
  const hit = { name: 'VIE - Data Analyst', slug: 'vie-data-analyst', reference: 'REF1', organization: { name: 'Hermès', slug: 'hermes' },
    offices: [{ city: 'New York', country: 'United States' }], contract_type: 'vie', published_at: '2026-08-30T10:00:00Z', profession: { name: 'Data' } };
  const http = async (req) => { corps.push(req.body); return { hits: [hit], nbPages: 1 }; };
  const r = await collecteWTTJ(http, { appId: 'APP', apiKey: 'k', queries: ['ai engineer'], filtres: ['contract_type:vie'] });
  assert.equal(corps.length, 2);
  assert.equal(corps[0].query, 'ai engineer');
  assert.equal(corps[0].filters, undefined);
  assert.equal(corps[1].query, '');
  assert.equal(corps[1].filters, 'contract_type:vie');
  assert.equal(r.length, 1);                                                 // même référence dans les deux passes
  const r2 = await collecteWTTJ(http, { appId: 'APP', apiKey: 'k', queries: [], filtres: ['contract_type:vie'] });
  assert.equal(r2.length, 1);
  assert.equal(r2[0].raw.requete, 'filtre contract_type:vie');
  const r3 = await collecteWTTJ(http, { appId: 'APP', apiKey: 'k', queries: ['ai engineer'] });
  assert.equal(r3.length, 1);                                                // sans filtres : comportement inchangé
});
