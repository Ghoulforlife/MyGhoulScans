-- MyGhoulScans static accounts (Cloudflare D1).
-- Run once: D1 console for your database, paste this whole file, execute.
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT UNIQUE,
  password     TEXT,
  display_name TEXT,
  avatar       TEXT,
  rp           INTEGER NOT NULL DEFAULT 0,
  name_color   TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL DEFAULT '',
  frame        TEXT NOT NULL DEFAULT '',
  theme        TEXT NOT NULL DEFAULT '',
  owned        TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_display ON users(display_name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS follows (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manga_id  TEXT NOT NULL,
  added_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, manga_id)
);

CREATE TABLE IF NOT EXISTS progress (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manga_id      TEXT NOT NULL,
  chapter_id    TEXT NOT NULL,
  page          INTEGER NOT NULL DEFAULT 0,
  chapter_label TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, manga_id)
);

-- Chapter read counters + popularity (user_id NULL = guest read)
CREATE TABLE IF NOT EXISTS reads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  manga_id   TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  user_id    INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reads_chapter ON reads(chapter_id);
CREATE INDEX IF NOT EXISTS idx_reads_manga ON reads(manga_id);

-- Chapter comments (+ likes/dislikes, auto-pin/block thresholds in worker.js)
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

-- Reader-curated recommendations
CREATE TABLE IF NOT EXISTS recs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  manga_id     TEXT NOT NULL,
  rec_manga_id TEXT NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (manga_id, rec_manga_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_recs_manga ON recs(manga_id);
