// ===== MyGhoulScans frontend =====
const $ = (sel) => document.querySelector(sel);
const view = $('#view');
let currentUser = null;

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

// Profile picture: custom upload, or a generated initial icon (unique hue per user)
function avatarUrl(u) {
  if (!u) return '/assets/chibi.png';
  if (u.avatar) return `/uploads/${u.avatar}`;
  return `/api/avatar/${u.id}.svg`;
}

function mangaCard(data, opts = {}) {
  const img = proxiedCover(data);
  const status = data.status || '';
  const bookmarked = localBookmarks().has(data.id);
  const lbl = latestLabelOf(data);
  return `
    <div class="manga-card ${opts.h ? 'h' : ''}" data-id="${esc(data.id)}">
      ${img ? `<img class="cover" loading="lazy" referrerpolicy="no-referrer" src="${img}" alt="" />` : '<div class="cover"></div>'}
      ${opts.rank ? `<span class="rank-badge">${opts.rank}</span>` : ''}
      ${data._new ? '<span class="new-badge">NEW</span>' : ''}
      <button class="bmark ${bookmarked ? 'on' : ''}" data-id="${esc(data.id)}" data-bmark="${bookmarked ? '1' : '0'}" title="${bookmarked ? 'Bookmarked' : 'Bookmark this comic'}">${bookmarked ? '&#128278;' : '&#128279;'}</button>
      <div class="meta">
        <div class="title">${esc(titleOf(data))}</div>
        <div class="sub">${status ? statusBadge(status) : ''}<span>${esc(data.source || '')}</span></div>
        ${lbl ? `<div class="chapters">Ch. ${esc(lbl)}</div>` : ''}
      </div>
    </div>`;
}

function spinner(n = 1) { return '<div class="spinner"></div>'.repeat(n); }

// ---------- auth ----------
async function refreshAuth() {
  try {
    const r = await fetch('/api/auth/me');
    currentUser = (await r.json()).user;
  } catch { currentUser = null; }
  const a = $('#authArea');
  const short = window.innerWidth <= 640;
  a.innerHTML = currentUser
    ? `<a href="#/account" title="Account settings" aria-label="Account settings"><img class="avatar" src="${avatarUrl(currentUser)}" alt="" /></a>`
    : `<button class="btn" id="loginBtn">${short ? 'Log in' : 'Log in / Sign up'}</button>`;
  a.querySelector('#loginBtn')?.addEventListener('click', () => openAuthModal(false));
}

async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  // Prevent ghost data: a logout must not leave the previous account's
  // bookmarks / Continue Reading behind for the next person on this browser.
  try {
    localStorage.removeItem(BM_KEY);
    localStorage.removeItem(LOCAL_PROG_KEY);
  } catch {}
  refreshAuth();
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
    try {
      await api(signup ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(signup ? { email, password, displayName: name } : { email, password }),
      });
      closeModal();
      refreshAuth();
      toast(signup ? 'Account created!' : 'Logged in!');
      route();
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

// ---------- routing ----------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').map(decodeURIComponent);
  return { page: parts[0] || 'home', parts };
}

// Title-page hash for either source: Comick "cx:…" IDs and "orig:<id>" originals
function titleHash(id) {
  const s = String(id);
  return s.startsWith('orig:') ? `#/original/${s.slice(5)}` : `#/title/${s}`;
}

function route() {
  const { page, parts } = parseHash();
  document.body.classList.toggle('reader-mode', page === 'reader');
  if (page === '' || page === 'home') return renderHome();
  if (page === 'search') return renderSearch(parts[1] || '');
  if (page === 'genre') return renderGenre(parts[1] || '');
  if (page === 'title') return renderTitle(parts[1]);
  if (page === 'reader') return renderReader(parts[1], parts[2], parseInt(parts[3], 10) || 0);
  if (page === 'library') return renderLibrary();
  if (page === 'popular') return renderPopular();
  if (page === 'originals') return renderOriginals();
  if (page === 'original') return renderOriginalSeries(parts[1]);
  if (page === 'account') return renderAccount();
  renderHome();
}

window.addEventListener('hashchange', route);

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
  source: 'mangaread',
  reader: { ...DEFAULT_READER },
  sections: { latest: true, manga: true, manhwa: true, manhua: true, popular: true },
};
const PREFS_KEY = 'mgs_settings';

