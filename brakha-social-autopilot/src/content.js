import crypto from 'node:crypto';
import { BUSINESS, AREAS, SERVICES, serviceById, areaById } from './business.js';
import { siteUrl, whatsappText, whatsappUrl } from './utm.js';

// תבניות כלליות בלבד: מה אנחנו מציעים ואיך עובדים.
// אין כאן המלצות, עבודות שבוצעו, תוצאות או מספרים מומצאים.
const T = {
  paint: {
    openers: [
      'מתכננים לצבוע את הדירה, או רק חדר אחד?',
      'הקירות צריכים רענון? צבע חדש משנה את כל התחושה בבית.',
      'צביעת דירה שלמה או חדר בודד — עושים את זה מסודר ונקי.',
      'עוברים דירה או רוצים לרענן את הבית? זה הזמן לצבע.',
    ],
    points: [
      'הכנת קירות: תיקון סדקים, שפכטל ושיוף',
      'כיסוי והגנה על רצפות ורהיטים לפני העבודה',
      'צביעת קירות, תקרות, דלתות ומשקופים',
      'התאמת סוג הצבע לחדר — סלון, חדר ילדים, חדרים רטובים',
      'ניקיון בסיום העבודה',
    ],
  },
  general: {
    openers: [
      'חושבים על שיפוץ לדירה ולא יודעים מאיפה להתחיל?',
      'שיפוץ דירה כולל — עם קבלן אחד שמרכז את כל העבודה.',
      'קניתם דירה ורוצים להתאים אותה אליכם?',
      'רוצים לשפץ בלי לרדוף אחרי חמישה בעלי מקצוע שונים?',
    ],
    points: [
      'פגישה ומדידות אצלכם בבית',
      'הצעת מחיר כתובה ומפורטת לפי סעיפים',
      'תיאום כל העבודות: חשמל, אינסטלציה, ריצוף, גבס וצבע',
      'לוח זמנים מוסכם מראש',
      'שמירה על ניקיון וסדר במהלך העבודה',
    ],
  },
  bathroom: {
    openers: [
      'חדר האמבטיה צריך שיפוץ?',
      'רוצים להחליף אמבטיה במקלחון?',
      'שיפוץ חדר רחצה — מהפירוק ועד התקנת הכלים.',
      'נמאס לכם מחדר הרחצה הישן? אפשר לחדש אותו מהיסוד.',
    ],
    points: [
      'פירוק ופינוי הקיים',
      'איטום רצפה וקירות באזור הרטוב',
      'החלפת צנרת לפי הצורך',
      'ריצוף וחיפוי קירות',
      'התקנת כלים סניטריים, ארון ומקלחון',
      'החלפת אמבטיה במקלחון',
    ],
  },
  kitchen: {
    openers: [
      'מתכננים מטבח חדש?',
      'שיפוץ מטבח — עם תיאום מלא מהפירוק ועד הגימור.',
      'רוצים לחדש את המטבח בלי כאב ראש?',
    ],
    points: [
      'פירוק המטבח הישן ופינוי',
      'הכנות חשמל ואינסטלציה לפי התכנון',
      'ריצוף וחיפוי קירות בין הארונות',
      'תיאום מול ספק המטבח לקראת ההתקנה',
      'צבע וגימורים בסיום',
    ],
  },
  'flooring-gypsum': {
    openers: [
      'צריכים ריצוף חדש או עבודות גבס?',
      'ריצוף, תקרות גבס, קירות גבס ונישות — הכול במקום אחד.',
      'רוצים לחלק חדר, להוסיף נישה או להחליף ריצוף?',
    ],
    points: [
      'החלפת ריצוף בדירה או בחדר בודד',
      'ריצוף מרפסות',
      'תקרות גבס והכנה לתאורה שקועה',
      'קירות גבס לחלוקת חדרים',
      'נישות וספריות גבס',
      'פנלים וגימורים',
    ],
  },
};

const AREA_LINES = [
  (a) => `📍 נותנים שירות ב${a.label} ובערים הסמוכות.`,
  (a) => `📍 גרים ב${a.label}? אנחנו עובדים אצלכם באזור.`,
  (a, others) => `📍 אזורי שירות: ${[a.label, ...others].join(', ')}.`,
];

const CTA_LINK = [
  (wa) => `לתיאום הצעת מחיר בוואטסאפ 👇\n${wa}`,
  (wa) => `שלחו לנו הודעה בוואטסאפ ונחזור אליכם:\n${wa}`,
  (wa) => `רוצים הצעת מחיר? כתבו לנו בוואטסאפ:\n${wa}`,
];

