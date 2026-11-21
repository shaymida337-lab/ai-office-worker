import test from 'node:test';
import assert from 'node:assert/strict';
import { guardAt, computeWindows, validateHebcal, ensureCalendar, needsRefresh, hebcalUrl } from '../src/calendar.js';
import { fixtureCalendar, FIXTURE, IL, tmpStore } from './helpers.js';
import { DEFAULT_SETTINGS } from '../src/store.js';

const cal = fixtureCalendar();
const S = DEFAULT_SETTINGS;
const blocked = (d, s = S) => !guardAt(cal, d, s).allowed;

test('שבת: חסום מ-60 דק׳ לפני הדלקת נרות ועד 30 דק׳ אחרי הבדלה (רמת גן)', () => {
  // הדלקת נרות 20.11.2026 16:18, הבדלה 21.11.2026 17:17
  assert.equal(blocked(IL('2026-11-20', 12, 0)), false, 'שישי בצהריים מותר');
  assert.equal(blocked(IL('2026-11-20', 15, 17)), false, 'דקה לפני תחילת המרווח');
  assert.equal(blocked(IL('2026-11-20', 15, 19)), true, 'בתוך מרווח הביטחון');
  assert.equal(blocked(IL('2026-11-21', 12, 0)), true, 'שבת בצהריים');
  assert.equal(blocked(IL('2026-11-21', 17, 40)), true, 'מיד אחרי הבדלה — עדיין במרווח');
  assert.equal(blocked(IL('2026-11-21', 17, 48)), false, 'אחרי המרווח');
  assert.equal(blocked(IL('2026-11-22', 10, 0)), false, 'ראשון');
});

test('חגים: ראש השנה (יומיים), יום כיפור, פסח ראשון ושביעי — חסומים; חול המועד וחנוכה — לא', () => {
  assert.ok(blocked(IL('2026-09-12', 12)), 'ראש השנה א');
  assert.ok(blocked(IL('2026-09-13', 12)), 'ראש השנה ב');
  assert.ok(!blocked(IL('2026-09-16', 12)), 'יום רגיל');
  assert.ok(blocked(IL('2026-09-21', 12)), 'יום כיפור');
  assert.ok(blocked(IL('2027-04-22', 12)), 'פסח א');
  assert.ok(!blocked(IL('2027-04-25', 12)), 'חול המועד');
  assert.ok(blocked(IL('2027-04-28', 12)), 'שביעי של פסח');
  assert.ok(!blocked(IL('2026-12-07', 12)), 'חנוכה (יום חול)');
});

test('ראש השנה = חלון רציף אחד מהדלקת נרות ערב החג ועד הבדלה בסוף יום ב׳', () => {
  const w = computeWindows(cal, S).find((x) => x.start <= IL('2026-09-12', 12).getTime() && x.end > IL('2026-09-12', 12).getTime());
  assert.equal(new Date(w.start).toISOString(), new Date(Date.parse('2026-09-11T18:32:00+03:00') - 60 * 60000).toISOString());
  assert.equal(new Date(w.end).toISOString(), new Date(Date.parse('2026-09-13T19:26:00+03:00') + 30 * 60000).toISOString());
  assert.match(w.label, /ראש השנה/);
});

test('ימי זיכרון חסומים כברירת מחדל וניתנים לכיבוי', () => {
  assert.ok(blocked(IL('2027-05-11', 12)), 'יום הזיכרון');
  assert.ok(blocked(IL('2027-05-04', 12)), 'יום השואה');
  assert.ok(!blocked(IL('2027-05-11', 12), { ...S, blockMemorialDays: false }));
});

test('Fail-closed: אין לוח / מחוץ לטווח / נתונים לא עקביים → חסום ולא מאומת', () => {
  assert.deepEqual([guardAt(null, new Date()).allowed, guardAt(null, new Date()).verified], [false, false]);
  const g = guardAt(cal, IL('2027-07-01', 12));
  assert.equal(g.allowed, false); assert.equal(g.verified, false);
  const broken = { ...cal, items: cal.items.filter((i) => !(i.category === 'candles' && i.date.startsWith('2026-11-20'))) };
  // בלי הדלקת נרות לשבת הזו — בדיקת השפיות חוסמת
  const b = guardAt(broken, IL('2026-11-21', 12));
  assert.equal(b.allowed, false); assert.equal(b.verified, false);
});

test('אימות תשובת Hebcal: מיקום, אזור זמן ומבנה', () => {
  assert.ok(validateHebcal(FIXTURE));
  assert.throws(() => validateHebcal({ ...FIXTURE, location: { ...FIXTURE.location, geonameid: 281184 } }), /רמת גן/);
  assert.throws(() => validateHebcal({ ...FIXTURE, location: { ...FIXTURE.location, tzid: 'Europe/London' } }));
  assert.throws(() => validateHebcal({ ...FIXTURE, items: FIXTURE.items.filter((i) => i.category !== 'candles') }));
  assert.throws(() => validateHebcal(null));
  const u = new URL(hebcalUrl('2026-11-01', '2026-12-01'));
  assert.equal(u.searchParams.get('geonameid'), '293788');
  assert.equal(u.searchParams.get('i'), 'on');
});

test('ensureCalendar: כשל ברשת נרשם ביומן השגיאות ולא ממציא נתונים', async () => {
  const s = tmpStore({ calendar: false });
  const r = await ensureCalendar(s, { fetchImpl: async () => { throw new Error('offline'); }, now: IL('2026-11-22', 10) });
  assert.equal(r.refreshed, false);
  assert.equal(s.db.calendar, null);
  assert.match(s.db.errors.at(-1).message, /offline/);
  assert.equal(guardAt(s.db.calendar, IL('2026-11-22', 10)).allowed, false);
  assert.ok(needsRefresh(null));
});
