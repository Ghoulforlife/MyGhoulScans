// MyGhoulScans - server
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const MDEX_API = 'https://api.mangadex.org';
const MDEX_UA = 'MyGhoulScans/1.0 (personal reader; contact: myghoulscans)';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_BASE = process.env.REDIRECT_BASE || `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SESSION_COOKIE = 'mgs_session';
// Set COOKIE_SECURE=1 when serving behind HTTPS so session cookies are
// never sent over plain HTTP. Local dev stays on plain HTTP.
const SECURE_COOKIE = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
const sessionCookie = (token, maxAge) =>
  `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${SECURE_COOKIE}`;

// Tiny in-memory rate limiter (per IP, per endpoint group) for abuse-prone
// auth endpoints. Each limiter gets its own bucket map so signup traffic
// can never eat the login budget (or vice versa).
const rateStores = new Set();
function rateLimit({ windowMs, max }) {
  const buckets = new Map();
  rateStores.add(buckets);
  return (req, res, next) => {
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'x';
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || now > b.reset) b = { n: 0, reset: now + windowMs };
    b.n += 1;
    buckets.set(ip, b);
    if (b.n > max) return res.status(429).json({ error: 'Too many attempts — try again later' });
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const buckets of rateStores) for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 60000).unref?.();

function getSessionUser(req) {
  const token = req.cookiesGet ? null : null;
  return null;
}

// Minimal cookie parser
function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(header.split(';').map((c) => {
    const i = c.indexOf('=');
    return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }));
}

function currentUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = db.findSession(token);
  if (!session) return null;
  return db.findById(session.user_id);
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  req.user = user;
  next();
}

// ---------- Auth: email/password ----------
app.post('/api/auth/signup', rateLimit({ windowMs: 60 * 60 * 1000, max: 30 }), async (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (!email || !password || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (db.findByEmail(email.toLowerCase())) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }
  const name = String(displayName || '').trim();
  if (name) {
    if (name.length < 2 || name.length > 24) {
      return res.status(400).json({ error: 'Username must be 2–24 characters' });
    }
    if (db.findByDisplayName(name)) {
      return res.status(409).json({ error: 'That username is taken' });
    }
  }
  const hash = await bcrypt.hash(password, 10);
  const id = db.createUser({ email: email.toLowerCase(), password: hash, displayName: name || undefined });
  const { token } = db.createSession(id);
  res.setHeader('Set-Cookie', sessionCookie(token, 30 * 24 * 60 * 60));
  res.json({ user: db.findById(id) });
});

app.post('/api/auth/login', rateLimit({ windowMs: 10 * 60 * 1000, max: 10 }), async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.findByEmail((email || '').toLowerCase());
  if (!user || !user.password || !(await bcrypt.compare(password || '', user.password))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const { token } = db.createSession(user.id);
  res.setHeader('Set-Cookie', sessionCookie(token, 30 * 24 * 60 * 60));
  res.json({ user: db.findById(user.id) });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (token) db.deleteSession(token);
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: currentUser(req) });
});

app.get('/api/auth/stats', requireAuth, (req, res) => {
  res.json({ stats: db.userStats(req.user.id) });
});

// Generated initial avatar (deterministic hue per user, no storage needed)
app.get('/api/avatar/:id.svg', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(404).send('nope');
  const u = db.findById(id);
  const name = (u && u.display_name) || '?';
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  let h = 0;
  for (const c of `user-${id}`) h = (h * 31 + c.charCodeAt(0)) % 360;
  const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="hsl(${h},55%,38%)"/><text x="48" y="62" font-family="sans-serif" font-size="38" font-weight="bold" fill="#fff" text-anchor="middle">${escXml(initials)}</text></svg>`);
});

// Custom profile pictures (signed in)
const AVATARS_DIR = path.join(__dirname, 'data', 'avatars');
fs.mkdirSync(AVATARS_DIR, { recursive: true });
app.use('/uploads/avatars', express.static(AVATARS_DIR, { maxAge: '7d', dotfiles: 'deny', index: false }));

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (IMG_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('Only JPG, PNG, WebP or GIF images are allowed'));
  },
});

