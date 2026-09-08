// MyGhoulScans static API proxy — runs on Cloudflare Workers (free tier).
// Forwards our tiny API shapes to MangaDex and adds CORS + edge caching,
// so the GitHub Pages build (docs/) can read MangaDex straight from browsers.
// Deploy: npx wrangler deploy  (or paste into dash.cloudflare.com → Workers)
const MDEX_API = 'https://api.mangadex.org';
const MDEX_UA = 'MyGhoulScans-static/1.0 (personal reader)';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};
const json = (data, status = 200, ttl = 60) => new Response(JSON.stringify(data), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` },
});
const err = (message, status = 502) => json({ error: message }, status, 0);

async function mdex(url) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(`${MDEX_API}${url}`, {
        headers: { 'User-Agent': MDEX_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      continue;
    }
    if (res.ok) return res.json();
    const e = new Error(`MangaDex ${res.status}`);
    e.status = res.status;
    if (res.status !== 429 && res.status < 500) throw e;
    lastErr = e;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
  }
  throw lastErr || new Error('MangaDex unavailable');
}

const CONTENT_FILTER = (mature) => {
  const base = ['safe', 'suggestive'];
  if (mature) base.push('erotica');
  return base;
};

// In-memory caches (per isolate, best-effort — same policy as the Node server)
const sectionCache = new Map();
const SECTION_TTL = 5 * 60 * 1000;
async function cachedSection(key, fn) {
  const hit = sectionCache.get(key);
  if (hit && Date.now() - hit.at < SECTION_TTL) return hit.data;
  const data = await fn();
  sectionCache.set(key, { data, at: Date.now() });
  return data;
}
const readableCache = new Map();
const READABLE_TTL = 5 * 60 * 1000;
async function readableChapterCount(mangaId, mature) {
  const key = `${mangaId}:${mature ? 1 : 0}`;
  const hit = readableCache.get(key);
  if (hit && Date.now() - hit.at < READABLE_TTL) return { n: hit.n, total: hit.total };
  let n = -1;
  let total = 0;
  try {
    const params = new URLSearchParams({ 'translatedLanguage[]': 'en', limit: '5', 'order[chapter]': 'asc' });
    for (const r of CONTENT_FILTER(mature)) params.append('contentRating[]', r);
    const data = await mdex(`/manga/${mangaId}/feed?${params}`);
    n = (data.data || []).filter((c) => c.attributes.pages > 0 && !c.attributes.externalUrl).length;
    total = data.total || 0;
  } catch {}
  readableCache.set(key, { n, total, at: Date.now() });
  return { n, total };
}
async function keepReadable(list, mature) {
  const kept = [];
  let i = 0;
  const workers = [];
  for (let w = 0; w < 3; w++) {
    workers.push((async () => {
      while (i < list.length) {
        const m = list[i++];
        const { n, total } = await readableChapterCount(m.id, mature);
        if (n > 0) { m._chapters = total; kept.push(m); }
      }
    })());
  }
  await Promise.all(workers);
  return kept;
}
async function mdexListSection(extraParams, mature) {
  const params = new URLSearchParams({
    'order[followedCount]': 'desc',
    hasAvailableChapters: 'true',
    limit: '48',
    offset: '0',
  });
  for (const [k, v] of extraParams) params.append(k, v);
  params.append('includes[]', 'cover_art');
  for (const r of CONTENT_FILTER(mature)) params.append('contentRating[]', r);
  const data = await mdex(`/manga?${params}`);
  if (Array.isArray(data.data) && data.data.length) data.data = await keepReadable(data.data, mature);
  return data;
}
const atHomeCache = new Map();
const ATHOME_TTL = 10 * 60 * 1000;

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'GET') return err('Method not allowed', 405);
    const url = new URL(req.url);
    const q = url.searchParams;
    const mature = q.get('mature') === '1';
    try {
      const p = url.pathname;
      // Search
      if (p === '/search') {
        const params = new URLSearchParams({ 'order[relevance]': 'desc', limit: '24', offset: q.get('offset') || '0' });
        params.append('includes[]', 'cover_art');
        if (q.get('q')) params.set('title', q.get('q'));
        if (q.get('tag')) params.append('includedTags[]', q.get('tag'));
        for (const r of CONTENT_FILTER(mature)) params.append('contentRating[]', r);
        return json(await mdex(`/manga?${params}`));
      }
      // Type sections
      const sections = {
        '/trending': [], '/manga': [['originalLanguage[]', 'ja']],
        '/manhwa': [['originalLanguage[]', 'ko']],
        '/manhua': [['originalLanguage[]', 'zh'], ['originalLanguage[]', 'zh-hk']],
      };
      if (p in sections) {
        return json(await cachedSection(`${p}:${mature}`, () => mdexListSection(sections[p], mature)));
      }
      // Top-rated readable titles
      if (p === '/recommended') {
        return json(await cachedSection(`recommended:${mature}`, async () => {
          const params = new URLSearchParams({ 'order[rating]': 'desc', hasAvailableChapters: 'true', limit: '24', offset: '0' });
          params.append('includes[]', 'cover_art');
          for (const r of CONTENT_FILTER(mature)) params.append('contentRating[]', r);
          const d = await mdex(`/manga?${params}`);
          if (Array.isArray(d.data) && d.data.length) d.data = await keepReadable(d.data, mature);
          return d;
        }));
      }
      // New releases
      if (p === '/new') {
        return json(await cachedSection(`new:${mature}`, async () => {
          const params = new URLSearchParams({ 'order[createdAt]': 'desc', hasAvailableChapters: 'true', limit: '48', offset: '0' });
          params.append('includes[]', 'cover_art');
          for (const r of CONTENT_FILTER(mature)) params.append('contentRating[]', r);
          const d = await mdex(`/manga?${params}`);
          if (Array.isArray(d.data) && d.data.length) d.data = await keepReadable(d.data, mature);
          return d;
        }));
      }
      // Latest updated (chapter feed mapped back to manga)
      if (p === '/latest') {
        const cp = new URLSearchParams({
          'order[publishAt]': 'desc', 'translatedLanguage[]': 'en',
          includeExternalUrl: '0', includeFuturePublishAt: '0', limit: '40',
        });
        for (const r of CONTENT_FILTER(mature)) cp.append('contentRating[]', r);
        const chapters = (await mdex(`/chapter?${cp}`)).data || [];
        const byManga = new Map();
        for (const c of chapters) {
          const m = (c.relationships || []).find((x) => x.type === 'manga');
          if (!m || byManga.has(m.id)) continue;
          byManga.set(m.id, { chapterId: c.id, label: c.attributes.chapter || '', at: c.attributes.publishAt || '' });
        }
        const ids = [...byManga.keys()].slice(0, 36);
        const bp = new URLSearchParams({ limit: '100' });
        bp.append('includes[]', 'cover_art');
        for (const id of ids) bp.append('ids[]', id);
        const mangas = (await mdex(`/manga?${bp}`)).data || [];
        const list = await keepReadable(mangas, mature);
        const meta = {};
        for (const m of list) if (byManga.has(m.id)) meta[m.id] = byManga.get(m.id);
        return json({ data: list, chapters: meta }, 200, 60);
      }
      // Genre tags
      if (p === '/tags') {
        return json(await cachedSection('tags', async () => {
          const d = await mdex('/manga/tag');
          return {
            data: (d.data || [])
              .filter((t) => t.attributes && t.attributes.group === 'genre')
              .map((t) => {
                const n = t.attributes.name || {};
                return { id: t.id, name: n.en || n.ja || Object.values(n)[0] || 'genre' };
              })
              .sort((a, b) => a.name.localeCompare(b.name)),
          };
        }), 200, 3600);
      }
      // Genre filter
      if (p === '/genre') {
        const tags = (q.get('tags') || q.get('tag') || '').split(',').filter(Boolean);
        if (!tags.length) return err('tag is required', 400);
        return json(await cachedSection(`genre:${mature}:${tags.join(',')}`, async () => {
          const params = new URLSearchParams({ 'order[followedCount]': 'desc', hasAvailableChapters: 'true', limit: '24', offset: '0' });
          for (const t of tags) params.append('includedTags[]', t);
          if (tags.length > 1) params.append('includedTagsMode', 'OR');
          params.append('includes[]', 'cover_art');
          for (const r of CONTENT_FILTER(mature)) params.append('contentRating[]', r);
          const d = await mdex(`/manga?${params}`);
          if (Array.isArray(d.data) && d.data.length) d.data = await keepReadable(d.data, mature);
          return d;
        }));
      }
      // Top 10 most-followed + real follow counts via statistics
      if (p === '/popular-top') {
        return json(await cachedSection(`popular-top:${mature}`, async () => {
          const params = new URLSearchParams({ 'order[followedCount]': 'desc', limit: '10' });
          params.append('includes[]', 'cover_art');
          for (const r of CONTENT_FILTER(mature)) params.append('contentRating[]', r);
          const d = await mdex(`/manga?${params}`);
          const ids = (d.data || []).map((m) => m.id);
          const follows = {};
          if (ids.length) {
            const sp = new URLSearchParams();
            for (const id of ids) sp.append('manga[]', id);
            try {
              const sd = await mdex(`/statistics/manga?${sp}`);
              const stats = (sd && sd.statistics) || {};
              for (const id of ids) follows[id] = (stats[id] && stats[id].follows) || 0;
            } catch {}
          }
          return { data: d.data || [], follows };
        }), 200, 300);
      }
      // Bulk fetch by ids
      if (p === '/bulk') {
        const ids = (q.get('ids') || '').split(',').filter(Boolean);
        if (!ids.length) return json({ data: [] });
        const params = new URLSearchParams({ limit: '100' });
        params.append('includes[]', 'cover_art');
        for (const id of ids) params.append('ids[]', id);
        return json(await mdex(`/manga?${params}`), 200, 300);
      }
      // Single manga + full chapter feed
      let m = p.match(/^\/manga\/([^/]+)$/);
      if (m) {
        const params = new URLSearchParams();
        params.append('includes[]', 'cover_art');
        params.append('includes[]', 'author');
        params.append('includes[]', 'artist');
        return json(await mdex(`/manga/${m[1]}?${params}`), 200, 300);
      }
      m = p.match(/^\/manga\/([^/]+)\/feed$/);
      if (m) {
        const all = [];
        let offset = 0;
        while (offset <= 10000) {
          const params = new URLSearchParams({
            'translatedLanguage[]': q.get('lang') || 'en',
            'order[chapter]': 'asc', limit: '500', offset: String(offset),
          });
          params.append('includes[]', 'scanlation_group');
          for (const r of CONTENT_FILTER(q.get('mature') === '1')) params.append('contentRating[]', r);
          const data = await mdex(`/manga/${m[1]}/feed?${params}`);
          const page = data.data || [];
          all.push(...page);
          if (page.length < 500) { data.data = all; return json(data, 200, 120); }
          offset += 500;
        }
        return json({ data: all }, 200, 120);
      }
      // At-home server
      m = p.match(/^\/chapter\/([^/]+)\/at-home$/);
      if (m) {
        const hit = atHomeCache.get(m[1]);
        if (hit && Date.now() - hit.at < ATHOME_TTL) {
          return new Response(JSON.stringify(hit.data), { headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        const data = await mdex(`/at-home/server/${m[1]}`);
        atHomeCache.set(m[1], { data, at: Date.now() });
        return json(data, 200, 120);
      }
      return err('Not found', 404);
    } catch (e) {
      return err(e.message || 'Upstream error', e.status || 502);
    }
  },
};
