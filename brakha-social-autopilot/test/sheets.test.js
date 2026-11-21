import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpStore, addGroup, IL } from './helpers.js';
import { rowsToLeads, importSheetLeads, parseSheetDate, normalizePhone, cityToArea, workToService, parseCsv, signJwt, fetchSheetValues, validateServiceAccount } from '../src/sheets.js';
import { createPost } from '../src/scheduler.js';
import { computeStats } from '../src/leads.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/sheet-leads-sample.json'), 'utf8')).values;
const NOW = IL('2026-11-24', 10);

function fakeSa() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { sa: { type: 'service_account', client_email: 'reader@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' }, publicKey };
}

test('נרמול: תאריכים (מספר סידורי / M/D/YYYY), טלפונים, ערים וסוגי עבודה', () => {
  assert.equal(parseSheetDate('11/19/2026').slice(0, 10), '2026-11-19');
  assert.equal(parseSheetDate(46347).slice(0, 10), '2026-11-21'); // 46348 = 21/11/2026
  assert.equal(parseSheetDate('22.11.2026').slice(0, 10), '2026-11-22');
  assert.equal(parseSheetDate('46347').slice(0, 10), '2026-11-21', 'מספר סידורי כטקסט מ-CSV');
  assert.equal(parseSheetDate(''), null);
  assert.equal(normalizePhone('525550001'), '0525550001');
  assert.equal(normalizePhone('+972 54 555 0003'), '0545550003');
  assert.equal(normalizePhone('054-442-7244'), '0544427244');
  assert.equal(cityToArea('ת"א'), 'tel-aviv');
  assert.equal(cityToArea('רמת גן'), 'ramat-gan');
  assert.equal(cityToArea('קרית אונו'), 'kiryat-ono');
  assert.equal(cityToArea('נס ציונה'), null);
  assert.equal(workToService('שיפוץ אמבטיה'), 'bathroom');
  assert.equal(workToService('צבע וגבס'), 'paint');
  assert.equal(workToService('שיפוץ דירה קומפלט'), 'general');
});

test('ייבוא: שומר את כל הרשומות, מסנן QA, ולא יוצר כפילויות', () => {
  const s = tmpStore();
  const r = importSheetLeads(s, SAMPLE, { now: NOW });
  assert.deepEqual({ rows: r.rows, added: r.added, qa: r.qa, real: r.real, dupInSheet: r.duplicateKeysInSheet }, { rows: 7, added: 6, qa: 3, real: 3, dupInSheet: 1 });
  assert.equal(s.db.leads.length, 6, 'כל הרשומות נשמרות — גם QA (מסומנות)');
  assert.ok(s.db.leads.filter((l) => l.isTest).every((l) => l.qaReasons.length > 0));
  const owner = s.db.leads.find((l) => l.sheetKey === 'k-qa-3');
  assert.ok(owner.isTest, 'מספר העסק + סטטוס QA בגיליון → בדיקה');
  // סנכרון חוזר — אפס חדשים
  const r2 = importSheetLeads(s, SAMPLE, { now: NOW });
  assert.equal(r2.added, 0); assert.equal(r2.unchanged, 6); assert.equal(s.db.leads.length, 6);
  // שורה ללא מפתח כפילות — מפתח יציב מחושב
  assert.ok(s.db.leads.find((l) => l.name === 'לקוח סינתטי ג').sheetKey.startsWith('row:'));
  const st = computeStats(s.db, NOW);
  assert.equal(st.leads.total, 3); assert.equal(st.leads.qaExcluded, 3); assert.equal(st.leads.fromSheet, 3);
  assert.equal(st.leads.byCity['נס ציונה'], 1);
});

test('עדכון שורה בגיליון מעדכן את הליד הקיים ולא דורס סטטוס שהוזן במערכת', () => {
  const s = tmpStore();
  importSheetLeads(s, SAMPLE, { now: NOW });
  const lead = s.db.leads.find((l) => l.sheetKey === 'k-real-2');
  lead.status = 'quote_sent'; lead.value = 9000;
  const changed = SAMPLE.map((r) => (r[16] === 'k-real-2' ? r.map((c, i) => (i === 15 ? 'טופל' : c)) : r));
  const r = importSheetLeads(s, changed, { now: NOW });
  assert.equal(r.updated, 1); assert.equal(r.added, 0);
  assert.equal(lead.sheetStatus, 'טופל'); assert.equal(lead.status, 'quote_sent'); assert.equal(lead.value, 9000);
});

