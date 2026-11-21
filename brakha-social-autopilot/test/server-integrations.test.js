import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';
import { IL, FIXTURE } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/sheet-leads-sample.json'), 'utf8')).values;
const TOKEN = 'EAAGsecretTOKENvalue1234567890';

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brakha-int-'));
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    const u = new URL(url);
    if (u.host === 'www.hebcal.com') return { ok: true, status: 200, json: async () => FIXTURE };
    if (u.host === 'graph.facebook.com') {
      const body = u.pathname.endsWith('/debug_token') ? { data: { is_valid: true, type: 'PAGE', scopes: ['pages_read_engagement', 'pages_show_list'] } }
        : { id: '1234567890', name: 'ברכה והצלחה שיפוצים' };
      return { ok: true, status: 200, json: async () => body };
    }
    throw new Error(`unexpected ${url}`);
  };
  const app = createApp({ dataDir: dir, env: {}, fetchImpl, clock: () => IL('2026-11-24', 10) });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  app.server.unref();
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = Buffer.from(await res.arrayBuffer()).toString('utf8'); // שומר BOM
    let json = null; try { json = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, body: json, text, type: res.headers.get('content-type'), disp: res.headers.get('content-disposition') };
  };
  return { app, call, dir, calls };
}

test('פייסבוק: שמירה מקומית, בדיקה ב-GET בלבד, הטוקן לא דולף לממשק או לגיבוי, ופרסום חי נשאר כבוי', async () => {
  const { app, call, dir, calls } = await boot();
  assert.equal((await call('POST', '/api/facebook/credentials', { pageId: 'abc', token: TOKEN })).status, 400);
  const r = await call('POST', '/api/facebook/credentials', { pageId: '1234567890', token: TOKEN });
  assert.equal(r.status, 200); assert.ok(!r.text.includes(TOKEN));
  const chk = (await call('POST', '/api/facebook/check')).body;
  assert.equal(chk.ok, false); assert.deepEqual(chk.missingScopes, ['pages_manage_posts']); assert.equal(chk.liveEnabled, false);
  assert.ok(calls.filter((c) => c.url.includes('graph.facebook.com')).every((c) => c.method === 'GET'));
  const st = await call('GET', '/api/state');
  assert.ok(!st.text.includes(TOKEN), 'הטוקן לא מופיע ב-state');
  assert.equal(st.body.connections.facebookPage.tokenPresent, true);
  assert.equal(st.body.settings.mode, 'simulation');
  const exp = await call('GET', '/api/export');
  assert.ok(!exp.text.includes(TOKEN), 'הטוקן לא בגיבוי'); assert.match(exp.disp, /attachment/);
  assert.ok(!fs.readFileSync(path.join(dir, 'db.json'), 'utf8').includes(TOKEN));
  assert.equal((await call('DELETE', '/api/facebook/credentials')).status, 200);
  assert.equal((await call('GET', '/api/state')).body.connections.facebookPage.tokenPresent, false);
  await app.stop();
});

test('גיליון: ייבוא CSV פעמיים בלי כפילויות; סנכרון API בלי מפתח מחזיר הסבר', async () => {
  const { app, call } = await boot();
  const csv = SAMPLE.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const r1 = (await call('POST', '/api/sheet/import-csv', { csv })).body;
  assert.equal(r1.result.added, 6); assert.equal(r1.result.real, 3); assert.equal(r1.result.qa, 3);
  const r2 = (await call('POST', '/api/sheet/import-csv', { csv })).body;
  assert.equal(r2.result.added, 0);
  const st = (await call('GET', '/api/state')).body;
  assert.equal(st.leads.length, 6); assert.equal(st.stats.leads.total, 3);
  const sync = await call('POST', '/api/sheet/sync');
  assert.equal(sync.status, 400); assert.match(sync.body.error, /Service Account/);
  assert.equal((await call('POST', '/api/sheet/service-account', { json: '{"type":"x"}' })).status, 400);
  assert.equal((await call('POST', '/api/sheet/settings', { spreadsheetId: 'bad id' })).status, 400);
  await app.stop();
});

test('דוח וייצוא: JSON לדוח, CSV עם BOM לכל סוג, ושחזור דורש אישור', async () => {
  const { app, call } = await boot();
  const csv = SAMPLE.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  await call('POST', '/api/sheet/import-csv', { csv });
  const rep = (await call('GET', '/api/report?from=2026-11-01&to=2026-11-30')).body;
  assert.equal(rep.totals.real, 3); assert.ok(rep.byCity.length >= 2);
  assert.equal((await call('GET', '/api/report?from=bad')).status, 400);
  for (const k of ['leads', 'posts', 'history', 'report']) {
    const r = await call('GET', `/api/export/${k}.csv`);
    assert.equal(r.status, 200); assert.match(r.type, /text\/csv/); assert.ok(r.text.startsWith('﻿')); assert.match(r.disp, /\.csv/);
  }
  const backup = (await call('GET', '/api/export')).body;
  assert.equal((await call('POST', '/api/backup/restore', { data: backup, confirm: 'כן' })).status, 400);
  const ok = await call('POST', '/api/backup/restore', { data: backup, confirm: 'שחזר' });
  assert.equal(ok.status, 200); assert.equal(ok.body.leads, 6);
  assert.ok((await call('POST', '/api/backups/now')).body.file);
  assert.ok((await call('GET', '/api/backups')).body.length >= 2);
  await app.stop();
});
