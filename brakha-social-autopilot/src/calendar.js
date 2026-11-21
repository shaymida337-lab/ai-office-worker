// שבת וחגים — לפי Hebcal (hebcal.com), מיקום: רמת גן (GeoNames 293788), לוח ישראל (i=on).
// עיקרון: Fail-closed. אם אין נתון מאומת שמכסה את הרגע הנבדק — הפרסום נחסם.
import { israelLocal, israelParts, addDaysYmd, MIN, HOUR, DAY } from './time.js';

export const LOCATION = Object.freeze({ geonameid: 293788, name: 'רמת גן', tzid: 'Asia/Jerusalem' });
export const SOURCE = 'Hebcal Jewish Calendar (www.hebcal.com) — Ramat Gan, Israel';

const MEMORIAL = [
  { re: /^Yom HaShoah/, label: 'יום הזיכרון לשואה ולגבורה' },
  { re: /^Yom HaZikaron/, label: 'יום הזיכרון לחללי מערכות ישראל' },
  { re: /^Tish'a B'Av/, label: 'תשעה באב' },
];

export function hebcalUrl(start, end) {
  const p = new URLSearchParams({
    v: '1', cfg: 'json', maj: 'on', min: 'on', mod: 'on', nx: 'off', ss: 'off', mf: 'off',
    c: 'on', geo: 'geoname', geonameid: String(LOCATION.geonameid), M: 'on', s: 'off', i: 'on', start, end,
  });
  return `https://www.hebcal.com/hebcal?${p}`;
}

/** אימות תשובת Hebcal — זורק שגיאה אם משהו לא תואם */
export function validateHebcal(json) {
  if (!json || typeof json !== 'object') throw new Error('תשובה ריקה מ-Hebcal');
  const loc = json.location || {};
  if (Number(loc.geonameid) !== LOCATION.geonameid) throw new Error('המיקום בתשובה אינו רמת גן');
  if (loc.tzid !== LOCATION.tzid) throw new Error('אזור הזמן בתשובה אינו Asia/Jerusalem');
  if (loc.cc && loc.cc !== 'IL') throw new Error('המדינה בתשובה אינה ישראל');
  if (!json.range?.start || !json.range?.end) throw new Error('חסר טווח תאריכים בתשובה');
  if (!Array.isArray(json.items)) throw new Error('חסרה רשימת אירועים בתשובה');
  const candles = json.items.filter((i) => i.category === 'candles');
  const havdalah = json.items.filter((i) => i.category === 'havdalah');
  const days = (Date.parse(json.range.end) - Date.parse(json.range.start)) / DAY;
  if (days >= 7 && (candles.length === 0 || havdalah.length === 0)) throw new Error('אין זמני הדלקת נרות/הבדלה בטווח — לא סביר');
  for (const i of [...candles, ...havdalah]) if (Number.isNaN(Date.parse(i.date))) throw new Error(`תאריך לא תקין: ${i.date}`);
  return true;
}

