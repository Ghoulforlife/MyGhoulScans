// ===== MyGhoulScans frontend =====
const $ = (sel) => document.querySelector(sel);
const view = $('#view');
let currentUser = null;

// ---------- utilities ----------
// Static build: MangaDex reads go through your Cloudflare worker (worker.js),
// which adds CORS + caching. Covers/pages come straight from MangaDex's CDN.
// 1. Deploy worker/ to Cloudflare, 2. paste your worker URL below.
const API_BASE = 'https://REPLACE-WITH-YOUR-WORKER.workers.dev';
async function api(path, opts = {}) {
  let url = path;
  if (path.startsWith('/api/mdex/')) url = API_BASE + path.slice('/api/mdex'.length);
  else if (path.startsWith('/api/img?u=')) {
    const m = path.match(/^\/api\/img\?u=([^&]+)/);
    if (!m) throw new Error('Bad image URL');
    url = decodeURIComponent(m[1]);
  } else {
    throw new Error('Not available in this build');
  }
  const res = await fetch(url, { ...opts });
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
  const a = data.attributes && data.attributes.title;
  if (!a) return 'Untitled';
  // MangaDex often has no title.en (or a romanized/pinyin one); altTitles.en
  // usually carries the common English name for manhwa/manhua/manga.
  const altEn = (data.attributes.altTitles || []).map((t) => t.en).filter(Boolean);
  const en = a.en || '';
  const bestAlt = altEn.find((t) => t !== en) || altEn[0] || '';
  if (en) return bestAlt || en;
  return bestAlt || a['ja'] || a.ko || a['zh-hk'] || a['zh'] || Object.values(a)[0] || 'Untitled';
}

function coverUrl(data) {
  const rel = (data.relationships || []).find((r) => r.type === 'cover_art');
  const fn = rel && rel.attributes && rel.attributes.fileName;
  if (!fn) return '';
  return `https://uploads.mangadex.org/covers/${data.id}/${fn}.512.jpg`;
}

function yearOf(data) {
  const y = data.attributes && data.attributes.year;
  return y ? String(y) : '';
}

function altOf(data) {
  const a = data.attributes && (data.attributes.altTitles || []);
  for (const t of a) if (t.en) return t.en;
  return '';
}

function mangaCard(data, opts = {}) {
  const img = coverUrl(data);
  const status = data.attributes && data.attributes.status;
  const bookmarked = localBookmarks().has(data.id);
  const ch = data._chapters;
  return `
    <div class="manga-card ${opts.h ? 'h' : ''}" data-id="${esc(data.id)}">
      ${img ? `<img class="cover" loading="lazy" referrerpolicy="no-referrer" src="${img}" alt="" />` : '<div class="cover"></div>'}
      ${opts.rank ? `<span class="rank-badge">${opts.rank}</span>` : ''}
      ${data._new ? '<span class="new-badge">NEW</span>' : ''}
      <button class="bmark ${bookmarked ? 'on' : ''}" data-id="${esc(data.id)}" data-bmark="${bookmarked ? '1' : '0'}" title="${bookmarked ? 'Bookmarked' : 'Bookmark this comic'}">${bookmarked ? '&#128278;' : '&#128279;'}</button>
      <div class="meta">
        <div class="title">${esc(titleOf(data))}</div>
        <div class="sub">${statusBadge(status)}<span>${esc(yearOf(data))}</span></div>
        ${ch ? `<div class="chapters">${ch.toLocaleString()} chapters</div>` : ''}
      </div>
    </div>`;
}

function spinner(n = 1) { return '<div class="spinner"></div>'.repeat(n); }

// ---------- auth (static build: no accounts — library & progress live in this browser) ----------
async function refreshAuth() {
  currentUser = null;
  const a = $('#authArea');
  if (a) a.style.display = 'none';
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

// Title-page hash for either source: MangaDex UUIDs and "orig:<id>" originals
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
  mature: false,
  useSaver: true,
  mode: 'dark',
  myGenres: [],
  reader: { ...DEFAULT_READER },
  sections: { latest: true, new: true, myGenres: true, trending: true, manga: true, manhwa: true, manhua: true, rec: true },
};
const PREFS_KEY = 'mgs_settings';

