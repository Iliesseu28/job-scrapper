// Collecte incrémentale (06/09/2026) : fenêtre glissante, pagination, arrêt sur
// les pages trop vieilles, fiches déjà en base jamais relues, dédoublonnage.
// Aucun réseau : chaque collecteur reçoit un http factice qui journalise ses appels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../scraping/sources/index.mjs';

const JOUR = 86400000;
const NOW = Date.parse('2026-09-06T08:00:00Z');
const ilYA = (jours) => new Date(NOW - jours * JOUR).toISOString();
const aujourdhuiUTC = () => new Date().toISOString().slice(0, 10);

// http factice : `repondre(req)` fabrique la réponse ; chaque requête est journalisée.
function fauxHttp(repondre) {
  const appels = [];
  const http = async (req) => { appels.push(req); return repondre(req); };
  http.appels = appels;
  return http;
}
const F3 = C.fenetreCollecte({ fraicheurJours: 10, joursForces: 3, maintenant: NOW }); // 3 j, horloge figée
const F3_REEL = C.fenetreCollecte({ fraicheurJours: 10, joursForces: 3 });              // 3 j, horloge réelle (dates relatives)

// ---------------------------------------------------------------------------
// fenetreCollecte + dates
// ---------------------------------------------------------------------------
test('fenetreCollecte : sans historique, fenêtre complète = fraicheurJours, bornée à minuit UTC', () => {
  const f = C.fenetreCollecte({ fraicheurJours: 10, maintenant: NOW });
  assert.equal(f.jours, 10);
  assert.equal(f.heures, 240);
  assert.equal(f.depuis, '2026-08-27T00:00:00.000Z');
  assert.equal(f.depuisSecondes, Math.floor(f.depuisMs / 1000));
  assert.equal(f.dernierPassage, null);
  assert.match(f.raison, /full window/);
});

test('fenetreCollecte : passage quotidien → 3 j (1 j écoulé + marge 2), lacune de 3 j → 5 j, plafond = fraicheurJours', () => {
  assert.equal(C.fenetreCollecte({ fraicheurJours: 10, dernierPassage: ilYA(1.01), maintenant: NOW }).jours, 3);
  assert.equal(C.fenetreCollecte({ fraicheurJours: 10, dernierPassage: ilYA(3.02), maintenant: NOW }).jours, 5);
  assert.equal(C.fenetreCollecte({ fraicheurJours: 10, dernierPassage: ilYA(30), maintenant: NOW }).jours, 10);
  assert.equal(C.fenetreCollecte({ fraicheurJours: 10, dernierPassage: ilYA(1.01), margeJours: 0, maintenant: NOW }).jours, 1);
  assert.equal(C.fenetreCollecte({ fraicheurJours: 10, dernierPassage: ilYA(0.2), maintenant: NOW }).jours, 2);
});

test('fenetreCollecte : repère illisible ou futur → fenêtre complète ; joursForces prime et reste plafonné', () => {
  assert.equal(C.fenetreCollecte({ fraicheurJours: 10, dernierPassage: 'n’importe quoi', maintenant: NOW }).jours, 10);
  assert.equal(C.fenetreCollecte({ fraicheurJours: 10, dernierPassage: ilYA(-1), maintenant: NOW }).jours, 10);
  const f = C.fenetreCollecte({ fraicheurJours: 10, dernierPassage: ilYA(1), joursForces: 3, maintenant: NOW });
  assert.equal(f.jours, 3);
  assert.equal(f.raison, 'forced window');
  assert.equal(C.fenetreCollecte({ fraicheurJours: 10, joursForces: 50, maintenant: NOW }).jours, 10);
  assert.equal(F3.depuis, '2026-09-03T00:00:00.000Z');
});