function loadPrefs() {
  const base = { ...DEFAULT_PREFS, sections: { ...DEFAULT_PREFS.sections } };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (saved) {
      return {
        ...base, ...saved,
        reader: { ...base.reader, ...(saved.reader || {}) },
        sections: { ...base.sections, ...(saved.sections || {}) },
      };
    }
  } catch {}
  return base;
}
function savePrefs(p) { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); }
const applyTheme = () => {
  document.documentElement.dataset.theme = loadPrefs().mode === 'light' ? 'light' : 'dark';
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
  } catch { comickSourcesCache = [{ id: 'mangaread', name: 'MangaRead' }, { id: 'flamecomics', name: 'FlameComics' }]; }
  return comickSourcesCache;
}

// Adult-content handling: sources expose no ratings, so maturity is inferred
// from genre tags (same level MangaDex's "erotica" sat at).
const ADULT_GENRES = new Set(['adult', 'mature', 'smut', 'hentai', 'ecchi', 'doujinshi', 'yaoi', 'yuri', 'bara']);
const isAdultSlug = (slug) => ADULT_GENRES.has(String(slug || '').toLowerCase());
const isAdultItem = (m) => (m && Array.isArray(m.genres) && m.genres.some((g) => ADULT_GENRES.has(String(g).toLowerCase())))
  || (m && m.genre && ADULT_GENRES.has(String(m.genre).toLowerCase()));
function applyMatureFilter(items) {
  if (loadPrefs().mature) return items;
  return (items || []).filter((m) => !isAdultItem(m));
}

