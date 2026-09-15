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
// Best-effort per-isolate rate limiting for auth endpoints
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

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const q = url.searchParams;
    const mature = q.get('mature') === '1';
    const p = url.pathname;
    // ---- Account / library / progress API (D1) ----
    if (p.startsWith('/auth/') || p.startsWith('/library') || p.startsWith('/progress')) {
      if (!env.DB) return err('Accounts database not connected', 503);
      return handleAccount(req, env, p, q);
    }
    if (req.method !== 'GET') return err('Method not allowed', 405);
    try {
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

// ---------- Account / library / progress handlers (D1) ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function handleAccount(req, env, p, q) {
  const DB = env.DB;
  const ip = req.headers.get('CF-Connecting-IP') || 'x';
  const me = await authUser(req, env);
  const needAuth = () => { if (!me) throw Object.assign(new Error('Not logged in'), { status: 401 }); };
  try {
    // Public generated avatar (no login needed)
    let m = p.match(/^\/auth\/avatar\/(\d+)\.svg$/);
    if (m && req.method === 'GET') {
      const u = await DB.prepare('SELECT id, display_name FROM users WHERE id = ?').bind(m[1]).first();
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
    // Signup
    if (p === '/auth/signup' && req.method === 'POST') {
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
      const h = req.headers.get('Authorization') || '';
      const t = (h.match(/^Bearer (.+)$/) || [])[1];
      if (t) await DB.prepare('DELETE FROM sessions WHERE token = ?').bind(t).run();
      return json({ ok: true });
    }
    // Me
    if (p === '/auth/me' && req.method === 'GET') return json({ user: userPublic(me) });
    // Stats
    if (p === '/auth/stats' && req.method === 'GET') {
      needAuth();
      const lib = await DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE user_id = ?').bind(me.id).first();
      const ch = await DB.prepare('SELECT COUNT(*) AS n FROM progress WHERE user_id = ?').bind(me.id).first();
      return json({ stats: { library: lib.n, chapters: ch.n } });
    }
    // Rename / password change
    if (p === '/auth/account' && req.method === 'PATCH') {
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
      needAuth();
      const h = req.headers.get('Authorization') || '';
      const t = (h.match(/^Bearer (.+)$/) || [])[1];
      if (t) await DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').bind(me.id, t).run();
      else await DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(me.id).run();
      return json({ ok: true });
    }
    // Delete account + wipe everything
    if (p === '/auth/account' && req.method === 'DELETE') {
      needAuth();
      const { confirm } = await readJson(req);
      if (confirm !== 'DELETE') return err('Type DELETE to confirm', 400);
      await DB.prepare('DELETE FROM users WHERE id = ?').bind(me.id).run();
      return json({ ok: true });
    }
    // Library
    if (p === '/library' && req.method === 'GET') {
      needAuth();
      const rows = await DB.prepare('SELECT manga_id FROM follows WHERE user_id = ? ORDER BY added_at DESC').bind(me.id).all();
      return json({ mangaIds: rows.results.map((r) => r.manga_id) });
    }
    m = p.match(/^\/library\/(.+)\/status$/);
    if (m && req.method === 'GET') {
      needAuth();
      const r = await DB.prepare('SELECT 1 AS x FROM follows WHERE user_id = ? AND manga_id = ?').bind(me.id, m[1]).first();
      return json({ followed: !!r });
    }
    m = p.match(/^\/library\/(.+)$/);
    if (m && (req.method === 'POST' || req.method === 'DELETE')) {
      needAuth();
      const id = decodeURIComponent(m[1]);
      if (req.method === 'POST') await DB.prepare('INSERT OR IGNORE INTO follows (user_id, manga_id) VALUES (?, ?)').bind(me.id, id).run();
      else await DB.prepare('DELETE FROM follows WHERE user_id = ? AND manga_id = ?').bind(me.id, id).run();
      return json({ ok: true });
    }
    // Progress
    if (p === '/progress' && req.method === 'GET') {
      needAuth();
      const rows = await DB.prepare('SELECT manga_id, chapter_id, page, chapter_label, updated_at FROM progress WHERE user_id = ? ORDER BY updated_at DESC').bind(me.id).all();
      return json({ items: rows.results });
    }
    m = p.match(/^\/progress\/(.+)$/);
    if (m && req.method === 'GET') {
      needAuth();
      const r = await DB.prepare('SELECT chapter_id, page, chapter_label FROM progress WHERE user_id = ? AND manga_id = ?').bind(me.id, decodeURIComponent(m[1])).first();
      return json(r || null);
    }
    if (m && req.method === 'POST') {
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
    return err('Not found', 404);
  } catch (e) {
    return err(e.message || 'Request failed', e.status || 500);
  }
}