test('dateRelativeFr / dateFreeWork : tournures HelloWork, Espresso et Free-Work', () => {
  assert.equal(C.dateRelativeFr('il y a 3 heures', NOW), '2026-09-06');
  assert.equal(C.dateRelativeFr('Aujourd’hui', NOW), '2026-09-06');
  assert.equal(C.dateRelativeFr('hier', NOW), '2026-09-05');
  assert.equal(C.dateRelativeFr('Publié il y a 29 jours', NOW), '2026-08-08');
  assert.equal(C.dateRelativeFr('il y a 2 semaines', NOW), '2026-08-23');
  assert.equal(C.dateRelativeFr('il y a 30+ jours', NOW), '2026-08-07');
  assert.equal(C.dateRelativeFr('il y a 1 mois', NOW), '2026-08-07');
  assert.equal(C.dateRelativeFr('publiée récemment', NOW), null);
  assert.equal(C.dateRelativeFr(null, NOW), null);
  assert.equal(C.dateFreeWork('08/24/2026'), '2026-08-24');
  assert.equal(C.dateFreeWork(' Publiée le 09/05/2026 '), '2026-09-05');
  assert.equal(C.dateFreeWork('2026-08-24T10:00:00Z'), '2026-08-24');
  assert.equal(C.dateFreeWork(''), null);
});

// ---------------------------------------------------------------------------
// Sources API paginées
// ---------------------------------------------------------------------------
const hitWTTJ = (i) => ({ reference: 'REF' + i, name: 'AI Engineer ' + i, slug: 'ai-engineer-' + i, organization: { name: 'Org', slug: 'org' }, offices: [{ city: 'Paris', country: 'France' }], published_at: ilYA(1) });

test('WTTJ : filtre serveur par date, mots vides conservés, pages jusqu’à épuisement, dédoublonnage entre requêtes', async () => {
  const http = fauxHttp((req) => (req.body.page === 0
    ? { hits: Array.from({ length: 100 }, (_, i) => hitWTTJ(i)), nbHits: 130, nbPages: 2 }
    : { hits: Array.from({ length: 30 }, (_, i) => hitWTTJ(100 + i)), nbHits: 130, nbPages: 2 }));
  const out = await C.collecteWTTJ(http, { appId: 'APPID', apiKey: 'k', queries: ['AI Engineer', 'ingénieur IA'], fenetre: F3 });
  assert.equal(http.appels.length, 4, '2 pages × 2 requêtes');
  for (const a of http.appels) {
    assert.equal(a.body.removeStopWords, false);
    assert.deepEqual(a.body.numericFilters, [`published_at_timestamp >= ${F3.depuisSecondes}`]);
  }
  assert.deepEqual(http.appels.map((a) => a.body.page), [0, 1, 0, 1]);
  assert.equal(out.length, 130, 'la même offre ressortie par deux requêtes ne sort qu’une fois');
  assert.equal(out[0].source_offer_id, 'REF0');
  assert.equal(out[0].url, 'https://www.welcometothejungle.com/fr/companies/org/jobs/ai-engineer-0');
});

test('WTTJ sans fenêtre (appel direct) : une page par requête, pas de filtre de date — comportement d’avant', async () => {
  const http = fauxHttp(() => ({ hits: Array.from({ length: 100 }, (_, i) => hitWTTJ(i)), nbHits: 130, nbPages: 2 }));
  const out = await C.collecteWTTJ(http, { appId: 'APPID', apiKey: 'k', queries: ['AI Engineer'] });
  assert.equal(http.appels.length, 1);
  assert.equal(http.appels[0].body.numericFilters, undefined);
  assert.equal(out.length, 100);
});

test('APEC : pages par startIndex, arrêt dès qu’une page entière est antérieure à la fenêtre', async () => {
  const http = fauxHttp((req) => {
    const start = req.body.pagination.startIndex;
    const date = start === 0 ? ilYA(1) : ilYA(8);
    return { totalCount: 300, resultats: Array.from({ length: 100 }, (_, i) => ({ numeroOffre: 'A' + (start + i), intitule: 'Chef de projet IA', datePublication: date, lieuTexte: 'Paris - 75' })) };
  });
  const out = await C.collecteAPEC(http, { queries: ['chef de projet IA'], fenetre: F3 });
  assert.deepEqual(http.appels.map((a) => a.body.pagination.startIndex), [0, 100], 'la 3e page n’est jamais demandée');
  assert.equal(out.length, 100, 'les offres antérieures à la fenêtre sont écartées');
});

const offreAdzuna = (id) => ({ id, title: 'AI Engineer', created: ilYA(1), description: 'x', location: { area: ['France', 'Île-de-France', 'Paris'], display_name: 'Paris' }, company: { display_name: 'ACME' } });

