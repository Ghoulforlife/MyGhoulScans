// ===== MyGhoulScans frontend =====
const $ = (sel) => document.querySelector(sel);
const view = $('#view');
let currentUser = null;
let authSeq = 0;

// ---------- utilities ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    refreshAuth();
    const e = new Error('not-authed');
    e.status = 401;
    throw e;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const e = new Error(body.error || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

function toast(msg) {
  let t = $('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Titles sometimes arrive with credit boilerplate + raw URLs in the synopsis
// ("**Original Webtoon:** [KakaoPage] (https://…), [Daum] (https://…)").
// Show just the story text — no links, no URLs (server cleans too; this
// covers cached/snapshot responses).
function cleanDesc(s) {
  let t = String(s ?? '');
  t = t.replace(/\[([^\]]{1,120})\]\((https?:[^)\s]{1,500})\)/gi, '$1');
  t = t.replace(/https?:\/\/[^\s)'"]+/gi, '');
  t = t.replace(/\*\*/g, '');
  t = t.replace(/\[(KakaoPage|Daum|Kakao Webtoon|Webtoon|Original Webtoon)[^\]]*\]/gi, '');
  t = t.replace(/\(\s*\)/g, '');
  t = t.replace(/"?\*{0,2}"?Original Webtoon"?:?\*{0,2}"?\s*,?/gi, '');
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/\s+([,.!?;:])/g, '$1').trim();
  t = t.replace(/,\s*,/g, ',').replace(/\(\s*,/, '(').replace(/,\s*\)/, ')').replace(/\(\s*\)/g, '').trim();
  return t.slice(0, 1500);
}

const MUTE = { ongoing: 'ongoing', completed: 'completed', hiatus: 'hiatus', cancelled: 'stopped' };

function statusBadge(status) {
  const s = (status || 'ongoing').toLowerCase();
  const label = MUTE[s] || s;
  return `<span class="badge ${s}">${esc(label)}</span>`;
}

function titleOf(data) {
  return (data && data.title) || 'Untitled';
}

function coverUrl(data) {
  return (data && data.cover) || '';
}

// Covers live on source CDNs (hotlink protection varies), so route them
// through our image proxy like chapter pages.
function proxiedCover(data) {
  const c = coverUrl(data);
  return c ? `/api/img?u=${encodeURIComponent(c)}` : '';
}

function latestLabelOf(data) {
  if (!data) return '';
  if (data.latestChapterLabel) return String(data.latestChapterLabel).replace(/^chapter\s+/i, '');
  if (data.latestChapter) return String(data.latestChapter);
  return '';
}

// Profile picture: data-URL (static build), uploaded file, or a generated
// initial icon (unique hue per user)
function avatarUrl(u) {
  if (!u) return '/assets/chibi.png';
  if (u.avatar) return u.avatar.startsWith('data:') ? u.avatar : `/uploads/${u.avatar}`;
  return `/api/avatar/${u.id}.svg`;
}
// Shop cosmetics presentation helpers (values are server-validated).
function avatarFrameClass(u) {
  const f = u && u.frame ? String(u.frame).replace(/[^a-z-]/g, '') : '';
  return f ? ` av-frame-${f}` : '';
}
// Fancy frames need decoration OUTSIDE the image circle (gems, sparkles),
// which <img> can't render itself — those ride on a wrapper span.
const WRAP_FRAMES = new Set(['ribbon', 'crest-silver', 'crest-gold', 'crest-mythic']);
function wrapAvatarFrame(inner, frame) {
  const f = frame ? String(frame) : '';
  if (!f || !WRAP_FRAMES.has(f)) return inner;
  return `<span class="avw avw-${f}">${inner}</span>`;
}
const TITLE_FX = { Critic: 'critic', Veteran: 'veteran', Legend: 'legend' };
function titleBadgeHtml(t) {
  if (!t) return '';
  const fx = TITLE_FX[String(t)] || '';
  return ` <span class="ctitle${fx ? ' fx-' + fx : ''}">${esc(t)}</span>`;
}
function styledNameHtml(u, fallback) {
  return nameColorHtml((u && (u.display_name || u.email)) || fallback || 'Reader', u && u.name_color);
}
// Username color: solid hex, animated rainbow, or a shop gradient blend.
// Only linear-gradient() values from the server catalog ever take the
// gradient path — anything else renders as plain (safe) text.
function nameColorHtml(name, color) {
  const n = esc(name);
  const c = color ? String(color) : '';
  if (!c) return n;
  if (c === 'rainbow') return `<span class="name-rainbow">${n}</span>`;
  if (c.startsWith('linear-gradient(')) return `<span class="name-grad" style="background-image:${esc(c)}">${n}</span>`;
  return `<span style="color:${esc(c)}">${n}</span>`;
}
const THEME_NAMES = { 'crimson-night': 'Crimson Night', 'deep-ocean': 'Deep Ocean', 'forest-night': 'Forest Night', 'sunset-ember': 'Ember Sunset', 'royal-violet': 'Royal Violet' };

function mangaCard(data, opts = {}) {
  const img = proxiedCover(data);
  const status = data.status || '';
  const bookmarked = localBookmarks().has(data.id);
  const lbl = latestLabelOf(data);
  return `
    <div class="manga-card ${opts.h ? 'h' : ''}" data-id="${esc(data.id)}">
      ${img ? `<img class="cover" loading="lazy" referrerpolicy="no-referrer" src="${img}" alt="" />` : '<div class="cover"></div>'}
      ${data._new ? '<span class="new-badge">NEW</span>' : ''}
      ${opts.rank ? `<span class="rank-badge${opts.rank <= 3 ? ' top' : ''}">${opts.rank}</span>` : ''}
      <button class="bmark ${bookmarked ? 'on' : ''}" data-id="${esc(data.id)}" data-bmark="${bookmarked ? '1' : '0'}" title="${bookmarked ? 'Bookmarked' : 'Bookmark this comic'}">${bookmarked ? '&#128278;' : '&#128279;'}</button>
      <div class="meta">
        <div class="title">${esc(titleOf(data))}</div>
        <div class="sub">${status ? statusBadge(status) : ''}<span>${esc(data.source || '')}</span></div>
        ${lbl ? `<div class="chapters">Ch. ${esc(lbl)}${data.latestChapterDate ? ` &middot; ${esc(timeAgo(data.latestChapterDate))}` : ''}</div>` : ''}
      </div>
    </div>`;
}

function spinner(n = 1) { return '<div class="spinner"></div>'.repeat(n); }

// ---------- auth ----------
function paintAuthArea() {
  const a = $('#authArea');
  if (!a) return;
  const short = window.innerWidth <= 640;
  a.innerHTML = currentUser
    ? `<a href="#/account" title="Account settings" aria-label="Account settings">${wrapAvatarFrame(`<img class="avatar${avatarFrameClass(currentUser)}" src="${avatarUrl(currentUser)}" alt="" />`, currentUser.frame)}</a>`
    : `<button class="btn" id="loginBtn">${short ? 'Log in' : 'Log in / Sign up'}</button>`;
  a.querySelector('#loginBtn')?.addEventListener('click', () => openAuthModal(false));
}
async function refreshAuth() {
  // Generation guard: a slow check fired BEFORE a logout must never apply
  // AFTER it (that resurrects the session with a stale valid response).
  const mySeq = ++authSeq;
  const wasOut = !currentUser;
  try {
    let opt = {};
    try { opt = { signal: AbortSignal.timeout(12000) }; } catch {}
    const r = await fetch('/api/auth/me', opt);
    currentUser = (await r.json()).user;
  } catch { currentUser = null; }
  if (mySeq !== authSeq) return; // superseded (logout or newer check won)
  // Fresh login only: restore the shop theme saved on the account.
  if (currentUser && wasOut && currentUser.theme && THEME_NAMES[currentUser.theme]) {
    try {
      const p = loadPrefs();
      if (p.mode !== currentUser.theme) savePrefs({ ...p, mode: currentUser.theme });
    } catch {}
    applyTheme();
  }
  paintAuthArea();
}

// ---------- reader points ----------
// RP balance rides on currentUser (server-backed). Shown signed-in only:
// refresh every balance chip on the page without a full re-render.
async function refreshRpChips() {
  await refreshAuth();
  const rp = currentUser && currentUser.rp ? currentUser.rp : 0;
  document.querySelectorAll('[data-rp-balance]').forEach((el) => {
    el.hidden = !currentUser;
    el.innerHTML = `&#129689; <b>${Number(rp).toLocaleString()}</b>&nbsp;RP`;
  });
  document.querySelectorAll('[data-rp-num]').forEach((el) => { el.textContent = Number(rp).toLocaleString(); });
}

async function doLogout() {
  // Everything local dies FIRST (instant UI, works offline): the user, the
  // token, device reading data AND device preferences (theme included). The
  // account's own copy — library, progress, RP, cosmetics — stays safe on
  // the server and restores on next login.
  authSeq++; // invalidate any in-flight auth check so it can't resurrect us
  try { localStorage.setItem('mgs_logout_at', String(Date.now())); } catch {}
  currentUser = null;
  // Static build sessions live in localStorage (setToken only exists there).
  if (typeof setToken === 'function') { try { setToken(null); } catch {} }
  try {
    localStorage.removeItem(BM_KEY);
    localStorage.removeItem(LOCAL_PROG_KEY);
  } catch {}
  try {
    savePrefs({ ...DEFAULT_PREFS, sections: { ...DEFAULT_PREFS.sections }, reader: { ...DEFAULT_READER } });
  } catch {}
  applyTheme();
  paintAuthArea();
  // Best-effort: also kill the server session so the token can't be reused.
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
  toast('Logged out — local reading data cleared');
  route();
}

function openAuthModal(signup = false) {
  $('#modal').classList.remove('hidden');
  $('#modalContent').innerHTML = `
    <img class="auth-logo" src="/assets/chibi.png" alt="MyGhoulScans" />
    <h2>${signup ? 'Create account' : 'Welcome back'}</h2>
    <div class="field"><label>Email</label><input id="authEmail" type="email" placeholder="you@example.com" /></div>
    <div class="field"><label>Password</label><input id="authPass" type="password" placeholder="${signup ? 'At least 6 characters' : 'Your password'}" /></div>
    ${signup ? `<div class="field"><label>Display name (optional, unique)</label><input id="authName" type="text" maxlength="24" placeholder="Ghoul — 2–24 characters" /></div>` : ''}
    <button class="btn primary" id="authSubmit" style="width:100%">${signup ? 'Sign up' : 'Log in'}</button>
    <div class="error" id="authError"></div>
    <div class="goog-opt"><a id="googleBtn">Continue with Google</a></div>
    <div class="auth-switch">${signup ? 'Already have an account?' : 'New here?'} <a id="authSwitch">${signup ? 'Log in' : 'Sign up'}</a></div>
  `;
  const submit = async () => {
    const email = $('#authEmail').value.trim();
    const password = $('#authPass').value;
    const name = $('#authName')?.value.trim();
    const errEl = $('#authError');
    errEl.textContent = '';
    const t0 = Date.now();
    try {
      await api(signup ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(signup ? { email, password, displayName: name } : { email, password }),
      });
      closeModal();
      refreshAuth();
      toast(signup ? 'Account created!' : 'Logged in!');
      route();
      // A logout fired while this request was in flight wins: discard the
      // just-issued session instead of resurrecting it.
      try {
        if ((+localStorage.getItem('mgs_logout_at') || 0) > t0) await doLogout();
      } catch {}
    } catch (e) {
      errEl.textContent = e.message;
    }
  };
  $('#authSubmit').addEventListener('click', submit);
  $('#authPass').addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  $('#authSwitch').addEventListener('click', () => openAuthModal(!signup));
  $('#googleBtn').addEventListener('click', () => {
    window.location.href = '/api/auth/google';
  });
  $('#authEmail').focus();
}

function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modalContent').innerHTML = '';
}

$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

// ---------- routing (pretty URLs + legacy hash support) ----------
// Canonical addresses are path-based (/title/…, /reader/…/…) so crawlers,
// shares and bookmarks see real pages. In-app code still navigates with
// location.hash = '#/…' — the hashchange handler below canonicalizes each
// of those into a pretty URL, so every navigation lands on (and stays on)
// a shareable address. Old bookmarked #/ links keep working: on load they
// are converted the same way.
const SITE_BASE = (() => {
  try {
    if (location.hostname.endsWith('github.io')) {
      const seg = location.pathname.split('/')[1];
      return seg ? '/' + seg : '';
    }
  } catch {}
  return '';
})();
function prettyFor(hash) {
  const m = String(hash || '').match(/^#\/?(.*)$/);
  return SITE_BASE + '/' + (m ? m[1] : '');
}
function parseLocation() {
  let path = '';
  try { path = location.pathname || ''; } catch {}
  if (SITE_BASE && path.toLowerCase().startsWith(SITE_BASE.toLowerCase())) path = path.slice(SITE_BASE.length);
  const parts = path.split('/').filter((s) => s.length).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  return { page: parts[0] || 'home', parts };
}
function goPrettyCurrentHash() {
  // Turn a '#/...' navigation into its pretty URL (best-effort: sandboxed
  // frames and file:// can refuse replaceState — then the hash just stays).
  try {
    const h = location.hash;
    if (h && h.startsWith('#/')) history.replaceState(null, '', prettyFor(h));
  } catch {}
}

// Title-page hash for either source: Comick "cx:…" IDs and "orig:<id>" originals
// (kept as the in-app navigation form; canonicalized to pretty on arrival)
function titleHash(id) {
  const s = String(id);
  return s.startsWith('orig:') ? `#/original/${s.slice(5)}` : `#/title/${s}`;
}

const ROUTE_TITLES = {
  search: 'Search', genre: 'Browse', library: 'My Library',
  popular: 'Top 10 — most read', leaderboard: 'Leaderboard — top readers', originals: 'Originals', account: 'Account settings',
  shop: 'RP Shop',
};
function updateRouteMeta(page, title, desc) {
  const base = 'MyGhoulScans';
  document.title = title || (ROUTE_TITLES[page] ? `${ROUTE_TITLES[page]} — ${base}` : `${base} — Read Manga, Manhwa & Manhua Free`);
  try {
    const canon = document.querySelector('link[rel="canonical"]');
    if (canon) canon.href = location.origin + location.pathname;
    if (desc) {
      const md = document.querySelector('meta[name="description"]');
      if (md) md.setAttribute('content', desc);
    }
  } catch {}
}

function route() {
  goPrettyCurrentHash();
  const { page, parts } = parseLocation();
  document.body.classList.toggle('reader-mode', page === 'reader');
  updateRouteMeta(page);
  if (page === '' || page === 'home') return renderHome();
  if (page === 'search') return renderSearch(parts[1] || '');
  if (page === 'genre') return renderGenre(parts[1] || '');
  if (page === 'title') return renderTitle(parts[1]);
  if (page === 'reader') return renderReader(parts[1], parts[2], parseInt(parts[3], 10) || 0);
  if (page === 'library') return renderLibrary();
  if (page === 'popular') return renderPopular();
  if (page === 'leaderboard') return renderLeaderboard();
  if (page === 'originals') return renderOriginals();
  if (page === 'original') return renderOriginalSeries(parts[1]);
  if (page === 'shop') return renderShop();
  if (page === 'account') return renderAccount();
  renderHome();
}

window.addEventListener('hashchange', route);
window.addEventListener('popstate', route);

// Back/forward cache can resurrect a stale signed-in DOM (including a dead
// session) — revalidate instead of trusting the restored heap.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) { refreshAuth(); route(); }
});

// Cross-tab auth sync (localStorage is shared across tabs): a login or
// logout in any tab follows through in every open tab instead of tabs
// resurrecting each other's stale sessions.
window.addEventListener('storage', (e) => {
  if (e.key !== 'mgs_token') return;
  if (e.newValue) { refreshAuth(); route(); }
  else if (currentUser) { doLogout(); }
});

// ---------- mobile auto-hide topbar on scroll ----------
(() => {
  const topbar = $('#topbar');
  const mq = window.matchMedia('(max-width: 640px)');
  let ticking = false;
  let lastY = window.scrollY;
  const update = () => {
    ticking = false;
    const y = window.scrollY;
    const dy = y - lastY;
    lastY = y;
    if (!mq.matches) { topbar.classList.remove('hidden-up'); return; }
    if (y > 90 && dy > 6) topbar.classList.add('hidden-up');
    else if (dy < -6 || y <= 90) topbar.classList.remove('hidden-up');
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  window.addEventListener('hashchange', () => {
    topbar.classList.remove('hidden-up');
    lastY = window.scrollY;
  });
})();

// ---------- settings (persisted) ----------
const DEFAULT_READER = {
  mode: 'scroll', direction: 'right', progress: false, noMargin: false,
  clickScroll: false, smoothScroll: true, noLazy: false, autoHide: true, wakeLock: false,
  fullscreen: false,
};
function readerPrefs() { const p = loadPrefs(); return { ...DEFAULT_READER, ...(p.reader || {}) }; }
const DEFAULT_PREFS = {
  mode: 'dark',
  mature: false,
  reader: { ...DEFAULT_READER },
  sections: { latest: true, popular: true, charts: true },
};
const PREFS_KEY = 'mgs_settings';

function loadPrefs() {
  const base = { ...DEFAULT_PREFS, sections: { ...DEFAULT_PREFS.sections } };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (saved) {
      // Legacy 'source' pref (single-source picker) was removed — every feed
      // now fans out across all major sources. Drop it so old browsers don't
      // keep filtering to one source.
      if ('source' in saved) { try { delete saved.source; } catch {} }
      return {
        ...base, ...saved,
        reader: { ...base.reader, ...(saved.reader || {}) },
        sections: { ...base.sections, ...(saved.sections || {}) },
      };
    }
  } catch {}
  return base;
}
function savePrefs(p) {
  // Never persist a legacy single-source pick.
  try { if (p && 'source' in p) delete p.source; } catch {}
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}
const applyTheme = () => {
  const m = loadPrefs().mode || 'dark';
  document.documentElement.dataset.theme = (m === 'light' || m === 'dark') ? m : (THEME_NAMES[m] ? m : 'dark');
};

// ---------- local progress (LEGACY guest key — kept only to delete it) ----------
// Continue Reading is sign-in-only and server-backed. Guests are never
// tracked. These helpers exist so old browsers can purge `mgs_local_progress`.
const LOCAL_PROG_KEY = 'mgs_local_progress';
function localProgress() {
  try { return JSON.parse(localStorage.getItem(LOCAL_PROG_KEY) || '{}'); } catch { return {}; }
}
function setLocalProgress(mangaId, obj) {
  const m = localProgress();
  m[mangaId] = { ...obj, updated_at: Date.now() };
  try { localStorage.setItem(LOCAL_PROG_KEY, JSON.stringify(m)); } catch {}
}
function removeLocalProgress(mangaId) {
  const m = localProgress();
  if (m[mangaId]) { delete m[mangaId]; try { localStorage.setItem(LOCAL_PROG_KEY, JSON.stringify(m)); } catch {} }
}
function clearLocalProgress() {
  try { localStorage.removeItem(LOCAL_PROG_KEY); } catch {}
}
const localProgressList = () => Object.entries(localProgress()).map(([manga_id, v]) => ({
  manga_id, chapter_id: v.chapter_id, page: v.page || 0, chapter_label: v.chapter_label || null, updated_at: v.updated_at || 0,
}));

// ---------- bookmarks (local for guests, synced to Library when logged in) ----------
const BM_KEY = 'mgs_bookmarks';
function localBookmarks() {
  try { return new Set(JSON.parse(localStorage.getItem(BM_KEY) || '[]')); } catch { return new Set(); }
}
function setLocalBookmarks(set) {
  try { localStorage.setItem(BM_KEY, JSON.stringify([...set])); } catch {}
  view.querySelectorAll('.bmark').forEach((b) => {
    const on = set.has(b.dataset.id);
    b.classList.toggle('on', on);
    b.dataset.bmark = on ? '1' : '0';
  });
}
function clearLocalBookmarks() {
  try { localStorage.removeItem(BM_KEY); } catch {}
  view.querySelectorAll('.bmark').forEach((b) => {
    b.classList.remove('on');
    b.dataset.bmark = '0';
  });
}
// Wipe every trace this browser holds: bookmarks + Continue Reading.
// Settings (theme/mature/genres) are kept — use Reset settings for those.
function clearAllLocalUserData() {
  clearLocalBookmarks();
  clearLocalProgress();
}
async function syncBookmarksFromServer() {
  if (!currentUser) return;
  try {
    const { mangaIds } = await api('/api/library');
    // Server is the source of truth when logged in. Replace (don't merge)
    // so a cleared library can't resurrect from stale localStorage.
    setLocalBookmarks(new Set(mangaIds || []));
  } catch {}
}
// Clear server + local together, then re-render. This is the "I still see
// the manga I was reading" fix: clearing only one side always resurrects.
async function clearServerHistory(mangaId) {
  removeLocalProgress(mangaId);
  if (currentUser) {
    try { await api(`/api/progress/${encodeURIComponent(mangaId)}`, { method: 'DELETE' }); } catch {}
  }
}
async function clearAllHistory() {
  clearLocalProgress();
  if (currentUser) {
    try { await api('/api/progress', { method: 'DELETE' }); } catch (e) { toast(e.message); return false; }
  }
  return true;
}
async function clearAllLibrary() {
  clearLocalBookmarks();
  if (currentUser) {
    try { await api('/api/library', { method: 'DELETE' }); } catch (e) { toast(e.message); return false; }
  }
  return true;
}
async function clearAllUserData() {
  clearAllLocalUserData();
  if (currentUser) {
    try { await api('/api/me/data', { method: 'DELETE' }); } catch (e) { toast(e.message); return false; }
  }
  return true;
}
async function toggleBookmark(id) {
  // Bookmarks are a signed-in perk on every device — guests get login.
  if (!currentUser) { openAuthModal(false); toast('Sign in to bookmark titles'); return null; }
  const set = localBookmarks();
  const adding = !set.has(id);
  set.has(id) ? set.delete(id) : set.add(id);
  setLocalBookmarks(set);
  try { await api(`/api/library/${id}`, { method: adding ? 'POST' : 'DELETE' }); }
  catch (e) { toast(e.message); }
  return adding;
}

