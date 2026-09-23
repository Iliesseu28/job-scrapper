// ============================================================================
// SOURCE REGISTRY — every job source the scraper knows, in one table.
//
// Each entry says what the source is, where it covers, how it is read, which
// keys it needs, and how to call its collector from the user's profile
// (profile/sources.yaml + profile/titles.yaml). Nothing here is personal: a new
// user only edits the profile, never this file.
//
//   kind   api       official or documented public API
//          ats       company career pages read through their ATS API
//          feed      RSS / Atom / public JSON feeds
//          site-api  the JSON endpoint a job site's own front-end calls
//          html      HTML pages (often with schema.org JobPosting blocks)
//   keys   environment variables the source needs; missing → the source is skipped
//
// Collector parameters keep the original (French) names used in sources/*.mjs.
// ============================================================================
import * as S from './sources/index.mjs';

const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const q = (ctx, which) => arr(ctx.queries[which]);
const both = (ctx) => [...q(ctx, 'english'), ...q(ctx, 'local')];
const opt = (ctx, id) => ctx.sources[id] || {};

// Profile shapes (English) → collector shapes (original field names)
const toCompanies = (list) => arr(list).map((c) => ({ nom: c.name, pays: c.country, ats: c.ats, slug: c.slug }));
const toFeeds = (list) => arr(list).map((f) => ({ nom: f.name, pays: f.country || 'Remote', url: f.url }));
const toBoards = (list) => arr(list).map((b) => ({ nom: b.name, url: b.url, chemin: b.path, timeout: b.timeout }));

