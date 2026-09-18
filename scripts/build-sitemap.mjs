// Builds sitemap.xml with real title URLs so crawlers can discover comics.
// Usage: node scripts/build-sitemap.mjs [worker-url] [out-path]
//   worker-url defaults to the production worker, out-path to sitemap.xml.
// Pulls latest + type-genre pages (base, unenriched = fast) and emits one
// /title/<id> URL per unique title. Re-run weekly (or via cron) to refresh.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WORKER = process.argv[2] || 'https://myghoulscans-api.kev2op2021.workers.dev';
const OUT = process.argv[3] || path.join(root, 'sitemap.xml');
const SITE = 'https://ghoulforlife.github.io/MyGhoulScans';
const UA = 'MyGhoulScans-sitemap/1.0';

const get = async (p) => {
  const res = await fetch(WORKER + p, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`${p} -> ${res.status}`);
  return res.json();
};

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const url = (loc, freq, prio) => `  <url>\n    <loc>${escXml(loc)}</loc>\n    <changefreq>${freq}</changefreq>\n    <priority>${prio}</priority>\n  </url>`;

const seen = new Map(); // id -> title
const take = (data) => {
  for (const m of (data && data.data) || []) {
    if (m && m.id && String(m.id).startsWith('cx:') && !seen.has(m.id)) {
      seen.set(m.id, m.title || '');
    }
  }
};

const jobs = [`/comick/latest?source=mangaread`];
for (const g of ['manga', 'manhwa', 'manhua']) {
  for (let page = 1; page <= 3; page++) {
    jobs.push(`/comick/genre?source=mangaread&genre=${g}&page=${page}`);
  }
}
let ok = 0;
for (const j of jobs) {
  try {
    take(await get(j));
    ok++;
    process.stdout.write(`\rcollecting… ${seen.size} titles (${ok}/${jobs.length} feeds)`);
  } catch (e) {
    process.stdout.write(`\rskip ${j} (${e.message})`);
  }
}
console.log('');

const statics = [
  url(`${SITE}/`, 'daily', '1.0'),
  url(`${SITE}/popular`, 'daily', '0.8'),
  url(`${SITE}/shop`, 'weekly', '0.5'),
  url(`${SITE}/library`, 'weekly', '0.5'),
  url(`${SITE}/originals`, 'weekly', '0.5'),
];
const titles = [...seen.keys()].map((id) => url(`${SITE}/title/${encodeURIComponent(id)}`, 'weekly', '0.6'));
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...statics, ...titles].join('\n')}\n</urlset>\n`;
writeFileSync(OUT, xml);
console.log(`sitemap written: ${titles.length} titles + ${statics.length} pages -> ${OUT}`);
