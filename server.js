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
const COMICK_API = process.env.COMICK_API_BASE || 'https://comick-source-api.notaspider.dev';
const SCRAPE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 MyGhoulScans/2.0';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_BASE = process.env.REDIRECT_BASE || `http://localhost:${PORT}`;

app.use(express.json({ limit: '1mb' }));
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
  const added = {};
  for (const r of rows) added[r.manga_id] = r.added_at || null;
  res.json({ mangaIds: rows.map((r) => r.manga_id), added });
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

// Clear entire library (used by "Clear all user data")
app.delete('/api/library', requireAuth, (req, res) => {
  db.clearFollows(req.user.id);
  res.json({ ok: true });
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

// Remove one title from Continue Reading
app.delete('/api/progress/:mangaId', requireAuth, (req, res) => {
  db.deleteProgress(req.user.id, req.params.mangaId);
  res.json({ ok: true });
});

// All progress (for the home "Continue Reading" section), newest first
app.get('/api/progress', requireAuth, (req, res) => {
  res.json({ items: db.listProgress(req.user.id) });
});

// Clear entire reading history (Continue Reading)
app.delete('/api/progress', requireAuth, (req, res) => {
  db.clearProgress(req.user.id);
  res.json({ ok: true });
});

// Clear all current user content at once: library + history + own read counts.
// This is what makes "I still see the manga I was reading" actually go away
// on every device — the frontend clears its localStorage copy too.
app.delete('/api/me/data', requireAuth, (req, res) => {
  db.clearUserContent(req.user.id);
  res.json({ ok: true });
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

app.post('/api/comments/:id/vote', requireAuth, rateLimit({ windowMs: 10 * 60 * 1000, max: 60 }), (req, res) => {
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

// ---------- Shop (Reader Points cosmetics) ----------
// Prices are enforced here — the client never sends a price. Colors run
// 1k (common) to 1M (mythic Rainbow); titles scale with coolness.
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
function shopStateFor(userId) {
  const me = userId ? db.findById(userId) : null;
  const owned = userId ? db.getOwned(userId) : [];
  const eq = userId ? db.equippedCosmetics(userId) : { name_color: '', title: '', frame: '', theme: '' };
  return {
    balance: me ? me.rp || 0 : 0,
    owned,
    equipped: eq,
    catalog: SHOP_CATALOG.map((it) => ({
      ...it,
      owned: owned.includes(it.id),
      equipped: (eq[SHOP_SLOT_COL[it.slot]] || '') === it.value,
    })),
  };
}
app.get('/api/shop', (req, res) => {
  const u = currentUser(req);
  res.json(shopStateFor(u ? u.id : null));
});
app.post('/api/shop/buy', requireAuth, (req, res) => {
  const { id } = req.body || {};
  const item = SHOP_CATALOG.find((i) => i.id === id);
  if (!item) return res.status(404).json({ error: 'Unknown item' });
  try {
    res.json({ ok: true, ...db.buyCosmetic(req.user.id, item) });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});
// Equip an owned item (or unequip the slot with id null). Values always come
// from the catalog — the client only ever sends ids.
app.post('/api/shop/equip', requireAuth, (req, res) => {
  const { slot, id } = req.body || {};
  const col = SHOP_SLOT_COL[slot];
  if (!col) return res.status(400).json({ error: 'Unknown slot' });
  try {
    if (id == null) return res.json({ ok: true, ...db.setEquipped(req.user.id, col, '') });
    const item = SHOP_CATALOG.find((i) => i.id === id && i.slot === slot);
    if (!item) return res.status(404).json({ error: 'Unknown item' });
    if (!db.getOwned(req.user.id).includes(id)) return res.status(403).json({ error: 'You do not own this yet' });
    res.json({ ok: true, ...db.setEquipped(req.user.id, col, item.value) });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// Avatar upload via small data-URL (used by the static build, which has no
// file storage; the multipart upload above stays for the full server).
app.post('/api/auth/avatar-data', requireAuth, (req, res) => {
  const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body || {}).image || ''));
  if (!m) return res.status(400).json({ error: 'Attach an image' });
  const buf = Buffer.from(m[3], 'base64');
  if (!buf.length || buf.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'Image too large' });
  const ext = { jpeg: '.jpg', png: '.png', webp: '.webp' }[m[2]];
  for (const f of fs.readdirSync(AVATARS_DIR)) {
    if (f.startsWith(`${req.user.id}.`)) fs.rmSync(path.join(AVATARS_DIR, f), { force: true });
  }
  fs.writeFileSync(path.join(AVATARS_DIR, `${req.user.id}${ext}`), buf);
  const avatar = `avatars/${req.user.id}${ext}`;
  db.setAvatar(req.user.id, avatar);
  res.json({ ok: true, avatar });
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
  const limit = Math.max(1, Math.min(30, parseInt(req.query.limit, 10) || 10));
  const data = { data: db.popularMangas(limit) };
  if (limit === 10) popularCache.set('popular', { data, at: Date.now() });
  res.json(data);
});

// ---------- Comick source API ----------
// Upstream scraper API (search + chapter lists), proxied server-side exactly
// like MangaDex was: the browser only talks to us. Set COMICK_API_BASE to a
// self-hosted copy of https://github.com/GooglyBlox/comick-source-api when the
// public instance is slow or blocked — no code changes needed.
// The upstream API has no title-details / page-images / browse endpoints, so
// those are scraped directly from source sites below (same cheerio-style
// approach upstream uses, dependency-free).
// Sources used when the client doesn't pick one. Override with
// COMICK_SOURCES="mangaread,mangayy,mangasushi,flamecomics".
const COMICK_DEFAULT_SOURCES = (process.env.COMICK_SOURCES || 'mangaread,mangayy,mangasushi,flamecomics')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// Client IDs look like "cx:mangaread:<base64url(manga page URL)>": one clean
// hash segment that always resolves back to the exact source URL, so no
// per-source URL rules are ever needed.
function cxEncode(source, url) {
  return `cx:${source}:${Buffer.from(url, 'utf8').toString('base64url')}`;
}
function cxDecode(id) {
  const m = /^cx:([^:]+):([A-Za-z0-9_-]+)$/.exec(String(id || ''));
  if (!m) return null;
  try {
    const url = Buffer.from(m[2], 'base64url').toString('utf8');
    if (!/^https?:\/\//i.test(url)) return null;
    return { source: m[1], url };
  } catch { return null; }
}

async function comickApi(path, { method = 'GET', body } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${COMICK_API}${path}`, {
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
        const err = new Error(`Comick API ${res.status} for ${path}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < 1) await new Promise((r) => setTimeout(r, 700));
    }
  }
  throw lastErr || new Error('Comick API unavailable');
}

// Raw HTML fetch for the title/pages/latest scrapers below.
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
    } catch (err) {
      lastErr = err;
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
    } catch (err) {
      lastErr = err;
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
// Best image URL out of an <img> tag: lazy-load attributes win over src.
// NOTE: attribute values keep inner whitespace here — srcset needs its spaces
// to split descriptors; single-URL attributes are compacted on return.
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

// Title details: og: tags first (work on every theme incl. Next.js sites),
// then wp-manga specifics (status, genres, long description).
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
    // summary-heading pairs: <h5>Status|Type</h5> … <div class="summary-content">VALUE
    const pair = (label) => {
      const m = html.match(new RegExp('summary-heading[^>]*>\\s*<h5>\\s*' + label + '[\\s\\S]{0,200}?summary-content[^>]*>\\s*([^<]{1,30})', 'i'));
      return m ? decodeEntities(m[1]).trim() : '';
    };
    status = pair('Status');
    type = pair('Type');
    // Genres live in their own container (keeps nav-menu links out).
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
const titleCache = new Map(); // url -> { data, at }
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
    description: d.synopsis || '',
    status: d.status || '',
    type: d.type || '',
    genres,
    contentRating: d.contentRating || '',
    latestChapter: d.latestChapter ?? 0,
    firstChapterUrl: d.firstChapterUrl ? 'https://comix.to' + d.firstChapterUrl : '',
    latestChapterUrl: d.latestChapterUrl ? 'https://comix.to' + d.latestChapterUrl : '',
  };
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

// Chapter page images. Three strategies, first hit wins:
// 1) wp-manga themes: precise per-page <img class="wp-manga-chapter-img">.
// 2) hash-pathed hosts (flamecomics …/series/<id>/<hash>/NN.jpg): the chapter
//    hash in the URL identifies exactly this chapter's files.
// 3) generic: scope to the reading container, junk-filter the rest.
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
const pagesCache = new Map(); // chapterUrl -> { pages, at }
const PAGES_TTL = 10 * 60 * 1000;

// Chapter list: upstream API first, direct wp-manga AJAX fallback.
// Comix titles expose first/latest links (opened externally) — chapter images
// need their private API.
async function comickChapters(source, mangaUrl) {
  if (source === 'comix') return comixChapters(mangaUrl);
  try {
    const data = await comickApi('/api/chapters', { method: 'POST', body: { url: mangaUrl, source } });
    const list = (data.chapters || []).map((c) => ({
      id: String(c.id ?? c.number),
      number: Number(c.number) || 0,
      title: c.title || '',
      url: c.url,
    })).filter((c) => c.url);
    if (list.length) return list.sort((a, b) => a.number - b.number);
  } catch {}
  // Direct fallback for wp-manga themes: POST <manga>/ajax/chapters/.
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

// Homepage "latest updates" for wp-manga themes (page-item-detail cards).
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
// (latestCache / LATEST_TTL live with the /api/comick/latest route below.)

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

// Sources the server can use (upstream clientOnly sources need a browser).
app.get('/api/comick/sources', async (req, res) => {
  try {
    const data = await comickApi('/api/sources');
    const list = (data.sources || [])
      .filter((s) => !s.clientOnly)
      .map((s) => ({ id: String(s.id).toLowerCase(), name: s.name, type: s.type || 'aggregator' }));
    res.json({ data: list });
  } catch (e) {
    // Upstream down: still offer the proven defaults so search keeps working.
    res.json({ data: COMICK_DEFAULT_SOURCES.map((id) => ({ id, name: id, type: 'aggregator' })), fallback: true });
  }
});

// Search one or more sources (fan-out, merged). ?q=..&source=mangaread or
// ?sources=mangaread,flamecomics (default: COMICK_SOURCES).
app.get('/api/comick/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (!q) return res.status(400).json({ error: 'q is required' });
    const single = String(req.query.source || '').trim().toLowerCase();
    const multi = String(req.query.sources || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const sources = [...new Set(single ? [single] : (multi.length ? multi : COMICK_DEFAULT_SOURCES))].slice(0, 4);
    const settled = await Promise.allSettled(sources.map(async (source) => {
      const data = await comickApi('/api/search', { method: 'POST', body: { query: q, source } });
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
    res.json({ data, sources });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Latest updates, scraped from the source homepage (the upstream API only
// supports frontpage for comick, which is currently blocked upstream).
const latestCache = new Map(); // source -> { data, at }
const LATEST_TTL = 2 * 60 * 1000;
let comickSourcesCache = null; // { list, at }
async function comickSourceBase(source) {
  if (!comickSourcesCache || Date.now() - comickSourcesCache.at > 3600 * 1000) {
    try {
      const data = await comickApi('/api/sources');
      comickSourcesCache = { list: data.sources || [], at: Date.now() };
    } catch {
      comickSourcesCache = { list: [], at: Date.now() };
    }
  }
  const hit = comickSourcesCache.list.find((s) => String(s.id).toLowerCase() === source);
  return hit ? hit.baseUrl : null;
}
app.get('/api/comick/latest', async (req, res) => {
  try {
    const source = String(req.query.source || 'mangaread').trim().toLowerCase();
    const enrich = req.query.enrich === '1';
    const key = `${source}:${enrich ? 'full' : 'base'}`;
    const hit = latestCache.get(key);
    if (hit && Date.now() - hit.at < LATEST_TTL) return res.json(hit.data);
    const base = (await comickSourceBase(source)) || 'https://www.mangaread.org';
    const html = await fetchHtml(base);
    const items = extractLatestWp(html, base);
    if (!items.length) throw new Error('Latest updates unavailable for this source');
    let data = { data: items.map((r) => ({ ...normResult(source, { ...r, coverImage: r.cover, latestChapter: 0 }), latestChapterLabel: r.latestChapter })) };
    // Enrichment attaches per-title genres/type for mature filtering and the
    // type rows. Capped + cached so repeat loads are instant.
    if (enrich) data = { data: await enrichItems(source, data.data.slice(0, 12)).then((m) => data.data.slice(0, 12).map((it) => ({ ...it, ...(m.get(it.id) || {}) }))) };
    latestCache.set(key, { data, at: Date.now() });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- Comix charts (comix.to homepage embeds its feeds as JSON) ----------
// comix.to is NOT WordPress so extractLatestWp can't read it — but the homepage
// ships <script id="initial-data"> with trending / most-followed / hot / recent
// feeds, so one fetch powers all four home rows. Chapter IMAGES live behind
// their private API, so comix titles expose details + first/latest chapter
// links (opened externally) rather than in-app reading.
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
  comixCache.data = data;
  comixCache.at = Date.now();
  return data;
}
app.get('/api/comix/home', async (req, res) => {
  try {
    res.json({ data: await fetchComixHome() });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Genre menu, scraped from the source homepage nav (?source=mangaread).
// Falls back to genres seen in cached titles, then a curated list.const genresCache = new Map(); // source -> { data, at }
const GENRES_TTL = 3600 * 1000;
const FALLBACK_GENRES = ['action', 'adventure', 'comedy', 'drama', 'fantasy', 'harem', 'historical', 'horror', 'isekai', 'martial-arts', 'mature', 'mecha', 'mystery', 'psychological', 'romance', 'school-life', 'sci-fi', 'seinen', 'shoujo', 'shounen', 'slice-of-life', 'sports', 'supernatural', 'tragedy'];
const prettySlug = (s) => s.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
app.get('/api/comick/genres', async (req, res) => {
  try {
    const source = String(req.query.source || 'mangaread').trim().toLowerCase();
    const hit = genresCache.get(source);
    if (hit && Date.now() - hit.at < GENRES_TTL) return res.json(hit.data);
    let list = [];
    try {
      const base = (await comickSourceBase(source)) || 'https://www.mangaread.org';
      const html = await fetchHtml(base);
      const seen = new Map();
      for (const m of html.matchAll(/<a[^>]+href=["']([^"']*\/genres\/([^/"']+)\/?)["'][^>]*>([^<]{1,30})<\/a>/gi)) {
        const slug = m[2].toLowerCase();
        const name = decodeEntities(m[3]).trim();
        if (name && !seen.has(slug) && !/^(completed|top|latest|chat)$/i.test(slug)) seen.set(slug, name);
      }
      list = [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    } catch {}
    if (!list.length) {
      const agg = new Map();
      for (const { data } of titleCache.values()) {
        for (const g of (data.genres || [])) {
          const slug = g.toLowerCase().replace(/\s+/g, '-');
          if (!agg.has(slug)) agg.set(slug, g);
        }
      }
      list = [...agg.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    }
    if (!list.length) list = FALLBACK_GENRES.map((id) => ({ id, name: prettySlug(id) }));
    const data = { data: list };
    genresCache.set(source, { data, at: Date.now() });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Titles in one genre (?source=mangaread&genre=action&page=1). Same card
// markup as the homepage, paginated upstream as …/page/N/.
const genreCache = new Map(); // key -> { data, at }
const GENRE_TTL = 2 * 60 * 1000;
app.get('/api/comick/genre', async (req, res) => {
  try {
    const source = String(req.query.source || 'mangaread').trim().toLowerCase();
    const genre = String(req.query.genre || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!genre) return res.status(400).json({ error: 'genre is required' });
    const page = Math.max(1, Math.min(50, parseInt(req.query.page || '1', 10) || 1));
    const enrich = req.query.enrich === '1';
    const key = `${source}:${genre}:${page}:${enrich ? 'full' : 'base'}`;
    const hit = genreCache.get(key);
    if (hit && Date.now() - hit.at < GENRE_TTL) return res.json(hit.data);
    const base = (await comickSourceBase(source)) || 'https://www.mangaread.org';
    const url = `${base.replace(/\/$/, '')}/genres/${genre}/${page > 1 ? `page/${page}/` : ''}`;
    const html = await fetchHtml(url);
    const items = extractLatestWp(html, url);
    if (!items.length) throw new Error('No titles in this genre on this source');
    let data = { data: items.map((r) => ({ ...normResult(source, { ...r, coverImage: r.cover, latestChapter: 0 }), latestChapterLabel: r.latestChapter })), page };
    // Enrichment attaches per-title status/type so filtered views (home
    // Updates) can filter client-side. Capped so one page can't stall.
    if (enrich) {
      const slice = data.data.slice(0, 15);
      data = { data: await enrichItems(source, slice).then((m) => slice.map((it) => ({ ...it, ...(m.get(it.id) || {}) }))), page };
    }
    genreCache.set(key, { data, at: Date.now() });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Attach cached-title details (genres/type/status) to normalized items.
// Best-effort: each item gets 15s, stragglers are skipped so one slow source
// page can never stall the whole batch.
async function enrichItems(source, items) {
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

// Resolve stored client IDs (library / Continue / popular) to display metadata.
app.post('/api/comick/resolve', async (req, res) => {
  try {
    const ids = Array.isArray(req.body && req.body.ids) ? [...new Set(req.body.ids)].slice(0, 30) : [];
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
    res.json({ data: out });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Title details for a client ID (cx:...). ?id=cx:mangaread:abc
app.get('/api/comick/title', async (req, res) => {
  try {
    const dec = cxDecode(req.query.id);
    if (!dec) return res.status(400).json({ error: 'id is required' });
    const t = await cachedTitle(dec.source, dec.url);
    res.json({ data: { id: req.query.id, source: dec.source, url: dec.url, ...t } });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Chapter list for a client ID.
app.get('/api/comick/chapters', async (req, res) => {
  try {
    const dec = cxDecode(req.query.id);
    if (!dec) return res.status(400).json({ error: 'id is required' });
    const chapters = await comickChapters(dec.source, dec.url);
    res.json({ data: chapters, total: chapters.length });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Page images for a chapter URL (?url=..&source=..), scraped directly.
app.get('/api/comick/pages', async (req, res) => {
  try {
    const url = String(req.query.url || '');
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url is required' });
    const hit = pagesCache.get(url);
    if (hit && Date.now() - hit.at < PAGES_TTL) return res.json({ data: hit.pages, cached: true });
    const html = await fetchHtml(url, req.query.ref || url);
    const pages = extractPages(html, url);
    if (!pages.length) return res.status(502).json({ error: 'No readable pages found for this chapter' });
    if (pagesCache.size > 300) pagesCache.delete(pagesCache.keys().next().value);
    pagesCache.set(url, { pages, at: Date.now() });
    res.json({ data: pages.map((src) => `/api/img?u=${encodeURIComponent(src)}&ref=${encodeURIComponent(url)}`) });
  } catch (e) {
    res.status(502).json({ error: e.message });
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

// Proxy for chapter/cover images. The browser only talks to our origin, so
// source-site referer/CORS restrictions never apply.
// client --[img src]--> /api/img?u=<full url>&ref=<page url>
// Responses are verified to be images and capped in size; a small in-memory
// byte cache makes re-opening a chapter instant.
const imgCache = new Map();
const IMG_CACHE_MAX = 400;
const IMG_MAX_BYTES = 20 * 1024 * 1024;
app.get('/api/img', async (req, res) => {
  const { u, ref } = req.query;
  if (!u || !/^https:\/\//i.test(u)) {
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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MyGhoulScans/2.0',
            Accept: 'image/*,*/*;q=0.8',
            ...(ref && /^https?:\/\//i.test(ref) ? { Referer: ref } : {}),
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
    const type = upstream.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) {
      return res.status(502).json({ error: 'Upstream did not return an image' });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > IMG_MAX_BYTES) {
      return res.status(502).json({ error: 'Image too large' });
    }
    if (imgCache.size >= IMG_CACHE_MAX) imgCache.delete(imgCache.keys().next().value);
    imgCache.set(u, { buf, type });
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', type);
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: 'Image fetch failed: ' + e.message });
  }
});

// SPA fallback: deep pretty URLs (/title/…, /reader/…/…) load the shell and
// the in-app router takes over from the path.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  if (/\/[^/]*\.[^/]*$/.test(req.path)) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`MyGhoulScans running at http://localhost:${PORT}`);
  if (!GOOGLE_CLIENT_ID) {
    console.log('Note: Google sign-in is disabled (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable).');
  }
});