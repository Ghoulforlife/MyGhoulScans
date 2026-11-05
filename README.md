# MyGhoulScans

Ad-free manhwa/manga/manhua reader powered by the [comick-source-api](https://github.com/GooglyBlox/comick-source-api)
scraper API (search + chapter lists across 60+ scanlator/aggregator sources, with page images
scraped from source sites). Free to use, no ads, with accounts, a personal library, reading progress, and resume support.

## Features

- Pick a comic source (MangaRead, FlameComics, 60+ more) and search it, browse latest updates
- Browse by genre, plus Manga / Manhwa / Manhua rows
- Mature-content toggle (inferred from genre tags — sources don't label maturity)
- Status badges: Ongoing, Completed
- Read chapters in a clean paged reader (arrow keys / buttons to change chapters)
- Accounts (email/password or Google) so your data follows you
- "My Library" — save titles and jump straight back to where you left off
- Reading progress is saved automatically and resume buttons appear on title pages
- Continue Reading is sign-in-only: guests are never tracked

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

- `server.js` – Express app, auth, library/progress API, and a Comick adapter
  (upstream search/chapters proxy + direct title/page/latest scrapers)
- `db.js` – SQLite schema + queries (users, sessions, follows, progress)
- `public/` – single-page frontend (vanilla JS, no build step)

Set `COMICK_API_BASE` to a self-hosted copy of
[comick-source-api](https://github.com/GooglyBlox/comick-source-api) if the public
instance (`https://comick-source-api.notaspider.dev`) is slow or blocked.
Content is streamed from source sites through our `/api/img` proxy. Data (users, library, progress)
is stored locally in `data/myghoulscans.db`. Note: library/progress IDs from the old
MangaDex version (`uuid` style) no longer resolve and are skipped — re-bookmark titles
to get the new `cx:…` IDs.

## Deploy

### Publish your changes (repo root = this folder)

The GitHub repo `Ghoulforlife/MyGhoulScans` mirrors **this folder** (`Website/myghoulscans/`
locally — not its parent, not `imporved/`). From a terminal inside this folder:

```bash
git init -b main
git add -A
git commit -m "MyGhoulScans on Comick sources"
git remote add origin https://github.com/Ghoulforlife/MyGhoulScans.git
git push -u origin main
```

(`data/`, `node_modules/` and `.env` are gitignored — user accounts never get pushed.
First push may need `git pull --rebase origin main` if the repo has commits.)
Render and Cloudflare both redeploy automatically on `git push`.

### Full app (Node server)

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

## Static build (GitHub Pages, no server)

The full app above needs Node running. For a free server-less mirror, the
frontend is rebuilt as one file and the API moves to a Cloudflare Worker:

```bash
# 1. Worker API (free tier) — needs a D1 database bound as DB:
npx wrangler login
npx wrangler d1 create myghoulscans
# paste the database_id into worker/wrangler.toml, then run worker/schema.sql
# once on that database (Cloudflare dashboard → D1 → Console), then:
npx wrangler deploy

# 2. Static frontend (repo root index.html — this is what Pages serves):
node scripts/build-standalone.mjs https://<your-worker>.workers.dev
node scripts/test-worker.mjs https://<your-worker>.workers.dev
git add -A && git commit -m "static build" && git push
```

`npm run build:static` uses the default worker URL already baked in. The static
build keeps accounts, library, progress, comments and recs (stored in D1).
Not supported there: Originals publishing, custom profile pictures and Google
sign-in (all need the full server — the UI hides or explains this).