let comickSourcesCache = null;
async function comickSources() {
  if (comickSourcesCache) return comickSourcesCache;
  try {
    comickSourcesCache = (await api('/api/comick/sources')).data;
  } catch { comickSourcesCache = [{ id: 'mangaread', name: 'MangaRead' }, { id: 'mangayy', name: 'MangaYY' }, { id: 'mangasushi', name: 'MangaSushi' }, { id: 'flamecomics', name: 'FlameComics' }]; }
  return comickSourcesCache;
}

// Every home/genre feed pulls from all of these at once (no source picker).
// Only WordPress-Madara sources work here: bato + mangapark are Shutdown
// upstream, and flamecomics/likemanga/manhuaus use custom layouts our
// homepage/genre scraper can't read (they still work via Search + title pages,
// which go through the upstream API). Verified WP: mangaread, mangayy, mangasushi.
const MAJOR_SOURCES = ['mangaread', 'mangayy', 'mangasushi'];
// Fan-out fetch: urlFor(source) for every source, merged round-robin so one
// giant source can't starve the others. Failures resolve to empty.
async function fanout(sources, urlFor) {
  const settled = await Promise.allSettled(sources.map((s) =>
    api(urlFor(s)).then((r) => r.data || []).catch(() => [])));
  const lists = settled.map((s) => (s.status === 'fulfilled' ? s.value : []));
  const seen = new Set();
  const out = [];
  let idx = 0, added = true;
  while (added) {
    added = false;
    for (const l of lists) {
      const m = l[idx];
      if (m && m.id && !seen.has(m.id)) { seen.add(m.id); out.push(m); added = true; }
    }
    idx++;
  }
  return out;
}
// Union of genre menus across all major sources (sorted by name).
async function comickGenres() {
  const settled = await Promise.allSettled(MAJOR_SOURCES.map((s) =>
    api(`/api/comick/genres?source=${encodeURIComponent(s)}`).then((r) => r.data || []).catch(() => [])));
  const seen = new Map();
  for (const st of settled) {
    if (st.status !== 'fulfilled') continue;
    for (const t of st.value) {
      if (t && t.id && !seen.has(t.id)) seen.set(t.id, t.name || t.id);
    }
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

// Taste profile: genres the signed-in reader actually reads + bookmarks,
// weighted (recent reads count double). Guests get [] (generic feeds).
// Resolves stored cx: IDs to genres via /api/comick/resolve.
let tasteCache = { uid: null, genres: null };
async function tasteGenres() {
  const uid = currentUser ? currentUser.id : null;
  if (!uid) return [];
  if (tasteCache.uid === uid && tasteCache.genres) return tasteCache.genres;
  let genres = [];
  try {
    const [prog, lib] = await Promise.all([
      api('/api/progress').catch(() => ({ items: [] })),
      api('/api/library').catch(() => ({ mangaIds: [] })),
    ]);
    const progIds = ((prog && prog.items) || []).slice(0, 12).map((p) => p.manga_id);
    const libIds = ((lib && lib.mangaIds) || []).slice(0, 20);
    const ids = [...new Set([...progIds, ...libIds])]
      .filter((id) => String(id).startsWith('cx:')).slice(0, 24);
    if (ids.length) {
      const byId = await resolveComickIds(ids);
      const score = new Map();
      const add = (list, w) => {
        for (const g of (list || [])) {
          const k = String(g).toLowerCase();
          if (!k || ADULT_GENRES.has(k)) continue;
          const e = score.get(k) || { name: g, w: 0 };
          e.w += w;
          score.set(k, e);
        }
      };
      progIds.forEach((id) => { const m = byId.get(id); if (m) add(m.genres, 2); });
      libIds.forEach((id) => { const m = byId.get(id); if (m) add(m.genres, 1); });
      genres = [...score.values()].sort((a, b) => b.w - a.w).map((e) => e.name);
    }
  } catch { genres = []; }
  tasteCache = { uid, genres };
  return genres;
}

// Adult-content handling: sources expose no ratings, so maturity is inferred
// from genre tags (same level MangaDex's "erotica" sat at).
const ADULT_GENRES = new Set(['adult', 'mature', 'smut', 'hentai', 'ecchi', 'doujinshi', 'yaoi', 'yuri', 'bara']);
const isAdultSlug = (slug) => ADULT_GENRES.has(String(slug || '').toLowerCase());
const isAdultItem = (m) => (m && Array.isArray(m.genres) && m.genres.some((g) => ADULT_GENRES.has(String(g).toLowerCase())))
  || (m && m.genre && ADULT_GENRES.has(String(m.genre).toLowerCase()))
  || (m && m.contentRating && ['adult', 'erotica', 'pornographic'].includes(String(m.contentRating).toLowerCase()));
function applyMatureFilter(items) {
  if (loadPrefs().mature) return items;
  return (items || []).filter((m) => !isAdultItem(m));
}

function openSettings() {
  const prefs = loadPrefs();
  const s = prefs.sections;
  // Keep an owned shop theme selectable so saving settings never wipes it.
  const themeOpts = [['dark', 'Dark'], ['light', 'Light']];
  if (prefs.mode && prefs.mode !== 'dark' && prefs.mode !== 'light') {
    themeOpts.push([prefs.mode, THEME_NAMES[prefs.mode] || prefs.mode]);
  }
  const seg = (name, options, checkedVal) => options.map(([val, label]) => `
    <label><input type="radio" name="${name}" value="${val}" ${checkedVal === val ? 'checked' : ''}/><span>${label}</span></label>`).join('');
  const sw = (id, checked, label) => `
    <label class="set-row"><span class="set-lbl">${label}</span>
    <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} hidden /><span class="switch"></span></label>`;
  $('#modal').classList.remove('hidden');
  $('#modalContent').innerHTML = `
    <h2>Settings</h2>
    <div class="set-body">
      <div>
        <p class="set-h">Theme</p>
        <div class="set-seg">${seg('theme', themeOpts, prefs.mode)}</div>
      </div>
      <div>
        <p class="set-h">Content</p>
        <div class="set-row ${prefs.mature ? 'on' : ''}" id="setMatureRow" role="button" tabindex="0" title="Show mature titles">
          <span class="mat-dot"></span>
          <span class="set-lbl dim">Mature content</span>
        </div>
        <p class="small" style="margin:8px 0 0">Sources don't label maturity, so this filters titles tagged with adult genres (smut, ecchi, doujinshi…). Search stays unfiltered.</p>
      </div>
      <div>
        <p class="set-h">Home sections</p>
        ${sw('setSecLatest', s.latest, 'Latest updates')}
        ${sw('setSecCharts', s.charts, 'Trending + most followed')}
        ${sw('setSecPopular', s.popular, 'Updates (Hot / New)')}
      </div>
      <div>
        <p class="set-h">Privacy — your data on this browser</p>
        <p class="small" style="margin:0 0 10px">Clears bookmarks + Continue Reading locally${currentUser ? ' and on your account (all devices)' : ''}. Use this if you still see manga you read earlier.</p>
        <div class="acct-row">
          <button class="btn ghost" id="setClearHistory">Clear reading history</button>
          <button class="btn ghost" id="setClearLibrary">Clear library</button>
          <button class="btn danger" id="setClearAll">Clear all my data</button>
        </div>
      </div>
    </div>
    <button class="btn primary" id="setSave" style="width:100%;margin-top:20px">Save settings</button>
  `;
  $('#setClearHistory')?.addEventListener('click', async () => {
    if (!confirm('Clear your Continue Reading history on this browser' + (currentUser ? ' and your account?' : '?'))) return;
    if (await clearAllHistory()) { toast('Reading history cleared'); closeModal(); route(); }
  });
  $('#setClearLibrary')?.addEventListener('click', async () => {
    if (!confirm('Clear your library / bookmarks on this browser' + (currentUser ? ' and your account?' : '?'))) return;
    if (await clearAllLibrary()) { toast('Library cleared'); closeModal(); route(); }
  });
  $('#setClearAll')?.addEventListener('click', async () => {
    if (!confirm('Clear ALL your data (history + library) on this browser' + (currentUser ? ' and your account?' : '?'))) return;
    if (await clearAllUserData()) { toast('All local + account data cleared'); closeModal(); route(); }
  });
  $('#setMatureRow')?.addEventListener('click', () => $('#setMatureRow').classList.toggle('on'));
  $('#setSave').addEventListener('click', () => {
    savePrefs({
      mode: (document.querySelector('input[name="theme"]:checked') || { value: 'dark' }).value,
      mature: $('#setMatureRow').classList.contains('on'),
      reader: prefs.reader,
      sections: {
        latest: $('#setSecLatest').checked,
        charts: $('#setSecCharts').checked,
        popular: $('#setSecPopular').checked,
      },
    });
    closeModal();
    applyTheme();
    route();
    toast('Settings saved');
  });
}

// ---------- home ----------
// Resolve stored Comick IDs to display metadata (titles/covers).
async function resolveComickIds(ids) {
  const clean = [...new Set((ids || []).filter((id) => String(id).startsWith('cx:')))];
  if (!clean.length) return new Map();
  try {
    const { data } = await api('/api/comick/resolve', { method: 'POST', body: JSON.stringify({ ids: clean.slice(0, 30) }) });
    return new Map((data || []).map((m) => [m.id, m]));
  } catch { return new Map(); }
}

function origCard(s) {
  return `
    <div class="manga-card orig-card" data-id="orig:${s.id}">
      ${s.cover ? `<img class="cover" loading="lazy" src="${esc(s.cover)}" alt="" />` : '<div class="cover"></div>'}
      <div class="meta">
        <div class="title">${esc(s.title)}</div>
        <div class="sub">by ${esc(s.author || 'a reader')} &middot; ${s.chapters} chapter${s.chapters === 1 ? '' : 's'}</div>
      </div>
    </div>`;
}

function origResumeCard(s, item) {
  return `
    <div class="resume-card" data-manga="orig:${s.id}" data-cid="${esc(item.chapter_id)}" data-page="${item.page}">
      <button class="resume-x" data-manga="orig:${s.id}" title="Remove from history" aria-label="Remove from history">&times;</button>
      ${s.cover ? `<img class="cover" loading="lazy" src="${esc(s.cover)}" alt="" />` : '<div class="cover"></div>'}
      <div class="resume-info">
        <div class="title">${esc(s.title)}</div>
      </div>
    </div>`;
}

function resumeCard(m, item) {
  const img = proxiedCover(m);
  return `
    <div class="resume-card" data-manga="${esc(m.id)}" data-cid="${esc(item.chapter_id)}" data-page="${item.page}">
      <button class="resume-x" data-manga="${esc(m.id)}" title="Remove from history" aria-label="Remove from history">&times;</button>
      ${img ? `<img class="cover" loading="lazy" referrerpolicy="no-referrer" src="${img}" alt="" />` : '<div class="cover"></div>'}
      <div class="resume-info">
        <div class="title">${esc(titleOf(m))}</div>
      </div>
    </div>`;
}

function hasNewChapters(m, progressMap) {
  const p = progressMap && progressMap.get(m.id);
  const lbl = latestLabelOf(m);
  if (!lbl) return false;
  if (!p) return true;
  const readNum = parseFloat(String(p.chapter_label || '').replace(/^chapter\s+/i, ''));
  const newNum = parseFloat(String(lbl).replace(/^chapter\s+/i, ''));
  if (!isNaN(readNum) && !isNaN(newNum)) return newNum > readNum;
  return String(p.chapter_label) !== String(lbl);
}

function section(title, id, sub) {
  return `<div class="sect">
    <h2 class="sect-title">${esc(title)}${sub ? `<span class="sect-sub">${esc(sub)}</span>` : ''}</h2>
    <div class="hrow-wrap">
      <button class="row-ctrl prev" data-row="${id}" title="Scroll left">&#10094;</button>
      <div class="hrow" id="${id}">${spinner(6)}</div>
      <button class="row-ctrl next" data-row="${id}" title="Scroll right">&#10095;</button>
    </div>
  </div>`;
}

async function fillRow(rowId, url, extras = {}) {
  const row = document.getElementById(rowId);
  if (!row) return;
  try {
    const data = await api(url);
    const items = data.data || [];
    if (!items.length) { row.innerHTML = '<div class="centered small">Nothing here yet</div>'; return; }
    const { progressMap, chaptersMeta } = extras;
    items.forEach((m) => { if (hasNewChapters(m, progressMap, chaptersMeta)) m._new = true; });
    row.innerHTML = items.map((m) => mangaCard(m, { h: true })).join('');
    wireCards(row);
  } catch (e) {
    row.innerHTML = `<div class="centered small">Could not load: ${esc(e.message)}</div>`;
  }
}

async function fillGrid(gridId, url) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  try {
    const data = await api(url);
    const items = data.data || [];
    if (!items.length) { grid.innerHTML = '<div class="centered small">Nothing here yet</div>'; return; }
    grid.innerHTML = items.map((m) => mangaCard(m)).join('');
    wireCards(grid);
  } catch (e) {
    grid.innerHTML = `<div class="centered small">Could not load: ${esc(e.message)}</div>`;
  }
}

function wireCards(container) {
  if (!container) return;
  container.querySelectorAll('.manga-card').forEach((el) => {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    el.addEventListener('click', (e) => {
      if (e.target.closest('.bmark')) return;
      location.hash = titleHash(el.dataset.id);
    });
  });
  container.querySelectorAll('.bmark').forEach((b) => {
    if (b.dataset.wired) return;
    b.dataset.wired = '1';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBookmark(b.dataset.id);
    });
  });
}

// ----- Continue reading -----
// Sign-in-gated: guests NEVER see Continue and are NEVER tracked.
// Only after sign-in do we save/fetch reading history (server-side).
async function fillResume(progressMap) {
  const sect = $('#continueSect');
  if (!sect) return;
  if (!currentUser) {
    sect.style.display = 'none';
    // Self-heal the ghost: drop the legacy guest-tracking key so a manga
    // read before this change can never reappear for logged-out visitors.
    try { localStorage.removeItem(LOCAL_PROG_KEY); } catch {}
    return;
  }
  let items = [];
  try { items = (await api('/api/progress')).items || []; } catch {}
  items.forEach((i) => { i.updated_at = Date.parse(String(i.updated_at).replace(' ', 'T') + 'Z') || 0; });
  if (progressMap) items.forEach((i) => progressMap.set(i.manga_id, i));
  // Server is the single source of truth now — ignore + purge any stale
  // local copy left over from before Continue became sign-in-only.
  try { localStorage.removeItem(LOCAL_PROG_KEY); } catch {}
  if (!items.length) { sect.style.display = 'none'; return; }
  const items12 = items.slice(0, 12);
  const cxItems = items12.filter((i) => String(i.manga_id).startsWith('cx:'));
  const origItems = items12.filter((i) => String(i.manga_id).startsWith('orig:'));
  let resumeHtml = '';
  try {
    if (cxItems.length) {
      const byId = await resolveComickIds(cxItems.map((i) => i.manga_id));
      resumeHtml += cxItems.filter((i) => byId.has(i.manga_id)).map((i) => resumeCard(byId.get(i.manga_id), i)).join('');
    }
  } catch {}
  for (const i of origItems) {
    try {
      const s = (await api(`/api/originals/${String(i.manga_id).slice(5)}`)).data;
      resumeHtml += origResumeCard(s, i);
    } catch {}
  }
  {
    const row = $('#resumeRow');
    if (!row) return;
    row.innerHTML = resumeHtml;
    if (!row.children.length) return;
    sect.style.display = '';
    row.querySelectorAll('.resume-card').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.resume-x')) return;
        location.hash = `#/reader/${el.dataset.manga}/${encodeURIComponent(el.dataset.cid)}/${el.dataset.page}`;
      });
    });
    row.querySelectorAll('.resume-x').forEach((x) => {
      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mid = x.dataset.manga;
        await clearServerHistory(mid);
        x.closest('.resume-card')?.remove();
        toast('Removed from history');
        if (!row.children.length) sect.style.display = 'none';
      });
    });
  }
  const clearBtn = $('#continueClear');
  if (clearBtn) clearBtn.addEventListener('click', async () => {
    if (!confirm('Clear your Continue Reading history?')) return;
    if (await clearAllHistory()) { toast('Reading history cleared'); route(); }
  });
}

