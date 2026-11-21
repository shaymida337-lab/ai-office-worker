import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpStore, addGroup, noNetwork, IL } from './helpers.js';
import { tick, createPost, addSchedule, autoPlan, recordHistory } from '../src/scheduler.js';
import { evaluatePublish } from '../src/rules.js';
import { guardAt } from '../src/calendar.js';
import { Store } from '../src/store.js';

const SUN = IL('2026-11-22', 10); // ראשון, יום רגיל
const opts = (now) => ({ now, fetchImpl: noNetwork, env: {}, skipCalendarFetch: true });

function approved(store, g, serviceId = 'paint', areaId = 'ramat-gan', now = SUN) {
  const p = createPost(store, { serviceId, areaId, target: g, now });
  p.status = 'approved';
  return p;
}

test('קבוצת פייסבוק: המתזמן מכין משימה ידנית ולא מפרסם בעצמו', async () => {
  const s = tmpStore(); const g = addGroup(s); const p = approved(s, g);
  const it = addSchedule(s, { postId: p.id, targetId: g.id, dueAt: SUN.toISOString(), now: SUN });
  const r = await tick(s, opts(SUN));
  assert.equal(r.manual, 1); assert.equal(it.status, 'awaiting_manual');
  assert.equal(s.db.history.length, 0, 'אין רישום פרסום עד שהמשתמש מסמן');
});

test('דף עסקי במצב סימולציה: "פורסם בסימולציה", אפס קריאות רשת', async () => {
  const s = tmpStore(); const g = addGroup(s, { type: 'facebook_page', name: 'דף העסק' }); const p = approved(s, g);
  const it = addSchedule(s, { postId: p.id, targetId: g.id, dueAt: SUN.toISOString(), now: SUN });
  const r = await tick(s, opts(SUN)); // noNetwork זורק אם יש קריאה
  assert.equal(r.simulated, 1); assert.equal(it.status, 'simulated');
  assert.equal(s.db.history[0].mode, 'simulation');
});

test('מצב חי בלי כל המפתחות → חסום, לא נשלח דבר', async () => {
  const s = tmpStore(); s.db.settings.mode = 'live';
  const g = addGroup(s, { type: 'facebook_page' }); const p = approved(s, g);
  const it = addSchedule(s, { postId: p.id, targetId: g.id, dueAt: SUN.toISOString(), now: SUN });
  await tick(s, opts(SUN));
  assert.equal(it.status, 'blocked'); assert.match(it.reason, /BRAKHA_ALLOW_LIVE/);
});

test('מצב חי מלא: קריאה רשמית ל-Graph API /feed (fetch מדומה)', async () => {
  const s = tmpStore(); s.db.settings.mode = 'live'; s.db.settings.liveConfirmedAt = SUN.toISOString();
  const g = addGroup(s, { type: 'facebook_page' }); const p = approved(s, g);
  const it = addSchedule(s, { postId: p.id, targetId: g.id, dueAt: SUN.toISOString(), now: SUN });
  const calls = [];
  const fake = async (url, init) => { calls.push({ url, body: String(init.body) }); return { ok: true, status: 200, json: async () => ({ id: '123_456' }) }; };
  await tick(s, { now: SUN, fetchImpl: fake, env: { BRAKHA_ALLOW_LIVE: '1', FB_PAGE_ID: '123', FB_PAGE_ACCESS_TOKEN: 'x' }, skipCalendarFetch: true });
  assert.equal(it.status, 'published'); assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/123\/feed$/);
  assert.equal(s.db.history[0].mode, 'live');
});

test('שבת: פריט שמועדו בשבת נדחה, ויוצא אוטומטית במוצאי שבת', async () => {
  const s = tmpStore(); const g = addGroup(s, { type: 'facebook_page' }); const p = approved(s, g);
  const sat = IL('2026-11-21', 11);
  const it = addSchedule(s, { postId: p.id, targetId: g.id, dueAt: sat.toISOString(), now: sat });
  await tick(s, opts(sat));
  assert.equal(it.status, 'deferred'); assert.match(it.reason, /חסום/);
  assert.equal(s.db.history.length, 0);
  await tick(s, opts(IL('2026-11-21', 17, 30))); // אחרי הבדלה אבל בתוך המרווח
  assert.equal(it.status, 'deferred');
  await tick(s, opts(IL('2026-11-21', 18, 0)));
  assert.equal(it.status, 'simulated');
});