function openSettings() {
  const prefs = loadPrefs();
  const s = prefs.sections;
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
        <div class="set-seg">${seg('theme', [['dark', 'Dark'], ['light', 'Light']], prefs.mode)}</div>
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
        <p class="set-h">Comic source</p>
        <div id="sourcePick" class="chips">${spinner()}</div>
        <p class="small" style="margin:8px 0 0">Search, Latest and new discoveries use this source.</p>
      </div>
      <div>
        <p class="set-h">Home sections</p>
        ${sw('setSecLatest', s.latest, 'Latest updates')}
        ${sw('setSecManga', s.manga, 'Manga')}
        ${sw('setSecManhwa', s.manhwa, 'Manhwa')}
        ${sw('setSecManhua', s.manhua, 'Manhua')}
        ${sw('setSecPopular', s.popular, 'Most read (community)')}
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
  let pickedSource = prefs.source || 'mangaread';
  comickSources().then((list) => {
    const box = $('#sourcePick');
    if (!box) return;
    box.innerHTML = list.length
      ? list.map((t) => `<span class="chip pick ${t.id === pickedSource ? 'on' : ''}" data-src="${esc(t.id)}">${esc(t.name || t.id)}</span>`).join('')
      : '<span class="small">Could not load sources</span>';
    box.querySelectorAll('.chip.pick').forEach((c) => c.addEventListener('click', () => {
      box.querySelectorAll('.chip.pick').forEach((x) => x.classList.remove('on'));
      c.classList.add('on');
      pickedSource = c.dataset.src;
    }));
  });
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
    const oldSource = prefs.source || 'mangaread';
    savePrefs({
      mode: (document.querySelector('input[name="theme"]:checked') || { value: 'dark' }).value,
      mature: $('#setMatureRow').classList.contains('on'),
      source: pickedSource,
      reader: prefs.reader,
      sections: {
        latest: $('#setSecLatest').checked,
        manga: $('#setSecManga').checked,
        manhwa: $('#setSecManhwa').checked,
        manhua: $('#setSecManhua').checked,
        popular: $('#setSecPopular').checked,
      },
    });
    closeModal();
    // A source change reshapes genres + home rows everywhere — reload so the
    // topbar menu and all cached lists rebuild from the new source.
    if (pickedSource !== oldSource) { location.reload(); return; }
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
    el.addEventListener('click', (e) => {
      if (e.target.closest('.bmark')) return;
      location.hash = titleHash(el.dataset.id);
    });
  });
  container.querySelectorAll('.bmark').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleBookmark(b.dataset.id);
  }));
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
        ${sec.latest ? section('Latest updates', 'latestRow', (prefs.source || 'mangaread')) : ''}
        ${sec.manga ? section('Manga', 'mangaRow', 'Japanese') : ''}
        ${sec.manhwa ? section('Manhwa', 'manhwaRow', 'Korean') : ''}
        ${sec.manhua ? section('Manhua', 'manhuaRow', 'Chinese') : ''}
        ${sec.popular ? `<div class="sect">
          <h2 class="sect-title">Most read <span class="sect-sub">by readers like you</span></h2>
          <div class="grid" id="popGrid">${spinner(8)}</div>
        </div>` : ''}
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
      </aside>
    </div>`;

  view.querySelectorAll('.row-ctrl').forEach((b) => b.addEventListener('click', () => {
    const row = document.getElementById(b.dataset.row);
    if (!row) return;
    const dist = row.clientWidth - 120;
    row.scrollBy({ left: b.classList.contains('prev') ? -dist : dist, behavior: 'smooth' });
  }));
  fillResume(progressMap);

  const src = prefs.source || 'mangaread';
  const needFilter = !loadPrefs().mature;
  const used = new Set();
  if (sec.latest) {
    await fillRowList('latestRow', `/api/comick/latest?source=${encodeURIComponent(src)}${needFilter ? '&enrich=1' : ''}`, used, { progressMap, filterAdult: needFilter });
  }
  // Manga / Manhwa / Manhua are genre listings on wp-manga sources — only
  // rendered when the current source actually has those genre slugs.
  let typeSlugs = new Set();
  if (sec.manga || sec.manhwa || sec.manhua) {
    try { typeSlugs = new Set((await comickGenres()).map((g) => g.id)); } catch {}
  }
  if (sec.manga && typeSlugs.has('manga')) await fillRowList('mangaRow', `/api/comick/genre?source=${encodeURIComponent(src)}&genre=manga`, used, { progressMap });
  if (sec.manhwa && typeSlugs.has('manhwa')) await fillRowList('manhwaRow', `/api/comick/genre?source=${encodeURIComponent(src)}&genre=manhwa`, used, { progressMap });
  if (sec.manhua && typeSlugs.has('manhua')) await fillRowList('manhuaRow', `/api/comick/genre?source=${encodeURIComponent(src)}&genre=manhua`, used, { progressMap });
  if (sec.popular) fillPopularGrid();
}

// Horizontal row filled from an array of comick items.
async function fillRowList(rowId, url, used, extras = {}) {
  const row = document.getElementById(rowId);
  if (!row) return;
  try {
    const data = await api(url);
    let items = (data.data || []).filter((m) => {
      if (used.has(m.id)) return false;
      used.add(m.id);
      return true;
    });
    if (extras.filterAdult) items = applyMatureFilter(items);
    if (!items.length) { row.innerHTML = '<div class="centered small">Nothing here yet</div>'; return; }
    const { progressMap } = extras;
    items.forEach((m) => { if (hasNewChapters(m, progressMap)) m._new = true; });
    row.innerHTML = items.map((m) => mangaCard(m, { h: true })).join('');
    wireCards(row);
  } catch (e) {
    row.innerHTML = `<div class="centered small">Could not load: ${esc(e.message)}</div>`;
  }
}

// Most-read titles on the home page (community chart, top 8).
async function fillPopularGrid() {
  const grid = $('#popGrid');
  if (!grid) return;
  try {
    const { data } = await api('/api/popular');
    const ids = (data || []).map((r) => r.id).filter((id) => String(id).startsWith('cx:')).slice(0, 8);
    if (!ids.length) { grid.innerHTML = '<div class="centered small">No reads tracked yet. Open a chapter or two and come back!</div>'; return; }
    const byId = await resolveComickIds(ids);
    const items = ids.filter((id) => byId.has(id)).map((id) => byId.get(id));
    if (!items.length) { grid.innerHTML = '<div class="centered small">No reads tracked yet.</div>'; return; }
    grid.innerHTML = items.map((m) => mangaCard(m)).join('');
    wireCards(grid);
  } catch (e) {
    grid.innerHTML = `<div class="centered small">Could not load: ${esc(e.message)}</div>`;
  }
}

// ---------- search ----------
async function renderSearch(term) {
  const prefs = loadPrefs();
  view.innerHTML = `
    <div class="home-toolbar">
      <div class="page-title" style="margin:0">${term ? `Results for &ldquo;${esc(term)}&rdquo;` : 'Search'}</div>
      <select id="searchSource" class="genre-select"><option value="">Loading sources...</option></select>
    </div>
    <div class="grid" id="searchGrid">${spinner().repeat(8)}</div>`;
  const sel = $('#searchSource');
  const list = await comickSources();
  sel.innerHTML = list.map((t) => `<option value="${esc(t.id)}" ${t.id === (prefs.source || 'mangaread') ? 'selected' : ''}>${esc(t.name || t.id)}</option>`).join('');
  const run = async () => {
    const grid = $('#searchGrid');
    if (!grid) return;
    grid.innerHTML = spinner().repeat(8);
    try {
      const data = await api(`/api/comick/search?q=${encodeURIComponent(term)}&source=${encodeURIComponent(sel.value)}`);
      if (!data.data || !data.data.length) grid.innerHTML = '<div class="centered">No results. Try a different title or source.</div>';
      else { grid.innerHTML = data.data.map(mangaCard).join(''); wireCards(grid); }
    } catch (e) {
      grid.innerHTML = `<div class="centered">Search failed: ${esc(e.message)}</div>`;
    }
  };
  sel.addEventListener('change', run);
  await run('');
}

// ---------- title page ----------
const MAX_CHAPTERS = 6;
function chapterItemHtml(c, progress, counts) {
  const num = (c.number || c.number === 0) ? c.number : '?';
  const title = c.title && c.title !== `Chapter ${c.number}` ? c.title : '';
  const isCurrent = progress && progress.chapter_id === c.url;
  const n = (counts || {})[c.url] || 0;
  return `
    <div class="chapter-item ${isCurrent ? 'current' : ''}" data-cid="${esc(c.url)}">
      <span class="cnum">Ch. ${esc(num)}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</span>
      ${isCurrent ? '<span class="resume-flag">Last read &middot; p.' + (progress.page + 1) + '</span>' : ''}
      <span class="cmeta"><span class="read-count ${n ? '' : 'none'}" title="people that read this chapter">&#128065; ${n.toLocaleString()}</span></span>
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

