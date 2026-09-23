import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collecteJobBankCanada,
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

test('Job Bank Canada : extrait les offres depuis le HTML avec métadonnées et salaires', async () => {
  const mockHtml = `
    <!DOCTYPE html>
    <html>
    <body>
      <div id="results-list">
        <article id="article-4321098" class="resultJobItem">
          <a class="resultJobItem" href="/jobsearch/jobposting/4321098;jsessionid=xyz">
            <span class="noctitle">Développeur d'agents IA / Machine Learning</span>
          </a>
          <ul class="list-unstyled">
            <li class="business">Nord Quantique</li>
            <li class="location">Montréal (QC), Canada</li>
            <li class="date">2026-09-21</li>
            <li class="salary">95 000 $ - 120 000 $ par an</li>
          </ul>
        </article>
        <article id="article-4321099" class="resultJobItem">
          <a class="resultJobItem" href="/jobsearch/jobposting/4321099">
            <span class="noctitle">Stagiaire en automatisation et IA</span>
          </a>
          <ul class="list-unstyled">
            <li class="business">Flinks Technologies</li>
            <li class="location">Québec (QC), Canada</li>
            <li class="date">2026-09-22</li>
            <li class="salary">30,00 $ / heure</li>
          </ul>
        </article>
      </div>
    </body>
    </html>
  `;

  const http = fauxHttp([
    ['jobbank.gc.ca', mockHtml]
  ]);

  const res = await collecteJobBankCanada(http, {
    queries: ['intelligence artificielle'],
    pagesMax: 1
  });

  assert.equal(res.length, 2);

  const o1 = res[0];
  assert.equal(o1.source_name, 'jobbank_canada');
  assert.equal(o1.source_offer_id, '4321098');
  assert.equal(o1.title, "Développeur d'agents IA / Machine Learning");
  assert.equal(o1.company, 'Nord Quantique');
  assert.equal(o1.city, 'Montréal');
  assert.equal(o1.country, 'Canada');
  assert.equal(o1.contract_type, 'Permanent');
  assert.equal(o1.salary, '95 000 $ - 120 000 $ par an');
  assert.equal(o1.url, 'https://www.jobbank.gc.ca/jobsearch/jobposting/4321098');

  const o2 = res[1];
  assert.equal(o2.source_name, 'jobbank_canada');
  assert.equal(o2.source_offer_id, '4321099');
  assert.equal(o2.title, 'Stagiaire en automatisation et IA');
  assert.equal(o2.contract_type, 'Stage');
  assert.equal(o2.city, 'Québec');
});

test('Job Bank Canada : filtre par date avec fenetre temporelle et déduplique', async () => {
  const mockHtml = `
    <article id="article-100">
      <span class="noctitle">AI Engineer</span>
      <li class="business">Vooban</li>
      <li class="date">2026-09-20</li>
    </article>
    <article id="article-200">
      <span class="noctitle">Old Job</span>
      <li class="business">Autre</li>
      <li class="date">2026-08-01</li>
    </article>
  `;

  const http = fauxHttp([
    ['jobbank.gc.ca', mockHtml]
  ]);

  const res = await collecteJobBankCanada(http, {
    queries: ['q1', 'q2'],
    pagesMax: 1,
    fenetre: { depuisDate: '2026-09-15T00:00:00Z' }
  });

  // article-100 est gardé, article-200 est trop ancien, déduplication sur article-100 entre q1 et q2
  assert.equal(res.length, 1);
  assert.equal(res[0].source_offer_id, '100');
});

test('ATS Québec : Vooban (Greenhouse) et Mila (Workable) collectent correctement', async () => {
  const mockGreenhouseVooban = {
    jobs: [
      {
        id: 78901,
        title: "Stratège en ingénierie de solution",
        location: { name: "Montréal, QC" },
        content: "Mission d'architecture de solutions d'IA agentique",
        absolute_url: "https://job-boards.greenhouse.io/vooban/jobs/78901",
        updated_at: "2026-09-20T12:00:00Z"
      }
    ]
  };

  const mockWorkableMila = {
    jobs: [
      {
        id: "mila-456",
        shortcode: "ABC123D",
        title: "Développeur.se d'applications IA",
        city: "Montréal",
        country: "Canada",
        employment_type: "Full-time",
        telecommuting: true,
        description: "Développement de prototypes IA et LLM",
        requirements: "Expérience Python et PyTorch",
        url: "https://apply.workable.com/mila-2/j/ABC123D/",
        published_on: "2026-09-21T09:00:00Z"
      }
    ]
  };

  const http = fauxHttp([
    ['greenhouse.io/v1/boards/vooban', mockGreenhouseVooban],
    ['apply.workable.com/api/v1/widget/accounts/mila-2', mockWorkableMila]
  ]);

  const res = await collecteATS(http, {
    entreprises: [
      { nom: 'Vooban', pays: 'CA', ats: 'greenhouse', slug: 'vooban' },
      { nom: 'Mila', pays: 'CA', ats: 'workable', slug: 'mila-2' }
    ]
  });

  assert.equal(res.length, 2);
  const voobanJob = res.find((x) => x.company === 'Vooban');
  assert.ok(voobanJob);
  assert.equal(voobanJob.title, "Stratège en ingénierie de solution");
  assert.equal(voobanJob.city, "Montréal, QC");

  const milaJob = res.find((x) => x.company === 'Mila');
  assert.ok(milaJob);
  assert.equal(milaJob.title, "Développeur.se d'applications IA");
  assert.equal(milaJob.remote, "remote");
});

