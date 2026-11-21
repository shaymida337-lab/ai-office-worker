import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store, DEFAULT_SETTINGS } from './store.js';
import { BUSINESS, SERVICES, AREAS, TARGET_TYPES } from './business.js';
import { lintPost, textHash } from './content.js';
import { ensureCalendar, upcomingWindows, guardAt, SOURCE, coverage } from './calendar.js';
import { evaluatePublish, outreachGuard } from './rules.js';
import { tick, autoPlan, createPost, addSchedule, recordHistory, statusLabel } from './scheduler.js';
import { liveStatus } from './publishers.js';
import { attribute, computeStats, LEAD_STATUSES, LEAD_SOURCES } from './leads.js';
import { siteUrl, whatsappUrl, whatsappText } from './utm.js';
import { loadServiceAccount, validateServiceAccount, fetchSheetValues, importSheetLeads, parseCsv } from './sheets.js';
import { checkFacebook, readSecrets, writeSecrets, effectiveEnv, mask } from './facebook.js';
import { leadReport, reportCsv, leadsCsv, postsCsv, historyCsv } from './report.js';
import { snapshot, dailySnapshot, listBackups, restore } from './backup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.svg': 'image/svg+xml' };
const MEDIA_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm' };
const MAX_BODY = 60 * 1024 * 1024;

export function loadEnvFile(file, env = process.env) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, 'הקובץ גדול מדי')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new HttpError(400, 'JSON לא תקין')); } });
    req.on('error', reject);
  });
}

const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
const bool = (v) => v === true || v === 'true' || v === 'on' || v === 1;

