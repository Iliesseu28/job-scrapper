// Sources francophones ajoutées le 06/09/2026 : Talent.com, JobTeaser, LesJeudis,
// JobScout24, jobs.lu — plus la pagination SmartRecruiters et le JSON Feed
// Teamtailor. Aucun réseau : `http` factice qui sert des pages minimales calquées
// sur les vraies (outils/journal-des-sources.md, section « vérifiées le 06/09 »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collecteTalent, collecteJobTeaser, collecteLesJeudis, collecteJobsLu, collecteJobScout24,
  collecteATS, lireJobPosting, offreDepuisJobPosting, dateJobsLu, rotationDuJour,
} from '../../scraping/sources/index.mjs';

function fauxHttp(routes) {
  const appels = [];
  const http = async ({ url }) => {
    appels.push(url);
    for (const [motif, reponse] of routes) {
      if (typeof motif === 'string' ? url.includes(motif) : motif.test(url)) return typeof reponse === 'function' ? reponse(url) : reponse;
    }
    throw new Error('HTTP 404 ' + url);
  };
  http.appels = appels;
  return http;
}

const ldjson = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const jobPosting = (extra = {}) => ({
  '@type': 'JobPosting', title: 'Ingénieur IA', datePosted: '2026-09-04',
  hiringOrganization: { '@type': 'Organization', name: 'ACME' },
  jobLocation: { '@type': 'Place', address: { addressLocality: 'Lyon', addressRegion: 'Auvergne-Rhône-Alpes', addressCountry: 'FR' } },
  employmentType: 'FULL_TIME', description: '<p>Bonjour &amp; bienvenue</p>',
  baseSalary: { '@type': 'MonetaryAmount', currency: 'EUR', value: { '@type': 'QuantitativeValue', minValue: 45000, maxValue: 55000, unitText: 'YEAR' } },
  ...extra,
});

// --- Talent.com -----------------------------------------------------------------

const LISTE_TALENT = `
<div data-new-id="111"><article><h2 class="JobCard_title__X32Qk">Ingénieur IA</h2><span class="JobCard_company__NmRol">ACME</span><span class="JobCard_location__nmTtw">Lyon, Auvergne-Rhône-Alpes</span><a href="/view?id=111">voir</a><footer><time class="JobCard_timeText__wyyGm" dateTime="2026-08-01T08:00:00Z">il y a plus de 30 jours</time></footer></article></div>
<div data-new-id="222"><article><h2 class="JobCard_title__X32Qk">Data Engineer</h2><span class="JobCard_company__NmRol">Globex</span><span class="JobCard_location__nmTtw">Paris</span><a href="/view?id=222">voir</a><footer><time class="JobCard_timeText__wyyGm" dateTime="2026-09-05T10:00:00Z">il y a 1 jour</time></footer></article></div>`;
const FICHE_111 = `<html><head>${ldjson({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, jobPosting()] })}</head></html>`;
const FICHE_222 = `<html><head><title>Data Engineer – GLOBEX – Offre d'emploi</title><meta name="description" content="Postulez pour le poste de « Data Engineer » chez Globex"></head><body><h1>Data Engineer</h1></body></html>`;
const routesTalent = [
  ['fr.talent.com/jobs?k=intelligence%20artificielle&l=France&p=1', LISTE_TALENT],
  ['fr.talent.com/view?id=111', FICHE_111],
  ['fr.talent.com/view?id=222', FICHE_222],
];

