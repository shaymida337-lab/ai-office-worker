// חיבור לדף העסקי בפייסבוק דרך Graph API הרשמי — בדיקת הרשאות בלבד (GET).
// אין כאן שום פעולת כתיבה. פרסום חי נשאר חסום עד אישור מפורש (ראו publishers.js).
import fs from 'node:fs';
import path from 'node:path';

export const REQUIRED_SCOPES = ['pages_manage_posts', 'pages_read_engagement'];
export const RECOMMENDED_SCOPES = ['pages_show_list'];

// ---------- סודות מקומיים (לא בגיט, לא בגיבוי, לא חוזרים לממשק) ----------
export function secretsFile(dataDir) { return path.join(dataDir, 'secrets.json'); }

export function readSecrets(dataDir) {
  try { return JSON.parse(fs.readFileSync(secretsFile(dataDir), 'utf8')); } catch { return {}; }
}

export function writeSecrets(dataDir, patch) {
  const cur = readSecrets(dataDir);
  const next = { ...cur, ...patch };
  for (const k of Object.keys(next)) if (next[k] === null || next[k] === '') delete next[k];
  const f = secretsFile(dataDir);
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(`${f}.tmp`, f);
  try { fs.chmodSync(f, 0o600); } catch { /* Windows */ }
  return next;
}

/** ‏env מתוך .env גובר; אחרת מה שנשמר בממשק המקומי */
export function effectiveEnv(env, dataDir) {
  const s = readSecrets(dataDir);
  return { ...env, FB_PAGE_ID: env.FB_PAGE_ID || s.FB_PAGE_ID, FB_PAGE_ACCESS_TOKEN: env.FB_PAGE_ACCESS_TOKEN || s.FB_PAGE_ACCESS_TOKEN };
}

export const mask = (t) => (t ? `${String(t).slice(0, 4)}…${String(t).slice(-4)} (${String(t).length} תווים)` : null);

async function get(fetchImpl, url) {
  const res = await fetchImpl(url, { method: 'GET' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) {
    const e = j.error || {};
    const err = new Error(`${e.message || `HTTP ${res.status}`}${e.code ? ` (קוד ${e.code})` : ''}`);
    err.code = e.code;
    throw err;
  }
  return j;
}

/**
 * בדיקת חיבור והרשאות. מחזיר דוח בעברית; לא זורק.
 * תומך בטוקן של דף (Page) או של משתמש (User) שמנהל את הדף.
 */
export async function checkFacebook({ pageId, token, apiVersion = 'v23.0', fetchImpl = globalThis.fetch }) {
  const out = { checkedAt: new Date().toISOString(), ok: false, steps: [], tokenType: null, scopes: [], missingScopes: [], page: null, canCreateContent: null, expiresAt: null, liveEnabled: false };
  const step = (ok, msg) => out.steps.push({ ok, msg });
  if (!token) { step(false, 'לא הוגדר טוקן — הוסיפו אותו בטופס המקומי בהגדרות או בקובץ .env'); return out; }
  const G = `https://graph.facebook.com/${apiVersion}`;
  const q = (p) => `${G}/${p}${p.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;

  // 1. תוקף הטוקן וההרשאות
  try {
    const d = (await get(fetchImpl, `${G}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`)).data || {};
    out.tokenType = d.type || null;
    out.scopes = d.scopes || [];
    out.expiresAt = d.expires_at ? new Date(d.expires_at * 1000).toISOString() : (d.expires_at === 0 ? 'ללא תפוגה' : null);
    if (d.is_valid === false) step(false, 'הטוקן אינו בתוקף (פג או בוטל) — צרו טוקן חדש');
    else step(true, `טוקן בתוקף · סוג: ${d.type || 'לא ידוע'}${out.expiresAt ? ` · תפוגה: ${out.expiresAt}` : ''}`);
  } catch (e) {
    step(false, `לא ניתן לבדוק את הטוקן (debug_token): ${e.message}`);
  }

  // 2. זהות + גישה לדף
  try {
    const me = await get(fetchImpl, q('me?fields=id,name'));
    if (!out.tokenType) out.tokenType = pageId && me.id === pageId ? 'PAGE' : null;
    if (out.tokenType === 'PAGE' || (pageId && me.id === pageId)) {
      out.page = { id: me.id, name: me.name };
      step(!pageId || me.id === pageId, pageId && me.id !== pageId ? `הטוקן שייך לדף אחר (${me.name}, ${me.id}) ולא ל-${pageId}` : `טוקן של הדף: ${me.name}`);
    } else {
      step(true, `טוקן של המשתמש: ${me.name}`);
      const acc = await get(fetchImpl, q('me/accounts?fields=id,name,tasks&limit=100'));
      const pages = acc.data || [];
      const p = pageId ? pages.find((x) => x.id === pageId) : pages.find((x) => /ברכה|brakha/i.test(x.name)) || null;
      if (!p) step(false, pageId ? `המשתמש אינו מנהל את הדף ${pageId}` : `לא נמצא דף מתאים בין ${pages.length} הדפים שהמשתמש מנהל`);
      else {
        out.page = { id: p.id, name: p.name, tasks: p.tasks || [] };
        out.canCreateContent = (p.tasks || []).includes('CREATE_CONTENT');
        step(out.canCreateContent, out.canCreateContent ? `למשתמש יש הרשאת יצירת תוכן בדף ${p.name}` : `למשתמש אין הרשאת CREATE_CONTENT בדף ${p.name}`);
      }
      if (!out.scopes.length) {
        try { out.scopes = (await get(fetchImpl, q('me/permissions'))).data.filter((x) => x.status === 'granted').map((x) => x.permission); } catch { /* לא קריטי */ }
      }
    }
  } catch (e) {
    step(false, `קריאת פרטי החשבון נכשלה: ${e.message}`);
  }

  // 3. פרטי הדף (קריאה בלבד)
  const pid = out.page?.id || pageId;
  if (pid) {
    try {
      const p = await get(fetchImpl, q(`${encodeURIComponent(pid)}?fields=id,name,link,category`));
      out.page = { ...(out.page || {}), id: p.id, name: p.name, link: p.link, category: p.category };
      step(true, `הדף נגיש: ${p.name}${p.category ? ` (${p.category})` : ''}`);
    } catch (e) {
      step(false, `לא ניתן לקרוא את הדף ${pid}: ${e.message}`);
    }
  }

  out.missingScopes = REQUIRED_SCOPES.filter((s) => !out.scopes.includes(s));
  if (out.scopes.length) step(out.missingScopes.length === 0, out.missingScopes.length ? `חסרות הרשאות: ${out.missingScopes.join(', ')}` : `כל ההרשאות הנדרשות קיימות (${REQUIRED_SCOPES.join(', ')})`);
  else step(false, 'לא ניתן היה לקרוא את רשימת ההרשאות');
  out.ok = out.steps.every((s) => s.ok) && !!out.page;
  return out;
}
