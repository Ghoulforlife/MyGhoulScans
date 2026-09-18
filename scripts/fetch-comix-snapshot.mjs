// Refreshes the bundled Comix snapshot (worker/comix-snapshot.json).
// comix.to blocks datacenter IPs (Cloudflare Workers / Render get HTTP 404),
// so the worker serves this snapshot whenever the live fetch fails.
// Run from a normal home connection, then redeploy:
//   node scripts/fetch-comix-snapshot.mjs
//   npx wrangler deploy   (from worker/)
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchHtml(url, referer) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
      'Sec-Fetch-User': '?1',
      ...(referer ? { Referer: referer } : {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

const cxEncode = (source, url) => `cx:${source}:${Buffer.from(url, 'utf8').toString('base64url')}`;

function normItem(it) {
  const url = 'https://comix.to' + (it.url || '');
  const poster = (it.poster && (it.poster.large || it.poster.medium)) || '';
  return {
    id: cxEncode('comix', url),
    source: 'comix',
    title: it.title || 'Untitled',
    url,
    cover: poster,
    latestChapter: it.latestChapter ?? 0,
    latestChapterLabel: it.latestChapter != null ? String(it.latestChapter) : '',
    status: it.status || '',
    type: it.type || '',
    rating: it.ratedAvg ?? null,
    follows: it.followsTotal ?? 0,
    contentRating: it.contentRating || '',
  };
}

function normDetail(d) {
  return {
    title: d.title || 'Untitled',
    cover: (d.poster && (d.poster.large || d.poster.medium)) || '',
    description: d.synopsis || '',
    status: d.status || '',
    type: d.type || '',
    genres: Array.isArray(d.genres) ? d.genres.map((g) => g.title || g.slug).filter(Boolean) : [],
    contentRating: d.contentRating || '',
    latestChapter: d.latestChapter ?? 0,
    firstChapterUrl: d.firstChapterUrl ? 'https://comix.to' + d.firstChapterUrl : '',
    latestChapterUrl: d.latestChapterUrl ? 'https://comix.to' + d.latestChapterUrl : '',
  };
}

const pick = (q, pred) => {
  const key = Object.keys(q).find((k) => {
    try { return pred(JSON.parse(k)); } catch { return false; }
  });
  let arr = key ? q[key] : [];
  if (arr && !Array.isArray(arr)) arr = arr.items || arr.data || [];
  return Array.isArray(arr) ? arr : [];
};

console.log('fetching comix.to homepage…');
const html = await fetchHtml('https://comix.to');
const m = html.match(/<script type="application\/json" id="initial-data">([\s\S]*?)<\/script>/);
if (!m) throw new Error('initial-data not found');
const q = (JSON.parse(m[1]).queries) || {};
const feeds = {
  trending: pick(q, (p) => p[0] === 'manga' && p[1] === 'top' && p[2] && p[2].type === 'trending').map(normItem),
  follows: pick(q, (p) => p[0] === 'manga' && p[1] === 'top' && p[2] && p[2].type === 'follows').map(normItem),
  hot: pick(q, (p) => p[0] === 'manga' && p[1] === 'list' && p[2] && p[2].scope === 'hot').map(normItem),
  recent: pick(q, (p) => p[0] === 'manga' && p[1] === 'list' && p[2] && p[2].order && p[2].order.created_at === 'desc').map(normItem),
};
console.log('feeds:', Object.entries(feeds).map(([k, v]) => `${k}=${v.length}`).join(' '));

// Details for every charted title (title pages are blocked server-side too,
// so these power /api/comick/title + /chapters for comix).
const urls = [...new Set(Object.values(feeds).flat().map((t) => t.url))];
console.log(`fetching ${urls.length} title pages…`);
const titles = {};
let i = 0;
for (const url of urls) {
  i++;
  try {
    const h = await fetchHtml(url, 'https://comix.to/');
    const dm = h.match(/<script type="application\/json" id="initial-data">([\s\S]*?)<\/script>/);
    if (!dm) throw new Error('no data');
    const dq = (JSON.parse(dm[1]).queries) || {};
    const key = Object.keys(dq).find((k) => {
      try { const p = JSON.parse(k); return p[0] === 'manga' && p[1] === 'detail'; } catch { return false; }
    });
    const d = key ? dq[key] : null;
    if (d && d.title) titles[url] = normDetail(d);
    else console.log(`  [${i}/${urls.length}] EMPTY ${url}`);
  } catch (e) {
    console.log(`  [${i}/${urls.length}] FAIL ${url} (${e.message})`);
  }
  await new Promise((r) => setTimeout(r, 250));
  if (i % 20 === 0) console.log(`  …${i}/${urls.length}`);
}

const out = { at: new Date().toISOString(), data: feeds, titles };
const dest = path.join(root, 'worker', 'comix-snapshot.json');
writeFileSync(dest, JSON.stringify(out));
console.log(`wrote ${dest} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB), titles=${Object.keys(titles).length}`);
