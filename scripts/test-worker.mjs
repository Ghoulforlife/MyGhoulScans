// Smoke-tests a deployed worker (or the local worker.js via import).
// Usage: node scripts/test-worker.mjs [base-url]
//   no arg  → imports ./worker/worker.js and tests it in-process (no D1)
//   with arg → tests that live URL (use after `wrangler deploy`)
const base = process.argv[2];
let call;
if (base) {
  call = async (path, method = 'GET', body) => {
    const r = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  console.log('testing live worker: ' + base);
} else {
  const { default: worker } = await import('../worker/worker.js');
  call = async (path, method = 'GET', body) => {
    const r = await worker.fetch(new Request('https://test' + path, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), {});
    return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
  };
  console.log('testing local worker.js in-process (no D1)');
}
const t = (n, c, x) => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (x ? ' :: ' + x : ''));
let fails = 0;
const check = (n, c, x) => { if (!c) fails++; t(n, c, x); };
let s = await call('/comick/sources');
check('sources', s.status === 200 && s.body.data.length > 5, 'n=' + (s.body.data && s.body.data.length));
s = await call('/comick/search?q=' + encodeURIComponent('solo leveling') + '&source=mangaread');
check('search', s.status === 200 && s.body.data.length > 0, 'n=' + (s.body.data && s.body.data.length));
const id = s.body.data[0].id;
s = await call('/comick/title?id=' + encodeURIComponent(id));
check('title', s.status === 200 && !!s.body.data.title, s.body.data.title);
s = await call('/comick/chapters?id=' + encodeURIComponent(id));
check('chapters', s.status === 200 && s.body.total > 0, 'total=' + s.body.total);
const ch = s.body.data[0];
s = await call('/comick/pages?url=' + encodeURIComponent(ch.url) + '&raw=1');
check('pages', s.status === 200 && s.body.data.length > 3, 'n=' + (s.body.data && s.body.data.length));
s = await call('/comick/latest?source=mangaread');
check('latest', s.status === 200 && s.body.data.length > 5, 'n=' + (s.body.data && s.body.data.length));
s = await call('/comick/genres?source=mangaread');
check('genres', s.status === 200 && s.body.data.length > 10, 'n=' + (s.body.data && s.body.data.length));
s = await call('/comick/genre?source=mangaread&genre=action');
check('genre', s.status === 200 && s.body.data.length > 0, 'n=' + (s.body.data && s.body.data.length));
s = await call('/comick/resolve', 'POST', { ids: [id] });
check('resolve', s.status === 200 && s.body.data.length === 1, '');
s = await call('/originals');
check('originals stub', s.status === 200 && Array.isArray(s.body.data), '');
console.log(fails ? `\n${fails} FAILED` : '\nall worker tests passed');
process.exit(fails ? 1 : 0);
