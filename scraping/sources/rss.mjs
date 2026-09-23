import { UA, clean, cut } from './_shared.mjs';

// ---------------------------------------------------------------------------
// 6. RSS — flux carrières d'entreprises
// ---------------------------------------------------------------------------
async function collecteRSS(http, { flux }) {
  const out = [];
  const tag = (bloc, nom) => {
    const m = bloc.match(new RegExp(`<${nom}[^>]*>([\\s\\S]*?)</${nom}>`, 'i'));
    if (!m) return null;
    return clean(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
  };
  for (const f of flux) {
    let xml;
    try {
      xml = await http({ method: 'GET', url: f.url, headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' }, brut: true });
    } catch (e) { continue; }
    if (typeof xml !== 'string') continue;
    const items = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
    for (const it of items) {
      const title = tag(it, 'title');
      if (!title) continue;
      let link = tag(it, 'link');
      if (!link) { const m = it.match(/<link[^>]*href="([^"]+)"/i); link = m ? m[1] : null; }
      out.push({
        source_name: 'rss', source_offer_id: `rss:${f.nom}:${(tag(it,'guid') || link || title).slice(0,120)}`,
        title: cut(title, 500), company: f.nom,
        location: tag(it, 'location') || null, city: null, country: f.pays || null,
        contract_type: null, remote: null, salary: null,
        description: cut(tag(it, 'description') || tag(it, 'summary') || tag(it, 'content'), 8000),
        url: link, contact_email: null,
        publication_date: tag(it, 'pubDate') || tag(it, 'published') || tag(it, 'updated') || null,
        raw: { flux: f.nom },
      });
    }
  }
  return out;
}

export { collecteRSS };
