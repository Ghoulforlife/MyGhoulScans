// Builds the GitHub Pages standalone: inlines public/ into one index.html
// with API calls rewritten to the Cloudflare worker (Bearer token auth).
// Usage: node scripts/build-standalone.mjs [worker-url]
// Output: index.html (repo root — this is what Pages serves).
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WORKER_URL = process.argv[2] || 'https://myghoulscans-api.kev2op2021.workers.dev';

const fail = (msg) => { console.error('build-standalone: ' + msg); process.exit(1); };
const replaceOnce = (src, oldStr, newStr, label) => {
  const i = src.indexOf(oldStr);
  if (i === -1) fail('pattern not found: ' + label);
  if (src.indexOf(oldStr, i + 1) !== -1 && !label.endsWith('[many]')) fail('pattern not unique: ' + label);
  return src.slice(0, i) + newStr + src.slice(i + oldStr.length);
};

let html = readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
let js = readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const chibi = readFileSync(path.join(root, 'public', 'assets', 'chibi.png')).toString('base64');
const chibiUri = `data:image/png;base64,${chibi}`;

// ---------- JS patches ----------
// 1. api() shim → worker + Bearer token helpers.
const apiOld = `async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    refreshAuth();
    const e = new Error('not-authed');
    e.status = 401;
    throw e;
  }`;
js = replaceOnce(js, apiOld, `// Static build: the API lives on the Cloudflare worker (another origin),
// so every /api/* call is rewritten there and the session travels as a
// Bearer token instead of a cookie.
const API_BASE = '${WORKER_URL}';
function getToken() {
  try { return localStorage.getItem('mgs_token'); } catch { return null; }
}
function setToken(t) {
  try {
    if (t) localStorage.setItem('mgs_token', t);
    else localStorage.removeItem('mgs_token');
  } catch {}
}
function wfetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const tok = getToken();
  if (tok) headers.Authorization = \`Bearer \${tok}\`;
  return fetch(API_BASE + path.slice(4), { ...opts, headers });
}
async function api(path, opts = {}) {
  if (!path.startsWith('/api/')) throw new Error('Not available in this build');
  const headers = { ...(opts.headers || {}) };
  if (typeof opts.body === 'string' && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await wfetch(path, { ...opts, headers });
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    refreshAuth();
    const e = new Error('not-authed');
    e.status = 401;
    throw e;
  }`, 'api() shim');

