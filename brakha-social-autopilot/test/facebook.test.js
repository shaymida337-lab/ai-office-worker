import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkFacebook, writeSecrets, readSecrets, effectiveEnv, mask } from '../src/facebook.js';

const PAGE = '1234567890';
function graph(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    const u = new URL(url);
    const key = Object.keys(routes).find((k) => u.pathname.endsWith(k));
    const body = key ? routes[key] : { error: { message: 'not found', code: 803 } };
    return { ok: !body.error, status: body.error ? 400 : 200, json: async () => body };
  };
  f.calls = calls;
  return f;
}

test('טוקן דף עם כל ההרשאות → תקין; רק בקשות GET, בלי feed/photos', async () => {
  const f = graph({
    '/debug_token': { data: { is_valid: true, type: 'PAGE', scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'], expires_at: 0 } },
    '/me': { id: PAGE, name: 'ברכה והצלחה שיפוצים' },
    [`/${PAGE}`]: { id: PAGE, name: 'ברכה והצלחה שיפוצים', link: 'https://www.facebook.com/x', category: 'Contractor' },
  });
  const r = await checkFacebook({ pageId: PAGE, token: 'EAAB'.padEnd(40, 'x'), fetchImpl: f });
  assert.equal(r.ok, true, JSON.stringify(r.steps));
  assert.equal(r.tokenType, 'PAGE'); assert.deepEqual(r.missingScopes, []);
  assert.equal(r.page.name, 'ברכה והצלחה שיפוצים');
  assert.ok(f.calls.every((c) => c.method === 'GET' && c.url.startsWith('https://graph.facebook.com/')));
  assert.ok(!f.calls.some((c) => /\/(feed|photos)\b/.test(c.url)));
});

test('הרשאה חסרה / דף אחר / טוקן פג — מדווחים בעברית ולא "תקין"', async () => {
  const missing = graph({ '/debug_token': { data: { is_valid: true, type: 'PAGE', scopes: ['pages_show_list', 'pages_read_engagement'] } }, '/me': { id: PAGE, name: 'ד' }, [`/${PAGE}`]: { id: PAGE, name: 'ד' } });
  const r1 = await checkFacebook({ pageId: PAGE, token: 't'.repeat(30), fetchImpl: missing });
  assert.equal(r1.ok, false); assert.deepEqual(r1.missingScopes, ['pages_manage_posts']);
  const other = graph({ '/debug_token': { data: { is_valid: true, type: 'PAGE', scopes: ['pages_manage_posts', 'pages_read_engagement'] } }, '/me': { id: '999', name: 'דף אחר' }, '/999': { id: '999', name: 'דף אחר' } });
  const r2 = await checkFacebook({ pageId: PAGE, token: 't'.repeat(30), fetchImpl: other });
  assert.equal(r2.ok, false); assert.ok(r2.steps.some((x) => /דף אחר/.test(x.msg)));
  const expired = graph({ '/debug_token': { data: { is_valid: false } }, '/me': { error: { message: 'Session has expired', code: 190 } } });
  const r3 = await checkFacebook({ pageId: PAGE, token: 't'.repeat(30), fetchImpl: expired });
  assert.equal(r3.ok, false); assert.ok(r3.steps.some((x) => /אינו בתוקף/.test(x.msg)));
  const none = await checkFacebook({ token: '' });
  assert.equal(none.ok, false);
});

test('טוקן משתמש: בודק שהמשתמש מנהל את הדף ויש לו CREATE_CONTENT', async () => {
  const f = graph({
    '/debug_token': { data: { is_valid: true, type: 'USER', scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'] } },
    '/me': { id: '55', name: 'מנהל' },
    '/me/accounts': { data: [{ id: PAGE, name: 'ברכה והצלחה שיפוצים', tasks: ['ANALYZE', 'CREATE_CONTENT', 'MODERATE'] }] },
    [`/${PAGE}`]: { id: PAGE, name: 'ברכה והצלחה שיפוצים' },
  });
  const r = await checkFacebook({ pageId: PAGE, token: 'u'.repeat(30), fetchImpl: f });
  assert.equal(r.ok, true, JSON.stringify(r.steps)); assert.equal(r.canCreateContent, true);
});

test('סודות: נשמרים מקומית בהרשאות מוגבלות, ‏.env גובר, ומוצגים רק במסכה', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brakha-sec-'));
  writeSecrets(dir, { FB_PAGE_ID: PAGE, FB_PAGE_ACCESS_TOKEN: 'EAAsecret1234567890' });
  assert.equal(readSecrets(dir).FB_PAGE_ID, PAGE);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'secrets.json')).mode & 0o777, 0o600);
  assert.equal(effectiveEnv({}, dir).FB_PAGE_ACCESS_TOKEN, 'EAAsecret1234567890');
  assert.equal(effectiveEnv({ FB_PAGE_ACCESS_TOKEN: 'fromenv' }, dir).FB_PAGE_ACCESS_TOKEN, 'fromenv');
  assert.ok(!mask('EAAsecret1234567890').includes('secret'));
  writeSecrets(dir, { FB_PAGE_ACCESS_TOKEN: null });
  assert.equal(readSecrets(dir).FB_PAGE_ACCESS_TOKEN, undefined);
});
