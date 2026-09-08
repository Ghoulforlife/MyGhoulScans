// MyGhoulScans - database layer using Node's built-in sqlite
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new DatabaseSync(path.join(DATA_DIR, 'myghoulscans.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT UNIQUE,
    password     TEXT,
    google_sub   TEXT UNIQUE,
    display_name TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token    TEXT PRIMARY KEY,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS follows (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    manga_id  TEXT NOT NULL,
    added_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, manga_id)
  );

  CREATE TABLE IF NOT EXISTS progress (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    manga_id   TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    page       INTEGER NOT NULL DEFAULT 0,
    chapter_label TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, manga_id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id   TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    pinned     INTEGER NOT NULL DEFAULT 0,
    blocked    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_comments_chapter ON comments(chapter_id, blocked, created_at);

  CREATE TABLE IF NOT EXISTS comment_votes (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    vote       INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, comment_id)
  );

  CREATE TABLE IF NOT EXISTS recs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id     TEXT NOT NULL,
    rec_manga_id TEXT NOT NULL,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (manga_id, rec_manga_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_recs_manga ON recs(manga_id);

  CREATE TABLE IF NOT EXISTS reads (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id   TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    user_id    INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_reads_chapter ON reads(chapter_id);
  CREATE INDEX IF NOT EXISTS idx_reads_manga ON reads(manga_id);

  CREATE TABLE IF NOT EXISTS originals_series (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cover       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS originals_chapters (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    series_id  INTEGER NOT NULL REFERENCES originals_series(id) ON DELETE CASCADE,
    num        TEXT NOT NULL DEFAULT '',
    title      TEXT NOT NULL DEFAULT '',
    pages      INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_orig_ch_series ON originals_chapters(series_id);
`);

// Column added later (reader stores chapter label for the "continue reading" home section)
try {
  db.exec('ALTER TABLE progress ADD COLUMN chapter_label TEXT');
} catch {}

// Column added later (custom profile pictures; NULL = generated initial avatar)
try {
  db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
} catch {}

// Unique usernames (case-insensitive). Rename pre-existing dupes first so the
// index build can never fail on old databases.
try {
  const rows = db.prepare('SELECT id, display_name FROM users WHERE display_name IS NOT NULL ORDER BY id').all();
  const seen = new Map();
  for (const r of rows) {
    const k = String(r.display_name).toLowerCase();
    if (!seen.has(k)) { seen.set(k, r.id); continue; }
    let n = 2, cand;
    do { cand = `${String(r.display_name).slice(0, 20)}${n++}`; } while (seen.has(cand.toLowerCase()));
    seen.set(cand.toLowerCase(), r.id);
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(cand, r.id);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display ON users(display_name COLLATE NOCASE)');
} catch {}

// ---------- Users ----------
function createUser({ email, password, googleSub, displayName }) {
  const stmt = db.prepare(`
    INSERT INTO users (email, password, google_sub, display_name)
    VALUES (?, ?, ?, ?)
  `);
  const res = stmt.run(email, password || null, googleSub || null, displayName || email || null);
  return res.lastInsertRowid;
}

function findByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function findByGoogleSub(sub) {
  return db.prepare('SELECT * FROM users WHERE google_sub = ?').get(sub);
}

function findByDisplayName(name) {
  return db.prepare('SELECT * FROM users WHERE display_name = ? COLLATE NOCASE').get(name);
}

// Free username derived from base ("Name" -> "Name2" ...) for OAuth signups
function uniqueDisplayName(base) {
  let cand = String(base || '').trim().slice(0, 24) || 'Reader';
  if (!findByDisplayName(cand)) return cand;
  for (let n = 2; n < 1000; n++) {
    const t = `${cand.slice(0, 22)}${n}`;
    if (!findByDisplayName(t)) return t;
  }
  return `${cand.slice(0, 18)}${Date.now().toString(36)}`;
}

function linkGoogle(userId, googleSub) {
  db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(googleSub, userId);
}

function findById(id) {
  return db.prepare('SELECT id, email, display_name, google_sub, avatar, created_at FROM users WHERE id = ?').get(id);
}

// ---------- Account settings ----------
function setAvatar(userId, avatar) {
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, userId);
}

function updateDisplayName(userId, name) {
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, userId);
}

function displayNameTaken(name, exceptId) {
  return !!db.prepare('SELECT 1 FROM users WHERE display_name = ? COLLATE NOCASE AND id != ?').get(name, exceptId);
}

function updatePassword(userId, hash) {
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, userId);
}

function userStats(userId) {
  const library = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE user_id = ?').get(userId).n;
  const chapters = db.prepare('SELECT COUNT(*) AS n FROM reads WHERE user_id = ?').get(userId).n;
  const comments = db.prepare('SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND blocked = 0').get(userId).n;
  const published = db.prepare('SELECT COUNT(*) AS n FROM originals_series WHERE user_id = ?').get(userId).n;
  return { library, chapters, comments, published };
}

function ownedOriginalSeries(userId) {
  return db.prepare('SELECT id FROM originals_series WHERE user_id = ?').all(userId).map((r) => r.id);
}

// Full wipe: sessions/follows/progress/comments/votes/recs/reads/originals rows
// cascade away with the user; reads has no FK so it is cleared by hand.
// Uploaded files (avatar, originals) are removed by the caller afterwards.
function deleteUserAccount(userId) {
  db.prepare('DELETE FROM reads WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

// ---------- Sessions ----------
function createSession(userId) {
  const token = require('node:crypto').randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, expires };
}

function findSession(token) {
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s) return null;
  if (new Date(s.expires) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return s;
}

function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function clearOtherSessions(userId, keepToken) {
  if (keepToken) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, keepToken);
  else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

// ---------- Follows ----------
function addFollow(userId, mangaId) {
  db.prepare('INSERT OR IGNORE INTO follows (user_id, manga_id) VALUES (?, ?)').run(userId, mangaId);
}

function removeFollow(userId, mangaId) {
  db.prepare('DELETE FROM follows WHERE user_id = ? AND manga_id = ?').run(userId, mangaId);
}

function listFollows(userId) {
  return db.prepare('SELECT manga_id FROM follows WHERE user_id = ? ORDER BY added_at DESC').all(userId);
}

function isFollowed(userId, mangaId) {
  return !!db.prepare('SELECT 1 FROM follows WHERE user_id = ? AND manga_id = ?').get(userId, mangaId);
}

// ---------- Progress ----------
function saveProgress(userId, mangaId, chapterId, page, chapterLabel) {
  db.prepare(`
    INSERT INTO progress (user_id, manga_id, chapter_id, page, chapter_label, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, manga_id) DO UPDATE SET
      chapter_id = excluded.chapter_id,
      page = excluded.page,
      chapter_label = excluded.chapter_label,
      updated_at = datetime('now')
  `).run(userId, mangaId, chapterId, page, chapterLabel || null);
}

function getProgress(userId, mangaId) {
  return db.prepare('SELECT chapter_id, page, chapter_label FROM progress WHERE user_id = ? AND manga_id = ?').get(userId, mangaId);
}

function listProgress(userId) {
  return db.prepare('SELECT manga_id, chapter_id, page, chapter_label FROM progress WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
}

// ---------- Comments ----------
const COMMENTS_BLOCK_AT = 5;  // dislikes before a comment is blocked (hidden)
const COMMENTS_PIN_AT = 10;   // likes before a comment is auto-pinned

function addComment(mangaId, chapterId, userId, body) {
  const res = db.prepare('INSERT INTO comments (manga_id, chapter_id, user_id, body) VALUES (?, ?, ?, ?)')
    .run(mangaId, chapterId, userId, body);
  return Number(res.lastInsertRowid);
}

function getComment(id) {
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
}

function deleteComment(id) {
  db.prepare('DELETE FROM comments WHERE id = ?').run(id);
}

function listComments(chapterId, userId) {
  return db.prepare(`
    SELECT c.id, c.manga_id, c.chapter_id, c.body, c.pinned, c.created_at,
           u.display_name,
           (SELECT COUNT(*) FROM comment_votes v WHERE v.comment_id = c.id AND v.vote = 1)   AS likes,
           (SELECT COUNT(*) FROM comment_votes v WHERE v.comment_id = c.id AND v.vote = -1)  AS dislikes,
           (SELECT v.vote FROM comment_votes v WHERE v.comment_id = c.id AND v.user_id = ?)  AS my_vote
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.chapter_id = ? AND c.blocked = 0
    ORDER BY c.pinned DESC, likes DESC, c.created_at DESC
  `).all(userId || null, chapterId);
}

function listCommentsBlockedCount(chapterId) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM comments WHERE chapter_id = ? AND blocked = 1').get(chapterId);
  return row.n;
}

function castVote(userId, commentId, vote) {
  const existing = db.prepare('SELECT * FROM comment_votes WHERE user_id = ? AND comment_id = ?').get(userId, commentId);
  if (existing && existing.vote === vote) {
    db.prepare('DELETE FROM comment_votes WHERE user_id = ? AND comment_id = ?').run(userId, commentId);
  } else {
    db.prepare(`
      INSERT INTO comment_votes (user_id, comment_id, vote, created_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, comment_id) DO UPDATE SET vote = excluded.vote
    `).run(userId, commentId, vote);
  }
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM comment_votes v WHERE v.comment_id = ? AND v.vote = 1)  AS likes,
      (SELECT COUNT(*) FROM comment_votes v WHERE v.comment_id = ? AND v.vote = -1) AS dislikes
  `).get(commentId, commentId);
  const likes = counts.likes || 0;
  const dislikes = counts.dislikes || 0;
  if (dislikes >= COMMENTS_BLOCK_AT) {
    db.prepare('UPDATE comments SET blocked = 1 WHERE id = ?').run(commentId);
  } else if (likes >= COMMENTS_PIN_AT) {
    db.prepare('UPDATE comments SET pinned = 1 WHERE id = ?').run(commentId);
  }
  const myVote = db.prepare('SELECT vote FROM comment_votes WHERE user_id = ? AND comment_id = ?').get(userId, commentId);
  return {
    likes,
    dislikes,
    myVote: myVote ? myVote.vote : 0,
    pinned: !!db.prepare('SELECT pinned FROM comments WHERE id = ?').get(commentId).pinned,
    blocked: !!db.prepare('SELECT blocked FROM comments WHERE id = ?').get(commentId).blocked,
  };
}

// ---------- Chapter reads ----------
function addRead(mangaId, chapterId, userId) {
  db.prepare('INSERT INTO reads (manga_id, chapter_id, user_id) VALUES (?, ?, ?)').run(mangaId, chapterId, userId || null);
}

function chapterReadCounts(mangaId) {
  const rows = db.prepare('SELECT chapter_id, COUNT(*) AS n FROM reads WHERE manga_id = ? GROUP BY chapter_id').all(mangaId);
  const counts = {};
  for (const r of rows) counts[r.chapter_id] = r.n;
  return counts;
}

function popularMangas(limit) {
  return db.prepare('SELECT manga_id AS id, COUNT(*) AS n FROM reads GROUP BY manga_id ORDER BY n DESC LIMIT ?').all(limit);
}

// ---------- Recommendations ----------
function addRec(mangaId, recMangaId, userId) {
  db.prepare('INSERT OR IGNORE INTO recs (manga_id, rec_manga_id, user_id) VALUES (?, ?, ?)').run(mangaId, recMangaId, userId);
}
function removeRec(mangaId, recMangaId, userId) {
  db.prepare('DELETE FROM recs WHERE manga_id = ? AND rec_manga_id = ? AND user_id = ?').run(mangaId, recMangaId, userId);
}
function listRecs(mangaId, userId) {
  return db.prepare(`
    SELECT rec_manga_id,
           (SELECT COUNT(*) FROM recs r2 WHERE r2.manga_id = r.manga_id AND r2.rec_manga_id = r.rec_manga_id) AS count
    FROM recs r
    WHERE r.manga_id = ?
    GROUP BY rec_manga_id
    ORDER BY count DESC
  `).all(mangaId).map((row) => ({
    id: row.rec_manga_id,
    count: row.count,
    mine: !!userId && !!db.prepare('SELECT 1 FROM recs WHERE manga_id = ? AND rec_manga_id = ? AND user_id = ?')
      .get(mangaId, row.rec_manga_id, userId),
  }));
}
function listUserReadHistory(userId) {
  const followed = db.prepare('SELECT manga_id FROM follows WHERE user_id = ?').all(userId).map((r) => r.manga_id);
  const read = db.prepare('SELECT DISTINCT manga_id FROM progress WHERE user_id = ?').all(userId).map((r) => r.manga_id);
  return [...new Set([...read, ...followed])];
}

// ---------- Creator Originals ----------
function createOriginalSeries(userId, title, description, cover) {
  const res = db.prepare(`
    INSERT INTO originals_series (user_id, title, description, cover)
    VALUES (?, ?, ?, ?)
  `).run(userId, title, description || '', cover || null);
  return Number(res.lastInsertRowid);
}

function getOriginalSeries(id) {
  return db.prepare(`
    SELECT s.*, u.display_name AS author,
           (SELECT COUNT(*) FROM originals_chapters c WHERE c.series_id = s.id) AS chapters,
           (SELECT MAX(c.created_at) FROM originals_chapters c WHERE c.series_id = s.id) AS last_update
    FROM originals_series s JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `).get(id);
}

function listOriginalSeries({ q = '', limit = 60 } = {}) {
  const like = `%${q}%`;
  return db.prepare(`
    SELECT s.*, u.display_name AS author,
           (SELECT COUNT(*) FROM originals_chapters c WHERE c.series_id = s.id) AS chapters,
           (SELECT MAX(c.created_at) FROM originals_chapters c WHERE c.series_id = s.id) AS last_update
    FROM originals_series s JOIN users u ON u.id = s.user_id
    WHERE (? = '' OR s.title LIKE ? OR s.description LIKE ?)
    ORDER BY COALESCE(last_update, s.created_at) DESC
    LIMIT ?
  `).all(q, like, like, limit);
}

function createOriginalChapter(seriesId, num, title, pages) {
  const res = db.prepare(`
    INSERT INTO originals_chapters (series_id, num, title, pages)
    VALUES (?, ?, ?, ?)
  `).run(seriesId, num || '', title || '', pages);
  db.prepare(`UPDATE originals_series SET updated_at = datetime('now') WHERE id = ?`).run(seriesId);
  return Number(res.lastInsertRowid);
}

function listOriginalChapters(seriesId) {
  return db.prepare(`
    SELECT * FROM originals_chapters WHERE series_id = ? ORDER BY id ASC
  `).all(seriesId);
}

function getOriginalChapter(id) {
  return db.prepare(`SELECT * FROM originals_chapters WHERE id = ?`).get(id);
}

function setOriginalCover(id, cover) {
  db.prepare(`UPDATE originals_series SET cover = ? WHERE id = ?`).run(cover, id);
}

module.exports = {
  createUser,
  findByEmail,
  findByDisplayName,
  uniqueDisplayName,
  findByGoogleSub,
  linkGoogle,
  findById,
  setAvatar,
  updateDisplayName,
  displayNameTaken,
  updatePassword,
  userStats,
  ownedOriginalSeries,
  deleteUserAccount,
  createSession,
  findSession,
  deleteSession,
  clearOtherSessions,
  addFollow,
  removeFollow,
  listFollows,
  isFollowed,
  saveProgress,
  getProgress,
  listProgress,
  addComment,
  getComment,
  deleteComment,
  listComments,
  listCommentsBlockedCount,
  castVote,
  addRec,
  removeRec,
  listRecs,
  listUserReadHistory,
  addRead,
  chapterReadCounts,
  popularMangas,
  createOriginalSeries,
  getOriginalSeries,
  listOriginalSeries,
  createOriginalChapter,
  listOriginalChapters,
  getOriginalChapter,
  setOriginalCover,
  COMMENTS_BLOCK_AT,
  COMMENTS_PIN_AT,
};