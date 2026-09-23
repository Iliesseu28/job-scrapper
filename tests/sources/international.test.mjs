import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collecteJobupCH,
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

test('Jobup.ch : parse les offres depuis l\'API JSON publique suisse', async () => {
  const mockApiResponse = {
    total: 2,
    documents: [
      {
        id: 'job-12345',
        title: 'AI Engineer / Développeur IA',
        company_name: 'Infomaniak Network SA',
        place: 'Genève',
        initial_publication_date: '2026-09-21T10:00:00.000Z',
        preview: 'Développement d’agents IA et intégration RAG avec modèles open-source souverains.',
        slug: 'ai-engineer-geneve',
        _links: {
          detail_fr: {
            href: 'https://www.jobup.ch/fr/emplois/detail/job-12345/'
          }
        }
      },
      {
        id: 'job-67890',
        title: 'Stagiaire Solutions Engineer IA',
        company_name: 'Swisscom',
        place: 'Lausanne',
        initial_publication_date: '2026-09-22T14:30:00.000Z',
        preview: 'Stage de fin d’études : automatisation et intégration de solutions IA en clientèle.',
        slug: 'stagiaire-solutions-engineer',
        _links: {
          detail_fr: {
            href: 'https://www.jobup.ch/fr/emplois/detail/job-67890/'
          }
        }
      }
    ]
  };

  const http = fauxHttp([
    ['jobup.ch/api/v1/public/search', mockApiResponse]
  ]);

  const res = await collecteJobupCH(http, {
    queries: ['intelligence artificielle'],
    rows: 20,
    maxOffres: 50
  });

  assert.equal(res.length, 2);

  const o1 = res[0];
  assert.equal(o1.source_name, 'jobup_ch');
  assert.equal(o1.source_offer_id, 'job-12345');
  assert.equal(o1.title, 'AI Engineer / Développeur IA');
  assert.equal(o1.company, 'Infomaniak Network SA');
  assert.equal(o1.location, 'Genève, Suisse');
  assert.equal(o1.city, 'Genève');
  assert.equal(o1.country, 'Suisse');
  assert.equal(o1.contract_type, 'CDI');
  assert.equal(o1.url, 'https://www.jobup.ch/fr/emplois/detail/job-12345/');
  assert.match(o1.description, /Infomaniak/);

  const o2 = res[1];
  assert.equal(o2.source_name, 'jobup_ch');
  assert.equal(o2.source_offer_id, 'job-67890');
  assert.equal(o2.contract_type, 'Stage');
  assert.equal(o2.city, 'Lausanne');
  assert.equal(o2.country, 'Suisse');
});

test('Jobup.ch : déduplication et filtre de date', async () => {
  const mockApiResponse = {
    documents: [
      {
        id: 'dup-1',
        title: 'AI Consultant',
        company_name: 'ELCA',
        place: 'Genève',
        initial_publication_date: '2026-09-22T10:00:00.000Z'
      },
      {
        id: 'dup-1', // même ID
        title: 'AI Consultant',
        company_name: 'ELCA',
        place: 'Genève',
        initial_publication_date: '2026-09-22T10:00:00.000Z'
      },
      {
        id: 'old-1',
        title: 'Ancienne offre',
        company_name: 'Rolex',
        place: 'Genève',
        initial_publication_date: '2026-08-01T08:00:00.000Z'
      }
    ]
  };

  const http = fauxHttp([
    ['jobup.ch/api/v1/public/search', mockApiResponse]
  ]);

  const res = await collecteJobupCH(http, {
    queries: ['consultant'],
    fenetre: { depuisDate: '2026-09-15T00:00:00.000Z' }
  });

  assert.equal(res.length, 1);
  assert.equal(res[0].source_offer_id, 'dup-1');
});

test('Collecte ATS : Hopper (Ashby) extrait les postes tech et IA', async () => {
  const mockAshbyResponse = {
    jobs: [
      {
        id: 'ashby-hopper-001',
        title: 'Solutions Engineer - FinTech & AI',
        location: 'Montreal, QC, Canada',
        publishedAt: '2026-09-21T12:00:00.000Z',
        jobUrl: 'https://jobs.ashbyhq.com/hopper/ashby-hopper-001',
        employmentType: 'FullTime',
        descriptionHtml: '<p>Hopper is hiring a Solutions Engineer in Montreal to lead client integrations and automation.</p>'
      },
      {
        id: 'ashby-hopper-002',
        title: 'Senior Software Engineer, Platform',
        location: 'Remote, Canada',
        publishedAt: '2026-09-20T12:00:00.000Z',
        jobUrl: 'https://jobs.ashbyhq.com/hopper/ashby-hopper-002',
        employmentType: 'FullTime',
        descriptionHtml: '<p>Backend platform engineering.</p>'
      }
    ]
  };

  const http = fauxHttp([
    ['api.ashbyhq.com/posting-api/job-board/hopper', mockAshbyResponse]
  ]);

  const entreprises = [
    { nom: 'Hopper', pays: 'CA', ats: 'ashby', slug: 'hopper' }
  ];

  const res = await collecteATS(http, {
    entreprises,
    maxOffres: 10
  });

  assert.equal(res.length, 2);
  const o1 = res.find(o => o.source_offer_id === 'ashby:hopper:ashby-hopper-001');
  assert.ok(o1);
  assert.equal(o1.company, 'Hopper');
  assert.equal(o1.country, 'CA');
  assert.equal(o1.title, 'Solutions Engineer - FinTech & AI');
});
