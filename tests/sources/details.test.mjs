// node --test tests/ — deuxième temps de la collecte (08/09/2026) : pour les
// offres gardées sans texte (HelloWork) ou avec un simple extrait (WTTJ), on
// relit la fiche publique et son bloc schema.org JobPosting avant la notation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobPostingDe, champsJobPosting, aRelire, enrichirDescriptions, estDefiRobot, lireFiche, FICHES_DEFAUT } from '../../scraping/details.mjs';

const page = (...blocs) => '<html><head><script type="application/ld+json">'
  + blocs.join('</script>\n<script type="application/ld+json">')
  + '</script></head><body><script>var x = 1 < 2;</script><p>fin</p></body></html>';

const JP = {
  '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Consultant IA',
  // « 1 < 2 » dans le JSON : une regex « tout sauf < » s'arrêterait là (faux négatif vu sur HelloWork)
  description: '<p>Vous accompagnez nos clients &amp; leurs &eacute;quipes.</p><ul><li>POC</li><li>Ateliers</li></ul><p>Note : 1 < 2</p>',
  datePosted: '2026-09-05', employmentType: ['FULL_TIME', 'CDI'], validThrough: '2026-10-05',
  jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Lyon', addressCountry: 'FR' } },
};
const ORG = { '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme' };
// Fiche complète : c'est le cas réel (HelloWork 4 500 car., WTTJ 4 700 a 7 100), face a l'extrait
// Algolia de 500 car. que WTTJ donne au premier temps.
const JP_LONG = { ...JP, description: JP.description + '<p>' + 'Missions variees et concretes. '.repeat(40) + '</p>' };

test('jobPostingDe : trouve le JobPosting en 2e bloc, dans un tableau ou un @graph ; null sinon', () => {
  assert.equal(jobPostingDe(page(JSON.stringify(ORG), JSON.stringify(JP))).title, 'Consultant IA');
  assert.equal(jobPostingDe(page(JSON.stringify([ORG, JP]))).title, 'Consultant IA');
  assert.equal(jobPostingDe(page(JSON.stringify({ '@context': 'https://schema.org', '@graph': [ORG, JP] }))).title, 'Consultant IA');
  assert.equal(jobPostingDe(page('{ pas du json', JSON.stringify(JP))).title, 'Consultant IA', 'un bloc illisible est ignoré');
  assert.equal(jobPostingDe(page(JSON.stringify(ORG))), null);
  assert.equal(jobPostingDe('<html>rien</html>'), null);
  assert.equal(jobPostingDe(null), null);
  assert.equal(jobPostingDe({ hits: [] }), null, 'une réponse JSON (pas du HTML) ne casse rien');
});

test('champsJobPosting : texte sans balises, entités décodées, date ISO, contrat joint, ville', () => {
  const f = champsJobPosting(JP);
  assert.equal(f.description, 'Vous accompagnez nos clients & leurs équipes.\nPOC\nAteliers\nNote : 1 < 2');
  assert.equal(f.publication_date, '2026-09-05T00:00:00.000Z');
  assert.equal(f.contract_type, 'FULL_TIME, CDI');
  assert.equal(f.city, 'Lyon');
  assert.equal(f.valide_jusqu_au, '2026-10-05');
  assert.equal(champsJobPosting({ ...JP, description: '<p> </p>' }), null, 'sans description : rien à écrire');
  assert.equal(champsJobPosting({ ...JP, datePosted: 'hier', employmentType: 'CDI' }).publication_date, null);
  assert.equal(champsJobPosting({ ...JP, employmentType: 'CDI' }).contract_type, 'CDI');
  assert.equal(champsJobPosting(null), null);
});

const HW = 'https://www.hellowork.com/fr-fr/emplois/12345.html';
const WT = 'https://www.welcometothejungle.com/fr/companies/acme/jobs/consultant-ia_paris';

