import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpStore, addGroup, IL } from './helpers.js';
import { leadReport, reportCsv, leadsCsv, toCsv } from '../src/report.js';
import { snapshot, dailySnapshot, listBackups, restore, validateBackup } from '../src/backup.js';
import { createPost, recordHistory } from '../src/scheduler.js';
import { attribute } from '../src/leads.js';
import { Store } from '../src/store.js';

function seeded() {
  const s = tmpStore();
  const g1 = addGroup(s, { name: 'שיפוצים רמת גן' });
  const g2 = addGroup(s, { name: 'שכנים חולון', url: 'https://www.facebook.com/groups/h' });
  const p1 = createPost(s, { serviceId: 'paint', areaId: 'ramat-gan', target: g1 });
  const p2 = createPost(s, { serviceId: 'kitchen', areaId: 'holon', target: g2 });
  const t = IL('2026-11-22', 10);
  recordHistory(s, { post: p1, target: g1, mode: 'manual', now: t });
  recordHistory(s, { post: p1, target: g1, mode: 'simulation', now: t });
  recordHistory(s, { post: p2, target: g2, mode: 'manual', now: t });
  const add = (o) => s.db.leads.push(attribute(s.db, { id: s.nextId('L'), status: 'new', ...o }));
  add({ name: 'א', phone: '0521111111', refCode: p1.refCode, createdAt: IL('2026-11-22', 12).toISOString(), status: 'won', value: 12000 });
  add({ name: 'ב', phone: '0522222222', refCode: p1.refCode, createdAt: IL('2026-11-23', 12).toISOString(), status: 'contacted' });
  add({ name: 'ג', phone: '0523333333', refCode: p2.refCode, createdAt: IL('2026-11-25', 12).toISOString() });
  add({ name: 'ד', phone: '0524444444', source: 'website', origin: 'sheet', city: 'נס ציונה', utmSource: 'google', createdAt: IL('2026-11-25', 12).toISOString() });
  add({ name: 'בדיקה', phone: '0544427244', refCode: p1.refCode, createdAt: IL('2026-11-25', 12).toISOString() });
  add({ name: 'כפול', phone: '0521111111', createdAt: IL('2026-11-22', 13).toISOString(), duplicateOf: 'L0001' });
  return { s, g1, g2, p1, p2 };
}

test('דוח לידים: מקור, קבוצה, פוסט ועיר — בלי QA ובלי כפילויות', () => {
  const { s, p1 } = seeded();
  const r = leadReport(s.db);
  assert.deepEqual(r.totals, { all: 6, real: 4, qa: 1, duplicates: 1, won: 1, value: 12000 });
  const k = (list, key) => list.find((x) => x.key === key);
  assert.equal(k(r.bySource, 'קבוצת פייסבוק').leads, 3);
  assert.equal(k(r.bySource, 'אתר · google').leads, 1);
  const g = k(r.byGroup, 'שיפוצים רמת גן');
  assert.equal(g.leads, 2); assert.equal(g.won, 1); assert.equal(g.value, 12000); assert.equal(g.posts, 1, 'סימולציה לא נספרת כפרסום'); assert.equal(g.leadsPerPost, 2);
  assert.equal(k(r.byGroup, 'אתר (ללא קבוצה)').leads, 1);
  const post = r.byPost.find((x) => x.key.startsWith(`${p1.id} · ${p1.refCode}`));
  assert.equal(post.leads, 2); assert.equal(post.posts, 1);
  assert.equal(k(r.byCity, 'רמת גן').leads, 2); assert.equal(k(r.byCity, 'חולון').leads, 1); assert.equal(k(r.byCity, 'נס ציונה').leads, 1);
  // סינון תאריכים
  const f = leadReport(s.db, { from: '2026-11-23', to: '2026-11-24' });
  assert.equal(f.totals.real, 1);
});

test('CSV: BOM לעברית באקסל, הגנה מהזרקת נוסחאות, כל הלידים כולל סימון QA', () => {
  const { s } = seeded();
  const csv = leadsCsv(s.db);
  assert.ok(csv.startsWith('﻿'));
  assert.equal(csv.trim().split('\r\n').length, 7);
  assert.match(csv, /בדיקה \(QA\)/);
  assert.match(toCsv(['a'], [['=HYPERLINK("x")']]), /'=HYPERLINK/);
  assert.match(reportCsv(leadReport(s.db)), /חתך,ערך,לידים/);
});

test('גיבוי: יומי פעם אחת ביום, ידני, שמירה של 30 אחרונים', () => {
  const { s } = seeded();
  assert.ok(dailySnapshot(s, IL('2026-11-25', 10)));
  assert.equal(dailySnapshot(s, IL('2026-11-25', 18)), null, 'פעם ביום');
  assert.ok(dailySnapshot(s, IL('2026-11-26', 10)));
  for (let i = 0; i < 35; i++) snapshot(s, { now: new Date(Date.UTC(2026, 10, 26, 0, i)), reason: 'manual' });
  assert.equal(listBackups(s).length, 30);
});

test('שחזור: מאמת, מגבה קודם, מחזיר לסימולציה ושומר לדיסק', () => {
  const { s } = seeded();
  const backup = JSON.parse(JSON.stringify(s.db));
  s.db.leads = []; s.db.settings.mode = 'live';
  assert.throws(() => validateBackup({ version: 2 }));
  assert.throws(() => validateBackup({ version: 1, settings: {}, leads: 'x' }));
  const r = restore(s, { ...backup, settings: { ...backup.settings, mode: 'live' } }, { now: IL('2026-11-26', 10) });
  assert.equal(r.leads, 6);
  assert.equal(s.db.settings.mode, 'simulation');
  assert.ok(listBackups(s).some((b) => b.name.startsWith('db-before-restore')));
  const before = JSON.parse(fs.readFileSync(`${s.dir}/backups/${r.before}`, 'utf8'));
  assert.equal(before.leads.length, 0, 'המצב שלפני השחזור נשמר');
  assert.equal(new Store(s.dir).db.leads.length, 6);
});