// ----- Home -----
async function renderHome() {
  const prefs = loadPrefs();
  const progressMap = new Map();
  const sec = prefs.sections;

  view.innerHTML = `
    <div class="brand-hero">
      <img src="/assets/chibi.png" alt="MyGhoulScans" />
      <div class="brand-title">MyGhoulScans</div>
      <div class="brand-tag">manga &middot; manhwa &middot; manhua</div>
      ${currentUser ? `<div style="margin-top:10px"><a href="#/shop" style="text-decoration:none"><span class="rp-chip" data-rp-balance title="Reader Points — open the Shop">&#129689; <b>${Number(currentUser.rp || 0).toLocaleString()}</b>&nbsp;RP</span></a></div>` : ''}
    </div>
    <div class="home-wrap">
      <div class="home-main">
        <div class="sect" id="continueSect" style="display:none">
          <h2 class="sect-title">Continue reading <button class="btn ghost" id="continueClear" style="margin-left:8px;font-size:12px;padding:4px 10px">Clear</button></h2>
          <div class="hrow-wrap">
            <button class="row-ctrl prev" data-row="resumeRow" title="Scroll left">&#10094;</button>
            <div class="hrow" id="resumeRow"></div>
            <button class="row-ctrl next" data-row="resumeRow" title="Scroll right">&#10095;</button>
          </div>
        </div>
        ${sec.latest ? section('Latest updates', 'latestRow', 'all sources') : ''}
        ${sec.charts ? section('Most Recent Popular', 'trendRow', 'trending this week') : ''}
        ${sec.charts ? section('Most Followed New Comics', 'followRow', 'most bookmarked') : ''}
        ${sec.popular ? `<div class="sect" id="updatesSect">
          <div class="upd-head">
            <h2 class="sect-title" style="margin:0">Updates</h2>
            <div class="upd-tabs" role="tablist" aria-label="Updates feed">
              <button class="tab-btn active" data-utab="hot">Hot</button>
              <button class="tab-btn" data-utab="new">New</button>
            </div>
            <div class="upd-filters">
              <select id="updType" class="genre-select" aria-label="Filter by type">
                <option value="">All types</option>
                <option value="manga">Manga</option>
                <option value="manhwa">Manhwa</option>
                <option value="manhua">Manhua</option>
              </select>
              <select id="updStatus" class="genre-select" aria-label="Filter by status">
                <option value="">All status</option>
                <option value="ongoing">Ongoing</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
          <div class="hrow-wrap">
            <button class="row-ctrl prev" data-row="updatesGrid" title="Scroll left">&#10094;</button>
            <div class="hrow" id="updatesGrid">${spinner(6)}</div>
            <button class="row-ctrl next" data-row="updatesGrid" title="Scroll right">&#10095;</button>
          </div>
          <div class="centered small" id="updSentinel" style="padding:16px 0 4px">Scroll for more</div>
        </div>` : ''}
        <div class="sect" id="recFreshSect">
          <div class="upd-head">
            <h2 class="sect-title" style="margin:0">Recommended <span class="sect-sub">fresh picks, never repeats</span></h2>
            <div class="upd-filters">
              <select id="recType" class="genre-select" aria-label="Filter by type">
                <option value="">All types</option>
                <option value="manga">Manga</option>
                <option value="manhwa">Manhwa</option>
                <option value="manhua">Manhua</option>
              </select>
              <select id="recStatus" class="genre-select" aria-label="Filter by status">
                <option value="">All status</option>
                <option value="ongoing">Ongoing</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
          <div class="grid" id="recFreshGrid">${spinner(8)}</div>
          <div class="centered small" id="recSentinel" style="padding:16px 0 4px">Scroll for more</div>
        </div>
      </div>
      <aside class="home-side">
        <div class="sect side-sect" style="margin:0">
          <div class="side-tabs">
            <button class="tab-btn active">Discover</button>
          </div>
          <div class="tab-pane active">
            <p class="small" style="padding:12px">Search any title above, or <a href="#/popular">browse the community chart</a>.</p>
          </div>
        </div>
        <div class="sect side-sect" style="margin:0" id="recentSect">
          <h2 class="sect-title">Recently Added</h2>
          <div class="trend-list" id="recentList">${spinner(3)}</div>
          <button class="btn ghost" id="recentMore" style="width:100%;margin-top:10px" hidden>See More</button>
        </div>
        <div class="sect side-sect" style="margin:0" id="popOngoingSect">
          <h2 class="sect-title">Popular Ongoing</h2>
          <div class="trend-list" id="popOngoingList">${spinner(3)}</div>
        </div>
      </aside>
    </div>`;

  view.querySelectorAll('.row-ctrl').forEach((b) => b.addEventListener('click', () => {
    const row = document.getElementById(b.dataset.row);
    if (!row) return;
    const dist = row.clientWidth - 120;
    row.scrollBy({ left: b.classList.contains('prev') ? -dist : dist, behavior: 'smooth' });
  }));
  fillResume(progressMap);

  const needFilter = !loadPrefs().mature;
  homeSeen = new Set();
  const used = homeSeen;
  // Sidebar lists + Updates section fetch in the background — the rows
  // below never wait on them.
  fillHomeSide(needFilter);
  if (sec.popular) initUpdates(needFilter);
  refreshRpChips();
  // Every row pulls from ALL major sources at once (round-robin merged).
  const paintRowItems = (rowId, items, extras = {}) => {
    const row = document.getElementById(rowId);
    if (!row) return;
    let list = items;
    if (extras.filterAdult) list = applyMatureFilter(list);
    const fresh = [];
    for (const m of list) {
      if (!m || !m.id || used.has(m.id)) continue;
      used.add(m.id);
      fresh.push(m);
      if (fresh.length >= 24) break;
    }
    if (!fresh.length) { row.innerHTML = '<div class="centered small">Nothing here yet</div>'; return; }
    if (extras.progressMap) fresh.forEach((m) => { if (hasNewChapters(m, extras.progressMap)) m._new = true; });
    row.innerHTML = fresh.map((m) => mangaCard(m, { h: true })).join('');
    wireCards(row);
  };
  const latestUrl = (s) => `/api/comick/latest?source=${encodeURIComponent(s)}${needFilter ? '&enrich=1' : ''}`;
  const jobs = [];
  if (sec.latest) {
    jobs.push(fanout(MAJOR_SOURCES, (s) => latestUrl(s))
      .then((items) => paintRowItems('latestRow', items, { progressMap, filterAdult: needFilter }))
      .catch(() => paintRowItems('latestRow', [])));
  }
  // Community charts: ranked from reader activity across EVERY source mixed
  // together (never one source). Rank badges match the chart look.
  if (sec.charts && (document.getElementById('trendRow') || document.getElementById('followRow'))) {
    jobs.push((async () => {
      let charts = null;
      try { charts = await api('/api/charts'); } catch { charts = null; }
      const paintChart = async (rowId, entries) => {
        const row = document.getElementById(rowId);
        if (!row) return;
        const ids = (entries || []).map((e) => e && e.id).filter(Boolean);
        const byId = await resolveComickIds(ids);
        const origById = new Map();
        for (const oid of ids.filter((id) => String(id).startsWith('orig:'))) {
          try { origById.set(oid, (await api(`/api/originals/${String(oid).slice(5)}`)).data); } catch {}
        }
        // Legacy follows may store a bare originals uuid (no orig: prefix).
        for (const oid of ids.filter((id) => !String(id).startsWith('cx:') && !String(id).startsWith('orig:'))) {
          try { origById.set(oid, (await api(`/api/originals/${encodeURIComponent(String(oid))}`)).data); } catch {}
        }
        let list = ids.map((id) => byId.get(id) || (origById.has(id) ? { ...origById.get(id), orig: true } : null)).filter(Boolean);
        if (needFilter) list = applyMatureFilter(list);
        const fresh = [];
        for (const m of list) {
          if (!m || !m.id || used.has(m.id)) continue;
          used.add(m.id);
          fresh.push(m);
          if (fresh.length >= 18) break;
        }
        // Backfill sparse rows from the latest-updates feeds (all sources
        // mixed) so the row is never bare — quiet weeks, heavy overlap with
        // rows above, or thin community data all end up filled from sources.
        if (fresh.length < 12) {
          try {
            const pool = await fanout(MAJOR_SOURCES, (s) => `/api/comick/latest?source=${encodeURIComponent(s)}${needFilter ? '&enrich=1' : ''}`);
            const filtered = needFilter ? applyMatureFilter(pool) : pool;
            for (const m of filtered) {
              if (fresh.length >= 18) break;
              if (!m || !m.id || used.has(m.id)) continue;
              used.add(m.id);
              fresh.push(m);
            }
          } catch {}
        }
        if (!fresh.length) { row.innerHTML = '<div class="centered small">Nothing here yet — read and bookmark titles to fill these charts.</div>'; return; }
        fresh.forEach((m) => { if (!m.orig && hasNewChapters(m, progressMap)) m._new = true; });
        row.innerHTML = fresh.map((m, i) => (m.orig ? origCard(m) : mangaCard(m, { h: true, rank: i + 1 }))).join('');
        wireCards(row);
      };
      await paintChart('trendRow', charts && charts.trending);
      await paintChart('followRow', charts && charts.followed);
    })());
  }
  await Promise.all(jobs);
  // Recommended starts only after the rows above (plus whatever the sidebar
  // and Updates managed) have registered in homeSeen — so its first paint
  // is already de-duplicated against the rest of the page.
  initRecommended(needFilter);
}

// ---------- home sidebar + updates ----------
// Compact sidebar row (cover + title + chapter). Covers go through
// proxiedCover so the static build keeps working (direct /api/img URLs
// would break on GitHub Pages).
function trendItemHtml(m, rank) {
  const lbl = latestLabelOf(m);
  const img = proxiedCover(m);
  return `
    <div class="trend-item" data-sidelink="${esc(m.id)}">
      ${rank ? `<span class="t-rank ${rank <= 3 ? 'top' : ''}">${rank}</span>` : ''}
      ${img ? `<img class="t-cover" loading="lazy" referrerpolicy="no-referrer" src="${img}" alt="" />` : '<div class="t-cover"></div>'}
      <div class="t-info">
        <div class="t-title">${esc(titleOf(m))}</div>
        <div class="t-meta">${lbl ? `Ch. ${esc(lbl)}${m.latestChapterDate ? ` &middot; ${esc(timeAgo(m.latestChapterDate))}` : ''}` : esc(m.source || '')}</div>
      </div>
    </div>`;
}
function wireSideList(container) {
  if (!container) return;
  container.querySelectorAll('[data-sidelink]').forEach((el) => {
    el.addEventListener('click', () => { location.hash = titleHash(el.dataset.sidelink); });
  });
}

// Sidebar: Recently Added (latest feed) + Popular Ongoing (community top
// reads, ongoing-first). Fire-and-forget: home rows never wait on these.
async function fillHomeSide(needFilter) {
  const recentList = $('#recentList');
  const popList = $('#popOngoingList');
  if (!recentList && !popList) return;
  try {
    let items = await fanout(MAJOR_SOURCES, (s) => `/api/comick/latest?source=${encodeURIComponent(s)}&enrich=1`);
    if (needFilter) items = applyMatureFilter(items);
    if ($('#recentList')) {
      const list = $('#recentList');
      const paintRecent = (subset) => {
        list.innerHTML = subset.length ? subset.map((m) => trendItemHtml(m)).join('') : '<div class="centered small">Nothing here yet</div>';
        wireSideList(list);
        subset.forEach((m) => { if (m && m.id) homeSeen.add(m.id); });
      };
      paintRecent(items.slice(0, 6));
      const more = $('#recentMore');
      if (more && items.length > 6) {
        more.hidden = false;
        let expanded = false;
        more.addEventListener('click', () => {
          expanded = !expanded;
          if (!$('#recentList')) return;
          paintRecent(expanded ? items.slice(0, 30) : items.slice(0, 6));
          more.textContent = expanded ? 'Show less' : 'See More';
        });
      }
    }
  } catch (e) {
    if ($('#recentList')) $('#recentList').innerHTML = `<div class="centered small">Could not load: ${esc(e.message)}</div>`;
  }
  try {
    const { data } = await api('/api/popular');
    const ids = (data || []).map((r) => r.id).filter((id) => String(id).startsWith('cx:')).slice(0, 10);
    if (!ids.length) { if ($('#popOngoingList')) $('#popOngoingList').innerHTML = '<div class="centered small">No reads tracked yet.</div>'; return; }
    const byId = await resolveComickIds(ids);
    let items = ids.filter((id) => byId.has(id)).map((id) => byId.get(id));
    if (needFilter) items = applyMatureFilter(items);
    const ongoing = items.filter((m) => String(m.status || '').trim().toLowerCase().startsWith('ongoing'));
    const list = (ongoing.length ? ongoing : items).slice(0, 10);
    if ($('#popOngoingList')) {
      $('#popOngoingList').innerHTML = list.length ? list.map((m, i) => trendItemHtml(m, i + 1)).join('') : '<div class="centered small">No reads tracked yet.</div>';
      wireSideList($('#popOngoingList'));
      list.forEach((m) => { if (m && m.id) homeSeen.add(m.id); });
    }
  } catch (e) {
    if ($('#popOngoingList')) $('#popOngoingList').innerHTML = `<div class="centered small">Could not load: ${esc(e.message)}</div>`;
  }
}

// Bottom Updates section: Hot (community most-read) / New (latest) tabs
// with type + status filters, plus infinite scroll. Feeds carry status/type
// (resolve + enrich), so filtering is client-side and instant. Changing the
// tab or a filter resets the feed back to page 1.
let updatesIO = null;
let recFreshIO = null;
// Every title id shown on this home render (rows, sidebar, updates...).
// Recommended excludes all of these so it only ever shows fresh titles.
let homeSeen = new Set();
// Shared Updates/Recommended item filter (type + status).
function updatesFilterMatch(m, type, status) {
  const t = String((m && m.type) || '').trim().toLowerCase();
  if (type && t !== type) return false;
  const s = String((m && m.status) || '').trim().toLowerCase();
  if (status === 'ongoing' && !s.startsWith('ongoing')) return false;
  if (status === 'completed' && !s.startsWith('complet')) return false;
  return true;
}
// Feed sentinel states: loading spinner, idle "more", "end", "empty", "error".
function setSentinel(sel, mode) {
  const s = typeof sel === 'string' ? $(sel) : sel;
  if (!s || !document.contains(s)) return;
  if (mode === 'loading') s.innerHTML = spinner();
  else if (mode === 'end') s.textContent = 'You reached the end';
  else if (mode === 'empty') s.textContent = 'Nothing matches these filters.';
  else if (mode === 'error') s.textContent = 'Could not load more.';
  else s.textContent = '';
}
// If the sentinel is already on screen after a paint (short feed), keep
// pumping without waiting for another scroll event.
function pumpSentinel(sel, fn) {
  const s = typeof sel === 'string' ? $(sel) : sel;
  if (!s || !document.contains(s)) return;
  try {
    if (s.getBoundingClientRect().top < window.innerHeight + 800) fn();
  } catch {}
}
// Recommended: endless fresh picks from all major sources' other genres
// (action, romance, fantasy...), skipping EVERYTHING already shown on this
// home render (rows, sidebar, Updates) via homeSeen — plus its own id set.
function initRecommended(needFilter) {
  if (!$('#recFreshGrid')) return;
  if (recFreshIO) { recFreshIO.disconnect(); recFreshIO = null; }
  const state = { type: '', status: '', si: 0, sp: 1, loading: false, done: false, items: [], ids: new Set(), slugs: null };
  const paint = (append) => {
    const g = $('#recFreshGrid');
    if (!g) return;
    const items = state.items.filter((m) => updatesFilterMatch(m, state.type, state.status));
    if (!append) {
      g.innerHTML = items.length ? '' : '<div class="centered small">Nothing matches these filters.</div>';
    }
    if (items.length && append) {
      g.querySelectorAll('.spinner, .centered').forEach((n) => n.remove());
      const shown = g.querySelectorAll('.manga-card').length;
      const frag = document.createElement('div');
      frag.innerHTML = items.slice(shown).map((m) => mangaCard(m)).join('');
      while (frag.firstChild) g.appendChild(frag.firstChild);
    } else if (items.length) {
      g.innerHTML = items.map((m) => mangaCard(m)).join('');
    }
    wireCards(g);
    items.forEach((m) => { if (m && m.id) homeSeen.add(m.id); });
    if (items.length === 0 && !state.done) { state.loading = false; loadMore(); return; }
    setSentinel('#recSentinel', state.done ? (items.length ? 'end' : 'empty') : 'more');
    if (append && items.length && !state.done) pumpSentinel('#recSentinel', loadMore);
  };
  const loadMore = async () => {
    if (state.loading || state.done || !$('#recFreshGrid')) return;
    state.loading = true;
    setSentinel('#recSentinel', 'loading');
    try {
      if (!state.slugs) {
        try {
          const list = await comickGenres();
          const base = list.filter((g) => g.id && !['manga', 'manhwa', 'manhua'].includes(g.id) && (loadPrefs().mature || !isAdultSlug(g.id)));
          // Personalize: genres the reader actually reads float to the front
          // (guests and empty histories keep the generic order).
          let taste = [];
          try { taste = (await tasteGenres()).map((g) => String(g).toLowerCase()); } catch {}
          if (taste.length) {
            const rank = (g) => {
              const i = taste.indexOf(String(g.name || '').toLowerCase());
              return i === -1 ? 1e6 : i;
            };
            base.sort((a, b) => rank(a) - rank(b));
            const sub = document.querySelector('#recFreshSect .sect-sub');
            if (sub) sub.textContent = 'picks based on your reading';
          }
          state.slugs = base.map((g) => g.id);
        } catch { state.slugs = []; }
        if (!state.slugs.length) {
          state.done = true;
          const sec = $('#recFreshSect');
          if (sec) sec.style.display = 'none';
          state.loading = false;
          return;
        }
      }
      let fresh = [];
      let attempts = 0;
      while (!fresh.length && attempts < 4) {
        if (state.sp > 50) { state.done = true; break; }
        const slug = state.slugs[state.si % state.slugs.length];
        state.si += 1;
        if (state.si % state.slugs.length === 0) state.sp += 1;
        attempts += 1;
        try {
          const items = await fanout(MAJOR_SOURCES, (s) => `/api/comick/genre?source=${encodeURIComponent(s)}&genre=${encodeURIComponent(slug)}&page=${Math.min(state.sp, 50)}&enrich=1`);
          let list = items || [];
          if (needFilter) list = applyMatureFilter(list);
          for (const m of list) {
            if (!m || !m.id || state.ids.has(m.id) || homeSeen.has(m.id)) continue;
            state.ids.add(m.id);
            fresh.push(m);
          }
        } catch {}
      }
      state.items.push(...fresh);
      paint(true);
    } catch (e) {
      const g = $('#recFreshGrid');
      if (g && !g.querySelector('.manga-card')) g.innerHTML = `<div class="centered small">Could not load: ${esc(e.message)}</div>`;
      state.done = true;
      setSentinel('#recSentinel', 'error');
    }
    state.loading = false;
  };
  const resetAndLoad = () => {
    state.si = 0; state.sp = 1; state.loading = false; state.done = false; state.items = []; state.ids = new Set();
    const g = $('#recFreshGrid');
    if (g) g.innerHTML = spinner(8);
    const sec = $('#recFreshSect');
    if (sec) sec.style.display = '';
    loadMore();
  };
  $('#recType')?.addEventListener('change', (e) => { state.type = e.target.value || ''; resetAndLoad(); });
  $('#recStatus')?.addEventListener('change', (e) => { state.status = e.target.value || ''; resetAndLoad(); });
  if ('IntersectionObserver' in window) {
    recFreshIO = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting && document.contains(en.target)) loadMore();
      }
    }, { rootMargin: '800px 0px' });
    const s = $('#recSentinel');
    if (s) recFreshIO.observe(s);
  } else {
    loadMore();
  }
  resetAndLoad();
}
function initUpdates(needFilter) {
  if (!$('#updatesGrid')) return;
  if (updatesIO) { updatesIO.disconnect(); updatesIO = null; }
  const state = { tab: 'hot', type: '', status: '', page: 0, loading: false, done: false, items: [], feeds: null, fi: 0, hotExhausted: false };
  const paint = (append) => {
    const g = $('#updatesGrid');
    if (!g) return;
    const items = state.items.filter((m) => updatesFilterMatch(m, state.type, state.status));
    if (!append) {
      g.innerHTML = items.length ? '' : '<div class="centered small">Nothing matches these filters.</div>';
    }
    if (items.length && append) {
      g.querySelectorAll('.spinner, .centered').forEach((n) => n.remove());
      const shown = g.querySelectorAll('.manga-card').length;
      const frag = document.createElement('div');
      frag.innerHTML = items.slice(shown).map((m) => mangaCard(m, { h: true })).join('');
      while (frag.firstChild) g.appendChild(frag.firstChild);
    } else if (items.length) {
      g.innerHTML = items.map((m) => mangaCard(m, { h: true })).join('');
    }
    wireCards(g);
    items.forEach((m) => { if (m && m.id) homeSeen.add(m.id); });
    if (items.length === 0 && !state.done) { state.loading = false; loadMore(); return; }
    setSentinel('#updSentinel', state.done ? (items.length ? 'end' : 'empty') : 'more');
    if (append && items.length && !state.done) pumpSentinel('#updSentinel', loadMore);
  };
  const filteredCount = () => state.items.filter((m) => updatesFilterMatch(m, state.type, state.status)).length;
  const loadMore = async () => {
    if (state.loading || state.done || !$('#updatesGrid')) return;
    state.loading = true;
    setSentinel('#updSentinel', 'loading');
    try {
      let batch = [];
      if (state.tab === 'hot' && !state.hotExhausted) {
        // Community chart first (one deep pull), then flow seamlessly into
        // the New feed below so scrolling never hits a wall after Hot ends.
        const { data } = await api('/api/popular?limit=30');
        const ids = (data || []).map((r) => r.id).filter((id) => String(id).startsWith('cx:')).slice(0, 30);
        const byId = await resolveComickIds(ids);
        batch = ids.filter((id) => byId.has(id)).map((id) => byId.get(id));
        if (needFilter) batch = applyMatureFilter(batch);
        state.hotExhausted = true;
      } else if (state.type) {
        // Single-type feed: cycle (source, page) tuples so every major
        // source contributes instead of just one.
        if (!state.feeds) {
          state.feeds = [];
          for (let p = 1; p <= 50; p++) for (const major of MAJOR_SOURCES) state.feeds.push({ major, slug: state.type, page: p });
          state.fi = 0;
        }
        let tries = 0;
        while (!batch.length && tries < 2 && state.fi < state.feeds.length) {
          const f = state.feeds[state.fi++];
          tries++;
          try {
            const { data } = await api(`/api/comick/genre?source=${encodeURIComponent(f.major)}&genre=${encodeURIComponent(f.slug)}&page=${f.page}&enrich=1`);
            batch = data || [];
            if (needFilter) batch = applyMatureFilter(batch);
          } catch {}
        }
        if (state.fi >= state.feeds.length) state.done = true;
      } else {
        // All types: latest burst across all majors first, then cycle
        // (source, slug, page) tuples essentially forever.
        if (!state.feeds) {
          let slugs = [];
          try {
            const have = new Set((await comickGenres()).map((g) => g.id));
            slugs = ['manga', 'manhwa', 'manhua'].filter((s) => have.has(s));
          } catch {}
          if (!slugs.length) slugs = ['manga'];
          state.feeds = [{ kind: 'latest' }];
          for (let p = 1; p <= 50; p++) for (const slug of slugs) for (const major of MAJOR_SOURCES) state.feeds.push({ major, slug, page: p });
          state.fi = 0;
        }
        const f = state.feeds[state.fi++];
        if (!f) { state.done = true; }
        else if (f.kind === 'latest') {
          const items = await fanout(MAJOR_SOURCES, (s) => `/api/comick/latest?source=${encodeURIComponent(s)}&enrich=1`);
          batch = needFilter ? applyMatureFilter(items) : items;
          if (!batch.length) state.done = true;
        } else {
          let tries = 0;
          while (!batch.length && tries < 2 && state.fi <= state.feeds.length) {
            const g = state.feeds[state.fi - 1];
            tries++;
            try {
              const { data } = await api(`/api/comick/genre?source=${encodeURIComponent(g.major)}&genre=${encodeURIComponent(g.slug)}&page=${g.page}&enrich=1`);
              batch = data || [];
              if (needFilter) batch = applyMatureFilter(batch);
            } catch {}
            if (!batch.length) {
              if (state.fi >= state.feeds.length) { state.done = true; break; }
              state.fi++;
            }
          }
          if (state.fi >= state.feeds.length && !batch.length) state.done = true;
        }
      }
      const have = new Set(state.items.map((m) => m.id));
      for (const m of batch) {
        if (have.has(m.id)) continue;
        have.add(m.id);
        state.items.push(m);
      }
      if (filteredCount() === 0 && !state.done) {
        // Filters hide everything so far — keep paging until something
        // matchable shows up (bounded by done).
        state.loading = false;
        return loadMore();
      }
      paint(true);
    } catch (e) {
      const g = $('#updatesGrid');
      if (g && !g.querySelector('.manga-card')) g.innerHTML = `<div class="centered small">Could not load: ${esc(e.message)}</div>`;
      state.done = true;
      setSentinel('#updSentinel', 'error');
    }
    state.loading = false;
  };
  const resetAndLoad = () => {
    state.page = 0; state.loading = false; state.done = false; state.items = []; state.slugs = null; state.hotExhausted = false; state.feeds = null; state.fi = 0;
    const g = $('#updatesGrid');
    if (g) g.innerHTML = spinner(8);
    loadMore();
  };
  document.querySelectorAll('#updatesSect [data-utab]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#updatesSect [data-utab]').forEach((x) => x.classList.toggle('active', x === b));
    if (state.tab === b.dataset.utab) return;
    state.tab = b.dataset.utab;
    resetAndLoad();
  }));
  $('#updType')?.addEventListener('change', (e) => { state.type = e.target.value || ''; resetAndLoad(); });
  $('#updStatus')?.addEventListener('change', (e) => { state.status = e.target.value || ''; resetAndLoad(); });
  if ('IntersectionObserver' in window) {
    updatesIO = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting && document.contains(en.target)) loadMore();
      }
    }, { rootMargin: '800px 0px' });
    const s = $('#updSentinel');
    if (s) updatesIO.observe(s);
  } else {
    loadMore();
  }
  resetAndLoad();
}

// ---------- search ----------
async function renderSearch(term) {
  view.innerHTML = `
    <div class="home-toolbar">
      <div class="page-title" style="margin:0">${term ? `Results for &ldquo;${esc(term)}&rdquo;` : 'Search'}</div>
    </div>
    <div class="grid" id="searchGrid">${spinner().repeat(8)}</div>`;
  // No source picker: every search fans out across all sources at once.
  const list = await comickSources();
  const run = async () => {
    const grid = $('#searchGrid');
    if (!grid) return;
    grid.innerHTML = spinner().repeat(8);
    try {
      const param = `sources=${encodeURIComponent(list.map((t) => t.id).join(','))}`;
      const data = await api(`/api/comick/search?q=${encodeURIComponent(term)}&${param}`);
      if (!data.data || !data.data.length) grid.innerHTML = '<div class="centered">No results. Try a different title.</div>';
      else { grid.innerHTML = data.data.map(mangaCard).join(''); wireCards(grid); }
    } catch (e) {
      grid.innerHTML = `<div class="centered">Search failed: ${esc(e.message)}</div>`;
    }
  };
  await run('');
}

// ---------- title page ----------
const MAX_CHAPTERS = 6;
function chapterItemHtml(c, progress, counts) {
  const num = (c.number || c.number === 0) ? c.number : '?';
  const title = c.title && c.title !== `Chapter ${c.number}` ? c.title : '';
  const isCurrent = progress && progress.chapter_id === c.url;
  const n = (counts || {})[c.url] || 0;
  const ext = c.external ? ` data-ext="1" data-url="${esc(c.url)}"` : '';
  return `
    <div class="chapter-item ${isCurrent ? 'current' : ''}" data-cid="${esc(c.url)}"${ext}>
      <span class="cnum">Ch. ${esc(num)}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</span>
      ${c.external ? '<span class="ext-flag" title="Reads in-app via another source">&#8599;</span>' : ''}
      ${isCurrent ? '<span class="resume-flag">Last read &middot; p.' + (progress.page + 1) + '</span>' : ''}
      <span class="cmeta">${c.date ? `<span class="cdate">${esc(timeAgo(c.date))}</span>` : ''}<span class="read-count ${n ? '' : 'none'}" title="people that read this chapter">&#128065; ${n.toLocaleString()}</span></span>
    </div>`;
}
function chapterListHtml(chapters, progress, counts) {
  const total = chapters.length;
  const head = chapters.slice(0, MAX_CHAPTERS).map((c) => chapterItemHtml(c, progress, counts)).join('');
  const tail = total > MAX_CHAPTERS ? chapters.slice(MAX_CHAPTERS).map((c) => chapterItemHtml(c, progress, counts)).join('') : '';
  return `<div class="chapter-list" id="chapterList">
    ${head}
    ${tail ? `<span id="chapterTail" style="display:none">${tail}</span>` : ''}
    ${total > MAX_CHAPTERS ? `<button class="btn ghost expand-btn" id="chapterExpand">Show all chapters (${total})</button>` : ''}
  </div>`;
}

// Numeric chapter number (handles strings like "12.5"); NaN when unknown.
function chapNum(c) {
  const n = parseFloat(c && c.number);
  return isNaN(n) ? NaN : n;
}
// Relative chapter age ("1 hour ago", "a day", "20 days", "a month").
function timeAgo(ts) {
  const t = Number(ts);
  if (!t || isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? '1 min ago' : `${m} mins ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = Math.floor(h / 24);
  if (d < 2) return 'a day';
  if (d < 30) return `${d} days`;
  if (d < 60) return 'a month';
  const mo = Math.floor(d / 30);
  if (mo < 12) return mo === 1 ? 'a month' : `${mo} months`;
  const y = Math.floor(mo / 12);
  return y <= 1 ? 'a year' : `${y} years`;
}
// A chapter entry is navigable only when it carries a usable url.
function chapterUrl(c) {
  return c && typeof c.url === 'string' && c.url ? c.url : '';
}
// Lowest-numbered navigable chapter — never "Chapter 1" specifically, it
// may not exist (series often start at Ch. 5, have a Ch. 0, etc.).
// Falls back to the last navigable entry, else null.
function firstChapter(chapters) {
  if (!chapters.length) return null;
  let best = null;
  for (let i = chapters.length - 1; i >= 0; i--) {
    const c = chapters[i];
    if (!chapterUrl(c)) continue;
    if (!best) { best = c; continue; }
    const n = chapNum(c);
    const b = chapNum(best);
    if (!isNaN(n) && (isNaN(b) || n < b)) best = c;
  }
  return best;
}
function firstChapterLabel(chapters) {
  const c = firstChapter(chapters);
  return c ? (c.number ?? '?') : '?';
}