test('aRelire : sources relisibles, URL attendue, texte absent ou trop court', () => {
  const cfg = FICHES_DEFAUT;
  assert.equal(aRelire({ source_name: 'hellowork', url: HW, description: null }, cfg), true);
  assert.equal(aRelire({ source_name: 'wttj', url: WT, description: 'x'.repeat(500) }, cfg), true);
  assert.equal(aRelire({ source_name: 'wttj', url: WT, description: 'x'.repeat(3000) }, cfg), false, 'déjà un vrai texte');
  assert.equal(aRelire({ source_name: 'adzuna', url: 'https://www.adzuna.fr/details/1', description: null }, cfg), false, 'Adzuna : défi AWS WAF, pas relue');
  assert.equal(aRelire({ source_name: 'hellowork', url: 'https://autre-site.example/12345.html', description: null }, cfg), false, 'jamais un autre site');
  assert.equal(aRelire({ source_name: 'hellowork', url: HW, description: null }, { ...cfg, sources: [] }), false, 'liste vide = étape inactive');
});

const fauxHttp = (comportement, journal) => async (req) => {
  journal.push(req);
  const c = comportement[req.url];
  if (c instanceof Error) throw c;
  return c;
};

test('enrichirDescriptions : complète en place, rend les correctifs, compte lectures, échecs et fiches sans gain', async () => {
  const A = { id: 1, source_name: 'hellowork', url: HW, description: null, publication_date: '2026-09-04T10:00:00Z', contract_type: 'CDI' };
  const B = { id: 2, source_name: 'wttj', url: WT, description: 'extrait '.repeat(60), publication_date: null, contract_type: null };
  const C = { id: 3, source_name: 'wttj', url: WT + '-long', description: 'x'.repeat(3000) };
  const D = { id: 4, source_name: 'adzuna', url: 'https://www.adzuna.fr/details/9', description: null };
  const E = { id: 5, source_name: 'hellowork', url: 'https://www.hellowork.com/fr-fr/emplois/666.html', description: null };
  const F = { id: 6, source_name: 'hellowork', url: 'https://www.hellowork.com/fr-fr/emplois/777.html', description: null };
  const journal = [];
  const http = fauxHttp({
    [HW]: page(JSON.stringify(ORG), JSON.stringify(JP)),
    [WT]: page(JSON.stringify(JP_LONG)),
    [E.url]: new Error('HTTP 503 GET ' + E.url),
    [F.url]: '<html><body>page sans JobPosting</body></html>',
  }, journal);
  const erreurs = [];
  const { stats, patches } = await enrichirDescriptions(http, [A, B, C, D, E, F], { pauseMs: 0, pauseParSource: {} }, { surErreur: (m, o) => erreurs.push([o.id, m]) });

  assert.deepEqual(journal.map((r) => r.url), [HW, WT, E.url, F.url], 'C (texte complet) et D (Adzuna) ne sont pas lues');
  assert.equal(journal[0].brut, true);
  assert.equal(journal[0].timeout, FICHES_DEFAUT.timeoutMs);
  assert.match(journal[0].headers['User-Agent'], /Mozilla/);
  assert.deepEqual({ ...stats, ms: 0 }, { candidates: 4, lues: 4, enrichies: 2, sansGain: 1, echecs: 1, bloquees: 0, budgetEpuise: false, sourcesArretees: [], ms: 0, parSource: { hellowork: { lues: 3, enrichies: 1 }, wttj: { lues: 1, enrichies: 1 } } });
  assert.deepEqual(erreurs, [[5, 'HTTP 503 GET ' + E.url]]);

  assert.equal(patches.length, 2);
  assert.deepEqual(Object.keys(patches[0].corps), ['description'], 'A avait déjà date et contrat : seule la description est écrite');
  assert.deepEqual(patches[1], { id: 2, corps: { description: champsJobPosting(JP_LONG).description, publication_date: '2026-09-05T00:00:00.000Z', contract_type: 'FULL_TIME, CDI' } });
  assert.match(A.description, /^Vous accompagnez/, 'l’offre est complétée en place pour la passe IA qui suit');
  assert.equal(A.publication_date, '2026-09-04T10:00:00Z', 'la date déjà connue n’est pas écrasée');
  assert.equal(E.description, null, 'fiche illisible : offre inchangée');
  assert.equal(F.description, null);
});