test('חג (יום כיפור) חוסם גם משימות ידניות, ו"פתיחה" נבדקת שוב', async () => {
  const s = tmpStore(); const g = addGroup(s); const p = approved(s, g);
  const yk = IL('2026-09-21', 12);
  const it = addSchedule(s, { postId: p.id, targetId: g.id, dueAt: yk.toISOString(), now: yk });
  await tick(s, opts(yk));
  assert.equal(it.status, 'deferred');
  const ev = evaluatePublish(s.db, { item: it, post: p, target: g, now: yk });
  assert.ok(ev.reasons.some((r) => r.code === 'SHABBAT_HOLIDAY'));
});

test('לוח לא מאומת → אין פרסום', async () => {
  const s = tmpStore({ calendar: false }); const g = addGroup(s, { type: 'facebook_page' }); const p = approved(s, g);
  const it = addSchedule(s, { postId: p.id, targetId: g.id, dueAt: SUN.toISOString(), now: SUN });
  await tick(s, { ...opts(SUN), skipCalendarFetch: false }); // fetch נכשל
  assert.equal(it.status, 'deferred'); assert.match(it.reason, /לא ניתן לאמת/);
});

test('עצירת חירום: עוצרת הכול; הפעלה מחדש ממשיכה מאותה נקודה', async () => {
  const s = tmpStore(); const g = addGroup(s, { type: 'facebook_page' }); const p = approved(s, g);
  const it = addSchedule(s, { postId: p.id, targetId: g.id, dueAt: SUN.toISOString(), now: SUN });
  s.db.settings.killSwitch = true;
  const r = await tick(s, opts(SUN));
  assert.equal(r.stopped, true); assert.equal(it.status, 'scheduled'); assert.equal(s.db.history.length, 0);
  s.db.settings.killSwitch = false;
  await tick(s, opts(SUN));
  assert.equal(it.status, 'simulated');
});

test('מניעת כפילויות: אותו טקסט לאותה קבוצה, אותו טקסט לקבוצה אחרת, ותזמון כפול', async () => {
  const s = tmpStore(); const g1 = addGroup(s, { type: 'facebook_page', minDaysBetweenPosts: 1 });
  const g2 = addGroup(s, { type: 'facebook_page', name: 'דף 2', url: 'https://www.facebook.com/b', minDaysBetweenPosts: 1 });
  const p = approved(s, g1);
  addSchedule(s, { postId: p.id, targetId: g1.id, dueAt: SUN.toISOString(), now: SUN });
  assert.throws(() => addSchedule(s, { postId: p.id, targetId: g1.id, dueAt: SUN.toISOString(), now: SUN }), /כבר מתוזמן/);
  await tick(s, opts(SUN));
  // אותו טקסט בדיוק (קוד אחר) לקבוצה אחרת
  const later = new Date(SUN.getTime() + 2 * 3600e3);
  const clone = createPost(s, { serviceId: 'paint', areaId: 'ramat-gan', now: later }); clone.text = p.text.replaceAll(p.refCode, clone.refCode); clone.status = 'approved';
  const it2 = addSchedule(s, { postId: clone.id, targetId: g2.id, dueAt: later.toISOString(), now: later });
  await tick(s, opts(later));
  assert.equal(it2.status, 'blocked'); assert.match(it2.reason, /טקסט זהה פורסם בערוץ אחר/);
  // אותו טקסט לאותה קבוצה אחרי שבועיים (מותר לפי תדירות, חסום לפי כפילות)
  const twoW = IL('2026-12-06', 10);
  const clone2 = createPost(s, { serviceId: 'paint', areaId: 'ramat-gan', now: twoW }); clone2.text = p.text; clone2.status = 'approved';
  const it3 = addSchedule(s, { postId: clone2.id, targetId: g1.id, dueAt: twoW.toISOString(), now: twoW });
  await tick(s, opts(twoW));
  assert.equal(it3.status, 'blocked'); assert.match(it3.reason, /כבר פורסם בערוץ הזה/);
});

test('createPost לא יוצר טקסט זהה לפוסט קיים', () => {
  const s = tmpStore();
  const hashes = new Set();
  for (let i = 0; i < 12; i++) hashes.add(createPost(s, { serviceId: 'kitchen', areaId: 'holon', now: SUN }).text.replace(/B\d+/g, ''));
  assert.equal(hashes.size, 12);
});