let lastTitleKey = '';
async function renderTitle(mangaId) {
  if (!mangaId) return renderHome();
  if (mangaId !== lastTitleKey) { lastTitleKey = mangaId; try { window.scrollTo(0, 0); } catch {} }
  view.innerHTML = spinner();
  try {
    const encId = encodeURIComponent(mangaId);
    const info = await api(`/api/comick/title?id=${encId}`);
    const feed = await api(`/api/comick/chapters?id=${encId}`);
    const manga = info.data;
    updateRouteMeta('title', titleOf(manga), cleanDesc(manga.description).slice(0, 160) || `Read ${titleOf(manga)} online free on MyGhoulScans.`);
    const chapters = (feed.data || []).slice().sort((a, b) => (chapNum(b) || 0) - (chapNum(a) || 0));
    let readCounts = {};
    try { readCounts = (await api(`/api/reads/counts?manga=${encId}`)).counts || {}; } catch {}

    let followed = false;
    let progress = null;
    if (currentUser) {
      try { followed = (await api(`/api/library/${encId}/status`)).followed; } catch {}
      try { const sp = await api(`/api/progress/${encId}`); if (sp && sp.chapter_id) progress = sp; } catch {}
    }

    const status = manga.status || '';
    const tags = (manga.genres || []).slice(0, 8);

    view.innerHTML = `
      <div class="title-hero">
        ${manga.cover ? `<img src="/api/img?u=${encodeURIComponent(manga.cover)}" alt="" referrerpolicy="no-referrer" />` : '<div class="cover"></div>'}
        <div class="title-info">
          <h1>${esc(titleOf(manga))}</h1>
          <div class="tagline">from ${esc(manga.source || 'the source')}</div>
          <div class="chips">
            ${status ? statusBadge(status) : ''}
            ${manga.type ? `<span class="chip">${esc(manga.type)}</span>` : ''}
            ${(manga.genres || []).some((g) => ADULT_GENRES.has(String(g).toLowerCase())) ? '<span class="chip" style="border-color:var(--red);color:var(--red)">Mature</span>' : ''}
            ${chapters.length ? `<span class="chip">${chapters.length} chapter${chapters.length === 1 ? '' : 's'}</span>` : ''}
          </div>
          ${manga.description ? `<div class="summary">${esc(cleanDesc(manga.description))}</div>` : ''}
          ${tags.length ? `<div class="chips">${tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="title-actions">
            ${progress ? `<button class="btn primary" id="resumeBtn">Continue: Ch. ${esc(progress.chapter_label || '?')} &#183; p.${progress.page + 1}</button>` : ''}
            ${!progress && chapters.length ? `<button class="btn primary" id="startBtn">Read Chapter ${esc(firstChapterLabel(chapters))}</button>` : ''}
            <button class="btn ${followed ? 'primary' : ''}" id="followBtn">${currentUser ? (followed ? 'In Library' : 'Add to Library') : (followed ? 'Bookmarked' : 'Bookmark')}</button>
          </div>
          <div class="small" style="margin-top:6px">${chapters.length} chapters on ${esc(manga.source || 'source')}</div>
        </div>
      </div>
      <div class="page-title" style="font-size:18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">Chapters
        ${chapters.length ? `<button class="btn ghost" id="readFirstBtn" style="margin-left:auto;font-size:13px">Read Chapter ${esc(firstChapterLabel(chapters))} (first)</button>` : ''}
      </div>
      ${manga.source === 'comix' ? '<div class="comix-inapp"><p class="small" style="margin:4px 0 8px">This title is from comix.to — reading stays on MyGhoulScans. Pick a chapter below and we open the same chapter from another in-app source.</p><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn primary" id="findInAppBtn" style="font-size:13px">Find in-app version</button><span class="small" id="altSrcRow"></span></div></div>' : ''}
      ${chapters.length ? chapterListHtml(chapters, progress, readCounts)
        : `<div class="centered" style="margin:32px 0">
            <p class="small">No chapters found for this title on ${esc(manga.source || 'the source')}.</p>
          </div>`}

      <div class="sect" id="simSect" style="display:none">
        <h2 class="sect-title">More like this</h2>
        <div class="hrow-wrap">
          <button class="row-ctrl prev" data-row="simRow" title="Scroll left">&#10094;</button>
          <div class="hrow" id="simRow">${spinner(6)}</div>
          <button class="row-ctrl next" data-row="simRow" title="Scroll right">&#10095;</button>
        </div>
      </div>
      <div class="sect" id="recSect">
        <h2 class="sect-title">Recommended by readers <button class="btn ghost" id="recBtn">+ Recommend similar titles</button></h2>
        <div class="hrow" id="recRow"></div>
      </div>`;

    // Comix has no readable pages on its own (signed/encrypted API), so every
    // external chapter stays on this site: we open the same chapter number
    // from another working source (mangaread, flamecomics, mangayy, …) in-app.
    const openExternalInApp = async (ch) => {
      const row = $('#altSrcRow');
      const want = ch ? parseFloat(ch.number) : NaN;
      try {
        if (row) row.textContent = 'Finding in-app version…';
        else toast('Finding in-app version…');
        const alts = await findAltSources(titleOf(manga), mangaId, manga.source);
        if (!alts.length) {
          if (row) row.textContent = 'No in-app source has this title yet — try the same title from Search.';
          else toast('No in-app source has this title yet');
          return;
        }
        for (const a of alts) {
          try {
            const feed = (await api(`/api/comick/chapters?id=${encodeURIComponent(a.id)}`)).data || [];
            const pick = (!isNaN(want) ? matchAltChapter(feed, want) : null) || firstChapter(feed) || feed[0];
            if (pick && pick.url) { location.hash = `#/reader/${a.id}/${encodeURIComponent(pick.url)}/0`; return; }
          } catch {}
        }
        if (row) row.textContent = 'No readable chapter found on other sources yet.';
        else toast('No readable chapter found on other sources yet');
      } catch {
        if (row) row.textContent = 'Could not find an in-app version right now.';
        else toast('Could not find an in-app version right now');
      }
    };
    const goFirstChapter = () => {
      const first = firstChapter(chapters);
      const url = chapterUrl(first);
      if (!url) return;
      if (first && first.external) { openExternalInApp(first); return; }
      location.hash = `#/reader/${mangaId}/${encodeURIComponent(url)}/0`;
    };
    $('#startBtn')?.addEventListener('click', goFirstChapter);
    $('#readFirstBtn')?.addEventListener('click', goFirstChapter);
    $('#findInAppBtn')?.addEventListener('click', async () => {
      const row = $('#altSrcRow');
      try {
        if (row) row.textContent = 'Searching other sources…';
        const alts = await findAltSources(titleOf(manga), mangaId, manga.source);
        if (!alts.length) { if (row) row.textContent = 'No in-app source has this title yet.'; return; }
        if (row) {
          row.innerHTML = '';
          alts.slice(0, 5).forEach((a) => {
            const b = document.createElement('button');
            b.className = 'btn ghost';
            b.style.fontSize = '12px';
            b.textContent = `Read on ${a.name || a.source}`;
            b.addEventListener('click', async () => {
              try {
                const feed = (await api(`/api/comick/chapters?id=${encodeURIComponent(a.id)}`)).data || [];
                const pick = firstChapter(feed) || feed[0];
                if (pick && pick.url) location.hash = `#/reader/${a.id}/${encodeURIComponent(pick.url)}/0`;
                else toast('No chapters on that source');
              } catch { toast('Could not load that source'); }
            });
            row.appendChild(b);
          });
        }
      } catch { if (row) row.textContent = 'Search failed — try again.'; }
    });

    $('#followBtn').addEventListener('click', async () => {
      const r = await toggleBookmark(mangaId);
      if (r == null) return; // login prompt shown instead
      const nowF = localBookmarks().has(mangaId);
      $('#followBtn').textContent = currentUser ? (nowF ? 'In Library' : 'Add to Library') : (nowF ? 'Bookmarked' : 'Bookmark');
      $('#followBtn').classList.toggle('primary', nowF);
      toast(nowF ? 'Bookmarked' : 'Removed bookmark');
    });

    $('#resumeBtn')?.addEventListener('click', () => {
      if (!progress) return;
      location.hash = `#/reader/${mangaId}/${encodeURIComponent(progress.chapter_id)}/${progress.page}`;
    });

    view.querySelector('#chapterList')?.addEventListener('click', (e) => {
      const it = e.target.closest('.chapter-item');
      if (!it) return;
      // External (comix.to) chapters stay in-app via another source.
      if (it.dataset.ext === '1' && it.dataset.url) {
        const num = parseFloat((it.querySelector('.cnum')?.textContent || '').replace(/[^0-9.]/g, ''));
        openExternalInApp({ number: isNaN(num) ? undefined : num });
        return;
      }
      location.hash = `#/reader/${mangaId}/${encodeURIComponent(it.dataset.cid)}/0`;
    });

    $('#chapterExpand')?.addEventListener('click', () => {
      const tail = $('#chapterTail');
      const btn = $('#chapterExpand');
      const expanded = tail.style.display !== 'none';
      tail.style.display = expanded ? 'none' : '';
      btn.textContent = expanded ? `Show all chapters (${chapters.length})` : 'Show fewer chapters';
      btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    view.querySelectorAll('.row-ctrl').forEach((b) => b.addEventListener('click', () => {
      const row = document.getElementById(b.dataset.row);
      if (!row) return;
      const dist = row.clientWidth - 120;
      row.scrollBy({ left: b.classList.contains('prev') ? -dist : dist, behavior: 'smooth' });
    }));

    $('#recBtn').addEventListener('click', () => openRecModal(mangaId));
    fillRecRow(mangaId);
    fillSimilarRow(mangaId, manga.genres);
  } catch (e) {
    view.innerHTML = `<div class="centered">Could not load title: ${esc(e.message)}</div>`;
  }
}

// ---------- reader settings sheet (reading view only) ----------
function openReaderSettings(ctx) {
  const cur = ctx.get();
  const segBtn = (v, label, on) => `<button data-v="${v}" class="${on ? 'on' : ''}">${on ? '&#10003; ' : ''}${label}</button>`;
  const check = (id, on) => `<button class="rset-check${on ? ' on' : ''}" id="${id}" role="checkbox" aria-checked="${on}"></button>`;
  $('#modal').classList.remove('hidden');
  $('#modalContent').innerHTML = `
    <h2>Reader Settings</h2>
    <div class="rset-body">
      <div class="rset-row">
        <span class="rset-lbl">Reader mode</span>
        <div class="rset-seg" id="rsMode">${segBtn('scroll', 'Scroll', cur.mode !== 'paged')}${segBtn('paged', '1-Page', cur.mode === 'paged')}</div>
        <p class="rset-note">For long strip comics, the mode always is scroll.</p>
      </div>
      <div class="rset-row">
        <span class="rset-lbl">Reading Direction</span>
        <div class="rset-seg" id="rsDir">${segBtn('left', 'Left', cur.direction === 'left')}${segBtn('right', 'Right', cur.direction !== 'left')}</div>
        <p class="rset-note">Applies to 1-Page mode page controls.</p>
      </div>
      <div class="rset-row">
        <span class="rset-lbl">Show progress bar</span>
        ${check('rsProgress', cur.progress)}
      </div>
      <div class="rset-row">
        <span class="rset-lbl">Remove margin</span>
        ${check('rsNoMargin', cur.noMargin)}
      </div>
      <div class="rset-row">
        <span class="rset-lbl">Click to scroll</span>
        <span class="rset-checks">${check('rsClickScroll', cur.clickScroll)}<em>Enable</em>${check('rsSmooth', cur.smoothScroll)}<em>Smooth scroll</em></span>
      </div>
      <div class="rset-row">
        <span class="rset-lbl">Disable Lazy Loading</span>
        <span class="rset-checks">${check('rsNoLazy', cur.noLazy)}<em>(Not recommended)</em></span>
        <p class="rset-warn">Load all images at once. Warning: your browser may be crashed if this option is enabled and images will take more time to load.</p>
      </div>
      <div class="rset-row">
        <span class="rset-lbl">Auto-hide tools</span>
        ${check('rsAutoHide', cur.autoHide)}
        <p class="rset-note">Hide the top bar and buttons while scrolling.</p>
      </div>
      <div class="rset-row">
        <span class="rset-lbl">Keep screen awake</span>
        ${check('rsWake', cur.wakeLock)}
      </div>
      <div class="rset-row">
        <span class="rset-lbl">Fullscreen</span>
        ${check('rsFullscreen', cur.fullscreen)}
        <p class="rset-note">Best on laptop — hides the browser UI while reading. Press Esc to exit.</p>
      </div>
    </div>
  `;
  const paintSeg = (el, val) => {
    el.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.v === val;
      b.classList.toggle('on', on);
      b.innerHTML = `${on ? '&#10003; ' : ''}${b.dataset.v === 'paged' ? '1-Page' : b.dataset.v[0].toUpperCase() + b.dataset.v.slice(1)}`;
    });
  };
  $('#rsMode').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    ctx.set({ mode: b.dataset.v });
    paintSeg($('#rsMode'), b.dataset.v);
  }));
  $('#rsDir').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    ctx.set({ direction: b.dataset.v });
    paintSeg($('#rsDir'), b.dataset.v);
  }));
  const flip = (id, key) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('click', () => {
      const on = !el.classList.contains('on');
      el.classList.toggle('on', on);
      el.setAttribute('aria-checked', on);
      ctx.set({ [key]: on });
    });
  };
  flip('#rsProgress', 'progress');
  flip('#rsNoMargin', 'noMargin');
  flip('#rsClickScroll', 'clickScroll');
  flip('#rsSmooth', 'smoothScroll');
  flip('#rsNoLazy', 'noLazy');
  flip('#rsAutoHide', 'autoHide');
  flip('#rsWake', 'wakeLock');
  flip('#rsFullscreen', 'fullscreen');
}

// Relative + absolute date strings for reader meta rows
function relDate(iso) {
  if (!iso) return { rel: '', abs: '' };
  const d = new Date(iso);
  const abs = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  const days = Math.floor((Date.now() - d.getTime()) / 864e5);
  const rel = days <= 0 ? 'today' : days === 1 ? '1 day ago'
    : days < 30 ? `${days} days ago`
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return { rel, abs };
}

// Load a creator-original chapter into the same shape the Comick branch
// produces, so both ride the shared reader below.
async function loadOriginalData(mangaId, chapterId) {
  const sid = mangaId.slice(5);
  const s = (await api(`/api/originals/${sid}`)).data;
  const chapters = (s.chaptersList || []).map((c) => ({
    id: String(c.id), num: c.num || '', title: c.title || '', pub: c.created_at,
  }));
  if (!chapters.length) throw new Error('This comic has no chapters yet');
  let idx = chapters.findIndex((c) => c.id === String(chapterId));
  if (idx === -1) idx = 0;
  const ch = (await api(`/api/originals/chapter/${chapters[idx].id}`)).data;
  const urls = ch.pages || [];
  if (!urls.length) throw new Error('This chapter has no pages yet');
  const cur = chapters[idx];
  const label = cur.num || cur.title || '?';
  const { rel, abs } = relDate(cur.pub);
  return {
    mangaTitle: s.title,
    coverSrc: s.cover || '',
    chapters, idx, urls, altUrls: [],
    updatedText: cur.pub ? `Updated ${rel}` : '',
    infoHtml: `You are reading <b>Chapter ${esc(label)} of ${esc(s.title)}</b> on <b>MyGhoulScans</b>.`
      + ` An original comic by <b>${esc(s.author || 'a reader')}</b> featuring <b>${urls.length} images</b>`
      + (abs ? ` and was last updated on <b>${esc(abs)}</b>` : '') + '.',
    chapterId: cur.id,
    qualityNote: '',
  };
}

// ---------- reader ----------
let readerCleanup = null;
let readerRunSeq = 0;
let lastReaderKey = '';
// Alt-source cache: normalized title -> [{ id, title, source, name }]
const altSrcCache = new Map();
function normTitleKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
// Same comic on other sources (title search, fuzzy title match, current
// title excluded). Cached per title for the session.
async function findAltSources(title, excludeId, excludeSource) {
  const key = normTitleKey(title);
  if (!key) return [];
  if (!altSrcCache.has(key)) {
    const p = (async () => {
      const list = await comickSources();
      const others = list.map((t) => t.id).filter((id) => id && id !== excludeSource);
      if (!others.length) return [];
      const names = new Map(list.map((t) => [t.id, t.name || t.id]));
      const { data } = await api(`/api/comick/search?q=${encodeURIComponent(title)}&sources=${encodeURIComponent(others.join(','))}`);
      const out = [];
      const seen = new Set([excludeId]);
      const nt = key.replace(/\s+/g, '');
      for (const m of data || []) {
        if (!m || !m.id || seen.has(m.id)) continue;
        seen.add(m.id);
        const nm = normTitleKey(m.title).replace(/\s+/g, '');
        if (!nm || (!nm.includes(nt) && !nt.includes(nm))) continue;
        out.push({ id: m.id, title: m.title || 'Untitled', source: m.source || '', name: names.get(m.source) || m.source || '' });
        if (out.length >= 8) break;
      }
      return out;
    })().catch(() => []);
    altSrcCache.set(key, p);
  }
  try { return await altSrcCache.get(key); } catch { return []; }
}
// Closest chapter by number on another source's feed (exact preferred).
function matchAltChapter(feed, num) {
  const list = (feed || []).filter((c) => c && c.url);
  if (!list.length) return null;
  const t = parseFloat(num);
  let best = null, bestD = Infinity;
  for (const c of list) {
    const n = parseFloat(c.number);
    if (!isNaN(t) && !isNaN(n)) {
      const d = Math.abs(n - t);
      if (d < bestD) { bestD = d; best = c; }
    } else if (!best && String(c.number ?? '') === String(num ?? '')) best = c;
  }
  return best || list[0];
}

