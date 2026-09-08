// temp e2e test for MyGhoulScans
const { spawn } = require('node:child_process');
const http = require('node:http');

const PROJECT = __dirname;
const PORT = 3211;
const child = spawn(process.execPath, ['server.js'], {
  cwd: PROJECT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', d => logs += d);
child.stderr.on('data', d => logs += d);
child.on('exit', (c) => console.log('SERVER EXITED', c));
// Never leave an orphaned test server behind to poison later runs
process.on('uncaughtException', (e) => {
  console.error('UNCAUGHT', e && e.message);
  try { child.kill(); } catch {}
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error('UNHANDLED', e && e.message);
  try { child.kill(); } catch {}
  process.exit(1);
});

function req(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: PORT, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        let j;
        try { j = JSON.parse(b); } catch { j = b; }
        resolve({ status: res.statusCode, body: j, setCookie: res.headers['set-cookie'] });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function multipart(fields, files) {
  const boundary = '----e2e' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields || {})) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files || []) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.type}\r\n\r\n`));
    parts.push(f.buf);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), boundary };
}
function reqBin(method, path, body, contentType, cookie) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      host: '127.0.0.1', port: PORT, path, method,
      headers: {
        'Content-Type': contentType,
        'Content-Length': body.length,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let j;
        try { j = JSON.parse(buf.toString()); } catch { j = buf; }
        resolve({ status: res.statusCode, body: j, buf, headers: res.headers });
      });
    });
    r.on('error', reject);
    r.write(body);
    r.end();
  });
}

(async () => {
  await new Promise(r => setTimeout(r, 2500));
  const results = [];
  const check = (name, cond, extra) => {
    results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);
  };

  // 1. me
  const me = await req('GET', '/api/auth/me');
  check('auth/me', me.status === 200 && me.body.user === null);

  // 2. signup (unique email)
  const ts = Date.now();
  const sg = await req('POST', '/api/auth/signup', { email: `t${ts}@mgs.local`, password: 'secret123', displayName: `Tester${ts}` });
  check('signup', sg.status === 200 && sg.body.user && sg.body.user.email.includes('@mgs.local'), `status=${sg.status}`);
  const cookie = (sg.setCookie && sg.setCookie[0]) ? sg.setCookie[0].split(';')[0] : null;
  check('session cookie flags', /httponly/i.test(sg.setCookie[0]) && /samesite=lax/i.test(sg.setCookie[0]));

  // 2b. username rules: unique (case-insensitive), 2-24 chars
  const du = await req('POST', '/api/auth/signup', { email: `u${ts}@mgs.local`, password: 'secret123', displayName: `Tester${ts}` });
  check('dup username rejected', du.status === 409);
  const du2 = await req('POST', '/api/auth/signup', { email: `v${ts}@mgs.local`, password: 'secret123', displayName: `tester${ts}` });
  check('dup username case-insensitive', du2.status === 409);
  const du3 = await req('POST', '/api/auth/signup', { email: `w${ts}@mgs.local`, password: 'secret123', displayName: 'X' });
  check('short username rejected', du3.status === 400);

  // 3. duplicate signup rejected
  const dup = await req('POST', '/api/auth/signup', { email: `t${ts}@mgs.local`, password: 'secret123' });
  check('duplicate signup rejected', dup.status === 409);

  // 4. login
  const lg = await req('POST', '/api/auth/login', { email: `T${ts}@MGS.LOCAL`, password: 'secret123' });
  check('login', lg.status === 200, lg.body.user && lg.body.user.email);

  // 5. library add + status
  const fid = await req('POST', '/api/library/manga-aaa', {}, cookie);
  check('library add', fid.status === 200);
  const st = await req('GET', '/api/library/manga-aaa/status', null, cookie);
  check('library followed', st.body.followed === true);

  // 6. progress save + get
  const pr = await req('POST', '/api/progress/manga-aaa', { chapterId: 'ch-1', page: 12 }, cookie);
  check('progress save', pr.status === 200);
  const pg = await req('GET', '/api/progress/manga-aaa', null, cookie);
  check('progress get', pg.body.chapter_id === 'ch-1' && pg.body.page === 12);

  // 7. unauthenticated library rejected
  const unauth = await req('GET', '/api/library');
  check('unauth library 401', unauth.status === 401);

  // 8. trending
  const tr = await req('GET', '/api/mdex/trending');
  check('trending', tr.status === 200 && tr.body.data.length > 0, `count=${tr.body.data.length}`);

  // 9. search
  const se = await req('GET', '/api/mdex/search?q=solo%20leveling');
  check('search', se.status === 200 && se.body.data.length > 0, `count=${se.body.data.length}`);

  // 10. real manga feed (pick a trending one with chapters)
  const tr2 = await req('GET', '/api/mdex/trending');
  let feedOk = false, chapterId = null, pagesAtHome = 0;
  for (const m of tr2.body.data.slice(0, 6)) {
    const f = await req('GET', `/api/mdex/manga/${m.id}/feed`);
    if (f.body.data && f.body.data.length > 0) {
      chapterId = f.body.data[0].id;
      feedOk = true;
      const title = (m.attributes.title && m.attributes.title.en) || '(ko)';
      console.log(`  (feed source: ${title}, chapters=${f.body.data.length})`);
      const ah = await req('GET', `/api/mdex/chapter/${chapterId}/at-home`);
      pagesAtHome = ah.body.chapter && ah.body.chapter.data ? ah.body.chapter.data.length : 0;
      break;
    }
  }
  check('feed readable chapters', feedOk, chapterId ? `chapter=${chapterId}s` : 'none found');
  check('at-home pages', pagesAtHome > 0, `pages=${pagesAtHome}`);

  // 12. bulk
  const bk = await req('GET', '/api/mdex/bulk?ids=ade0306c-f4b6-4890-9edb-1ddf04df2039');
  check('bulk', bk.status === 200 && bk.body.data.length === 1);

  // 12b. originals: unauth create rejected
  const oc0 = await req('POST', '/api/originals', { title: 'X' });
  check('originals unauth 401', oc0.status === 401);

  // 12c. originals: create series with cover
  const ocBody = multipart(
    { title: `E2E Comic ${ts}`, description: 'A test original' },
    [{ name: 'cover', filename: 'cover.png', type: 'image/png', buf: PNG1 }]
  );
  const oc = await reqBin('POST', '/api/originals', ocBody.body, `multipart/form-data; boundary=${ocBody.boundary}`, cookie);
  check('originals create', oc.status === 200 && oc.body.id > 0, `id=${oc.body && oc.body.id}`);
  const origId = oc.body.id;

  // 12d. originals: title required + bad file rejected
  const ocBad = multipart({ title: '' }, []);
  const ocBadRes = await reqBin('POST', '/api/originals', ocBad.body, `multipart/form-data; boundary=${ocBad.boundary}`, cookie);
  check('originals title required', ocBadRes.status === 400);
  const ocTxt = multipart(
    { title: 'Nope' },
    [{ name: 'cover', filename: 'x.txt', type: 'text/plain', buf: Buffer.from('hello') }]
  );
  const ocTxtRes = await reqBin('POST', '/api/originals', ocTxt.body, `multipart/form-data; boundary=${ocTxt.boundary}`, cookie);
  check('originals bad cover rejected', ocTxtRes.status === 400);

  // 12e. originals: chapter upload needs pages + owner only
  const chEmpty = multipart({ num: '1' }, []);
  const chEmptyRes = await reqBin('POST', `/api/originals/${origId}/chapters`, chEmpty.body, `multipart/form-data; boundary=${chEmpty.boundary}`, cookie);
  check('originals chapter needs pages', chEmptyRes.status === 400);
  const chBody = multipart(
    { num: '1', title: 'Beginnings' },
    [
      { name: 'pages', filename: 'p1.png', type: 'image/png', buf: PNG1 },
      { name: 'pages', filename: 'p2.png', type: 'image/png', buf: PNG1 },
    ]
  );
  const ch = await reqBin('POST', `/api/originals/${origId}/chapters`, chBody.body, `multipart/form-data; boundary=${chBody.boundary}`, cookie);
  check('originals chapter upload', ch.status === 200 && ch.body.pages === 2, `pages=${ch.body && ch.body.pages}`);
  const sg2 = await req('POST', '/api/auth/signup', { email: `o${ts}@mgs.local`, password: 'secret123' });
  const cookie2 = (sg2.setCookie && sg2.setCookie[0]) ? sg2.setCookie[0].split(';')[0] : null;
  const chForeign = await reqBin('POST', `/api/originals/${origId}/chapters`, chBody.body, `multipart/form-data; boundary=${chBody.boundary}`, cookie2);
  check('originals non-owner 403', chForeign.status === 403);

  // 12f. originals: read back series + chapter + bytes
  const os = await req('GET', `/api/originals/${origId}`);
  check('originals series read', os.status === 200 && os.body.data.chaptersList.length === 1 && os.body.data.cover !== null);
  const och = await req('GET', `/api/originals/chapter/${ch.body.id}`);
  check('originals chapter pages', och.status === 200 && och.body.data.pages.length === 2);
  const page0 = await reqBin('GET', och.body.data.pages[0], Buffer.alloc(0), 'application/octet-stream');
  check('originals page bytes', page0.status === 200 && String(page0.headers['content-type']).startsWith('image/'));
  const ol = await req('GET', `/api/originals?q=E2E%20Comic`);
  check('originals list+search', ol.status === 200 && ol.body.data.some((s) => s.id === origId));

  // 12g1. account: generated avatar + display name change
  const uid = sg.body.user.id;
  const av = await reqBin('GET', `/api/avatar/${uid}.svg`, Buffer.alloc(0), 'application/octet-stream');
  check('avatar svg', av.status === 200 && String(av.headers['content-type']).includes('svg'));
  const holder = await req('POST', '/api/auth/signup', { email: `hold${ts}@mgs.local`, password: 'secret123', displayName: `Holder${ts}` });
  check('holder signup', holder.status === 200);
  const nm = await req('PATCH', '/api/auth/account', { displayName: `Renamed${ts}` }, cookie);
  check('rename', nm.status === 200 && nm.body.user.display_name === `Renamed${ts}`);
  const nmDup = await req('PATCH', '/api/auth/account', { displayName: `holder${ts}` }, cookie);
  check('rename dup rejected', nmDup.status === 409);
  const nmBad = await req('PATCH', '/api/auth/account', { displayName: 'Z' }, cookie);
  check('rename too short', nmBad.status === 400);

  // 12g2. account: password change (wrong current rejected, then OK)
  const pwWrong = await req('PATCH', '/api/auth/account', { currentPassword: 'nope', newPassword: 'newsecret1' }, cookie);
  check('password wrong current rejected', pwWrong.status === 401);
  const pw = await req('PATCH', '/api/auth/account', { currentPassword: 'secret123', newPassword: 'newsecret1' }, cookie);
  check('password changed', pw.status === 200);
  const lgOld = await req('POST', '/api/auth/login', { email: `t${ts}@mgs.local`, password: 'secret123' });
  check('old password dead', lgOld.status === 401);
  const lgNew = await req('POST', '/api/auth/login', { email: `t${ts}@mgs.local`, password: 'newsecret1' });
  check('new password works', lgNew.status === 200);

  // 12g3. account: avatar upload + serve + remove
  const avUp = multipart({}, [{ name: 'avatar', filename: 'a.png', type: 'image/png', buf: PNG1 }]);
  const avUpRes = await reqBin('POST', '/api/auth/avatar', avUp.body, `multipart/form-data; boundary=${avUp.boundary}`, cookie);
  check('avatar upload', avUpRes.status === 200 && avUpRes.body.avatar);
  const avFile = await reqBin('GET', `/uploads/${avUpRes.body.avatar}`, Buffer.alloc(0), 'application/octet-stream');
  check('avatar served', avFile.status === 200 && String(avFile.headers['content-type']).startsWith('image/'));
  const avDel = await req('DELETE', '/api/auth/avatar', null, cookie);
  check('avatar removed', avDel.status === 200);

  // 12g4. account: sessions clear + full delete wipes everything
  const sc = await req('POST', '/api/auth/sessions/clear', {}, cookie);
  check('sessions clear', sc.status === 200);
  const dg = await req('POST', '/api/auth/signup', { email: `doom${ts}@mgs.local`, password: 'secret123', displayName: `Doom${ts}` });
  const dcookie = dg.setCookie[0].split(';')[0];
  await req('POST', '/api/library/manga-doom', {}, dcookie);
  await req('POST', '/api/progress/manga-doom', { chapterId: 'ch-9', page: 3 }, dcookie);
  await req('POST', '/api/comments', { mangaId: 'manga-doom', chapterId: 'ch-9', body: 'bye' }, dcookie);
  const delNo = await req('DELETE', '/api/auth/account', { confirm: 'nope' }, dcookie);
  check('delete needs DELETE', delNo.status === 400);
  const del = await req('DELETE', '/api/auth/account', { confirm: 'DELETE' }, dcookie);
  check('account deleted', del.status === 200);
  const meDoom = await req('GET', '/api/auth/me', null, dcookie);
  check('session dead after delete', meDoom.body.user === null);
  const lgDoom = await req('POST', '/api/auth/login', { email: `doom${ts}@mgs.local`, password: 'secret123' });
  check('login dead after delete', lgDoom.status === 401);
  const comAfter = await req('GET', '/api/comments?chapter=ch-9');
  check('comments wiped', comAfter.status === 200 && (comAfter.body.data || []).length === 0);

  // 12g. login brute-force protection (11th rapid bad attempt => 429)
  let rateStatus = 0;
  for (let i = 0; i < 12; i++) {
    const bad = await req('POST', '/api/auth/login', { email: `t${ts}@mgs.local`, password: 'wrong' });
    rateStatus = bad.status;
  }
  check('login rate limited', rateStatus === 429, `status=${rateStatus}`);

  // 13. logout
  const lo = await req('POST', '/api/auth/logout', {}, cookie);
  const me2 = await req('GET', '/api/auth/me');
  check('logout', lo.status === 200 && me2.body.user === null);

  console.log(results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
  child.kill();
  process.exit(fails ? 1 : 0);
})();