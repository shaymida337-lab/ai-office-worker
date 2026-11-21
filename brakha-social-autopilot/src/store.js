import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'simulation', // simulation | live
  liveConfirmedAt: null,
  killSwitch: false,
  dailyCap: 5, // מקסימום פרסומים ביום (כל הערוצים יחד)
  minMinutesBetweenPosts: 20, // מרווח מינימלי בין שני פרסומים כלשהם
  sameTargetDupDays: 60, // אותו טקסט לאותה קבוצה — חסום X ימים
  anyTargetDupDays: 14, // אותו טקסט בכל קבוצה אחרת — חסום X ימים
  postingHours: { start: 8, end: 21 }, // שעות מותרות לפרסום ופניות (שעון ישראל)
  shabbatMarginBeforeMin: 60, // עצירה X דקות לפני הדלקת נרות
  shabbatMarginAfterMin: 30, // חידוש X דקות אחרי הבדלה
  blockMemorialDays: true, // יום השואה, יום הזיכרון, תשעה באב
  facebookApiVersion: 'v23.0',
});

export function defaultDb() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    settings: { ...DEFAULT_SETTINGS, postingHours: { ...DEFAULT_SETTINGS.postingHours } },
    counters: {},
    groups: [],
    posts: [],
    schedule: [],
    history: [],
    media: [],
    leads: [],
    activity: [],
    errors: [],
    calendar: null,
  };
}

const MAX_LOG = 5000;

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    this.mediaDir = path.join(dir, 'media');
    fs.mkdirSync(this.mediaDir, { recursive: true });
    this.db = this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) {
      const db = defaultDb();
      this.db = db;
      this.save();
      return db;
    }
    const db = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    const base = defaultDb();
    for (const k of Object.keys(base)) if (db[k] === undefined) db[k] = base[k];
    db.settings = { ...base.settings, ...db.settings };
    return db;
  }

  /** כתיבה אטומית: קובץ זמני + rename, ושמירת גיבוי של הגרסה הקודמת */
  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    fs.renameSync(tmp, this.file);
  }

  nextId(prefix) {
    const n = (this.db.counters[prefix] || 0) + 1;
    this.db.counters[prefix] = n;
    return `${prefix}${String(n).padStart(4, '0')}`;
  }

  log(type, message, meta = {}, now = new Date()) {
    this.db.activity.push({ ts: new Date(now).toISOString(), type, message, meta });
    if (this.db.activity.length > MAX_LOG) this.db.activity.splice(0, this.db.activity.length - MAX_LOG);
  }

  error(source, message, meta = {}, now = new Date()) {
    this.db.errors.push({ ts: new Date(now).toISOString(), source, message, meta });
    if (this.db.errors.length > MAX_LOG) this.db.errors.splice(0, this.db.errors.length - MAX_LOG);
  }
}
