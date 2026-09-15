// MyGhoulScans static API — runs on Cloudflare Workers (free tier).
// Serves the GitHub Pages build: Comick-source comic routes (search, title,
// chapters, page images, latest, genres) + account/library/progress/comments
// storage on D1, with CORS for browser calls.
// Deploy: npx wrangler deploy  (needs a D1 database bound as DB — run
// worker/schema.sql on it once first; see worker/wrangler.toml)
// NOTE: uploads/originals can't work here (no filesystem) — those endpoints
// return clean empty states, and the static build hides the publish buttons.

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
const COMICK_DEFAULT_SOURCES = ['mangaread', 'flamecomics'];

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

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
    .trim();
}
function absUrl(maybeRel, base) {
  try {
    const u = String(maybeRel || '').trim().replace(/\s+/g, '');
    if (!u || u.startsWith('data:')) return '';
    return new URL(u, base).toString();
  } catch { return ''; }
}
function imgTagSrc(tag) {
  const attr = (n) => {
    const m = tag.match(new RegExp(n + '\\s*=\\s*(["\'])(.*?)\\1', 'is'));
    return m ? m[2].trim() : '';
  };
  const one = (v) => String(v || '').replace(/\s+/g, '');
  const srcset = attr('data-srcset') || attr('srcset');
  if (srcset) {
    const first = srcset.split(',')[0].trim().split(/\s+/)[0];
    if (first) return one(first);
  }
  return one(attr('data-src')) || one(attr('data-lazy-src')) || one(attr('data-original')) || one(attr('src'));
}
const JUNK_IMG = /(logo|avatar|banner|icon|ads?-|advert|gravatar|emoji|spinner|loading|placeholder|favicon|\.svg(\?|$))/i;
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
  return { title: title || 'Untitled', cover, description, status, type, genres };
}
const titleCache = new Map();
const TITLE_TTL = 10 * 60 * 1000;
async function cachedTitle(source, url) {
  const hit = titleCache.get(url);
  if (hit && Date.now() - hit.at < TITLE_TTL) return hit.data;
  const data = await scrapeTitle(source, url);
  if (titleCache.size > 500) titleCache.delete(titleCache.keys().next().value);
  titleCache.set(url, { data, at: Date.now() });
  return data;
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

async function comickChapters(env, source, mangaUrl) {
  try {
    const data = await comickApi(env, '/api/chapters', { method: 'POST', body: { url: mangaUrl, source } });
    const list = (data.chapters || []).map((c) => ({
      id: String(c.id ?? c.number),
      number: Number(c.number) || 0,
      title: c.title || '',
      url: c.url,
    })).filter((c) => c.url);
    if (list.length) return list.sort((a, b) => a.number - b.number);
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
  return out.sort((a, b) => a.number - b.number);
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
    out.push({
      title: decodeEntities(link[2]).trim(),
      url,
      cover: img ? absUrl(imgTagSrc(img[0]), base) : '',
      latestChapter: ch ? decodeEntities(ch[2]).trim().replace(/^chapter\s+/i, '') : '',
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
    title: r.title,
    url,
    cover: r.coverImage || '',
    latestChapter: r.latestChapter || 0,
    lastUpdated: r.lastUpdated || '',
    rating: r.rating ?? null,
  };
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
const userPublic = (u) => u && { id: u.id, email: u.email, display_name: u.display_name, avatar: u.avatar, created_at: u.created_at };
async function authUser(req, env) {
  if (!env.DB) return null;
  const h = req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer (.+)$/);
  if (!m) return null;
  const s = await env.DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(m[1]).first();
  if (!s || new Date(s.expires) < new Date()) return null;
  return env.DB.prepare('SELECT id, email, display_name, avatar, created_at FROM users WHERE id = ?').bind(s.user_id).first();
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
    if (p.startsWith('/auth/') || p.startsWith('/library') || p.startsWith('/progress')
      || p.startsWith('/reads') || p.startsWith('/popular') || p.startsWith('/comments')
      || p.startsWith('/recs') || p.startsWith('/history') || p.startsWith('/me/') || p.startsWith('/originals')) {
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
      // Search (fan-out across sources, merged)
      if (p === '/comick/search') {
        const query = String(q.get('q') || '').trim().slice(0, 80);
        if (!query) return err('q is required', 400);
        const single = String(q.get('source') || '').trim().toLowerCase();
        const multi = String(q.get('sources') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        const sources = [...new Set(single ? [single] : (multi.length ? multi : COMICK_DEFAULT_SOURCES))].slice(0, 4);
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
        let data = { data: items.map((r) => ({ ...normResult(source, { ...r, coverImage: r.cover, latestChapter: 0 }), latestChapterLabel: r.latestChapter })) };
        if (enrich) data = { data: await enrichItems(data.data.slice(0, 12)).then((m) => data.data.slice(0, 12).map((it) => ({ ...it, ...(m.get(it.id) || {}) }))) };
        latestCache.set(key, { data, at: Date.now() });
        return json(data, 200, 60);
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
        const page = Math.max(1, Math.min(20, parseInt(q.get('page') || '1', 10) || 1));
        const key = `${source}:${genre}:${page}`;
        const hit = genreCache.get(key);
        if (hit && Date.now() - hit.at < GENRE_TTL) return json(hit.data, 200, 120);
        const base = (await comickSourceBase(env, source)) || 'https://www.mangaread.org';
        const gurl = `${base.replace(/\/$/, '')}/genres/${genre}/${page > 1 ? `page/${page}/` : ''}`;
        const html = await fetchHtml(gurl);
        const items = extractLatestWp(html, gurl);
        if (!items.length) throw new Error('No titles in this genre on this source');
        const data = { data: items.map((r) => ({ ...normResult(source, { ...r, coverImage: r.cover, latestChapter: 0 }), latestChapterLabel: r.latestChapter })), page };
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
    // Custom avatars need file storage — full server only.
    if ((p === '/auth/avatar' || p === '/auth/avatar/') && (req.method === 'POST' || req.method === 'DELETE')) {
      return err('Custom profile pictures need the full server (Render build)', 503);
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
      const user = await DB.prepare('SELECT id, email, display_name, avatar, created_at FROM users WHERE id = ?').bind(id).first();
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
      const user = await DB.prepare('SELECT id, email, display_name, avatar, created_at FROM users WHERE id = ?').bind(u.id).first();
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
      const rows = await DB.prepare('SELECT manga_id FROM follows WHERE user_id = ? ORDER BY added_at DESC').bind(me.id).all();
      return json({ mangaIds: rows.results.map((r) => r.manga_id) });
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
      const rows = await DB.prepare('SELECT manga_id AS id, COUNT(*) AS n FROM reads GROUP BY manga_id ORDER BY n DESC LIMIT 10').bind().all().catch(() => ({ results: [] }));
      return json({ data: rows.results });
    }
    // Comments (per chapter)
    if (p === '/comments' && req.method === 'GET') {
      needDb();
      const chapterId = String(q.get('chapter') || '');
      if (!chapterId) return err('chapter is required', 400);
      const rows = await DB.prepare(`SELECT c.id, c.manga_id, c.chapter_id, c.body, c.pinned, c.created_at, u.display_name,
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
      const { vote } = await readJson(req);
      if (vote !== 1 && vote !== -1) return err('vote must be 1 or -1', 400);
      const cid = Number(m[1]);
      const existing = await DB.prepare('SELECT * FROM comment_votes WHERE user_id = ? AND comment_id = ?').bind(me.id, cid).first();
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
      const flags = await DB.prepare('SELECT pinned, blocked FROM comments WHERE id = ?').bind(cid).first();
      return json({ likes, dislikes, myVote: myVote ? myVote.vote : 0, pinned: !!(flags && flags.pinned), blocked: !!(flags && flags.blocked) });
    }
    m = p.match(/^\/comments\/(\d+)$/);
    if (m && req.method === 'DELETE') {
      needDb();
      needAuth();
      const c = await DB.prepare('SELECT * FROM comments WHERE id = ?').bind(Number(m[1])).first();
      if (!c) return err('Comment not found', 404);
      if (c.user_id !== me.id) return err('Only the author can delete this comment', 403);
      await DB.prepare('DELETE FROM comments WHERE id = ?').bind(c.id).run();
      return json({ ok: true });
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