export const SOURCES = [
  // --- Company career pages & feeds (no key, the most reliable) -------------
  {
    id: 'ats', label: 'Company career pages (ATS)', region: 'Worldwide', kind: 'ats', keys: [],
    note: 'Ashby, Greenhouse, Lever, SmartRecruiters, Workable, Recruitee, Teamtailor, WelcomeKit — the companies you list in profile/companies.yaml.',
    run: (http, ctx) => S.collecteATS(http, { entreprises: toCompanies(ctx.companies), avertir: ctx.warn }),
  },
  {
    id: 'rss', label: 'RSS / Atom job feeds', region: 'Any', kind: 'feed', keys: [],
    note: 'Any feed you add under rss.feeds.',
    run: (http, ctx) => S.collecteRSS(http, { flux: toFeeds(opt(ctx, 'rss').feeds) }),
  },
  {
    id: 'boards', label: 'Remote job boards (Arbeitnow, Remotive, Himalayas, RemoteOK…)', region: 'Remote / Europe', kind: 'feed', keys: [],
    note: 'Public JSON APIs; add any board that returns a JSON list under boards.list.',
    run: (http, ctx) => S.collecteBoardsJSON(http, { boards: toBoards(opt(ctx, 'boards').list) }),
  },
  {
    id: 'aijobs', label: 'artificialintelligencejobs.co', region: 'Europe', kind: 'feed', keys: [],
    note: 'AI-only job board.',
    run: (http, ctx) => S.collecteAIJobs(http, { pages: opt(ctx, 'aijobs').pages || 3, region: opt(ctx, 'aijobs').region || 'europe' }),
  },

  // --- Official APIs (free key) ---------------------------------------------
  {
    id: 'adzuna', label: 'Adzuna', region: '19 countries', kind: 'api', keys: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
    note: 'Free key at developer.adzuna.com. Pick countries with adzuna.countries (fr, gb, de, us, ca…).',
    run: (http, ctx) => S.collecteAdzuna(http, {
      appId: ctx.env.ADZUNA_APP_ID, appKey: ctx.env.ADZUNA_APP_KEY, pays: arr(opt(ctx, 'adzuna').countries || ['fr']),
      queries: [...q(ctx, 'english').slice(0, 8), ...q(ctx, 'local').slice(0, 5)], maxJours: ctx.freshnessDays, fenetre: ctx.window,
    }),
  },
  {
    id: 'france_travail', label: 'France Travail (ex Pôle emploi)', region: 'France', kind: 'api', keys: ['FRANCE_TRAVAIL_ID', 'FRANCE_TRAVAIL_SECRET'],
    note: 'Free self-service key at francetravail.io (API « Offres d\'emploi v2 »).',
    run: (http, ctx) => S.collecteFranceTravail(http, {
      clientId: ctx.env.FRANCE_TRAVAIL_ID, clientSecret: ctx.env.FRANCE_TRAVAIL_SECRET,
      queries: [...q(ctx, 'local'), ...q(ctx, 'english').slice(0, 6)], maxJours: ctx.freshnessDays, fenetre: ctx.window,
    }),
  },
  {
    id: 'jooble', label: 'Jooble', region: '70 countries', kind: 'api', keys: ['JOOBLE_API_KEY'],
    note: 'Free key at jooble.org/api/about. One search = keywords + location (jooble.searches).',
    run: (http, ctx) => S.collecteJooble(http, { apiKey: ctx.env.JOOBLE_API_KEY, requetes: arr(opt(ctx, 'jooble').searches).map((s) => ({ motsCles: s.keywords, lieu: s.location })) }),
  },
  {
    id: 'mycareersfuture', label: 'MyCareersFuture (government portal)', region: 'Singapore', kind: 'api', keys: [],
    note: 'Official public API of the Singapore job portal.',
    run: (http, ctx) => S.collecteMyCareersFuture(http, { requetes: arr(opt(ctx, 'mycareersfuture').queries || q(ctx, 'english')), fenetre: ctx.window }),
  },
  {
    id: 'jobroom_ch', label: 'Job-Room (Swiss public employment service)', region: 'Switzerland', kind: 'api', keys: [],
    note: 'Official public API of job-room.ch.',
    run: (http, ctx) => S.collecteJobRoomCH(http, { requetes: arr(opt(ctx, 'jobroom_ch').queries || both(ctx)), fenetre: ctx.window }),
  },

  // --- Paid ------------------------------------------------------------------
  {
    id: 'fantastic_jobs', label: 'Fantastic Jobs (LinkedIn + ATS aggregator)', region: 'Worldwide', kind: 'api', keys: ['FANTASTIC_JOBS_API_KEY'],
    note: 'Paid API (free trial: 50 calls/week). The only lawful way here to get LinkedIn offers. callsPerRun caps the spend.',
    run: (http, ctx) => S.collecteFantasticJobs(http, {
      apiKey: ctx.env.FANTASTIC_JOBS_API_KEY, budget: opt(ctx, 'fantastic_jobs').callsPerRun ?? 1,
      offresParAppel: opt(ctx, 'fantastic_jobs').offersPerCall || 25,
      requetes: arr(opt(ctx, 'fantastic_jobs').searches).map((s) => ({ lieu: s.location, fenetre: s.window || '7d', titres: s.titles })),
    }),
  },

  // --- Job sites read through the JSON endpoint of their own front-end -------
  {
    id: 'wttj', label: 'Welcome to the Jungle', region: 'France, Europe', kind: 'site-api', keys: ['WTTJ_APP_ID', 'WTTJ_API_KEY'],
    note: 'Algolia search index of the site. The app id and search-only key are the ones your browser receives on welcometothejungle.com (DevTools → Network → "algolia").',
    run: (http, ctx) => S.collecteWTTJ(http, {
      appId: ctx.env.WTTJ_APP_ID, apiKey: ctx.env.WTTJ_API_KEY, queries: both(ctx), fenetre: ctx.window,
      filtres: arr(opt(ctx, 'wttj').filters), indices: opt(ctx, 'wttj').indices,
    }),
  },
  {
    id: 'stationf', label: 'Station F job board', region: 'France (startups)', kind: 'site-api', keys: ['STATIONF_ALGOLIA_APP_ID', 'STATIONF_ALGOLIA_KEY'],
    note: 'Algolia index behind jobs.stationf.co (search-only key visible in the browser, like WTTJ).',
    run: (http, ctx) => S.collecteStationF(http, {
      appId: ctx.env.STATIONF_ALGOLIA_APP_ID, apiKey: ctx.env.STATIONF_ALGOLIA_KEY,
      queries: arr(opt(ctx, 'stationf').queries || ['']), hitsParRequete: opt(ctx, 'stationf').hitsPerQuery || 100, pagesMax: opt(ctx, 'stationf').maxPages || 5, fenetre: ctx.window,
    }),
  },
  {
    id: 'welcomekit', label: 'WelcomeKit career sites', region: 'France', kind: 'site-api', keys: [],
    note: 'Public career-site API of WelcomeKit. List organisations with welcomekit.organizations ({ ref, name }).',
    run: (http, ctx) => S.collecteWelcomeKit(http, {
      organisations: opt(ctx, 'welcomekit').organizations ? arr(opt(ctx, 'welcomekit').organizations).map((o) => ({ ref: o.ref, nom: o.name })) : null,
      maxOffres: opt(ctx, 'welcomekit').maxOffers || 400, fenetre: ctx.window,
    }),
  },
  {
    id: 'apec', label: 'APEC', region: 'France (managers & engineers)', kind: 'site-api', keys: [],
    note: 'Search endpoint of apec.fr.',
    run: (http, ctx) => S.collecteAPEC(http, { queries: q(ctx, 'local'), fenetre: ctx.window }),
  },
  {
    id: 'vie', label: 'Business France VIE catalogue (Civiweb)', region: 'Worldwide (French VIE contracts)', kind: 'site-api', keys: ['VIE_API_KEY'],
    note: 'Whole official VIE catalogue (~800 offers). The key is the public X-API-KEY sent by mon-vie-via.businessfrance.fr.',
    run: (http, ctx) => S.collecteVIE(http, { apiKey: ctx.env.VIE_API_KEY }),
  },

  // --- HTML job sites (off by default: check each site's terms first) --------
  {
    id: 'hellowork', label: 'HelloWork', region: 'France', kind: 'html', keys: [],
    note: 'Result pages; full descriptions fetched in the second pass (details).',
    run: (http, ctx) => S.collecteHelloWork(http, { queries: [...q(ctx, 'local').slice(0, 5), ...arr(opt(ctx, 'hellowork').extraQueries)], fenetre: ctx.window }),
  },
  {
    id: 'free_work', label: 'Free-Work', region: 'France (tech, permanent & freelance)', kind: 'html', keys: [],
    note: 'One request per offer page; offers already stored are never fetched twice.',
    run: (http, ctx) => S.collecteFreeWork(http, { queries: arr(opt(ctx, 'free_work').queries || q(ctx, 'local')), pages: opt(ctx, 'free_work').pages || 2, maxOffres: opt(ctx, 'free_work').maxOffers || 60, fenetre: ctx.window, dejaVus: ctx.seen('free_work') }),
  },
  {
    id: 'espresso_jobs', label: 'Espresso-Jobs', region: 'Québec', kind: 'html', keys: [],
    note: 'schema.org JobPosting pages, salary in CAD.',
    run: (http, ctx) => S.collecteEspressoJobs(http, { queries: arr(opt(ctx, 'espresso_jobs').queries || q(ctx, 'local')), pages: opt(ctx, 'espresso_jobs').pages || 1, maxOffres: opt(ctx, 'espresso_jobs').maxOffers || 40, fenetre: ctx.window, dejaVus: ctx.seen('espresso_jobs') }),
  },
  {
    id: 'talent', label: 'Talent.com', region: 'FR, BE, CH, LU, MA, TN, SN, CI', kind: 'html', keys: [],
    note: 'One domain per country (talent.domains).',
    run: (http, ctx) => S.collecteTalent(http, {
      queries: arr(opt(ctx, 'talent').queries || q(ctx, 'local')), pages: opt(ctx, 'talent').pages || 1, maxOffres: opt(ctx, 'talent').maxOffers || 40,
      ...(opt(ctx, 'talent').domains ? { domaines: arr(opt(ctx, 'talent').domains).map((d) => ({ domaine: d.domain, lieu: d.place, pays: d.country })) } : {}),
      fenetre: ctx.window, dejaVus: ctx.seen('talent'),
    }),
  },
  {
    id: 'jobteaser', label: 'JobTeaser', region: 'France (graduates)', kind: 'html', keys: [],
    note: 'Often answers 403 to scripts (Cloudflare).',
    run: (http, ctx) => S.collecteJobTeaser(http, { queries: arr(opt(ctx, 'jobteaser').queries || q(ctx, 'local')), pages: opt(ctx, 'jobteaser').pages || 1, maxOffres: opt(ctx, 'jobteaser').maxOffers || 60, fenetre: ctx.window, dejaVus: ctx.seen('jobteaser') }),
  },
  {
    id: 'lesjeudis', label: 'LesJeudis', region: 'France (tech)', kind: 'html', keys: [],
    note: '',
    run: (http, ctx) => S.collecteLesJeudis(http, { queries: arr(opt(ctx, 'lesjeudis').queries || q(ctx, 'local')), pages: opt(ctx, 'lesjeudis').pages || 2, maxOffres: opt(ctx, 'lesjeudis').maxOffers || 40, fenetre: ctx.window, dejaVus: ctx.seen('lesjeudis') }),
  },
  {
    id: 'jobs_lu', label: 'jobs.lu', region: 'Luxembourg', kind: 'html', keys: [],
    note: '',
    run: (http, ctx) => S.collecteJobsLu(http, { queries: arr(opt(ctx, 'jobs_lu').queries || q(ctx, 'english')), pages: opt(ctx, 'jobs_lu').pages || 1, maxOffres: opt(ctx, 'jobs_lu').maxOffers || 60, fenetre: ctx.window, dejaVus: ctx.seen('jobs_lu') }),
  },
  {
    id: 'jobscout24', label: 'JobScout24', region: 'Switzerland', kind: 'html', keys: [],
    note: '',
    run: (http, ctx) => S.collecteJobScout24(http, { queries: arr(opt(ctx, 'jobscout24').queries || q(ctx, 'english')), pages: opt(ctx, 'jobscout24').pages || 2, maxOffres: opt(ctx, 'jobscout24').maxOffers || 40, fenetre: ctx.window, dejaVus: ctx.seen('jobscout24') }),
  },
  {
    id: 'jobup_ch', label: 'jobup.ch', region: 'Switzerland (French-speaking)', kind: 'html', keys: [],
    note: '',
    run: (http, ctx) => S.collecteJobupCH(http, { queries: opt(ctx, 'jobup_ch').queries || null, rows: opt(ctx, 'jobup_ch').rows || 20, maxOffres: opt(ctx, 'jobup_ch').maxOffers || 60, fenetre: ctx.window }),
  },
  {
    id: 'jobbank_canada', label: 'Job Bank (Government of Canada)', region: 'Canada', kind: 'html', keys: [],
    note: '',
    run: (http, ctx) => S.collecteJobBankCanada(http, { queries: opt(ctx, 'jobbank_canada').queries || null, pagesMax: opt(ctx, 'jobbank_canada').maxPages || 2, maxOffres: opt(ctx, 'jobbank_canada').maxOffers || 60, fenetre: ctx.window }),
  },
  {
    id: 'rekrute', label: 'ReKrute', region: 'Morocco', kind: 'html', keys: [],
    note: '',
    run: (http, ctx) => S.collecteRekrute(http, { queries: arr(opt(ctx, 'rekrute').queries || q(ctx, 'local')) }),
  },
  {
    id: 'emploitic', label: 'Emploitic', region: 'Algeria', kind: 'html', keys: [],
    note: '',
    run: (http, ctx) => S.collecteEmploitic(http, { queries: arr(opt(ctx, 'emploitic').queries || q(ctx, 'local')) }),
  },
  {
    id: 'emploidakar', label: 'EmploiDakar', region: 'Senegal', kind: 'html', keys: [],
    note: '',
    run: (http, ctx) => S.collecteEmploiDakar(http, { queries: arr(opt(ctx, 'emploidakar').queries || q(ctx, 'local')) }),
  },
  {
    id: 'hiredly', label: 'Hiredly', region: 'Malaysia', kind: 'html', keys: [],
    note: 'IT & engineering categories.',
    run: (http, ctx) => S.collecteHiredly(http, { pages: opt(ctx, 'hiredly').pages || 4 }),
  },
  {
    id: 'zhaopin', label: 'Zhaopin', region: 'China', kind: 'html', keys: [],
    note: 'Offers in Mandarin; give Mandarin queries in zhaopin.queries.',
    run: (http, ctx) => S.collecteZhaopin(http, { queries: arr(opt(ctx, 'zhaopin').queries) }),
  },
  {
    id: 'engagement_jeunes', label: 'Engagement Jeunes (VIE listings)', region: 'Worldwide (French VIE)', kind: 'html', keys: [],
    note: '',
    run: (http, ctx) => S.collecteEngagementJeunes(http, { pages: opt(ctx, 'engagement_jeunes').pages || 5, maxOffres: opt(ctx, 'engagement_jeunes').maxOffers || 60, fenetre: ctx.window, dejaVus: ctx.seen('engagement_jeunes') }),
  },
  {
    id: 'vie_entreprises', label: 'Corporate career sites (SuccessFactors, Radancy, Avature…)', region: 'Worldwide', kind: 'html', keys: [],
    note: 'Big groups\' own career sites, searched for VIE offers. Some disallow /search-jobs/ in robots.txt: read them before enabling.',
    run: (http, ctx) => S.collecteSitesVIE(http, {
      sites: arr(opt(ctx, 'vie_entreprises').sites).map((s) => ({ nom: s.name, moteur: s.engine, base: s.url, pages: s.pages, requete: s.query })),
      maxOffres: opt(ctx, 'vie_entreprises').maxOffers || 30, budgetMs: opt(ctx, 'vie_entreprises').budgetMs || 120000, fenetre: ctx.window, dejaVus: ctx.seen('vie_entreprises'),
    }),
  },
];

export const SOURCE_IDS = SOURCES.map((s) => s.id);
export const byId = (id) => SOURCES.find((s) => s.id === id);