export async function fetchCalendar({ start, end, fetchImpl = globalThis.fetch, timeoutMs = 10000, now = new Date() }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(hebcalUrl(start, end), { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Hebcal החזיר HTTP ${res.status}`);
    const json = await res.json();
    validateHebcal(json);
    return {
      source: SOURCE,
      fetchedAt: new Date(now).toISOString(),
      range: json.range,
      location: { geonameid: json.location.geonameid, title: json.location.title, tzid: json.location.tzid },
      items: json.items.map(({ title, date, category, subcat, hebrew, yomtov }) => ({ title, date, category, subcat, hebrew, yomtov })),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** כיסוי מאומת: [תחילת הטווח, סוף היום האחרון בטווח) בשעון ישראל */
export function coverage(cal) {
  if (!cal?.range) return null;
  return { from: israelLocal(cal.range.start, 0, 0).getTime(), to: israelLocal(addDaysYmd(cal.range.end, 1), 0, 0).getTime() };
}

/** חלונות חסימה: מהדלקת נרות (פחות מרווח) ועד ההבדלה הבאה (ועוד מרווח). מאחד חלונות חופפים. */
export function computeWindows(cal, settings = {}) {
  if (!cal?.items) return [];
  const before = (settings.shabbatMarginBeforeMin ?? 60) * MIN;
  const after = (settings.shabbatMarginAfterMin ?? 30) * MIN;
  const cov = coverage(cal);
  const ev = cal.items.filter((i) => i.category === 'candles' || i.category === 'havdalah')
    .map((i) => ({ ...i, t: Date.parse(i.date) })).sort((a, b) => a.t - b.t);
  const holidaysByDay = new Map();
  for (const i of cal.items) if (i.category === 'holiday' && i.yomtov) holidaysByDay.set(i.date.slice(0, 10), i.hebrew || i.title);

  const raw = [];
  for (let k = 0; k < ev.length; k++) {
    if (ev[k].category !== 'candles') continue;
    const h = ev.slice(k + 1).find((e) => e.category === 'havdalah');
    const startT = ev[k].t - before;
    const endT = h ? h.t + after : cov.to; // אין הבדלה בטווח → חסום עד סוף הכיסוי (fail-closed)
    const nextDay = addDaysYmd(ev[k].date.slice(0, 10), 1);
    const isShabbat = israelParts(new Date(ev[k].t)).weekday === 5;
    const label = holidaysByDay.get(nextDay) || (isShabbat ? 'שבת' : 'שבת / חג');
    raw.push({ start: startT, end: endT, kind: 'shabbat_yomtov', label });
  }
  if (settings.blockMemorialDays !== false) {
    for (const i of cal.items) {
      const m = MEMORIAL.find((x) => x.re.test(i.title));
      if (!m) continue;
      const ymd = i.date.slice(0, 10);
      // מערב היום הקודם (16:00) ועד סוף היום — חסימת זהירות
      raw.push({ start: israelLocal(addDaysYmd(ymd, -1), 16, 0).getTime(), end: israelLocal(addDaysYmd(ymd, 1), 0, 0).getTime(), kind: 'memorial', label: m.label });
    }
  }
  raw.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const w of raw) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) {
      last.end = Math.max(last.end, w.end);
      if (!last.label.includes(w.label)) last.label = `${last.label} + ${w.label}`;
    } else merged.push({ ...w });
  }
  return merged;
}

/**
 * האם מותר לפרסם ברגע date?
 * מחזיר { allowed, verified, reason, window?, resumeAt? }
 */
export function guardAt(cal, date, settings = {}) {
  const t = new Date(date).getTime();
  const cov = coverage(cal);
  if (!cov || t < cov.from || t >= cov.to) {
    return { allowed: false, verified: false, reason: 'לא ניתן לאמת זמני שבת/חג לרגע הזה — הפרסום נעצר (fail-closed).' };
  }
  const windows = computeWindows(cal, settings);
  const w = windows.find((x) => t >= x.start && t < x.end);
  if (w) {
    return { allowed: false, verified: true, reason: `חסום: ${w.label} — עד ${fmt(w.end)}`, window: w, resumeAt: new Date(w.end).toISOString() };
  }
  // בדיקת שפיות מקומית: שבת בצהריים חייבת להיות בתוך חלון. אם לא — הנתונים חשודים.
  const p = israelParts(new Date(t));
  if (p.weekday === 6 && p.hour >= 9 && p.hour < 16) {
    return { allowed: false, verified: false, reason: 'נתוני הלוח לא עקביים (שבת ללא חלון חסימה) — הפרסום נעצר.' };
  }
  return { allowed: true, verified: true, reason: 'מותר — אין שבת/חג' };
}

export function upcomingWindows(cal, settings, now = new Date(), n = 5) {
  const t = new Date(now).getTime();
  return computeWindows(cal, settings).filter((w) => w.end > t).slice(0, n)
    .map((w) => ({ ...w, start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() }));
}

/** רענון המטמון אם הוא ישן (24 שעות) או לא מכסה את 21 הימים הקרובים */
export function needsRefresh(cal, now = new Date()) {
  if (!cal) return true;
  const cov = coverage(cal);
  const t = new Date(now).getTime();
  if (!cov || cov.from > t || cov.to < t + 21 * DAY) return true;
  return t - Date.parse(cal.fetchedAt) > 24 * HOUR;
}

export async function ensureCalendar(store, { fetchImpl = globalThis.fetch, now = new Date(), force = false } = {}) {
  if (!force && !needsRefresh(store.db.calendar, now)) return { refreshed: false };
  const start = addDaysYmd(israelParts(now).ymd, -1);
  const end = addDaysYmd(start, 75);
  try {
    store.db.calendar = await fetchCalendar({ start, end, fetchImpl, now });
    store.log('calendar', `לוח שבת/חגים עודכן מ-Hebcal (${start} עד ${end})`, {}, now);
    store.save();
    return { refreshed: true };
  } catch (e) {
    store.error('calendar', `עדכון הלוח נכשל: ${e.message}`, {}, now);
    store.save();
    return { refreshed: false, error: e.message };
  }
}

function fmt(t) {
  return new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(t));
}
