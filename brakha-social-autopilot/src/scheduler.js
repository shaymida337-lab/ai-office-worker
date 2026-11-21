import path from 'node:path';
import { ensureCalendar, computeWindows } from './calendar.js';
import { evaluatePublish } from './rules.js';
import { liveStatus, publishFacebookPage } from './publishers.js';
import { TARGET_TYPES, SERVICES } from './business.js';
import { buildPost, lintPost, textHash } from './content.js';
import { israelParts, israelLocal, addDaysYmd, MIN, HOUR, DAY } from './time.js';

const OPEN = ['scheduled', 'deferred'];
const MAX_ATTEMPTS = 3;

function dueTime(it) {
  return Math.max(Date.parse(it.dueAt), it.retryAt ? Date.parse(it.retryAt) : 0);
}

function setState(store, it, status, reason, now) {
  const changed = it.status !== status || it.reason !== reason;
  it.status = status;
  it.reason = reason || null;
  it.updatedAt = new Date(now).toISOString();
  if (changed) store.log('schedule', `${it.id}: ${statusLabel(status)}${reason ? ` — ${reason}` : ''}`, { scheduleId: it.id }, now);
}

export function statusLabel(s) {
  return ({
    scheduled: 'מתוזמן', deferred: 'נדחה זמנית', blocked: 'חסום', awaiting_manual: 'ממתין לפרסום ידני',
    simulated: 'פורסם בסימולציה', published: 'פורסם (חי)', published_manual: 'פורסם ידנית', failed: 'נכשל', cancelled: 'בוטל', skipped: 'דולג',
  })[s] || s;
}

export function recordHistory(store, { item, post, target, mode, externalUrl = null, externalId = null, now }) {
  const h = {
    id: store.nextId('H'), ts: new Date(now).toISOString(), scheduleId: item?.id || null, postId: post.id,
    targetId: target.id, targetType: target.type, textHash: textHash(post.text), refCode: post.refCode, mode, externalUrl, externalId,
  };
  store.db.history.push(h);
  return h;
}

/** מעבר אחד של המתזמן. בטוח להרצה כל דקה. */
export async function tick(store, { now = new Date(), fetchImpl = globalThis.fetch, env = process.env, skipCalendarFetch = false } = {}) {
  const db = store.db;
  const summary = { processed: 0, simulated: 0, published: 0, manual: 0, deferred: 0, blocked: 0, failed: 0, stopped: false };
  if (db.settings.killSwitch) { summary.stopped = true; return summary; }
  if (!skipCalendarFetch) await ensureCalendar(store, { fetchImpl, now });

  const due = db.schedule.filter((it) => OPEN.includes(it.status) && dueTime(it) <= new Date(now).getTime()).sort((a, b) => dueTime(a) - dueTime(b));
  for (const it of due) {
    if (db.settings.killSwitch) break;
    summary.processed++;
    const post = db.posts.find((p) => p.id === it.postId);
    const target = db.groups.find((g) => g.id === it.targetId);
    const ev = evaluatePublish(db, { item: it, post, target, now });
    if (!ev.ok) {
      const hard = ev.reasons.filter((r) => !r.retryable);
      if (hard.length) { setState(store, it, 'blocked', hard.map((r) => r.msg).join(' | '), now); summary.blocked++; store.error('rules', `${it.id} נחסם: ${hard.map((r) => r.code).join(',')}`, { scheduleId: it.id }, now); }
      else { setState(store, it, 'deferred', ev.reasons.map((r) => r.msg).join(' | '), now); summary.deferred++; }
      continue;
    }
    const type = TARGET_TYPES[target.type];
    if (!type.auto) {
      setState(store, it, 'awaiting_manual', 'מוכן — לחצו "העתק ופתח" ופרסמו בעצמכם', now);
      summary.manual++;
      continue;
    }
    // ערוץ עם API רשמי
    if (db.settings.mode !== 'live') {
      recordHistory(store, { item: it, post, target, mode: 'simulation', now });
      setState(store, it, 'simulated', 'סימולציה — לא נשלח דבר לפייסבוק', now);
      summary.simulated++;
      continue;
    }
    const live = liveStatus(db.settings, env);
    if (!live.ready) { setState(store, it, 'blocked', `פרסום חי לא מוכן: ${live.missing.join('; ')}`, now); summary.blocked++; continue; }
    try {
      const media = (post.mediaIds || []).map((id) => db.media.find((m) => m.id === id)).find((m) => m?.kind === 'image');
      const r = await publishFacebookPage({ message: post.text, imagePath: media ? path.join(store.mediaDir, media.file) : null, apiVersion: db.settings.facebookApiVersion, env, fetchImpl });
      recordHistory(store, { item: it, post, target, mode: 'live', externalUrl: r.url, externalId: r.externalId, now });
      it.externalUrl = r.url;
      setState(store, it, 'published', null, now);
      summary.published++;
    } catch (e) {
      it.attempts = (it.attempts || 0) + 1;
      store.error('facebook_page', `${it.id}: ${e.message}`, { scheduleId: it.id, attempt: it.attempts }, now);
      if (it.attempts >= MAX_ATTEMPTS) { setState(store, it, 'failed', e.message, now); summary.failed++; }
      else { it.retryAt = new Date(new Date(now).getTime() + 15 * MIN * it.attempts).toISOString(); setState(store, it, 'deferred', `ניסיון ${it.attempts} נכשל, ננסה שוב`, now); summary.deferred++; }
    }
  }
  store.save();
  return summary;
}