async function renderReader(mangaId, chapterId, startPage) {
  if (!mangaId || !chapterId) return renderHome();
  // A new render supersedes any earlier one still awaiting API responses —
  // stale continuations must not touch the fresh DOM or double-wire events.
  readerCleanup?.dispose?.();
  readerCleanup = null;
  const myRun = ++readerRunSeq;
  // New chapter (not a same-page re-render): start at the top instead of
  // keeping the previous chapter's scroll position.
  const thisReaderKey = `${mangaId}|||${chapterId}`;
  if (thisReaderKey !== lastReaderKey) { lastReaderKey = thisReaderKey; try { window.scrollTo(0, 0); } catch {} }
  const alive = () => myRun === readerRunSeq;
  // Originals (creator comics) ride the same reader: mangaId looks like "orig:3".
  const isOrig = mangaId.startsWith('orig:');
  const titleHref = isOrig ? `#/original/${mangaId.slice(5)}` : `#/title/${mangaId}`;
  view.innerHTML = `
    <div class="rprog" id="rProgress" hidden><i></i></div>
    <div class="reader-top" id="readerTop">
      <div class="rbar-row1">
        <a class="rbar-logo" href="${titleHref}" title="Back to title" aria-label="Back to title"><img id="rCover" src="/assets/chibi.png" alt="" referrerpolicy="no-referrer" /></a>
        <div class="rbar-chap"><strong id="rChapNum">Chap ?</strong><span>English</span></div>
        <button class="rt-icon" id="rMenuBtn" title="Reader menu" aria-label="Reader menu" aria-haspopup="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
        </button>
        <div class="rbar-menu" id="rMenu" hidden>
          <button id="rGoTitle">Back to title</button>
          <button id="rGoHome">Home</button>
          <button id="rShare">Share chapter</button>
          <button id="rSettings">Reader settings</button>
          <button id="rTop">Go to top</button>
        </div>
      </div>
      <div class="rbar-row2">
        <select id="chapterSel" class="chapter-cb" aria-label="Select chapter"></select>
        <select id="srcSel" class="chapter-cb" aria-label="Reading source" title="Reading source" style="display:none"></select>
        <div class="rt-nav">
          <button class="btn ghost" id="prevBtn" title="Previous chapter" disabled>Prev</button>
          <button class="btn ghost" id="nextBtn" title="Next chapter" disabled>Next</button>
        </div>
      </div>
      <div class="rbar-meta"><span id="rUpdated"></span><span id="rCount"></span></div>
    </div>
    <div class="rinfo" id="rInfo" hidden></div>
    <div class="reader-pages" id="readerPages">${spinner()}</div>
    <div class="rpager hidden" id="rPager">
      <button id="pgPrev" aria-label="Previous page">&lsaquo;</button><span id="pgLbl"></span><button id="pgNext" aria-label="Next page">&rsaquo;</button>
    </div>
    <div class="rfabs" id="rFabs">
      <button class="rfab" id="fabRefresh" title="Reload pages" aria-label="Reload pages">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
      </button>
      <button class="rfab" id="fabChat" title="Reader comments" aria-label="Reader comments">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
      </button>
      <button class="rfab" id="fabShare" title="Share chapter" aria-label="Share chapter">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>
      </button>
      <button class="rfab" id="fabGear" title="Reader settings" aria-label="Reader settings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
    </div>
  `;
  const shareChapter = async () => {
    const url = location.href;
    if (navigator.share) {
      try { await navigator.share({ title: document.title, url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast('Link copied'); }
    catch (e) { toast('Copy this link: ' + url); }
  };
  const rMenu = $('#rMenu');
  $('#rMenuBtn').addEventListener('click', (e) => { e.stopPropagation(); rMenu.hidden = !rMenu.hidden; });
  // Document-level: attached in the guarded tail below so a superseded render
  // never leaks it (view-level listeners die with their DOM automatically).
  let onRMenuOut = (e) => {
    if (!rMenu.hidden && !e.target.closest('#rMenu,#rMenuBtn')) rMenu.hidden = true;
  };
  const hideRMenu = () => { rMenu.hidden = true; };
  let rp = readerPrefs();
  let setR = null;
  let refreshPages = () => toast('Pages still loading');
  const openRS = () => { if (setR) openReaderSettings({ get: () => ({ ...rp }), set: setR }); };
  $('#rGoTitle').addEventListener('click', () => { location.hash = titleHref; });
  $('#rGoHome').addEventListener('click', () => { location.hash = '#/'; });
  $('#rShare').addEventListener('click', () => { hideRMenu(); shareChapter(); });
  $('#rSettings').addEventListener('click', () => { hideRMenu(); openRS(); });
  $('#rTop').addEventListener('click', () => { hideRMenu(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('#fabRefresh').addEventListener('click', () => refreshPages());
  $('#fabChat').addEventListener('click', () => {
    const c = view.querySelector('.comments');
    if (c) c.scrollIntoView({ behavior: 'smooth' });
    else toast('No comments yet');
  });
  $('#fabShare').addEventListener('click', shareChapter);
  $('#fabGear').addEventListener('click', openRS);

  try {
    // Normalized chapter data — Comick and creator Originals share the
    // whole reader below this branch.
    // { mangaTitle, coverSrc, chapters:[{id,num,title,pub}], idx,
    //   urls, altUrls, updatedText, infoHtml, chapterId, qualityNote }
    let DATA;
    if (isOrig) {
      DATA = await loadOriginalData(mangaId, chapterId);
      if (!alive()) return;
    } else {
    // Comick source branch: title + chapter list from our server adapter,
    // page images scraped from the source chapter page.
    const encId = encodeURIComponent(mangaId);
    const titleInfo = (await api(`/api/comick/title?id=${encId}`)).data;
    const mangaTitle = titleInfo.title || 'Untitled';
    const feed = (await api(`/api/comick/chapters?id=${encId}`)).data || [];
    if (!alive()) return;

    let idx = feed.findIndex((c) => c.url === chapterId);
    if (idx === -1) {
      // Stale/unknown chapter link (bookmark, history, shared URL): land on
      // the lowest-numbered chapter instead of assuming "Chapter 1" exists.
      const first = firstChapter(feed);
      idx = first ? feed.indexOf(first) : 0;
      if (idx === -1) idx = 0;
    }

    // A chapter page can fail to yield images (blocked/removed) — skip
    // forward (up to 5) to the next readable chapter instead of dying.
    let cid = null, urls = [];
    for (let i = idx; i < feed.length && i < idx + 5; i++) {
      try {
        const pg = await api(`/api/comick/pages?url=${encodeURIComponent(feed[i].url)}`);
        if (pg.data && pg.data.length) { cid = feed[i].url; urls = pg.data; idx = i; break; }
      } catch (e) {
        if (e.status && e.status < 500 && e.status !== 404 && e.status !== 502) throw e;
      }
    }
    if (!alive()) return;

    if (!cid) {
      view.innerHTML = `
        <div class="reader-top">
          <button class="btn ghost" id="backBtn">&larr; Title</button>
          <span class="rtitle">${esc(mangaTitle)}</span>
        </div>
        <div class="centered" style="margin-top:80px">
          <h3>Chapter unavailable</h3>
          <p class="small">This chapter has no readable pages on ${esc(mangaTitle)} right now.</p>
          <button class="btn primary" id="gobackBtn">Back to title</button>
        </div>`;
      $('#gobackBtn').addEventListener('click', () => { location.hash = titleHref; });
      const ubBack = $('#backBtn');
      if (ubBack) ubBack.addEventListener('click', () => { location.hash = titleHref; });
      return;
    }

    // keep the URL in sync with the chapter actually rendered
    if (cid !== chapterId) {
      try { history.replaceState(null, '', prettyFor(`#/reader/${mangaId}/${encodeURIComponent(cid)}/0`)); } catch {}
    }

    const chapters = feed.map((c) => ({
      id: c.url,
      num: (c.number || c.number === 0) ? String(c.number) : '',
      title: c.title && c.title !== `Chapter ${c.number}` ? c.title : '',
      pub: null,
    }));
    const cur = chapters[idx] || {};
    DATA = {
      mangaTitle,
      coverSrc: titleInfo.cover ? `/api/img?u=${encodeURIComponent(titleInfo.cover)}` : '',
      chapters, idx, urls, altUrls: [],
      updatedText: titleInfo.source ? `via ${titleInfo.source}` : '',
      infoHtml: `You are reading <b>Chapter ${esc(cur.num || '?')} of ${esc(mangaTitle)}</b> on <b>MyGhoulScans</b>.`
        + ` This comic features <b>${urls.length} images</b> from <b>${esc(titleInfo.source || 'the source')}</b>.`,
      chapterId: cid,
      qualityNote: '',
    };
    } // end Comick branch

    const { mangaTitle, coverSrc, chapters, idx, urls, altUrls,
      updatedText, infoHtml, chapterId: cid, qualityNote } = DATA;
    const rCover = $('#rCover');
    if (rCover && coverSrc) { rCover.src = coverSrc; rCover.alt = mangaTitle; }
    const curCh = chapters[idx] || {};
    const chapterLabel = curCh.num || curCh.title || '';
    updateRouteMeta('reader', `Chap ${chapterLabel || '?'} of ${mangaTitle}`, `Read Chap ${chapterLabel || '?'} of ${mangaTitle} online free on MyGhoulScans.`);

    // Chapter selector dropdown at the top of the reader
    const chLabel = (c) => `Ch. ${c.num || '?'}${c.title ? ' · ' + c.title : ''}`;
    $('#rChapNum').textContent = `Chap ${chapterLabel || '?'}`;
    $('#rUpdated').textContent = updatedText || '';
    $('#rCount').textContent = `${urls.length} images`;
    const rInfo = $('#rInfo');
    rInfo.innerHTML = infoHtml;
    rInfo.hidden = false;
    const chSel = $('#chapterSel');
    chSel.innerHTML = chapters
      .map((c) => `<option value="${esc(c.id)}" ${String(c.id) === String(cid) ? 'selected' : ''}>${esc(chLabel(c))}</option>`)
      .join('');
    chSel.addEventListener('change', () => { location.hash = `#/reader/${mangaId}/${encodeURIComponent(chSel.value)}/0`; });

    // Alt-source switcher (reader-only): same comic on other sources.
    // Hidden unless alternates exist; jumps to the same chapter number.
    const srcSel = $('#srcSel');
    const curSrc = String(mangaId).split(':')[1] || '';
    const paintSrcSel = (alts, names) => {
      if (!srcSel) return;
      const curLabel = (names && names.get(curSrc)) || titleInfo.source || curSrc || 'Current source';
      srcSel.innerHTML = `<option value="${esc(mangaId)}">${esc(curLabel)} (current)</option>` +
        alts.map((a) => `<option value="${esc(a.id)}">${esc(a.name || a.source)}${a.title && normTitleKey(a.title) !== normTitleKey(mangaTitle) ? ' — ' + esc(a.title.slice(0, 28)) : ''}</option>`).join('');
      srcSel.value = mangaId;
      srcSel.style.display = alts.length ? '' : 'none';
      srcSel.disabled = false;
    };
    if (srcSel && !isOrig) {
      try {
        const list = await comickSources();
        paintSrcSel([], new Map(list.map((t) => [t.id, t.name || t.id])));
      } catch { paintSrcSel([], null); }
      srcSel.addEventListener('change', async () => {
        const nid = srcSel.value;
        if (!nid || nid === mangaId) return;
        srcSel.disabled = true;
        try {
          const feed2 = (await api(`/api/comick/chapters?id=${encodeURIComponent(nid)}`)).data || [];
          const curNum = (chapters[idx] && chapters[idx].num) || '';
          const m = matchAltChapter(feed2, curNum);
          if (!m) { toast('No chapters found on that source'); srcSel.value = mangaId; }
          else {
            if (curNum !== '' && String(m.number ?? '') !== String(curNum)) toast(`Opened Ch. ${m.number ?? '?'} (closest match)`);
            location.hash = `#/reader/${nid}/${encodeURIComponent(m.url)}/0`;
          }
        } catch (e) { toast(e.message); srcSel.value = mangaId; }
        if (document.contains(srcSel)) srcSel.disabled = false;
      });
      findAltSources(mangaTitle, mangaId, curSrc).then((alts) => {
        if (!alive() || !document.contains(srcSel)) return;
        if (!alts.length) { srcSel.style.display = 'none'; return; }
        comickSources().then((list) => {
          if (!alive() || !document.contains(srcSel)) return;
          paintSrcSel(alts, new Map(list.map((t) => [t.id, t.name || t.id])));
        }).catch(() => {
          if (!alive() || !document.contains(srcSel)) return;
          paintSrcSel(alts, null);
        });
      });
    } else if (srcSel) {
      srcSel.style.display = 'none';
    }

    const pagesEl = view.querySelector('#readerPages');
    // Lazily load pages near the viewport (eager for the first few) so a chapter
    // starts instantly instead of waiting on every image at once.
    const endCard = `
      <div class="reader-end">
        <div class="centered small" style="margin:0">End of chapter</div>
        <button class="btn primary end-next" id="endNextBtn">Next chapter</button>
        <div class="end-row">
          <button class="btn ghost" id="endPrevBtn">&lsaquo; Prev</button>
          <button class="btn ghost" id="endTopBtn">&uarr; Top</button>
          <button class="btn ghost" id="endTitleBtn">Title</button>
        </div>
      </div>`;
    pagesEl.innerHTML = urls
      .map((u, i) => `<img class="page-img" data-page="${i}" data-src="${u}" referrerpolicy="no-referrer" alt="page ${i + 1}" />`)
      .join('') + endCard;

    const commentsEl = document.createElement('section');
    commentsEl.className = 'comments';
    view.appendChild(commentsEl);
    renderComments(commentsEl, mangaId, cid);

    const imgs = pagesEl.querySelectorAll('img');
    const retryBtn = document.createElement('div');
    retryBtn.className = 'centered small retry-btn';
    retryBtn.textContent = 'Retry failed pages';
    retryBtn.style.display = 'none';
    const stamp = (img) => { img.dataset.t0 = Date.now(); };
    const dropFailCard = (img) => {
      const nx = img.nextElementSibling;
      if (nx && nx.classList && nx.classList.contains('page-fail')) nx.remove();
    };
    const showFailCard = (img, i) => {
      const nx = img.nextElementSibling;
      if (nx && nx.classList && nx.classList.contains('page-fail')) return;
      const d = document.createElement('button');
      d.className = 'page-fail';
      d.type = 'button';
      d.innerHTML = `<span>Page ${i + 1} couldn't load</span><b>Tap to retry</b>`;
      d.addEventListener('click', () => { d.remove(); delete img.dataset.aretry; retryImg(img, i, true); });
      img.after(d);
    };
    const markFailed = (img, i) => {
      img.classList.add('img-failed');
      img.alt = `[page ${i + 1} failed to load]`;
      showFailCard(img, i);
      retryBtn.style.display = '';
    };
    // Retry one page, alternating quality on each failed attempt so a dead
    // file in one quality falls back to the other (either direction).
    // Watchdog auto-retries are capped; manual taps are not.
    const retryImg = (img, i, manual = false) => {
      const primary = img.dataset.src;
      if (!primary) return false;
      if (!manual) {
        const n = (+img.dataset.aretry || 0) + 1;
        img.dataset.aretry = n;
        if (n > 4) { markFailed(img, i); return false; }
      } else {
        delete img.dataset.aretry;
      }
      const alt = altUrls[i];
      let target = primary;
      if (img.classList.contains('img-failed') && alt) {
        const lastWasAlt = img.dataset.lastTry === 'alt';
        target = lastWasAlt ? primary : alt;
        img.dataset.lastTry = lastWasAlt ? 'primary' : 'alt';
      }
      img.classList.remove('img-failed');
      dropFailCard(img);
      img.alt = `page ${i + 1}`;
      try {
        const u = new URL(target, location.origin);
        u.searchParams.set('t', Date.now().toString(36) + i);
        img.src = u.toString();
      } catch { img.src = target; }
      stamp(img);
      try { loadIO?.observe?.(img); } catch {}
      return true;
    };
    let stallTimer = null;
    retryBtn.onclick = () => {
      imgs.forEach((img, j) => { if (img.classList.contains('img-failed')) retryImg(img, j, true); });
      retryBtn.style.display = 'none';
    };
    pagesEl.appendChild(retryBtn);

    // Reload button: only refresh the page pictures in place (retry failed /
    // load pending ones with a cache-buster). No full reload, no jump to top.
    refreshPages = () => {
      let n = 0;
      imgs.forEach((img, i) => {
        const wasFailed = img.classList.contains('img-failed');
        const missing = !img.getAttribute('src');
        const stalled = !!img.getAttribute('src') && (!img.complete || img.naturalWidth === 0);
        if (!wasFailed && !missing && !stalled) return;
        if (retryImg(img, i, true)) n++;
      });
      retryBtn.style.display = 'none';
      toast(n ? `Reloading ${n} page${n > 1 ? 's' : ''}` : 'All pages already loaded');
    };

    imgs.forEach((img, i) => {
      img.addEventListener('load', () => {
        img.classList.remove('img-failed');
        img.classList.add('ld'); // real pixels in: drop the shimmer box, keep natural aspect
        delete img.dataset.t0;
        delete img.dataset.aretry;
        dropFailCard(img);
      });
      img.addEventListener('error', () => {
        const alt = altUrls[i];
        if (alt && img.dataset.lastTry !== 'alt') { img.dataset.lastTry = 'alt'; img.src = alt; stamp(img); return; }
        markFailed(img, i);
      });
      // Already cached before listeners attached: mark synchronously.
      if (img.complete && img.naturalWidth) img.classList.add('ld');
    });

    // Eagerly start the first couple of pages so there's something to read while
    // the rest load on approach.
    imgs.forEach((img, i) => { if (i < 3) { img.src = img.dataset.src; stamp(img); } });
    let loadIO = null;
    if ('IntersectionObserver' in window) {
      loadIO = new IntersectionObserver((entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const el = en.target;
          if (!el.src && el.dataset.src) { el.src = el.dataset.src; stamp(el); }
          loadIO.unobserve(el);
        }
      }, { rootMargin: '900px 0px' });
      imgs.forEach((img) => loadIO.observe(img));
    } else {
      imgs.forEach((img) => { img.src = img.dataset.src; stamp(img); });
    }

    // Stall watchdog: a page whose request hangs (no load, no error) would
    // shimmer forever — nudge it onto the alternate quality instead.
    stallTimer = setInterval(() => {
      const now = Date.now();
      imgs.forEach((img, i) => {
        if (img.classList.contains('img-failed')) return;
        const t0 = +img.dataset.t0 || 0;
        if (!t0 || !img.getAttribute('src')) return;
        if (img.complete && img.naturalWidth > 0) { delete img.dataset.t0; return; }
        if (now - t0 > 25000) retryImg(img, i);
      });
    }, 10000);

    const savePage = (page) => {
      // Guests are never tracked — history starts only after sign-in.
      if (!currentUser) return;
      api(`/api/progress/${mangaId}`, { method: 'POST', body: JSON.stringify({ chapterId: cid, page, chapterLabel }) }).catch(() => {});
    };
    savePage(startPage);
    // read counter — increments when a chapter is actually opened
    api('/api/reads', { method: 'POST', body: JSON.stringify({ mangaId, chapterId: cid }) }).catch(() => {});

    const visible = new Set();
    let progIO = null;
    if ('IntersectionObserver' in window) {
      progIO = new IntersectionObserver((entries) => {
        for (const en of entries) {
          if (en.isIntersecting) visible.add(parseInt(en.target.dataset.page, 10));
          else visible.delete(parseInt(en.target.dataset.page, 10));
        }
        if (visible.size) savePage(Math.max(...visible));
      }, { rootMargin: '-10% 0px -10% 0px' });
      imgs.forEach((img) => progIO.observe(img));
    }

    const prev = idx > 0 ? chapters[idx - 1] : null;
    const next = idx < chapters.length - 1 ? chapters[idx + 1] : null;
    const prevBtn = $('#prevBtn'), nextBtn = $('#nextBtn');
    if (prev) { prevBtn.disabled = false; prevBtn.addEventListener('click', () => { location.hash = `#/reader/${mangaId}/${encodeURIComponent(prev.id)}/0`; }); }
    else prevBtn.disabled = true;
    if (next) { nextBtn.disabled = false; nextBtn.addEventListener('click', () => { location.hash = `#/reader/${mangaId}/${encodeURIComponent(next.id)}/0`; }); }
    else nextBtn.disabled = true;

    // bottom-of-chapter nav — this is where "next" lives on mobile
    const endNext = $('#endNextBtn'), endPrev = $('#endPrevBtn');
    const goTo = (id) => () => { location.hash = `#/reader/${mangaId}/${encodeURIComponent(id)}/0`; };
    const backHome = () => { location.hash = titleHref; };
    if (next) endNext.addEventListener('click', goTo(next.id));
    else {
      endNext.textContent = 'Back to title';
      endNext.addEventListener('click', backHome);
    }
    if (prev) endPrev.addEventListener('click', goTo(prev.id));
    else endPrev.hidden = true;
    $('#endTopBtn').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    $('#endTitleBtn').addEventListener('click', backHome);
    if (qualityNote) toast(qualityNote);

    // Reader prefs → live behaviors (driven by the Reader Settings sheet)
    const rProg = $('#rProgress');
    const rPager = $('#rPager');
    const pgPrev = $('#pgPrev'), pgNext = $('#pgNext'), pgLbl = $('#pgLbl');
    const loadAll = () => { imgs.forEach((img) => { if (!img.src && img.dataset.src) { img.src = img.dataset.src; stamp(img); } }); };
    let paged = false;
    let pageIdx = Math.max(0, Math.min(startPage || 0, urls.length - 1));
    const updateProgress = () => {
      if (!rProg || rProg.hidden) return;
      let frac = 0;
      if (paged) frac = urls.length ? (pageIdx + 1) / urls.length : 0;
      else {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        frac = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      }
      rProg.firstElementChild.style.width = `${Math.round(frac * 100)}%`;
    };
    const layoutPager = () => { if (rPager) rPager.classList.toggle('rev', rp.direction === 'left'); };
    let lastProgJump = 0;
    const paintPage = () => {
      imgs.forEach((im, i) => im.classList.toggle('cur', i === pageIdx));
      if (pgLbl) pgLbl.textContent = `${pageIdx + 1} / ${urls.length}`;
      updateProgress();
    };
    const goPage = (i) => {
      if (i < 0) { if (prev) location.hash = `#/reader/${mangaId}/${encodeURIComponent(prev.id)}/0`; return; }
      if (i >= urls.length) { if (next) location.hash = `#/reader/${mangaId}/${encodeURIComponent(next.id)}/0`; return; }
      pageIdx = i;
      const im = imgs[pageIdx];
      if (im && !im.src && im.dataset.src) { im.src = im.dataset.src; stamp(im); }
      savePage(pageIdx);
      paintPage();
      lastProgJump = Date.now();
      pagesEl.scrollIntoView({ block: 'start' });
    };
    if (pgPrev) pgPrev.addEventListener('click', () => goPage(pageIdx - 1));
    if (pgNext) pgNext.addEventListener('click', () => goPage(pageIdx + 1));
    const applyMode = (mode) => {
      paged = mode === 'paged';
      pagesEl.classList.toggle('paged', paged);
      if (rPager) { rPager.classList.toggle('hidden', !paged); layoutPager(); }
      if (paged) {
        pageIdx = Math.max(0, Math.min(startPage || 0, urls.length - 1));
        const im = imgs[pageIdx];
        if (im && !im.src && im.dataset.src) { im.src = im.dataset.src; stamp(im); }
        savePage(pageIdx);
        paintPage();
        lastProgJump = Date.now();
        pagesEl.scrollIntoView({ block: 'start' });
      }
      updateProgress();
    };
    let wakeS = null;
    const applyWake = async (on) => {
      try {
        if (on && 'wakeLock' in navigator) wakeS = await navigator.wakeLock.request('screen');
        else { try { await wakeS?.release?.(); } catch {} wakeS = null; }
      } catch {}
    };
    const onRVis = () => { if (document.visibilityState === 'visible' && rp.wakeLock) applyWake(true); };
    document.addEventListener('visibilitychange', onRVis);
    const applyFullscreen = async (on) => {
      try {
        if (on) {
          if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
        } else if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
      } catch (e) {
        rp.fullscreen = !!document.fullscreenElement;
        savePrefs({ ...loadPrefs(), reader: { ...rp } });
        const cb = $('#rsFullscreen');
        if (cb) { cb.classList.toggle('on', rp.fullscreen); cb.setAttribute('aria-checked', String(rp.fullscreen)); }
        toast('Fullscreen not available here');
      }
    };
    const onFsChange = () => {
      const on = !!document.fullscreenElement;
      document.body.classList.toggle('is-fullscreen', on);
      if (rp.fullscreen === on) return;
      rp.fullscreen = on;
      savePrefs({ ...loadPrefs(), reader: { ...rp } });
      const cb = $('#rsFullscreen');
      if (cb) { cb.classList.toggle('on', on); cb.setAttribute('aria-checked', String(on)); }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    setR = (patch) => {
      Object.assign(rp, patch);
      savePrefs({ ...loadPrefs(), reader: { ...rp } });
      if ('mode' in patch) applyMode(rp.mode);
      if ('direction' in patch) layoutPager();
      if ('progress' in patch) { if (rProg) rProg.hidden = !rp.progress; updateProgress(); }
      if ('noMargin' in patch) pagesEl.classList.toggle('no-margin', rp.noMargin);
      if ('noLazy' in patch && rp.noLazy) loadAll();
      if ('autoHide' in patch && !rp.autoHide) setTools(false);
      if ('wakeLock' in patch) applyWake(rp.wakeLock);
      if ('fullscreen' in patch) applyFullscreen(rp.fullscreen);
    };
    pagesEl.classList.toggle('no-margin', rp.noMargin);
    if (rProg) rProg.hidden = !rp.progress;
    if (rp.noLazy) loadAll();
    if (rp.wakeLock) applyWake(true);
    // Fullscreen needs a user gesture, so a persisted true can never apply on
    // load — sync the pref back to reality instead of showing a lie.
    if (rp.fullscreen && !document.fullscreenElement) {
      rp.fullscreen = false;
      savePrefs({ ...loadPrefs(), reader: { ...rp } });
    }
    document.body.classList.toggle('is-fullscreen', !!document.fullscreenElement);
    if (rp.mode === 'paged') applyMode('paged');

    // Reader chrome: hide the top bar + floating buttons while scrolling down
    // (mobile and laptop alike) and summon them back by scrolling up or
    // tapping/clicking the page. The floating action buttons and pager
    // follow the same tools state.
    const topEl = view.querySelector('#readerTop');
    const fabsEl = view.querySelector('#rFabs');
    let lastRY = window.scrollY, tickR = false;
    const setTools = (hidden) => {
      topEl.classList.toggle('hidden-up', hidden);
      if (fabsEl) fabsEl.classList.toggle('hidden', hidden);
      if (rPager && !rPager.classList.contains('hidden')) rPager.classList.toggle('tb-hidden', hidden);
    };
    const onRScroll = () => {
      if (!tickR) {
        tickR = true;
        requestAnimationFrame(() => {
          tickR = false;
          const y = window.scrollY, dy = y - lastRY;
          lastRY = y;
          updateProgress();
          if (!rp.autoHide) return;
          if (Date.now() - lastProgJump < 600) {
            if (dy < -6 || y <= 80) setTools(false);
            return;
          }
          if (y > 80 && dy > 6) setTools(true);
          else if (dy < -6 || y <= 80) setTools(false);
        });
      }
    };
    const onRTap = (e) => {
      if (e.target.closest('button, select, a, input, textarea, .retry-btn')) return;
      if (!paged && rp.clickScroll && e.target.closest('img.page-img')) {
        window.scrollBy({ top: Math.round(window.innerHeight * 0.85), behavior: rp.smoothScroll ? 'smooth' : 'auto' });
        return;
      }
      setTools(!topEl.classList.contains('hidden-up'));
    };
    const onRHash = () => { setTools(false); lastRY = window.scrollY; };
    window.addEventListener('scroll', onRScroll, { passive: true });
    pagesEl.addEventListener('click', onRTap);
    window.addEventListener('hashchange', onRHash);
    document.addEventListener('click', onRMenuOut);
    if (paged) setTools(false);

    let readerKeys;
    document.addEventListener('keydown', readerKeys = (e) => {
      if (paged && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const step = (e.key === 'ArrowRight') === (rp.direction === 'right') ? 1 : -1;
        goPage(pageIdx + step);
        return;
      }
      if (e.key === 'ArrowLeft' && prev) { location.hash = `#/reader/${mangaId}/${encodeURIComponent(prev.id)}/0`; }
      if (e.key === 'ArrowRight' && next) { location.hash = `#/reader/${mangaId}/${encodeURIComponent(next.id)}/0`; }
    });
    readerCleanup = {
      dispose: () => {
        document.removeEventListener('keydown', readerKeys);
        window.removeEventListener('scroll', onRScroll);
        pagesEl.removeEventListener('click', onRTap);
        window.removeEventListener('hashchange', onRHash);
        if (onRMenuOut) document.removeEventListener('click', onRMenuOut);
        document.removeEventListener('visibilitychange', onRVis);
        document.removeEventListener('fullscreenchange', onFsChange);
        if (stallTimer) clearInterval(stallTimer);
        try { const w = wakeS; wakeS = null; if (w && w.release) w.release().catch(() => {}); } catch {}
        loadIO?.disconnect?.(); progIO?.disconnect?.();
      },
    };
  } catch (e) {
    view.innerHTML = `<div class="centered">Could not load chapter: ${esc(e.message)}</div>`;
  }
}

window.addEventListener('hashchange', () => { readerCleanup?.dispose?.(); readerCleanup?.disconnect?.(); });

// ---------- chapter comments ----------
function fmtTime(iso) {
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z');
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function renderComments(container, mangaId, chapterId) {
  container.innerHTML = `<h2 class="page-title" style="font-size:18px">Reader comments</h2>`;
  let res;
  try {
    res = await api(`/api/comments?chapter=${encodeURIComponent(chapterId)}`);
  } catch (e) {
    container.querySelector('.comment-list')?.remove();
    container.innerHTML += `<div class="note">Comments unavailable: ${esc(e.message)}</div>`;
    return;
  }
  const { data: comments, canPost, blockedCount } = res;

  const form = canPost
    ? `<div class="comment-form">
        <textarea id="commentBody" maxlength="2000" placeholder="What did you think of this chapter? (sign in to post — enjoy the conversation if you did)"></textarea>
        <button class="btn primary" id="commentPost">Post</button>
      </div>`
    : `<div class="comment-login">Sign in to leave a comment under this chapter. <button class="btn primary" id="commentLogin">Log in / Sign up</button></div>`;

  let list = comments.length
    ? `<div class="comment-list">${comments.map(commentItem).join('')}</div>`
    : `<div class="centered small">No comments yet — start the discussion.</div>`;

  if (blockedCount) list += `<div class="small" style="margin-top:10px;color:var(--muted)">${blockedCount} removed comment${blockedCount > 1 ? 's' : ''} (hidden).</div>`;

  container.innerHTML = `<h2 class="page-title" style="font-size:18px">Reader comments</h2>${form}${list}`;

  $('#commentLogin')?.addEventListener('click', () => openAuthModal(false));
  $('#commentPost')?.addEventListener('click', async () => {
    const body = $('#commentBody').value.trim();
    if (!body) return;
    try {
      await api('/api/comments', { method: 'POST', body: JSON.stringify({ mangaId, chapterId, body }) });
      $('#commentBody').value = '';
      renderComments(container, mangaId, chapterId);
    } catch (e) { toast(e.message); }
  });
  container.querySelectorAll('.vote-btn').forEach((b) => b.addEventListener('click', async () => {
    if (!currentUser) return openAuthModal(false);
    try {
      await api(`/api/comments/${b.dataset.id}/vote`, { method: 'POST', body: JSON.stringify({ vote: parseInt(b.dataset.vote, 10) }) });
      renderComments(container, mangaId, chapterId);
    } catch (e) { toast(e.message); }
  }));
  container.querySelectorAll('.del-btn').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/comments/${b.dataset.id}`, { method: 'DELETE' });
      toast('Comment deleted');
      renderComments(container, mangaId, chapterId);
    } catch (e) { toast(e.message); }
  }));
}

function commentItem(c) {
  const authorName = nameColorHtml(c.display_name || 'Reader', c.name_color);
  const face = `<span class="comment-avatar${c.frame ? ` av-frame-${esc(String(c.frame).replace(/[^a-z-]/g, ''))}` : ''}">${esc((c.display_name || 'Reader')[0].toUpperCase())}</span>`;
  return `
    <div class="comment-item ${c.pinned ? 'pinned' : ''}">
      <div class="comment-meta">
        <span class="comment-author">${wrapAvatarFrame(face, c.frame)} ${authorName}${titleBadgeHtml(c.title)}</span>
        <span class="comment-time">${esc(fmtTime(c.created_at))}</span>
      </div>
      <div class="comment-body">${esc(c.body)}</div>
      <div class="comment-actions">
        <span class="comment-votes">
          <button class="vote-btn up ${c.my_vote === 1 ? 'on' : ''}" data-id="${c.id}" data-vote="1">▲ <span>${c.likes}</span></button>
          <button class="vote-btn down ${c.my_vote === -1 ? 'on' : ''}" data-id="${c.id}" data-vote="-1">▼ <span>${c.dislikes}</span></button>
        </span>
        ${c.pinned ? '<span class="pin-badge">Pinned &#9733;</span>' : ''}
        ${c.mine ? `<button class="del-btn" data-id="${c.id}" title="Delete comment">Delete</button>` : ''}
      </div>
    </div>`;
}

// ---------- recommendations ----------
function recItemRow(m) {
  const img = proxiedCover(m);
  return `<label class="rec-item">
    ${img ? `<img class="rec-cover" loading="lazy" referrerpolicy="no-referrer" src="${img}" alt="" />` : '<div class="rec-cover"></div>'}
    <span class="rec-name">${esc(titleOf(m))}</span>
    <input type="checkbox" class="rec-check" value="${esc(m.id)}" />
  </label>`;
}

async function openRecModal(mangaId) {
  if (!currentUser) return openAuthModal(false);
  let ids, picks = new Set();
  try {
    ({ data: ids } = await api('/api/history'));
    if (!ids.length) { toast('You haven\u2019t read or followed any titles yet'); return; }
    const recRes = await api(`/api/recs?manga=${encodeURIComponent(mangaId)}`);
    recRes.data.forEach((r) => { if (r.mine) picks.add(r.id); });
  } catch (e) { return toast(e.message); }
  const clean = ids.filter((id) => id !== mangaId);
  if (!clean.length) { toast('That\u2019s the only title in your history'); return; }

  $('#modal').classList.remove('hidden');
  $('#modalContent').innerHTML = `
    <h2>Recommend similar titles</h2>
    <p class="small" style="margin-bottom:10px">Pick titles you've read that feel like this one. They'll appear under "Recommended by readers".</p>
    <div class="rec-picklist" id="recPick">${spinner()}</div>
    <button class="btn primary" id="recSave" style="width:100%;margin-top:14px">Save recommendations</button>
  `;
  try {
    const byId = await resolveComickIds(clean.slice(0, 60));
    const items = clean.filter((id) => byId.has(id)).map((id) => byId.get(id));
    $('#recPick').innerHTML = items.map((m) => {
      const row = recItemRow(m);
      return row.replace('<input type="checkbox" class="rec-check"', `<input type="checkbox" class="rec-check" ${picks.has(m.id) ? 'checked' : ''}`);
    }).join('') || '<span class="small">Nothing to pick from yet.</span>';
  } catch (e) { $('#recPick').innerHTML = `<span class="small">${esc(e.message)}</span>`; }

  $('#recSave').addEventListener('click', async () => {
    const chosen = new Set([...$('#recPick').querySelectorAll('.rec-check:checked')].map((c) => c.value));
    const toastTxt = [];
    try {
      for (const id of chosen) if (!picks.has(id)) { await api('/api/recs', { method: 'POST', body: JSON.stringify({ mangaId, recId: id }) }); toastTxt.push('added'); }
      for (const id of picks) if (!chosen.has(id)) { await api('/api/recs', { method: 'DELETE', body: JSON.stringify({ mangaId, recId: id }) }); toastTxt.push('removed'); }
      closeModal();
      toast(toastTxt.length ? 'Recommendations saved' : 'No changes');
      fillRecRow(mangaId);
    } catch (e) { toast(e.message); }
  });
}

async function fillRecRow(mangaId) {
  const row = $('#recRow');
  if (!row) return;
  try {
    const { data } = await api(`/api/recs?manga=${encodeURIComponent(mangaId)}`);
    if (!data.length) {
      row.innerHTML = '<div class="centered small" style="width:100%;text-align:left">No reader recommendations yet — be the first!</div>';
      return;
    }
    const byId = await resolveComickIds(data.map((r) => r.id));
    const items = data.map((r) => r.id).filter((id) => byId.has(id)).map((id) => byId.get(id));
    if (!items.length) {
      row.innerHTML = '<div class="centered small" style="width:100%;text-align:left">No reader recommendations yet — be the first!</div>';
      return;
    }
    row.innerHTML = items.map((m) => mangaCard(m, { h: true })).join('');
    wireCards(row);
  } catch {
    row.innerHTML = '<div class="centered small">Could not load recommendations</div>';
  }
}

// "More like this": same-genre titles as the one being viewed, merged across
// all major sources. Genre names from title details are matched against the
// live genre menu (case-insensitive); unmatched names are slugified.
async function fillSimilarRow(mangaId, genres) {
  const sect = $('#simSect');
  const row = $('#simRow');
  if (!sect || !row) return;
  const names = [...new Set((genres || []).map((g) => String(g).trim()).filter(Boolean))].slice(0, 3);
  if (!names.length) return;
  sect.style.display = '';
  try {
    let menu = [];
    try { menu = await comickGenres(); } catch {}
    const byName = new Map(menu.map((g) => [String(g.name || '').toLowerCase(), g.id]));
    const slugs = names
      .map((n) => byName.get(n.toLowerCase()) || n.toLowerCase().replace(/\s+/g, '-'))
      .filter(Boolean);
    if (!slugs.length) { sect.style.display = 'none'; return; }
    const needFilter = !loadPrefs().mature;
    const seen = new Set([mangaId]);
    const acc = [];
    for (const slug of slugs) {
      if (acc.length >= 18) break;
      let items = [];
      try {
        items = await fanout(MAJOR_SOURCES, (s) => `/api/comick/genre?source=${encodeURIComponent(s)}&genre=${encodeURIComponent(slug)}&page=1&enrich=1`);
      } catch { continue; }
      if (needFilter) items = applyMatureFilter(items);
      for (const m of (items || [])) {
        if (!m || !m.id || seen.has(m.id)) continue;
        seen.add(m.id);
        acc.push(m);
        if (acc.length >= 18) break;
      }
      if (!document.getElementById('simRow')) return;
    }
    if (!acc.length) { sect.style.display = 'none'; return; }
    row.innerHTML = acc.map((m) => mangaCard(m, { h: true })).join('');
    wireCards(row);
  } catch {
    sect.style.display = 'none';
  }
}

// ---------- library ----------
// Short relative time ("3 days ago") for library columns.
function relTime(ts) {
  if (!ts) return '';
  try { return relDate(String(ts).replace(' ', 'T') + 'Z').rel; } catch { return ''; }
}
async function renderLibrary() {
  // Library (bookmarks) is signed-in only — same on mobile and laptop
  if (!currentUser) {
    view.innerHTML = `<div class="centered">
      <h3>Sign in to use your library</h3>
      <p class="small">Bookmark comics to keep them here on any device.</p>
      <button class="btn primary" id="libLogin">Log in / Sign up</button>
    </div>`;
    $('#libLogin').addEventListener('click', () => openAuthModal(false));
    return;
  }
  view.innerHTML = `<div class="page-title">My Library <button class="btn ghost" id="libClear" style="margin-left:8px;font-size:12px;padding:4px 10px">Clear all</button></div><div id="libWrap"><div class="centered">${spinner()}</div></div>`;
  $('#libClear')?.addEventListener('click', async () => {
    if (!confirm('Remove every title from your library (this browser + account)?')) return;
    if (await clearAllLibrary()) { toast('Library cleared'); route(); }
  });
  let mangaIds = [];
  let added = {};
  try {
    const r = await api('/api/library');
    mangaIds = r.mangaIds || [];
    added = r.added || {};
    setLocalBookmarks(new Set(mangaIds));
  } catch { mangaIds = [...localBookmarks()]; }
  if (!mangaIds.length) {
    view.innerHTML = `<div class="centered">Your library is empty. Bookmark comics you want to keep reading &mdash; use the &#128279; icon on any card or the &ldquo;Bookmark&rdquo; button on a title page.</div>`;
    return;
  }
  // Reading progress per title (resume links + recency sorts).
  const progById = new Map();
  try {
    const { items } = await api('/api/progress');
    for (const it of items || []) progById.set(it.manga_id, it);
  } catch {}
  // Resolve comick titles + chapter totals (best-effort, capped).
  const cxIds = mangaIds.filter((id) => String(id).startsWith('cx:')).slice(0, 30);
  const byId = await resolveComickIds(cxIds);
  const totals = new Map();
  await Promise.all(cxIds.filter((id) => byId.has(id)).map(async (id) => {
    try {
      const feed = (await api(`/api/comick/chapters?id=${encodeURIComponent(id)}`)).data || [];
      let mx = null, mn = null, mnUrl = null;
      for (const c of feed) {
        const n = parseFloat(c && c.number);
        if (isNaN(n) || !c.url) continue;
        if (mx === null || n > mx) mx = n;
        if (mn === null || n < mn) { mn = n; mnUrl = c.url; }
      }
      totals.set(id, { max: mx, min: mn, minUrl: mnUrl });
    } catch {}
  }));
  // Creator originals (no chapter feeds — progress or first chapter links).
  const origRows = [];
  for (const oid of mangaIds.filter((id) => String(id).startsWith('orig:'))) {
    try {
      const s = (await api(`/api/originals/${String(oid).slice(5)}`)).data;
      origRows.push({ kind: 'orig', id: oid, title: s.title, cover: s.cover, author: s.author, list: s.chaptersList || [] });
    } catch {}
  }
  const rows = [
    ...cxIds.filter((id) => byId.has(id)).map((id) => ({ kind: 'cx', id, m: byId.get(id) })),
    ...origRows,
  ];
  if (!rows.length) {
    view.innerHTML = '<div class="centered">Your library is empty.</div>';
    return;
  }
  // Sort + filter state (client-side, instant).
  const st = { key: 'added', dir: -1, type: '', status: '' };
  const types = [...new Set(rows.map((r) => (r.m && r.m.type) || '').filter(Boolean))].sort();
  const statuses = [...new Set(rows.map((r) => (r.m && r.m.status ? String(r.m.status).trim() : '')).filter(Boolean))].sort();
  const timeOf = (v) => {
    const t = Date.parse(String(v || '').replace(' ', 'T') + 'Z');
    return isNaN(t) ? -Infinity : t;
  };
  const rowTitle = (r) => (r.kind === 'cx' ? titleOf(r.m) : (r.title || 'Untitled'));
  const paint = () => {
    const wrap = $('#libWrap');
    if (!wrap) return;
    let list = rows.filter((r) => {
      const t = (r.m && r.m.type) || '';
      const s = (r.m && r.m.status ? String(r.m.status).trim() : '');
      if (st.type && t !== st.type) return false;
      if (st.status && s !== st.status) return false;
      return true;
    });
    const keyVal = {
      title: (r) => rowTitle(r).toLowerCase(),
      continue: (r) => timeOf((progById.get(r.id) || {}).updated_at),
      lastread: (r) => timeOf((progById.get(r.id) || {}).updated_at),
      updated: (r) => {
        if (r.kind === 'orig') return (r.list || []).length;
        const v = (totals.get(r.id) || {}).max;
        return v === null || v === undefined ? -Infinity : v;
      },
      added: (r) => (added[r.id] ? timeOf(added[r.id]) : -Infinity),
    };
    list = list.slice().sort((a, b) => {
      const va = keyVal[st.key](a), vb = keyVal[st.key](b);
      if (va < vb) return -1 * st.dir;
      if (va > vb) return 1 * st.dir;
      return rowTitle(a).localeCompare(rowTitle(b));
    });
    const th = (key, label) => `<button class="lib-sort${st.key === key ? ' on' : ''}" data-sort="${key}">${label}${st.key === key ? (st.dir === 1 ? ' ▲' : ' ▼') : ''}</button>`;
    const rowHtml = (r) => {
      const prog = progById.get(r.id);
      const m = r.m;
      const cover = r.kind === 'cx' ? proxiedCover(m) : (r.cover || '');
      const status = (m && m.status ? String(m.status).trim() : '');
      let contCell;
      if (r.kind === 'orig') {
        const first = (r.list || [])[0];
        contCell = prog
          ? `<a class="lib-link" data-resume="${esc(r.id)}">Ch. ${esc(prog.chapter_label || '?')}</a>`
          : (first ? `<a class="lib-link" data-start-orig="${first.id}">Start</a>` : '<span class="small">—</span>');
      } else {
        const t = totals.get(r.id) || {};
        contCell = prog
          ? `<a class="lib-link" data-resume="${esc(r.id)}">Ch. ${esc(prog.chapter_label || '?')}${t.max !== null && t.max !== undefined ? ` / ${esc(t.max)}` : ''}</a>`
          : (t.minUrl ? `<a class="lib-link" data-start="${esc(t.minUrl)}">Start Ch. ${esc(t.min)}</a>` : '<span class="small">—</span>');
      }
      const lastRead = prog && prog.updated_at ? esc(relTime(prog.updated_at)) : '<span class="small">—</span>';
      const updated = r.kind === 'orig'
        ? ((r.list || []).length ? `${r.list.length} ch.` : '<span class="small">—</span>')
        : ((totals.get(r.id) || {}).max != null ? `Ch. ${esc((totals.get(r.id) || {}).max)}` : '<span class="small">—</span>');
      const addedAt = added[r.id] ? esc(relTime(added[r.id])) : '<span class="small">—</span>';
      return `
      <div class="lib-row" data-id="${esc(r.id)}">
        ${cover ? `<img class="lib-cover" loading="lazy" referrerpolicy="no-referrer" src="${cover}" alt="" />` : '<div class="lib-cover"></div>'}
        <span class="lib-title">${esc(rowTitle(r))}${m && m.type ? `<span class="small"> · ${esc(m.type)}</span>` : ''}</span>
        <span class="lib-continue">${contCell}</span>
        <span class="lib-status mhide">${status ? esc(status) : '<span class="small">—</span>'}</span>
        <span class="lib-time">${lastRead}</span>
        <span class="lib-time mhide">${updated}</span>
        <span class="lib-time mhide">${addedAt}</span>
        <button class="lib-x" data-unfollow="${esc(r.id)}" title="Remove from library" aria-label="Remove from library">×</button>
      </div>`;
    };
    wrap.innerHTML = `
      <div class="lib-tools">
        <select id="libType" class="genre-select" aria-label="Filter by type">
          <option value="">All types</option>
          ${types.map((t) => `<option value="${esc(t)}"${st.type === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
        <select id="libStatus" class="genre-select" aria-label="Filter by status">
          <option value="">All status</option>
          ${statuses.map((s) => `<option value="${esc(s)}"${st.status === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}
        </select>
      </div>
      <div class="lib-table">
        <div class="lib-row lib-head-row">
          <span></span>
          ${th('title', 'Title')}
          ${th('continue', 'Continue')}
          <span class="lib-hsub mhide">Status</span>
          ${th('lastread', 'Last Read')}
          ${th('updated', 'Updated')}
          ${th('added', 'Added')}
          <span></span>
        </div>
        ${list.map(rowHtml).join('') || '<div class="centered small">Nothing matches these filters.</div>'}
      </div>`;
    wrap.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.sort;
      if (st.key === k) st.dir *= -1;
      else { st.key = k; st.dir = k === 'title' ? 1 : -1; }
      paint();
    }));
    $('#libType')?.addEventListener('change', (e) => { st.type = e.target.value; paint(); });
    $('#libStatus')?.addEventListener('change', (e) => { st.status = e.target.value; paint(); });
    wrap.querySelectorAll('.lib-row:not(.lib-head-row)').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.closest('a,button')) return;
      location.hash = titleHash(el.dataset.id);
    }));
    wrap.querySelectorAll('[data-resume]').forEach((a) => a.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = progById.get(a.dataset.resume);
      if (p) location.hash = `#/reader/${a.dataset.resume}/${encodeURIComponent(p.chapter_id)}/${p.page || 0}`;
    }));
    wrap.querySelectorAll('[data-start]').forEach((a) => a.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = a.closest('.lib-row');
      if (row) location.hash = `#/reader/${row.dataset.id}/${encodeURIComponent(a.dataset.start)}/0`;
    }));
    wrap.querySelectorAll('[data-start-orig]').forEach((a) => a.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = a.closest('.lib-row');
      if (row) location.hash = `#/reader/${row.dataset.id}/${a.dataset.startOrig}/0`;
    }));
    wrap.querySelectorAll('[data-unfollow]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = b.dataset.unfollow;
      try { await api(`/api/library/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
      catch (err) { toast(err.message); return; }
      const s = localBookmarks();
      s.delete(id);
      setLocalBookmarks(s);
      b.closest('.lib-row')?.remove();
      toast('Removed from library');
    }));
  };
  paint();
}

// ---------- originals (comics by readers) ----------
async function renderOriginals() {
  view.innerHTML = `
    <div class="page-title">Originals <span class="small">comics by readers like you</span></div>
    <div class="orig-bar">
      <input id="origSearch" type="search" placeholder="Search originals..." />
      <button class="btn primary" id="origPublish">+ Publish yours</button>
    </div>
    <div class="grid" id="origGrid">${spinner().repeat(8)}</div>`;
  const load = async (q) => {
    const grid = $('#origGrid');
    if (!grid) return;
    grid.innerHTML = spinner().repeat(8);
    try {
      const { data } = await api(`/api/originals?q=${encodeURIComponent(q)}`);
      grid.innerHTML = data.length
        ? data.map(origCard).join('')
        : '<div class="centered small">No originals yet — be the first to publish!</div>';
      wireCards(grid);
    } catch (e) {
      grid.innerHTML = `<div class="centered small">Could not load: ${esc(e.message)}</div>`;
    }
  };
  let deb;
  $('#origSearch').addEventListener('input', (e) => {
    clearTimeout(deb);
    deb = setTimeout(() => load(e.target.value.trim()), 350);
  });
  $('#origPublish').addEventListener('click', () => {
    if (!currentUser) { openAuthModal(false); toast('Sign in to publish your comic'); return; }
    openOriginalPublish(() => load($('#origSearch').value.trim()));
  });
  load('');
}

function openOriginalPublish(onDone) {
  $('#modal').classList.remove('hidden');
  $('#modalContent').innerHTML = `
    <h2>Publish your comic</h2>
    <div class="field"><label>Title</label><input id="origTitle" maxlength="120" placeholder="My awesome comic" /></div>
    <div class="field"><label>Description</label><textarea id="origDesc" maxlength="2000" rows="3" placeholder="What's it about?"></textarea></div>
    <div class="field"><label>Cover (optional — JPG, PNG, WebP or GIF)</label><input id="origCover" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></div>
    <div class="error" id="origError"></div>
    <button class="btn primary" id="origSubmit" style="width:100%">Publish</button>`;
  $('#origSubmit').addEventListener('click', async () => {
    const errEl = $('#origError');
    errEl.textContent = '';
    const title = $('#origTitle').value.trim();
    if (!title) { errEl.textContent = 'Give your comic a title'; return; }
    const fd = new FormData();
    fd.append('title', title);
    fd.append('description', $('#origDesc').value.trim());
    const f = $('#origCover').files[0];
    if (f) fd.append('cover', f);
    const btn = $('#origSubmit');
    btn.disabled = true; btn.textContent = 'Publishing...';
    try {
      const r = await fetch('/api/originals', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Publish failed');
      closeModal();
      toast('Published!');
      if (onDone) onDone(j.id);
      else location.hash = `#/original/${j.id}`;
    } catch (e) {
      errEl.textContent = e.message;
      btn.disabled = false; btn.textContent = 'Publish';
    }
  });
}

