import { clean, horsFenetre, ajouter, ENTETES_FR, collecteParJobPosting } from './_shared.mjs';

// ----------------------------------------------------------------------------
// JOBS.LU — Luxembourg. Pas de JSON-LD : liste `<article class="job-list-item"
// id="job-id-N">`, fiche `/ApplyForJob.aspx?Id=N` en HTML <dt>/<dd>.
// 40 offres par page de liste, tri par date.
// ----------------------------------------------------------------------------
const MOIS_EN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// « 02 September 2026 », « 02 Sep », « Today », « Yesterday » → YYYY-MM-DD (ou null).
function dateJobsLu(texte, maintenant = Date.now()) {
  if (!texte) return null;
  const t = String(texte).trim().toLowerCase();
  const jourISO = (ms) => new Date(ms).toISOString().slice(0, 10);
  if (/^today/.test(t)) return jourISO(maintenant);
  if (/^yesterday/.test(t)) return jourISO(maintenant - 86400000);
  const m = t.match(/(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{4}))?/);
  if (!m || !MOIS_EN[m[2].slice(0, 3)]) return null;
  const mois = MOIS_EN[m[2].slice(0, 3)];
  const annee = m[3] ? Number(m[3]) : new Date(maintenant).getUTCFullYear();
  let ms = Date.UTC(annee, mois - 1, Number(m[1]));
  if (!m[3] && ms > maintenant + 86400000) ms = Date.UTC(annee - 1, mois - 1, Number(m[1]));   // « 28 Dec » lu en janvier
  return Number.isFinite(ms) ? jourISO(ms) : null;
}

async function collecteJobsLu(http, { queries = [], pages = 1, maxOffres = 60, budgetMs = 60000, timeout = 20000, fenetre = null, dejaVus = null } = {}) {
  const BASE = 'https://en.jobs.lu';
  const limite = Date.now() + budgetMs;   // mêmes garde-fous que collecteParJobPosting
  const epuise = () => Date.now() > limite;
  let budgetEpuise = false;
  // 1) Liste : id, titre, entreprise, lieu et date de chaque carte.
  const cartes = new Map();
  listes: for (const q of queries) {
    for (let p = 1; p <= pages; p++) {
      if (epuise()) { budgetEpuise = true; break listes; }
      if (cartes.size >= maxOffres * 4) break listes;
      const url = `${BASE}/Jobs.aspx?hd_searchbutton=true&Keywords=${encodeURIComponent(q)}&Page=${p}`;
      let html;
      try { html = await http({ url, headers: ENTETES_FR, brut: true, timeout }); } catch (e) { break; }
      if (typeof html !== 'string') break;
      let nouveaux = 0;
      for (const bloc of html.split(/<article class="job-list-item/).slice(1)) {
        const id = (bloc.match(/id="job-id-(\d+)"/) || [])[1];
        if (!id || cartes.has(id)) continue;
        const champ = (re) => { const m = bloc.match(re); return m ? clean(m[1]) : null; };
        cartes.set(id, {
          title: champ(/class="job-title"[^>]*>([\s\S]*?)<\/a>/),
          company: champ(/class="recruiter-name"[^>]*>([\s\S]*?)<\/a>/),
          location: champ(/class="location"[^>]*>([\s\S]*?)<\/span>/),
          date: dateJobsLu(champ(/class="date"[^>]*>([\s\S]*?)<\/span>/)),
          requete: q,
        });
        nouveaux++;
      }
      if (nouveaux === 0) break;
    }
  }

  // 2) Fiche : <dt>Clé:</dt><dd>valeur</dd> + description dans job-html-description.
  const out = [];
  const vus = new Set();
  const stats = { liens: cartes.size, dejaConnues: 0, tropVieilles: 0, fichesLues: 0, budgetEpuise };
  for (const [id, carte] of cartes) {
    if (dejaVus && dejaVus.has(id)) { stats.dejaConnues++; continue; }
    if (horsFenetre(carte.date, fenetre)) { stats.tropVieilles++; continue; }
    if (stats.fichesLues >= maxOffres) break;
    if (epuise()) { stats.budgetEpuise = true; break; }
    stats.fichesLues++;
    const url = `${BASE}/ApplyForJob.aspx?Id=${id}`;
    let page;
    try { page = await http({ url, headers: ENTETES_FR, brut: true, timeout }); } catch (e) { continue; }
    if (typeof page !== 'string') continue;
    const dd = (cle) => { const m = page.match(new RegExp(`<dt>\\s*${cle}\\s*:?\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`, 'i')); return m ? clean(m[1]) : null; };
    const h1 = page.match(/<h1 class="job-title"[^>]*>([\s\S]*?)<\/h1>/);
    const societe = page.match(/class="company-name"[^>]*>([\s\S]*?)<\/dd>/);
    const iBalise = page.indexOf('job-html-description');
    const iDesc = iBalise >= 0 ? page.indexOf('>', iBalise) + 1 : -1;   // on part APRES la balise ouvrante
    const jDesc = iDesc >= 0 ? page.indexOf('</article>', iDesc) : -1;
    const description = iDesc >= 0 ? clean(page.slice(iDesc, jDesc > iDesc ? jDesc : iDesc + 60000)) : null;
    const title = (h1 ? clean(h1[1]) : null) || carte.title;
    if (!title) continue;
    const lieu = dd('Location') || carte.location || null;
    const paiement = dd('Payment');
    const heures = dd('Hours');
    const contrat = dd('Contract Type');
    const dateFiche = dateJobsLu(dd('Last updated'));
    const offre = {
      source_name: 'jobs_lu',
      source_offer_id: id,
      title: title.slice(0, 500),
      company: (societe ? clean(societe[1]) : null) || carte.company || null,
      location: lieu,
      city: lieu ? lieu.split(/[,/]/)[0].trim() : null,
      country: 'Luxembourg',
      contract_type: [contrat, heures].filter(Boolean).join(', ') || null,
      remote: /t[ée]l[ée]travail|remote|home ?office|distanciel|hybride|hybrid/i.test(description || '') ? 'mentionné dans l’annonce' : null,
      salary: paiement && !/non communiqu|not (specified|disclosed)|negotiable|à négocier/i.test(paiement) ? paiement : null,
      description: description ? description.slice(0, 6000) : null,
      url,
      contact_email: null,
      publication_date: dateFiche || carte.date || null,
      raw: { requete: carte.requete, publiee_liste: carte.date },
    };
    if (horsFenetre(offre.publication_date, fenetre)) { stats.tropVieilles++; continue; }
    ajouter(out, vus, offre);
  }
  out.stats = stats;
  return out;
}

export { MOIS_EN, dateJobsLu, collecteJobsLu };
