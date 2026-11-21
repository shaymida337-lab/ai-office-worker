// פרטי העסק — מקור אמת יחיד. כל פנייה עסקית מופנית למספר הזה בלבד.
export const BUSINESS = Object.freeze({
  name: 'ברכה והצלחה שיפוצים',
  site: 'https://brakha-renovation.netlify.app',
  phoneDisplay: '054-442-7244',
  phoneE164: '972544427244',
  whatsappBase: 'https://wa.me/972544427244',
  slogan: 'מתחייבים למחיר הטוב ביותר!',
  priceDisclaimer: '* הבטחת המחיר כפופה להשוואת הצעות מחיר כתובות, באותו מפרט ובאותם תנאים.',
});

export const AREAS = Object.freeze([
  { id: 'ramat-gan', label: 'רמת גן' },
  { id: 'givatayim', label: 'גבעתיים' },
  { id: 'tel-aviv', label: 'תל אביב' },
  { id: 'holon', label: 'חולון' },
  { id: 'bat-yam', label: 'בת ים' },
  { id: 'kiryat-ono', label: 'קריית אונו' },
  { id: 'petah-tikva', label: 'פתח תקווה' },
]);

// דפי נחיתה קיימים באתר (קריאה בלבד — האתר לא משתנה)
export const SERVICES = Object.freeze([
  { id: 'paint', label: 'צביעת דירות וחדרים', landing: '/paint/' },
  { id: 'general', label: 'שיפוצים כלליים', landing: '/services/apartment-renovation/' },
  { id: 'bathroom', label: 'שיפוץ אמבטיות', landing: '/services/bathroom-renovation/' },
  { id: 'kitchen', label: 'שיפוץ מטבחים', landing: '/services/kitchen-renovation/' },
  { id: 'flooring-gypsum', label: 'ריצוף וגבס', landing: '/services/paint-gypsum/' },
]);

// סוגי ערוצים. auto=true רק כשיש API רשמי שמאפשר פרסום (דף עסקי בפייסבוק).
export const TARGET_TYPES = Object.freeze({
  facebook_group: { label: 'קבוצת פייסבוק', auto: false, why: 'Meta הסירה את Groups API באפריל 2024 — אין פרסום אוטומטי רשמי לקבוצות. הפוסט מוכן ונפתח לפרסום ידני.' },
  facebook_page: { label: 'דף עסקי בפייסבוק', auto: true, why: 'פרסום רשמי דרך Graph API עם הרשאת pages_manage_posts של מנהל הדף.' },
  instagram: { label: 'אינסטגרם', auto: false, why: 'דורש חשבון Business מחובר לדף ותמונה בכתובת ציבורית — לא מחובר כרגע. פרסום ידני.' },
  google_business: { label: 'פרופיל עסק בגוגל', auto: false, why: 'API לפוסטים דורש אישור גישה מגוגל — לא מחובר. פרסום ידני.' },
  whatsapp_status: { label: 'סטטוס וואטסאפ', auto: false, why: 'אין API רשמי לסטטוס. פרסום ידני מהטלפון.' },
});

export const serviceById = (id) => SERVICES.find((s) => s.id === id);
export const areaById = (id) => AREAS.find((a) => a.id === id);