function openOriginalChapter(sid, onDone) {
  $('#modal').classList.remove('hidden');
  $('#modalContent').innerHTML = `
    <h2>Add chapter</h2>
    <div class="field"><label>Chapter number</label><input id="origChNum" maxlength="20" placeholder="1" /></div>
    <div class="field"><label>Chapter title (optional)</label><input id="origChTitle" maxlength="120" placeholder="Beginnings" /></div>
    <div class="field"><label>Pages (images in reading order, max 100)</label><input id="origPages" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple /></div>
    <div class="error" id="origError"></div>
    <button class="btn primary" id="origSubmit" style="width:100%">Upload chapter</button>`;
  $('#origSubmit').addEventListener('click', async () => {
    const errEl = $('#origError');
    errEl.textContent = '';
    const files = [...$('#origPages').files].slice(0, 100);
    if (!files.length) { errEl.textContent = 'Attach at least one page image'; return; }
    const fd = new FormData();
    fd.append('num', $('#origChNum').value.trim());
    fd.append('title', $('#origChTitle').value.trim());
    files.forEach((f) => fd.append('pages', f));
    const btn = $('#origSubmit');
    btn.disabled = true; btn.textContent = `Uploading ${files.length} pages...`;
    try {
      const r = await fetch(`/api/originals/${sid}/chapters`, { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Upload failed');
      closeModal();
      toast(`Chapter added (${j.pages} pages)`);
      if (onDone) onDone(j.id);
    } catch (e) {
      errEl.textContent = e.message;
      btn.disabled = false; btn.textContent = 'Upload chapter';
    }
  });
}

async function renderOriginalSeries(sid) {
  if (!sid) return renderOriginals();
  view.innerHTML = spinner();
  try {
    const s = (await api(`/api/originals/${sid}`)).data;
    updateRouteMeta('original', s.title, String(s.description || '').slice(0, 160) || `Read ${s.title} online free on MyGhoulScans.`);
    const mid = `orig:${s.id}`;
    let followed = false;
    let progress = null;
    if (currentUser) {
      try { followed = (await api(`/api/library/${encodeURIComponent(mid)}/status`)).followed; } catch {}
      try { const sp = await api(`/api/progress/${encodeURIComponent(mid)}`); if (sp && sp.chapter_id) progress = sp; } catch {}
    }
    const isOwner = currentUser && currentUser.id === s.user_id;
    const list = s.chaptersList || [];
    view.innerHTML = `
      <div class="title-hero">
        ${s.cover ? `<img src="${esc(s.cover)}" alt="" />` : '<div class="cover"></div>'}
        <div class="title-info">
          <h1>${esc(s.title)}</h1>
          <div class="tagline">by ${esc(s.author || 'a reader')} &middot; original comic</div>
          ${s.description ? `<div class="summary">${esc(s.description)}</div>` : ''}
          <div class="title-actions">
            ${progress ? `<button class="btn primary" id="resumeBtn">Continue: Ch. ${esc(progress.chapter_label || '')} &#183; p.${progress.page + 1}</button>` : ''}
            ${list.length ? `<button class="btn ${progress ? 'ghost' : 'primary'}" id="startBtn">Start: Ch. ${esc(list[0].num || '?')}</button>` : ''}
            <button class="btn ${followed ? 'primary' : ''}" id="followBtn">${currentUser ? (followed ? 'In Library' : 'Add to Library') : 'Bookmark'}</button>
            ${isOwner ? `<button class="btn ghost" id="addChBtn">+ Add chapter</button>` : ''}
          </div>
          <div class="small" style="margin-top:6px">${list.length} chapter${list.length === 1 ? '' : 's'}</div>
        </div>
      </div>
      <div class="page-title" style="font-size:18px">Chapters</div>
      ${list.length ? `<div class="chapter-list" id="origChapters">${list.map((c) => `
        <div class="chapter-item" data-cid="${c.id}">
          <span class="cnum">Ch. ${esc(c.num || '?')}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</span>
          <span class="cmeta"><span class="pg-count">${c.pages}pg</span></span>
        </div>`).join('')}</div>`
        : '<div class="centered small">No chapters yet.</div>'}`;
    $('#followBtn').addEventListener('click', async () => {
      const r = await toggleBookmark(mid);
      if (r == null) return;
      const nowF = localBookmarks().has(mid);
      $('#followBtn').textContent = currentUser ? (nowF ? 'In Library' : 'Add to Library') : 'Bookmark';
      $('#followBtn').classList.toggle('primary', nowF);
      toast(nowF ? 'Bookmarked' : 'Removed bookmark');
    });
    $('#resumeBtn')?.addEventListener('click', () => {
      if (!progress) return;
      location.hash = `#/reader/${mid}/${progress.chapter_id}/${progress.page}`;
    });
    $('#startBtn')?.addEventListener('click', () => {
      if (!list.length) return;
      location.hash = `#/reader/${mid}/${list[0].id}/0`;
    });
    view.querySelector('#origChapters')?.addEventListener('click', (e) => {
      const it = e.target.closest('.chapter-item');
      if (!it) return;
      location.hash = `#/reader/${mid}/${it.dataset.cid}/0`;
    });
    $('#addChBtn')?.addEventListener('click', () => openOriginalChapter(s.id, () => renderOriginalSeries(sid)));
  } catch (e) {
    view.innerHTML = `<div class="centered">Could not load comic: ${esc(e.message)}</div>`;
  }
}