test('ליד מהגיליון עם utm_content=קוד פוסט משויך לפוסט ולקבוצה; ליד ידני זהה מסומן ככפילות', () => {
  const s = tmpStore(); const g = addGroup(s);
  const p = createPost(s, { serviceId: 'bathroom', areaId: 'givatayim', target: g }); // refCode B1001
  assert.equal(p.refCode, 'B1001');
  s.db.leads.push({ id: 'L9000', origin: 'manual', name: 'ידני', phone: '052-555-0001', createdAt: IL('2026-11-21', 9).toISOString(), status: 'new' });
  importSheetLeads(s, SAMPLE, { now: NOW });
  const l = s.db.leads.find((x) => x.sheetKey === 'k-real-1');
  assert.equal(l.postId, p.id); assert.equal(l.targetId, g.id); assert.equal(l.service, 'bathroom');
  assert.equal(l.duplicateOf, 'L9000');
  assert.equal(computeStats(s.db, NOW).leads.duplicatesExcluded, 1);
});

test('סימון ידני "לא בדיקה" גובר על זיהוי אוטומטי גם בסנכרון חוזר', () => {
  const s = tmpStore();
  importSheetLeads(s, SAMPLE, { now: NOW });
  const l = s.db.leads.find((x) => x.sheetKey === 'k-qa-3');
  l.manualTest = false;
  importSheetLeads(s, SAMPLE.map((r) => (r[16] === 'k-qa-3' ? r.map((c, i) => (i === 7 ? 'עודכן' : c)) : r)), { now: NOW });
  assert.equal(l.isTest, false);
});

test('CSV: BOM, מרכאות, פסיקים ושורות חדשות בתוך תא — ייבוא זהה לגיליון', () => {
  const rows = parseCsv('﻿שם,טלפון,תיאור\r\n"כהן, דנה",0521112233,"שורה 1\nשורה ""2"""\r\n');
  assert.deepEqual(rows, [['שם', 'טלפון', 'תיאור'], ['כהן, דנה', '0521112233', 'שורה 1\nשורה "2"']]);
  const csv = SAMPLE.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const s = tmpStore();
  const r = importSheetLeads(s, parseCsv(csv), { now: NOW });
  assert.equal(r.real, 3); assert.equal(r.qa, 3);
  assert.throws(() => rowsToLeads([['a', 'b'], ['1', '2']]), /שם|טלפון/);
});

test('Google: JWT חתום RS256 עם scope לקריאה בלבד, ובקשת GET בלבד לגיליון', async () => {
  const { sa, publicKey } = fakeSa();
  assert.ok(validateServiceAccount(sa));
  assert.throws(() => validateServiceAccount({ type: 'authorized_user' }));
  const jwt = signJwt(sa, NOW.getTime());
  const [h, c, sig] = jwt.split('.');
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url')));
  const claim = JSON.parse(Buffer.from(c, 'base64url').toString());
  assert.equal(claim.scope, 'https://www.googleapis.com/auth/spreadsheets.readonly');
  const calls = [];
  const fake = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    if (url.includes('oauth2')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) };
    return { ok: true, status: 200, json: async () => ({ values: SAMPLE }) };
  };
  const v = await fetchSheetValues({ sa, spreadsheetId: 'SHEETID1234567890abcdef', tab: 'לידים מהאתר', fetchImpl: fake, nowMs: NOW.getTime() });
  assert.equal(v.length, SAMPLE.length);
  const sheetCalls = calls.filter((x) => x.url.includes('sheets.googleapis.com'));
  assert.equal(sheetCalls.length, 1); assert.equal(sheetCalls[0].method, 'GET');
  assert.match(decodeURIComponent(sheetCalls[0].url), /values\/'לידים מהאתר'!A1:Z5000/);
  assert.ok(!calls.some((x) => /:append|:batchUpdate|:clear/.test(x.url)), 'אין כתיבה לגיליון');
  const denied = async (url) => (url.includes('oauth2') ? { ok: true, json: async () => ({ access_token: 't' }) } : { ok: false, status: 403, json: async () => ({ error: { message: 'denied' } }) });
  await assert.rejects(fetchSheetValues({ sa, spreadsheetId: 'x'.repeat(30), tab: 't', fetchImpl: denied }), /שתפו אותו/);
});
