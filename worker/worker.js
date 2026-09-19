// MyGhoulScans static API — runs on Cloudflare Workers (free tier).
// Serves the GitHub Pages build: Comick-source comic routes (search, title,
// chapters, page images, latest, genres) + account/library/progress/comments
// storage on D1, with CORS for browser calls.
// Deploy: npx wrangler deploy  (needs a D1 database bound as DB — run
// worker/schema.sql on it once first; see worker/wrangler.toml)
// NOTE: uploads/originals can't work here (no filesystem) — those endpoints
// return clean empty states, and the static build hides the publish buttons.
import COMIX_SNAPSHOT from './comix-snapshot.json';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};
const json = (data, status = 200, ttl = 60) => new Response(JSON.stringify(data), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` },
});
const err = (message, status = 502) => json({ error: message }, status, 0);

// ---------- Comick source API ----------
const COMICK_API_DEFAULT = 'https://comick-source-api.notaspider.dev';
const SCRAPE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 MyGhoulScans/2.0';
const COMICK_DEFAULT_SOURCES = ['mangaread', 'flamecomics', 'mangayy', 'mangataro', 'demonicscans'];
// Upstream search health, verified 2026-09-17. Priority sources return
// results; dead ones are Shutdown or always empty.
const SEARCH_PRIORITY = ['mangaread', 'flamecomics', 'mangayy', 'mangataro', 'demonicscans'];
const SEARCH_DEAD = new Set(['bato', 'mangapark', 'falcon-scans', 'weebdex', 'mangasushi', 'madarascans']);

// base64url without Node Buffer (Workers runtime).
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function cxEncode(source, url) {
  return `cx:${source}:${b64urlEncode(url)}`;
}
function cxDecode(id) {
  const m = /^cx:([^:]+):([A-Za-z0-9_-]+)$/.exec(String(id || ''));
  if (!m) return null;
  try {
    const url = b64urlDecode(m[2]);
    if (!/^https?:\/\//i.test(url)) return null;
    return { source: m[1], url };
  } catch { return null; }
}

const comickBase = (env) => (env && env.COMICK_API_BASE) || COMICK_API_DEFAULT;
async function comickApi(env, path, { method = 'GET', body } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${comickBase(env)}${path}`, {
        method,
        headers: {
          'User-Agent': SCRAPE_UA,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) {
        const e = new Error(`Comick API ${res.status} for ${path}`);
        e.status = res.status;
        throw e;
      }
      return res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < 1) await new Promise((r) => setTimeout(r, 700));
    }
  }
  throw lastErr || new Error('Comick API unavailable');
}

async function fetchHtml(url, referer) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': SCRAPE_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.7',
          ...(referer ? { Referer: referer } : {}),
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const e = new Error(`Source ${res.status} for ${String(url).split('?')[0]}`);
        e.status = res.status;
        throw e;
      }
      return (await res.text()).slice(0, 4 * 1024 * 1024);
    } catch (e) {
      lastErr = e;
      if (attempt < 1) await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  throw lastErr || new Error('Fetch failed');
}

// comix.to sits behind bot filtering that 404s bare datacenter requests, so
// comix pages are fetched with full browser-navigation headers. Used ONLY for
// comix.to (WP scrapers keep the plain fetch above).
async function fetchComixHtml(url, referer) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
          'Sec-Fetch-User': '?1',
          'sec-ch-ua': '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          ...(referer ? { Referer: referer } : {}),
        },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) {
        const e = new Error(`Source ${res.status} for ${String(url).split('?')[0]}`);
        e.status = res.status;
        throw e;
      }
      return (await res.text()).slice(0, 4 * 1024 * 1024);
    } catch (e) {
      lastErr = e;
      if (attempt < 1) await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  throw lastErr || new Error('Fetch failed');
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
    // Numeric entities from upstream/WordPress text (&#8217; → ’, &#x2019; → ’).
    .replace(/&#(\d{1,7});/g, (_, n) => {
      const c = parseInt(n, 10);
      return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : _;
    })
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, h) => {
      const c = parseInt(h, 16);
      return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : _;
    })
    .trim();
}
function absUrl(maybeRel, base) {
  try {
    // Keep inner spaces intact — `new URL` below percent-encodes them (%20).
    // Stripping whitespace corrupts CDN paths like ".../Solo Leveling/1.jpg".
    const u = String(maybeRel || '').trim();
    if (!u || u.startsWith('data:')) return '';
    return new URL(u, base).toString();
  } catch { return ''; }
}
function imgTagSrc(tag) {
  const attr = (n) => {
    const m = tag.match(new RegExp(n + '\\s*=\\s*(["\'])(.*?)\\1', 'is'));
    return m ? m[2].trim() : '';
  };
  // Single-URL attributes keep inner spaces (absUrl encodes them as %20).
  const one = (v) => String(v || '').trim();
  const srcset = attr('data-srcset') || attr('srcset');
  if (srcset) {
    const first = srcset.split(',')[0].trim().split(/\s+/)[0];
    if (first) return one(first);
  }
  return one(attr('data-src')) || one(attr('data-lazy-src')) || one(attr('data-original')) || one(attr('src'));
}
const JUNK_IMG = /(logo|avatar|userpic|banner|icon|[\W_]ads?(?=[-_.]|$)|advert|free[_-]?ads?|premium|btn[_-]?close|close[_-]?btn|pubadx|demon-(logo|title)|gravatar|emoji|spinner|loading|placeholder|favicon|\.svg(\?|$))/i;
function cleanImgList(urls) {
  const out = [];
  const seen = new Set();
  for (let u of urls) {
    u = String(u || '').trim();
    if (!u.startsWith('http')) continue;
    if (!/\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(u)) continue;
    if (JUNK_IMG.test(u)) continue;
    const key = u.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}
function metaContent(html, prop) {
  const tag = html.match(new RegExp('<meta[^>]*property=["\']' + prop + '["\'][^>]*>', 'i'));
  if (!tag) return '';
  const c = tag[0].match(/content=["']([^"']{1,500})["']/i);
  return c ? decodeEntities(c[1]) : '';
}

// Source synopses ship with credit boilerplate + raw URLs
// ("**Original Webtoon:** [KakaoPage] (https://…), [Daum] (https://…)").
// Readers only want the story text — strip links, keep words, never emit <a>.
function cleanSynopsis(s) {
  let t = String(s || '');
  t = t.replace(/\[([^\]]{1,120})\]\((https?:[^)\s]{1,500})\)/gi, '$1');
  t = t.replace(/https?:\/\/[^\s)'"]+/gi, '');
  t = t.replace(/\*\*/g, '');
  t = t.replace(/\[(KakaoPage|Daum|Kakao Webtoon|Webtoon|Original Webtoon)[^\]]*\]/gi, '');
  t = t.replace(/\(\s*\)/g, '');
  t = t.replace(/"?\*{0,2}"?Original Webtoon"?:?\*{0,2}"?\s*,?/gi, '');
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/\s+([,.!?;:])/g, '$1').trim();
  t = t.replace(/,\s*,/g, ',').replace(/\(\s*,/, '(').replace(/,\s*\)/, ')').replace(/\(\s*\)/g, '').trim();
  return t.slice(0, 1500);
}

