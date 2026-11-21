import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPost, lintPost, textHash } from '../src/content.js';
import { SERVICES, AREAS, BUSINESS } from '../src/business.js';
import { siteUrl, whatsappText, whatsappUrl } from '../src/utm.js';

test('כל שירות × כל אזור: פוסט תקין עם הנעה לוואטסאפ, אזור וסייג מחיר', () => {
  for (const s of SERVICES) for (const a of AREAS) {
    const t = buildPost({ serviceId: s.id, areaId: a.id, refCode: 'B1234' });
    const l = lintPost(t);
    assert.ok(l.ok, `${s.id}/${a.id}: ${l.errors}`);
    assert.ok(t.includes(BUSINESS.whatsappBase));
    assert.ok(t.includes(BUSINESS.slogan));
    assert.ok(t.includes('כפופה להשוואת הצעות'));
    assert.ok(t.includes(a.label), `אזור ${a.label} חסר`);
    assert.ok(t.includes(s.label));
  }
});

test('קבוצה שאוסרת קישורים: אין URL, יש טלפון וקוד', () => {
  const t = buildPost({ serviceId: 'kitchen', areaId: 'holon', refCode: 'B2000', allowLinks: false });
  assert.ok(!/https?:\/\//.test(t));
  assert.ok(t.includes('054-442-7244'));
  assert.ok(t.includes('B2000'));
  assert.ok(lintPost(t).ok);
});

test('וריאציות: seeds שונים נותנים טקסטים שונים, seed זהה — אותו טקסט', () => {
  const a = buildPost({ serviceId: 'paint', areaId: 'ramat-gan', refCode: 'B1', seed: 1 });
  const b = buildPost({ serviceId: 'paint', areaId: 'ramat-gan', refCode: 'B1', seed: 1 });
  assert.equal(a, b);
  const set = new Set(Array.from({ length: 20 }, (_, i) => textHash(buildPost({ serviceId: 'paint', areaId: 'ramat-gan', refCode: 'B1', seed: i }))));
  assert.ok(set.size >= 10, `רק ${set.size} וריאציות`);
});

test('lint חוסם המלצות מומצאות, עבודות שבוצעו, טלפון זר והבטחת מחיר בלי סייג', () => {
  const ok = buildPost({ serviceId: 'general', areaId: 'bat-yam', refCode: 'B1' });
  assert.ok(!lintPost(`${ok}\nמאות לקוחות מרוצים!`).ok);
  assert.ok(!lintPost(`${ok}\nביצענו שיפוץ ברחוב הרצל`).ok);
  assert.ok(!lintPost(`${ok}\nתמונות לפני ואחרי`).ok);
  assert.ok(!lintPost(`${ok}\n⭐⭐⭐⭐⭐`).ok);
  assert.ok(!lintPost(`${ok}\nאו התקשרו 052-123-4567`).ok);
  assert.ok(!lintPost(`${ok}\nhttps://wa.me/972521234567`).ok);
  assert.ok(!lintPost('מתחייבים למחיר הטוב ביותר! 054-442-7244').ok, 'בלי סייג');
  assert.ok(!lintPost('שיפוצים טובים').ok, 'בלי הנעה לפנייה');
  assert.ok(lintPost(ok).ok);
});

test('textHash מתעלם מקוד מקור וקישורי UTM — אחרת כל פוסט ייראה "חדש"', () => {
  const a = buildPost({ serviceId: 'paint', areaId: 'holon', refCode: 'B1001', seed: 7 });
  const b = a.replaceAll('B1001', 'B1999');
  assert.notEqual(a, b);
  assert.equal(textHash(a), textHash(b));
});

test('UTM ו-QA', () => {
  const u = new URL(siteUrl({ serviceId: 'bathroom', areaId: 'givatayim', refCode: 'B1005', now: new Date('2026-11-21T10:00:00Z') }));
  assert.equal(u.origin, 'https://brakha-renovation.netlify.app');
  assert.equal(u.pathname, '/services/bathroom-renovation/');
  assert.equal(u.searchParams.get('utm_source'), 'facebook');
  assert.equal(u.searchParams.get('utm_medium'), 'group');
  assert.equal(u.searchParams.get('utm_campaign'), 'bathroom_givatayim_202611');
  assert.equal(u.searchParams.get('utm_content'), 'B1005');
  const q = new URL(siteUrl({ serviceId: 'paint', areaId: 'holon', refCode: 'B1', qa: true }));
  assert.equal(q.searchParams.get('utm_source'), 'qa');
  const w = whatsappUrl(whatsappText({ refCode: 'B1005' }));
  assert.ok(w.startsWith('https://wa.me/972544427244?text='));
  assert.ok(decodeURIComponent(w).includes('קוד B1005'));
});
