// גיבויים: צילום יומי אוטומטי, גיבוי ידני ושחזור. סודות (טוקנים/מפתחות) לעולם לא נכללים.
import fs from 'node:fs';
import path from 'node:path';
import { defaultDb } from './store.js';
import { israelParts } from './time.js';

const KEEP = 30;
const ARRAYS = ['groups', 'posts', 'schedule', 'history', 'media', 'leads', 'activity', 'errors'];

export const backupsDir = (store) => path.join(store.dir, 'backups');

export function snapshot(store, { now = new Date(), reason = 'auto' } = {}) {
  const dir = backupsDir(store);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = reason === 'auto' ? israelParts(now).ymd : new Date(now).toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `db-${reason}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(store.db));
  const files = listBackups(store);
  for (const f of files.slice(KEEP)) fs.rmSync(path.join(dir, f.name), { force: true });
  return path.basename(file);
}

/** צילום אוטומטי פעם ביום */
export function dailySnapshot(store, now = new Date()) {
  const name = `db-auto-${israelParts(now).ymd}.json`;
  if (fs.existsSync(path.join(backupsDir(store), name))) return null;
  return snapshot(store, { now, reason: 'auto' });
}

export function listBackups(store) {
  const dir = backupsDir(store);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^db-.*\.json$/.test(f))
    .map((name) => { const st = fs.statSync(path.join(dir, name)); return { name, size: st.size, mtime: st.mtime.toISOString() }; })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

export function validateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('קובץ הגיבוי אינו תקין');
  if (data.version !== 1) throw new Error('גרסת גיבוי לא נתמכת');
  if (!data.settings || typeof data.settings !== 'object') throw new Error('בגיבוי חסרות הגדרות');
  for (const k of ARRAYS) if (data[k] !== undefined && !Array.isArray(data[k])) throw new Error(`שדה לא תקין בגיבוי: ${k}`);
  for (const l of data.leads || []) if (!l.id) throw new Error('ליד ללא מזהה בגיבוי');
  return true;
}

/** שחזור: מצלם קודם את המצב הנוכחי, ואז מחליף. עצירת החירום נשמרת כפי שהיא כרגע. */
export function restore(store, data, { now = new Date() } = {}) {
  validateBackup(data);
  const before = snapshot(store, { now, reason: 'before-restore' });
  const base = defaultDb();
  const killSwitch = store.db.settings.killSwitch;
  store.db = { ...base, ...data, settings: { ...base.settings, ...data.settings, killSwitch, mode: 'simulation', liveConfirmedAt: null } };
  for (const k of ARRAYS) store.db[k] ||= [];
  store.log('backup', `שוחזר גיבוי (${(data.leads || []).length} לידים). גיבוי של המצב הקודם: ${before}. המערכת הוחזרה לסימולציה.`, {}, now);
  store.save();
  return { restored: true, before, leads: store.db.leads.length };
}
