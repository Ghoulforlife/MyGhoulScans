-- MyGhoulScans static accounts (Cloudflare D1).
-- Run once: D1 console for your database, paste this whole file, execute.
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT UNIQUE,
  password     TEXT,
  display_name TEXT,
  avatar       TEXT,
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
