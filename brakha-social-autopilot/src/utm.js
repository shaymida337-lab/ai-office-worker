import { BUSINESS, serviceById } from './business.js';

const MEDIUM = {
  facebook_group: ['facebook', 'group'],
  facebook_page: ['facebook', 'page'],
  instagram: ['instagram', 'social'],
  google_business: ['google', 'business_profile'],
  whatsapp_status: ['whatsapp', 'status'],
};

/** קישור לאתר עם UTM. utm_content = קוד הפוסט, כך שאפשר לשייך כל ביקור לפוסט. */
export function siteUrl({ serviceId, areaId, targetType = 'facebook_group', refCode, qa = false, now = new Date() }) {
  const svc = serviceById(serviceId);
  const [source, medium] = MEDIUM[targetType] || ['social', 'other'];
  const ym = new Date(now).toISOString().slice(0, 7).replace('-', '');
  const u = new URL(svc ? svc.landing : '/', BUSINESS.site);
  u.searchParams.set('utm_source', qa ? 'qa' : source);
  u.searchParams.set('utm_medium', qa ? 'qa' : medium);
  u.searchParams.set('utm_campaign', `${serviceId || 'general'}_${areaId || 'all'}_${ym}`);
  u.searchParams.set('utm_content', qa ? `qa-${refCode}` : refCode);
  return u.toString();
}

/** הודעת וואטסאפ מוכנה מראש, כוללת קוד מקור לזיהוי הליד */
export function whatsappText({ refCode }) {
  // קצר בכוונה — הקוד לבדו מזהה את הפוסט, השירות, האזור והקבוצה
  return `שלום, אשמח להצעת מחיר (קוד ${refCode})`;
}

export function whatsappUrl(text) {
  return `${BUSINESS.whatsappBase}?text=${encodeURIComponent(text)}`;
}