async function renderTitle(mangaId) {
  if (!mangaId) return renderHome();
  view.innerHTML = spinner();
  try {
    const encId = encodeURIComponent(mangaId);
    const info = await api(`/api/comick/title?id=${encId}`);
    const feed = await api(`/api/comick/chapters?id=${encId}`);
    const manga = info.data;
    const chapters = (feed.data || []).slice().sort((a, b) => (b.number || 0) - (a.number || 0));
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
          ${manga.description ? `<div class="summary">${esc(manga.description)}</div>` : ''}
          ${tags.length ? `<div class="chips">${tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="title-actions">
            ${progress ? `<button class="btn primary" id="resumeBtn">Continue: Ch. ${esc(progress.chapter_label || '?')} &#183; p.${progress.page + 1}</button>` : ''}
            <button class="btn ${followed ? 'primary' : ''}" id="followBtn">${currentUser ? (followed ? 'In Library' : 'Add to Library') : (followed ? 'Bookmarked' : 'Bookmark')}</button>
          </div>
          <div class="small" style="margin-top:6px">${chapters.length} chapters on ${esc(manga.source || 'source')}</div>
        </div>
      </div>
      <div class="page-title" style="font-size:18px">Chapters</div>
      ${chapters.length ? chapterListHtml(chapters, progress, readCounts)
        : `<div class="centered" style="margin:32px 0">
            <p class="small">No chapters found for this title on ${esc(manga.source || 'the source')}.</p>
          </div>`}

      <div class="sect" id="recSect">
        <h2 class="sect-title">Recommended by readers <button class="btn ghost" id="recBtn">+ Recommend similar titles</button></h2>
        <div class="hrow" id="recRow"></div>
      </div>`;

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

async function renderReader(mangaId, chapterId, startPage) {
  if (!mangaId || !chapterId) return renderHome();
  // A new render supersedes any earlier one still awaiting API responses —
  // stale continuations must not touch the fresh DOM or double-wire events.
  readerCleanup?.dispose?.();
  readerCleanup = null;
  const myRun = ++readerRunSeq;
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
    if (idx === -1) idx = 0;

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
    if (cid !== chapterId) history.replaceState(null, '', `#/reader/${mangaId}/${encodeURIComponent(cid)}/0`);

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
        delete img.dataset.t0;
        delete img.dataset.aretry;
        dropFailCard(img);
      });
      img.addEventListener('error', () => {
        const alt = altUrls[i];
        if (alt && img.dataset.lastTry !== 'alt') { img.dataset.lastTry = 'alt'; img.src = alt; stamp(img); return; }
        markFailed(img, i);
      });
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
  return `
    <div class="comment-item ${c.pinned ? 'pinned' : ''}">
      <div class="comment-meta">
        <span class="comment-author"><span class="comment-avatar">${esc((c.display_name || 'Reader')[0].toUpperCase())}</span> ${esc(c.display_name || 'Reader')}</span>
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

// ---------- library ----------
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
  view.innerHTML = `<div class="page-title">My Library <button class="btn ghost" id="libClear" style="margin-left:8px;font-size:12px;padding:4px 10px">Clear all</button></div><div class="grid">${spinner().repeat(8)}</div>`;
  $('#libClear')?.addEventListener('click', async () => {
    if (!confirm('Remove every title from your library (this browser + account)?')) return;
    if (await clearAllLibrary()) { toast('Library cleared'); route(); }
  });
  let mangaIds = [];
  try { ({ mangaIds } = await api('/api/library')); setLocalBookmarks(new Set(mangaIds || [])); }
  catch { mangaIds = [...localBookmarks()]; }
  if (!mangaIds.length) {
    view.innerHTML = `<div class="centered">Your library is empty. Bookmark comics you want to keep reading &mdash; use the &#128279; icon on any card or the &ldquo;Bookmark&rdquo; button on a title page.</div>`;
    return;
  }
  try {
    const cxIds = mangaIds.filter((id) => String(id).startsWith('cx:'));
    const origIds = mangaIds.filter((id) => String(id).startsWith('orig:'));
    const grid = view.querySelector('.grid');
    let html = '';
    if (cxIds.length) {
      const byId = await resolveComickIds(cxIds);
      html += cxIds.filter((id) => byId.has(id)).map((id) => mangaCard(byId.get(id))).join('');
    }
    for (const oid of origIds) {
      try {
        const s = (await api(`/api/originals/${String(oid).slice(5)}`)).data;
        html += origCard(s);
      } catch {}
    }
    grid.innerHTML = html || '<div class="centered">Your library is empty.</div>';
    wireCards(grid);
  } catch (e) {
    view.innerHTML = `<div class="centered">Could not load library: ${esc(e.message)}</div>`;
  }
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
        <img class="avatar big" id="acctAvatar" src="${avatarUrl(u)}" alt="" />
        <div style="flex:1;min-width:0">
          <div class="acct-name">${esc(u.display_name || u.email)}</div>
          <div class="small">${esc(u.email)}${joined ? ` &middot; joined ${esc(joined)}` : ''}</div>
        </div>
        <label class="btn ghost" for="acctFile">Change picture</label>
        <input id="acctFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
        ${u.avatar ? '<button class="btn ghost" id="acctAvatarRm">Remove</button>' : ''}
      </div>
      <div class="acct-stats">
        <div class="stat-chip"><b>${stats.library}</b><span>bookmarked</span></div>
        <div class="stat-chip"><b>${stats.chapters}</b><span>chapters read</span></div>
        <div class="stat-chip"><b>${stats.comments}</b><span>comments</span></div>
        <div class="stat-chip"><b>${stats.published}</b><span>published</span></div>
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
      const r = await fetch('/api/auth/avatar', { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed');
      currentUser.avatar = null;
      refreshAuth();
      route();
      toast('Picture removed');
    } catch (e) { toast(e.message); }
  });
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

// ---------- genres dropdown (topbar: browse by genre on the picked source) ----------
async function comickGenres() {
  const source = loadPrefs().source || 'mangaread';
  try {
    return (await api(`/api/comick/genres?source=${encodeURIComponent(source)}`)).data;
  } catch { return []; }
}
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

// ---------- genre page ----------
async function renderGenre(slug) {
  const source = loadPrefs().source || 'mangaread';
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
  const load = async () => {
    const grid = $('#genreGrid');
    try {
      const data = await api(`/api/comick/genre?source=${encodeURIComponent(source)}&genre=${encodeURIComponent(slug)}&page=${page}`);
      const items = data.data || [];
      if (page === 1 && !items.length) grid.innerHTML = '<div class="centered small">Nothing here yet</div>';
      else {
        if (page === 1) grid.innerHTML = '';
        grid.innerHTML += items.map((m) => mangaCard(m)).join('');
        wireCards(grid);
      }
      $('#genreMore').style.display = items.length >= 10 ? '' : 'none';
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