app.post('/api/auth/avatar', requireAuth, avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach an image' });
  const ext = IMG_EXT[req.file.mimetype];
  if (!ext) return res.status(400).json({ error: 'Only JPG, PNG, WebP or GIF images are allowed' });
  for (const f of fs.readdirSync(AVATARS_DIR)) {
    if (f.startsWith(`${req.user.id}.`)) fs.rmSync(path.join(AVATARS_DIR, f), { force: true });
  }
  fs.writeFileSync(path.join(AVATARS_DIR, `${req.user.id}${ext}`), req.file.buffer);
  db.setAvatar(req.user.id, `avatars/${req.user.id}${ext}`);
  res.json({ ok: true, avatar: `avatars/${req.user.id}${ext}` });
});

app.delete('/api/auth/avatar', requireAuth, (req, res) => {
  for (const f of fs.readdirSync(AVATARS_DIR)) {
    if (f.startsWith(`${req.user.id}.`)) fs.rmSync(path.join(AVATARS_DIR, f), { force: true });
  }
  db.setAvatar(req.user.id, null);
  res.json({ ok: true });
});

// Account settings: display name and/or password
app.patch('/api/auth/account', requireAuth, async (req, res) => {
  const { displayName, currentPassword, newPassword } = req.body || {};
  if (displayName !== undefined) {
    const name = String(displayName).trim();
    if (name.length < 2 || name.length > 24) {
      return res.status(400).json({ error: 'Username must be 2–24 characters' });
    }
    if (db.displayNameTaken(name, req.user.id)) {
      return res.status(409).json({ error: 'That username is taken' });
    }
    db.updateDisplayName(req.user.id, name);
  }
  if (newPassword !== undefined) {
    const full = db.findByEmail(req.user.email);
    if (full && full.password) {
      if (!currentPassword || !(await bcrypt.compare(currentPassword, full.password))) {
        return res.status(401).json({ error: 'Current password is wrong' });
      }
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    db.updatePassword(req.user.id, await bcrypt.hash(String(newPassword), 10));
  }
  res.json({ user: db.findById(req.user.id) });
});

// Sign out everywhere (all devices except this one)
app.post('/api/auth/sessions/clear', requireAuth, (req, res) => {
  const cookies = parseCookies(req);
  db.clearOtherSessions(req.user.id, cookies[SESSION_COOKIE]);
  res.json({ ok: true });
});

// Delete account + wipe every scrap of its data
app.delete('/api/auth/account', requireAuth, async (req, res) => {
  const { confirm } = req.body || {};
  if (confirm !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm' });
  const seriesIds = db.ownedOriginalSeries(req.user.id);
  db.deleteUserAccount(req.user.id);
  for (const sid of seriesIds) {
    fs.rmSync(path.join(ORIGINALS_DIR, String(sid)), { recursive: true, force: true });
  }
  for (const f of fs.readdirSync(AVATARS_DIR)) {
    if (f.startsWith(`${req.user.id}.`)) fs.rmSync(path.join(AVATARS_DIR, f), { force: true });
  }
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  res.json({ ok: true });
});

// ---------- Auth: Google OAuth ----------
app.get('/api/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: 'Google sign-in is not configured. Use email signup or set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.' });
  }
  const state = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${REDIRECT_BASE}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!GOOGLE_CLIENT_ID || !code) return res.status(400).send('Google sign-in is not configured or the request was invalid.');
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${REDIRECT_BASE}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = await userInfoRes.json();

    let user = db.findByGoogleSub(info.id);
    if (!user) {
      user = db.findByEmail(info.email);
      if (user) {
        // link google to existing email account
        db.linkGoogle(user.id, info.id);
      } else {
        const id = db.createUser({ email: info.email, googleSub: info.id, displayName: db.uniqueDisplayName(info.name || info.email) });
        user = db.findById(id);
      }
    }
    const { token } = db.createSession(user.id);
    res.setHeader('Set-Cookie', sessionCookie(token, 30 * 24 * 60 * 60));
    res.redirect('/#/');
  } catch (e) {
    console.error('Google OAuth error', e);
    res.status(500).send('Google sign-in failed. Please try again.');
  }
});