async function scrapeTitle(source, url) {
  const html = await fetchHtml(url);
  let title = metaContent(html, 'og:title');
  const cover = absUrl(metaContent(html, 'og:image'), url);
  let description = metaContent(html, 'og:description');
  if (!title) {
    const h1 = html.match(/<h1[^>]*>([\s\S]{1,200}?)<\/h1>/i);
    title = decodeEntities((h1 ? h1[1].replace(/<[^>]+>/g, ' ') : '').replace(/\s+/g, ' ').trim()).split(' - ')[0].trim();
  }
  let status = '';
  let type = '';
  const genres = [];
  if (/post-status|summary__content|wp-manga|profile-manga/i.test(html)) {
    const pair = (label) => {
      const m = html.match(new RegExp('summary-heading[^>]*>\\s*<h5>\\s*' + label + '[\\s\\S]{0,200}?summary-content[^>]*>\\s*([^<]{1,30})', 'i'));
      return m ? decodeEntities(m[1]).trim() : '';
    };
    status = pair('Status');
    type = pair('Type');
    const gbox = html.match(/genres-content[^>]*>([\s\S]{1,1500}?)<\/div>/i);
    if (gbox) {
      const seen = new Set();
      const re = /<a[^>]+href=["'][^"']*\/genres?\/[^"']*["'][^>]*>([^<]{1,30})<\/a>/gi;
      let g;
      while ((g = re.exec(gbox[1])) && genres.length < 10) {
        const name = decodeEntities(g[1]).trim();
        if (name.length > 1 && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); genres.push(name); }
      }
    }
    if (!description) {
      const d = html.match(/summary__content[^>]*>([\s\S]{1,3000}?)<\/div>/i);
      if (d) description = decodeEntities(d[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 1500);
    }
  }
  return { title: title || 'Untitled', cover, description: cleanSynopsis(description), status, type, genres };
}
const titleCache = new Map();
const TITLE_TTL = 10 * 60 * 1000;
async function cachedTitle(source, url) {
  const hit = titleCache.get(url);
  if (hit && Date.now() - hit.at < TITLE_TTL) return hit.data;
  const data = source === 'comix' ? await scrapeComixTitle(url) : await scrapeTitle(source, url);
  if (titleCache.size > 500) titleCache.delete(titleCache.keys().next().value);
  titleCache.set(url, { data, at: Date.now() });
  return data;
}

// Comix title details (same embedded JSON as the homepage feeds, but for one
// hid plus genres). Chapter images need their private API, so chapters below
// expose first/latest links opened externally.
async function scrapeComixTitle(url) {
  try {
    const html = await fetchComixHtml(url, 'https://comix.to/');
  const m = html.match(/<script type="application\/json" id="initial-data">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Comix title data not found');
  const initial = JSON.parse(m[1]);
  const q = (initial && initial.queries) || {};
  const key = Object.keys(q).find((k) => {
    try { const p = JSON.parse(k); return p[0] === 'manga' && p[1] === 'detail'; } catch { return false; }
  });
  const d = key ? q[key] : null;
  if (!d || !d.title) throw new Error('Comix title data not found');
  const genres = Array.isArray(d.genres) ? d.genres.map((g) => g.title || g.slug).filter(Boolean) : [];
  return {
    title: d.title,
    cover: (d.poster && (d.poster.large || d.poster.medium)) || '',
    description: cleanSynopsis(d.synopsis || ''),
    status: d.status || '',
    type: d.type || '',
    genres,
    contentRating: d.contentRating || '',
    latestChapter: d.latestChapter ?? 0,
    firstChapterUrl: d.firstChapterUrl ? 'https://comix.to' + d.firstChapterUrl : '',
    latestChapterUrl: d.latestChapterUrl ? 'https://comix.to' + d.latestChapterUrl : '',
  };
  } catch (e) {
    const snap = COMIX_SNAPSHOT && COMIX_SNAPSHOT.titles;
    const hit = snap && snap[url];
    if (hit) return { ...hit, description: cleanSynopsis(hit.description || '') };
    throw e;
  }
}
async function comixChapters(mangaUrl) {
  const t = await scrapeComixTitle(mangaUrl);
  const numOf = (u, fb) => {
    const n = String(u || '').match(/chapter-(\d+(?:\.\d+)?)/i);
    return n ? parseFloat(n[1]) : fb;
  };
  const out = [];
  if (t.firstChapterUrl) {
    out.push({ id: t.firstChapterUrl, number: numOf(t.firstChapterUrl, 1), title: 'Chapter 1', url: t.firstChapterUrl, external: true });
  }
  if (t.latestChapterUrl && t.latestChapterUrl !== t.firstChapterUrl) {
    const n = numOf(t.latestChapterUrl, Number(t.latestChapter) || 0);
    out.push({ id: t.latestChapterUrl, number: n, title: 'Chapter ' + (n || t.latestChapter || '?'), url: t.latestChapterUrl, external: true });
  }
  if (!out.length) throw new Error('No chapters found for this title');
  return out.sort((a, b) => a.number - b.number);
}

function extractPages(html, chapterUrl) {
  if (html.includes('wp-manga-chapter-img')) {
    const tags = [...html.matchAll(/<img[^>]*wp-manga-chapter-img[^>]*>/gi)].map((m) => m[0]);
    const pages = cleanImgList(tags.map((t) => absUrl(imgTagSrc(t), chapterUrl)));
    if (pages.length) return pages;
  }
  let hash = '';
  try {
    const segs = new URL(chapterUrl).pathname.split('/').filter(Boolean);
    hash = segs[segs.length - 1] || '';
  } catch {}
  const candidates = [
    ...[...html.matchAll(/<img[^>]{0,1500}>/gi)].map((m) => absUrl(imgTagSrc(m[0]), chapterUrl)),
    ...[...html.matchAll(/https?:\/\/[^"'<>\s]+?\.(?:jpe?g|png|webp)(?:\?[^"'<>\s]*)?/gi)].map((m) => m[0]),
  ];
  if (hash.length >= 8) {
    const mine = cleanImgList(candidates.filter((u) => u.includes(`/${hash}/`) && !u.includes('/assets/') && !/thumbnail/i.test(u)));
    if (mine.length) return mine;
  }
  let scope = html;
  const start = html.search(/<div[^>]*reading-content[^>]*>/i);
  if (start !== -1) {
    scope = html.slice(start, start + 400000);
    const end = scope.search(/id=["']comments["']|comments-area|<footer|select-paged|chnav/i);
    if (end !== -1) scope = scope.slice(0, end);
  }
  return cleanImgList([...scope.matchAll(/<img[^>]{0,1500}>/gi)].map((m) => absUrl(imgTagSrc(m[0]), chapterUrl)));
}
const pagesCache = new Map();
const PAGES_TTL = 10 * 60 * 1000;

// Chapter release dates live on the source manga page (wp-manga themes):
// <li class="wp-manga-chapter"><a href=".../chapter-68/">…</a>
// <span class="chapter-release-date"><i>07.01.2026</i></span></li>
// Upstream has no dates, so parse them here (best-effort) and attach by URL.
function parseChapterDate(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  const now = Date.now();
  let m = t.match(/(\d{1,2})[.](\d{1,2})[.](\d{4})/); // 07.01.2026
  if (m) {
    const d = Date.UTC(+m[3], +m[2] - 1, +m[1]);
    return isNaN(d) ? null : d;
  }
  m = t.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/); // January 7, 2026
  if (m) {
    const d = Date.parse(`${m[1]} ${m[2]}, ${m[3]}`);
    return isNaN(d) ? null : d;
  }
  m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); // 2026-01-07
  if (m) {
    const d = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d) ? null : d;
  }
  m = t.toLowerCase().replace(/\bsecs?\b/g, 'second').replace(/\bmins?\b/g, 'minute').replace(/\bhrs?\b/g, 'hour').match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (m) {
    const mult = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 7 * 864e5, month: 30 * 864e5, year: 365 * 864e5 };
    return now - (+m[1]) * (mult[m[2]] || 864e5);
  }
  m = t.toLowerCase().match(/\b(an?)\s+(second|minute|hour|day|week|month|year)\s+ago/); // "a day ago"
  if (m) {
    const mult = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 7 * 864e5, month: 30 * 864e5, year: 365 * 864e5 };
    return now - mult[m[2]];
  }
  if (/yesterday/i.test(t)) return now - 864e5;
  if (/today|just now/i.test(t)) return now;
  return null;
}
function parseChapterDates(html, base) {
  const map = new Map();
  for (const li of html.matchAll(/<li[^>]*wp-manga-chapter[^>]*>([\s\S]{0,1200}?)(?=<li[^>]*wp-manga-chapter|<\/ul>)/gi)) {
    const block = li[0].slice(0, 1500);
    const a = block.match(/<a[^>]+href=["']([^"']+)["']/i);
    if (!a) continue;
    const url = absUrl(a[1], base);
    const d = block.match(/chapter-release-date[^>]*>\s*(?:<[^>]+>)?\s*([^<]{1,40})/i);
    const ts = d ? parseChapterDate(decodeEntities(d[1])) : null;
    if (url && ts) map.set(url.replace(/\/$/, ''), ts);
  }
  return map;
}
const chapterDatesCache = new Map(); // mangaUrl -> { map, at }
const CHAPTER_DATES_TTL = 10 * 60 * 1000;
async function chapterDatesFor(source, mangaUrl, fetchFn) {
  if (source === 'comix') return new Map();
  const hit = chapterDatesCache.get(mangaUrl);
  if (hit && Date.now() - hit.at < CHAPTER_DATES_TTL) return hit.map;
  try {
    const html = await Promise.race([
      fetchFn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('dates timeout')), 8000)),
    ]);
    const map = parseChapterDates(html, mangaUrl);
    if (chapterDatesCache.size > 200) chapterDatesCache.delete(chapterDatesCache.keys().next().value);
    chapterDatesCache.set(mangaUrl, { map, at: Date.now() });
    return map;
  } catch { return new Map(); }
}
function attachChapterDates(list, map) {
  for (const c of list) {
    const ts = map.get(String(c.url || '').replace(/\/$/, ''));
    if (ts) c.date = ts;
  }
  return list;
}

