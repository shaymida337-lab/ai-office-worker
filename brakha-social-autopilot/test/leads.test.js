import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpStore, addGroup, IL } from './helpers.js';
import { attribute, computeStats, extractRefCode, qaReasons } from '../src/leads.js';
import { createPost, recordHistory } from '../src/scheduler.js';

test('שיוך ליד לפוסט ולקבוצה לפי הקוד בהודעת הוואטסאפ', () => {
  const s = tmpStore(); const g = addGroup(s); const p = createPost(s, { serviceId: 'bathroom', areaId: 'givatayim', target: g });
  recordHistory(s, { item: null, post: p, target: g, mode: 'manual', now: IL('2026-11-22', 10) });
  const lead = attribute(s.db, { name: 'דנה', phone: '050-1112233', message: `שלום, אשמח להצעת מחיר (קוד ${p.refCode})` });
  assert.equal(lead.refCode, p.refCode); assert.equal(lead.postId, p.id); assert.equal(lead.targetId, g.id);
  assert.equal(lead.source, 'facebook_group'); assert.equal(lead.service, 'bathroom'); assert.equal(lead.area, 'givatayim');
  assert.equal(lead.isTest, false);
});

test('בדיקות QA לא נספרות כלידים', () => {
  assert.ok(qaReasons({ phone: '054-442-7244' }).length, 'מספר העסק');
  assert.ok(qaReasons({ phone: '+972 54-442-7244' }).length);
  assert.ok(qaReasons({ name: 'בדיקה' }).length);
  assert.ok(qaReasons({ refCode: 'QA-B1001' }).length);
  assert.ok(qaReasons({ isTest: true }).length);
  assert.equal(qaReasons({ name: 'יוסי', phone: '052-9998877' }).length, 0);
  assert.equal(extractRefCode('היי (קוד QA-B1001)'), 'QA-B1001');

  const s = tmpStore();
  const now = IL('2026-11-22', 12);
  for (const l of [{ name: 'יוסי', phone: '0529998877' }, { name: 'test', phone: '0500000000' }, { name: 'רינה', phone: '0544427244' }, { name: 'מיכל', phone: '0531234567', message: 'קוד QA-B1001' }]) {
    s.db.leads.push(attribute(s.db, { ...l, createdAt: now.toISOString(), status: 'new' }));
  }
  const st = computeStats(s.db, now);
  assert.equal(st.leads.total, 1); assert.equal(st.leads.qaExcluded, 3);
});

test('סטטיסטיקות: פרסומי סימולציה נפרדים מפרסומים אמיתיים', () => {
  const s = tmpStore(); const g = addGroup(s); const p = createPost(s, { serviceId: 'paint', areaId: 'holon', target: g });
  const now = IL('2026-11-22', 12);
  recordHistory(s, { item: null, post: p, target: g, mode: 'simulation', now });
  recordHistory(s, { item: null, post: p, target: g, mode: 'manual', now });
  s.db.leads.push(attribute(s.db, { name: 'א', phone: '0521111111', refCode: p.refCode, createdAt: now.toISOString(), status: 'won' }));
  const st = computeStats(s.db, now);
  assert.equal(st.posts.simulated, 1); assert.equal(st.posts.publishedReal, 1);
  assert.equal(st.byTarget[0].leads, 1); assert.equal(st.byTarget[0].leadsPerPost, 1); assert.equal(st.leads.won, 1);
});
