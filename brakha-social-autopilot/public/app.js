// ממשק ניהול — JavaScript נקי, ללא תלויות חיצוניות.
const TABS = [
  ['home', 'לוח בקרה'], ['groups', 'קבוצות וערוצים'], ['posts', 'פוסטים מוכנים'], ['schedule', 'לוח פרסומים'],
  ['media', 'תמונות וסרטונים'], ['leads', 'לידים'], ['stats', 'סטטיסטיקות'], ['history', 'היסטוריה ושגיאות'], ['settings', 'הגדרות וחיבורים'],
];
let S = null;
let tab = (() => { try { return localStorage.getItem('tab') || 'home'; } catch { return 'home'; } })();
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (iso) => iso ? new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';
const svc = (id) => S.services.find((s) => s.id === id)?.label || '—';
const area = (id) => S.areas.find((a) => a.id === id)?.label || '—';
const grp = (id) => S.groups.find((g) => g.id === id);

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error || `שגיאה ${res.status}`); e.reasons = j.reasons; throw e; }
  return j;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3500); }
function showError(e) { toast(e.reasons ? `${e.message}: ${e.reasons.map((r) => r.msg).join(' | ')}` : e.message); }
async function refresh() { S = await api('GET', '/api/state'); render(); }
async function act(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg); await refresh(); } catch (e) { showError(e); } }

function statusBadge(s) {
  const cls = { simulated: 'ok', published: 'ok', published_manual: 'ok', awaiting_manual: 'warn', deferred: 'warn', blocked: 'bad', failed: 'bad', cancelled: '', skipped: '', scheduled: '' }[s.status] ?? '';
  return `<span class="badge ${cls}">${esc(s.statusLabel)}</span>`;
}

function renderTop() {
  const live = S.settings.mode === 'live';
  $('#modeBadge').className = `badge ${live ? 'bad' : 'ok'}`;
  $('#modeBadge').textContent = live ? '⚠️ מצב פרסום חי' : '🧪 מצב סימולציה';
  const g = S.guard;
  const cal = g.calendar;
  $('#guardBadge').className = `badge ${cal.allowed ? 'ok' : 'warn'}`;
  $('#guardBadge').textContent = cal.allowed ? '✡ אין שבת/חג כרגע' : `✡ ${cal.verified ? 'שבת/חג — חסום' : 'לא מאומת — חסום'}`;
  const k = $('#killBtn');
  k.textContent = S.settings.killSwitch ? '▶️ הפעל פרסומים מחדש' : '⛔ עצור את כל הפרסומים';
  k.className = `btn kill${S.settings.killSwitch ? ' resume' : ''}`;
}

function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([id, l]) => {
    const n = id === 'home' ? S.stats.posts.awaitingManual : 0;
    return `<button role="tab" data-tab="${id}" aria-selected="${tab === id}">${l}${n ? ` <span class="badge warn">${n}</span>` : ''}</button>`;
  }).join('');
}

const V = {};

V.home = () => {
  const st = S.stats; const g = S.guard;
  const tasks = S.schedule.filter((s) => s.status === 'awaiting_manual');
  return `
  ${S.settings.killSwitch ? '<div class="notice bad">⛔ עצירת חירום פעילה — שום דבר לא יפורסם, גם לא בסימולציה. לחצו "הפעל פרסומים מחדש" כדי לחדש.</div><br>' : ''}
  <div class="tiles">
    ${tile(st.leads.thisMonth, 'לידים אמיתיים החודש')}${tile(st.leads.last7, 'לידים ב-7 ימים')}
    ${tile(st.posts.publishedThisMonth, 'פרסומים אמיתיים החודש')}${tile(st.posts.simulated, 'פרסומי סימולציה')}
    ${tile(st.posts.upcoming, 'פרסומים מתוזמנים')}${tile(st.posts.drafts, 'טיוטות לאישור')}
  </div>
  <div class="grid">
    <section class="card">
      <h2>משימות לפרסום ידני (${tasks.length})</h2>
      ${tasks.length ? tasks.map(taskRow).join('') : '<p class="muted">אין משימות כרגע. המתזמן יעביר לכאן פוסטים לקבוצות כשיגיע מועדם ויעברו את כל הבדיקות.</p>'}
    </section>
    <section class="card">
      <h2>שבת וחגים — רמת גן</h2>
      <p><b>${g.calendar.allowed ? '<span class="okc">מותר לפרסם עכשיו</span>' : `<span class="err">${esc(g.calendar.reason)}</span>`}</b></p>
      ${g.reasons.filter((r) => r.code !== 'SHABBAT_HOLIDAY' && r.code !== 'CALENDAR_UNVERIFIED').map((r) => `<p class="small err">• ${esc(r.msg)}</p>`).join('')}
      ${S.calendar ? `<table><tr><th>מה</th><th>חסום מ-</th><th>עד</th></tr>${S.calendar.upcoming.map((w) => `<tr><td>${esc(w.label)}</td><td>${fmt(w.start)}</td><td>${fmt(w.end)}</td></tr>`).join('')}</table>
        <p class="small muted">מקור: ${esc(S.calendar.source)} · עודכן ${fmt(S.calendar.fetchedAt)} · כולל ${S.settings.shabbatMarginBeforeMin} דק' לפני הדלקת נרות ו-${S.settings.shabbatMarginAfterMin} דק' אחרי הבדלה</p>`
        : '<p class="err">אין עדיין לוח מאומת. כל הפרסומים חסומים עד לעדכון מוצלח.</p>'}
      <button class="btn sm" data-action="calRefresh">עדכן לוח עכשיו</button>
    </section>
    <section class="card">
      <h2>שגיאות אחרונות</h2>
      ${S.errors.slice(0, 5).map((e) => `<p class="small"><span class="muted">${fmt(e.ts)}</span> · ${esc(e.message)}</p>`).join('') || '<p class="muted">אין שגיאות.</p>'}
    </section>
    <section class="card">
      <h2>התחלה מהירה</h2>
      <ol class="small">
        <li>הוסיפו קבוצות פייסבוק שאתם חברים בהן (לשונית "קבוצות וערוצים") ואשרו שכללי הקבוצה מתירים פרסום עסקי.</li>
        <li>לחצו "תכנן שבוע" בלוח הפרסומים — נוצרות טיוטות ומועדים שמדלגים על שבת וחג.</li>
        <li>קראו ואשרו את הטיוטות.</li>
        <li>כשמגיע המועד, המשימה תופיע כאן: "העתק ופתח" ← הדביקו בקבוצה ← "סמנו כפורסם".</li>
        <li>כשמישהו פונה בוואטסאפ, רשמו ליד (הקוד בהודעה משייך אותו לפוסט ולקבוצה).</li>
      </ol>
    </section>
  </div>`;
};
const tile = (v, l) => `<div class="tile"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`;
function taskRow(s) {
  const g = grp(s.targetId); const p = S.posts.find((x) => x.id === s.postId);
  return `<div class="card" style="margin-bottom:10px">
    <div class="row"><b>${esc(g?.name || '?')}</b><span class="badge">${esc(S.targetTypes[g?.type]?.label || '')}</span><span class="muted small">${esc(s.id)} · ${fmt(s.dueAt)}</span></div>
    <div class="post-text small" style="max-height:120px;margin:8px 0">${esc(p?.text || '')}</div>
    <div class="row">
      <button class="btn accent sm" data-action="openTask" data-id="${s.id}">📋 העתק ופתח</button>
      <button class="btn sm" data-action="markTask" data-id="${s.id}" ${s.openedAt ? '' : 'disabled title="לחצו קודם העתק ופתח"'}>✔ סמנו כפורסם</button>
      <button class="btn sm danger" data-action="skipTask" data-id="${s.id}">דלג</button>
    </div></div>`;
}