export function createApp({ dataDir = path.join(ROOT, 'data'), env = process.env, fetchImpl = globalThis.fetch, clock = () => new Date() } = {}) {
  const store = new Store(dataDir);
  const db = () => store.db;
  const now = () => clock();

  const saFile = path.join(dataDir, 'google-service-account.json');
  const fbEnv = () => effectiveEnv(env, dataDir);
  function serviceAccount() { try { return loadServiceAccount(saFile); } catch (e) { return { error: e.message }; } }

  async function syncSheet(reason = 'manual') {
    const d = db(); const n = now(); const cfg = d.settings.sheet;
    const sa = serviceAccount();
    if (!sa || sa.error) throw new HttpError(400, sa?.error || 'לא הוגדר מפתח Service Account — ראו "חיבור לגיליון" בהגדרות');
    try {
      const values = await fetchSheetValues({ sa, spreadsheetId: cfg.spreadsheetId, tab: cfg.tab, fetchImpl, nowMs: n.getTime() });
      const r = importSheetLeads(store, values, { now: n });
      d.sheetSync = { at: n.toISOString(), ok: true, reason, result: r };
      store.log('sheet', `סנכרון גיליון (${reason}): ${r.rows} שורות · ${r.added} חדשים · ${r.updated} עודכנו · ${r.qa} בדיקות QA · ${r.duplicates} כפולים · ${r.real} אמיתיים`, {}, n);
      store.save(); return d.sheetSync;
    } catch (e) {
      d.sheetSync = { at: n.toISOString(), ok: false, reason, error: e.message };
      store.error('sheet', `סנכרון גיליון נכשל: ${e.message}`, {}, n); store.save();
      throw new HttpError(502, e.message);
    }
  }

  function state() {
    const d = db();
    const n = now();
    const guard = outreachGuard(d, n);
    const cov = coverage(d.calendar);
    return {
      now: n.toISOString(),
      business: BUSINESS, services: SERVICES, areas: AREAS,
      targetTypes: TARGET_TYPES, leadStatuses: LEAD_STATUSES, leadSources: LEAD_SOURCES,
      settings: d.settings,
      live: liveStatus(d.settings, fbEnv()),
      guard: { allowed: guard.allowed, reasons: guard.reasons, calendar: guard.calendar },
      calendar: d.calendar ? { source: SOURCE, fetchedAt: d.calendar.fetchedAt, range: d.calendar.range, coverageTo: cov ? new Date(cov.to).toISOString() : null, upcoming: upcomingWindows(d.calendar, d.settings, n, 6) } : null,
      groups: d.groups,
      posts: d.posts.map((p) => ({ ...p, lint: lintPost(p.text), hash: textHash(p.text) })),
      schedule: d.schedule.map((s) => ({ ...s, statusLabel: statusLabel(s.status) })),
      history: d.history.slice(-500).reverse(),
      media: d.media,
      leads: d.leads.slice().reverse(),
      activity: d.activity.slice(-300).reverse(),
      errors: d.errors.slice(-200).reverse(),
      stats: computeStats(d, n),
      report: leadReport(d),
      backups: listBackups(store).slice(0, 15),
      connections: {
        hebcal: { ok: !!d.calendar && guard.calendar.verified, lastFetch: d.calendar?.fetchedAt || null },
        facebookPage: (() => { const e = fbEnv(); const sec = readSecrets(dataDir); return { tokenPresent: !!e.FB_PAGE_ACCESS_TOKEN, tokenMasked: mask(e.FB_PAGE_ACCESS_TOKEN), tokenSource: env.FB_PAGE_ACCESS_TOKEN ? '.env' : sec.FB_PAGE_ACCESS_TOKEN ? 'הגדרות מקומיות' : null, pageId: e.FB_PAGE_ID || null, pageIdPresent: !!e.FB_PAGE_ID, liveFlag: env.BRAKHA_ALLOW_LIVE === '1', lastCheck: d.facebookCheck || null }; })(),
        sheet: (() => { const sa = serviceAccount(); return { spreadsheetId: d.settings.sheet.spreadsheetId, tab: d.settings.sheet.tab, autoSync: d.settings.sheet.autoSync, serviceAccountEmail: sa && !sa.error ? sa.client_email : null, serviceAccountError: sa?.error || null, lastSync: d.sheetSync || null }; })(),
        websiteAnalytics: { connected: false, note: 'באתר אין כרגע כלי אנליטיקס — UTM נשמר בקישורים אך לא נמדד. התקנת GA4 (חינם) מחייבת שינוי באתר באישורך.' },
        whatsapp: { number: BUSINESS.phoneDisplay, note: 'לידים מוואטסאפ נרשמים ידנית; הקוד בהודעה מזהה את הפוסט.' },
      },
    };
  }

  function find(coll, id) { const x = db()[coll].find((y) => y.id === id); if (!x) throw new HttpError(404, 'לא נמצא'); return x; }

  function sanitizeGroup(b, g = {}) {
    const type = TARGET_TYPES[b.type] ? b.type : (g.type || 'facebook_group');
    const url = str(b.url ?? g.url, 500);
    if (url && !/^https:\/\//.test(url)) throw new HttpError(400, 'הקישור חייב להתחיל ב-https://');
    const name = str(b.name ?? g.name, 200);
    if (!name) throw new HttpError(400, 'חסר שם');
    return {
      ...g, name, type, url,
      areas: Array.isArray(b.areas) ? b.areas.filter((a) => AREAS.some((x) => x.id === a)) : (g.areas || []),
      services: Array.isArray(b.services) ? b.services.filter((s) => SERVICES.some((x) => x.id === s)) : (g.services || []),
      allowLinks: b.allowLinks !== undefined ? bool(b.allowLinks) : (g.allowLinks ?? true),
      minDaysBetweenPosts: Math.max(1, Math.min(90, Number(b.minDaysBetweenPosts ?? g.minDaysBetweenPosts ?? 7) || 7)),
      preferredHour: Math.max(8, Math.min(20, Number(b.preferredHour ?? g.preferredHour ?? 10) || 10)),
      rulesText: str(b.rulesText ?? g.rulesText, 4000),
      rulesReviewed: b.rulesReviewed !== undefined ? bool(b.rulesReviewed) : !!g.rulesReviewed,
      autoPlan: b.autoPlan !== undefined ? bool(b.autoPlan) : (g.autoPlan ?? true),
      status: ['active', 'paused'].includes(b.status) ? b.status : (g.status || 'active'),
      notes: str(b.notes ?? g.notes, 2000),
    };
  }

  const routes = [
    ['GET', /^\/api\/state$/, () => state()],

    ['POST', /^\/api\/kill-switch$/, (b) => {
      const on = bool(b.on); db().settings.killSwitch = on;
      store.log('kill_switch', on ? '⛔ עצירת חירום הופעלה — כל הפרסומים נעצרו' : '▶️ הפרסומים הופעלו מחדש', {}, now());
      store.save(); return { killSwitch: on };
    }],

    ['POST', /^\/api\/settings$/, (b) => {
      const s = db().settings;
      const num = (k, min, max) => { if (b[k] !== undefined) { const v = Number(b[k]); if (!Number.isFinite(v) || v < min || v > max) throw new HttpError(400, `ערך לא תקין: ${k}`); s[k] = v; } };
      num('dailyCap', 1, 20); num('minMinutesBetweenPosts', 5, 600); num('sameTargetDupDays', 7, 365); num('anyTargetDupDays', 1, 90);
      num('shabbatMarginBeforeMin', 30, 240); num('shabbatMarginAfterMin', 0, 240);
      if (b.blockMemorialDays !== undefined) s.blockMemorialDays = bool(b.blockMemorialDays);
      if (b.postingHours) {
        const st = Number(b.postingHours.start), en = Number(b.postingHours.end);
        if (!(st >= 6 && en <= 23 && st < en)) throw new HttpError(400, 'שעות פעילות לא תקינות');
        s.postingHours = { start: st, end: en };
      }
      if (b.mode !== undefined) {
        if (b.mode === 'live') {
          if (b.confirm !== 'מאשר פרסום חי') throw new HttpError(400, 'כדי לעבור לפרסום חי יש להקליד בדיוק: מאשר פרסום חי');
          s.mode = 'live'; s.liveConfirmedAt = now().toISOString();
          store.log('mode', '⚠️ המערכת הועברה למצב פרסום חי באישור מפורש', {}, now());
        } else { s.mode = 'simulation'; s.liveConfirmedAt = null; store.log('mode', 'המערכת חזרה למצב סימולציה', {}, now()); }
      }
      store.save(); return s;
    }],
    ['POST', /^\/api\/settings\/reset$/, () => { const keep = db().settings.killSwitch; db().settings = { ...DEFAULT_SETTINGS, postingHours: { ...DEFAULT_SETTINGS.postingHours }, sheet: { ...db().settings.sheet }, killSwitch: keep }; store.save(); return db().settings; }],

    // קבוצות וערוצים
    ['POST', /^\/api\/groups$/, (b) => {
      const g = { id: store.nextId('G'), createdAt: now().toISOString(), ...sanitizeGroup(b) };
      const dup = db().groups.find((x) => x.url && x.url === g.url);
      if (dup) throw new HttpError(409, `הקבוצה כבר קיימת (${dup.name})`);
      db().groups.push(g); store.log('group', `נוספה: ${g.name}`, { groupId: g.id }, now()); store.save(); return g;
    }],
    ['PUT', /^\/api\/groups\/(G\d+)$/, (b, [id]) => {
      const g = find('groups', id); Object.assign(g, sanitizeGroup(b, g), { updatedAt: now().toISOString() });
      store.log('group', `עודכנה: ${g.name}`, { groupId: id }, now()); store.save(); return g;
    }],
    ['DELETE', /^\/api\/groups\/(G\d+)$/, (b, [id]) => {
      const g = find('groups', id); db().groups = db().groups.filter((x) => x.id !== id);
      for (const s of db().schedule) if (s.targetId === id && ['scheduled', 'deferred', 'awaiting_manual'].includes(s.status)) { s.status = 'cancelled'; s.reason = 'הקבוצה נמחקה'; }
      store.log('group', `נמחקה: ${g.name}`, { groupId: id }, now()); store.save(); return { ok: true };
    }],

    // פוסטים
    ['POST', /^\/api\/posts\/generate$/, (b) => {
      const count = Math.max(1, Math.min(10, Number(b.count) || 1));
      const target = b.targetId ? find('groups', b.targetId) : null;
      if (!SERVICES.some((s) => s.id === b.serviceId)) throw new HttpError(400, 'בחרו שירות');
      if (!AREAS.some((a) => a.id === b.areaId)) throw new HttpError(400, 'בחרו אזור');
      const out = [];
      for (let i = 0; i < count; i++) out.push(createPost(store, { serviceId: b.serviceId, areaId: b.areaId, target, includeSite: bool(b.includeSite), now: now() }));
      store.save(); return out;
    }],
    ['PUT', /^\/api\/posts\/(P\d+)$/, (b, [id]) => {
      const p = find('posts', id);
      if (db().history.some((h) => h.postId === id) && b.text !== undefined && b.text !== p.text) throw new HttpError(409, 'פוסט שכבר פורסם לא ניתן לעריכה — צרו פוסט חדש');
      if (b.text !== undefined) { p.text = str(b.text, 5000); p.status = 'draft'; }
      if (Array.isArray(b.mediaIds)) {
        for (const m of b.mediaIds) if (!db().media.some((x) => x.id === m)) throw new HttpError(400, `מדיה לא קיימת: ${m}`);
        p.mediaIds = b.mediaIds;
        const illustr = p.mediaIds.some((m) => db().media.find((x) => x.id === m)?.origin !== 'own_work');
        if (illustr && !p.text.includes('להמחשה בלבד')) { p.text += '\n\n(התמונה להמחשה בלבד)'; p.status = 'draft'; }
      }
      if (b.status === 'approved') {
        const l = lintPost(p.text);
        if (!l.ok) throw new HttpError(400, `לא ניתן לאשר: ${l.errors.join('; ')}`);
        p.status = 'approved'; p.approvedAt = now().toISOString();
        store.log('post', `פוסט ${id} אושר`, { postId: id }, now());
      } else if (b.status === 'draft') p.status = 'draft';
      p.lint = lintPost(p.text); store.save(); return p;
    }],
    ['POST', /^\/api\/posts\/approve-scheduled$/, () => {
      let n = 0; const errs = [];
      const ids = new Set(db().schedule.filter((s) => ['scheduled', 'deferred'].includes(s.status)).map((s) => s.postId));
      for (const p of db().posts) if (ids.has(p.id) && p.status === 'draft') { const l = lintPost(p.text); if (l.ok) { p.status = 'approved'; p.approvedAt = now().toISOString(); n++; } else errs.push(p.id); }
      store.log('post', `${n} פוסטים מתוזמנים אושרו`, {}, now()); store.save(); return { approved: n, failedLint: errs };
    }],
    ['DELETE', /^\/api\/posts\/(P\d+)$/, (b, [id]) => {
      find('posts', id);
      if (db().history.some((h) => h.postId === id)) throw new HttpError(409, 'פוסט שפורסם נשמר בהיסטוריה ולא ניתן למחיקה');
      db().posts = db().posts.filter((x) => x.id !== id);
      for (const s of db().schedule) if (s.postId === id && ['scheduled', 'deferred', 'awaiting_manual'].includes(s.status)) { s.status = 'cancelled'; s.reason = 'הפוסט נמחק'; }
      store.save(); return { ok: true };
    }],
    ['GET', /^\/api\/posts\/(P\d+)\/qa-links$/, (b, [id]) => {
      const p = find('posts', id);
      const code = `QA-${p.refCode}`;
      return { note: 'קישורי בדיקה — מסומנים QA ולא ייספרו כלידים', whatsapp: whatsappUrl(whatsappText({ serviceId: p.serviceId, areaId: p.areaId, refCode: code })), site: siteUrl({ serviceId: p.serviceId, areaId: p.areaId, refCode: p.refCode, qa: true, now: now() }) };
    }],

    // לוח פרסומים
    ['POST', /^\/api\/schedule$/, (b) => {
      const d = now(); const due = new Date(b.dueAt || d);
      const g = guardAt(db().calendar, due, db().settings);
      if (g.verified && !g.allowed) throw new HttpError(400, `המועד חסום: ${g.reason}`);
      const it = addSchedule(store, { postId: b.postId, targetId: b.targetId, dueAt: due.toISOString(), now: d });
      store.save(); return { ...it, warning: g.verified ? null : 'לא ניתן לאמת כרגע את המועד מול לוח השנה — ייבדק שוב בזמן הפרסום' };
    }],
    ['POST', /^\/api\/schedule\/auto-plan$/, async (b) => { await ensureCalendar(store, { fetchImpl, now: now() }); return autoPlan(store, { days: Math.max(1, Math.min(30, Number(b.days) || 7)), now: now() }); }],
    ['POST', /^\/api\/schedule\/(S\d+)\/cancel$/, (b, [id]) => {
      const s = find('schedule', id);
      if (!['scheduled', 'deferred', 'awaiting_manual', 'blocked', 'failed'].includes(s.status)) throw new HttpError(409, 'לא ניתן לבטל פריט שכבר פורסם');
      s.status = 'cancelled'; s.reason = 'בוטל ידנית'; store.log('schedule', `${id}: בוטל`, {}, now()); store.save(); return s;
    }],
    ['POST', /^\/api\/schedule\/(S\d+)\/retry$/, (b, [id]) => {
      const s = find('schedule', id);
      if (!['blocked', 'failed'].includes(s.status)) throw new HttpError(409, 'רק פריט חסום/נכשל ניתן לנסות שוב');
      s.status = 'scheduled'; s.reason = null; s.attempts = 0; s.retryAt = null; store.save(); return s;
    }],
    ['POST', /^\/api\/schedule\/(S\d+)\/open$/, (b, [id]) => {
      const s = find('schedule', id);
      if (s.status !== 'awaiting_manual') throw new HttpError(409, 'הפריט אינו ממתין לפרסום ידני');
      const post = db().posts.find((p) => p.id === s.postId); const target = db().groups.find((g) => g.id === s.targetId);
      const ev = evaluatePublish(db(), { item: s, post, target, now: now() });
      if (!ev.ok) throw new HttpError(409, 'כרגע אסור לפרסם', { reasons: ev.reasons });
      s.openedAt = now().toISOString(); store.log('manual', `${id}: נפתח לפרסום ידני ב-${target.name}`, { scheduleId: id }, now()); store.save();
      return { text: post.text, url: target.url, media: (post.mediaIds || []).map((m) => db().media.find((x) => x.id === m)).filter(Boolean).map((m) => ({ id: m.id, url: `/media/${m.file}`, name: m.originalName })) };
    }],
    ['POST', /^\/api\/schedule\/(S\d+)\/mark-published$/, (b, [id]) => {
      const s = find('schedule', id);
      if (s.status !== 'awaiting_manual') throw new HttpError(409, 'הפריט אינו ממתין לפרסום ידני');
      if (!s.openedAt) throw new HttpError(409, 'יש ללחוץ קודם "העתק ופתח"');
      const url = str(b.url, 500);
      if (url && !/^https:\/\//.test(url)) throw new HttpError(400, 'קישור לא תקין');
      const post = find('posts', s.postId); const target = find('groups', s.targetId);
      recordHistory(store, { item: s, post, target, mode: 'manual', externalUrl: url || null, now: now() });
      s.status = 'published_manual'; s.reason = null; s.externalUrl = url || null; s.updatedAt = now().toISOString();
      store.log('manual', `${id}: סומן כפורסם ידנית ב-${target.name}`, { scheduleId: id }, now()); store.save(); return s;
    }],
    ['POST', /^\/api\/schedule\/(S\d+)\/skip$/, (b, [id]) => {
      const s = find('schedule', id); if (s.status !== 'awaiting_manual') throw new HttpError(409, 'לא ממתין');
      s.status = 'skipped'; s.reason = 'דולג ידנית'; store.save(); return s;
    }],
    ['POST', /^\/api\/scheduler\/tick$/, async () => tick(store, { now: now(), fetchImpl, env: fbEnv() })],

    // מדיה
    ['POST', /^\/api\/media$/, (b) => {
      const ext = MEDIA_EXT[b.mime];
      if (!ext) throw new HttpError(400, 'סוג קובץ לא נתמך (תמונה: png/jpg/webp/gif, וידאו: mp4/mov/webm)');
      const origin = ['own_work', 'illustration', 'graphic'].includes(b.origin) ? b.origin : null;
      if (!origin) throw new HttpError(400, 'בחרו מקור לתמונה');
      if (origin === 'own_work' && !bool(b.confirmOwn)) throw new HttpError(400, 'לתמונת עבודה אמיתית יש לאשר שזו עבודה שלכם ושיש הסכמה לפרסום');
      const buf = Buffer.from(String(b.dataBase64 || ''), 'base64');
      if (!buf.length) throw new HttpError(400, 'קובץ ריק');
      const id = store.nextId('M'); const file = `${id}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      fs.writeFileSync(path.join(store.mediaDir, file), buf);
      const m = { id, file, kind: b.mime.startsWith('video/') ? 'video' : 'image', mime: b.mime, size: buf.length, originalName: str(b.name, 200), description: str(b.description, 500), origin, services: Array.isArray(b.services) ? b.services : [], createdAt: now().toISOString() };
      db().media.push(m); store.log('media', `הועלתה מדיה ${id} (${m.originalName})`, {}, now()); store.save(); return m;
    }],
    ['DELETE', /^\/api\/media\/(M\d+)$/, (b, [id]) => {
      const m = find('media', id);
      if (db().posts.some((p) => p.mediaIds?.includes(id))) throw new HttpError(409, 'המדיה משויכת לפוסט — הסירו אותה קודם');
      fs.rmSync(path.join(store.mediaDir, m.file), { force: true });
      db().media = db().media.filter((x) => x.id !== id); store.save(); return { ok: true };
    }],

    // לידים
    ['POST', /^\/api\/leads$/, (b) => {
      const lead = {
        id: store.nextId('L'), createdAt: b.createdAt && !Number.isNaN(Date.parse(b.createdAt)) ? new Date(b.createdAt).toISOString() : now().toISOString(),
        name: str(b.name, 200), phone: str(b.phone, 40), service: SERVICES.some((s) => s.id === b.service) ? b.service : null,
        area: AREAS.some((a) => a.id === b.area) ? b.area : null, source: LEAD_SOURCES[b.source] ? b.source : null,
        refCode: str(b.refCode, 40).toUpperCase() || null, message: str(b.message, 3000), utmSource: str(b.utmSource, 100),
        notes: str(b.notes, 2000), manualTest: bool(b.isTest) ? true : undefined, origin: 'manual', status: 'new', value: null,
      };
      if (!lead.name && !lead.phone) throw new HttpError(400, 'חסר שם או טלפון');
      attribute(db(), lead);
      db().leads.push(lead); store.log('lead', `ליד ${lead.id}${lead.isTest ? ' (בדיקה — לא נספר)' : ''}: ${lead.name || lead.phone}`, { leadId: lead.id }, now()); store.save(); return lead;
    }],
    ['PUT', /^\/api\/leads\/(L\d+)$/, (b, [id]) => {
      const l = find('leads', id);
      if (b.status && LEAD_STATUSES[b.status]) l.status = b.status;
      if (b.notes !== undefined) l.notes = str(b.notes, 2000);
      if (b.value !== undefined) l.value = b.value === '' || b.value === null ? null : Math.max(0, Number(b.value) || 0);
      if (b.isTest !== undefined) { l.manualTest = bool(b.isTest); attribute(db(), l); }
      l.updatedAt = now().toISOString(); store.save(); return l;
    }],
    ['DELETE', /^\/api\/leads\/(L\d+)$/, (b, [id]) => { find('leads', id); db().leads = db().leads.filter((x) => x.id !== id); store.save(); return { ok: true }; }],
    ['POST', /^\/api\/leads\/(L\d+)\/contact$/, (b, [id]) => {
      const l = find('leads', id);
      const g = outreachGuard(db(), now());
      if (!g.allowed) throw new HttpError(409, 'כרגע אסור ליצור קשר שיווקי', { reasons: g.reasons });
      const digits = l.phone.replace(/\D/g, '').replace(/^0/, '972');
      if (!digits) throw new HttpError(400, 'לליד אין מספר טלפון');
      store.log('lead', `${id}: נפתחה שיחת וואטסאפ`, {}, now()); store.save();
      return { url: `https://wa.me/${digits}` };
    }],

    // לוח שנה
    ['POST', /^\/api\/calendar\/refresh$/, async () => ensureCalendar(store, { fetchImpl, now: now(), force: true })],
    ['GET', /^\/api\/export$/, () => ({ __raw: true, type: 'application/json; charset=utf-8', filename: `brakha-backup-${now().toISOString().slice(0, 10)}.json`, body: JSON.stringify(db(), null, 2) })],
    ['GET', /^\/api\/export\/(leads|posts|history|report)\.csv$/, (b, [kind], url) => {
      const body = kind === 'leads' ? leadsCsv(db()) : kind === 'posts' ? postsCsv(db()) : kind === 'history' ? historyCsv(db())
        : reportCsv(leadReport(db(), { from: url.searchParams.get('from') || null, to: url.searchParams.get('to') || null }));
      return { __raw: true, type: 'text/csv; charset=utf-8', filename: `brakha-${kind}-${now().toISOString().slice(0, 10)}.csv`, body };
    }],
    ['GET', /^\/api\/report$/, (b, p, url) => {
      const from = url.searchParams.get('from') || null; const to = url.searchParams.get('to') || null;
      for (const d of [from, to]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, 'תאריך לא תקין');
      return leadReport(db(), { from, to });
    }],

    // גיבוי ושחזור
    ['GET', /^\/api\/backups$/, () => listBackups(store)],
    ['POST', /^\/api\/backups\/now$/, () => ({ file: snapshot(store, { now: now(), reason: 'manual' }) })],
    ['POST', /^\/api\/backup\/restore$/, (b) => {
      if (b.confirm !== 'שחזר') throw new HttpError(400, 'לאישור השחזור יש להקליד: שחזר');
      try { return restore(store, b.data, { now: now() }); } catch (e) { throw new HttpError(400, e.message); }
    }],

    // גיליון לידים (קריאה בלבד)
    ['POST', /^\/api\/sheet\/settings$/, (b) => {
      const sh = db().settings.sheet;
      if (b.spreadsheetId !== undefined) { if (!/^[A-Za-z0-9_-]{20,100}$/.test(b.spreadsheetId)) throw new HttpError(400, 'מזהה גיליון לא תקין'); sh.spreadsheetId = b.spreadsheetId; }
      if (b.tab !== undefined) { const t = str(b.tab, 100); if (!t) throw new HttpError(400, 'חסר שם טאב'); sh.tab = t; }
      if (b.autoSync !== undefined) sh.autoSync = bool(b.autoSync);
      store.save(); return sh;
    }],
    ['POST', /^\/api\/sheet\/service-account$/, (b) => {
      let sa; try { sa = typeof b.json === 'string' ? JSON.parse(b.json) : b.json; validateServiceAccount(sa); } catch (e) { throw new HttpError(400, `קובץ מפתח לא תקין: ${e.message}`); }
      fs.writeFileSync(saFile, JSON.stringify(sa), { mode: 0o600 });
      store.log('sheet', `נשמר מפתח Service Account (${sa.client_email})`, {}, now()); store.save();
      return { serviceAccountEmail: sa.client_email };
    }],
    ['DELETE', /^\/api\/sheet\/service-account$/, () => { fs.rmSync(saFile, { force: true }); store.log('sheet', 'מפתח Service Account נמחק', {}, now()); store.save(); return { ok: true }; }],
    ['POST', /^\/api\/sheet\/sync$/, () => syncSheet('manual')],
    ['POST', /^\/api\/sheet\/import-csv$/, (b) => {
      const rows = parseCsv(str(b.csv, 20 * 1024 * 1024));
      if (rows.length < 2) throw new HttpError(400, 'קובץ ה-CSV ריק');
      let r; try { r = importSheetLeads(store, rows, { now: now() }); } catch (e) { throw new HttpError(400, e.message); }
      db().sheetSync = { at: now().toISOString(), ok: true, reason: 'csv', result: r };
      store.log('sheet', `ייבוא CSV: ${r.rows} שורות · ${r.added} חדשים · ${r.updated} עודכנו · ${r.qa} QA · ${r.duplicates} כפולים`, {}, now());
      store.save(); return db().sheetSync;
    }],

    // פייסבוק — שמירת פרטים מקומית + בדיקת הרשאות (קריאה בלבד)
    ['POST', /^\/api\/facebook\/credentials$/, (b) => {
      const patch = {};
      if (b.pageId !== undefined) { const v = str(b.pageId, 40); if (v && !/^\d{5,25}$/.test(v)) throw new HttpError(400, 'מזהה דף צריך להיות מספרי'); patch.FB_PAGE_ID = v || null; }
      if (b.token !== undefined && str(b.token)) { const v = str(b.token, 1000); if (!/^[A-Za-z0-9_-]{20,}$/.test(v)) throw new HttpError(400, 'פורמט טוקן לא תקין'); patch.FB_PAGE_ACCESS_TOKEN = v; }
      writeSecrets(dataDir, patch);
      store.log('facebook', 'פרטי החיבור לפייסבוק עודכנו (נשמרו מקומית בלבד)', {}, now()); store.save();
      return { ok: true, tokenMasked: mask(fbEnv().FB_PAGE_ACCESS_TOKEN), pageId: fbEnv().FB_PAGE_ID || null };
    }],
    ['DELETE', /^\/api\/facebook\/credentials$/, () => { writeSecrets(dataDir, { FB_PAGE_ACCESS_TOKEN: null, FB_PAGE_ID: null }); db().facebookCheck = null; store.save(); return { ok: true }; }],
    ['POST', /^\/api\/facebook\/check$/, async () => {
      const e = fbEnv();
      const r = await checkFacebook({ pageId: e.FB_PAGE_ID, token: e.FB_PAGE_ACCESS_TOKEN, apiVersion: db().settings.facebookApiVersion, fetchImpl });
      r.liveEnabled = liveStatus(db().settings, e).ready;
      db().facebookCheck = r;
      store.log('facebook', `בדיקת חיבור לפייסבוק: ${r.ok ? 'תקין' : 'חסרים פריטים'}`, { missing: r.missingScopes }, now()); store.save();
      return r;
    }],
  ];

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    // הגנה: מקומי בלבד (מניעת DNS rebinding ובקשות מאתרים זרים)
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) { res.writeHead(403); return res.end('local only'); }
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) { res.writeHead(403); return res.end('bad origin'); }

    if (url.pathname.startsWith('/api/')) {
      const r = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      if (!r) { res.writeHead(404); return res.end(JSON.stringify({ error: 'לא נמצא' })); }
      try {
        if (req.method !== 'GET' && !String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'נדרש application/json');
        const body = req.method === 'GET' ? {} : await readBody(req);
        const out = await r[2](body, url.pathname.match(r[1]).slice(1), url);
        if (out && out.__raw) {
          res.setHeader('content-type', out.type);
          if (out.filename) res.setHeader('content-disposition', `attachment; filename="${out.filename}"`);
          res.writeHead(200); return res.end(out.body);
        }
        res.writeHead(200); res.end(JSON.stringify(out));
      } catch (e) {
        const status = e.status || 500;
        if (status === 500) store.error('server', e.message, { path: url.pathname });
        res.writeHead(status); res.end(JSON.stringify({ error: e.message, ...(e.extra || {}) }));
      }
      return;
    }
    // קבצים סטטיים ומדיה
    let file;
    if (url.pathname.startsWith('/media/')) file = path.join(store.mediaDir, path.basename(url.pathname));
    else file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(PUBLIC) && !file.startsWith(store.mediaDir)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
      res.end(data);
    });
  }

  const server = http.createServer((req, res) => { handle(req, res).catch((e) => { res.writeHead(500); res.end(String(e.message)); }); });
  let timer = null; let running = false;
  async function runTick() {
    if (running) return; running = true;
    try {
      await tick(store, { now: now(), fetchImpl, env: fbEnv() });
      if (dailySnapshot(store, now())) store.log('backup', 'נשמר גיבוי יומי אוטומטי', {}, now());
      const sh = db().settings.sheet; const last = db().sheetSync?.at ? Date.parse(db().sheetSync.at) : 0;
      const sa = serviceAccount();
      if (sh.autoSync && sa && !sa.error && now().getTime() - last > sh.syncEveryMinutes * 60000) await syncSheet('auto').catch(() => {});
    } catch (e) { store.error('scheduler', e.message); store.save(); } finally { running = false; }
  }
  return {
    store, server, syncSheet, runTick,
    startScheduler(intervalMs = 60000) { runTick(); timer = setInterval(runTick, intervalMs); timer.unref?.(); },
    stop() { clearInterval(timer); const p = new Promise((r) => server.close(r)); server.closeAllConnections?.(); return p; },
  };
}

// הרצה ישירה: node src/server.js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnvFile(path.join(ROOT, '.env'));
  const port = Number(process.env.PORT || 4610);
  const app = createApp({ dataDir: process.env.BRAKHA_DATA_DIR || path.join(ROOT, 'data') });
  app.server.listen(port, '127.0.0.1', () => {
    const s = app.store.db.settings;
    console.log(`\n  ברכה והצלחה — מערכת שיווק אוטומטי\n  פתחו בדפדפן: http://localhost:${port}\n  מצב: ${s.mode === 'live' ? 'פרסום חי' : 'סימולציה (שום דבר לא מתפרסם)'}${s.killSwitch ? ' | עצירת חירום פעילה' : ''}\n`);
  });
  app.startScheduler(60000);
}
