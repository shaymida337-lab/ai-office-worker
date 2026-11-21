// פרסום רשמי בלבד. אין כאן אוטומציית דפדפן, אין התחזות לאדם ואין עקיפת מגבלות.
import fs from 'node:fs';

/** האם פרסום חי מותר? שלושה מפתחות נפרדים חייבים להיות פתוחים. */
export function liveStatus(settings, env = process.env) {
  const missing = [];
  if (settings.mode !== 'live') missing.push('המערכת במצב סימולציה');
  if (!settings.liveConfirmedAt) missing.push('לא ניתן אישור מפורש לפרסום חי בממשק');
  if (env.BRAKHA_ALLOW_LIVE !== '1') missing.push('BRAKHA_ALLOW_LIVE=1 לא מוגדר בקובץ .env');
  if (!env.FB_PAGE_ID) missing.push('FB_PAGE_ID חסר');
  if (!env.FB_PAGE_ACCESS_TOKEN) missing.push('FB_PAGE_ACCESS_TOKEN חסר');
  return { ready: missing.length === 0, missing };
}

/** פרסום לדף עסקי דרך Graph API (הרשאת pages_manage_posts). תמונה — דרך /photos. */
export async function publishFacebookPage({ message, imagePath, apiVersion = 'v23.0', env = process.env, fetchImpl = globalThis.fetch }) {
  const pageId = env.FB_PAGE_ID;
  const token = env.FB_PAGE_ACCESS_TOKEN;
  const base = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(pageId)}`;
  let res;
  if (imagePath) {
    const fd = new FormData();
    fd.append('caption', message);
    fd.append('access_token', token);
    fd.append('source', new Blob([fs.readFileSync(imagePath)]), 'image');
    res = await fetchImpl(`${base}/photos`, { method: 'POST', body: fd });
  } else {
    res = await fetchImpl(`${base}/feed`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message, access_token: token }),
    });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const m = json.error ? `${json.error.type || 'Error'} ${json.error.code || ''}: ${json.error.message}` : `HTTP ${res.status}`;
    throw new Error(`פייסבוק דחה את הפרסום — ${m}`);
  }
  const id = json.post_id || json.id;
  return { externalId: id, url: id ? `https://www.facebook.com/${id}` : null };
}
