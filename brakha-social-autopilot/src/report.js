// דוח לידים לפי מקור, קבוצה, פוסט ועיר + ייצוא CSV
import { SERVICES } from './business.js';
import { LEAD_SOURCES, LEAD_STATUSES, cityLabel } from './leads.js';
import { israelParts } from './time.js';

function inRange(l, from, to) {
  const d = israelParts(new Date(l.createdAt)).ymd;
  return (!from || d >= from) && (!to || d <= to);
}

function sourceLabel(l) {
  const base = LEAD_SOURCES[l.source] || 'לא ידוע';
  if (l.source === 'website') return l.utmSource ? `אתר · ${l.utmSource}` : 'אתר · ישיר/אורגני';
  return base;
}

function group(leads, keyFn) {
  const m = new Map();
  for (const l of leads) {
    const k = keyFn(l);
    const r = m.get(k) || { key: k, leads: 0, contacted: 0, quoteSent: 0, won: 0, lost: 0, value: 0 };
    r.leads++;
    if (['contacted', 'quote_sent', 'won'].includes(l.status)) r.contacted++;
    if (['quote_sent', 'won'].includes(l.status)) r.quoteSent++;
    if (l.status === 'won') { r.won++; r.value += Number(l.value) || 0; }
    if (l.status === 'lost') r.lost++;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.leads - a.leads || b.won - a.won);
}

export function leadReport(db, { from = null, to = null } = {}) {
  const all = db.leads.filter((l) => inRange(l, from, to));
  const real = all.filter((l) => !l.isTest && !l.duplicateOf);
  const groupName = (l) => db.groups.find((g) => g.id === l.targetId)?.name || (l.source === 'website' ? 'אתר (ללא קבוצה)' : 'לא משויך לקבוצה');
  const postKey = (l) => {
    const p = db.posts.find((x) => x.id === l.postId);
    return p ? `${p.id} · ${p.refCode} · ${SERVICES.find((s) => s.id === p.serviceId)?.label || ''}` : 'לא משויך לפוסט';
  };
  const postsPublished = (title) => {
    const id = title.split(' · ')[0];
    return db.history.filter((h) => h.postId === id && h.mode !== 'simulation').length;
  };
  const byGroup = group(real, groupName).map((r) => {
    const g = db.groups.find((x) => x.name === r.key);
    const posts = g ? db.history.filter((h) => h.targetId === g.id && h.mode !== 'simulation').length : null;
    return { ...r, posts, leadsPerPost: posts ? +(r.leads / posts).toFixed(2) : null };
  });
  return {
    range: { from, to },
    totals: { all: all.length, real: real.length, qa: all.filter((l) => l.isTest).length, duplicates: all.filter((l) => !l.isTest && l.duplicateOf).length, won: real.filter((l) => l.status === 'won').length, value: real.reduce((s, l) => s + (l.status === 'won' ? Number(l.value) || 0 : 0), 0) },
    bySource: group(real, sourceLabel),
    byGroup,
    byPost: group(real, postKey).map((r) => ({ ...r, posts: r.key.startsWith('לא') ? null : postsPublished(r.key) })),
    byCity: group(real, cityLabel),
  };
}

// ---------- CSV ----------
const cell = (v) => {
  const s = v == null ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // הגנה מהזרקת נוסחאות באקסל
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export function toCsv(header, rows) {
  return `﻿${[header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`; // BOM — עברית תקינה באקסל
}

export function reportCsv(rep) {
  const rows = [];
  const sec = (title, list) => { for (const r of list) rows.push([title, r.key, r.leads, r.contacted, r.quoteSent, r.won, r.lost, r.value, r.posts ?? '', r.leadsPerPost ?? '']); };
  sec('מקור', rep.bySource); sec('קבוצה', rep.byGroup); sec('פוסט', rep.byPost); sec('עיר', rep.byCity);
  return toCsv(['חתך', 'ערך', 'לידים', 'נוצר קשר', 'נשלחה הצעה', 'נסגרו', 'לא רלוונטי', 'שווי עבודות ₪', 'פרסומים', 'לידים לפרסום'], rows);
}

export function leadsCsv(db) {
  const g = (id) => db.groups.find((x) => x.id === id)?.name || '';
  return toCsv(
    ['מזהה', 'תאריך', 'שם', 'טלפון', 'עיר', 'שירות', 'מקור', 'קבוצה', 'פוסט', 'קוד', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'סטטוס', 'שווי ₪', 'בדיקה (QA)', 'סיבת QA', 'כפילות של', 'מקור הרשומה', 'הערות'],
    db.leads.map((l) => [l.id, l.createdAt, l.name, l.phone, cityLabel(l), SERVICES.find((s) => s.id === l.service)?.label || l.serviceRaw || '', LEAD_SOURCES[l.source] || l.source, g(l.targetId), l.postId || '', l.refCode || '', l.utmSource || '', l.utmMedium || '', l.utmCampaign || '', l.utmContent || '', LEAD_STATUSES[l.status] || l.status, l.value ?? '', l.isTest ? 'כן' : 'לא', (l.qaReasons || []).join('; '), l.duplicateOf || '', l.origin === 'sheet' ? 'גיליון' : 'ידני', l.notes || '']),
  );
}

export function postsCsv(db) {
  return toCsv(['מזהה', 'קוד', 'שירות', 'אזור', 'סטטוס', 'נוצר', 'פרסומים אמיתיים', 'טקסט'],
    db.posts.map((p) => [p.id, p.refCode, p.serviceId, p.areaId, p.status, p.createdAt, db.history.filter((h) => h.postId === p.id && h.mode !== 'simulation').length, p.text]));
}

export function historyCsv(db) {
  return toCsv(['מזהה', 'זמן', 'ערוץ', 'סוג ערוץ', 'פוסט', 'קוד', 'אופן', 'קישור'],
    db.history.map((h) => [h.id, h.ts, db.groups.find((g) => g.id === h.targetId)?.name || h.targetId, h.targetType, h.postId, h.refCode, h.mode, h.externalUrl || '']));
}
