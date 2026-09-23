import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collecteStationF,
  collecteWelcomeKit,
  collecteATS
} from '../../scraping/sources/index.mjs';

function fauxHttp(routes) {
  const appels = [];
  const http = async (req) => {
    const url = req.url || req;
    appels.push(url);
    for (const [motif, reponse] of routes) {
      if (typeof motif === 'string' ? url.includes(motif) : motif.test(url)) {
        return typeof reponse === 'function' ? reponse(req) : reponse;
      }
    }
    throw new Error('HTTP 404 ' + url);
  };
  http.appels = appels;
  return http;
}

test('Station F : parse les résultats Algolia, construit les URLs et mappe les champs', async () => {
  const mockAlgoliaResponse = {
    hits: [
      {
        objectID: '12345',
        reference: 'STF_123',
        name: 'AI Product Engineer',
        slug: 'ai-product-engineer_paris',
        organization: { name: 'Goodvest', slug: 'goodvest' },
        offices: [{ city: 'Paris', country: 'France' }],
        contract_type: 'FULL_TIME',
        remote: 'partial',
        salary_min: 50000,
        salary_max: 65000,
        salary_currency: 'EUR',
        description: '<p>Mission sur les agents IA</p>',
        profile: '<p>Bac+5 et curiosité</p>',
        published_at: '2026-09-22T10:00:00Z',
      }
    ]
  };

  const http = fauxHttp([
    ['wk_cms_jobs_production_careers/query', mockAlgoliaResponse]
  ]);

  const res = await collecteStationF(http, { appId: 'TESTAPP', apiKey: 'test-key', queries: ['AI'] });
  assert.equal(res.length, 1);
  const o = res[0];
  assert.equal(o.source_name, 'stationf');
  assert.equal(o.source_offer_id, 'STF_123');
  assert.equal(o.title, 'AI Product Engineer');
  assert.equal(o.company, 'Goodvest');
  assert.equal(o.city, 'Paris');
  assert.equal(o.country, 'France');
  assert.equal(o.contract_type, 'FULL_TIME');
  assert.equal(o.remote, 'partial');
  assert.equal(o.salary, '50000-65000 EUR');
  assert.equal(o.url, 'https://jobs.stationf.co/companies/goodvest/jobs/ai-product-engineer_paris');
  assert.match(o.description, /Mission sur les agents IA/);
});

test('Station F : fenetre temporelle ignore les offres trop anciennes', async () => {
  const mockAlgoliaResponse = {
    hits: [
      {
        reference: 'STF_RECENT',
        name: 'Recent Job',
        slug: 'recent-job',
        published_at: '2026-09-20T10:00:00Z',
      },
      {
        reference: 'STF_OLD',
        name: 'Old Job',
        slug: 'old-job',
        published_at: '2026-08-01T10:00:00Z',
      }
    ]
  };

  const http = fauxHttp([
    ['wk_cms_jobs_production_careers/query', mockAlgoliaResponse]
  ]);

  const fenetre = { depuisDate: '2026-09-10T00:00:00Z' };
  const res = await collecteStationF(http, { appId: 'TESTAPP', apiKey: 'test-key', queries: [''], fenetre });
  assert.equal(res.length, 1);
  assert.equal(res[0].source_offer_id, 'STF_RECENT');
});

test('WelcomeKit : parse l’API embed, mappe les champs et gère la tolérance aux pannes', async () => {
  const mockOrgData = {
    name: 'Start The F*** Up',
    slug: 'start-the-f-up',
    jobs: [
      {
        id: 999,
        reference: 'STFU_1',
        name: 'Consultant en Innovation - Majeure IA',
        slug: 'consultant-en-innovation-majeure-ia_paris',
        description: '<p>Cadrage et POC IA</p>',
        profile: '<p>Esprit entrepreneurial</p>',
        published_at: '2026-09-15T10:00:00Z',
        office: { city: 'Paris', country: { fr: 'France' } },
        contract_type: { fr: 'CDI' },
        remote: 'partial',
        salary: { min: 45000, max: 60000, currency: 'EUR' },
        websites_urls: [{ url: 'https://welcomekit.co/stfu/job/1' }]
      }
    ]
  };

  const http = fauxHttp([
    ['organization_reference=qZoxLlg', mockOrgData],
    ['organization_reference=errorOrg', () => { throw new Error('HTTP 500 Network error'); }]
  ]);

  const res = await collecteWelcomeKit(http, {
    organisations: [
      { ref: 'qZoxLlg', nom: 'Start The F*** Up' },
      { ref: 'errorOrg', nom: 'Error Company' }
    ]
  });

  assert.equal(res.length, 1);
  const o = res[0];
  assert.equal(o.source_name, 'welcomekit');
  assert.equal(o.source_offer_id, 'wk:qZoxLlg:STFU_1');
  assert.equal(o.title, 'Consultant en Innovation - Majeure IA');
  assert.equal(o.company, 'Start The F*** Up');
  assert.equal(o.city, 'Paris');
  assert.equal(o.country, 'France');
  assert.equal(o.contract_type, 'CDI');
  assert.equal(o.remote, 'remote');
  assert.equal(o.salary, '45000-60000 EUR');
  assert.equal(o.url, 'https://welcomekit.co/stfu/job/1');
  assert.match(o.description, /Cadrage et POC IA/);
});

test('ATS : collecteATS supporte ats=welcomekit', async () => {
  const mockOrgData = {
    name: 'AI Builders',
    slug: 'ai-builders',
    jobs: [
      {
        id: 777,
        reference: 'AIB_1',
        name: 'Consultant Stratégie IA',
        slug: 'consultant-strategie-ia',
        description: '<p>Conseil IA générative</p>',
        office: { city: 'Paris', country: { fr: 'France' } },
        contract_type: { fr: 'CDI' },
        salary: { min: 50000, max: 70000, currency: 'EUR' },
        published_at: '2026-09-18T10:00:00Z',
      }
    ]
  };

  const http = fauxHttp([
    ['organization_reference=V9QjYep', mockOrgData]
  ]);

  const res = await collecteATS(http, {
    entreprises: [
      { nom: 'AI Builders', ats: 'welcomekit', slug: 'V9QjYep', pays: 'France' }
    ]
  });

  assert.equal(res.length, 1);
  const o = res[0];
  assert.equal(o.source_name, 'ats');
  assert.equal(o.source_offer_id, 'wk:V9QjYep:AIB_1');
  assert.equal(o.title, 'Consultant Stratégie IA');
  assert.equal(o.company, 'AI Builders');
  assert.equal(o.city, 'Paris');
  assert.equal(o.contract_type, 'CDI');
  assert.equal(o.salary, '50000-70000 EUR');
});