// ---------- Library ----------
app.get('/api/library', requireAuth, (req, res) => {
  const rows = db.listFollows(req.user.id);
  res.json({ mangaIds: rows.map((r) => r.manga_id) });
});

app.post('/api/library/:mangaId', requireAuth, (req, res) => {
  db.addFollow(req.user.id, req.params.mangaId);
  res.json({ ok: true });
});

app.delete('/api/library/:mangaId', requireAuth, (req, res) => {
  db.removeFollow(req.user.id, req.params.mangaId);
  res.json({ ok: true });
});

app.get('/api/library/:mangaId/status', requireAuth, (req, res) => {
  res.json({ followed: db.isFollowed(req.user.id, req.params.mangaId) });
});

// ---------- Progress ----------
app.post('/api/progress/:mangaId', requireAuth, (req, res) => {
  const { chapterId, page, chapterLabel } = req.body || {};
  if (!chapterId || typeof page !== 'number' || page < 0) {
    return res.status(400).json({ error: 'chapterId (string) and page (number) are required' });
  }
  db.saveProgress(req.user.id, req.params.mangaId, chapterId, page, chapterLabel);
  res.json({ ok: true });
});

app.get('/api/progress/:mangaId', requireAuth, (req, res) => {
  const p = db.getProgress(req.user.id, req.params.mangaId);
  res.json(p || null);
});

// All progress (for the home "Continue Reading" section), newest first
app.get('/api/progress', requireAuth, (req, res) => {
  res.json({ items: db.listProgress(req.user.id) });
});

// ---------- Comments (per chapter) ----------
// Blocked at a set number of dislikes, pinned at a set number of likes.
app.get('/api/comments', (req, res) => {
  const chapterId = (req.query.chapter || '').toString();
  if (!chapterId) return res.status(400).json({ error: 'chapter is required' });
  const user = currentUser(req);
  const comments = db.listComments(chapterId, user ? user.id : null);
  const blockedCount = db.listCommentsBlockedCount(chapterId);
  res.json({
    data: comments,
    canPost: !!user,
    blockAt: db.COMMENTS_BLOCK_AT,
    pinAt: db.COMMENTS_PIN_AT,
    blockedCount,
  });
});

app.post('/api/comments', requireAuth, (req, res) => {
  const { mangaId, chapterId, body } = req.body || {};
  if (!mangaId || !chapterId) return res.status(400).json({ error: 'mangaId and chapterId are required' });
  const text = String(body || '').trim();
  if (!text || text.length > 2000) return res.status(400).json({ error: 'Comment must be 1-2000 characters' });
  const id = db.addComment(mangaId, chapterId, req.user.id, text);
  res.json({ ok: true, id });
});

app.post('/api/comments/:id/vote', requireAuth, (req, res) => {
  const vote = parseInt(req.body && req.body.vote, 10);
  if (vote !== 1 && vote !== -1) return res.status(400).json({ error: 'vote must be 1 or -1' });
  if (!db.getComment(req.params.id)) return res.status(404).json({ error: 'Comment not found' });
  const result = db.castVote(req.user.id, parseInt(req.params.id, 10), vote);
  res.json(result);
});

app.delete('/api/comments/:id', requireAuth, (req, res) => {
  const comment = db.getComment(parseInt(req.params.id, 10));
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  if (comment.user_id !== req.user.id) return res.status(403).json({ error: 'Only the author can delete this comment' });
  db.deleteComment(comment.id);
  res.json({ ok: true });
});