// ---------- תכנון אוטומטי ----------
function inWindow(windows, t) { return windows.find((w) => t >= w.start && t < w.end); }

/** מוצא זמן פרסום מותר הבא: בתוך שעות פעילות, מחוץ לשבת/חג, ומרווח מפריטים אחרים */
export function nextSlot(db, fromT, taken, preferredHour = 10) {
  const windows = computeWindows(db.calendar, db.settings);
  const { start, end } = db.settings.postingHours;
  const gap = Math.max(db.settings.minMinutesBetweenPosts, 30) * MIN;
  let ymd = israelParts(new Date(fromT)).ymd;
  for (let d = 0; d < 30; d++, ymd = addDaysYmd(ymd, 1)) {
    const perDay = taken.filter((t) => israelParts(new Date(t)).ymd === ymd).length;
    if (perDay >= db.settings.dailyCap) continue;
    for (let h = Math.max(preferredHour, start); h < end; h++) {
      for (const mi of [0, 30]) {
        const t = israelLocal(ymd, h, mi).getTime();
        if (t < fromT) continue;
        if (inWindow(windows, t)) continue;
        if (taken.some((x) => Math.abs(x - t) < gap)) continue;
        return t;
      }
    }
  }
  return null;
}

/**
 * מתכנן X ימים קדימה: לכל קבוצה פעילה — פוסט חדש (וריאציה), במועד המותר הבא לפי התדירות שלה.
 * הפוסטים נוצרים כטיוטה ודורשים את אישורך.
 */