test('enrichirDescriptions : plafond maxParPasse et budget de temps ; rien ne remonte', async () => {
  const offres = () => [1, 2, 3].map((i) => ({ id: i, source_name: 'hellowork', url: `https://www.hellowork.com/fr-fr/emplois/${i}.html`, description: null }));
  const journal = [];
  const http = async (req) => { journal.push(req.url); return page(JSON.stringify(JP)); };
  let r = await enrichirDescriptions(http, offres(), { pauseMs: 0, pauseParSource: {}, maxParPasse: 1 });
  assert.equal(journal.length, 1);
  assert.equal(r.stats.candidates, 3, 'les candidates non lues sont comptées : on sait ce qui reste');
  assert.equal(r.stats.enrichies, 1);

  r = await enrichirDescriptions(http, offres(), { pauseMs: 0, pauseParSource: {}, budgetMs: -1 });
  assert.equal(journal.length, 1, 'budget épuisé : aucune lecture');
  assert.equal(r.stats.budgetEpuise, true);

  r = await enrichirDescriptions(http, [], null);
  assert.deepEqual(r.patches, []);
  r = await enrichirDescriptions(http, offres(), { sources: null });
  assert.equal(r.stats.candidates, 0, 'sources illisibles = étape inactive');
});

// 08/09/2026 : WTTJ a servi ce défi en HTTP 200 après une vingtaine de fiches rapprochées.
// Sans détection, la page passait pour une fiche vide et on continuait à frapper le site.
const DEFI = '<!DOCTYPE html><html lang="en"><head><title></title><script type="text/javascript">'
  + 'window.awsWafCookieDomainList = []; window.gokuProps = { "key":"AQID...", "iv":"grDT" };</script></head><body></body></html>';

test('estDefiRobot / lireFiche : un défi anti-robot n’est pas une fiche vide', async () => {
  assert.equal(estDefiRobot(DEFI), true);
  assert.equal(estDefiRobot(page(JSON.stringify(JP))), false);
  const httpDefi = async () => DEFI;
  assert.deepEqual(await lireFiche(httpDefi, HW, {}), { fiche: null, erreur: null, bloquee: true });
  // Une vraie fiche qui parlerait de DataDome dans son texte reste une fiche : le test
  // n’est consulté que si la page ne porte aucun JobPosting.
  const httpVraie = async () => page(JSON.stringify({ ...JP, description: JP.description + ' Nous utilisons DataDome.' }));
  const r = await lireFiche(httpVraie, HW, {});
  assert.equal(r.bloquee, false);
  assert.match(r.fiche.description, /DataDome/);
  // Adzuna répond 405, l’APEC 403 : un code d’erreur peut lui aussi être un défi.
  const http405 = async () => { throw new Error('HTTP 405 GET ' + HW); };
  assert.equal((await lireFiche(http405, HW, {})).bloquee, true);
  const http500 = async () => { throw new Error('HTTP 500 GET ' + HW); };
  assert.equal((await lireFiche(http500, HW, {})).bloquee, false, 'une panne du site n’est pas un blocage');
});

test('enrichirDescriptions : une source qui sert des défis est laissée tranquille pour le reste du passage', async () => {
  const offres = [1, 2, 3, 4, 5].map((i) => ({ id: i, source_name: 'wttj', url: WT + '-' + i, description: null }));
  const vues = [];
  const http = async (req) => { vues.push(req.url); return DEFI; };
  const dits = [];
  const { stats, patches } = await enrichirDescriptions(http, offres, { pauseMs: 0, pauseParSource: {} }, { surErreur: (m, o) => dits.push([o.id, m]) });
  assert.equal(vues.length, 2, 'deux défis suffisent : on arrête de frapper le site');
  assert.equal(stats.bloquees, 2);
  assert.equal(stats.echecs, 0, 'un blocage n’est pas une panne : compté à part');
  assert.equal(stats.sansGain, 0, 'et ce n’est pas non plus une fiche sans gain');
  assert.deepEqual(stats.sourcesArretees, ['wttj']);
  assert.equal(stats.candidates, 5, 'les trois offres non lues restent candidates pour la fois suivante');
  assert.deepEqual(patches, []);
  assert.equal(dits.length, 2);
  assert.match(dits[0][1], /defi anti-robot/);

  // L’arrêt ne vaut que pour la source qui bloque.
  const melange = [{ id: 9, source_name: 'hellowork', url: HW, description: null }, ...offres];
  const vues2 = [];
  const http2 = async (req) => { vues2.push(req.url); return req.url === HW ? page(JSON.stringify(JP_LONG)) : DEFI; };
  const r2 = await enrichirDescriptions(http2, melange, { pauseMs: 0, pauseParSource: {} });
  assert.equal(r2.stats.enrichies, 1, 'HelloWork continue');
  assert.deepEqual(r2.stats.sourcesArretees, ['wttj']);
});