const checks = (name, items, sel = []) => items.map((x) => `<label class="chk"><input type="checkbox" name="${name}" value="${x.id}" ${sel.includes(x.id) ? 'checked' : ''}>${esc(x.label)}</label>`).join('');
const options = (items, sel, empty) => `${empty ? `<option value="">${esc(empty)}</option>` : ''}${items.map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}`;
const typeOptions = (sel) => Object.entries(S.targetTypes).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(v.label)}${v.auto ? ' (אוטומטי)' : ' (ידני)'}</option>`).join('');

function groupForm(g = {}) {
  return `<form class="f" data-form="${g.id ? `groupEdit:${g.id}` : 'groupAdd'}">
    <label>שם הקבוצה/הערוץ<input name="name" required value="${esc(g.name)}"></label>
    <label>סוג<select name="type">${typeOptions(g.type || 'facebook_group')}</select></label>
    <label class="full">קישור (https://...)<input name="url" dir="ltr" value="${esc(g.url)}" placeholder="https://www.facebook.com/groups/..."></label>
    <div class="full"><div class="small muted">אזורים</div><div class="row">${checks('areas', S.areas, g.areas || [])}</div></div>
    <div class="full"><div class="small muted">שירותים לפרסום (ריק = כולם, בסבב)</div><div class="row">${checks('services', S.services, g.services || [])}</div></div>
    <label>מינימום ימים בין פוסטים<input type="number" name="minDaysBetweenPosts" min="1" max="90" value="${esc(g.minDaysBetweenPosts ?? 7)}"></label>
    <label>שעה מועדפת<input type="number" name="preferredHour" min="8" max="20" value="${esc(g.preferredHour ?? 10)}"></label>
    <label>מצב<select name="status"><option value="active" ${g.status !== 'paused' ? 'selected' : ''}>פעיל</option><option value="paused" ${g.status === 'paused' ? 'selected' : ''}>מושהה</option></select></label>
    <label class="full">כללי הקבוצה (העתיקו מהקבוצה)<textarea name="rulesText" style="min-height:70px">${esc(g.rulesText)}</textarea></label>
    <label class="chk"><input type="checkbox" name="allowLinks" ${g.allowLinks !== false ? 'checked' : ''}>הקבוצה מתירה קישורים</label>
    <label class="chk"><input type="checkbox" name="autoPlan" ${g.autoPlan !== false ? 'checked' : ''}>כלול בתכנון אוטומטי</label>
    <label class="chk full"><input type="checkbox" name="rulesReviewed" ${g.rulesReviewed ? 'checked' : ''}><b>קראתי את כללי הקבוצה, ופרסום עסקי מותר בה</b></label>
    <label class="full">הערות<input name="notes" value="${esc(g.notes)}"></label>
    <div class="full row"><button class="btn primary">${g.id ? 'שמירה' : 'הוספה'}</button>${g.id ? '<button type="button" class="btn" data-action="closeDlg">ביטול</button>' : ''}</div>
  </form>`;
}

V.groups = () => {
  const q = ['שיפוצים', 'דירות להשכרה', 'קבוצת שכונה', 'הורים', 'יד שנייה'];
  return `<div class="grid">
  <section class="card"><h2>הוספת קבוצה / ערוץ</h2>${groupForm()}</section>
  <section class="card"><h2>איך למצוא קבוצות מתאימות</h2>
    <p class="small">הצטרפו בעצמכם לקבוצות מקומיות פעילות. המערכת לא מצטרפת לקבוצות ולא שולחת בקשות בשמכם.</p>
    <div class="small">${S.areas.map((a) => `<div>${esc(a.label)}: ${q.map((w) => `<a target="_blank" rel="noopener" href="https://www.facebook.com/search/groups/?q=${encodeURIComponent(`${w} ${a.label}`)}">${esc(w)}</a>`).join(' · ')}</div>`).join('')}</div>
    <p class="small muted">${esc(S.targetTypes.facebook_group.why)}</p>
  </section></div><br>
  <section class="card"><h2>הקבוצות שלי (${S.groups.length})</h2><div class="tablewrap"><table>
    <tr><th>שם</th><th>סוג</th><th>אזורים</th><th>תדירות</th><th>כללים</th><th>פרסומים</th><th>לידים</th><th>מצב</th><th></th></tr>
    ${S.groups.map((g) => { const b = S.stats.byTarget.find((x) => x.id === g.id) || {}; return `<tr>
      <td>${g.url ? `<a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.name)}</a>` : esc(g.name)}<div class="small muted">${esc(g.id)}</div></td>
      <td>${esc(S.targetTypes[g.type]?.label)}</td><td class="small">${(g.areas || []).map(area).join(', ') || '—'}</td>
      <td>כל ${esc(g.minDaysBetweenPosts)} ימים</td>
      <td>${g.type !== 'facebook_group' ? '—' : g.rulesReviewed ? '<span class="badge ok">אושר</span>' : '<span class="badge bad">לא אושר</span>'}</td>
      <td>${b.posts ?? 0}${b.simulated ? ` <span class="small muted">(+${b.simulated} סימ')</span>` : ''}</td><td>${b.leads ?? 0}</td>
      <td>${g.status === 'active' ? '<span class="badge ok">פעיל</span>' : '<span class="badge">מושהה</span>'}</td>
      <td><div class="row"><button class="btn sm" data-action="editGroup" data-id="${g.id}">עריכה</button><button class="btn sm danger" data-action="delGroup" data-id="${g.id}">מחיקה</button></div></td></tr>`; }).join('') || '<tr><td colspan="9" class="muted">עדיין לא נוספו קבוצות.</td></tr>'}
  </table></div></section>`;
};

V.posts = () => {
  const posts = S.posts.slice().reverse();
  return `<section class="card"><h2>מנוע תוכן — יצירת פוסטים</h2>
    <form class="f" data-form="generate">
      <label>שירות<select name="serviceId">${options(S.services, 'paint')}</select></label>
      <label>אזור<select name="areaId">${options(S.areas, 'ramat-gan')}</select></label>
      <label>מותאם לקבוצה (לא חובה)<select name="targetId">${options(S.groups.map((g) => ({ id: g.id, label: g.name })), '', 'כללי')}</select></label>
      <label>כמות וריאציות<input type="number" name="count" min="1" max="10" value="3"></label>
      <label class="chk"><input type="checkbox" name="includeSite">הוסף קישור לאתר (עם UTM)</label>
      <button class="btn primary">צור פוסטים</button>
    </form>
    <p class="small muted">התוכן כללי ומתאר רק את השירותים ואת דרך העבודה. אין בו המלצות, עבודות שבוצעו או תוצאות מומצאות. כל פוסט נבדק אוטומטית: הוא חייב להפנות רק ל-${esc(S.business.phoneDisplay)}, ומסר המחיר חייב להופיע עם הסייג.</p>
  </section><br>
  <div class="grid">${posts.map(postCard).join('') || '<p class="muted">אין עדיין פוסטים.</p>'}</div>`;
};
function postCard(p) {
  const used = S.history.filter((h) => h.postId === p.id);
  const media = S.media.filter((m) => p.mediaIds?.includes(m.id));
  return `<article class="card stack">
    <div class="row"><b>${esc(p.id)}</b><span class="badge">${esc(svc(p.serviceId))}</span><span class="badge">${esc(area(p.areaId))}</span>
      ${p.status === 'approved' ? '<span class="badge ok">מאושר</span>' : '<span class="badge warn">טיוטה</span>'}<span class="small muted">קוד ${esc(p.refCode)}</span></div>
    <textarea data-post-text="${p.id}" ${used.length ? 'readonly' : ''}>${esc(p.text)}</textarea>
    ${p.lint.ok ? '<div class="small okc">✔ עבר בדיקת תוכן</div>' : `<div class="small err">${p.lint.errors.map(esc).join('<br>')}</div>`}
    ${media.length ? `<div class="small">מדיה: ${media.map((m) => esc(m.originalName || m.id)).join(', ')}</div>` : ''}
    ${used.length ? `<div class="small muted">פורסם ${used.length} פעמים (${used.map((h) => esc(h.mode === 'simulation' ? 'סימולציה' : h.mode === 'manual' ? 'ידני' : 'חי')).join(', ')})</div>` : ''}
    <div class="row">
      ${!used.length ? `<button class="btn sm" data-action="savePost" data-id="${p.id}">שמור עריכה</button>` : ''}
      ${p.status !== 'approved' ? `<button class="btn sm primary" data-action="approvePost" data-id="${p.id}" ${p.lint.ok ? '' : 'disabled'}>אשר</button>` : ''}
      <button class="btn sm" data-action="copyPost" data-id="${p.id}">העתק</button>
      <button class="btn sm" data-action="schedulePost" data-id="${p.id}">תזמן</button>
      <button class="btn sm" data-action="attachMedia" data-id="${p.id}">מדיה</button>
      <button class="btn sm" data-action="qaLinks" data-id="${p.id}">קישורי בדיקה</button>
      ${!used.length ? `<button class="btn sm danger" data-action="delPost" data-id="${p.id}">מחק</button>` : ''}
    </div></article>`;
}

V.schedule = () => {
  const order = { awaiting_manual: 0, deferred: 1, scheduled: 2, blocked: 3, failed: 4 };
  const items = S.schedule.slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || Date.parse(b.dueAt) - Date.parse(a.dueAt));
  return `<section class="card"><h2>לוח פרסומים</h2>
    <div class="row">
      <button class="btn primary" data-action="autoPlan">🗓 תכנן שבוע אוטומטית</button>
      <button class="btn" data-action="approveScheduled">אשר את כל הטיוטות המתוזמנות</button>
      <button class="btn" data-action="tick">הרץ בדיקת מתזמן עכשיו</button>
    </div>
    <p class="small muted">המתזמן רץ כל דקה. לפני כל פרסום הוא בודק: עצירת חירום, שבת או חג, שעות פעילות, אישור הפוסט, כללי הקבוצה, כפילויות, תדירות לקבוצה, מכסה יומית ומרווח בין פרסומים. בקבוצות פייסבוק הפוסט עובר ל"משימות לפרסום ידני". בדף עסקי הוא מתפרסם בסימולציה, או בפרסום חי רק אחרי אישור מפורש.</p>
  </section><br>
  <section class="card"><div class="tablewrap"><table>
    <tr><th>מזהה</th><th>מועד</th><th>ערוץ</th><th>פוסט</th><th>סטטוס</th><th>פירוט</th><th></th></tr>
    ${items.map((s) => { const g = grp(s.targetId); const p = S.posts.find((x) => x.id === s.postId); return `<tr>
      <td>${esc(s.id)}${s.source === 'auto_plan' ? '<div class="small muted">תכנון אוטו׳</div>' : ''}</td><td>${fmt(s.dueAt)}</td>
      <td>${esc(g?.name || '—')}<div class="small muted">${esc(S.targetTypes[g?.type]?.label || '')}</div></td>
      <td>${esc(s.postId)} ${p ? `<span class="small muted">${esc(svc(p.serviceId))}</span>${p.status !== 'approved' ? ' <span class="badge warn">טיוטה</span>' : ''}` : ''}</td>
      <td>${statusBadge(s)}</td><td class="small">${esc(s.reason || '')}${s.externalUrl ? ` <a href="${esc(s.externalUrl)}" target="_blank" rel="noopener">קישור</a>` : ''}</td>
      <td><div class="row">${['scheduled', 'deferred', 'awaiting_manual', 'blocked', 'failed'].includes(s.status) ? `<button class="btn sm danger" data-action="cancelItem" data-id="${s.id}">בטל</button>` : ''}
        ${['blocked', 'failed'].includes(s.status) ? `<button class="btn sm" data-action="retryItem" data-id="${s.id}">נסה שוב</button>` : ''}
        ${s.status === 'awaiting_manual' ? `<button class="btn sm accent" data-action="openTask" data-id="${s.id}">פתח</button>` : ''}</div></td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">אין פרסומים מתוזמנים.</td></tr>'}
  </table></div></section>`;
};

V.media = () => `<section class="card"><h2>העלאת תמונה / סרטון</h2>
  <form class="f" data-form="media">
    <label>קובץ<input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm" required></label>
    <label>מקור<select name="origin"><option value="">בחרו…</option><option value="own_work">צילום של עבודה שלנו</option><option value="illustration">תמונת המחשה (מאגר / AI)</option><option value="graphic">גרפיקה / מודעה</option></select></label>
    <label class="full">תיאור<input name="description"></label>
    <label class="chk full"><input type="checkbox" name="confirmOwn">אני מאשר/ת שזו עבודה שביצענו בפועל ושקיבלנו הסכמה מהלקוח לפרסם (רק לצילום של עבודה שלנו)</label>
    <button class="btn primary">העלאה</button>
  </form>
  <p class="small muted">לא מפרסמים תמונות "לפני/אחרי" של לקוחות בלי שהן אמיתיות ובלי הסכמה. כשמצרפים לפוסט תמונת המחשה, נוסף אליו אוטומטית "התמונה להמחשה בלבד".</p></section><br>
  <div class="media-grid">${S.media.map((m) => `<div class="card">
    ${m.kind === 'video' ? `<video src="/media/${esc(m.file)}" controls preload="metadata"></video>` : `<img src="/media/${esc(m.file)}" alt="${esc(m.description || m.originalName)}">`}
    <div class="small"><b>${esc(m.id)}</b> · ${esc({ own_work: 'עבודה שלנו', illustration: 'המחשה', graphic: 'גרפיקה' }[m.origin])}</div>
    <div class="small muted">${esc(m.description || m.originalName)}</div>
    <button class="btn sm danger" data-action="delMedia" data-id="${m.id}">מחיקה</button></div>`).join('') || '<p class="muted">אין קבצים.</p>'}</div>`;

V.leads = () => {
  const src = Object.entries(S.leadSources).map(([id, label]) => ({ id, label }));
  return `<section class="card"><h2>רישום ליד חדש</h2>
  <form class="f" data-form="lead">
    <label>שם<input name="name"></label><label>טלפון<input name="phone" dir="ltr"></label>
    <label>שירות<select name="service">${options(S.services, '', 'לא ידוע')}</select></label>
    <label>אזור<select name="area">${options(S.areas, '', 'לא ידוע')}</select></label>
    <label>מקור<select name="source">${options(src, '', 'זיהוי אוטומטי לפי קוד')}</select></label>
    <label>קוד מקור (למשל B1003)<input name="refCode" dir="ltr"></label>
    <label class="full">הדביקו את הודעת הוואטסאפ (הקוד יזוהה אוטומטית)<textarea name="message" style="min-height:60px"></textarea></label>
    <label class="full">הערות<input name="notes"></label>
    <label class="chk"><input type="checkbox" name="isTest">זו בדיקת QA (לא תיספר)</label>
    <button class="btn primary">שמירה</button>
  </form>
  <p class="small muted">כל הפניות מגיעות אל ${esc(S.business.phoneDisplay)}. ליד שנרשם עם מספר העסק עצמו, עם קוד QA או עם המילה "בדיקה" מסומן כבדיקה ולא נספר בסטטיסטיקות.</p></section><br>
  <section class="card"><h2>לידים (${S.stats.leads.total} אמיתיים${S.stats.leads.qaExcluded ? `, ${S.stats.leads.qaExcluded} בדיקות` : ''})</h2><div class="tablewrap"><table>
    <tr><th>תאריך</th><th>שם / טלפון</th><th>שירות · אזור</th><th>מקור</th><th>סטטוס</th><th>שווי ₪</th><th></th></tr>
    ${S.leads.map((l) => `<tr ${l.isTest ? 'style="opacity:.6"' : ''}>
      <td>${fmt(l.createdAt)}${l.isTest ? `<div><span class="badge">בדיקה</span></div><div class="small muted">${esc((l.qaReasons || []).join(', '))}</div>` : ''}</td>
      <td>${esc(l.name)}<div class="small" dir="ltr">${esc(l.phone)}</div></td>
      <td class="small">${esc(svc(l.service))} · ${esc(area(l.area))}</td>
      <td class="small">${esc(S.leadSources[l.source] || '—')}${l.targetId ? `<div class="muted">${esc(grp(l.targetId)?.name || l.targetId)}</div>` : ''}${l.refCode ? `<div class="muted">${esc(l.refCode)}</div>` : ''}</td>
      <td><select data-lead-status="${l.id}">${Object.entries(S.leadStatuses).map(([k, v]) => `<option value="${k}" ${k === l.status ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></td>
      <td><input type="number" min="0" style="width:90px" data-lead-value="${l.id}" value="${esc(l.value ?? '')}"></td>
      <td><div class="row"><button class="btn sm" data-action="contactLead" data-id="${l.id}" ${S.guard.allowed ? '' : 'disabled title="חסום כרגע (שבת/חג/שעות)"'}>וואטסאפ</button>
        <button class="btn sm" data-action="toggleTest" data-id="${l.id}" data-test="${l.isTest ? '0' : '1'}">${l.isTest ? 'לא בדיקה' : 'סמן כבדיקה'}</button>
        <button class="btn sm danger" data-action="delLead" data-id="${l.id}">מחק</button></div></td></tr>`).join('') || '<tr><td colspan="7" class="muted">אין לידים עדיין.</td></tr>'}
  </table></div></section>`;
};

function bars(obj, labels) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return entries.map(([k, v]) => `<div class="barrow"><span>${esc(labels[k] || k)}</span><div class="bar" style="width:${(v / max) * 100}%"></div><span>${v}</span></div>`).join('') || '<p class="muted small">אין נתונים עדיין</p>';
}
V.stats = () => {
  const st = S.stats; const L = st.labels;
  return `<div class="tiles">
    ${tile(st.leads.total, 'לידים אמיתיים (סה״כ)')}${tile(st.leads.won, 'עבודות שנסגרו')}${tile(st.leads.attributedToPost, 'לידים ששויכו לפוסט')}
    ${tile(st.posts.publishedReal, 'פרסומים אמיתיים')}${tile(st.posts.simulated, 'פרסומי סימולציה')}${tile(st.leads.qaExcluded, 'בדיקות QA שלא נספרו')}
  </div>
  <div class="grid">
    <section class="card"><h3>לידים לפי מקור</h3>${bars(st.leads.bySource, L.source)}</section>
    <section class="card"><h3>לידים לפי שירות</h3>${bars(st.leads.byService, L.service)}</section>
    <section class="card"><h3>לידים לפי אזור</h3>${bars(st.leads.byArea, L.area)}</section>
    <section class="card"><h3>סטטוס לידים</h3>${bars(st.leads.byStatus, L.status)}</section>
  </div><br>
  <section class="card"><h3>ביצועים לפי קבוצה / ערוץ</h3><div class="tablewrap"><table>
    <tr><th>ערוץ</th><th>סוג</th><th>פרסומים אמיתיים</th><th>סימולציה</th><th>לידים</th><th>נסגרו</th><th>לידים לפרסום</th></tr>
    ${st.byTarget.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(L.targetType[t.type])}</td><td>${t.posts}</td><td>${t.simulated}</td><td>${t.leads}</td><td>${t.won}</td><td>${t.leadsPerPost ?? '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">אין נתונים</td></tr>'}
  </table></div><p class="small muted">המדד החשוב: לידים לכל פרסום. קבוצות שלא מביאות לידים לאורך זמן — כדאי להשהות.</p></section>`;
};

V.history = () => `<div class="grid">
  <section class="card"><h2>היסטוריית פרסומים</h2><div class="tablewrap"><table><tr><th>זמן</th><th>ערוץ</th><th>פוסט</th><th>סוג</th></tr>
    ${S.history.map((h) => `<tr><td>${fmt(h.ts)}</td><td>${esc(grp(h.targetId)?.name || h.targetId)}</td><td>${esc(h.postId)}</td><td>${h.mode === 'simulation' ? '<span class="badge">סימולציה</span>' : h.mode === 'manual' ? '<span class="badge ok">ידני</span>' : '<span class="badge bad">חי</span>'} ${h.externalUrl ? `<a href="${esc(h.externalUrl)}" target="_blank" rel="noopener">קישור</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">ריק</td></tr>'}
  </table></div></section>
  <section class="card"><h2>יומן שגיאות</h2><div class="tablewrap"><table><tr><th>זמן</th><th>רכיב</th><th>הודעה</th></tr>
    ${S.errors.map((e) => `<tr><td>${fmt(e.ts)}</td><td>${esc(e.source)}</td><td class="small">${esc(e.message)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">אין שגיאות</td></tr>'}
  </table></div></section></div><br>
  <section class="card"><h2>יומן פעילות</h2><div class="tablewrap"><table><tr><th>זמן</th><th>סוג</th><th>פעולה</th></tr>
    ${S.activity.map((a) => `<tr><td>${fmt(a.ts)}</td><td class="small muted">${esc(a.type)}</td><td class="small">${esc(a.message)}</td></tr>`).join('')}
  </table></div></section>`;

V.settings = () => {
  const s = S.settings; const c = S.connections; const live = S.live;
  return `<div class="grid">
  <section class="card"><h2>מצב פרסום</h2>
    <p>מצב נוכחי: <b>${s.mode === 'live' ? '⚠️ פרסום חי' : '🧪 סימולציה — שום דבר לא נשלח לפייסבוק'}</b></p>
    ${s.mode === 'live' ? '<button class="btn" data-action="toSim">חזרה לסימולציה</button>' : `
      <p class="small">פרסום חי פועל רק בדף עסקי בפייסבוק, ורק כשמתקיימים כל התנאים:</p>
      <ul class="small">${live.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      <form class="f" data-form="toLive"><label class="full">להפעלה הקלידו: <b>מאשר פרסום חי</b><input name="confirm"></label><button class="btn danger">עבור לפרסום חי</button></form>`}
  </section>
  <section class="card"><h2>מגבלות ובטיחות</h2>
    <form class="f" data-form="settings">
      <label>מקסימום פרסומים ביום<input type="number" name="dailyCap" min="1" max="20" value="${s.dailyCap}"></label>
      <label>דקות מינימום בין פרסומים<input type="number" name="minMinutesBetweenPosts" min="5" max="600" value="${s.minMinutesBetweenPosts}"></label>
      <label>חסימת טקסט זהה באותה קבוצה (ימים)<input type="number" name="sameTargetDupDays" min="7" max="365" value="${s.sameTargetDupDays}"></label>
      <label>חסימת טקסט זהה בקבוצות אחרות (ימים)<input type="number" name="anyTargetDupDays" min="1" max="90" value="${s.anyTargetDupDays}"></label>
      <label>שעת התחלה<input type="number" name="hStart" min="6" max="22" value="${s.postingHours.start}"></label>
      <label>שעת סיום<input type="number" name="hEnd" min="7" max="23" value="${s.postingHours.end}"></label>
      <label>דקות עצירה לפני הדלקת נרות<input type="number" name="shabbatMarginBeforeMin" min="30" max="240" value="${s.shabbatMarginBeforeMin}"></label>
      <label>דקות אחרי הבדלה<input type="number" name="shabbatMarginAfterMin" min="0" max="240" value="${s.shabbatMarginAfterMin}"></label>
      <label class="chk full"><input type="checkbox" name="blockMemorialDays" ${s.blockMemorialDays ? 'checked' : ''}>לחסום גם ביום השואה, ביום הזיכרון ובתשעה באב</label>
      <button class="btn primary">שמירה</button>
    </form></section>
  <section class="card"><h2>חיבורים</h2><table>
    <tr><td>לוח שבת/חגים (Hebcal)</td><td>${c.hebcal.ok ? '<span class="badge ok">מחובר ומאומת</span>' : '<span class="badge bad">לא מאומת — פרסום חסום</span>'}<div class="small muted">${fmt(c.hebcal.lastFetch)}</div></td></tr>
    <tr><td>דף עסקי בפייסבוק</td><td>${c.facebookPage.tokenPresent && c.facebookPage.pageIdPresent ? '<span class="badge ok">טוקן קיים</span>' : '<span class="badge warn">לא מחובר</span>'}<div class="small muted">FB_PAGE_ID, FB_PAGE_ACCESS_TOKEN בקובץ .env</div></td></tr>
    <tr><td>קבוצות פייסבוק</td><td><span class="badge">ידני בלבד</span><div class="small muted">${esc(S.targetTypes.facebook_group.why)}</div></td></tr>
    <tr><td>אנליטיקס באתר</td><td><span class="badge warn">לא מחובר</span><div class="small muted">${esc(c.websiteAnalytics.note)}</div></td></tr>
    <tr><td>וואטסאפ</td><td><span class="badge ok">${esc(c.whatsapp.number)}</span><div class="small muted">${esc(c.whatsapp.note)}</div></td></tr>
  </table></section>
  <section class="card"><h2>גיבוי</h2><p class="small">כל הנתונים נשמרים בקובץ <code>data/db.json</code> במחשב שלכם, ואחרי כל שינוי נשמר גיבוי <code>db.json.bak</code>.</p>
    <a class="btn" href="/api/export" download>הורדת גיבוי מלא (JSON)</a></section>
  </div>`;
};

function render() {
  renderTop(); renderTabs();
  $('#main').innerHTML = (V[tab] || V.home)();
}

// ---------- אירועים ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; try { localStorage.setItem('tab', tab); } catch {} render(); return; }
  if (e.target.id === 'killBtn') {
    const on = !S.settings.killSwitch;
    if (!on || confirm('לעצור את כל הפרסומים מיד?')) act(() => api('POST', '/api/kill-switch', { on }), on ? 'כל הפרסומים נעצרו' : 'הפרסומים הופעלו מחדש');
    return;
  }
  const b = e.target.closest('[data-action]'); if (!b) return;
  const id = b.dataset.id;
  const A = {
    calRefresh: () => act(() => api('POST', '/api/calendar/refresh').then((r) => { if (r.error) throw new Error(r.error); }), 'הלוח עודכן'),
    editGroup: () => openDlg(`<h2>עריכת ${esc(grp(id).name)}</h2>${groupForm(grp(id))}`),
    delGroup: () => confirm('למחוק את הקבוצה? פרסומים פתוחים אליה יבוטלו.') && act(() => api('DELETE', `/api/groups/${id}`), 'נמחקה'),
    closeDlg: () => $('#dlg').close(),
    savePost: () => act(() => api('PUT', `/api/posts/${id}`, { text: $(`[data-post-text="${id}"]`).value }), 'נשמר (חזר לטיוטה)'),
    approvePost: () => act(async () => { const ta = $(`[data-post-text="${id}"]`); const p = S.posts.find((x) => x.id === id); if (ta && ta.value !== p.text) await api('PUT', `/api/posts/${id}`, { text: ta.value }); await api('PUT', `/api/posts/${id}`, { status: 'approved' }); }, 'אושר'),
    delPost: () => confirm('למחוק את הפוסט?') && act(() => api('DELETE', `/api/posts/${id}`), 'נמחק'),
    copyPost: () => copy(S.posts.find((x) => x.id === id).text),
    schedulePost: () => openDlg(`<h2>תזמון ${esc(id)}</h2><form class="f" data-form="schedule:${id}">
      <label>ערוץ<select name="targetId" required>${options(S.groups.filter((g) => g.status === 'active').map((g) => ({ id: g.id, label: g.name })), '', 'בחרו…')}</select></label>
      <label>מועד<input type="datetime-local" name="dueAt" required></label>
      <div class="full row"><button class="btn primary">תזמן</button><button type="button" class="btn" data-action="closeDlg">ביטול</button></div></form>`),
    attachMedia: () => { const p = S.posts.find((x) => x.id === id); openDlg(`<h2>מדיה לפוסט ${esc(id)}</h2><form class="stack" data-form="attach:${id}">
      ${S.media.map((m) => `<label class="chk"><input type="checkbox" name="m" value="${m.id}" ${p.mediaIds?.includes(m.id) ? 'checked' : ''}>${esc(m.id)} · ${esc(m.description || m.originalName)} (${esc({ own_work: 'עבודה שלנו', illustration: 'המחשה', graphic: 'גרפיקה' }[m.origin])})</label>`).join('') || '<p class="muted">העלו קודם קבצים בלשונית המדיה.</p>'}
      <div class="row"><button class="btn primary">שמירה</button><button type="button" class="btn" data-action="closeDlg">ביטול</button></div></form>`); },
    qaLinks: async () => { try { const r = await api('GET', `/api/posts/${id}/qa-links`); openDlg(`<h2>קישורי בדיקה (QA)</h2><p class="small">${esc(r.note)}</p><p><a href="${esc(r.whatsapp)}" target="_blank" rel="noopener">וואטסאפ בדיקה</a></p><p><a href="${esc(r.site)}" target="_blank" rel="noopener" dir="ltr">${esc(r.site)}</a></p><button class="btn" data-action="closeDlg">סגירה</button>`); } catch (er) { showError(er); } },
    autoPlan: () => act(async () => { const r = await api('POST', '/api/schedule/auto-plan', { days: 7 }); toast(`נוצרו ${r.created.length} פרסומים${r.skipped.length ? `, דולגו ${r.skipped.length}: ${r.skipped.map((x) => `${x.group || ''} ${x.reason}`).join('; ')}` : ''}`); }),
    approveScheduled: () => act(async () => { const r = await api('POST', '/api/posts/approve-scheduled'); toast(`אושרו ${r.approved} פוסטים`); }),
    tick: () => act(async () => { const r = await api('POST', '/api/scheduler/tick'); toast(r.stopped ? 'עצירת חירום פעילה — לא בוצע דבר' : `נבדקו ${r.processed}: ${r.manual} לידני, ${r.simulated} סימולציה, ${r.published} חי, ${r.deferred} נדחו, ${r.blocked} נחסמו`); }),
    cancelItem: () => act(() => api('POST', `/api/schedule/${id}/cancel`), 'בוטל'),
    retryItem: () => act(() => api('POST', `/api/schedule/${id}/retry`), 'יוחזר לתור'),
    openTask: async () => {
      try {
        const r = await api('POST', `/api/schedule/${id}/open`);
        await copy(r.text, false);
        if (r.url) window.open(r.url, '_blank', 'noopener');
        openDlg(`<h2>הפוסט הועתק ✔</h2><p>הדביקו אותו בקבוצה שנפתחה בלשונית חדשה${r.media.length ? ', וצרפו את המדיה:' : '.'}</p>${r.media.map((m) => `<div><a href="${esc(m.url)}" download>${esc(m.name || m.id)}</a></div>`).join('')}
          <div class="post-text small">${esc(r.text)}</div><br>
          <form class="f" data-form="mark:${id}"><label class="full">קישור לפוסט שפורסם (לא חובה)<input name="url" dir="ltr" placeholder="https://www.facebook.com/groups/.../posts/..."></label>
          <div class="full row"><button class="btn primary">✔ פרסמתי — סמנו כפורסם</button><button type="button" class="btn" data-action="closeDlg">אחר כך</button></div></form>`);
        await refresh();
      } catch (er) { showError(er); }
    },
    markTask: () => openDlg(`<h2>סימון ${esc(id)} כפורסם</h2><form class="f" data-form="mark:${id}"><label class="full">קישור לפוסט (לא חובה)<input name="url" dir="ltr"></label><div class="full row"><button class="btn primary">סמנו כפורסם</button><button type="button" class="btn" data-action="closeDlg">ביטול</button></div></form>`),
    skipTask: () => act(() => api('POST', `/api/schedule/${id}/skip`), 'דולג'),
    delMedia: () => confirm('למחוק את הקובץ?') && act(() => api('DELETE', `/api/media/${id}`), 'נמחק'),
    contactLead: async () => { try { const r = await api('POST', `/api/leads/${id}/contact`); window.open(r.url, '_blank', 'noopener'); } catch (er) { showError(er); } },
    toggleTest: () => act(() => api('PUT', `/api/leads/${id}`, { isTest: b.dataset.test === '1' }), 'עודכן'),
    delLead: () => confirm('למחוק את הליד?') && act(() => api('DELETE', `/api/leads/${id}`), 'נמחק'),
    toSim: () => act(() => api('POST', '/api/settings', { mode: 'simulation' }), 'חזרה לסימולציה'),
  };
  if (A[b.dataset.action]) { e.preventDefault(); A[b.dataset.action](); }
});

document.addEventListener('change', (e) => {
  const st = e.target.dataset.leadStatus; if (st) return act(() => api('PUT', `/api/leads/${st}`, { status: e.target.value }), 'עודכן');
  const v = e.target.dataset.leadValue; if (v) return act(() => api('PUT', `/api/leads/${v}`, { value: e.target.value }), 'נשמר');
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const [kind, id] = f.dataset.form.split(':');
  const fd = new FormData(f);
  const o = Object.fromEntries(fd.entries());
  const all = (n) => fd.getAll(n);
  const chk = (n) => !!f.querySelector(`[name="${n}"]`)?.checked;
  const close = () => { if ($('#dlg').open) $('#dlg').close(); };
  const groupBody = () => ({ ...o, areas: all('areas'), services: all('services'), allowLinks: chk('allowLinks'), autoPlan: chk('autoPlan'), rulesReviewed: chk('rulesReviewed') });
  const F = {
    groupAdd: () => act(() => api('POST', '/api/groups', groupBody()).then(() => f.reset()), 'נוספה'),
    groupEdit: () => act(() => api('PUT', `/api/groups/${id}`, groupBody()).then(close), 'נשמר'),
    generate: () => act(() => api('POST', '/api/posts/generate', { ...o, includeSite: chk('includeSite') }), 'נוצרו טיוטות — קראו ואשרו'),
    schedule: () => act(async () => { const r = await api('POST', '/api/schedule', { postId: id, targetId: o.targetId, dueAt: new Date(o.dueAt).toISOString() }); close(); if (r.warning) toast(r.warning); }, 'תוזמן'),
    attach: () => act(() => api('PUT', `/api/posts/${id}`, { mediaIds: all('m') }).then(close), 'עודכן'),
    mark: () => act(() => api('POST', `/api/schedule/${id}/mark-published`, { url: o.url }).then(close), 'נרשם כפורסם'),
    media: async () => {
      const file = fd.get('file'); if (!file?.size) return toast('בחרו קובץ');
      if (file.size > 40 * 1024 * 1024) return toast('קובץ גדול מדי (עד 40MB)');
      const dataBase64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
      act(() => api('POST', '/api/media', { name: file.name, mime: file.type, dataBase64, origin: o.origin, description: o.description, confirmOwn: chk('confirmOwn') }).then(() => f.reset()), 'הועלה');
    },
    lead: () => act(() => api('POST', '/api/leads', { ...o, isTest: chk('isTest') }).then((l) => { f.reset(); if (l.isTest) toast('נשמר כבדיקה — לא ייספר'); }), 'הליד נשמר'),
    settings: () => act(() => api('POST', '/api/settings', { dailyCap: o.dailyCap, minMinutesBetweenPosts: o.minMinutesBetweenPosts, sameTargetDupDays: o.sameTargetDupDays, anyTargetDupDays: o.anyTargetDupDays, shabbatMarginBeforeMin: o.shabbatMarginBeforeMin, shabbatMarginAfterMin: o.shabbatMarginAfterMin, blockMemorialDays: chk('blockMemorialDays'), postingHours: { start: o.hStart, end: o.hEnd } }), 'נשמר'),
    toLive: () => confirm('פרסום חי ישלח פוסטים אמיתיים לדף העסקי. להמשיך?') && act(() => api('POST', '/api/settings', { mode: 'live', confirm: o.confirm }), 'עבר לפרסום חי'),
  };
  F[kind]?.();
});

function openDlg(html) { $('#dlgBody').innerHTML = html; $('#dlg').showModal(); }
async function copy(text, notify = true) {
  try { await navigator.clipboard.writeText(text); if (notify) toast('הועתק'); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); if (notify) toast('הועתק'); }
}

refresh().catch((e) => { $('#main').innerHTML = `<div class="notice bad">השרת לא זמין: ${esc(e.message)}</div>`; });
setInterval(() => { if (!document.hidden && !$('#dlg').open && !document.activeElement?.matches('input,textarea,select')) refresh().catch(() => {}); }, 30000);