test('Talent : JobPosting dans @graph, repli carte + <h1> + meta description sans JSON-LD', async () => {
  const http = fauxHttp(routesTalent);
  const r = await collecteTalent(http, { queries: ['intelligence artificielle'], domaines: [{ domaine: 'fr', lieu: 'France', pays: 'France' }] });
  assert.equal(r.length, 2);
  const [a, b] = r;
  assert.equal(a.source_name, 'talent');
  assert.equal(a.source_offer_id, '111');
  assert.equal(a.url, 'https://fr.talent.com/view?id=111');
  assert.equal(a.title, 'Ingénieur IA');
  assert.equal(a.company, 'ACME');
  assert.equal(a.city, 'Lyon');
  assert.equal(a.country, 'FR');
  assert.equal(a.location, 'Lyon, Auvergne-Rhône-Alpes, FR');
  assert.equal(a.contract_type, 'FULL_TIME');
  assert.equal(a.salary, '45000 - 55000 EUR / YEAR');
  assert.equal(a.publication_date, '2026-09-04');
  assert.equal(a.description, 'Bonjour & bienvenue');
  assert.equal(a.raw.domaine, 'fr');
  // Fiche sans JSON-LD : titre/entreprise/lieu de la carte, description de la meta.
  assert.equal(b.source_offer_id, '222');
  assert.equal(b.title, 'Data Engineer');
  assert.equal(b.company, 'Globex');
  assert.equal(b.city, 'Paris');
  assert.equal(b.country, 'France');
  assert.equal(b.raw.sans_jobposting, true);
  assert.equal(b.publication_date, '2026-09-05T10:00:00Z', 'date du <time dateTime> de la carte');
  assert.equal(a.publication_date, '2026-09-04', 'le datePosted du JobPosting prime sur la carte');
  assert.match(b.description, /Postulez pour le poste/);
  assert.equal(r.stats.fr.liens, 2);
  assert.equal(r.stats.fr.sansJobPosting, 1);
});

test('Talent : dejaVus évite la lecture de la fiche, un domaine en erreur ne coupe pas les autres', async () => {
  const http = fauxHttp(routesTalent);
  const r = await collecteTalent(http, {
    queries: ['intelligence artificielle'],
    domaines: [{ domaine: 'ca', lieu: 'Canada', pays: 'Canada' }, { domaine: 'fr', lieu: 'France', pays: 'France' }],
    dejaVus: new Set(['111']),
    jour: 0,
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].source_offer_id, '222');
  assert.equal(r.stats.fr.dejaConnues, 1);
  assert.ok(!http.appels.some((u) => u.includes('view?id=111')), 'la fiche 111 ne doit pas être relue');
  assert.ok(http.appels[0].startsWith('https://ca.talent.com/'), 'le domaine ca est bien tenté en premier');
});

test('Talent : maxOffres borne les fiches lues (politesse), pas les liens trouvés', async () => {
  const http = fauxHttp(routesTalent);
  const r = await collecteTalent(http, { queries: ['intelligence artificielle'], domaines: [{ domaine: 'fr', lieu: 'France', pays: 'France' }], maxOffres: 1 });
  assert.equal(r.length, 1);
  assert.equal(r.stats.fr.liens, 2);
  assert.equal(r.stats.fr.fichesLues, 1);
});

// --- JobTeaser ----------------------------------------------------------------------

test('JobTeaser : lien uuid-slug → id = uuid, TELECOMMUTE → remote, pays par défaut France', async () => {
  const uuid = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';
  const http = fauxHttp([
    ['jobteaser.com/fr/job-offers?q=LLM&page=1', `<a href="/fr/job-offers/${uuid}-stage-ia-paris">Stage IA</a>`],
    [`jobteaser.com/fr/job-offers/${uuid}-stage-ia-paris`, ldjson(jobPosting({ title: 'Stage IA', jobLocationType: 'TELECOMMUTE', jobLocation: { address: { addressLocality: 'Paris' } } }))],
  ]);
  const r = await collecteJobTeaser(http, { queries: ['LLM'] });
  assert.equal(r.length, 1);
  assert.equal(r[0].source_name, 'jobteaser');
  assert.equal(r[0].source_offer_id, uuid);
  assert.equal(r[0].title, 'Stage IA');
  assert.equal(r[0].country, 'France');
  assert.equal(r[0].remote, 'mentionné dans l’annonce');
  assert.equal(r[0].url, `https://www.jobteaser.com/fr/job-offers/${uuid}-stage-ia-paris`);
});

// --- LesJeudis ----------------------------------------------------------------------