// ---------- account settings ----------
// ---------- RP shop ----------
const SHOP_SLOT_TITLES = { color: 'Name Colors', title: 'Titles', frame: 'Avatar Frames', theme: 'Themes' };
function shopPreviewHtml(it) {
  if (it.slot === 'color') {
    return `<div class="shop-swatch">${nameColorHtml('Reader', it.value)}</div>`;
  }
  if (it.slot === 'title') {
    return `<div class="shop-swatch"><span class="ctitle${it.fx ? ' fx-' + esc(it.fx) : ''}">${esc(it.name)}</span></div>`;
  }
  if (it.slot === 'frame') {
    return `<div class="shop-swatch">${wrapAvatarFrame(`<span class="comment-avatar av-frame-${esc(String(it.value).replace(/[^a-z-]/g, ''))}">R</span>`, it.value)}</div>`;
  }
  return `<div class="shop-swatch shop-theme-dot" data-shop-theme="${esc(it.value)}">Aa</div>`;
}
async function renderShop() {
  view.innerHTML = `
    <div class="page-title">RP Shop</div>
    <p class="small" style="margin:-10px 0 16px">Spend Reader Points earned from comment likes. Purchases equip instantly.</p>
    <div class="centered" id="shopBalance">${spinner()}</div>
    <div id="shopGroups"></div>`;
  const expanded = new Set();
  let lastShop = null;
  const paint = async (refetch = true) => {
    const groups = $('#shopGroups');
    if (!groups) return;
    let shop = refetch ? null : lastShop;
    if (!shop) {
      try {
        shop = await api('/api/shop');
        lastShop = shop;
      } catch (e) {
        groups.innerHTML = `<div class="centered">Could not load shop: ${esc(e.message)}</div>`;
        const bal = $('#shopBalance');
        if (bal) bal.innerHTML = currentUser ? '' : '<button class="btn primary" id="shopLogin">Log in to shop</button>';
        $('#shopLogin')?.addEventListener('click', () => openAuthModal(false));
        return;
      }
    }
    const bal = $('#shopBalance');
    if (bal) bal.innerHTML = currentUser
      ? `<span class="rp-chip" data-rp-balance>&#129689; <b>${Number(shop.balance).toLocaleString()}</b>&nbsp;RP</span>`
      : '<button class="btn primary" id="shopLogin">Log in to shop</button>';
    $('#shopLogin')?.addEventListener('click', () => openAuthModal(false));
    refreshRpChips();
    const order = ['color', 'title', 'frame', 'theme'];
    groups.innerHTML = order.map((slot) => {
      const items = shop.catalog.filter((it) => it.slot === slot).sort((a, b) => a.price - b.price);
      if (!items.length) return '';
      const open = expanded.has(slot);
      const vis = open ? items : items.slice(0, 8);
      return `<div class="sect"><h2 class="sect-title">${SHOP_SLOT_TITLES[slot]}</h2>
        <div class="shop-grid">${vis.map((it) => `
          <div class="shop-card${it.equipped ? ' equipped' : ''}">
            ${shopPreviewHtml(it)}
            <div class="shop-name">${esc(it.name)}</div>
            <div class="small">${esc(it.desc || '')}</div>
            ${it.equipped ? '<span class="shop-owned">Equipped</span>'
              : it.owned ? `<button class="btn ghost shop-buy" data-id="${esc(it.id)}">Equip</button>`
              : `<button class="btn primary shop-buy" data-id="${esc(it.id)}">&#129689; ${Number(it.price).toLocaleString()} RP</button>`}
          </div>`).join('')}</div>
        ${items.length > 8 ? `<button class="btn ghost shop-more" data-slot="${slot}" style="margin-top:10px">${open ? 'Show less' : `Show all ${items.length} ${slot}s`}</button>` : ''}</div>`;
    }).join('');
    groups.querySelectorAll('.shop-more').forEach((b) => b.addEventListener('click', () => {
      const slot = b.dataset.slot;
      if (expanded.has(slot)) expanded.delete(slot);
      else expanded.add(slot);
      paint(false);
    }));
    groups.querySelectorAll('.shop-buy').forEach((b) => b.addEventListener('click', async () => {
      if (!currentUser) { openAuthModal(false); return; }
      const boughtItem = shop.catalog.find((it) => it.id === b.dataset.id) || {};
      const wasOwned = !!boughtItem.owned;
      const origLabel = b.textContent;
      b.disabled = true;
      b.textContent = wasOwned ? 'Equipping...' : 'Buying...';
      try {
        await api('/api/shop/buy', { method: 'POST', body: JSON.stringify({ id: b.dataset.id }) });
        // Optimistic flip so the result reads instantly, then sync truth.
        const card = b.closest('.shop-card');
        if (card) {
          card.classList.add('equipped');
          const s = document.createElement('span');
          s.className = 'shop-owned';
          s.textContent = 'Equipped';
          b.replaceWith(s);
        }
        if (boughtItem.slot === 'theme') {
          savePrefs({ ...loadPrefs(), mode: boughtItem.value });
          applyTheme();
        }
        await refreshAuth();
        toast(wasOwned ? 'Equipped' : 'Purchased & equipped');
        paint(true);
      } catch (e) {
        toast(e.message);
        if (document.contains(b)) { b.disabled = false; b.textContent = origLabel; }
      }
    }));
  };
  paint(true);
}

// Static-build avatar picker: downscale client-side to a tiny JPEG and store
// it as a data URL (the Pages build has no file storage). Server builds keep
// the multipart upload above.
function openPfpPicker() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/jpeg,image/png,image/webp,image/gif';
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      try {
        const S = 128;
        const scale = Math.max(S / img.width, S / img.height);
        const cw = document.createElement('canvas');
        cw.width = S; cw.height = S;
        const ctx = cw.getContext('2d');
        const dw = img.width * scale, dh = img.height * scale;
        ctx.drawImage(img, (S - dw) / 2, (S - dh) / 2, dw, dh);
        const dataUrl = cw.toDataURL('image/jpeg', 0.85);
        if (dataUrl.length > 100000) { toast('Image too large — pick a smaller file'); return; }
        toast('Uploading picture...');
        const r = await api('/api/auth/avatar-data', { method: 'POST', body: JSON.stringify({ image: dataUrl }) });
        if (currentUser) currentUser.avatar = r.avatar;
        await refreshAuth();
        toast('Picture updated');
        route();
      } catch (e) { toast(e.message); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Could not read that image'); };
    img.src = url;
  };
  inp.click();
}

