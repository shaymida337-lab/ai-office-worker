// סנכרון לידים מגיליון Google — קריאה בלבד (scope: spreadsheets.readonly).
// המערכת לעולם לא כותבת לגיליון, לא מוחקת ולא משנה בו שורות.
// אימות: Service Account של Google Cloud (חינם). המפתח נשמר רק במחשב המקומי.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { AREAS, SERVICES } from './business.js';
import { attribute } from './leads.js';
import { israelLocal } from './time.js';

export const DEFAULT_SHEET = Object.freeze({
  spreadsheetId: '1AZ6kSGtDyvmO2FrRcyQO8zA6j_pQR1oshCm7GyraTLY',
  tab: 'לידים מהאתר',
  autoSync: true,
  syncEveryMinutes: 30,
});

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

// ---------- אימות Service Account (JWT RS256, ללא ספריות) ----------
export function loadServiceAccount(file) {
  if (!file || !fs.existsSync(file)) return null;
  const sa = JSON.parse(fs.readFileSync(file, 'utf8'));
  validateServiceAccount(sa);
  return sa;
}

export function validateServiceAccount(sa) {
  if (!sa || sa.type !== 'service_account') throw new Error('הקובץ אינו מפתח Service Account של Google');
  if (!sa.client_email || !sa.private_key) throw new Error('בקובץ חסרים client_email או private_key');
  crypto.createPrivateKey(sa.private_key); // זורק אם המפתח פגום
  return true;
}

export function signJwt(sa, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  return `${unsigned}.${sig}`;
}

async function accessToken(sa, fetchImpl, nowMs) {
  const res = await fetchImpl(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(sa, nowMs) }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`Google סירב לאימות: ${j.error_description || j.error || res.status}`);
  return j.access_token;
}