test('LesJeudis : id numérique en fin de slug, description échappée nettoyée, page sans lien nouveau stoppe la série', async () => {
  const http = fauxHttp([
    [/lesjeudis\.com\/jobs\?search=python&page=\d/, '<a href="/fr/job/developpeur-python-ia-4567">x</a>'],
    ['lesjeudis.com/fr/job/developpeur-python-ia-4567', ldjson(jobPosting({ title: 'Développeur Python IA', description: '&lt;p&gt;Bonjour bienvenue&lt;/p&gt;' }))],
  ]);
  const r = await collecteLesJeudis(http, { queries: ['python'], pages: 3 });
  assert.equal(r.length, 1);
  assert.equal(r[0].source_name, 'lesjeudis');
  assert.equal(r[0].source_offer_id, '4567');
  assert.equal(r[0].description, 'Bonjour bienvenue');
  // page 1 (1 lien nouveau), page 2 (0 nouveau → stop), 1 fiche : jamais la page 3
  assert.equal(http.appels.length, 3);
});

// --- JobScout24 --------------------------------------------------------------------

test('JobScout24 : mot-clé en slug sans accent, devise CHF et pays CH par défaut', async () => {
  const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const http = fauxHttp([
    ['jobscout24.ch/fr/jobs/ingenieur-ia/?p=1', `<a href="/fr/job/${uuid}/">x</a>`],
    ['jobscout24.ch/fr/jobs/ingenieur-ia/?p=2', ''],
    [`jobscout24.ch/fr/job/${uuid}/`, ldjson(jobPosting({
      jobLocation: { address: { addressLocality: 'Genève' } },
      baseSalary: { '@type': 'MonetaryAmount', value: { minValue: 100000, maxValue: 120000, unitText: 'YEAR' } },
    }))],
  ]);
  const r = await collecteJobScout24(http, { queries: ['Ingénieur IA'] });
  assert.equal(http.appels[0], 'https://www.jobscout24.ch/fr/jobs/ingenieur-ia/?p=1');
  assert.equal(r.length, 1);
  assert.equal(r[0].source_name, 'jobscout24');
  assert.equal(r[0].source_offer_id, uuid);
  assert.equal(r[0].city, 'Genève');
  assert.equal(r[0].country, 'CH');
  assert.equal(r[0].salary, '100000 - 120000 CHF / YEAR');
});

// --- jobs.lu ------------------------------------------------------------------------

const LISTE_JOBSLU = `<article class="job-list-item " id="job-id-9001"><span class="date">02 September 2026</span>
<a class="job-title" href="/ApplyForJob.aspx?Id=9001">AI Engineer</a><a class="recruiter-name" href="#">LuxCorp</a>
<span class="location">Luxembourg</span></article>`;
const FICHE_JOBSLU = `<h1 class="job-title">AI Engineer</h1><dl><dt>Company:</dt><dd class="company-name">LuxCorp</dd>
<dt>Location:</dt><dd>Luxembourg, Kirchberg</dd><dt>Payment:</dt><dd>80000 - 90000 EUR</dd><dt>Last updated:</dt><dd>02 September 2026</dd>
<dt>Contract Type:</dt><dd>Permanent</dd><dt>Hours:</dt><dd>Full Time</dd></dl>
<article><div class="job-html-description"><p>Home office possible</p></div></article>`;

test('jobs.lu : liste <article> + fiche <dt>/<dd>, date anglaise convertie, contrat et horaires fusionnés', async () => {
  const http = fauxHttp([
    ['en.jobs.lu/Jobs.aspx?hd_searchbutton=true&Keywords=data&Page=1', LISTE_JOBSLU],
    ['en.jobs.lu/ApplyForJob.aspx?Id=9001', FICHE_JOBSLU],
  ]);
  const r = await collecteJobsLu(http, { queries: ['data'] });
  assert.equal(r.length, 1);
  const o = r[0];
  assert.equal(o.source_name, 'jobs_lu');
  assert.equal(o.source_offer_id, '9001');
  assert.equal(o.title, 'AI Engineer');
  assert.equal(o.company, 'LuxCorp');
  assert.equal(o.location, 'Luxembourg, Kirchberg');
  assert.equal(o.city, 'Luxembourg');
  assert.equal(o.country, 'Luxembourg');
  assert.equal(o.contract_type, 'Permanent, Full Time');
  assert.equal(o.salary, '80000 - 90000 EUR');
  assert.equal(o.publication_date, '2026-09-02');
  assert.equal(o.remote, 'mentionné dans l’annonce');
  assert.equal(o.description, 'Home office possible');
  assert.equal(o.url, 'https://en.jobs.lu/ApplyForJob.aspx?Id=9001');
  assert.equal(o.raw.publiee_liste, '2026-09-02');
});