// ---------- Recommendations (reader-curated similar titles) ----------
app.get('/api/recs', (req, res) => {
  const mangaId = (req.query.manga || '').toString();
  if (!mangaId) return res.status(400).json({ error: 'manga is required' });
  const user = currentUser(req);
  res.json({ data: db.listRecs(mangaId, user ? user.id : null) });
});

app.post('/api/recs', requireAuth, (req, res) => {
  const { mangaId, recId } = req.body || {};
  if (!mangaId || !recId || mangaId === recId) return res.status(400).json({ error: 'mangaId and recId are required' });
  db.addRec(mangaId, recId, req.user.id);
  res.json({ ok: true });
});

app.delete('/api/recs', requireAuth, (req, res) => {
  const { mangaId, recId } = req.body || {};
  if (!mangaId || !recId) return res.status(400).json({ error: 'mangaId and recId are required' });
  db.removeRec(mangaId, recId, req.user.id);
  res.json({ ok: true });
});

// Titles the user has actually read/followed — used to build the "Recommend similar titles" picker
app.get('/api/history', requireAuth, (req, res) => {
  res.json({ data: db.listUserReadHistory(req.user.id) });
});

// ---------- Chapter reads (read counters + popularity) ----------
app.post('/api/reads', (req, res) => {
  const { mangaId, chapterId } = req.body || {};
  if (!mangaId || !chapterId) return res.status(400).json({ error: 'mangaId and chapterId are required' });
  const user = currentUser(req);
  db.addRead(mangaId, chapterId, user ? user.id : null);
  res.json({ ok: true });
});

const readCountsCache = new Map(); // mangaId -> { counts, at }
const READS_TTL = 30 * 1000;
app.get('/api/reads/counts', (req, res) => {
  const mangaId = (req.query.manga || '').toString();
  if (!mangaId) return res.status(400).json({ error: 'manga is required' });
  const hit = readCountsCache.get(mangaId);
  if (hit && Date.now() - hit.at < READS_TTL) return res.json({ counts: hit.counts });
  const counts = db.chapterReadCounts(mangaId);
  readCountsCache.set(mangaId, { counts, at: Date.now() });
  res.json({ counts });
});

const popularCache = new Map(); // { data, at }
const POPULAR_TTL = 60 * 1000;
app.get('/api/popular', (req, res) => {
  const hit = popularCache.get('popular');
  if (hit && Date.now() - hit.at < POPULAR_TTL) return res.json(hit.data);
  const data = { data: db.popularMangas(10) };
  popularCache.set('popular', { data, at: Date.now() });
  res.json(data);
});

// ---------- MangaDex proxy ----------
async function mdex(url, options = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(`${MDEX_API}${url}`, {
        ...options,
        headers: {
          'User-Agent': MDEX_UA,
          Accept: 'application/json',
          ...(options.headers || {}),
        },
        signal: AbortSignal.timeout(20000),
      });
    } catch (err) {
      // network error / timeout — retry
      lastErr = err;
      if (attempt < 2) { await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); continue; }
      break;
    }
    if (res.ok) return res.json();
    const err = new Error(`MangaDex ${res.status} for ${url.split('?')[0]}`);
    err.status = res.status;
    // 4xx (other than 429) is permanent — don't retry (e.g. 404 from a dead chapter)
    if (res.status !== 429 && res.status < 500) throw err;
    lastErr = err;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
  }
  throw lastErr || new Error('MangaDex unavailable');
}

const CONTENT_FILTER = (mature) => {
  const base = ['safe', 'suggestive'];
  if (mature) base.push('erotica');
  return base;
};

// ---------- Readability filtering ----------
// Trending/search can surface mangas whose English chapters are all external
// links or deleted (liclicensed/serialized titles) and therefore unreadable.
// MangaDex has no server-side flag for "actually readable EN chapters", so we
// probe each manga's EN feed (cheap, limit=5) and keep only mangas with >=1.
const readableCache = new Map(); // key -> { n, at }
const READABLE_TTL = 5 * 60 * 1000;