async function comickChapters(env, source, mangaUrl) {
  if (source === 'comix') return comixChapters(mangaUrl);
  try {
    const data = await comickApi(env, '/api/chapters', { method: 'POST', body: { url: mangaUrl, source } });
    const list = (data.chapters || []).map((c) => ({
      id: String(c.id ?? c.number),
      number: Number(c.number) || 0,
      title: decodeEntities(c.title || ''),
      url: c.url,
    })).filter((c) => c.url);
    if (list.length) {
      const dates = await chapterDatesFor(source, mangaUrl, () => fetchHtml(mangaUrl));
      return attachChapterDates(list.sort((a, b) => a.number - b.number), dates);
    }
  } catch {}
  const ajaxUrl = mangaUrl.replace(/\/$/, '') + '/ajax/chapters/';
  const res = await fetch(ajaxUrl, {
    method: 'POST',
    headers: { 'User-Agent': SCRAPE_UA, 'X-Requested-With': 'XMLHttpRequest', Referer: mangaUrl },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Chapter list unavailable (source ${res.status})`);
  const html = await res.text();
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([^<]{1,80})<\/a>/gi)) {
    const url = absUrl(m[1], mangaUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const label = decodeEntities(m[2]).trim();
    const num = (label.match(/chapter\s+(\d+(?:\.\d+)?)/i) || [])[1] || (url.match(/chapter[/-](\d+(?:\.\d+)?)/i) || [])[1];
    out.push({ id: url, number: num ? parseFloat(num) : 0, title: label, url });
  }
  if (!out.length) throw new Error('Chapter list unavailable');
  return attachChapterDates(out.sort((a, b) => a.number - b.number), parseChapterDates(html, mangaUrl));
}

function extractLatestWp(html, base) {
  const blocks = html.split('page-item-detail');
  const out = [];
  const seen = new Set();
  for (let i = 1; i < blocks.length && out.length < 30; i++) {
    const b = blocks[i].slice(0, 9000);
    const link = b.match(/<a[^>]+href=["']([^"']*\/manga\/[^"']*\/)["'][^>]*>([^<]{1,150})<\/a>/i);
    if (!link) continue;
    const url = absUrl(link[1], base);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const img = b.match(/<img[^>]{0,900}>/i);
    const ch = b.match(/<a[^>]+href=["']([^"']*chapter[^"']*)["'][^>]*>\s*([^<]{1,50})</i);
    // Latest-chapter age: <span class="post-on">2 mins ago</span> after the link.
    let latestChapterDate = null;
    if (ch) {
      const after = b.slice(ch.index + ch[0].length, ch.index + ch[0].length + 400);
      const t = after.match(/post-on[^>]*>\s*([^<]{1,40})/i);
      if (t) latestChapterDate = parseChapterDate(decodeEntities(t[1]));
    }
    out.push({
      title: decodeEntities(link[2]).trim(),
      url,
      cover: img ? absUrl(imgTagSrc(img[0]), base) : '',
      latestChapter: ch ? decodeEntities(ch[2]).trim().replace(/^chapter\s+/i, '') : '',
      latestChapterDate,
    });
  }
  return out;
}
const latestCache = new Map();
const LATEST_TTL = 2 * 60 * 1000;
let comickSourcesCache = null;
async function comickSourceBase(env, source) {
  if (!comickSourcesCache || Date.now() - comickSourcesCache.at > 3600 * 1000) {
    try {
      const data = await comickApi(env, '/api/sources');
      comickSourcesCache = { list: data.sources || [], at: Date.now() };
    } catch {
      comickSourcesCache = { list: [], at: Date.now() };
    }
  }
  const hit = comickSourcesCache.list.find((s) => String(s.id).toLowerCase() === source);
  return hit ? hit.baseUrl : null;
}

function normResult(source, r) {
  const url = r.url;
  return {
    id: cxEncode(source, url),
    source,
    title: decodeEntities(r.title),
    url,
    cover: r.coverImage || '',
    latestChapter: r.latestChapter || 0,
    lastUpdated: r.lastUpdated || '',
    rating: r.rating ?? null,
  };
}

// Comix homepage feeds (see server.js — same embedded-JSON approach).
const comixCache = { data: null, at: 0 };
const COMIX_TTL = 10 * 60 * 1000;
function normComixItem(it) {
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
async function fetchComixHome() {
  if (comixCache.data && Date.now() - comixCache.at < COMIX_TTL) return comixCache.data;
  try {
    const html = await fetchComixHtml('https://comix.to');
  const m = html.match(/<script type="application\/json" id="initial-data">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Comix homepage data not found');
  const initial = JSON.parse(m[1]);
  const q = (initial && initial.queries) || {};
  const pick = (pred) => {
    const key = Object.keys(q).find((k) => {
      try { return pred(JSON.parse(k)); } catch { return false; }
    });
    let arr = key ? q[key] : [];
    // "top" feeds are bare arrays; "list" feeds are { items, meta } objects.
    if (arr && !Array.isArray(arr)) arr = arr.items || arr.data || [];
    return (Array.isArray(arr) ? arr : []).map(normComixItem);
  };
  const data = {
    trending: pick((p) => p[0] === 'manga' && p[1] === 'top' && p[2] && p[2].type === 'trending'),
    follows: pick((p) => p[0] === 'manga' && p[1] === 'top' && p[2] && p[2].type === 'follows'),
    hot: pick((p) => p[0] === 'manga' && p[1] === 'list' && p[2] && p[2].scope === 'hot'),
    recent: pick((p) => p[0] === 'manga' && p[1] === 'list' && p[2] && p[2].order && p[2].order.created_at === 'desc'),
  };
  if (!data.trending.length && !data.follows.length && !data.hot.length && !data.recent.length) {
    throw new Error('Comix feeds came back empty');
  }
    comixCache.data = { ...data, stale: false };
    comixCache.at = Date.now();
    return comixCache.data;
  } catch (e) {
    // comix.to blocks datacenter IPs — fall back to the bundled snapshot
    // (refresh with scripts/fetch-comix-snapshot.mjs + redeploy).
    const snap = COMIX_SNAPSHOT && COMIX_SNAPSHOT.data;
    if (snap && (snap.trending || snap.follows || snap.hot || snap.recent)) {
      comixCache.data = { ...snap, stale: true, snapshotAt: COMIX_SNAPSHOT.at || null };
      comixCache.at = Date.now();
      return comixCache.data;
    }
    throw e;
  }
}

async function enrichItems(items) {
  const out = new Map();
  let i = 0;
  const workers = [];
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('enrich timeout')), ms))]);
  for (let w = 0; w < 4; w++) {
    workers.push((async () => {
      while (i < items.length) {
        const it = items[i++];
        const dec = cxDecode(it.id);
        if (!dec) continue;
        try {
          const t = await withTimeout(cachedTitle(dec.source, dec.url), 15000);
          out.set(it.id, { genres: t.genres || [], status: t.status || '', type: t.type || '' });
        } catch {}
      }
    })());
  }
  await Promise.all(workers);
  return out;
}

const genresCache = new Map();
const GENRES_TTL = 3600 * 1000;
const FALLBACK_GENRES = ['action', 'adventure', 'comedy', 'drama', 'fantasy', 'harem', 'historical', 'horror', 'isekai', 'martial-arts', 'mature', 'mecha', 'mystery', 'psychological', 'romance', 'school-life', 'sci-fi', 'seinen', 'shoujo', 'shounen', 'slice-of-life', 'sports', 'supernatural', 'tragedy'];
const prettySlug = (s) => s.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const genreCache = new Map();
const GENRE_TTL = 2 * 60 * 1000;

// ---------- Static accounts (Cloudflare D1, free tier) ----------
// Needs a D1 database bound as DB (see worker/schema.sql for tables).
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.match(/../g).map((h) => parseInt(h, 16)));
async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `${hex(salt)}$${hex(bits)}`;
}
async function verifyPassword(pw, stored) {
  try {
    const [saltHex, hashHex] = String(stored).split('$');
    const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(saltHex), iterations: 100000, hash: 'SHA-256' }, key, 256);
    return hex(bits) === hashHex;
  } catch { return false; }
}
const userPublic = (u) => u && { id: u.id, email: u.email, display_name: u.display_name, avatar: u.avatar, rp: u.rp || 0, name_color: u.name_color || '', title: u.title || '', frame: u.frame || '', theme: u.theme || '', owned: u.owned || '[]', created_at: u.created_at };
// Runtime migration for pre-existing D1 databases (schema.sql covers fresh
// ones): Reader Points + shop cosmetics columns. Runs once per isolate.
let userColsEnsured = false;
async function ensureUserColumns(env) {
  if (userColsEnsured || !env.DB) return;
  for (const ddl of [
    'ALTER TABLE users ADD COLUMN rp INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN name_color TEXT NOT NULL DEFAULT \'\'',
    'ALTER TABLE users ADD COLUMN title TEXT NOT NULL DEFAULT \'\'',
    'ALTER TABLE users ADD COLUMN frame TEXT NOT NULL DEFAULT \'\'',
    'ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT \'\'',
    'ALTER TABLE users ADD COLUMN owned TEXT NOT NULL DEFAULT \'[]\'',
    'ALTER TABLE users ADD COLUMN read_seconds INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN last_read_at TEXT',
  ]) {
    try { await env.DB.prepare(ddl).run(); } catch {}
  }
  userColsEnsured = true;
}
// RP value of a single vote state (+2 per like, -1 per dislike, 0 none).
const rpVoteValue = (v) => (v === 1 ? 2 : v === -1 ? -1 : 0);
// Shop catalog (prices enforced here — the client never sends a price).
// Colors run 1k (common) to 1M (mythic Rainbow); titles scale with coolness.
const _shopSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const _shopTitleFx = (price) => (price >= 300000 ? 'legend' : price >= 50000 ? 'veteran' : price >= 8000 ? 'critic' : '');
const SHOP_EXTRA_COLORS = [
  ['Ember Red', '#ff5252', 1000], ['Cherry', '#de3163', 1200], ['Brick', '#b22222', 1200],
  ['Rust', '#b7410e', 1500], ['Amber', '#ffbf00', 1800], ['Honey', '#eb9605', 1800],
  ['Lemon', '#fff44f', 2000], ['Lime', '#32cd32', 2000], ['Mint', '#98ff98', 2200],
  ['Jade', '#00a86b', 2500], ['Teal', '#008080', 2500], ['Sky', '#87ceeb', 2800],
  ['Azure', '#007fff', 2800], ['Cobalt', '#0047ab', 3000], ['Indigo', '#4b0082', 3000],
  ['Lilac', '#c8a2c8', 3500], ['Mauve', '#e0b0ff', 3500], ['Rose', '#f33a6a', 4000],
  ['Coral', '#ff7f50', 4000], ['Salmon', '#fa8072', 4500], ['Peach', '#ffe5b4', 4500],
  ['Banana', '#ffe135', 5000], ['Blush', '#ffb6c1', 5000], ['Sand', '#c2b280', 5000],
  ['Scarlet', '#ff2400', 6000], ['Ruby Red', '#e0115f', 7000], ['Wine', '#722f37', 7000],
  ['Maroon', '#800000', 8000], ['Olive', '#808000', 8000], ['Moss', '#8a9a5b', 9000],
  ['Forest Green', '#228b22', 9000], ['Pine', '#01796f', 10000], ['Seafoam', '#93e9be', 10000],
  ['Aqua', '#00ffff', 11000], ['Turquoise', '#40e0d0', 11000], ['Sapphire', '#0f52ba', 12000],
  ['Navy', '#000080', 12000], ['Midnight Blue', '#191970', 13000], ['Plum', '#dda0dd', 13000],
  ['Orchid', '#da70d6', 14000], ['Magenta', '#ff00ff', 14000], ['Fuchsia', '#ff77ff', 15000],
  ['Tangerine', '#f28500', 15000], ['Apricot', '#fbceb1', 16000], ['Copper', '#b87333', 18000],
  ['Bronze Tone', '#cd7f32', 18000], ['Brass', '#b5a642', 20000], ['Khaki', '#c3b091', 20000],
  ['Taupe', '#483c32', 22000], ['Slate', '#708090', 22000], ['Charcoal', '#36454f', 25000],
  ['Onyx', '#353839', 25000], ['Blood Moon', '#7a0c0c', 30000], ['Lava', '#cf1020', 35000],
  ['Sunset Orange', '#fd5e53', 40000], ['Dusk', '#463547', 40000], ['Dawn', '#f2c38f', 45000],
  ['Eclipse Purple', '#343148', 45000], ['Storm', '#4f6666', 50000], ['Thunder', '#545863', 50000],
  ['Lightning', '#e6e200', 55000], ['Glacier', '#78b7c5', 55000], ['Blizzard', '#a3e7fc', 60000],
  ['Frostbite', '#c8e9e4', 60000], ['Arctic', '#c9e4e8', 65000], ['Tundra', '#a8b5b2', 65000],
  ['Savannah', '#d9c287', 70000], ['Desert Sand', '#edc9af', 70000], ['Oasis', '#99c199', 75000],
  ['Lagoon', '#4ecdc4', 75000], ['Reef', '#0fb5ae', 80000], ['Abyss', '#1b2a4a', 80000],
  ['Phantom Gray', '#6e6e6e', 90000], ['Ghost White', '#f8f8ff', 100000], ['Specter', '#9d9d9d', 100000],
  ['Sage', '#9caf88', 110000], ['Steel', '#71797e', 110000], ['Bone', '#e3dac9', 120000],
  ['Ash', '#b2beb5', 120000], ['Champagne', '#f7e7ce', 150000], ['Platinum Tone', '#e5e4e2', 180000],
  ['Diamond Blue', '#b9f2ff', 200000], ['Crystal', '#a7d8f0', 200000], ['Prism', '#8e7cc3', 220000],
  ['Aurora', '#78dbe2', 220000], ['Nebula', '#451e8d', 250000], ['Galaxy', '#2d2d7a', 250000],
  ['Cosmos', '#130f40', 300000], ['Infinity Blue', '#0018a8', 300000], ['Eternity Dark', '#0f0f23', 350000],
  ['Void Purple', '#2b0a3d', 350000], ['Celestial', '#4997d0', 400000], ['Wisteria', '#c9a0dc', 400000],
  ['Holy Light', '#f5f5f5', 450000], ['Sacred Gold', '#bc9c22', 450000], ['Starlight', '#fff9e3', 500000],
  ['Phoenix Fire', '#e25822', 600000], ['Dragonblood', '#8c001a', 650000], ['Titansteel', '#757575', 700000],
  ['Godslayer', '#2e0854', 750000], ['Kingslayer', '#c0a060', 800000], ['Worldender', '#1a1a2e', 850000],
  ['Omnipotent', '#ffffff', 900000], ['Solar Flare', '#ffdf00', 950000],
  ['Candy', 'linear-gradient(90deg,#ff9ff3,#54a0ff)', 50000],
  ['Mint Chip', 'linear-gradient(90deg,#0d2818,#a3e7a3)', 60000],
  ['Grape Fizz', 'linear-gradient(90deg,#3a1c71,#d76d77)', 55000],
  ['Smolder', 'linear-gradient(90deg,#0a0a0a,#ff5252)', 25000],
  ['Venom', 'linear-gradient(90deg,#1a2f1a,#7fff00)', 70000],
  ['Bloodwine', 'linear-gradient(90deg,#1a0000,#e0115f)', 80000],
  ['Frostfire', 'linear-gradient(90deg,#a3e7fc,#ff6b35)', 90000],
  ['Golden Hour', 'linear-gradient(90deg,#f7971e,#ffd200)', 95000],
  ['Duskblaze', 'linear-gradient(90deg,#2b1055,#ff7a3d)', 110000],
  ['Ultraviolet', 'linear-gradient(90deg,#240b36,#c31432)', 130000],
  ['Siren', 'linear-gradient(90deg,#1a2980,#26d0ce)', 140000],
  ['Regal Gold', 'linear-gradient(90deg,#4b2e83,#ffd24a)', 150000],
  ['Rose Gold', 'linear-gradient(90deg,#b76e79,#f7e7ce)', 160000],
  ['Magma Flow', 'linear-gradient(90deg,#0f0c29,#ff4e50)', 170000],
  ['Voidwalk', 'linear-gradient(90deg,#0f0c29,#8041c8)', 180000],
  ['Bloodshadow', 'linear-gradient(135deg,#ff1a1a,#000000)', 120000],
  ['Crimson Abyss', 'linear-gradient(135deg,#7a0c1e,#050508)', 220000],
  ['Golden Shadow', 'linear-gradient(135deg,#ffd24a,#1a1206)', 260000],
  ['Violet Night', 'linear-gradient(135deg,#b16cea,#060312)', 280000],
  ['Emerald Abyss', 'linear-gradient(135deg,#35d07f,#04120a)', 240000],
  ['Midnight Ember', 'linear-gradient(135deg,#ff7a3d,#0d0503)', 200000],
];
const SHOP_EXTRA_TITLES = [
  ['Drifter', 1000], ['Stranger', 1200], ['Nomad', 1500], ['Squire', 1800],
  ['Page', 2000], ['Rascal', 2000], ['Rookie', 2200], ['Trainee', 2200],
  ['Pupil', 2500], ['Student', 2500], ['Peasant', 2800], ['Commoner', 2800],
  ['Villager', 3000], ['Fisher', 3000], ['Farmer', 3200], ['Miner', 3200],
  ['Clerk', 3500], ['Scribe', 3500], ['Bard', 4000], ['Jester', 4000],
  ['Gambler', 4500], ['Outlaw', 4500], ['Bandit', 5000], ['Acolyte', 5200],
  ['Scout', 5500], ['Hunter', 6000], ['Ranger', 6500], ['Archer', 6500],
  ['Swordsman', 7000], ['Lancer', 7000], ['Brawler', 7500], ['Fighter', 7500],
  ['Warrior', 8000], ['Soldier', 8500], ['Knight', 9000], ['Guardian', 9000],
  ['Protector', 9500], ['Defender', 9500], ['Warden', 10000], ['Sentinel', 10000],
  ['Watcher', 11000], ['Seeker', 11000], ['Tracker', 12000], ['Stalker', 13000],
  ['Raider', 13000], ['Reaver', 14000], ['Slayer', 15000], ['Executioner', 16000],
  ['Assassin', 18000], ['Shinobi', 18000], ['Ninja', 20000], ['Ronin', 20000],
  ['Samurai', 22000], ['Duelist', 22000], ['Gladiator', 25000], ['Pit Fighter', 28000],
  ['Champion', 30000], ['Hero', 35000], ['Prodigy', 35000], ['Genius', 40000],
  ['Master', 40000], ['Grandmaster', 45000], ['Sage', 45000], ['Mystic', 50000],
  ['Oracle', 55000], ['Prophet', 55000], ['Seer', 60000], ['Enchanter', 60000],
  ['Sorcerer', 65000], ['Warlock', 65000], ['Witch', 70000], ['Wizard', 70000],
  ['Mage', 75000], ['Archmage', 80000], ['Necromancer', 85000], ['Summoner', 85000],
  ['Tamer', 90000], ['Elementalist', 90000], ['Stormcaller', 95000], ['Frostborn', 95000],
  ['Firebrand', 100000], ['Thunderlord', 100000], ['Earthshaker', 105000], ['Tidecaller', 105000],
  ['Windrunner', 110000], ['Starforged', 110000], ['Moonblessed', 115000], ['Sunsworn', 115000],
  ['Dawnbringer', 120000], ['Paladin', 130000], ['Crusader', 140000], ['Templar', 150000],
  ['Berserker', 160000], ['Warlord', 180000], ['Conqueror', 200000], ['Destroyer', 220000],
  ['Annihilator', 250000], ['Overlord', 280000], ['Emperor', 300000], ['Empress', 320000],
  ['Sovereign', 350000], ['Celestial One', 450000], ['Seraphim', 500000], ['Archangel', 550000],
  ['Titan Lord', 600000], ['Dragonlord', 650000], ['Phoenix Born', 700000], ['Eternal One', 800000],
];
const SHOP_CATALOG = [
  { id: 'color-crimson', slot: 'color', name: 'Crimson Name', price: 1500, value: '#ff5c5c', desc: 'A sharp red username' },
  { id: 'color-gold', slot: 'color', name: 'Gold Name', price: 12000, value: '#ffd24a', desc: 'Rich gold username' },
  { id: 'color-violet', slot: 'color', name: 'Violet Name', price: 45000, value: '#b16cea', desc: 'Deep violet username' },
  { id: 'color-ocean', slot: 'color', name: 'Ocean Name', price: 60000, value: '#38e1ff', desc: 'Bright cyan username' },
  { id: 'color-rainbow', slot: 'color', name: 'Rainbow Name', price: 1000000, value: 'rainbow', desc: 'Animated rainbow username' },
  ...SHOP_EXTRA_COLORS.map(([name, css, price]) => ({ id: 'color-' + _shopSlug(name), slot: 'color', name, price, value: css, desc: 'A unique username color' })),
  { id: 'title-newbie', slot: 'title', name: 'Newbie', price: 1000, value: 'Newbie', desc: 'A humble little badge' },
  { id: 'title-regular', slot: 'title', name: 'Regular', price: 2500, value: 'Regular', desc: 'For familiar faces' },
  { id: 'title-critic', slot: 'title', name: 'Critic', price: 15000, value: 'Critic', fx: 'critic', desc: 'Red-edged comment badge' },
  { id: 'title-veteran', slot: 'title', name: 'Veteran', price: 80000, value: 'Veteran', fx: 'veteran', desc: 'Gold glowing comment badge' },
  { id: 'title-legend', slot: 'title', name: 'Legend', price: 500000, value: 'Legend', fx: 'legend', desc: 'Animated shining comment badge' },
  ...SHOP_EXTRA_TITLES.map(([name, price]) => ({ id: 'title-' + _shopSlug(name), slot: 'title', name, price, value: name, fx: _shopTitleFx(price), desc: 'A title beside your name' })),
  { id: 'frame-bronze', slot: 'frame', name: 'Bronze Ring', price: 80, value: 'bronze', desc: 'Bronze avatar ring' },
  { id: 'frame-silver', slot: 'frame', name: 'Silver Ring', price: 200, value: 'silver', desc: 'Silver avatar ring' },
  { id: 'frame-gold', slot: 'frame', name: 'Gold Ring', price: 400, value: 'gold', desc: 'Gold avatar ring' },
  { id: 'frame-neon', slot: 'frame', name: 'Neon Pulse', price: 700, value: 'neon', desc: 'Pulsing neon avatar ring' },
  { id: 'frame-platinum', slot: 'frame', name: 'Platinum Ring', price: 1500, value: 'platinum', desc: 'Platinum avatar ring' },
  { id: 'frame-diamond', slot: 'frame', name: 'Diamond Ring', price: 5000, value: 'diamond', desc: 'Icy diamond avatar ring' },
  { id: 'frame-ruby', slot: 'frame', name: 'Ruby Ring', price: 12000, value: 'ruby', desc: 'Blood-red avatar ring' },
  { id: 'frame-frost', slot: 'frame', name: 'Frost Ring', price: 25000, value: 'frost', desc: 'Frozen avatar ring' },
  { id: 'frame-magma', slot: 'frame', name: 'Magma Ring', price: 60000, value: 'magma', desc: 'Molten avatar ring' },
  { id: 'frame-royal', slot: 'frame', name: 'Royal Ring', price: 150000, value: 'royal', desc: 'Regal purple avatar ring' },
  { id: 'frame-cosmic', slot: 'frame', name: 'Cosmic Ring', price: 400000, value: 'cosmic', desc: 'Starfield avatar ring' },
  { id: 'frame-void', slot: 'frame', name: 'Void Pulse', price: 750000, value: 'void', desc: 'Pulsing void avatar ring' },
  { id: 'frame-ribbon', slot: 'frame', name: 'Fae Ribbon', price: 250000, value: 'ribbon', desc: 'Shimmering iridescent ring with sparkles' },
  { id: 'frame-crest-silver', slot: 'frame', name: 'Silver Crest', price: 300000, value: 'crest-silver', desc: 'Silver crest ring with a gem' },
  { id: 'frame-crest-gold', slot: 'frame', name: 'Golden Crest', price: 600000, value: 'crest-gold', desc: 'Golden crest ring with a gem' },
  { id: 'frame-crest-mythic', slot: 'frame', name: 'Mythic Crest', price: 950000, value: 'crest-mythic', desc: 'Pulsing mythic crest ring with a gem' },
  { id: 'frame-pearl', slot: 'frame', name: 'Pearl String', price: 60000, value: 'pearl', desc: 'Dotted pearl avatar ring' },
  { id: 'frame-obsidian', slot: 'frame', name: 'Obsidian', price: 90000, value: 'obsidian', desc: 'Dark stone avatar ring' },
  { id: 'frame-laurel', slot: 'frame', name: 'Laurel', price: 120000, value: 'laurel', desc: 'Champion green-and-gold ring' },
  { id: 'frame-stormcall', slot: 'frame', name: 'Stormcall', price: 200000, value: 'stormcall', desc: 'Crackling storm avatar ring' },
  { id: 'frame-crest', slot: 'frame', name: 'Royal Crest', price: 300000, value: 'crest', desc: 'Metallic gold crest ring' },
  { id: 'frame-bloodmoon', slot: 'frame', name: 'Blood Moon', price: 350000, value: 'bloodmoon', desc: 'Dark-red lunar ring' },
  { id: 'frame-prismatic', slot: 'frame', name: 'Prismatic', price: 500000, value: 'prismatic', desc: 'Triple rainbow avatar rings' },
  { id: 'frame-seraph', slot: 'frame', name: 'Seraphim', price: 800000, value: 'seraph', desc: 'Radiant white-gold ring' },
  { id: 'theme-crimson', slot: 'theme', name: 'Crimson Night', price: 300, value: 'crimson-night', desc: 'Blood-red app theme' },
  { id: 'theme-ocean', slot: 'theme', name: 'Deep Ocean', price: 300, value: 'deep-ocean', desc: 'Deep-blue app theme' },
  { id: 'theme-forest', slot: 'theme', name: 'Forest Night', price: 400, value: 'forest-night', desc: 'Deep-green app theme' },
  { id: 'theme-sunset', slot: 'theme', name: 'Ember Sunset', price: 500, value: 'sunset-ember', desc: 'Burnt-orange app theme' },
  { id: 'theme-royal', slot: 'theme', name: 'Royal Violet', price: 1000, value: 'royal-violet', desc: 'Regal purple app theme' },
];
const SHOP_SLOT_COL = { color: 'name_color', title: 'title', frame: 'frame', theme: 'theme' };
async function authUser(req, env) {
  if (!env.DB) return null;
  const h = req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer (.+)$/);
  if (!m) return null;
  const s = await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(m[1]).first();
  if (!s || new Date(s.expires) < new Date()) return null;
  return env.DB.prepare('SELECT id, email, display_name, avatar, rp, name_color, title, frame, theme, owned, created_at FROM users WHERE id = ?').bind(s.user_id).first();
}
// Anti-farm: votes only award RP once the voter's account is a day old.
const VOTE_RP_MIN_AGE_MS = 24 * 60 * 60 * 1000;
function voterOldEnough(createdAt) {
  const t = Date.parse(String(createdAt || '').replace(' ', 'T'));
  return !isNaN(t) && Date.now() - t >= VOTE_RP_MIN_AGE_MS;
}
async function readJson(req) {
  try { return await req.json(); } catch { return {}; }
}
const buckets = new Map();
function limited(ip, key, max, windowMs) {
  const k = `${ip}|${key}`;
  const now = Date.now();
  let b = buckets.get(k);
  if (!b || now > b.reset) b = { n: 0, reset: now + windowMs };
  b.n += 1;
  buckets.set(k, b);
  return b.n > max;
}
const COMMENTS_BLOCK_AT = 5;
const COMMENTS_PIN_AT = 10;

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const q = url.searchParams;
    const p = url.pathname;
    // Build stamp (proves which code is actually deployed).
    if (p === '/version' && req.method === 'GET') {
      return json({ build: 'mgs-lb-1', time: new Date().toISOString() });
    }
    if (p.startsWith('/auth/') || p.startsWith('/library') || p.startsWith('/progress')
      || p.startsWith('/reads') || p.startsWith('/popular') || p.startsWith('/charts') || p.startsWith('/leaderboard') || p.startsWith('/comments')
      || p.startsWith('/recs') || p.startsWith('/history') || p.startsWith('/me/') || p.startsWith('/shop') || p.startsWith('/originals')) {
      if (!env.DB && !p.startsWith('/originals')) return err('Accounts database not connected', 503);
      return handleAccount(req, env, p, q);
    }
    if (req.method !== 'GET' && !(req.method === 'POST' && p === '/comick/resolve')) {
      return err('Method not allowed', 405);
    }
    try {
      // Server-capable sources (upstream clientOnly ones need a browser)
      if (p === '/comick/sources') {
        try {
          const data = await comickApi(env, '/api/sources');
          const list = (data.sources || [])
            .filter((s) => !s.clientOnly)
            .map((s) => ({ id: String(s.id).toLowerCase(), name: s.name, type: s.type || 'aggregator' }));
          return json({ data: list }, 200, 3600);
        } catch {
          return json({ data: COMICK_DEFAULT_SOURCES.map((id) => ({ id, name: id, type: 'aggregator' })), fallback: true });
        }
      }
      // Search (fan-out across verified sources first, merged)
      if (p === '/comick/search') {
        const query = String(q.get('q') || '').trim().slice(0, 80);
        if (!query) return err('q is required', 400);
        const single = String(q.get('source') || '').trim().toLowerCase();
        const multi = String(q.get('sources') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        const requested = single ? [single] : (multi.length ? multi : COMICK_DEFAULT_SOURCES);
        const sources = [...new Set([
          ...SEARCH_PRIORITY.filter((s) => requested.includes(s)),
          ...requested.filter((s) => !SEARCH_DEAD.has(s)),
        ])].slice(0, 6);
        const settled = await Promise.allSettled(sources.map(async (source) => {
          const data = await comickApi(env, '/api/search', { method: 'POST', body: { query, source } });
          return (data.results || []).map((r) => normResult(source, r));
        }));
        const seen = new Set();
        const data = [];
        for (const s of settled) {
          if (s.status !== 'fulfilled') continue;
          for (const item of s.value) {
            const key = `${item.source}:${item.url}`;
            if (seen.has(key)) continue;
            seen.add(key);
            data.push(item);
            if (data.length >= 30) break;
          }
        }
        return json({ data, sources }, 200, 120);
      }
      // Title details
      if (p === '/comick/title') {
        const dec = cxDecode(q.get('id'));
        if (!dec) return err('id is required', 400);
        const t = await cachedTitle(dec.source, dec.url);
        return json({ data: { id: q.get('id'), source: dec.source, url: dec.url, ...t } }, 200, 300);
      }
      // Chapter list
      if (p === '/comick/chapters') {
        const dec = cxDecode(q.get('id'));
        if (!dec) return err('id is required', 400);
        const chapters = await comickChapters(env, dec.source, dec.url);
        return json({ data: chapters, total: chapters.length }, 200, 300);
      }
      // Chapter page images. ?raw=1 returns source URLs (for <img> tags on
      // static hosts); default returns same-origin /img proxy paths.
      if (p === '/comick/pages') {
        const curl = String(q.get('url') || '');
        if (!/^https?:\/\//i.test(curl)) return err('url is required', 400);
        const hit = pagesCache.get(curl);
        if (hit && Date.now() - hit.at < PAGES_TTL) {
          return json({ data: shapePages(req, hit.pages, curl, q.get('raw') === '1'), cached: true }, 200, 300);
        }
        const html = await fetchHtml(curl, q.get('ref') || curl);
        const pages = extractPages(html, curl);
        if (!pages.length) return err('No readable pages found for this chapter', 502);
        if (pagesCache.size > 300) pagesCache.delete(pagesCache.keys().next().value);
        pagesCache.set(curl, { pages, at: Date.now() });
        return json({ data: shapePages(req, pages, curl, q.get('raw') === '1') }, 200, 300);
      }
      // Latest updates (?enrich=1 attaches genres/type for mature filtering)
      if (p === '/comick/latest') {
        const source = String(q.get('source') || 'mangaread').trim().toLowerCase();
        const enrich = q.get('enrich') === '1';
        const key = `${source}:${enrich ? 'full' : 'base'}`;
        const hit = latestCache.get(key);
        if (hit && Date.now() - hit.at < LATEST_TTL) return json(hit.data, 200, 60);
        const base = (await comickSourceBase(env, source)) || 'https://www.mangaread.org';
        const html = await fetchHtml(base);
        const items = extractLatestWp(html, base);
        if (!items.length) throw new Error('Latest updates unavailable for this source');
        let data = { data: items.map((r) => ({ ...normResult(source, { ...r, coverImage: r.cover, latestChapter: 0 }), latestChapterLabel: r.latestChapter, latestChapterDate: r.latestChapterDate || null })) };
        if (enrich) data = { data: await enrichItems(data.data.slice(0, 12)).then((m) => data.data.slice(0, 12).map((it) => ({ ...it, ...(m.get(it.id) || {}) }))) };
        latestCache.set(key, { data, at: Date.now() });
        return json(data, 200, 60);
      }
      // Comix charts (comix.to homepage embeds trending/follows/hot/recent
      // feeds as JSON — one fetch powers all four rows).
      if (p === '/comix/home') {
        try {
          return json({ data: await fetchComixHome() }, 200, 300);
        } catch (e) {
          return err(e.message || 'Comix feeds unavailable', 502);
        }
      }
      // Genre menu (?source=)
      if (p === '/comick/genres') {
        const source = String(q.get('source') || 'mangaread').trim().toLowerCase();
        const hit = genresCache.get(source);
        if (hit && Date.now() - hit.at < GENRES_TTL) return json(hit.data, 200, 3600);
        let list = [];
        try {
          const base = (await comickSourceBase(env, source)) || 'https://www.mangaread.org';
          const html = await fetchHtml(base);
          const seen = new Map();
          for (const m of html.matchAll(/<a[^>]+href=["']([^"']*\/genres\/([^/"']+)\/?)["'][^>]*>([^<]{1,30})<\/a>/gi)) {
            const slug = m[2].toLowerCase();
            const name = decodeEntities(m[3]).trim();
            if (name && !seen.has(slug) && !/^(completed|top|latest|chat)$/i.test(slug)) seen.set(slug, name);
          }
          list = [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
        } catch {}
        if (!list.length) list = FALLBACK_GENRES.map((id) => ({ id, name: prettySlug(id) }));
        const data = { data: list };
        genresCache.set(source, { data, at: Date.now() });
        return json(data, 200, 3600);
      }
      // One genre listing (?source=&genre=&page=)
      if (p === '/comick/genre') {
        const source = String(q.get('source') || 'mangaread').trim().toLowerCase();
        const genre = String(q.get('genre') || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (!genre) return err('genre is required', 400);
        const page = Math.max(1, Math.min(50, parseInt(q.get('page') || '1', 10) || 1));
        const enrich = q.get('enrich') === '1';
        const key = `${source}:${genre}:${page}:${enrich ? 'full' : 'base'}`;
        const hit = genreCache.get(key);
        if (hit && Date.now() - hit.at < GENRE_TTL) return json(hit.data, 200, 120);
        const base = (await comickSourceBase(env, source)) || 'https://www.mangaread.org';
        const gurl = `${base.replace(/\/$/, '')}/genres/${genre}/${page > 1 ? `page/${page}/` : ''}`;
        const html = await fetchHtml(gurl);
        const items = extractLatestWp(html, gurl);
        if (!items.length) throw new Error('No titles in this genre on this source');
        let data = { data: items.map((r) => ({ ...normResult(source, { ...r, coverImage: r.cover, latestChapter: 0 }), latestChapterLabel: r.latestChapter, latestChapterDate: r.latestChapterDate || null })), page };
        if (enrich) {
          const slice = data.data.slice(0, 15);
          data = { data: await enrichItems(slice).then((m) => slice.map((it) => ({ ...it, ...(m.get(it.id) || {}) }))), page };
        }
        genreCache.set(key, { data, at: Date.now() });
        return json(data, 200, 120);
      }
      // Resolve stored client IDs to display metadata (library / Continue).
      if (p === '/comick/resolve' && req.method === 'POST') {
        const body = await readJson(req);
        const ids = Array.isArray(body.ids) ? [...new Set(body.ids)].slice(0, 30) : [];
        const out = [];
        let i = 0;
        const workers = [];
        for (let w = 0; w < 4; w++) {
          workers.push((async () => {
            while (i < ids.length) {
              const id = ids[i++];
              const dec = cxDecode(id);
              if (!dec) continue;
              try {
                const t = await cachedTitle(dec.source, dec.url);
                out.push({ id, source: dec.source, url: dec.url, title: t.title, cover: t.cover || '', genres: t.genres || [], status: t.status || '', type: t.type || '' });
              } catch {}
            }
          })());
        }
        await Promise.all(workers);
        return json({ data: out }, 200, 120);
      }
      // Image proxy: ?u=<https url>&ref=<page url> → image bytes + CORS.
      if (p === '/img') {
        const u = q.get('u') || '';
        if (!/^https:\/\//i.test(u)) return err('Invalid image URL', 400);
        const ref = q.get('ref') || '';
        const upstream = await fetch(u, {
          headers: {
            'User-Agent': SCRAPE_UA,
            Accept: 'image/*,*/*;q=0.8',
            ...(/^https?:\/\//i.test(ref) ? { Referer: ref } : {}),
          },
          signal: AbortSignal.timeout(20000),
        });
        if (!upstream.ok) return err('Image fetch failed', 502);
        const type = upstream.headers.get('content-type') || 'image/jpeg';
        if (!type.startsWith('image/')) return err('Upstream did not return an image', 502);
        const buf = await upstream.arrayBuffer();
        if (buf.byteLength > 20 * 1024 * 1024) return err('Image too large', 502);
        return new Response(buf, { headers: { ...CORS, 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' } });
      }
      return err('Not found', 404);
    } catch (e) {
      return err(e.message || 'Upstream error', e.status || 502);
    }
  },
};

function shapePages(req, pages, curl, raw) {
  if (raw) return pages;
  const origin = new URL(req.url).origin;
  return pages.map((src) => `${origin}/img?u=${encodeURIComponent(src)}&ref=${encodeURIComponent(curl)}`);
}

// ---------- Account / library / progress / social handlers (D1) ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function handleAccount(req, env, p, q) {
  const DB = env.DB;
  await ensureUserColumns(env).catch(() => {});
  const ip = req.headers.get('CF-Connecting-IP') || 'x';
  const me = await authUser(req, env);
  const needAuth = () => { if (!me) throw Object.assign(new Error('Not logged in'), { status: 401 }); };
  const needDb = () => { if (!DB) throw Object.assign(new Error('Accounts database not connected'), { status: 503 }); };
  try {
    // Public generated avatar (no login needed)
    let m = p.match(/^\/auth\/avatar\/(\d+)\.svg$/);
    if (m && req.method === 'GET') {
      const u = DB ? await DB.prepare('SELECT id, display_name FROM users WHERE id = ?').bind(m[1]).first() : null;
      const name = (u && u.display_name) || '?';
      const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
      let h = 0;
      for (const c of `user-${m[1]}`) h = (h * 31 + c.charCodeAt(0)) % 360;
      const safe = initials.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return new Response(
        `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="hsl(${h},55%,38%)"/><text x="48" y="62" font-family="sans-serif" font-size="38" font-weight="bold" fill="#fff" text-anchor="middle">${safe}</text></svg>`,
        { headers: { ...CORS, 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' } },
      );
    }
    // Custom avatars need file storage — full server only. The small
    // data-URL flow below works everywhere (static build included).
    if ((p === '/auth/avatar' || p === '/auth/avatar/') && (req.method === 'POST' || req.method === 'DELETE')) {
      return err('Custom profile pictures need the full server (Render build)', 503);
    }
    const mAv = p.match(/^\/?auth\/avatar-data\/?$/);
    if (mAv && req.method === 'POST') {
      needDb();
      needAuth();
      const { image } = await readJson(req);
      const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ''));
      if (!m) return err('Attach an image', 400);
      if (String(image).length > 100000) return err('Image too large — pick a smaller file', 400);
      await DB.prepare('UPDATE users SET avatar = ? WHERE id = ?').bind(String(image), me.id).run().catch(() => null);
      return json({ ok: true, avatar: String(image) });
    }
    if (mAv && req.method === 'DELETE') {
      needDb();
      needAuth();
      await DB.prepare('UPDATE users SET avatar = NULL WHERE id = ?').bind(me.id).run().catch(() => null);
      return json({ ok: true });
    }
    // Signup
    if (p === '/auth/signup' && req.method === 'POST') {
      needDb();
      if (limited(ip, 'signup', 30, 3600000)) return err('Too many attempts — try again later', 429);
      const { email, password, displayName } = await readJson(req);
      if (!email || !password || !EMAIL_RE.test(email)) return err('A valid email and password are required', 400);
      if (String(password).length < 6) return err('Password must be at least 6 characters', 400);
      const em = String(email).toLowerCase();
      if (await DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(em).first()) {
        return err('An account with that email already exists', 409);
      }
      const name = String(displayName || '').trim();
      if (name) {
        if (name.length < 2 || name.length > 24) return err('Username must be 2–24 characters', 400);
        if (await DB.prepare('SELECT 1 FROM users WHERE display_name = ? COLLATE NOCASE').bind(name).first()) {
          return err('That username is taken', 409);
        }
      }
      const r = await DB.prepare('INSERT INTO users (email, password, display_name) VALUES (?, ?, ?)')
        .bind(em, await hashPassword(String(password)), name || em).run();
      const id = r.meta.last_row_id;
      const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
      const exp = new Date(Date.now() + 30 * 864e5).toISOString();
      await DB.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').bind(token, id, exp).run();
      const user = await DB.prepare('SELECT id, email, display_name, avatar, rp, name_color, title, frame, theme, owned, created_at FROM users WHERE id = ?').bind(id).first();
      return json({ user: userPublic(user), token });
    }
    // Login
    if (p === '/auth/login' && req.method === 'POST') {
      needDb();
      if (limited(ip, 'login', 10, 600000)) return err('Too many attempts — try again later', 429);
      const { email, password } = await readJson(req);
      const u = await DB.prepare('SELECT * FROM users WHERE email = ?').bind(String(email || '').toLowerCase()).first();
      if (!u || !u.password || !(await verifyPassword(String(password || ''), u.password))) {
        return err('Invalid email or password', 401);
      }
      const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
      const exp = new Date(Date.now() + 30 * 864e5).toISOString();
      await DB.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').bind(token, u.id, exp).run();
      const user = await DB.prepare('SELECT id, email, display_name, avatar, rp, name_color, title, frame, theme, owned, created_at FROM users WHERE id = ?').bind(u.id).first();
      return json({ user: userPublic(user), token });
    }
    // Logout
    if (p === '/auth/logout' && req.method === 'POST') {
      needDb();
      const h = req.headers.get('Authorization') || '';
      const t = (h.match(/^Bearer (.+)$/) || [])[1];
      if (t) await DB.prepare('DELETE FROM sessions WHERE token = ?').bind(t).run();
      return json({ ok: true });
    }
    // Me
    if (p === '/auth/me' && req.method === 'GET') {
      needDb();
      return json({ user: userPublic(me) });
    }
    // Stats
    if (p === '/auth/stats' && req.method === 'GET') {
      needDb();
      needAuth();
      const lib = await DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE user_id = ?').bind(me.id).first();
      const ch = await DB.prepare('SELECT COUNT(*) AS n FROM reads WHERE user_id = ?').bind(me.id).first();
      const cm = await DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND blocked = 0').bind(me.id).first().catch(() => ({ n: 0 }));
      return json({ stats: { library: lib.n, chapters: ch.n, comments: cm.n, published: 0 } });
    }
    // Rename / password change
    if (p === '/auth/account' && req.method === 'PATCH') {
      needDb();
      needAuth();
      const { displayName, currentPassword, newPassword } = await readJson(req);
      if (displayName !== undefined) {
        const name = String(displayName).trim();
        if (name.length < 2 || name.length > 24) return err('Username must be 2–24 characters', 400);
        const clash = await DB.prepare('SELECT 1 FROM users WHERE display_name = ? COLLATE NOCASE AND id != ?').bind(name, me.id).first();
        if (clash) return err('That username is taken', 409);
        await DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(name, me.id).run();
      }
      if (newPassword !== undefined) {
        const full = await DB.prepare('SELECT * FROM users WHERE id = ?').bind(me.id).first();
        if (full && full.password && !(await verifyPassword(String(currentPassword || ''), full.password))) {
          return err('Current password is wrong', 401);
        }
        if (String(newPassword).length < 6) return err('New password must be at least 6 characters', 400);
        await DB.prepare('UPDATE users SET password = ? WHERE id = ?').bind(await hashPassword(String(newPassword)), me.id).run();
      }
      const user = await DB.prepare('SELECT id, email, display_name, avatar, created_at FROM users WHERE id = ?').bind(me.id).first();
      return json({ user: userPublic(user) });
    }
    // Sign out everywhere else
    if (p === '/auth/sessions/clear' && req.method === 'POST') {
      needDb();
      needAuth();
      const h = req.headers.get('Authorization') || '';
      const t = (h.match(/^Bearer (.+)$/) || [])[1];
      if (t) await DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').bind(me.id, t).run();
      else await DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(me.id).run();
      return json({ ok: true });
    }
    // Delete account + wipe everything (manual deletes — no FK guarantees on D1)
    if (p === '/auth/account' && req.method === 'DELETE') {
      needDb();
      needAuth();
      const { confirm } = await readJson(req);
      if (confirm !== 'DELETE') return err('Type DELETE to confirm', 400);
      await DB.prepare('DELETE FROM reads WHERE user_id = ?').bind(me.id).run().catch(() => {});
      await DB.prepare('DELETE FROM comment_votes WHERE user_id = ?').bind(me.id).run().catch(() => {});
      await DB.prepare('DELETE FROM comments WHERE user_id = ?').bind(me.id).run().catch(() => {});
      await DB.prepare('DELETE FROM recs WHERE user_id = ?').bind(me.id).run().catch(() => {});
      await DB.prepare('DELETE FROM follows WHERE user_id = ?').bind(me.id).run().catch(() => {});
      await DB.prepare('DELETE FROM progress WHERE user_id = ?').bind(me.id).run().catch(() => {});
      await DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(me.id).run().catch(() => {});
      await DB.prepare('DELETE FROM users WHERE id = ?').bind(me.id).run();
      return json({ ok: true });
    }
    // Clear all my content (library + history + own reads)
    if (p === '/me/data' && req.method === 'DELETE') {
      needDb();
      needAuth();
      await DB.prepare('DELETE FROM follows WHERE user_id = ?').bind(me.id).run().catch(() => {});
      await DB.prepare('DELETE FROM progress WHERE user_id = ?').bind(me.id).run().catch(() => {});
      await DB.prepare('DELETE FROM reads WHERE user_id = ?').bind(me.id).run().catch(() => {});
      return json({ ok: true });
    }
    // Library
    if (p === '/library' && req.method === 'GET') {
      needDb();
      needAuth();
      const rows = await DB.prepare('SELECT manga_id, added_at FROM follows WHERE user_id = ? ORDER BY added_at DESC').bind(me.id).all();
      const added = {};
      for (const r of rows.results) added[r.manga_id] = r.added_at || null;
      return json({ mangaIds: rows.results.map((r) => r.manga_id), added });
    }
    if (p === '/library' && req.method === 'DELETE') {
      needDb();
      needAuth();
      await DB.prepare('DELETE FROM follows WHERE user_id = ?').bind(me.id).run();
      return json({ ok: true });
    }
    m = p.match(/^\/library\/(.+)\/status$/);
    if (m && req.method === 'GET') {
      needDb();
      needAuth();
      const r = await DB.prepare('SELECT 1 AS x FROM follows WHERE user_id = ? AND manga_id = ?').bind(me.id, decodeURIComponent(m[1])).first();
      return json({ followed: !!r });
    }
    m = p.match(/^\/library\/(.+)$/);
    if (m && (req.method === 'POST' || req.method === 'DELETE')) {
      needDb();
      needAuth();
      const id = decodeURIComponent(m[1]);
      if (req.method === 'POST') await DB.prepare('INSERT OR IGNORE INTO follows (user_id, manga_id) VALUES (?, ?)').bind(me.id, id).run();
      else await DB.prepare('DELETE FROM follows WHERE user_id = ? AND manga_id = ?').bind(me.id, id).run();
      return json({ ok: true });
    }
    // Progress
    if (p === '/progress' && req.method === 'GET') {
      needDb();
      needAuth();
      const rows = await DB.prepare('SELECT manga_id, chapter_id, page, chapter_label, updated_at FROM progress WHERE user_id = ? ORDER BY updated_at DESC').bind(me.id).all();
      return json({ items: rows.results });
    }
    if (p === '/progress' && req.method === 'DELETE') {
      needDb();
      needAuth();
      await DB.prepare('DELETE FROM progress WHERE user_id = ?').bind(me.id).run();
      return json({ ok: true });
    }
    m = p.match(/^\/progress\/(.+)$/);
    if (m && req.method === 'GET') {
      needDb();
      needAuth();
      const r = await DB.prepare('SELECT chapter_id, page, chapter_label FROM progress WHERE user_id = ? AND manga_id = ?').bind(me.id, decodeURIComponent(m[1])).first();
      return json(r || null);
    }
    if (m && req.method === 'POST') {
      needDb();
      needAuth();
      const { chapterId, page, chapterLabel } = await readJson(req);
      if (!chapterId || typeof page !== 'number' || page < 0) return err('chapterId (string) and page (number) are required', 400);
      const id = decodeURIComponent(m[1]);
      await DB.prepare(`INSERT INTO progress (user_id, manga_id, chapter_id, page, chapter_label, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, manga_id) DO UPDATE SET chapter_id=excluded.chapter_id, page=excluded.page, chapter_label=excluded.chapter_label, updated_at=datetime('now')`)
        .bind(me.id, id, chapterId, page, chapterLabel || null).run();
      // Reading-time heartbeat for the hours leaderboard (capped deltas).
      try {
        const urow = await DB.prepare('SELECT read_seconds, last_read_at FROM users WHERE id = ?').bind(me.id).first().catch(() => null);
        const last = urow && urow.last_read_at ? Date.parse(String(urow.last_read_at).replace(' ', 'T') + 'Z') : 0;
        const nowMs = Date.now();
        const add = last && nowMs - last < 5 * 60 * 1000 ? Math.max(1, Math.floor((nowMs - last) / 1000)) : 20;
        await DB.prepare('UPDATE users SET read_seconds = COALESCE(read_seconds,0) + ?1, last_read_at = datetime(\'now\') WHERE id = ?2').bind(add, me.id).run().catch(() => {});
      } catch {}
      return json({ ok: true });
    }
    if (m && req.method === 'DELETE') {
      needDb();
      needAuth();
      await DB.prepare('DELETE FROM progress WHERE user_id = ? AND manga_id = ?').bind(me.id, decodeURIComponent(m[1])).run();
      return json({ ok: true });
    }
    // Chapter reads (counters + popularity)
    if (p === '/reads' && req.method === 'POST') {
      needDb();
      const { mangaId, chapterId } = await readJson(req);
      if (!mangaId || !chapterId) return err('mangaId and chapterId are required', 400);
      await DB.prepare('INSERT INTO reads (manga_id, chapter_id, user_id) VALUES (?, ?, ?)')
        .bind(mangaId, chapterId, me ? me.id : null).run().catch(() => {});
      return json({ ok: true });
    }
    if (p === '/reads/counts' && req.method === 'GET') {
      needDb();
      const mangaId = String(q.get('manga') || '');
      if (!mangaId) return err('manga is required', 400);
      const rows = await DB.prepare('SELECT chapter_id, COUNT(*) AS n FROM reads WHERE manga_id = ? GROUP BY chapter_id').bind(mangaId).all().catch(() => ({ results: [] }));
      const counts = {};
      for (const r of rows.results) counts[r.chapter_id] = r.n;
      return json({ counts });
    }
    if (p === '/popular' && req.method === 'GET') {
      needDb();
      const limit = Math.max(1, Math.min(30, parseInt(q.get('limit') || '10', 10) || 10));
      const rows = await DB.prepare(`SELECT manga_id AS id, COUNT(*) AS n FROM reads GROUP BY manga_id ORDER BY n DESC LIMIT ${limit}`).bind().all().catch(() => ({ results: [] }));
      return json({ data: rows.results });
    }
    // Home chart feeds (public): community-ranked titles, mixed across every
    // source — Most Recent Popular (reads, last 7 days) + Most Followed New
    // Comics (bookmarks).
    if (p === '/charts' && req.method === 'GET') {
      needDb();
      const trending = await DB.prepare(`SELECT manga_id AS id, COUNT(*) AS n FROM reads WHERE created_at >= datetime('now', '-7 days') AND manga_id NOT LIKE 'cx:comix:%' GROUP BY manga_id ORDER BY n DESC LIMIT 18`).bind().all().catch(() => ({ results: [] }));
      const followed = await DB.prepare(`SELECT manga_id AS id, COUNT(*) AS n FROM follows WHERE manga_id NOT LIKE 'cx:comix:%' GROUP BY manga_id ORDER BY n DESC LIMIT 18`).bind().all().catch(() => ({ results: [] }));
      return json({ trending: trending.results, followed: followed.results }, 200, 60);
    }
    // Community leaderboard (public): top readers by RP, reading hours,
    // bookmarks, and likes/dislikes received on their comments.
    if (p === '/leaderboard' && req.method === 'GET') {
      needDb();
      const by = String(q.get('by') || 'rp');
      if (!['rp', 'hours', 'bookmarks', 'likes', 'dislikes'].includes(by)) return err('unknown board', 400);
      const U = 'u.id, u.display_name, u.avatar, u.name_color, u.title, u.frame';
      let sql;
      if (by === 'hours') sql = `SELECT ${U}, COALESCE(u.read_seconds,0) AS value FROM users u WHERE u.display_name IS NOT NULL AND COALESCE(u.read_seconds,0) > 0 ORDER BY value DESC, u.id ASC LIMIT 20`;
      else if (by === 'bookmarks') sql = `SELECT ${U}, COUNT(f.manga_id) AS value FROM users u JOIN follows f ON f.user_id = u.id WHERE u.display_name IS NOT NULL GROUP BY u.id HAVING value > 0 ORDER BY value DESC, u.id ASC LIMIT 20`;
      else if (by === 'likes') sql = `SELECT ${U}, COUNT(*) AS value FROM users u JOIN comments c ON c.user_id = u.id AND c.blocked = 0 JOIN comment_votes v ON v.comment_id = c.id AND v.vote = 1 WHERE u.display_name IS NOT NULL GROUP BY u.id HAVING value > 0 ORDER BY value DESC, u.id ASC LIMIT 20`;
      else if (by === 'dislikes') sql = `SELECT ${U}, COUNT(*) AS value FROM users u JOIN comments c ON c.user_id = u.id AND c.blocked = 0 JOIN comment_votes v ON v.comment_id = c.id AND v.vote = -1 WHERE u.display_name IS NOT NULL GROUP BY u.id HAVING value > 0 ORDER BY value DESC, u.id ASC LIMIT 20`;
      else sql = `SELECT ${U}, COALESCE(u.rp,0) AS value FROM users u WHERE u.display_name IS NOT NULL AND COALESCE(u.rp,0) > 0 ORDER BY value DESC, u.id ASC LIMIT 20`;
      const rows = await DB.prepare(sql).all().catch(() => ({ results: [] }));
      return json({ by, data: rows.results }, 200, 60);
    }
    // Comments (per chapter)
    if (p === '/comments' && req.method === 'GET') {
      needDb();
      const chapterId = String(q.get('chapter') || '');
      if (!chapterId) return err('chapter is required', 400);
      const rows = await DB.prepare(`SELECT c.id, c.manga_id, c.chapter_id, c.body, c.pinned, c.created_at, u.display_name, u.name_color, u.title, u.frame,
          (SELECT COUNT(*) FROM comment_votes v WHERE v.comment_id = c.id AND v.vote = 1) AS likes,
          (SELECT COUNT(*) FROM comment_votes v WHERE v.comment_id = c.id AND v.vote = -1) AS dislikes,
          (SELECT v.vote FROM comment_votes v WHERE v.comment_id = c.id AND v.user_id = ?) AS my_vote
        FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.chapter_id = ? AND c.blocked = 0
        ORDER BY c.pinned DESC, likes DESC, c.created_at DESC`)
        .bind(me ? me.id : null, chapterId).all().catch(() => ({ results: [] }));
      const bc = await DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE chapter_id = ? AND blocked = 1').bind(chapterId).first().catch(() => ({ n: 0 }));
      return json({ data: rows.results, canPost: !!me, blockAt: COMMENTS_BLOCK_AT, pinAt: COMMENTS_PIN_AT, blockedCount: bc.n });
    }
    if (p === '/comments' && req.method === 'POST') {
      needDb();
      needAuth();
      const { mangaId, chapterId, body } = await readJson(req);
      if (!mangaId || !chapterId) return err('mangaId and chapterId are required', 400);
      const text = String(body || '').trim();
      if (!text || text.length > 2000) return err('Comment must be 1-2000 characters', 400);
      const r = await DB.prepare('INSERT INTO comments (manga_id, chapter_id, user_id, body) VALUES (?, ?, ?, ?)')
        .bind(mangaId, chapterId, me.id, text).run();
      return json({ ok: true, id: Number(r.meta.last_row_id) });
    }
    m = p.match(/^\/comments\/(\d+)\/vote$/);
    if (m && req.method === 'POST') {
      needDb();
      needAuth();
      if (limited(ip, 'vote', 60, 600000)) return err('Too many votes — slow down', 429);
      const { vote } = await readJson(req);
      if (vote !== 1 && vote !== -1) return err('vote must be 1 or -1', 400);
      const cid = Number(m[1]);
      const target = await DB.prepare('SELECT user_id FROM comments WHERE id = ?').bind(cid).first();
      const existing = await DB.prepare('SELECT * FROM comment_votes WHERE user_id = ? AND comment_id = ?').bind(me.id, cid).first();
      const oldVote = existing ? existing.vote : 0;
      if (existing && existing.vote === vote) {
        await DB.prepare('DELETE FROM comment_votes WHERE user_id = ? AND comment_id = ?').bind(me.id, cid).run();
      } else {
        await DB.prepare(`INSERT INTO comment_votes (user_id, comment_id, vote, created_at) VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(user_id, comment_id) DO UPDATE SET vote = excluded.vote`).bind(me.id, cid, vote).run();
      }
      const counts = await DB.prepare(`SELECT
          (SELECT COUNT(*) FROM comment_votes v WHERE v.comment_id = ? AND v.vote = 1) AS likes,
          (SELECT COUNT(*) FROM comment_votes v WHERE v.comment_id = ? AND v.vote = -1) AS dislikes`).bind(cid, cid).first();
      const likes = (counts && counts.likes) || 0;
      const dislikes = (counts && counts.dislikes) || 0;
      if (dislikes >= COMMENTS_BLOCK_AT) await DB.prepare('UPDATE comments SET blocked = 1 WHERE id = ?').bind(cid).run();
      else if (likes >= COMMENTS_PIN_AT) await DB.prepare('UPDATE comments SET pinned = 1 WHERE id = ?').bind(cid).run();
      const myVote = await DB.prepare('SELECT vote FROM comment_votes WHERE user_id = ? AND comment_id = ?').bind(me.id, cid).first();
      const newVote = myVote ? myVote.vote : 0;
      // Reader Points follow the vote transition (self-votes never award RP,
      // and brand-new voter accounts don't either).
      if (target && target.user_id !== me.id && newVote !== oldVote && voterOldEnough(me.created_at)) {
        const d = rpVoteValue(newVote) - rpVoteValue(oldVote);
        if (d) await DB.prepare('UPDATE users SET rp = MAX(0, rp + ?) WHERE id = ?').bind(d, target.user_id).run().catch(() => {});
      }
      const flags = await DB.prepare('SELECT pinned, blocked FROM comments WHERE id = ?').bind(cid).first();
      return json({ likes, dislikes, myVote: newVote, pinned: !!(flags && flags.pinned), blocked: !!(flags && flags.blocked) });
    }
    m = p.match(/^\/comments\/(\d+)$/);
    if (m && req.method === 'DELETE') {
      needDb();
      needAuth();
      const c = await DB.prepare('SELECT * FROM comments WHERE id = ?').bind(Number(m[1])).first();
      if (!c) return err('Comment not found', 404);
      if (c.user_id !== me.id) return err('Only the author can delete this comment', 403);
      // Retract RP the comment earned from other readers (self-votes never
      // awarded any), so delete-and-repost can't duplicate points.
      const tallies = await DB.prepare(`SELECT
          (SELECT COUNT(*) FROM comment_votes WHERE comment_id = ? AND vote = 1 AND user_id != ?) AS likes,
          (SELECT COUNT(*) FROM comment_votes WHERE comment_id = ? AND vote = -1 AND user_id != ?) AS dislikes`)
        .bind(c.id, c.user_id, c.id, c.user_id).first().catch(() => null);
      if (tallies) {
        const d = -(((tallies.likes || 0) * 2) + ((tallies.dislikes || 0) * -1));
        if (d) await DB.prepare('UPDATE users SET rp = MAX(0, rp + ?) WHERE id = ?').bind(d, c.user_id).run().catch(() => {});
      }
      await DB.prepare('DELETE FROM comments WHERE id = ?').bind(c.id).run();
      return json({ ok: true });
    }
    // Shop (Reader Points cosmetics). Prices enforced here.
    if (p === '/shop' && req.method === 'GET') {
      needDb();
      const uid = me ? me.id : null;
      let owned = [];
      let eq = { name_color: '', title: '', frame: '', theme: '' };
      let balance = 0;
      if (uid) {
        const row = await DB.prepare('SELECT rp, name_color, title, frame, theme, owned FROM users WHERE id = ?').bind(uid).first().catch(() => null);
        if (row) {
          balance = row.rp || 0;
          eq = { name_color: row.name_color || '', title: row.title || '', frame: row.frame || '', theme: row.theme || '' };
          try { const a = JSON.parse(row.owned || '[]'); if (Array.isArray(a)) owned = a.filter((x) => typeof x === 'string'); } catch {}
        }
      }
      return json({
        balance, owned, equipped: eq,
        catalog: SHOP_CATALOG.map((it) => ({ ...it, owned: owned.includes(it.id), equipped: (eq[SHOP_SLOT_COL[it.slot]] || '') === it.value })),
      });
    }
    if (p === '/shop/buy' && req.method === 'POST') {
      needDb();
      needAuth();
      const { id } = await readJson(req);
      const item = SHOP_CATALOG.find((i) => i.id === id);
      if (!item) return err('Unknown item', 404);
      const col = SHOP_SLOT_COL[item.slot];
      if (!col) return err('Unknown shop item', 400);
      const row = await DB.prepare('SELECT rp, owned FROM users WHERE id = ?').bind(me.id).first();
      let owned = [];
      try { const a = JSON.parse((row && row.owned) || '[]'); if (Array.isArray(a)) owned = a.filter((x) => typeof x === 'string'); } catch {}
      if (!owned.includes(item.id)) {
        if ((row ? row.rp || 0 : 0) < item.price) return err('Not enough RP — earn more from comment likes', 402);
        owned.push(item.id);
        await DB.prepare('UPDATE users SET rp = rp - ?, owned = ? WHERE id = ?').bind(item.price, JSON.stringify(owned), me.id).run();
      }
      await DB.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).bind(item.value, me.id).run();
      const after = await DB.prepare('SELECT rp, name_color, title, frame, theme FROM users WHERE id = ?').bind(me.id).first();
      return json({ ok: true, rp: (after && after.rp) || 0, owned, equipped: { name_color: (after && after.name_color) || '', title: (after && after.title) || '', frame: (after && after.frame) || '', theme: (after && after.theme) || '' } });
    }
    if (p === '/shop/equip' && req.method === 'POST') {
      needDb();
      needAuth();
      const { slot, id } = await readJson(req);
      const col = SHOP_SLOT_COL[slot];
      if (!col) return err('Unknown slot', 400);
      const finish = async () => {
        const after = await DB.prepare('SELECT rp, name_color, title, frame, theme FROM users WHERE id = ?').bind(me.id).first().catch(() => null);
        const orow = await DB.prepare('SELECT owned FROM users WHERE id = ?').bind(me.id).first().catch(() => null);
        let owned = [];
        try { const a = JSON.parse((orow && orow.owned) || '[]'); if (Array.isArray(a)) owned = a.filter((x) => typeof x === 'string'); } catch {}
        return json({ ok: true, rp: (after && after.rp) || 0, owned, equipped: { name_color: (after && after.name_color) || '', title: (after && after.title) || '', frame: (after && after.frame) || '', theme: (after && after.theme) || '' } });
      };
      if (id == null) {
        await DB.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).bind('', me.id).run();
        return finish();
      }
      const item = SHOP_CATALOG.find((i) => i.id === id && i.slot === slot);
      if (!item) return err('Unknown item', 404);
      const orow = await DB.prepare('SELECT owned FROM users WHERE id = ?').bind(me.id).first();
      let owned = [];
      try { const a = JSON.parse((orow && orow.owned) || '[]'); if (Array.isArray(a)) owned = a.filter((x) => typeof x === 'string'); } catch {}
      if (!owned.includes(id)) return err('You do not own this yet', 403);
      await DB.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).bind(item.value, me.id).run();
      return finish();
    }
    // Reader recommendations
    if (p === '/recs' && req.method === 'GET') {
      needDb();
      const mangaId = String(q.get('manga') || '');
      if (!mangaId) return err('manga is required', 400);
      const rows = await DB.prepare(`SELECT rec_manga_id,
             (SELECT COUNT(*) FROM recs r2 WHERE r2.manga_id = r.manga_id AND r2.rec_manga_id = r.rec_manga_id) AS count
        FROM recs r WHERE r.manga_id = ? GROUP BY rec_manga_id ORDER BY count DESC`).bind(mangaId).all().catch(() => ({ results: [] }));
      return json({
        data: await Promise.all(rows.results.map(async (row) => ({
          id: row.rec_manga_id,
          count: row.count,
          mine: !!me && !!(await DB.prepare('SELECT 1 FROM recs WHERE manga_id = ? AND rec_manga_id = ? AND user_id = ?')
            .bind(mangaId, row.rec_manga_id, me.id).first().catch(() => null)),
        }))),
      });
    }
    if ((p === '/recs') && (req.method === 'POST' || req.method === 'DELETE')) {
      needDb();
      needAuth();
      const { mangaId, recId } = await readJson(req);
      if (!mangaId || !recId) return err('mangaId and recId are required', 400);
      if (req.method === 'POST') await DB.prepare('INSERT OR IGNORE INTO recs (manga_id, rec_manga_id, user_id) VALUES (?, ?, ?)').bind(mangaId, recId, me.id).run();
      else await DB.prepare('DELETE FROM recs WHERE manga_id = ? AND rec_manga_id = ? AND user_id = ?').bind(mangaId, recId, me.id).run();
      return json({ ok: true });
    }
    // Titles this user has read/followed (rec picker)
    if (p === '/history' && req.method === 'GET') {
      needDb();
      needAuth();
      const f = await DB.prepare('SELECT manga_id FROM follows WHERE user_id = ?').bind(me.id).all().catch(() => ({ results: [] }));
      const r = await DB.prepare('SELECT DISTINCT manga_id FROM progress WHERE user_id = ?').bind(me.id).all().catch(() => ({ results: [] }));
      return json({ data: [...new Set([...r.results.map((x) => x.manga_id), ...f.results.map((x) => x.manga_id)])] });
    }
    // Originals aren't supported on the static build (no file storage).
    if (p === '/originals' && req.method === 'GET') return json({ data: [] });
    if (p.startsWith('/originals')) {
      return err(req.method === 'GET' ? 'Not found' : 'Publishing needs the full server (Render build)', req.method === 'GET' ? 404 : 403);
    }
    return err('Not found', 404);
  } catch (e) {
    return err(e.message || 'Request failed', e.status || 500);
  }
}