test('jobs.lu : dejaVus saute la fiche, salaire « not specified » devient null', async () => {
  const http = fauxHttp([
    ['Keywords=data&Page=1', LISTE_JOBSLU + LISTE_JOBSLU.replace('9001', '9002').replace('9001', '9002')],
    ['ApplyForJob.aspx?Id=9002', FICHE_JOBSLU.replace('80000 - 90000 EUR', 'Not specified')],
  ]);
  const r = await collecteJobsLu(http, { queries: ['data'], dejaVus: new Set(['9001']) });
  assert.equal(r.length, 1);
  assert.equal(r[0].source_offer_id, '9002');
  assert.equal(r[0].salary, null);
  assert.equal(r.stats.dejaConnues, 1);
});

test('dateJobsLu : formats de la liste et de la fiche', () => {
  const now = Date.UTC(2026, 8, 6);
  assert.equal(dateJobsLu('02 September 2026'), '2026-09-02');
  assert.equal(dateJobsLu('Today', now), '2026-09-06');
  assert.equal(dateJobsLu('Yesterday', now), '2026-09-05');
  assert.equal(dateJobsLu('28 Dec', Date.UTC(2026, 0, 5)), '2025-12-28');
  assert.equal(dateJobsLu('n/a'), null);
  assert.equal(dateJobsLu(null), null);
});

// --- JobPosting générique ----------------------------------------------------------

test('lireJobPosting : tableau, @graph, bloc JSON invalide ignoré, absent → null', () => {
  assert.equal(lireJobPosting(ldjson([{ '@type': 'BreadcrumbList' }, jobPosting()])).title, 'Ingénieur IA');
  assert.equal(lireJobPosting(ldjson({ '@graph': [{ '@type': 'Organization' }, jobPosting({ title: 'X' })] })).title, 'X');
  assert.equal(lireJobPosting('<script type="application/ld+json">{pas du json</script>' + ldjson(jobPosting())).title, 'Ingénieur IA');
  assert.equal(lireJobPosting('<html><body>rien</body></html>'), null);
  assert.equal(lireJobPosting(ldjson({ '@type': 'JobPosting' })), null, 'un JobPosting sans titre est ignoré');
});

test('offreDepuisJobPosting : salaire simple, pays objet, remote détecté dans la description', () => {
  const o = offreDepuisJobPosting(jobPosting({
    hiringOrganization: 'Initech',
    jobLocation: [{ address: { addressLocality: 'Bruxelles', addressCountry: { '@type': 'Country', name: 'BE' } } }],
    baseSalary: { '@type': 'MonetaryAmount', currency: 'EUR', value: { value: 4000, unitText: 'MONTH' } },
    description: 'Poste en télétravail partiel',
  }), { source_name: 'x', source_offer_id: '1', url: 'u', raw: { a: 1 } });
  assert.equal(o.company, 'Initech');
  assert.equal(o.city, 'Bruxelles');
  assert.equal(o.country, 'BE');
  assert.equal(o.salary, '4000 EUR / MONTH');
  assert.equal(o.remote, 'mentionné dans l’annonce');
  assert.deepEqual(o.raw, { valide_jusqu_au: null, a: 1 });
});

// --- ATS : SmartRecruiters (pagination) et Teamtailor (JSON Feed) ------------------

test('ATS SmartRecruiters : pagine par offset jusqu’à totalFound', async () => {
  const http = fauxHttp([[/smartrecruiters\.com\/v1\/companies\/Alten\/postings\?limit=100&offset=(\d+)/, (url) => {
    const offset = Number(url.match(/offset=(\d+)/)[1]);
    const n = offset === 0 ? 100 : 50;
    return { totalFound: 150, content: Array.from({ length: n }, (_, i) => ({ id: String(offset + i), name: 'Poste ' + (offset + i), location: { city: 'Paris', country: 'fr' }, releasedDate: '2026-09-01T00:00:00.000Z' })) };
  }]]);
  const r = await collecteATS(http, { entreprises: [{ nom: 'Alten', pays: 'FR', ats: 'smartrecruiters', slug: 'Alten' }] });
  assert.equal(r.length, 150);
  assert.equal(http.appels.length, 2);
  assert.ok(http.appels[0].endsWith('offset=0'));
  assert.ok(http.appels[1].endsWith('offset=100'));
  assert.ok(r.every((o) => o.raw.ats === 'smartrecruiters' && o.company === 'Alten'));
});

