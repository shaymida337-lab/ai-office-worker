import { BUSINESS, SERVICES, AREAS, TARGET_TYPES } from './business.js';
import { israelParts, DAY } from './time.js';

export const LEAD_STATUSES = { new: 'חדש', contacted: 'נוצר קשר', quote_sent: 'נשלחה הצעה', won: 'נסגרה עבודה', lost: 'לא רלוונטי' };
export const LEAD_SOURCES = {
  facebook_group: 'קבוצת פייסבוק', facebook_page: 'דף פייסבוק', instagram: 'אינסטגרם', google_business: 'גוגל עסקים',
  whatsapp_status: 'סטטוס וואטסאפ', website: 'אתר', referral: 'המלצה מפה לאוזן', phone: 'שיחה ישירה', other: 'אחר', unknown: 'לא ידוע',
};

export function extractRefCode(text) {
  const m = String(text || '').match(/\b(QA-[A-Z0-9]+|B\d{4,})\b/);
  return m ? m[1] : null;
}

/** זיהוי בדיקות QA — לעולם לא נספרות כלידים אמיתיים */
export function qaReasons(lead) {
  const r = [];
  if (lead.manualTest === true) r.push('סומן ידנית כבדיקה');
  const digits = String(lead.phone || '').replace(/\D/g, '').replace(/^972/, '0');
  if (digits && digits === '0544427244') r.push('מספר הטלפון של העסק עצמו');
  if (/בדיקה|טסט|\btest\b|\bqa\b/i.test(`${lead.name || ''} ${lead.notes || ''}`)) r.push('שם/הערה מכילים "בדיקה"/"test"');
  if (/^QA-/i.test(lead.refCode || '') || /^qa$|^test$/i.test(lead.utmSource || '') || /^(qa|test)$|^test-|^qa-/i.test(lead.utmMedium || '')) r.push('קוד/UTM של בדיקה');
  if (/^QA[-_ ]/i.test(lead.name || '')) r.push('שם מתחיל ב-QA');
  if (/\bQA\b|בדיקה/i.test(lead.sheetStatus || '')) r.push('מסומן כבדיקה בגיליון');
  return r;
}

/** שיוך ליד למקור: לפי קוד הפוסט (מהודעת הוואטסאפ) */
export function attribute(db, lead) {
  const code = lead.refCode || extractRefCode(lead.message);
  if (code) lead.refCode = code;
  const post = code ? db.posts.find((p) => p.refCode === code) : null;
  if (post) {
    lead.postId = post.id;
    const h = db.history.filter((x) => x.postId === post.id).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0];
    const targetId = h?.targetId || post.forTargetId;
    const target = db.groups.find((g) => g.id === targetId);
    if (target) { lead.targetId = target.id; if (!lead.source || lead.source === 'unknown') lead.source = target.type; }
    lead.service ||= post.serviceId;
    lead.area ||= post.areaId;
  }
  lead.source ||= 'unknown';
  // manualTest: true/false = החלטה ידנית שגוברת על הזיהוי האוטומטי
  const qa = lead.manualTest === false ? [] : qaReasons(lead);
  lead.isTest = qa.length > 0;
  lead.qaReasons = qa;
  return lead;
}

/** לידים אמיתיים: לא בדיקה ולא כפילות של ליד אחר */
export const realLeads = (db) => db.leads.filter((l) => !l.isTest && !l.duplicateOf);

export function cityLabel(l) { return AREAS.find((a) => a.id === l.area)?.label || l.city || 'לא ידוע'; }

const countBy = (arr, fn) => arr.reduce((m, x) => { const k = fn(x) ?? 'unknown'; m[k] = (m[k] || 0) + 1; return m; }, {});

export function computeStats(db, now = new Date()) {
  const t = new Date(now).getTime();
  const real = realLeads(db);
  const month = israelParts(now).ymd.slice(0, 7);
  const realPub = db.history.filter((h) => h.mode !== 'simulation');
  const byTarget = db.groups.map((g) => {
    const posts = realPub.filter((h) => h.targetId === g.id).length;
    const sims = db.history.filter((h) => h.targetId === g.id && h.mode === 'simulation').length;
    const leads = real.filter((l) => l.targetId === g.id).length;
    const won = real.filter((l) => l.targetId === g.id && l.status === 'won').length;
    return { id: g.id, name: g.name, type: g.type, posts, simulated: sims, leads, won, leadsPerPost: posts ? +(leads / posts).toFixed(2) : null };
  }).sort((a, b) => b.leads - a.leads || b.posts - a.posts);
  return {
    leads: {
      total: real.length,
      last7: real.filter((l) => t - Date.parse(l.createdAt) < 7 * DAY).length,
      thisMonth: real.filter((l) => israelParts(new Date(l.createdAt)).ymd.startsWith(month)).length,
      won: real.filter((l) => l.status === 'won').length,
      qaExcluded: db.leads.filter((l) => l.isTest).length,
      duplicatesExcluded: db.leads.filter((l) => !l.isTest && l.duplicateOf).length,
      fromSheet: real.filter((l) => l.origin === 'sheet').length,
      bySource: countBy(real, (l) => l.source),
      byService: countBy(real, (l) => l.service),
      byArea: countBy(real, (l) => l.area),
      byCity: countBy(real, cityLabel),
      byStatus: countBy(real, (l) => l.status),
      attributedToPost: real.filter((l) => l.postId).length,
    },
    posts: {
      publishedReal: realPub.length,
      publishedThisMonth: realPub.filter((h) => israelParts(new Date(h.ts)).ymd.startsWith(month)).length,
      simulated: db.history.filter((h) => h.mode === 'simulation').length,
      manual: db.history.filter((h) => h.mode === 'manual').length,
      live: db.history.filter((h) => h.mode === 'live').length,
      upcoming: db.schedule.filter((s) => ['scheduled', 'deferred'].includes(s.status)).length,
      awaitingManual: db.schedule.filter((s) => s.status === 'awaiting_manual').length,
      drafts: db.posts.filter((p) => p.status === 'draft').length,
    },
    byTarget,
    labels: {
      source: LEAD_SOURCES, status: LEAD_STATUSES,
      service: Object.fromEntries(SERVICES.map((s) => [s.id, s.label])),
      area: Object.fromEntries(AREAS.map((a) => [a.id, a.label])),
      targetType: Object.fromEntries(Object.entries(TARGET_TYPES).map(([k, v]) => [k, v.label])),
    },
    business: BUSINESS,
  };
}