export function autoPlan(store, { days = 7, now = new Date() } = {}) {
  const db = store.db;
  const created = [];
  const skipped = [];
  if (!db.calendar) return { created, skipped: [{ reason: 'אין לוח שבת/חגים מאומת — לא ניתן לתכנן' }] };
  const horizon = new Date(now).getTime() + days * DAY;
  const taken = db.schedule.filter((x) => OPEN.includes(x.status) || x.status === 'awaiting_manual').map((x) => Date.parse(x.dueAt));
  const planUse = {};
  for (const g of db.groups.filter((x) => x.status === 'active' && x.autoPlan !== false)) {
    if (g.type === 'facebook_group' && !g.rulesReviewed) { skipped.push({ group: g.name, reason: 'כללי הקבוצה לא אושרו' }); continue; }
    if (db.schedule.some((x) => x.targetId === g.id && (OPEN.includes(x.status) || x.status === 'awaiting_manual'))) { skipped.push({ group: g.name, reason: 'כבר יש פרסום פתוח לקבוצה' }); continue; }
    const last = db.history.filter((h) => h.targetId === g.id).map((h) => Date.parse(h.ts)).sort((a, b) => b - a)[0];
    const from = Math.max(new Date(now).getTime() + HOUR, last ? last + (g.minDaysBetweenPosts ?? 7) * DAY : 0);
    const slot = nextSlot(db, from, taken, g.preferredHour ?? 10);
    if (!slot || slot > horizon) { skipped.push({ group: g.name, reason: 'אין מועד מותר בטווח' }); continue; }
    // סבב שירותים/אזורים: בוחרים את הצירוף שהכי מזמן לא פורסם בקבוצה
    const services = g.services?.length ? g.services : SERVICES.map((s) => s.id);
    const areas = g.areas?.length ? g.areas : ['ramat-gan'];
    const usedAt = (svc) => Math.max(0, ...db.posts.filter((p) => p.serviceId === svc && db.schedule.some((x) => x.postId === p.id && x.targetId === g.id)).map((p) => Date.parse(p.createdAt)));
    // קודם: השירות שהכי מזמן לא פורסם בקבוצה; בשוויון — זה שפחות נבחר בתכנון הנוכחי (גיוון בין קבוצות)
    const serviceId = [...services].sort((a, b) => usedAt(a) - usedAt(b) || (planUse[a] || 0) - (planUse[b] || 0))[0];
    planUse[serviceId] = (planUse[serviceId] || 0) + 1;
    const areaId = areas[db.schedule.filter((x) => x.targetId === g.id).length % areas.length];
    const post = createPost(store, { serviceId, areaId, target: g, now });
    const item = addSchedule(store, { postId: post.id, targetId: g.id, dueAt: new Date(slot).toISOString(), now, source: 'auto_plan' });
    taken.push(slot);
    created.push({ group: g.name, postId: post.id, scheduleId: item.id, dueAt: item.dueAt });
  }
  store.log('plan', `תכנון אוטומטי: ${created.length} פרסומים נוצרו, ${skipped.length} דולגו`, { created, skipped }, now);
  store.save();
  return { created, skipped };
}

/** יוצר פוסט חדש שאינו כפול לפוסטים קודמים (מנסה כמה seeds) */
export function createPost(store, { serviceId, areaId, target = null, includeSite = false, now = new Date() }) {
  const db = store.db;
  const id = store.nextId('P');
  const refCode = `B${1000 + db.counters.P}`;
  const hashes = new Set(db.posts.map((p) => textHash(p.text)));
  let text;
  for (let i = 0; i < 40; i++) {
    text = buildPost({ serviceId, areaId, refCode, seed: `${refCode}-${i}`, allowLinks: target ? target.allowLinks !== false : true, includeSite, targetType: target?.type, now });
    if (!hashes.has(textHash(text))) break;
  }
  const post = { id, refCode, serviceId, areaId, text, status: 'draft', mediaIds: [], createdAt: new Date(now).toISOString(), forTargetId: target?.id || null, lint: lintPost(text) };
  db.posts.push(post);
  store.log('post', `פוסט ${id} נוצר (${serviceId}, ${areaId})`, { postId: id }, now);
  return post;
}

export function addSchedule(store, { postId, targetId, dueAt, now = new Date(), source = 'manual' }) {
  const db = store.db;
  if (!db.posts.find((p) => p.id === postId)) throw new Error('פוסט לא נמצא');
  if (!db.groups.find((g) => g.id === targetId)) throw new Error('קבוצה/ערוץ לא נמצאו');
  if (Number.isNaN(Date.parse(dueAt))) throw new Error('תאריך לא תקין');
  const dup = db.schedule.find((x) => x.postId === postId && x.targetId === targetId && !['cancelled', 'skipped', 'failed', 'blocked'].includes(x.status));
  if (dup) throw new Error(`הפוסט כבר מתוזמן לקבוצה הזו (${dup.id})`);
  const item = { id: store.nextId('S'), postId, targetId, dueAt: new Date(dueAt).toISOString(), status: 'scheduled', reason: null, attempts: 0, source, createdAt: new Date(now).toISOString() };
  db.schedule.push(item);
  store.log('schedule', `${item.id}: תוזמן ל-${item.dueAt}`, { scheduleId: item.id }, now);
  return item;
}