test('Adzuna : max_days_old = fenêtre, tri par date, pages search/1, /2… tant que count en annonce', async () => {
  const http = fauxHttp((req) => {
    const page = Number(req.url.match(/\/search\/(\d+)\?/)[1]);
    return { count: 120, results: Array.from({ length: page < 3 ? 50 : 20 }, (_, i) => offreAdzuna(`${page}-${i}`)) };
  });
  const out = await C.collecteAdzuna(http, { appId: 'id', appKey: 'key', pays: ['fr'], queries: ['AI Engineer'], fenetre: F3 });
  assert.equal(http.appels.length, 3);
  for (const a of http.appels) {
    assert.match(a.url, /max_days_old=3(&|$)/);
    assert.match(a.url, /sort_by=date/);
    assert.match(a.url, /results_per_page=50/);
  }
  assert.match(http.appels[2].url, /\/jobs\/fr\/search\/3\?/);
  assert.equal(out.length, 120);
});

test('Adzuna : pagesMax tient même quand count promet plus', async () => {
  const http = fauxHttp((req) => ({ count: 5000, results: Array.from({ length: 50 }, (_, i) => offreAdzuna(req.url.match(/\/search\/(\d+)\?/)[1] + '-' + i)) }));
  await C.collecteAdzuna(http, { appId: 'id', appKey: 'key', pays: ['fr'], queries: ['AI Engineer'], fenetre: F3, pagesMax: 6 });
  assert.equal(http.appels.length, 6);
});

test('France Travail : jeton puis tranches range=0-149, 150-299… tant qu’elles sont pleines ; minCreationDate = début de fenêtre', async () => {
  const http = fauxHttp((req) => {
    if (/access_token/.test(req.url)) return { access_token: 'jeton' };
    const debut = Number(req.url.match(/range=(\d+)-/)[1]);
    return { resultats: Array.from({ length: debut === 0 ? 150 : 20 }, (_, i) => ({ id: 'FT' + (debut + i), intitule: 'Développeur IA', dateCreation: ilYA(1), lieuTravail: { libelle: '75 - Paris' } })) };
  });
  const out = await C.collecteFranceTravail(http, { clientId: 'c', clientSecret: 's', queries: ['IA'], fenetre: F3 });
  assert.equal(http.appels.length, 3, 'jeton + 2 tranches');
  assert.match(http.appels[1].url, /range=0-149/);
  assert.match(http.appels[2].url, /range=150-299/);
  assert.ok(http.appels[1].url.includes('minCreationDate=' + encodeURIComponent('2026-09-03T00:00:00Z')));
  assert.equal(out.length, 170);
});

test('France Travail : réponse vide (204 → null) : aucune erreur, zéro offre', async () => {
  const http = fauxHttp((req) => (/access_token/.test(req.url) ? { access_token: 'jeton' } : null));
  const out = await C.collecteFranceTravail(http, { clientId: 'c', clientSecret: 's', queries: ['IA', 'ML'], fenetre: F3 });
  assert.equal(out.length, 0);
  assert.equal(http.appels.length, 3);
});

const jobIndeed = (k) => ({ job: { key: k, title: 'AI Engineer', datePublished: NOW - JOUR, description: { html: '<p>Poste IA</p>' }, location: { city: 'Paris', countryName: 'France', formatted: { long: 'Paris (75)' } }, employer: { name: 'ACME' }, attributes: [{ key: 'ft', label: 'Full-time' }], recruit: { viewJobUrl: 'https://fr.indeed.com/viewjob?jk=' + k } } });


const annonceCH = (id) => ({ jobAdvertisement: { id, publication: { startDate: '2026-09-05' }, jobContent: { jobDescriptions: [{ title: 'Automation <em>Engineer</em>', description: 'd' }], location: { city: 'Zürich', cantonCode: 'ZH', countryIsoCode: 'CH' }, company: { name: 'C' }, employment: { permanent: true } } } });

test('job-room.ch : sort=date_desc + onlineSince = fenêtre, pages tant qu’elles sont pleines', async () => {
  const http = fauxHttp((req) => { const page = Number(req.url.match(/page=(\d+)/)[1]); return Array.from({ length: page === 0 ? 100 : 10 }, (_, i) => annonceCH(`${page}-${i}`)); });
  const out = await C.collecteJobRoomCH(http, { requetes: ['automation'], fenetre: F3 });
  assert.equal(http.appels.length, 2);
  assert.match(http.appels[0].url, /&sort=date_desc/);
  assert.deepEqual(http.appels[0].body, { keywords: ['automation'], onlineSince: 3 });
  assert.equal(out.length, 110);
  assert.doesNotMatch(out[0].title, /<em>/);
});