async function readableChapterCount(mangaId, mature) {
  const key = `${mangaId}:${mature ? 1 : 0}`;
  const hit = readableCache.get(key);
  if (hit && Date.now() - hit.at < READABLE_TTL) return { n: hit.n, total: hit.total };
  let n = -1; // -1 = probe failed; keep manga on transient errors, don't hide it
  let total = 0;
  try {
    const params = new URLSearchParams({ 'translatedLanguage[]': 'en', limit: '5', 'order[chapter]': 'asc' });
    for (const r of CONTENT_FILTER(mature)) params.append('contentRating[]', r);
    const data = await mdex(`/manga/${mangaId}/feed?${params}`);
    n = (data.data || []).filter((c) => c.attributes.pages > 0 && !c.attributes.externalUrl).length;
    total = data.total || 0; // MangaDex reports the full EN chapter count
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

// Short-lived result cache so home page reloads (sections + genre) are instant.
const sectionCache = new Map(); // key -> { data, at }
const SECTION_TTL = 5 * 60 * 1000;
async function cachedSection(key, fn) {
  const hit = sectionCache.get(key);
  if (hit && Date.now() - hit.at < SECTION_TTL) return hit.data;
  const data = await fn();
  sectionCache.set(key, { data, at: Date.now() });
  return data;
}

// Shared builder for the "type" sections (manga/manhwa/manhua/trending/recommended)
async function mdexListSection(name, extraParams, mature) {
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

app.get('/api/mdex/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const offset = parseInt(req.query.offset || '0', 10);
    const params = new URLSearchParams({
      'order[relevance]': 'desc',
      limit: '24',
      offset: String(offset),
    });
    params.append('includes[]', 'cover_art');
    if (q) params.set('title', q);
    if (req.query.tag) params.append('includedTags[]', req.query.tag);
    for (const r of CONTENT_FILTER(req.query.mature === '1')) params.append('contentRating[]', r);
    const data = await mdex(`/manga?${params}`);
    // Search is left unfiltered so licensed titles still appear; the title page
    // explains when a series has no readable chapters.
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/mdex/trending', async (req, res) => {
  try {
    const mature = req.query.mature === '1';
    const key = `trending:${mature}`;
    const data = await cachedSection(key, () => mdexListSection('trending', [], mature));
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Manga (Japanese original) section
app.get('/api/mdex/manga', async (req, res) => {
  try {
    const mature = req.query.mature === '1';
    const key = `manga:${mature}`;
    const data = await cachedSection(key, () => mdexListSection('manga', [['originalLanguage[]', 'ja']], mature));
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Manhwa (Korean original) section
app.get('/api/mdex/manhwa', async (req, res) => {
  try {
    const mature = req.query.mature === '1';
    const key = `manhwa:${mature}`;
    const data = await cachedSection(key, () => mdexListSection('manhwa', [['originalLanguage[]', 'ko']], mature));
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Manhua (Chinese original) section
app.get('/api/mdex/manhua', async (req, res) => {
  try {
    const mature = req.query.mature === '1';
    const key = `manhua:${mature}`;
    const data = await cachedSection(key, () => mdexListSection('manhua', [['originalLanguage[]', 'zh'], ['originalLanguage[]', 'zh-hk']], mature));
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Recommendations: top-rated titles that are actually readable
app.get('/api/mdex/recommended', async (req, res) => {
  try {
    const mature = req.query.mature === '1';
    const key = `recommended:${mature}`;
    const params = new URLSearchParams({
      'order[rating]': 'desc',
      hasAvailableChapters: 'true',
      limit: '24',
      offset: '0',
    });
    params.append('includes[]', 'cover_art');
    for (const r of CONTENT_FILTER(mature)) params.append('contentRating[]', r);
    const data = await cachedSection(key, async () => {
      const d = await mdex(`/manga?${params}`);
      if (Array.isArray(d.data) && d.data.length) d.data = await keepReadable(d.data, mature);
      return d;
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// New releases: most recently published English chapters mapped back to their manga
const latestCache = new Map(); // key -> { data, at }
const LATEST_TTL = 60 * 1000;
app.get('/api/mdex/latest', async (req, res) => {
  try {
    const mature = req.query.mature === '1';
    const key = `latest:${mature}`;
    const hit = latestCache.get(key);
    if (hit && Date.now() - hit.at < LATEST_TTL) return res.json(hit.data);
    const cp = new URLSearchParams({
      'order[publishAt]': 'desc',
      'translatedLanguage[]': 'en',
      includeExternalUrl: '0',
      includeFuturePublishAt: '0',
      limit: '40',
    });
    for (const r of CONTENT_FILTER(mature)) cp.append('contentRating[]', r);
    const chapters = (await mdex(`/chapter?${cp}`)).data || [];
    const byManga = new Map();
    for (const c of chapters) {
      const m = (c.relationships || []).find((x) => x.type === 'manga');
      if (!m || byManga.has(m.id)) continue;
      byManga.set(m.id, {
        chapterId: c.id,
        label: c.attributes.chapter || '',
        at: c.attributes.publishAt || '',
      });
    }
    const ids = [...byManga.keys()].slice(0, 36);
    const bp = new URLSearchParams({ limit: '100' });
    bp.append('includes[]', 'cover_art');
    for (const id of ids) bp.append('ids[]', id);
    const mangas = (await mdex(`/manga?${bp}`)).data || [];
    const list = await keepReadable(mangas, mature);
    const meta = {};
    for (const m of list) if (byManga.has(m.id)) { meta[m.id] = byManga.get(m.id); }
    const out = { data: list, chapters: meta };
    latestCache.set(key, { data: out, at: Date.now() });
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Newly added comics (fresh on the site, ordered by creation date)
app.get('/api/mdex/new', async (req, res) => {
  try {
    const mature = req.query.mature === '1';
    const key = `new:${mature}`;
    const params = new URLSearchParams({
      'order[createdAt]': 'desc',
      hasAvailableChapters: 'true',
      limit: '48',
      offset: '0',
    });
    params.append('includes[]', 'cover_art');
    for (const r of CONTENT_FILTER(mature)) params.append('contentRating[]', r);
    const data = await cachedSection(key, async () => {
      const d = await mdex(`/manga?${params}`);
      if (Array.isArray(d.data) && d.data.length) d.data = await keepReadable(d.data, mature);
      return d;
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Genre tags for the genre dropdown / settings
app.get('/api/mdex/tags', async (req, res) => {
  try {
    const data = await cachedSection('tags', async () => {
      const d = await mdex('/manga/tag');
      return {
        data: (d.data || [])
          .filter((t) => t.attributes && t.attributes.group === 'genre')
          .map((t) => {
            const n = t.attributes.name || {};
            return { id: t.id, name: n.en || n['ja'] || Object.values(n)[0] || 'genre' };
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Manga filtered by genre tag(s). ?tag=ID or ?tags=ID1,ID2 (OR semantics)
app.get('/api/mdex/genre', async (req, res) => {
  try {
    const tags = (req.query.tags || req.query.tag || '').toString().split(',').filter(Boolean);
    if (!tags.length) return res.status(400).json({ error: 'tag is required' });
    const mature = req.query.mature === '1';
    const key = `genre:${mature}:${tags.join(',')}`;
    const data = await cachedSection(key, async () => {
      const params = new URLSearchParams({
        'order[followedCount]': 'desc',
        hasAvailableChapters: 'true',
        limit: '24',
        offset: '0',
      });
      for (const t of tags) params.append('includedTags[]', t);
      if (tags.length > 1) params.append('includedTagsMode', 'OR');
      params.append('includes[]', 'cover_art');
      for (const r of CONTENT_FILTER(mature)) params.append('contentRating[]', r);
      const d = await mdex(`/manga?${params}`);
      if (Array.isArray(d.data) && d.data.length) d.data = await keepReadable(d.data, mature);
      return d;
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/mdex/manga/:id', async (req, res) => {
  try {
    const params = new URLSearchParams();
    params.append('includes[]', 'cover_art');
    params.append('includes[]', 'author');
    params.append('includes[]', 'artist');
    const data = await mdex(`/manga/${req.params.id}?${params}`);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/mdex/bulk', async (req, res) => {
  try {
    const ids = (req.query.ids || '').split(',').filter(Boolean);
    if (!ids.length) return res.json({ data: [] });
    const params = new URLSearchParams({ limit: '100' });
    params.append('includes[]', 'cover_art');
    for (const id of ids) params.append('ids[]', id);
    const data = await mdex(`/manga?${params}`);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/mdex/manga/:id/feed', async (req, res) => {
  try {
    // Fetch EVERY chapter (MangaDex caps a single call at 500), paging until we
    // hit the very end so even huge series expose all their chapters.
    const all = [];
    let offset = 0;
    while (offset <= 10000) {
      const params = new URLSearchParams({
        'translatedLanguage[]': req.query.lang || 'en',
        'order[chapter]': 'asc',
        limit: '500',
        offset: String(offset),
      });
      params.append('includes[]', 'scanlation_group');
      for (const r of CONTENT_FILTER(req.query.mature === '1')) params.append('contentRating[]', r);
      const data = await mdex(`/manga/${req.params.id}/feed?${params}`);
      const page = data.data || [];
      all.push(...page);
      if (page.length < 500) break;
      offset += 500;
    }
    const seen = new Set();
    const merged = all.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return c.attributes.pages > 0 && !c.attributes.externalUrl;
    });
    res.json({ data: merged, total: merged.length });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

const atHomeCache = new Map(); // chapterId -> { data, at }
const ATHOME_TTL = 10 * 60 * 1000;

app.get('/api/mdex/chapter/:id/at-home', async (req, res) => {
  try {
    const hit = atHomeCache.get(req.params.id);
    if (hit && Date.now() - hit.at < ATHOME_TTL) return res.json(hit.data);
    const data = await mdex(`/at-home/server/${req.params.id}`);
    atHomeCache.set(req.params.id, { data, at: Date.now() });
    res.json(data);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// ---------- Creator Originals (free community comics) ----------
const ORIGINALS_DIR = path.join(__dirname, 'data', 'originals');
fs.mkdirSync(ORIGINALS_DIR, { recursive: true });
app.use('/uploads/originals', express.static(ORIGINALS_DIR, { maxAge: '7d', dotfiles: 'deny', index: false }));

const IMG_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 101 },
  fileFilter: (req, file, cb) => {
    if (IMG_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('Only JPG, PNG, WebP or GIF images are allowed'));
  },
});

app.get('/api/originals', (req, res) => {
  const q = (req.query.q || '').toString().slice(0, 80);
  const list = db.listOriginalSeries({ q, limit: 60 }).map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    author: s.author,
    chapters: s.chapters,
    updated: s.last_update || s.created_at,
    cover: s.cover ? `/uploads/originals/${s.cover}` : null,
  }));
  res.json({ data: list });
});

app.get('/api/originals/:id', (req, res) => {
  const s = db.getOriginalSeries(req.params.id);
  if (!s) return res.status(404).json({ error: 'Series not found' });
  const chapters = db.listOriginalChapters(s.id).map((c) => ({
    id: c.id, num: c.num, title: c.title, pages: c.pages, created_at: c.created_at,
  }));
  res.json({
    data: {
      id: s.id, title: s.title, description: s.description, author: s.author,
      user_id: s.user_id, chapters: s.chapters,
      cover: s.cover ? `/uploads/originals/${s.cover}` : null,
      chaptersList: chapters,
    },
  });
});

app.post('/api/originals', requireAuth, upload.single('cover'), (req, res) => {
  const title = String((req.body && req.body.title) || '').trim().slice(0, 120);
  const description = String((req.body && req.body.description) || '').trim().slice(0, 2000);
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const id = db.createOriginalSeries(req.user.id, title, description, null);
  if (req.file) {
    const ext = IMG_EXT[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: 'Cover must be JPG, PNG, WebP or GIF' });
    const dir = path.join(ORIGINALS_DIR, String(id));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cover' + ext), req.file.buffer);
    db.setOriginalCover(id, `${id}/cover${ext}`);
  }
  res.json({ ok: true, id });
});

app.post('/api/originals/:id/chapters', requireAuth, upload.array('pages', 100), (req, res) => {
  const s = db.getOriginalSeries(req.params.id);
  if (!s) return res.status(404).json({ error: 'Series not found' });
  if (s.user_id !== req.user.id) return res.status(403).json({ error: 'Only the author can add chapters' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Attach at least one page image' });
  const num = String((req.body && req.body.num) || '').trim().slice(0, 20);
  const title = String((req.body && req.body.title) || '').trim().slice(0, 120);
  const cid = db.createOriginalChapter(s.id, num, title, files.length);
  const dir = path.join(ORIGINALS_DIR, String(s.id), String(cid));
  fs.mkdirSync(dir, { recursive: true });
  files.forEach((f, i) => {
    const ext = IMG_EXT[f.mimetype] || '.jpg';
    fs.writeFileSync(path.join(dir, String(i + 1).padStart(3, '0') + ext), f.buffer);
  });
  res.json({ ok: true, id: cid, pages: files.length });
});

app.get('/api/originals/chapter/:cid', (req, res) => {
  const c = db.getOriginalChapter(req.params.cid);
  if (!c) return res.status(404).json({ error: 'Chapter not found' });
  const dir = path.join(ORIGINALS_DIR, String(c.series_id), String(c.id));
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f)).sort();
  } catch {}
  res.json({
    data: {
      id: c.id, series_id: c.series_id, num: c.num, title: c.title,
      pages: files.map((f) => `/uploads/originals/${c.series_id}/${c.id}/${f}`),
    },
  });
});

// Multer/file errors as clean JSON instead of an HTML stack page
app.use((err, req, res, next) => {
  if (!err) return next();
  if (err instanceof multer.MulterError || /only jpg|file too large|unexpected field/i.test(err.message || '')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// Proxy for chapter images. The browser only talks to our origin, so MangaDex's
// CDN referer/CORS restrictions never apply. client --[img src]--> /api/img?u=<full url>
// A small in-memory byte cache makes re-opening a chapter (or scrolling back up)
// instant instead of a fresh trip to the MangaDex CDN.
const imgCache = new Map();
const IMG_CACHE_MAX = 400;
app.get('/api/img', async (req, res) => {
  const { u } = req.query;
  if (!u || !/^https:\/\/[a-z0-9.-]+\.mangadex\.(network|org)\//i.test(u)) {
    return res.status(400).json({ error: 'Invalid image URL' });
  }
  const hit = imgCache.get(u);
  if (hit) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', hit.type);
    return res.send(hit.buf);
  }
  try {
    let upstream = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        upstream = await fetch(u, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MyGhoulScans/1.0',
          },
          signal: AbortSignal.timeout(15000),
        });
        if (upstream.ok) break;
        upstream = null;
      } catch {}
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
    if (!upstream) {
      return res.status(502).json({ error: 'Image fetch failed' });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get('content-type') || 'image/jpeg';
    if (imgCache.size >= IMG_CACHE_MAX) imgCache.delete(imgCache.keys().next().value);
    imgCache.set(u, { buf, type });
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', type);
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: 'Image fetch failed: ' + e.message });
  }
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`MyGhoulScans running at http://localhost:${PORT}`);
  if (!GOOGLE_CLIENT_ID) {
    console.log('Note: Google sign-in is disabled (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable).');
  }
});