export const TZ = 'Asia/Jerusalem';

const dtf = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** פירוק תאריך לשעון ישראל */
export function israelParts(date) {
  const p = Object.fromEntries(dtf.formatToParts(new Date(date)).map((x) => [x.type, x.value]));
  return {
    year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second,
    weekday: WD[p.weekday], ymd: `${p.year}-${p.month}-${p.day}`,
  };
}

function offsetMinutes(date) {
  const p = israelParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** שעה מקומית בישראל (YYYY-MM-DD, שעה, דקה) → Date */
export function israelLocal(ymd, h = 0, mi = 0) {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetMinutes(new Date(guess)) * 60000;
  const off2 = offsetMinutes(new Date(t));
  t = guess - off2 * 60000;
  return new Date(t);
}

export function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export const MIN = 60000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