test('ATS SmartRecruiters : réponse vide → aucune offre, un seul appel', async () => {
  const http = fauxHttp([['smartrecruiters.com', { totalFound: 0, content: [] }]]);
  const r = await collecteATS(http, { entreprises: [{ nom: 'Vide', pays: 'FR', ats: 'smartrecruiters', slug: 'Vide' }] });
  assert.equal(r.length, 0);
  assert.equal(http.appels.length, 1);
});

test('ATS Teamtailor : /jobs.json est un JSON Feed { items[…, _jobposting] }', async () => {
  const http = fauxHttp([['ml6.teamtailor.com/jobs.json', { version: 'https://jsonfeed.org/version/1.1', items: [{
    id: '42', title: 'ML Engineer', url: 'https://ml6.teamtailor.com/jobs/42', date_published: '2026-09-03T10:00:00+02:00',
    content_html: '<p>Build models</p>',
    _jobposting: { '@type': 'JobPosting', title: 'ML Engineer', employmentType: 'FULL_TIME', jobLocationType: 'TELECOMMUTE', jobLocation: { address: { addressLocality: 'Gand', addressCountry: 'BE' } } },
  }] }]]);
  const r = await collecteATS(http, { entreprises: [{ nom: 'ML6', pays: 'BE', ats: 'teamtailor', slug: 'ml6' }] });
  assert.equal(r.length, 1);
  const o = r[0];
  assert.equal(o.source_offer_id, 'tt:ml6:42');
  assert.equal(o.title, 'ML Engineer');
  assert.equal(o.company, 'ML6');
  assert.equal(o.city, 'Gand');
  assert.equal(o.country, 'BE');
  assert.equal(o.location, 'Gand, BE');
  assert.equal(o.contract_type, 'FULL_TIME');
  assert.equal(o.remote, 'remote');
  assert.equal(o.description, 'Build models');
  assert.equal(o.publication_date, '2026-09-03T10:00:00+02:00');
  assert.equal(o.url, 'https://ml6.teamtailor.com/jobs/42');
});

// --- Garde-fous du 06/09/2026 (la sonde est restée 2 h sur Talent) -------------

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const httpLent = (ms, routes) => {
  const base = fauxHttp(routes);
  const http = async (req) => { await dormir(ms); return base(req); };
  http.appels = base.appels;
  return http;
};

test('GARDE-FOU - le budget de temps arrête la collecte, liste comprise', async () => {
  const http = httpLent(25, [['/jobs?', LISTE_TALENT], ['/view?id=', FICHE_111]]);
  const offres = await collecteTalent(http, {
    queries: ['ia', 'ml', 'llm'], domaines: [{ domaine: 'fr', lieu: 'France', pays: 'France' }], budgetMs: 30, maxOffres: 40,
  });
  assert.ok(http.appels.length <= 3, `au plus 3 appels, ${http.appels.length} faits`);
  assert.equal(offres.stats.fr.budgetEpuise, true);
});

test('GARDE-FOU - un budget déjà épuisé saute les domaines restants sans appel', async () => {
  const http = httpLent(40, [['/jobs?', LISTE_TALENT], ['/view?id=', FICHE_111]]);
  const offres = await collecteTalent(http, {
    queries: ['ia'], jour: 0, budgetMs: 20,
    domaines: [{ domaine: 'fr', lieu: 'France' }, { domaine: 'be', lieu: 'Belgium' }, { domaine: 'ch', lieu: 'Switzerland' }],
  });
  assert.equal(http.appels.length, 1);
  assert.deepEqual(offres.stats.be, { budgetEpuise: true, saute: true });
  assert.deepEqual(offres.stats.ch, { budgetEpuise: true, saute: true });
});