function loadPrefs() {
  const base = { ...DEFAULT_PREFS, myGenres: [...DEFAULT_PREFS.myGenres], sections: { ...DEFAULT_PREFS.sections } };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (saved) {
      return {
        ...base, ...saved,
        myGenres: Array.isArray(saved.myGenres) ? saved.myGenres : [],
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

// ---------- local progress (Continue works even without an account) ----------
const LOCAL_PROG_KEY = 'mgs_local_progress';
function localProgress() {
  try { return JSON.parse(localStorage.getItem(LOCAL_PROG_KEY) || '{}'); } catch { return {}; }
}
function setLocalProgress(mangaId, obj) {
  const m = localProgress();
  m[mangaId] = { ...obj, updated_at: Date.now() };
  localStorage.setItem(LOCAL_PROG_KEY, JSON.stringify(m));
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
  localStorage.setItem(BM_KEY, JSON.stringify([...set]));
  view.querySelectorAll('.bmark').forEach((b) => {
    const on = set.has(b.dataset.id);
    b.classList.toggle('on', on);
    b.dataset.bmark = on ? '1' : '0';
  });
}
async function syncBookmarksFromServer() {
  if (!currentUser) return;
  try {
    const { mangaIds } = await api('/api/library');
    const set = localBookmarks();
    mangaIds.forEach((id) => set.add(id));
    setLocalBookmarks(set);
  } catch {}
}
async function toggleBookmark(id) {
  // Static build: bookmarks live in this browser only.
  const set = localBookmarks();
  const adding = !set.has(id);
  set.has(id) ? set.delete(id) : set.add(id);
  setLocalBookmarks(set);
  return adding;
}

function openSettings() {
  const prefs = loadPrefs();
  const s = prefs.sections;
  const seg = (name, options, checkedVal) => options.map(([val, label]) => `
    <label><input type="radio" name="${name}" value="${val}" ${checkedVal === val ? 'checked' : ''}/><span>${label}</span></label>`).join('');
  const sw = (id, checked, label) => `
    <label class="set-row"><span class="set-lbl">${label}</span>
    <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} hidden /><span class="switch"></span></label>`;
  const matureOn = prefs.mature;
  $('#modal').classList.remove('hidden');
  $('#modalContent').innerHTML = `
    <h2>Settings</h2>
    <div class="set-body">
      <div>
        <p class="set-h">Theme</p>
        <div class="set-seg">${seg('theme', [['dark', 'Dark'], ['light', 'Light']], prefs.mode)}</div>
      </div>
      <div>
        <p class="set-h">Reader quality</p>
        <div class="set-seg">${seg('quality', [['1', 'Fast (data-saver)'], ['0', 'Full quality']], prefs.useSaver ? '1' : '0')}</div>
      </div>
      <div>
        <p class="set-h">Content</p>
        <div class="set-row ${matureOn ? 'on' : ''}" id="setMatureRow" role="button" tabindex="0" title="Show mature titles">
          <span class="mat-dot"></span>
          <span class="set-lbl dim">Mature content</span>
        </div>
      </div>
      <div>
        <p class="set-h">My genres <span class="small">(powers your feed)</span></p>
        <div id="genreChips" class="chips">${spinner()}</div>
      </div>
      <div>
        <p class="set-h">Home sections</p>
        ${sw('setSecLatest', s.latest, 'Just updated (sidebar)')}
        ${sw('setSecTrending', s.trending, 'Trending (sidebar)')}
        ${sw('setSecNew', s.new, 'Newly added')}
        ${sw('setSecMyGenres', s.myGenres, 'For you (my genres)')}
        ${sw('setSecManga', s.manga, 'Manga')}
        ${sw('setSecManhwa', s.manhwa, 'Manhwa')}
        ${sw('setSecManhua', s.manhua, 'Manhua')}
        ${sw('setSecRec', s.rec, 'Recommended (bottom)')}
      </div>
    </div>
    <button class="btn primary" id="setSave" style="width:100%;margin-top:20px">Save settings</button>
  `;
  $('#setMatureRow').addEventListener('click', () => $('#setMatureRow').classList.toggle('on'));
  genreOptions().then((list) => {
    const chips = $('#genreChips');
    if (!chips) return;
    chips.innerHTML = list.length
      ? list.map((t) => `<span class="chip pick ${prefs.myGenres.includes(t.id) ? 'on' : ''}" data-tag="${esc(t.id)}">${esc(t.name)}</span>`).join('')
      : '<span class="small">Could not load genres</span>';
    chips.querySelectorAll('.chip.pick').forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));
  });
  $('#setSave').addEventListener('click', () => {
    savePrefs({
      mature: $('#setMatureRow').classList.contains('on'),
      useSaver: (document.querySelector('input[name="quality"]:checked') || { value: '1' }).value === '1',
      mode: (document.querySelector('input[name="theme"]:checked') || { value: 'dark' }).value,
      myGenres: [...$('#genreChips').querySelectorAll('.chip.pick.on')].map((c) => c.dataset.tag),
      reader: prefs.reader,
      sections: {
        latest: $('#setSecLatest').checked,
        new: $('#setSecNew').checked,
        myGenres: $('#setSecMyGenres').checked,
        trending: $('#setSecTrending').checked,
        manga: $('#setSecManga').checked,
        manhwa: $('#setSecManhwa').checked,
        manhua: $('#setSecManhua').checked,
        rec: $('#setSecRec').checked,
      },
    });
    closeModal();
    applyTheme();
    route();
    toast('Settings saved');
  });
}

// ---------- home ----------
let genreTagCache = null;

async function genreOptions() {
  if (genreTagCache) return genreTagCache;
  try {
    genreTagCache = (await api('/api/mdex/tags')).data;
  } catch { genreTagCache = []; }
  return genreTagCache;
}

async function setupGenreSelect(selectedId) {
  const sel = $('#genreSel');
  if (!sel) return;
  const list = await genreOptions();
  sel.innerHTML = '<option value="">All genres</option>' +
    list.map((t) => `<option value="${esc(t.id)}" ${t.id === selectedId ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  sel.onchange = () => { location.hash = sel.value ? `#/genre/${sel.value}` : '#/home'; };
}

function resumeCard(m, item) {
  const img = coverUrl(m);
  // Comick-style: a clean tile of just the cover + title, no chapter metadata.
  return `
    <div class="resume-card" data-manga="${esc(m.id)}" data-cid="${esc(item.chapter_id)}" data-page="${item.page}">
      ${img ? `<img class="cover" loading="lazy" referrerpolicy="no-referrer" src="${img}" alt="" />` : '<div class="cover"></div>'}
      <div class="resume-info">
        <div class="title">${esc(titleOf(m))}</div>
      </div>
    </div>`;
}

const HOURS_MS = 3600 * 1000;

function hasNewChapters(m, progressMap, chaptersMeta) {
  const newest = m.attributes && m.attributes.latestUploadedChapter;
  const p = progressMap && progressMap.get(m.id);
  // newest is the UUID of the latest uploaded chapter; if the last-read chapter
  // UUID differs, there are chapters left to read.
  if (newest && p && p.chapter_id && String(p.chapter_id) !== String(newest)) return true;
  const meta = chaptersMeta && chaptersMeta[m.id];
  if (meta && meta.at) {
    const age = Date.now() - new Date(meta.at).getTime();
    if (age < 96 * HOURS_MS) {
      if (!p) return true;
      if (meta.label && String(p.chapter_label) !== String(meta.label)) return true;
    }
  }
  return false;
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
async function fillResume(progressMap) {
  const sect = $('#continueSect');
  if (!sect) return;
  // Static build: continue row is powered by this browser's history only.
  let items = [];
  // Merge locally-tracked reading (works without an account too)
  const serverIds = new Set(items.map((i) => i.manga_id));
  const local = localProgressList().filter((i) => !serverIds.has(i.manga_id));
  const merged = [...local, ...items].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  if (progressMap) merged.forEach((i) => progressMap.set(i.manga_id, i));
  if (!merged.length) return;
  const items12 = merged.slice(0, 12);
  let resumeHtml = '';
  try {
    const bulk = await api(`/api/mdex/bulk?ids=${items12.map((i) => i.manga_id).join(',')}`);
    const byId = new Map(bulk.data.map((m) => [m.id, m]));
    resumeHtml += items12.filter((i) => byId.has(i.manga_id)).map((i) => resumeCard(byId.get(i.manga_id), i)).join('');
  } catch {}
  {
    const row = $('#resumeRow');
    if (!row) return;
    row.innerHTML = resumeHtml;
    if (!row.children.length) return;
    sect.style.display = '';
    row.querySelectorAll('.resume-card').forEach((el) => {
      el.addEventListener('click', () => { location.hash = `#/reader/${el.dataset.manga}/${el.dataset.cid}/${el.dataset.page}`; });
    });
  }
}

// ----- Latest / auto-refresh -----
let latestPoll = null;
let seenLatest = new Set();
function stopLatestPoll() {
  if (latestPoll) { clearInterval(latestPoll); latestPoll = null; }
}

function timeAgo(iso) {
  if (!iso) return 'recently';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

function latestItem(m) {
  const img = coverUrl(m);
  const lch = m._lbl || (m.attributes && m.attributes.lastChapter);
  const ago = timeAgo(m.attributes && m.attributes.updatedAt);
  return `
    <div class="latest-item" data-id="${esc(m.id)}">
      ${img ? `<img class="cover" loading="lazy" referrerpolicy="no-referrer" src="${img}" alt="" />` : '<div class="cover"></div>'}
      <div class="info">
        <div class="title">${esc(titleOf(m))}</div>
        <div class="meta">${lch ? `Ch. ${esc(lch)}` : 'Latest update'} &middot; ${esc(ago)}</div>
      </div>
    </div>`;
}

async function refreshLatest() {
  const row = $('#latestRow');
  if (!row) return;
  try {
    const mature = loadPrefs().mature ? 1 : 0;
    const data = await api(`/api/mdex/latest?mature=${mature}`);
    const items = data.data || [];
    const ids = new Set(items.map((m) => m.id));
    if (seenLatest.size && [...ids].some((id) => !seenLatest.has(id))) toast('New chapters just dropped!');
    seenLatest = ids;
    if (!items.length) { row.innerHTML = '<div class="centered small">Nothing here yet</div>'; return; }
    const chMeta = data.chapters || {};
    items.forEach((m) => {
      const cid = m.attributes && m.attributes.latestUploadedChapter;
      m._lbl = cid && chMeta[cid] && chMeta[cid].label ? chMeta[cid].label : null;
    });
    row.innerHTML = items.slice(0, 14).map(latestItem).join('');
    row.querySelectorAll('.latest-item').forEach((el) =>
      el.addEventListener('click', () => { location.hash = `#/title/${el.dataset.id}`; }));
  } catch {}
}

function startLatestPoll() {
  stopLatestPoll();
  latestPoll = setInterval(refreshLatest, 60000);
}

// ----- Home -----
async function renderHome() {
  stopLatestPoll();
  const prefs = loadPrefs();
  const mature = prefs.mature ? 1 : 0;
  const progressMap = new Map();
  const hasMy = prefs.myGenres.length > 0;
  const sec = prefs.sections;

  view.innerHTML = `
    <div class="brand-hero">
      <img src="assets/chibi.png" alt="MyGhoulScans" />
      <div class="brand-title">MyGhoulScans</div>
      <div class="brand-tag">manga &middot; manhwa &middot; manhua</div>
    </div>
    <div class="home-wrap">
      <div class="home-main">
        <div class="sect" id="continueSect" style="display:none">
          <h2 class="sect-title">Continue reading</h2>
          <div class="hrow-wrap">
            <button class="row-ctrl prev" data-row="resumeRow" title="Scroll left">&#10094;</button>
            <div class="hrow" id="resumeRow"></div>
            <button class="row-ctrl next" data-row="resumeRow" title="Scroll right">&#10095;</button>
          </div>
        </div>
        ${sec.new ? section('New', 'newRow', 'freshly added') : ''}
        ${hasMy && sec.myGenres ? section('For you', 'myRow', 'your genres') : ''}
        ${sec.manga ? section('Manga', 'mangaRow', 'Japanese') : ''}
        ${sec.manhwa ? section('Manhwa', 'manhwaRow', 'Korean') : ''}
        ${sec.manhua ? section('Manhua', 'manhuaRow', 'Chinese') : ''}
        ${sec.rec ? `<div class="sect">
          <h2 class="sect-title">Recommended for you</h2>
          <div class="grid" id="recGrid">${spinner(8)}</div>
        </div>` : ''}
      </div>
      <aside class="home-side">
        ${(sec.latest || sec.trending) ? `
          <div class="sect side-sect" style="margin:0">
            <div class="side-tabs" id="sideTabs">
              ${sec.latest ? '<button class="tab-btn active" data-tab="latest">Just updated</button>' : ''}
              ${sec.trending ? '<button class="tab-btn" data-tab="trend">Trending</button>' : ''}
            </div>
            ${sec.latest ? `<div class="tab-pane active" id="tab-latest"><div class="latest-list side" id="latestRow">${spinner(4)}</div></div>` : ''}
            ${sec.trending ? `<div class="tab-pane" id="tab-trend"><div class="trend-list" id="trendList">${spinner(6)}</div></div>` : ''}
          </div>` : ''}
      </aside>
    </div>`;

  view.querySelectorAll('.row-ctrl').forEach((b) => b.addEventListener('click', () => {
    const row = document.getElementById(b.dataset.row);
    if (!row) return;
    const dist = row.clientWidth - 120;
    row.scrollBy({ left: b.classList.contains('prev') ? -dist : dist, behavior: 'smooth' });
  }));
  const sideTabs = $('#sideTabs');
  if (sideTabs) sideTabs.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => {
    const sect = b.closest('.side-sect');
    sect.querySelectorAll('.tab-btn').forEach((x) => x.classList.toggle('active', x === b));
    sect.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'trend') fillTrendSide(mature);
    if (b.dataset.tab === 'latest' && !$('#latestRow').querySelector('.latest-item')) refreshLatest();
  }));
  fillResume(progressMap);

  // Type rows share a dedupe set so a comic only ever appears once, in the
  // section that best fits it (new > manga > manhwa > manhua).
  const used = new Set();
  if (sec.new) await fillRowList('newRow', `/api/mdex/new?mature=${mature}`, used, { progressMap });
  if (sec.manga) await fillRowList('mangaRow', `/api/mdex/manga?mature=${mature}`, used, { progressMap });
  if (sec.manhwa) await fillRowList('manhwaRow', `/api/mdex/manhwa?mature=${mature}`, used, { progressMap });
  if (sec.manhua) await fillRowList('manhuaRow', `/api/mdex/manhua?mature=${mature}`, used, { progressMap });
  if (hasMy && sec.myGenres) fillRow('myRow', `/api/mdex/genre?tags=${encodeURIComponent(prefs.myGenres.join(','))}&mature=${mature}`, { progressMap });
  if (sec.rec) fillGrid('recGrid', `/api/mdex/recommended?mature=${mature}`);
  if (sec.latest) { refreshLatest(); startLatestPoll(); }
  if (sec.trending) fillTrendSide(mature);
}

// Horizontal row filled from an array of manga (used for the type sections so
// they can be de-duplicated against each other).
async function fillRowList(rowId, url, used, extras = {}) {
  const row = document.getElementById(rowId);
  if (!row) return;
  try {
    const data = await api(url);
    const items = (data.data || []).filter((m) => {
      if (used.has(m.id)) return false;
      used.add(m.id);
      return true;
    });
    if (!items.length) { row.innerHTML = '<div class="centered small">Nothing here yet</div>'; return; }
    const { progressMap } = extras;
    items.forEach((m) => { if (hasNewChapters(m, progressMap)) m._new = true; });
    row.innerHTML = items.map((m) => mangaCard(m, { h: true })).join('');
    wireCards(row);
  } catch (e) {
    row.innerHTML = `<div class="centered small">Could not load: ${esc(e.message)}</div>`;
  }
}

// Trending list — fills the "Trending" tab in the home sidebar.
async function fillTrendSide(mature) {
  const box = $('#trendList');
  if (!box) return;
  try {
    const data = await api(`/api/mdex/trending?mature=${mature}`);
    const items = (data.data || []).slice(0, 12);
    if (!items.length) { box.innerHTML = '<div class="centered small">Nothing here yet</div>'; return; }
    box.innerHTML = items.map((m, i) => {
      const img = coverUrl(m);
      const follows = m.attributes && m.attributes.followedCount;
      return `
        <div class="trend-item" data-id="${esc(m.id)}">
          <span class="t-rank ${i < 3 ? 'top' : ''}">${i + 1}</span>
          ${img ? `<img class="t-cover" loading="lazy" referrerpolicy="no-referrer" src="${img}" alt="" />` : '<div class="t-cover"></div>'}
          <div class="t-info">
            <div class="t-title">${esc(titleOf(m))}</div>
            ${follows ? `<div class="t-meta">${follows.toLocaleString()} follows</div>` : ''}
          </div>
        </div>`;
    }).join('');
    box.querySelectorAll('.trend-item').forEach((el) =>
      el.addEventListener('click', () => { location.hash = `#/title/${el.dataset.id}`; }));
  } catch (e) {
    box.innerHTML = `<div class="centered small">Could not load: ${esc(e.message)}</div>`;
  }
}

async function renderGenre(tagId) {
  view.innerHTML = `
    <div class="home-toolbar">
      <div class="page-title" style="margin:0">Genre</div>
      <select id="genreSel" class="genre-select"><option value="">All genres</option></select>
    </div>
    <div class="grid" id="genreGrid">${spinner(6)}</div>`;
  setupGenreSelect(tagId);
  const mature = loadPrefs().mature ? 1 : 0;
  fillGrid('genreGrid', `/api/mdex/genre?tag=${encodeURIComponent(tagId)}&mature=${mature}`);
}

// ---------- search ----------
async function renderSearch(term) {
  const mature = loadPrefs().mature ? 1 : 0;
  const optAll = '<option value="">All genres</option>';
  view.innerHTML = `
    <div class="home-toolbar">
      <div class="page-title" style="margin:0">${term ? `Results for &ldquo;${esc(term)}&rdquo;` : 'Search'}</div>
      <select id="searchGenre" class="genre-select">${optAll}</select>
    </div>
    <div class="grid" id="searchGrid">${spinner().repeat(8)}</div>`;
  const sel = $('#searchGenre');
  genreOptions().then((list) => {
    sel.innerHTML = optAll + list.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  });
  const run = async (tag) => {
    const grid = $('#searchGrid');
    grid.innerHTML = spinner().repeat(8);
    try {
      const data = await api(`/api/mdex/search?q=${encodeURIComponent(term)}&mature=${mature}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`);
      if (!data.data || !data.data.length) grid.innerHTML = '<div class="centered">No results. Try a different title.</div>';
      else { grid.innerHTML = data.data.map(mangaCard).join(''); wireCards(grid); }
    } catch (e) {
      grid.innerHTML = `<div class="centered">Search failed: ${esc(e.message)}</div>`;
    }
  };
  sel.addEventListener('change', () => run(sel.value));
  await run('');
}

function wireGrid(data) {
  const grid = view.querySelector('.grid');
  grid.innerHTML = data.data.map(mangaCard).join('');
  if (!view.querySelector('.grid')) return;
  wireCards(grid);
}

// ---------- title page ----------
const MAX_CHAPTERS = 6;
function chapterItemHtml(c, progress, counts) {
  const num = c.attributes.chapter || '?';
  const title = c.attributes.title || '';
  const isCurrent = progress && c.id === progress.chapter_id;
  const n = (counts || {})[c.id] || 0;
  return `
    <div class="chapter-item ${isCurrent ? 'current' : ''}" data-cid="${esc(c.id)}">
      <span class="cnum">Ch. ${esc(num)}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</span>
      ${isCurrent ? '<span class="resume-flag">Last read &middot; p.' + (progress.page + 1) + '</span>' : ''}
      <span class="cmeta"><span class="read-count ${n ? '' : 'none'}" title="people that read this chapter">&#128065; ${n.toLocaleString()}</span> <span class="pg-count">${c.attributes.pages}pg</span></span>
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
  const mature = loadPrefs().mature ? 1 : 0;
  try {
    const info = await api(`/api/mdex/manga/${mangaId}`);
    const feed = await api(`/api/mdex/manga/${mangaId}/feed?mature=${mature}`);
    const manga = info.data;
    const chapters = feed.data;
    let readCounts = {};

    let followed = localBookmarks().has(mangaId);
    let progress = (localProgress())[mangaId] || null;

    const status = manga.attributes.status;
    const authors = (manga.relationships || []).filter((r) => r.type === 'author').map((r) => r.attributes?.name).filter(Boolean);
    const artists = (manga.relationships || []).filter((r) => r.type === 'artist').map((r) => r.attributes?.name).filter(Boolean);
    const tags = (manga.attributes.tags || []).slice(0, 6).map((t) => {
      const n = t.attributes && t.attributes.name;
      return n ? (n.en || Object.values(n)[0]) : '';
    }).filter(Boolean);

    const continued = (manga.attributes.lastChapter && manga.attributes.lastChapter.length) || '';

    view.innerHTML = `
      <div class="title-hero">
        <img src="${coverUrl(manga)}" alt="" referrerpolicy="no-referrer" />
        <div class="title-info">
          <h1>${esc(titleOf(manga))}</h1>
          ${altOf(manga) ? `<div class="tagline">${esc(altOf(manga))}</div>` : ''}
          <div class="chips">
            ${statusBadge(status)}
            <span class="chip">${esc((status || '').toUpperCase())}</span>
            <span class="chip">${esc(yearOf(manga))}${continued ? ' &ndash; ' + esc(continued) : ''}</span>
            ${authors.length ? `<span class="chip">By ${esc(authors.join(', '))}</span>` : ''}
          </div>
          ${manga.attributes.description ? `<div class="summary">${esc(manga.attributes.description.en || '')}</div>` : ''}
          ${tags.length ? `<div class="chips">${tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="title-actions">
            ${progress ? `<button class="btn primary" id="resumeBtn">Continue: Ch. ${esc(progress.chapter_label || progress.chapter_id.slice(0, 8))} &#183; p.${progress.page + 1}</button>` : ''}
            <button class="btn ${followed ? 'primary' : ''}" id="followBtn">${followed ? 'Bookmarked' : 'Bookmark'}</button>
          </div>
          <div class="small" style="margin-top:6px">${chapters.length} readable chapters</div>
        </div>
      </div>
      <div class="page-title" style="font-size:18px">Chapters</div>
      ${(() => {
        const nums = chapters.map((c) => parseFloat(c.attributes.chapter)).filter((n) => !isNaN(n));
        const gaps = nums.length && (Math.max(...nums) - Math.min(...nums) + 1) > nums.length * 1.4;
        return gaps
          ? '<div class="note">Some chapter numbers are missing &mdash; this title is licensed, so those chapters live offsite and aren&rsquo;t on MangaDex. Only the readable ones are listed below.</div>'
          : '';
      })()}
      ${chapters.length ? chapterListHtml(chapters, progress, readCounts)
        : `<div class="centered" style="margin:32px 0">
            <p class="small">No readable English chapters on MangaDex for this title.<br>Licensed or serialized series often host chapters only offsite.</p>
          </div>`}

      <div class="sect">
        <h2 class="sect-title">More like this</h2>
        <div class="hrow-wrap">
          <button class="row-ctrl prev" data-row="simRow" title="Scroll left">&#10094;</button>
          <div class="hrow" id="simRow">${spinner(4)}</div>
          <button class="row-ctrl next" data-row="simRow" title="Scroll right">&#10095;</button>
        </div>
      </div>`;

    $('#followBtn').addEventListener('click', async () => {
      const r = await toggleBookmark(mangaId);
      if (r == null) return; // login prompt shown instead
      const nowF = localBookmarks().has(mangaId);
      $('#followBtn').textContent = nowF ? 'Bookmarked' : 'Bookmark';
      $('#followBtn').classList.toggle('primary', nowF);
      toast(nowF ? 'Bookmarked' : 'Removed bookmark');
    });

    $('#resumeBtn')?.addEventListener('click', () => {
      if (!progress) return;
      location.hash = `#/reader/${mangaId}/${progress.chapter_id}/${progress.page}`;
    });

    view.querySelector('#chapterList')?.addEventListener('click', (e) => {
      const it = e.target.closest('.chapter-item');
      if (!it) return;
      location.hash = `#/reader/${mangaId}/${it.dataset.cid}/0`;
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

    fillSimilar(manga, mature);
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
  const titleHref = `#/title/${mangaId}`;
  view.innerHTML = `
    <div class="rprog" id="rProgress" hidden><i></i></div>
    <div class="reader-top" id="readerTop">
      <div class="rbar-row1">
        <a class="rbar-logo" href="${titleHref}" title="Back to title" aria-label="Back to title"><img id="rCover" src="assets/chibi.png" alt="" referrerpolicy="no-referrer" /></a>
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
  $('#fabShare').addEventListener('click', shareChapter);
  $('#fabGear').addEventListener('click', openRS);

  try {
    // Normalized chapter data for the shared reader below.
    // { mangaTitle, coverSrc, chapters:[{id,num,title,pub}], idx,
    //   urls, altUrls, updatedText, infoHtml, chapterId, qualityNote }
    let DATA;
    {
    const mangaInfo = await api(`/api/mdex/manga/${mangaId}`);
    const mdexTitle = titleOf(mangaInfo.data);
    const feed = (await api(`/api/mdex/manga/${mangaId}/feed`)).data || [];
    if (!alive()) return;

    let idx = feed.findIndex((c) => c.id === chapterId);
    if (idx === -1) idx = 0;

    // Deleted/unlisted chapters still appear in the feed but 404 on at-home;
    // a busy MangaDex can also 502/403 them. Skip forward (up to 20) to the
    // next chapter that can actually be read, only surfacing real failures.
    let cid = null, atHome = null;
    const skipFail = (s) => s >= 500 || s === 404 || s === 410 || s === 403;
    for (let i = idx; i < feed.length && i < idx + 20; i++) {
      try {
        const at = await api(`/api/mdex/chapter/${feed[i].id}/at-home`);
        if (at.chapter && ((at.chapter.data || []).length || (at.chapter.dataSaver || []).length)) {
          cid = feed[i].id; atHome = at; idx = i; break;
        }
      } catch (e) {
        if (!skipFail(e.status)) throw e; // unexpected (auth/network): surface it
      }
    }
    if (!alive()) return;

    if (!cid) {
      view.innerHTML = `
        <div class="reader-top">
          <button class="btn ghost" id="backBtn">&larr; Title</button>
          <span class="rtitle">${esc(mdexTitle)}</span>
        </div>
        <div class="centered" style="margin-top:80px">
          <h3>Chapter unavailable</h3>
          <p class="small">This chapter was deleted or has no uploaded pages on MangaDex.</p>
          <button class="btn primary" id="gobackBtn">Back to title</button>
        </div>`;
      $('#gobackBtn').addEventListener('click', () => { location.hash = titleHref; });
      const ubBack = $('#backBtn');
      if (ubBack) ubBack.addEventListener('click', () => { location.hash = titleHref; });
      return;
    }

    // keep the URL in sync with the chapter actually rendered
    if (cid !== chapterId) history.replaceState(null, '', `#/reader/${mangaId}/${cid}/0`);

    const hash = atHome.chapter.hash;
    const base = atHome.baseUrl;
    const saver = atHome.chapter.dataSaver || [];
    const full = atHome.chapter.data || [];
    const p = (u) => `/api/img?u=${encodeURIComponent(u)}`;
    // Preferred quality first — but if the chapter only ships the other one
    // (e.g. no full-quality files), fall back instead of showing zero pages.
    let useSaver = saver.length > 0 && loadPrefs().useSaver;
    let docs = useSaver ? saver : full;
    let sub = useSaver ? 'data-saver' : 'data';
    let qualityNote = '';
    if (!docs.length) {
      docs = useSaver ? full : saver;
      sub = useSaver ? 'data' : 'data-saver';
      useSaver = !useSaver;
      qualityNote = useSaver ? 'Full quality unavailable — using data-saver' : 'Data-saver unavailable — using full quality';
    }
    const urls = docs.map((f) => p(`${base}/${sub}/${hash}/${f}`));
    // Fallback pool goes both directions so a retry can switch quality when
    // one set of files is dead on the CDN.
    const altPool = useSaver ? full : saver;
    const altSub = useSaver ? 'data' : 'data-saver';
    const altUrls = altPool.length ? altPool.map((f) => p(`${base}/${altSub}/${hash}/${f}`)) : [];
    const chapters = feed.map((c) => ({
      id: c.id,
      num: (c.attributes && c.attributes.chapter) || '',
      title: (c.attributes && c.attributes.title) || '',
      pub: c.attributes && (c.attributes.publishAt || c.attributes.readableAt),
    }));
    const cur = chapters[idx];
    const { rel: relUp, abs: absUp } = relDate(cur.pub);
    const genreNames = (mangaInfo.data.attributes.tags || [])
      .filter((t) => t.attributes && t.attributes.group === 'genre')
      .map((t) => t.attributes.name && t.attributes.name.en)
      .filter(Boolean).slice(0, 4).join(', ');
    DATA = {
      mangaTitle: mdexTitle,
      coverSrc: coverUrl(mangaInfo.data),
      chapters, idx, urls, altUrls,
      updatedText: cur.pub ? `Updated ${relUp}` : '',
      infoHtml: `You are reading <b>Chapter ${esc(cur.num || '?')} of ${esc(mdexTitle)}</b> on <b>MyGhoulScans</b>.`
        + (genreNames ? ` This <b>${esc(genreNames)}</b> comic features <b>${urls.length} images</b>`
          : ` This comic features <b>${urls.length} images</b>`)
        + (absUp ? ` and was last updated on <b>${esc(absUp)}</b>` : '') + '.',
      chapterId: cid,
      qualityNote,
    };
    }

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
    chSel.addEventListener('change', () => { location.hash = `#/reader/${mangaId}/${chSel.value}/0`; });

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
      setLocalProgress(mangaId, { chapter_id: cid, page, chapter_label: chapterLabel });
    };
    savePage(startPage);

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
    if (prev) { prevBtn.disabled = false; prevBtn.addEventListener('click', () => { location.hash = `#/reader/${mangaId}/${prev.id}/0`; }); }
    else prevBtn.disabled = true;
    if (next) { nextBtn.disabled = false; nextBtn.addEventListener('click', () => { location.hash = `#/reader/${mangaId}/${next.id}/0`; }); }
    else nextBtn.disabled = true;

    // bottom-of-chapter nav — this is where "next" lives on mobile
    const endNext = $('#endNextBtn'), endPrev = $('#endPrevBtn');
    const goTo = (id) => () => { location.hash = `#/reader/${mangaId}/${id}/0`; };
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
      if (i < 0) { if (prev) location.hash = `#/reader/${mangaId}/${prev.id}/0`; return; }
      if (i >= urls.length) { if (next) location.hash = `#/reader/${mangaId}/${next.id}/0`; return; }
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
      if (e.key === 'ArrowLeft' && prev) { location.hash = `#/reader/${mangaId}/${prev.id}/0`; }
      if (e.key === 'ArrowRight' && next) { location.hash = `#/reader/${mangaId}/${next.id}/0`; }
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

async function fillSimilar(manga, mature) {
  const row = $('#simRow');
  if (!row) return;
  const tags = (manga.attributes.tags || []).filter((t) => t.attributes && t.attributes.group === 'genre').slice(0, 3).map((t) => t.id);
  if (!tags.length) { row.closest('.sect').style.display = 'none'; return; }
  try {
    const data = await api(`/api/mdex/genre?tags=${encodeURIComponent(tags.join(','))}&mature=${mature}`);
    const items = (data.data || []).filter((m) => m.id !== manga.id).slice(0, 10);
    if (!items.length) { row.closest('.sect').style.display = 'none'; return; }
    row.innerHTML = items.map((m) => mangaCard(m, { h: true })).join('');
    wireCards(row);
  } catch {
    row.closest('.sect').style.display = 'none';
  }
}

// ---------- library (this browser's bookmarks) ----------
async function renderLibrary() {
  view.innerHTML = `<div class="page-title">My Library</div><div class="grid">${spinner().repeat(8)}</div>`;
  const mangaIds = [...localBookmarks()];
  if (!mangaIds.length) {
    view.innerHTML = `<div class="centered">Your library is empty. Bookmark comics you want to keep reading &mdash; use the &#128279; icon on any card or the &ldquo;Bookmark&rdquo; button on a title page.</div>`;
    return;
  }
  try {
    const grid = view.querySelector('.grid');
    const data = await api(`/api/mdex/bulk?ids=${encodeURIComponent(mangaIds.join(','))}`);
    grid.innerHTML = data.data.map((m) => mangaCard(m)).join('') || '<div class="centered">Your library is empty.</div>';
    wireCards(grid);
  } catch (e) {
    view.innerHTML = `<div class="centered">Could not load library: ${esc(e.message)}</div>`;
  }
}

// ---------- popular (top 10 most-followed on MangaDex) ----------
async function renderPopular() {
  view.innerHTML = `<div class="page-title">Top 10 &mdash; most followed</div><p class="small" style="margin:-10px 0 16px">The most-followed titles on MangaDex right now.</p><div class="pop-list" id="popList">${spinner()}</div>`;
  const list = document.getElementById('popList');
  try {
    const mature = loadPrefs().mature ? '1' : '0';
    const { data, follows } = await api(`/api/mdex/popular-top?mature=${mature}`);
    if (!data.length) { list.innerHTML = '<div class="centered">Nothing here right now.</div>'; return; }
    const max = data.reduce((a, m) => Math.max(a, (follows && follows[m.id]) || 0), 1);
    list.innerHTML = data.map((m, i) => {
      const img = coverUrl(m);
      const n = (follows && follows[m.id]) || 0;
      const w = Math.round((n / max) * 100);
      return `
        <div class="pop-item" data-id="${esc(m.id)}">
          <div class="pop-rank">${i + 1}</div>
          ${img ? `<img class="pop-cover" loading="lazy" referrerpolicy="no-referrer" src="${img}" alt="" />` : '<div class="pop-cover"></div>'}
          <div class="pop-info">
            <div class="pop-name">${esc(titleOf(m))}</div>
            <div class="pop-track"><div class="pop-bar" style="width:${w}%"></div></div>
          </div>
          <div class="pop-count" title="follows"><b>${n.toLocaleString()}</b><span class="small"> follows</span></div>
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

// ---------- genres dropdown ----------
async function initGenreDropdown() {
  const btn = $('#genreDropBtn');
  const menu = $('#genreMenu');
  if (!btn || !menu) return;
  const tag = (t) => `<a href="#/genre/${esc(t.id)}">${esc(t.name)}</a>`;
  menu.innerHTML = (await genreOptions()).map(tag).join('');
  const open = (show) => menu.classList.toggle('hidden', !show);
  btn.addEventListener('click', (e) => { e.stopPropagation(); open(menu.classList.contains('hidden')); });
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) { open(false); }
  });
  document.addEventListener('click', () => open(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
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
  await syncBookmarksFromServer();
  route();
});