test('מגבלות תדירות: לקבוצה, מכסה יומית ומרווח מינימלי', async () => {
  const s = tmpStore(); s.db.settings.dailyCap = 2;
  const groups = [0, 1, 2].map((i) => addGroup(s, { type: 'facebook_page', name: `דף ${i}`, url: `https://x.com/${i}`, minDaysBetweenPosts: 7 }));
  const items = groups.map((g) => addSchedule(s, { postId: approved(s, g, ['paint', 'kitchen', 'bathroom'][groups.indexOf(g)]).id, targetId: g.id, dueAt: SUN.toISOString(), now: SUN }));
  await tick(s, opts(SUN));
  assert.equal(items[0].status, 'simulated');
  assert.equal(items[1].status, 'deferred'); assert.match(items[1].reason, /מרווח מינימלי/);
  const t2 = new Date(SUN.getTime() + 25 * 60000);
  await tick(s, opts(t2));
  assert.equal(items[1].status, 'simulated');
  await tick(s, opts(new Date(SUN.getTime() + 60 * 60000)));
  assert.equal(items[2].status, 'deferred'); assert.match(items[2].reason, /מכסה היומית/);
  // תדירות לקבוצה: פוסט נוסף ל-groups[0] אחרי 3 ימים
  const d3 = IL('2026-11-25', 10);
  const it = addSchedule(s, { postId: approved(s, groups[0], 'general', 'ramat-gan', d3).id, targetId: groups[0].id, dueAt: d3.toISOString(), now: d3 });
  await tick(s, opts(d3));
  assert.equal(it.status, 'deferred'); assert.match(it.reason, /תדירות/);
});

test('בדיקות נוספות: שעות פעילות, טיוטה לא מאושרת, כללי קבוצה לא אושרו', async () => {
  const s = tmpStore(); const g = addGroup(s, { rulesReviewed: false }); const p = createPost(s, { serviceId: 'paint', areaId: 'ramat-gan', now: SUN });
  const night = IL('2026-11-22', 23);
  const ev = evaluatePublish(s.db, { item: null, post: p, target: g, now: night });
  const codes = ev.reasons.map((r) => r.code);
  for (const c of ['OUTSIDE_HOURS', 'NOT_APPROVED', 'RULES_NOT_REVIEWED']) assert.ok(codes.includes(c), c);
});

test('תכנון אוטומטי: מדלג על שבת, מכבד שעות ומרווחים, יוצר טיוטות', () => {
  const s = tmpStore();
  for (let i = 0; i < 4; i++) addGroup(s, { name: `קבוצה ${i}`, url: `https://www.facebook.com/groups/${i}`, areas: ['ramat-gan', 'givatayim'] });
  addGroup(s, { name: 'לא מאושרת', url: 'https://www.facebook.com/groups/x', rulesReviewed: false });
  const fri = IL('2026-11-20', 14); // שישי אחה"צ — המועד הבא חייב להיות אחרי שבת
  const r = autoPlan(s, { days: 7, now: fri });
  assert.equal(r.created.length, 4);
  assert.ok(r.skipped.some((x) => x.group === 'לא מאושרת'));
  const times = r.created.map((c) => Date.parse(c.dueAt)).sort();
  for (const t of times) {
    assert.ok(guardAt(s.db.calendar, new Date(t), s.db.settings).allowed, `מועד חסום: ${new Date(t).toISOString()}`);
    const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hourCycle: 'h23' }).format(new Date(t)));
    assert.ok(h >= 8 && h < 21);
  }
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 30 * 60000, 'מרווח');
  assert.ok(r.created.every((c) => s.db.posts.find((p) => p.id === c.postId).status === 'draft'));
  assert.equal(new Set(r.created.map((c) => s.db.posts.find((p) => p.id === c.postId).serviceId)).size, 4, 'גיוון שירותים בין קבוצות');
  // הרצה שנייה לא מכפילה
  assert.equal(autoPlan(s, { days: 7, now: fri }).created.length, 0);
});

test('שמירת נתונים: כתיבה לדיסק וטעינה מחדש', () => {
  const s = tmpStore(); const g = addGroup(s); createPost(s, { serviceId: 'paint', areaId: 'holon', target: g });
  s.db.settings.dailyCap = 3; s.save();
  const s2 = new Store(s.dir);
  assert.equal(s2.db.groups[0].name, g.name);
  assert.equal(s2.db.posts.length, 1);
  assert.equal(s2.db.settings.dailyCap, 3);
  assert.equal(s2.db.settings.mode, 'simulation');
  recordHistory(s2, { item: null, post: s2.db.posts[0], target: g, mode: 'manual', now: SUN }); s2.save();
  assert.equal(new Store(s.dir).db.history.length, 1);
});