export async function fetchSheetValues({ sa, spreadsheetId, tab, fetchImpl = globalThis.fetch, nowMs = Date.now() }) {
  const token = await accessToken(sa, fetchImpl, nowMs);
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:Z5000`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
  const j = await res.json().catch(() => ({}));
  if (res.status === 403 || res.status === 404) throw new Error(`אין גישה לגיליון — שתפו אותו (צפייה בלבד) עם ${sa.client_email}`);
  if (!res.ok) throw new Error(`Google Sheets החזיר שגיאה: ${j.error?.message || res.status}`);
  return j.values || [];
}

// ---------- CSV (גיבוי ידני: קובץ ← הורדה ← CSV) ----------
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

// ---------- מיפוי שורות → לידים ----------
const COLS = {
  date: ['תאריך קבלה', 'תאריך'], name: ['שם'], phone: ['טלפון'], city: ['עיר'], work: ['סוג עבודה'],
  budget: ['תקציב משוער'], startWhen: ['מתי להתחיל'], description: ['תיאור'], landing: ['דף מקור'],
  utm_source: ['utm_source'], utm_medium: ['utm_medium'], utm_campaign: ['utm_campaign'], utm_term: ['utm_term'], utm_content: ['utm_content'],
  gclid: ['gclid'], status: ['סטטוס'], key: ['מפתח כפילות'],
};

function headerIndex(header) {
  const norm = header.map((h) => String(h ?? '').trim().toLowerCase());
  const idx = {};
  for (const [k, names] of Object.entries(COLS)) idx[k] = norm.findIndex((h) => names.some((n) => n.toLowerCase() === h));
  if (idx.name < 0 && idx.phone < 0) throw new Error('בגיליון לא נמצאו העמודות "שם" או "טלפון" — בדקו את שם הטאב');
  return idx;
}

/** תאריך: מספר סידורי של Sheets, M/D/YYYY, D.M.YYYY או ISO → ISO (שעון ישראל, 12:00 אם אין שעה) */
export function parseSheetDate(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'string' && /^\d{5}(\.\d+)?$/.test(v.trim())) v = Number(v); // מספר סידורי שהגיע כטקסט (CSV)
  if (typeof v === 'number') {
    const ms = Math.round((v - 25569) * 86400000); // תאריך+שעה מקומיים כ-UTC
    const d = new Date(ms);
    const ymd = d.toISOString().slice(0, 10);
    const hasTime = v % 1 !== 0;
    return israelLocal(ymd, hasTime ? d.getUTCHours() : 12, hasTime ? d.getUTCMinutes() : 0).toISOString();
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/); // הגיליון בפורמט M/D/YYYY
  if (m) return israelLocal(`${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`, m[4] ? +m[4] : 12, m[5] ? +m[5] : 0).toISOString();
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/); // D.M.YYYY
  if (m) return israelLocal(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, 12, 0).toISOString();
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function normalizePhone(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.startsWith('972')) d = `0${d.slice(3)}`;
  if (d.length === 9 && /^[5-9]/.test(d)) d = `0${d}`; // מספר שאיבד את ה-0 בגיליון
  return d;
}

export function cityToArea(city) {
  const c = String(city || '').replace(/[״"'׳-]/g, ' ').replace(/\s+/g, ' ').trim();
  const alias = { 'ר ג': 'ramat-gan', 'ת א': 'tel-aviv', 'תל אביב יפו': 'tel-aviv', 'פ ת': 'petah-tikva', 'פתח תקוה': 'petah-tikva', 'קרית אונו': 'kiryat-ono' };
  if (alias[c]) return alias[c];
  return AREAS.find((a) => c.includes(a.label.replace(/-/g, ' ')))?.id || null;
}

export function workToService(work) {
  const w = String(work || '');
  if (/אמבט|מקלח|חדר רחצה|שירותים/.test(w)) return 'bathroom';
  if (/מטבח/.test(w)) return 'kitchen';
  if (/צבע|צביע/.test(w)) return 'paint';
  if (/ריצוף|גבס|קרמיק/.test(w)) return 'flooring-gypsum';
  if (/שיפוץ|קומפלט|דירה/.test(w)) return 'general';
  return null;
}

const str = (v) => (v == null ? '' : String(v)).trim();

export function rowsToLeads(values) {
  if (!values?.length) return [];
  const idx = headerIndex(values[0]);
  const get = (r, k) => (idx[k] >= 0 ? r[idx[k]] : '');
  const out = [];
  values.slice(1).forEach((r, i) => {
    if (!r || r.every((x) => str(x) === '')) return;
    const phone = normalizePhone(get(r, 'phone'));
    const createdAt = parseSheetDate(get(r, 'date'));
    const sheetKey = str(get(r, 'key')) || `row:${crypto.createHash('sha256').update([createdAt, phone, str(get(r, 'name')), str(get(r, 'description'))].join('|')).digest('base64url').slice(0, 32)}`;
    out.push({
      sheetKey, sheetRow: i + 2, createdAt, name: str(get(r, 'name')), phone, city: str(get(r, 'city')),
      area: cityToArea(get(r, 'city')), serviceRaw: str(get(r, 'work')), service: workToService(get(r, 'work')),
      budget: str(get(r, 'budget')), startWhen: str(get(r, 'startWhen')), notes: str(get(r, 'description')),
      landing: str(get(r, 'landing')), utmSource: str(get(r, 'utm_source')), utmMedium: str(get(r, 'utm_medium')),
      utmCampaign: str(get(r, 'utm_campaign')), utmTerm: str(get(r, 'utm_term')), utmContent: str(get(r, 'utm_content')),
      gclid: str(get(r, 'gclid')), sheetStatus: str(get(r, 'status')),
    });
  });
  return out;
}

const SHEET_FIELDS = ['createdAt', 'name', 'phone', 'city', 'area', 'serviceRaw', 'budget', 'startWhen', 'notes', 'landing', 'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent', 'gclid', 'sheetStatus', 'sheetRow'];

/**
 * מייבא/מעדכן לידים מהגיליון. מפתח ייחודי: "מפתח כפילות" מהגיליון.
 * לא מוחק לידים שנעלמו מהגיליון; לא דורס סטטוס/ערך שהוזנו במערכת.
 */
export function importSheetLeads(store, values, { now = new Date(), origin = 'sheet' } = {}) {
  const db = store.db;
  const rows = rowsToLeads(values);
  const r = { rows: rows.length, added: 0, updated: 0, unchanged: 0, qa: 0, duplicates: 0, real: 0, duplicateKeysInSheet: 0 };
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.sheetKey)) { r.duplicateKeysInSheet++; continue; } // אותה שורה פעמיים בגיליון
    seen.add(row.sheetKey);
    let lead = db.leads.find((l) => l.sheetKey === row.sheetKey);
    if (lead) {
      const changed = SHEET_FIELDS.some((f) => (lead[f] ?? '') !== (row[f] ?? ''));
      if (changed) { for (const f of SHEET_FIELDS) lead[f] = row[f]; lead.service ||= row.service; lead.updatedAt = new Date(now).toISOString(); r.updated++; } else r.unchanged++;
    } else {
      lead = {
        id: store.nextId('L'), origin, ...row, createdAt: row.createdAt || new Date(now).toISOString(),
        source: 'website', refCode: /^B\d{4,}$/.test(row.utmContent) ? row.utmContent : null, status: 'new', value: null, importedAt: new Date(now).toISOString(),
      };
      db.leads.push(lead);
      r.added++;
    }
    attribute(db, lead);
    // כפילות מול ליד שנרשם ידנית (אותו טלפון, עד 7 ימים) — נספר פעם אחת בלבד
    const dup = lead.phone && db.leads.find((l) => l !== lead && !l.duplicateOf && l.origin !== 'sheet' && normalizePhone(l.phone) === lead.phone && Math.abs(Date.parse(l.createdAt) - Date.parse(lead.createdAt)) < 7 * 86400000);
    lead.duplicateOf = dup ? dup.id : null;
    if (lead.isTest) r.qa++; else if (lead.duplicateOf) r.duplicates++; else r.real++;
  }
  return r;
}

export { SERVICES };
