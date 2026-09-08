# MyGhoulScans

Ad-free manhwa/manga/manhua reader powered by the [MangaDex](https://mangadex.org) public API.
Free to use, no ads, with accounts, a personal library, reading progress, and resume support.

## Features

- Browse trending titles and search the full MangaDex catalog (manhwa, manga, manhua)
- Status badges: Ongoing, Completed, Hiatus, Cancelled/Stopped
- Read chapters in a clean paged reader (arrow keys / buttons to change chapters)
- Accounts (email/password or Google) so your data follows you
- "My Library" — save titles and jump straight back to where you left off
- Reading progress is saved automatically and resume buttons appear on title pages
- 18+ toggle for mature content

## Requirements

- Node.js 22.5+ (built-in `node:sqlite`)

## Run

```bash
npm install
npm start
```

Then open http://localhost:3000

## Google sign-in (optional)

By default sign-in works with email/password. To also allow Google login:

1. Create an OAuth client at https://console.cloud.google.com/apis/credentials
2. Authorized redirect URI: `http://localhost:3000/api/auth/google/callback`
3. Set env vars when running:

```bash
set GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
set GOOGLE_CLIENT_SECRET=xxxx
node server.js
```

## Tests

```bash
node test-e2e.js
```

## How it works

- `server.js` – Express app, auth, library/progress API, and a thin proxy for the MangaDex API
- `db.js` – SQLite schema + queries (users, sessions, follows, progress)
- `public/` – single-page frontend (vanilla JS, no build step)

Content is streamed directly from MangaDex's public API/CDN. Data (users, library, progress)
is stored locally in `data/myghoulscans.db`.

## Deploy

GitHub Pages cannot host this app (it needs `node server.js` running). Two good free options:

**Fly.io (recommended free host)** — its free allowance covers one small VM plus a
persistent volume, so accounts and uploads survive restarts:

```bash
npm i -g flyctl
fly auth signup   # or: fly auth login
fly launch        # accept the defaults (Dockerfile is included)
fly volumes create mgs_data --size 1
```

then make sure `fly.toml` mounts it at `/app/data`:

```toml
[[mounts]]
  source = "mgs_data"
  destination = "/app/data"
```

```bash
fly deploy
fly secrets set COOKIE_SECURE=1   # HTTPS is automatic on Fly
```

**Render** — easiest clicks: New → Blueprint → point at this repo (`render.yaml`
is included). Heads-up: Render's free tier has an ephemeral filesystem, so user
data is wiped on every restart unless you add a paid disk. Fine for a demo;
use Fly.io (or a VPS) for real users.

Moving servers later: copy the `data/` folder over and everything
(accounts, libraries, progress, published Originals) comes along.