import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../src/server.js';
import { IL, fixtureFetch } from './helpers.js';

async function boot(now) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brakha-srv-'));
  let clock = now;
  const app = createApp({ dataDir: dir, env: {}, fetchImpl: fixtureFetch, clock: () => clock });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { app, base, call, dir, setNow: (d) => { clock = d; } };
}

test('הממשק נטען בעברית ו-RTL', async () => {
  const { app, base } = await boot(IL('2026-11-22', 10));
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.match(html, /ברכה והצלחה שיפוצים/);
  assert.equal((await fetch(base + '/app.js')).status, 200);
  assert.equal((await fetch(base + '/../src/server.js')).status, 404);
  await app.stop();
});

test('זרימה מלאה דרך ה-API: קבוצה → פוסט → אישור → תזמון → משימה ידנית → פרסום → ליד', async () => {
  const { app, call, dir } = await boot(IL('2026-11-22', 10));
  await call('POST', '/api/calendar/refresh', {});
  let r = await call('POST', '/api/groups', { name: 'שכנים בגבעתיים', type: 'facebook_group', url: 'https://www.facebook.com/groups/abc', areas: ['givatayim'], rulesReviewed: true });
  assert.equal(r.status, 200); const g = r.body;
  assert.equal((await call('POST', '/api/groups', { name: 'כפול', url: 'https://www.facebook.com/groups/abc' })).status, 409);
  r = await call('POST', '/api/posts/generate', { serviceId: 'paint', areaId: 'givatayim', targetId: g.id, count: 2 });
  const [p] = r.body;
  r = await call('PUT', `/api/posts/${p.id}`, { text: `${p.text}\nמאות לקוחות מרוצים` });
  assert.equal((await call('PUT', `/api/posts/${p.id}`, { status: 'approved' })).status, 400, 'lint חוסם אישור');
  await call('PUT', `/api/posts/${p.id}`, { text: p.text });
  assert.equal((await call('PUT', `/api/posts/${p.id}`, { status: 'approved' })).status, 200);
  // תזמון בשבת נדחה מראש
  assert.equal((await call('POST', '/api/schedule', { postId: p.id, targetId: g.id, dueAt: IL('2026-11-28', 12).toISOString() })).status, 400);
  r = await call('POST', '/api/schedule', { postId: p.id, targetId: g.id, dueAt: IL('2026-11-22', 10).toISOString() });
  const sid = r.body.id;
  assert.equal((await call('POST', `/api/schedule/${sid}/mark-published`, {})).status, 409, 'אי אפשר לסמן לפני שהמשימה מוכנה');
  r = await call('POST', '/api/scheduler/tick', {});
  assert.equal(r.body.manual, 1);
  r = await call('POST', `/api/schedule/${sid}/open`, {});
  assert.equal(r.status, 200); assert.equal(r.body.url, 'https://www.facebook.com/groups/abc'); assert.ok(r.body.text.includes('054-442-7244'));
  r = await call('POST', `/api/schedule/${sid}/mark-published`, { url: 'https://www.facebook.com/groups/abc/posts/1' });
  assert.equal(r.body.status, 'published_manual');
  r = await call('POST', '/api/leads', { name: 'אבי', phone: '052-7654321', message: `שלום, אשמח להצעת מחיר (קוד ${p.refCode})` });
  assert.equal(r.body.targetId, g.id); assert.equal(r.body.isTest, false);
  await call('POST', '/api/leads', { name: 'בדיקה', phone: '054-442-7244' });
  const st = (await call('GET', '/api/state')).body;
  assert.equal(st.stats.leads.total, 1); assert.equal(st.stats.leads.qaExcluded, 1); assert.equal(st.stats.posts.manual, 1);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')).leads.length === 2, 'נשמר לדיסק');
  await app.stop();
});

test('שבת: פתיחת משימה ויצירת קשר עם ליד חסומות; עצירת חירום חוסמת', async () => {
  const b = await boot(IL('2026-11-22', 10));
  await b.call('POST', '/api/calendar/refresh', {});
  const g = (await b.call('POST', '/api/groups', { name: 'ק', url: 'https://www.facebook.com/groups/q', rulesReviewed: true })).body;
  const [p] = (await b.call('POST', '/api/posts/generate', { serviceId: 'kitchen', areaId: 'holon', count: 1 })).body;
  await b.call('PUT', `/api/posts/${p.id}`, { status: 'approved' });
  const sid = (await b.call('POST', '/api/schedule', { postId: p.id, targetId: g.id, dueAt: IL('2026-11-27', 11).toISOString() })).body.id;
  const lead = (await b.call('POST', '/api/leads', { name: 'שרה', phone: '0521231234' })).body;
  b.setNow(IL('2026-11-27', 11));
  await b.call('POST', '/api/scheduler/tick', {});
  b.setNow(IL('2026-11-28', 11)); // שבת
  const r = await b.call('POST', `/api/schedule/${sid}/open`, {});
  assert.equal(r.status, 409); assert.ok(r.body.reasons.some((x) => x.code === 'SHABBAT_HOLIDAY'));
  assert.equal((await b.call('POST', `/api/leads/${lead.id}/contact`, {})).status, 409);
  const st = (await b.call('GET', '/api/state')).body;
  assert.equal(st.guard.calendar.allowed, false);
  b.setNow(IL('2026-11-29', 11));
  await b.call('POST', '/api/kill-switch', { on: true });
  assert.equal((await b.call('POST', `/api/schedule/${sid}/open`, {})).status, 409);
  assert.equal((await b.call('POST', '/api/scheduler/tick', {})).body.stopped, true);
  await b.call('POST', '/api/kill-switch', { on: false });
  assert.equal((await b.call('POST', `/api/schedule/${sid}/open`, {})).status, 200);
  await b.app.stop();
});

test('מעבר לפרסום חי דורש הקלדת אישור מפורש', async () => {
  const { app, call } = await boot(IL('2026-11-22', 10));
  assert.equal((await call('POST', '/api/settings', { mode: 'live' })).status, 400);
  assert.equal((await call('POST', '/api/settings', { mode: 'live', confirm: 'כן' })).status, 400);
  const st = (await call('GET', '/api/state')).body;
  assert.equal(st.settings.mode, 'simulation'); assert.equal(st.live.ready, false);
  await app.stop();
});

test('אבטחה: רק localhost, רק JSON', async () => {
  const { app, base } = await boot(IL('2026-11-22', 10));
  const port = new URL(base).port;
  const status = await new Promise((res) => http.get({ host: '127.0.0.1', port, path: '/api/state', headers: { host: 'evil.example' } }, (r) => res(r.statusCode)));
  assert.equal(status, 403);
  const r = await fetch(`${base}/api/kill-switch`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"on":true}' });
  assert.equal(r.status, 415);
  const o = await fetch(`${base}/api/kill-switch`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"on":true}' });
  assert.equal(o.status, 403);
  await app.stop();
});
