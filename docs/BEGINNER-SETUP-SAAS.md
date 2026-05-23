# התקנה למתחילים — AI Office Worker SaaS

זמן משוער: 60–90 דקות.

---

## מה צריך מראש

- מחשב עם **Node.js 20+**
- חשבון **Google** (Gmail אישי)
- חשבון **Anthropic** (Claude API)
- חשבון **Twilio** (WhatsApp — אופציונלי לבדיקה ראשונה)
- חשבונות **Railway** + **Netlify** (לפריסה)

---

## שלב 1 — הורדת הפרויקט

```bash
cd c:\Users\User\Documents\ai-office-worker
npm install
```

---

## שלב 2 — משתני סביבה

1. העתק `backend/.env.example` ל-`backend/.env`
2. העתק `frontend/.env.example` ל-`frontend/.env.local`
3. מלא לפחות:
   - `JWT_SECRET` — מחרוזת אקראית ארוכה
   - `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`
   - `ANTHROPIC_API_KEY`
   - `DATABASE_URL=file:./dev.db`

### Google OAuth (חובה)

1. [Google Cloud Console](https://console.cloud.google.com/) → פרויקט חדש
2. הפעל: Gmail API, Drive API, Sheets API
3. **OAuth consent screen** → External → הוסף את המייל שלך כ-Test user
4. **Credentials → OAuth Client ID** → Web application
5. Redirect URI: `http://localhost:4000/auth/google/callback`
6. העתק Client ID ו-Secret ל-`backend/.env`

### Claude API

1. [console.anthropic.com](https://console.anthropic.com/)
2. צור API Key → `ANTHROPIC_API_KEY`

### Twilio WhatsApp (אופציונלי)

1. [twilio.com](https://www.twilio.com/) → Sandbox for WhatsApp
2. מלא `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
3. `OWNER_WHATSAPP_NUMBER=whatsapp:+972...`
4. Webhook URL (אחרי פריסה): `https://YOUR-API.railway.app/webhooks/twilio/whatsapp`

---

## שלב 3 — בסיס נתונים

```bash
cd backend
npx prisma db push
npx prisma generate
cd ..
```

---

## שלב 4 — הרצה מקומית

טרמינל 1 — API:

```bash
npm run dev -w backend
```

טרמינל 2 — Frontend:

```bash
npm run dev -w frontend
```

טרמינל 3 — Worker (תזמון):

```bash
npm run worker -w backend
```

פתח: [http://localhost:3000](http://localhost:3000) → **התחבר עם Google**

---

## שלב 5 — בדיקה ראשונה

1. לחץ **סרוק Gmail עכשיו** בלוח הבקרה
2. בדוק **תשלומי ספקים** — שורות חדשות
3. בדוק **דוח חשבוניות חסרות**
4. שלח `HELP` ל-WhatsApp Sandbox (אם Twilio מוגדר)

---

## שלב 6 — פריסה

### Railway (Backend + Worker)

1. חבר את ה-repo ל-Railway
2. שירות 1: `backend` — Start: `npm run start -w backend`
3. שירות 2: `backend` — Start: `npm run worker -w backend`
4. הוסף את כל משתני `backend/.env`
5. עדכן `GOOGLE_REDIRECT_URI` ל-URL של Railway
6. `DATABASE_URL` — השתמש ב-PostgreSQL בפרודקשן (מומלץ)

### Netlify (Frontend)

1. Base directory: `frontend`
2. Build: `npm run build`
3. Env: `NEXT_PUBLIC_API_URL=https://your-api.railway.app`

---

## פקודות WhatsApp

| פקודה | פעולה |
|--------|--------|
| HELP / עזרה | רשימת פקודות |
| STATUS / מצב | סטטוס כספי |
| SUMMARY / סיכום | סיכום יומי |
| SYNC / סנכרון | סריקת Gmail |
| PAYMENTS / תשלומים | תשלומים פתוחים |
| MISSING / חסרות | חשבוניות חסרות |

---

## בעיות נפוצות

| בעיה | פתרון |
|------|--------|
| Gmail not connected | התחבר מחדש דרך Google OAuth |
| Invalid token | נקה localStorage והתחבר שוב |
| Claude error | בדוק API key ויתרה |
| Worker לא רץ | הפעל `npm run worker` או Railway cron |

---

## מה הלאה?

ראה [ROADMAP-SAAS.md](../ROADMAP-SAAS.md) — Phase 2 ו-3.