// Backpack: equip / unequip owned shop items (account settings).
async function loadPack() {
  const box = $('#packGroups');
  if (!box) return;
  let shop;
  try {
    shop = await api('/api/shop');
  } catch (e) { box.innerHTML = `<div class="centered small">Could not load backpack: ${esc(e.message)}</div>`; return; }
  const order = ['color', 'title', 'frame', 'theme'];
  const ownedItems = shop.catalog.filter((it) => it.owned);
  if (!ownedItems.length) { box.innerHTML = '<div class="centered small">Nothing yet — items you buy in the <a href="#/shop">Shop</a> land here.</div>'; return; }
  box.innerHTML = order.map((slot) => {
    const items = ownedItems.filter((it) => it.slot === slot);
    if (!items.length) return '';
    return `<p class="set-h" style="margin:12px 0 8px">${SHOP_SLOT_TITLES[slot]}</p>
      <div class="shop-grid">${items.map((it) => `
        <div class="shop-card${it.equipped ? ' equipped' : ''}">
          ${shopPreviewHtml(it)}
          <div class="shop-name">${esc(it.name)}</div>
          ${it.equipped
            ? `<button class="btn ghost shop-un" data-slot="${slot}">Unequip</button>`
            : `<button class="btn ghost shop-eq" data-slot="${slot}" data-id="${esc(it.id)}">Equip</button>`}
        </div>`).join('')}</div>`;
  }).join('');
  box.querySelectorAll('.shop-eq').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const r = await api('/api/shop/equip', { method: 'POST', body: JSON.stringify({ slot: b.dataset.slot, id: b.dataset.id }) });
      const eq = (r && r.equipped) || {};
      if (b.dataset.slot === 'theme') {
        savePrefs({ ...loadPrefs(), mode: eq.theme || 'dark' });
        applyTheme();
      }
      await refreshAuth();
      toast('Equipped');
      route();
    } catch (e) { toast(e.message); if (document.contains(b)) b.disabled = false; }
  }));
  box.querySelectorAll('.shop-un').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await api('/api/shop/equip', { method: 'POST', body: JSON.stringify({ slot: b.dataset.slot, id: null }) });
      if (b.dataset.slot === 'theme') {
        const prefs = loadPrefs();
        if (prefs.mode && prefs.mode !== 'dark' && prefs.mode !== 'light') savePrefs({ ...prefs, mode: 'dark' });
        applyTheme();
      }
      await refreshAuth();
      toast('Unequipped');
      route();
    } catch (e) { toast(e.message); if (document.contains(b)) b.disabled = false; }
  }));
}

async function renderAccount() {
  if (!currentUser) { openAuthModal(false); location.hash = '#/'; return; }
  view.innerHTML = `<div class="page-title">Account settings</div><div class="centered">${spinner()}</div>`;
  let stats = { library: 0, chapters: 0, comments: 0, published: 0 };
  try { ({ stats } = await api('/api/auth/stats')); } catch {}
  if (!currentUser) { location.hash = '#/'; return; }
  const u = currentUser;
  const joined = u.created_at ? new Date(u.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '';
  view.innerHTML = `
    <div class="page-title">Account settings</div>
    <div class="acct-wrap">
      <div class="acct-card acct-row">
        ${wrapAvatarFrame(`<img class="avatar big${avatarFrameClass(u)}" id="acctAvatar" src="${avatarUrl(u)}" alt="" />`, u.frame)}
        <div style="flex:1;min-width:0">
          <div class="acct-name">${styledNameHtml(u, u.email)}${titleBadgeHtml(u.title)}</div>
          <div class="small">${esc(u.email)}${joined ? ` &middot; joined ${esc(joined)}` : ''}</div>
        </div>
        <label class="btn ghost" for="acctFile">Change picture</label>
        <button class="btn ghost" id="acctPicStatic" hidden>Change picture</button>
        <input id="acctFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
        ${u.avatar ? '<button class="btn ghost" id="acctAvatarRm">Remove</button>' : ''}
      </div>
      <div class="acct-stats">
        <div class="stat-chip"><b>${stats.library}</b><span>bookmarked</span></div>
        <div class="stat-chip"><b>${stats.chapters}</b><span>chapters read</span></div>
        <div class="stat-chip"><b>${stats.comments}</b><span>comments</span></div>
        <div class="stat-chip rp"><b data-rp-num>${Number((currentUser && currentUser.rp) || 0).toLocaleString()}</b><span>reader points</span></div>
      </div>
      <p class="small" style="margin:-6px 0 14px">Earn <b>+2 RP</b> every time someone likes your comments, <b>−1 RP</b> per dislike.</p>
      <div class="acct-row" style="margin:-4px 0 16px"><a class="btn primary" href="#/shop">Open RP Shop</a></div>
      <div class="acct-card">
        <h3>Backpack</h3>
        <p class="small" style="margin:0 0 10px">Everything you've bought. Equip one of each kind — unequip to go plain.</p>
        <div id="packGroups"><div class="centered">${spinner()}</div></div>
      </div>
      <div class="acct-card">
        <h3>Profile</h3>
        <div class="field"><label>Username (unique, 2–24 characters)</label><input id="acctName" maxlength="24" value="${esc(u.display_name || '')}" /></div>
        <div class="error" id="acctNameErr"></div>
        <button class="btn primary" id="acctNameSave">Save username</button>
      </div>
      <div class="acct-card">
        <h3>Password</h3>
        <div class="field"><label>Current password (skip if you signed up with Google)</label><input id="acctCurPass" type="password" /></div>
        <div class="field"><label>New password (at least 6 characters)</label><input id="acctNewPass" type="password" /></div>
        <div class="error" id="acctPassErr"></div>
        <button class="btn primary" id="acctPassSave">Change password</button>
      </div>
      <div class="acct-card">
        <h3>Sessions</h3>
        <p class="small" style="margin:0 0 10px">Signed in on another device? Kick them all off except this one.</p>
        <div class="acct-row">
          <button class="btn ghost" id="acctKick">Sign out everywhere else</button>
          <button class="btn ghost" id="acctLogout">Log out</button>
        </div>
      </div>
      <div class="acct-card">
        <h3>Reading data</h3>
        <p class="small" style="margin:0 0 10px">Still seeing manga you read earlier? Clear it here — wipes this browser <b>and</b> your account (all devices). Comments and published comics are kept; use Delete below for a full wipe.</p>
        <div class="acct-row">
          <button class="btn ghost" id="acctClearHistory">Clear reading history</button>
          <button class="btn ghost" id="acctClearLibrary">Clear library</button>
          <button class="btn danger" id="acctClearAll">Clear all my data</button>
        </div>
      </div>
      <div class="acct-card danger">
        <h3>Delete account</h3>
        <p class="small" style="margin:0 0 10px">Wipes your library, reading progress, comments, published comics and everything else tied to this account. This cannot be undone.</p>
        <div class="acct-row" id="delArmRow"><button class="btn danger" id="acctDel">Delete my account</button></div>
        <div id="delConfirm" hidden>
          <div class="field"><label>Type DELETE to confirm</label><input id="acctDelText" placeholder="DELETE" /></div>
          <div class="error" id="acctDelErr"></div>
          <button class="btn danger" id="acctDelYes">Yes, delete everything</button>
        </div>
      </div>
    </div>`;
  refreshRpChips();
  loadPack();
  $('#acctFile').addEventListener('change', async () => {
    const f = $('#acctFile').files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('avatar', f);
    try {
      const r = await fetch('/api/auth/avatar', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Upload failed');
      currentUser.avatar = j.avatar;
      refreshAuth();
      $('#acctAvatar').src = avatarUrl(currentUser);
      toast('Picture updated');
      route();
    } catch (e) { toast(e.message); }
  });
  $('#acctAvatarRm')?.addEventListener('click', async () => {
    try {
      // Static build has no file storage: data-URL pictures clear via avatar-data.
      const delPath = (typeof wfetch === 'function') ? '/api/auth/avatar-data' : '/api/auth/avatar';
      await api(delPath, { method: 'DELETE' });
      currentUser.avatar = null;
      refreshAuth();
      route();
      toast('Picture removed');
    } catch (e) { toast(e.message); }
  });
  $('#acctPicStatic')?.addEventListener('click', () => openPfpPicker());
  $('#acctNameSave').addEventListener('click', async () => {
    const errEl = $('#acctNameErr');
    errEl.textContent = '';
    try {
      const r = await fetch('/api/auth/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: $('#acctName').value }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Save failed');
      currentUser = j.user;
      refreshAuth();
      toast('Username updated');
      route();
    } catch (e) { errEl.textContent = e.message; }
  });
  $('#acctPassSave').addEventListener('click', async () => {
    const errEl = $('#acctPassErr');
    errEl.textContent = '';
    try {
      const r = await fetch('/api/auth/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: $('#acctCurPass').value, newPassword: $('#acctNewPass').value }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Save failed');
      $('#acctCurPass').value = '';
      $('#acctNewPass').value = '';
      toast('Password changed');
    } catch (e) { errEl.textContent = e.message; }
  });
  $('#acctKick').addEventListener('click', async () => {
    try {
      const r = await fetch('/api/auth/sessions/clear', { method: 'POST' });
      if (!r.ok) throw new Error('Failed');
      toast('Other devices signed out');
    } catch (e) { toast(e.message); }
  });
  $('#acctLogout').addEventListener('click', async () => {
    await doLogout();
    location.hash = '#/';
  });
  $('#acctClearHistory')?.addEventListener('click', async () => {
    if (!confirm('Clear your Continue Reading history on this browser and your account?')) return;
    if (await clearAllHistory()) { toast('Reading history cleared'); route(); }
  });
  $('#acctClearLibrary')?.addEventListener('click', async () => {
    if (!confirm('Remove every title from your library on this browser and your account?')) return;
    if (await clearAllLibrary()) { toast('Library cleared'); route(); }
  });
  $('#acctClearAll')?.addEventListener('click', async () => {
    if (!confirm('Clear ALL your data (history + library) on this browser and your account?')) return;
    if (await clearAllUserData()) { toast('All data cleared'); route(); }
  });
  $('#acctDel').addEventListener('click', () => {
    $('#delArmRow').hidden = true;
    $('#delConfirm').hidden = false;
  });
  $('#acctDelYes').addEventListener('click', async () => {
    const errEl = $('#acctDelErr');
    errEl.textContent = '';
    if ($('#acctDelText').value.trim() !== 'DELETE') { errEl.textContent = 'Type DELETE exactly to confirm'; return; }
    try {
      const r = await fetch('/api/auth/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Delete failed');
      try {
        localStorage.removeItem('mgs_bookmarks');
        localStorage.removeItem('mgs_local_progress');
      } catch {}
      currentUser = null;
      refreshAuth();
      toast('Account deleted');
      location.hash = '#/';
    } catch (e) { errEl.textContent = e.message; }
  });
}

// ---------- popular (top 10 most-read) ----------
async function renderPopular() {
  view.innerHTML = `<div class="page-title">Top 10 &mdash; most read</div><p class="small" style="margin:-10px 0 16px">Ranked by how many times each chapter has been opened by readers.</p><div class="pop-list" id="popList">${spinner()}</div>`;
  const list = document.getElementById('popList');
  try {
    const { data } = await api('/api/popular');
    if (!data.length) { list.innerHTML = '<div class="centered">No reads tracked yet. Open a chapter or two and come back!</div>'; return; }
    const ids = data.map((r) => r.id);
    const cxIds = ids.filter((id) => String(id).startsWith('cx:'));
    const origById = new Map();
    for (const oid of ids.filter((id) => String(id).startsWith('orig:'))) {
      try {
        const s = (await api(`/api/originals/${String(oid).slice(5)}`)).data;
        origById.set(oid, s);
      } catch {}
    }
    const byId = await resolveComickIds(cxIds);
    const max = data[0].n;
    list.innerHTML = data.map((row, i) => {
      const s = origById.get(row.id);
      const m = byId.get(row.id);
      if (!m && !s) return '';
      const rawImg = m ? coverUrl(m) : s.cover;
      const img = m && rawImg ? `/api/img?u=${encodeURIComponent(rawImg)}` : rawImg;
      const name = m ? titleOf(m) : s.title;
      const w = Math.round((row.n / max) * 100);
      return `
        <div class="pop-item" data-id="${esc(row.id)}">
          <div class="pop-rank">${i + 1}</div>
          ${img ? `<img class="pop-cover" loading="lazy" referrerpolicy="no-referrer" src="${esc(img)}" alt="" />` : '<div class="pop-cover"></div>'}
          <div class="pop-info">
            <div class="pop-name">${esc(name)}</div>
            <div class="pop-track"><div class="pop-bar" style="width:${w}%"></div></div>
          </div>
          <div class="pop-count" title="reads"><b>${row.n.toLocaleString()}</b><span class="small"> reads</span></div>
        </div>`;
    }).join('');
    list.querySelectorAll('.pop-item').forEach((el) => {
      el.addEventListener('click', () => { location.hash = titleHash(el.dataset.id); });
    });
  } catch (e) {
    list.innerHTML = `<div class="centered">Could not load chart: ${esc(e.message)}</div>`;
  }
}

// ---------- leaderboard (top readers: RP, hours, bookmarks, likes, dislikes) ----------
const LB_TABS = [
  ['rp', 'Most RP'],
  ['hours', 'Hours'],
  ['bookmarks', 'Bookmarked'],
  ['likes', 'Likes'],
  ['dislikes', 'Dislikes'],
];
const LB_HINT = {
  rp: 'Ranked by Reader Points earned from reading.',
  hours: 'Ranked by estimated time spent reading.',
  bookmarks: 'Ranked by titles in each reader library.',
  likes: 'Ranked by likes received on comments.',
  dislikes: 'Ranked by dislikes received on comments.',
};
function lbValueLabel(by, v) {
  const n = Number(v || 0);
  if (by === 'hours') {
    if (n >= 3600) return `${(n / 3600).toFixed(1)}h`;
    if (n >= 60) return `${Math.round(n / 60)}m`;
    return `${n}s`;
  }
  return n.toLocaleString();
}
async function renderLeaderboard(active) {
  const by = LB_TABS.some(([id]) => id === active) ? active : 'rp';
  updateRouteMeta('leaderboard');
  view.innerHTML = `
    <div class="page-title">Leaderboard &mdash; top readers</div>
    <p class="small" style="margin:-10px 0 16px">${esc(LB_HINT[by])}</p>
    <div class="lb-tabs" role="tablist">
      ${LB_TABS.map(([id, label]) => `<button class="lb-tab${id === by ? ' active' : ''}" data-lb="${id}" role="tab">${esc(label)}</button>`).join('')}
    </div>
    <div class="pop-list" id="lbList">${spinner()}</div>`;
  view.querySelectorAll('.lb-tab').forEach((b) => {
    b.addEventListener('click', () => renderLeaderboard(b.dataset.lb));
  });
  const list = document.getElementById('lbList');
  try {
    const { data } = await api(`/api/leaderboard?by=${encodeURIComponent(by)}`);
    if (!data || !data.length) { list.innerHTML = '<div class="centered">Nobody is on the board yet. Read, bookmark, or comment to claim a spot!</div>'; return; }
    const max = Math.max(...data.map((r) => Number(r.value || 0)), 1);
    list.innerHTML = data.map((u, i) => {
      const w = Math.round((Number(u.value || 0) / max) * 100);
      const av = u.avatar
        ? (String(u.avatar).startsWith('data:') ? String(u.avatar) : `/uploads/${esc(u.avatar)}`)
        : `/api/avatar/${u.id}.svg`;
      return `
        <div class="pop-item lb-item">
          <div class="pop-rank">${i + 1}</div>
          <span class="lb-av${(u.frame ? ` av-frame-${String(u.frame).replace(/[^a-z-]/g, '')}` : '')}">
            <img class="lb-cover" loading="lazy" referrerpolicy="no-referrer" src="${av}" alt="" />
          </span>
          <div class="pop-info">
            <div class="pop-name">${styledNameHtml(u, 'Reader')}${titleBadgeHtml(u.title)}</div>
            <div class="pop-track"><div class="pop-bar" style="width:${w}%"></div></div>
          </div>
          <div class="pop-count" title="${esc(LB_TABS.find(([id]) => id === by)[1])}"><b>${esc(lbValueLabel(by, u.value))}</b></div>
        </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div class="centered">Could not load leaderboard: ${esc(e.message)}</div>`;
  }
}

// ---------- search input ----------
let searchTimer;
$('#searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = $('#searchInput').value.trim();
    if (q) location.hash = `#/search/${encodeURIComponent(q)}`;
  }, 500);
});
$('#searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const q = $('#searchInput').value.trim();
    if (q) location.hash = `#/search/${encodeURIComponent(q)}`;
  }
});
$('#settingsBtn').addEventListener('click', openSettings);

// ---------- genres dropdown (topbar: browse by genre across all sources) ----------
async function initGenreDropdown() {
  const btn = $('#genreDropBtn');
  const menu = $('#genreMenu');
  if (!btn || !menu) return;
  const mature = loadPrefs().mature;
  const list = (await comickGenres()).filter((t) => mature || !isAdultSlug(t.id));
  const tag = (t) => `<a href="#/genre/${esc(t.id)}">${esc(t.name)}</a>`;
  menu.innerHTML = list.length ? list.map(tag).join('') : '<span class="small" style="padding:8px">No genres</span>';
  const open = (show) => menu.classList.toggle('hidden', !show);
  btn.addEventListener('click', (e) => { e.stopPropagation(); open(menu.classList.contains('hidden')); });
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) { open(false); }
  });
  document.addEventListener('click', () => open(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
}

async function setupGenreSelect(selectedId) {
  const sel = $('#genreSel');
  if (!sel) return;
  const mature = loadPrefs().mature;
  const list = (await comickGenres()).filter((t) => mature || !isAdultSlug(t.id));
  sel.innerHTML = '<option value="">All genres</option>' +
    list.map((t) => `<option value="${esc(t.id)}" ${t.id === selectedId ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  sel.onchange = () => { location.hash = sel.value ? `#/genre/${sel.value}` : '#/home'; };
}

// ---------- genre page (all major sources merged) ----------
async function renderGenre(slug) {
  if (isAdultSlug(slug) && !loadPrefs().mature) {
    view.innerHTML = `<div class="centered">
      <h3>This genre is marked mature</h3>
      <p class="small">Enable mature content in Settings to browse it.</p>
      <button class="btn primary" id="matOn">Enable mature content</button>
    </div>`;
    $('#matOn').addEventListener('click', () => {
      savePrefs({ ...loadPrefs(), mature: true });
      toast('Mature content enabled');
      route();
    });
    return;
  }
  const list = await comickGenres();
  const name = (list.find((t) => t.id === slug) || {}).name || slug;
  view.innerHTML = `
    <div class="home-toolbar">
      <div class="page-title" style="margin:0">${esc(name)}</div>
      <select id="genreSel" class="genre-select"><option value="">All genres</option></select>
    </div>
    <div class="grid" id="genreGrid">${spinner(6)}</div>
    <div class="centered" id="genreMore" style="display:none"><button class="btn ghost" id="genreNext">More</button></div>`;
  setupGenreSelect(slug);
  let page = 1;
  const seenIds = new Set();
  const load = async () => {
    const grid = $('#genreGrid');
    try {
      const items = await fanout(MAJOR_SOURCES, (s) => `/api/comick/genre?source=${encodeURIComponent(s)}&genre=${encodeURIComponent(slug)}&page=${page}`);
      const fresh = (items || []).filter((m) => m && m.id && !seenIds.has(m.id));
      fresh.forEach((m) => seenIds.add(m.id));
      const batch = fresh;
      if (page === 1 && !batch.length) grid.innerHTML = '<div class="centered small">Nothing here yet</div>';
      else {
        if (page === 1) grid.innerHTML = '';
        grid.innerHTML += batch.map((m) => mangaCard(m)).join('');
        wireCards(grid);
      }
      $('#genreMore').style.display = batch.length >= 10 ? '' : 'none';
      $('#genreNext').onclick = () => { page++; load(); };
    } catch (e) {
      grid.innerHTML = `<div class="centered small">Could not load: ${esc(e.message)}</div>`;
    }
  };
  load();
}

// ---------- mobile menu ----------
(() => {
  const btn = $('#menuBtn');
  const menu = $('#mobileMenu');
  if (!btn || !menu) return;
  const open = (show) => menu.classList.toggle('hidden', !show);
  btn.addEventListener('click', (e) => { e.stopPropagation(); open(menu.classList.contains('hidden')); });
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) open(false); });
  document.addEventListener('click', () => open(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
  window.addEventListener('hashchange', () => open(false));
  $('#mmSettings')?.addEventListener('click', () => { open(false); openSettings(); });
})();

// ---------- init ----------
applyTheme();
initGenreDropdown();
refreshAuth().then(async () => {
  if (!currentUser) {
    // Logged-out visitors hold no history: purge any legacy guest keys
    // so old Continue entries can never render again on this browser.
    try { localStorage.removeItem(LOCAL_PROG_KEY); } catch {}
    try { localStorage.removeItem(BM_KEY); } catch {}
  } else {
    await syncBookmarksFromServer();
  }
  route();
});