test('GARDE-FOU - maxOffres Talent est un plafond global réparti entre les domaines', async () => {
  const http = fauxHttp([['/jobs?', LISTE_TALENT], ['/view?id=', FICHE_111]]);
  const offres = await collecteTalent(http, {
    queries: ['ia'], jour: 0, maxOffres: 2,
    domaines: [{ domaine: 'fr', lieu: 'France' }, { domaine: 'be', lieu: 'Belgium' }],
  });
  assert.equal(offres.stats.fr.fichesLues, 1);
  assert.equal(offres.stats.be.fichesLues, 1);
  assert.equal(http.appels.filter((u) => u.includes('/view?id=')).length, 2);
  assert.equal(offres.length, 1, 'même id 111 sur les 2 domaines : dédoublonné');
});

test('GARDE-FOU - chaque requête HTTP porte un timeout explicite', async () => {
  const timeouts = [];
  const http = async ({ url, timeout }) => { timeouts.push(timeout); return url.includes('/jobs?') ? LISTE_TALENT : FICHE_111; };
  await collecteTalent(http, { queries: ['ia'], domaines: [{ domaine: 'fr', lieu: 'France' }], timeout: 1234 });
  assert.ok(timeouts.length >= 2);
  assert.ok(timeouts.every((t) => t === 1234), JSON.stringify(timeouts));
});

test('GARDE-FOU - jobs.lu respecte aussi budget et plafond de liens', async () => {
  const carte = (id) => `<article class="job-list-item"><a id="job-id-${id}" class="job-title" href="#">Poste ${id}</a><a class="recruiter-name">ACL</a><span class="location">Luxembourg</span><span class="date">Posted 05 September 2026</span></article>`;
  const liste = Array.from({ length: 12 }, (_, i) => carte(100 + i)).join('');
  const http = fauxHttp([['Jobs.aspx', liste], ['ApplyForJob', '<html><h1>Poste</h1><div class="job-html-description">Desc</div></html>']]);
  await collecteJobsLu(http, { queries: ['a', 'b', 'c', 'd'], pages: 1, maxOffres: 2, fenetre: null });
  const listes = http.appels.filter((u) => u.includes('Jobs.aspx')).length;
  assert.equal(listes, 1, '12 cartes >= 2*4 : on ne lit pas les 3 autres listes');
  const httpB = httpLent(30, [['Jobs.aspx', liste], ['ApplyForJob', '<html><h1>Poste</h1></html>']]);
  const out = await collecteJobsLu(httpB, { queries: ['a'], maxOffres: 5, budgetMs: 35 });
  assert.equal(out.stats.budgetEpuise, true);
  assert.ok(httpB.appels.length <= 2);
});

test('GARDE-FOU - rotationDuJour fait tourner requêtes et domaines, stable pour 0 ou 1 élément', () => {
  assert.deepEqual(rotationDuJour(['a', 'b', 'c'], 0), ['a', 'b', 'c']);
  assert.deepEqual(rotationDuJour(['a', 'b', 'c'], 1), ['b', 'c', 'a']);
  assert.deepEqual(rotationDuJour(['a', 'b', 'c'], 5), ['c', 'a', 'b']);
  assert.deepEqual(rotationDuJour(['a'], 7), ['a']);
  assert.deepEqual(rotationDuJour([], 7), []);
  assert.equal(rotationDuJour(['a', 'b']).length, 2);
});

test('GARDE-FOU - Talent : la date de la carte évite de lire les fiches hors fenêtre', async () => {
  const http = fauxHttp(routesTalent);
  const r = await collecteTalent(http, {
    queries: ['intelligence artificielle'], domaines: [{ domaine: 'fr', lieu: 'France', pays: 'France' }],
    fenetre: { depuisMs: Date.parse('2026-09-01T00:00:00Z') },
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].source_offer_id, '222');
  assert.equal(r.stats.fr.tropVieilles, 1);
  assert.equal(r.stats.fr.fichesLues, 1);
  assert.ok(!http.appels.some((u) => u.includes('/view?id=111')), 'la fiche 111 (carte du 01/08) n’est pas lue');
});