test('job-room.ch sans fenêtre : une page, requête d’avant', async () => {
  const http = fauxHttp(() => Array.from({ length: 100 }, (_, i) => annonceCH('x' + i)));
  await C.collecteJobRoomCH(http, { requetes: ['automation'] });
  assert.equal(http.appels.length, 1);
  assert.doesNotMatch(http.appels[0].url, /sort=/);
  assert.deepEqual(http.appels[0].body, { keywords: ['automation'] });
});

const posteSG = (i, date) => ({ uuid: 'u' + i, title: 'AI Engineer', metadata: { jobPostId: 'MCF' + i, newPostingDate: date }, postedCompany: { name: 'C' }, address: {} });

test('MyCareersFuture : tri par date de publication, arrêt sur une page entièrement hors fenêtre', async () => {
  const http = fauxHttp((req) => ({ total: 300, results: Array.from({ length: 100 }, (_, i) => posteSG(req.body.page * 100 + i, req.body.page === 0 ? '2026-09-05' : '2026-08-20')) }));
  const out = await C.collecteMyCareersFuture(http, { requetes: ['ai engineer'], fenetre: F3 });
  assert.equal(http.appels.length, 2);
  assert.match(http.appels[0].url, /&sortBy=new_posting_date/);
  assert.deepEqual(http.appels.map((a) => a.body.page), [0, 1]);
  assert.equal(out.length, 100);
});

// ---------------------------------------------------------------------------
// Sources HTML : dates relatives, fiches
// ---------------------------------------------------------------------------
const carteHW = (id, anciennete) => `<li data-id-storage-item-id="${id}"><input name="title" value="Ingénieur IA ${id}"><input name="company" value="ACME"><div data-cy="localisationCard">Paris - 75</div><span>${anciennete}</span></li>`;

test('HelloWork : date relative de chaque carte, pages tournées jusqu’à une page entière hors fenêtre', async () => {
  const http = fauxHttp((req) => {
    const p = Number(req.url.match(/&p=(\d+)/)[1]);
    if (p === 1) return '<ul>' + carteHW(1, 'aujourd’hui') + carteHW(2, 'hier') + carteHW(3, 'il y a 2 jours') + '</ul>';
    if (p === 2) return '<ul>' + carteHW(4, 'il y a 8 jours') + carteHW(5, 'il y a 9 jours') + '</ul>';
    return '<ul>' + carteHW(6, 'il y a 12 jours') + '</ul>';
  });
  const out = await C.collecteHelloWork(http, { queries: ['ingénieur IA'], fenetre: F3_REEL });
  assert.equal(http.appels.length, 2, 'la page 3 n’est jamais demandée');
  assert.match(http.appels[0].url, /st=date/);
  assert.deepEqual(out.map((o) => o.source_offer_id), ['1', '2', '3']);
  assert.equal(out[0].publication_date, aujourdhuiUTC());
  assert.equal(out[1].raw.anciennete, 'hier');
});

const dateUS = (ms) => { const x = new Date(ms); return `${String(x.getUTCMonth() + 1).padStart(2, '0')}/${String(x.getUTCDate()).padStart(2, '0')}/${x.getUTCFullYear()}`; };
const ficheJP = (titre, date) => `<html><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: titre, datePosted: date, hiringOrganization: { name: 'ACME' }, jobLocation: { address: { addressLocality: 'Paris', postalCode: '75001', addressCountry: 'FR' } }, employmentType: 'FULL_TIME', description: '<p>Poste IA</p>' })}</script></html>`;
const lienFW = (slug) => `<a href="/fr/tech-it/job-mission/acme/${slug}">${slug}</a>`;
const listeFW = () => lienFW('offre-1') + `Publiée le <time>${dateUS(Date.now())}</time>` + lienFW('offre-2') + `<time>${dateUS(Date.now())}</time>` + lienFW('offre-3') + `<time>${dateUS(Date.now() - 20 * JOUR)}</time>` + lienFW('offre-4');
const estListeFW = (a) => /\/jobs\?query=/.test(a.url);
const estFicheFW = (a) => /job-mission\//.test(a.url) && !estListeFW(a);

