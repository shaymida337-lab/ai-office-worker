import { guardAt } from './calendar.js';
import { lintPost, textHash } from './content.js';
import { israelParts, DAY, MIN } from './time.js';
import { TARGET_TYPES } from './business.js';

// retryable=true → הפריט נדחה וייבדק שוב (למשל אחרי צאת שבת). false → נחסם ודורש טיפול.
const R = (code, msg, retryable, resumeAt) => ({ code, msg, retryable, resumeAt });

/** היסטוריה רלוונטית למצב: בסימולציה — הכול; במצב חי — רק פרסומים אמיתיים (ידני/חי) */
function relevantHistory(db) {
  return db.settings.mode === 'live' ? db.history.filter((h) => h.mode !== 'simulation') : db.history;
}

/** בדיקת שבת/חג, שעות פעילות ועצירת חירום — חלה גם על פניות ללידים */
export function outreachGuard(db, now = new Date()) {
  const reasons = [];
  if (db.settings.killSwitch) reasons.push(R('KILL_SWITCH', 'עצירת חירום פעילה — כל הפרסומים מושבתים', true));
  const g = guardAt(db.calendar, now, db.settings);
  if (!g.allowed) reasons.push(R(g.verified ? 'SHABBAT_HOLIDAY' : 'CALENDAR_UNVERIFIED', g.reason, true, g.resumeAt));
  const { start, end } = db.settings.postingHours || { start: 8, end: 21 };
  const h = israelParts(now).hour;
  if (h < start || h >= end) reasons.push(R('OUTSIDE_HOURS', `מחוץ לשעות הפעילות (${start}:00–${end}:00)`, true));
  return { allowed: reasons.length === 0, reasons, calendar: g };
}

/**
 * כל הבדיקות לפני פרסום פריט מתוזמן.
 * opts.phase: 'auto' (מתזמן) | 'manual_open' (המשתמש פותח קבוצה)
 */
export function evaluatePublish(db, { item, post, target, now = new Date() }) {
  const reasons = [...outreachGuard(db, now).reasons];
  if (!post) return { ok: false, reasons: [...reasons, R('NO_POST', 'הפוסט נמחק', false)] };
  if (!target) return { ok: false, reasons: [...reasons, R('NO_TARGET', 'הקבוצה/ערוץ נמחקו', false)] };
  if (!TARGET_TYPES[target.type]) reasons.push(R('BAD_TARGET', 'סוג ערוץ לא מוכר', false));
  if (target.status !== 'active') reasons.push(R('TARGET_PAUSED', 'הקבוצה/ערוץ מושהים', false));
  if (target.type === 'facebook_group' && !target.rulesReviewed) {
    reasons.push(R('RULES_NOT_REVIEWED', 'לא אושר שכללי הקבוצה מתירים פרסום עסקי', false));
  }
  if (post.status !== 'approved') reasons.push(R('NOT_APPROVED', 'הפוסט ממתין לאישור שלך', true));
  const lint = lintPost(post.text);
  if (!lint.ok) reasons.push(R('LINT', `בעיות תוכן: ${lint.errors.join('; ')}`, false));

  const t = new Date(now).getTime();
  const hash = textHash(post.text);
  const hist = relevantHistory(db);
  const s = db.settings;

  const sameTarget = hist.find((h) => h.targetId === target.id && h.textHash === hash && t - Date.parse(h.ts) < s.sameTargetDupDays * DAY);
  if (sameTarget) reasons.push(R('DUP_SAME_TARGET', `טקסט זהה כבר פורסם בערוץ הזה ב-${sameTarget.ts.slice(0, 10)}`, false));
  const anyTarget = hist.find((h) => h.targetId !== target.id && h.textHash === hash && t - Date.parse(h.ts) < s.anyTargetDupDays * DAY);
  if (anyTarget) reasons.push(R('DUP_ANY_TARGET', `טקסט זהה פורסם בערוץ אחר ב-${anyTarget.ts.slice(0, 10)} — צרו וריאציה`, false));
  const dupItem = db.schedule.find((x) => x.id !== item?.id && x.targetId === target.id && x.postId === post.id && ['awaiting_manual', 'published', 'published_manual', 'simulated'].includes(x.status));
  if (dupItem) reasons.push(R('DUP_SCHEDULE', `הפוסט הזה כבר טופל בערוץ הזה (${dupItem.id})`, false));

  const lastHere = hist.filter((h) => h.targetId === target.id).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0];
  const minDays = Number(target.minDaysBetweenPosts ?? 7);
  if (lastHere && t - Date.parse(lastHere.ts) < minDays * DAY) {
    const resume = new Date(Date.parse(lastHere.ts) + minDays * DAY).toISOString();
    reasons.push(R('TARGET_FREQUENCY', `תדירות: מותר פוסט אחד כל ${minDays} ימים בערוץ הזה`, true, resume));
  }
  const today = israelParts(now).ymd;
  const todayCount = hist.filter((h) => israelParts(new Date(h.ts)).ymd === today).length;
  if (todayCount >= s.dailyCap) reasons.push(R('DAILY_CAP', `הגעתם למכסה היומית (${s.dailyCap} פרסומים)`, true));
  const last = hist.map((h) => Date.parse(h.ts)).sort((a, b) => b - a)[0];
  if (last && t - last < s.minMinutesBetweenPosts * MIN) {
    reasons.push(R('MIN_GAP', `מרווח מינימלי של ${s.minMinutesBetweenPosts} דקות בין פרסומים`, true, new Date(last + s.minMinutesBetweenPosts * MIN).toISOString()));
  }
  return { ok: reasons.length === 0, reasons, hash };
}