// 2. Direct fetch('/api/…') calls → wfetch (auth, account, originals posts).
js = js.split(`fetch('/api/`).join(`wfetch('/api/`);
js = js.split('fetch(`/api/').join('wfetch(`/api/');
if (/(^|[^a-zA-Z])fetch\(['`]\/api\//.test(js)) fail('unpatched fetch remains');

// 3. Capture login/signup token.
js = replaceOnce(js, `      await api(signup ? '/api/auth/signup' : '/api/auth/login', {`,
  `      const _authRes = await api(signup ? '/api/auth/signup' : '/api/auth/login', {`, 'auth submit');
js = replaceOnce(js, `        body: JSON.stringify(signup ? { email, password, displayName: name } : { email, password }),
      });
      closeModal();`,
  `        body: JSON.stringify(signup ? { email, password, displayName: name } : { email, password }),
      });
      setToken(_authRes.token || null);
      closeModal();`, 'auth token capture');

// 4. Account-delete clears the token (logout clears it explicitly itself).
js = replaceOnce(js, `      currentUser = null;
      refreshAuth();
      toast('Account deleted');`,
  `      currentUser = null;
      setToken(null);
      refreshAuth();
      toast('Account deleted');`, 'delete token clear');

// 5. Google OAuth can't work cross-origin — hide the button (keep the element).
js = replaceOnce(js, `<div class="goog-opt"><a id="googleBtn">Continue with Google</a></div>`,
  `<div class="goog-opt" hidden><a id="googleBtn">Continue with Google</a></div>`, 'google hide');

// 6. Originals need file storage (full server only) — hide the nav entries
// (they live in the HTML shell, not the JS).
html = html.split('<a href="#/originals">Originals</a>').join('');

// 7. Custom avatars need file storage — hide the change button (generated icons stay).
js = replaceOnce(js, `<label class="btn ghost" for="acctFile">Change picture</label>`, ``, 'avatar button hide');

// 7b. ...but the data-URL picker works everywhere: unhide it on static.
js = replaceOnce(js, `<button class="btn ghost" id="acctPicStatic" hidden>Change picture</button>`,
  `<button class="btn ghost" id="acctPicStatic">Change picture</button>`, 'static avatar unhide');

// 8. Generated avatar via worker (not same-origin /api on Pages).
js = replaceOnce(js, 'return `/api/avatar/${u.id}.svg`;', 'return `${API_BASE}/auth/avatar/${u.id}.svg`;', 'avatar url');

// 9. Static has no same-origin /api/img — route covers + chapter pages via
// the worker proxy (it also defeats source hotlink protection with Referer).
js = replaceOnce(js, 'return c ? `/api/img?u=${encodeURIComponent(c)}` : \'\';', 'return c ? `${API_BASE}/img?u=${encodeURIComponent(c)}&ref=${encodeURIComponent((data && data.url) || \'\')}` : \'\';', 'proxiedCover');
js = replaceOnce(js, 'coverSrc: titleInfo.cover ? `/api/img?u=${encodeURIComponent(titleInfo.cover)}` : \'\',',
  'coverSrc: titleInfo.cover ? `${API_BASE}/img?u=${encodeURIComponent(titleInfo.cover)}&ref=${encodeURIComponent(titleInfo.url || \'\')}` : \'\',', 'reader cover');
js = replaceOnce(js, 'const img = m && rawImg ? `/api/img?u=${encodeURIComponent(rawImg)}` : rawImg;',
  'const img = m && rawImg ? `${API_BASE}/img?u=${encodeURIComponent(rawImg)}&ref=${encodeURIComponent((m && m.url) || \'\')}` : rawImg;', 'popular cover');
js = replaceOnce(js, '<img src="/api/img?u=${encodeURIComponent(manga.cover)}"',
  '<img src="${API_BASE}/img?u=${encodeURIComponent(manga.cover)}&ref=${encodeURIComponent(manga.url || \'\')}"', 'title hero cover');
// NOTE: chapter pages stay worker-proxied (no &raw=1): shapePages already
// returns absolute worker /img URLs with ref, which hotlink-protected hosts
// require. Previous raw-direct builds broke those images.

// 10. Logo/favicon → inline data URI (no /assets origin on Pages).
js = js.split('/assets/chibi.png').join(chibiUri);
if (js.includes('/assets/')) fail('unpatched /assets/ remains in JS: ' + (js.match(/\/assets\/[a-z0-9._-]+/gi) || []).join(','));

// ---------- HTML shell ----------
if (!html.includes('<link rel="stylesheet" href="/styles.css?v=')) fail('stylesheet link not found');
html = html.replace(/<link rel="stylesheet" href="\/styles\.css\?v=\d+" \/>/, () => `<style>\n${css}\n</style>`);
if (!html.includes('<script src="/app.js?v=')) fail('app script tag not found');
html = html.replace(/<script src="\/app\.js\?v=\d+"><\/script>/, () => `<script>\n${js}\n</script>`);
html = html.split('/assets/chibi.png').join(chibiUri);
if (html.includes('/app.js?v=') || html.includes('/styles.css?v=')) fail('uninlined asset refs remain');

writeFileSync(path.join(root, 'index.html'), html);
console.log(`index.html written (${(html.length / 1024 / 1024).toFixed(2)} MB) → ${WORKER_URL}`);

// syntax-check the patched JS
try {
  const tmp = path.join(root, 'node_modules', '.build-check.cjs');
  writeFileSync(tmp, js);
  execSync(`node --check "${tmp}"`, { stdio: 'pipe' });
  console.log('patched app.js: syntax OK');
} catch (e) {
  fail('patched app.js syntax error: ' + (e.stdout || e.message));
}