// PRNG דטרמיניסטי — כדי שאותו seed ייתן אותו פוסט (בדיקות) וseed שונה ייתן וריאציה.
function rng(seed) {
  let x = crypto.createHash('sha256').update(String(seed)).digest().readUInt32LE(0) || 1;
  return () => {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return x / 0x100000000;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
function pickN(r, arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

/**
 * בונה טקסט פוסט.
 * opts: serviceId, areaId, refCode, seed, allowLinks (ברירת מחדל true), includeSite, targetType, mediaIllustration
 */
export function buildPost(opts) {
  const { serviceId, areaId, refCode, seed = refCode, allowLinks = true, includeSite = false, targetType = 'facebook_group', mediaIllustration = false, now = new Date() } = opts;
  const svc = serviceById(serviceId);
  const area = areaById(areaId);
  if (!svc) throw new Error(`שירות לא מוכר: ${serviceId}`);
  if (!area) throw new Error(`אזור לא מוכר: ${areaId}`);
  const r = rng(`${serviceId}|${areaId}|${seed}`);
  const t = T[serviceId];
  const others = AREAS.filter((a) => a.id !== areaId).map((a) => a.label);

  const lines = [];
  lines.push(`${pick(r, t.openers)}`);
  lines.push('');
  lines.push(`${BUSINESS.name} — ${svc.label}:`);
  const chosen = new Set(pickN(r, t.points, 3 + Math.floor(r() * 2)));
  for (const p of t.points.filter((x) => chosen.has(x))) lines.push(`✔️ ${p}`); // שומר על סדר לוגי
  lines.push('');
  lines.push(pick(r, AREA_LINES)(area, pickN(r, others, 3)));
  lines.push('');
  lines.push(`💰 ${BUSINESS.slogan}`);
  lines.push(BUSINESS.priceDisclaimer);
  lines.push('');

  const wa = whatsappUrl(whatsappText({ serviceId, areaId, refCode }));
  if (allowLinks) {
    lines.push(pick(r, CTA_LINK)(wa));
    lines.push(`או בטלפון: ${BUSINESS.phoneDisplay}`);
    if (includeSite) lines.push(`פרטים נוספים באתר: ${siteUrl({ serviceId, areaId, targetType, refCode, now })}`);
  } else {
    lines.push(`📲 וואטסאפ או טלפון: ${BUSINESS.phoneDisplay}`);
    lines.push(`כשאתם פונים, ציינו קוד ${refCode} 🙂`);
  }
  if (mediaIllustration) lines.push('', '(התמונה להמחשה בלבד)');
  return lines.join('\n');
}

// ---------- בדיקת תוכן (Lint) ----------
const FORBIDDEN = [
  { re: /לקוח(ות|ים)?\s+מרוצ/u, msg: 'טענת "לקוחות מרוצים" — אסור להמציא המלצות' },
  { re: /המלצ(ה|ות)\s+(של|מ)/u, msg: 'ציטוט/המלצת לקוח — אסור להמציא' },
  { re: /לפני\s*(ו|\/|-)\s*אחרי/u, msg: '"לפני/אחרי" — מותר רק עם תמונות אמיתיות שאושרו, לא בטקסט אוטומטי' },
  { re: /(ביצענו|סיימנו|השלמנו)\s/u, msg: 'טענה על עבודה שבוצעה — אסור להמציא עבודות' },
  { re: /★|⭐|5\s*כוכבים|דירוג/u, msg: 'דירוג/כוכבים — אסור להמציא ביקורות' },
  { re: /\d{2,}\s*(\+\s*)?(שנות|שנים של)\s*ניסיון/u, msg: 'מספר שנות ניסיון — יש לאמת לפני שימוש' },
  { re: /הכי\s+זול|הזול\s+ביותר/u, msg: 'טענת "הכי זול" — השתמשו רק במסר המאושר + הסייג' },
  { re: /מבצע\s+מוגבל|רק\s+היום|נשארו\s+\d+/u, msg: 'לחץ שיווקי מומצא (דחיפות מזויפת)' },
];

const OUR_PHONE_DIGITS = '0544427244';

export function lintPost(text) {
  const errors = [];
  const t = String(text || '');
  if (!t.trim()) errors.push('טקסט ריק');
  const hasWa = t.includes(BUSINESS.whatsappBase);
  const hasPhone = t.includes(BUSINESS.phoneDisplay) || t.replace(/\D/g, '').includes(OUR_PHONE_DIGITS);
  if (!hasWa && !hasPhone) errors.push('חסרה הנעה לפנייה (וואטסאפ / 054-442-7244)');

  // כל מספר טלפון אחר — אסור (כל הפניות למספר אחד)
  const phones = t.match(/(?:\+?972[-\s]?|0)(?:[2-9]\d?)[-\s]?\d{3}[-\s]?\d{4}/g) || [];
  for (const p of phones) {
    const d = p.replace(/\D/g, '').replace(/^972/, '0');
    if (d !== OUR_PHONE_DIGITS) errors.push(`מספר טלפון זר בפוסט: ${p}`);
  }
  const waLinks = t.match(/wa\.me\/\d+/g) || [];
  for (const w of waLinks) if (w !== `wa.me/${BUSINESS.phoneE164}`) errors.push(`קישור וואטסאפ למספר אחר: ${w}`);

  if (/מחיר\s+הטוב\s+ביותר|מחיר\s+הכי\s+טוב|מחיר\s+הנמוך\s+ביותר/u.test(t) && !t.includes('כפופה להשוואת הצעות')) {
    errors.push('הבטחת מחיר בלי הסייג (השוואת הצעות כתובות באותו מפרט ובאותם תנאים)');
  }
  for (const f of FORBIDDEN) if (f.re.test(t)) errors.push(f.msg);
  return { ok: errors.length === 0, errors };
}

/** נרמול לזיהוי כפילויות — מתעלם מקודי מקור, קישורים, אמוג'י ורווחים */
export function textHash(text) {
  const norm = String(text)
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\(קוד [A-Z0-9-]+\)|קוד [A-Z0-9-]+/g, '')
    .replace(/[\p{Extended_Pictographic}️]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

export { SERVICES, AREAS };