test('Free-Work : dates lues sur la liste ; fiches déjà en base ou hors fenêtre jamais relues', async () => {
  const http = fauxHttp((req) => (estListeFW(req) ? listeFW() : ficheJP('Dev IA ' + req.url.split('/').pop(), '2026-09-05')));
  const out = await C.collecteFreeWork(http, { queries: ['ia'], pages: 1, maxOffres: 45, fenetre: F3_REEL, dejaVus: new Set(['offre-2']) });
  assert.equal(http.appels.filter(estListeFW).length, 2, 'la 2e page ne rend rien de neuf : on s’arrête');
  assert.deepEqual(http.appels.filter(estFicheFW).map((a) => a.url.split('/').pop()), ['offre-1', 'offre-4']);
  assert.deepEqual(out.stats, { liens: 4, dejaConnues: 1, tropVieilles: 1, fichesLues: 2 });
  assert.deepEqual(out.map((o) => o.source_offer_id), ['offre-1', 'offre-4']);
  assert.equal(out[0].publication_date, '2026-09-05', 'la date du JobPosting prime sur celle de la liste');
  assert.equal(out[0].raw.publiee_liste, aujourdhuiUTC());
  assert.equal(out[1].raw.publiee_liste, null, 'sans <time> après le lien, date inconnue → fiche lue quand même');
});

test('Free-Work : maxOffres plafonne les fiches lues', async () => {
  const http = fauxHttp((req) => (estListeFW(req) ? listeFW() : ficheJP('Dev IA', '2026-09-05')));
  const out = await C.collecteFreeWork(http, { queries: ['ia'], maxOffres: 1, fenetre: F3_REEL });
  assert.equal(http.appels.filter(estFicheFW).length, 1);
  assert.equal(out.stats.fichesLues, 1);
  assert.equal(out.length, 1);
});

test('Espresso : ancienneté « publish-time » de la liste, id numérique, mêmes économies que Free-Work', async () => {
  const liste = '<a href="https://www.espresso-jobs.com/emploi/123/dev-ia">x</a><span class="publish-time">Publié il y a 2 jours</span>'
    + '<a href="/emploi/456/data-eng">y</a><span class="publish-time">Publié il y a 29 jours</span>'
    + '<a href="/emploi/789/ml-eng">z</a><span class="publish-time">Publié hier</span>';
  const http = fauxHttp((req) => (/\/emploi\?keyword=/.test(req.url) ? liste : ficheJP('Dev IA', '2026-09-04')));
  const out = await C.collecteEspressoJobs(http, { queries: ['ia'], fenetre: F3_REEL, dejaVus: new Set(['789']) });
  assert.deepEqual(http.appels.filter((a) => /\/emploi\/\d+\//.test(a.url)).map((a) => a.url), ['https://www.espresso-jobs.com/emploi/123/dev-ia']);
  assert.deepEqual(out.stats, { liens: 3, dejaConnues: 1, tropVieilles: 1, fichesLues: 1 });
  assert.equal(out[0].source_offer_id, '123');
  assert.equal(out[0].country, 'Canada (Québec)');
  assert.equal(out[0].raw.publiee_liste, new Date(Date.now() - 2 * JOUR).toISOString().slice(0, 10));
});

// ---------------------------------------------------------------------------
// ATS + table des sources
// ---------------------------------------------------------------------------
test('ATS : un board qui répond 404 est signalé (avertir) sans faire tomber les autres', async () => {
  const http = fauxHttp((req) => {
    if (/greenhouse/.test(req.url)) throw new Error('HTTP 404');
    return { jobs: [{ id: 1, title: 'AI Engineer', location: 'Berlin', publishedAt: '2026-09-05' }] };
  });
  const avertissements = [];
  const out = await C.collecteATS(http, {
    entreprises: [{ nom: 'X', pays: 'DE', ats: 'greenhouse', slug: 'x' }, { nom: 'Y', pays: 'DE', ats: 'ashby', slug: 'y' }],
    avertir: (m) => avertissements.push(m),
  });
  assert.equal(out.length, 1);
  assert.deepEqual(avertissements, ['greenhouse:x — HTTP 404']);
});

