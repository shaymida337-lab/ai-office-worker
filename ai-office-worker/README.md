# 🤖 עובד משרד AI לעסק קטן

מערכת SaaS לניהול אוטומטי של חשבוניות ומסמכים כספיים.  
הלקוח נרשם, מתחבר עם Google — והמערכת עושה הכל אוטומטית.

---

## מה המערכת עושה

- 📨 **סורקת Gmail** לחשבוניות, קבלות, דרישות תשלום
- 🤖 **AI מחלץ נתונים**: שם ספק, סכום, תאריך לתשלום, מע"מ ועוד
- ☁️ **שומרת קבצים** ב-Google Drive בתיקייה ייעודית
- 📊 **Google Sheets אוטומטי** עם כל הנתונים בטבלה
- ☀️ **סיכום יומי** ב-08:00 לכל לקוח במייל
- 🔔 **מזהה**: כפילויות, תשלומים קרובים, מסמכים דורשים בדיקה

---

## טכנולוגיות

| שכבה | טכנולוגיה |
|------|-----------|
| Frontend | Next.js 14 (App Router) + Tailwind CSS |
| Backend | Node.js + Express |
| Database | PostgreSQL (Supabase) + Prisma ORM |
| Auth | Google OAuth 2.0 + JWT |
| AI | Claude API (Anthropic) / OpenAI GPT-4o |
| Storage | Google Drive API |
| Sheets | Google Sheets API |
| Scheduler | node-cron (כל 2 שעות + 08:00 יומי) |

---

## הכנה לפני התקנה

### 1. Google Cloud Project

1. היכנס ל-[console.cloud.google.com](https://console.cloud.google.com)
2. צור פרויקט חדש
3. ב-**APIs & Services** → **Enable APIs**, הפעל:
   - Gmail API
   - Google Drive API
   - Google Sheets API
4. ב-**OAuth consent screen**: הגדר את האפליקציה, הוסף scopes:
   - `gmail.readonly`
   - `drive.file`
   - `spreadsheets`
5. ב-**Credentials** → **Create Credentials** → **OAuth client ID**:
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:4000/api/auth/google/callback`
6. שמור את `Client ID` ו-`Client Secret`

### 2. Supabase (Database)

1. צור חשבון ב-[supabase.com](https://supabase.com)
2. צור פרויקט חדש
3. העתק את **Connection String** (URI mode) מ-Settings → Database

### 3. AI API

בחר אחד:
- [Anthropic Console](https://console.anthropic.com) → API Keys → צור מפתח
- [OpenAI Platform](https://platform.openai.com) → API Keys → צור מפתח

---

## התקנה מקומית

### Backend

```bash
cd backend
cp .env.example .env
# ערוך את .env עם כל הפרטים שאספת
nano .env

npm install
npx prisma generate
npx prisma db push          # יוצר את הטבלאות ב-Supabase
npm run dev                 # מריץ על http://localhost:4000
```

### Frontend

```bash
cd frontend
cp .env.example .env.local
# ערוך: NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev                 # מריץ על http://localhost:3000
```

### בדיקה שהכל עובד

```bash
curl http://localhost:4000/api/health
# צריך לחזור: {"status":"ok",...}
```

### Create local test user

To create the requested local account (shaymida337@gmail.com / 123456) run in the backend folder:

```bash
node scripts/createUser.js
```

---

## קבצי .env

### backend/.env

```env
DATABASE_URL="postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres"

PORT=4000
NODE_ENV=development
JWT_SECRET=your-random-64-char-secret-here

GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback

# Gmail OAuth setup for real Gmail scanning:
# 1. Configure the OAuth consent screen and add shaymida337@gmail.com as a test user.
# 2. Add this redirect URI in the OAuth client settings:
#    http://localhost:4000/api/auth/google/callback
# 3. Restart the backend and click "התחבר עם Gmail אמיתי" on the landing page.

ANTHROPIC_API_KEY=sk-ant-...
# או: OPENAI_API_KEY=sk-...
AI_PROVIDER=anthropic

FRONTEND_URL=http://localhost:3000

# לשליחת סיכום יומי במייל (Gmail SMTP):
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password    # App Password מ-Google Account

# Twilio WhatsApp (optional)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_WHATSAPP_FROM=whatsapp:+1415XXXXXXX
```

### frontend/.env.local

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

---

## פריסה ל-Production

### Backend — Railway / Render

```bash
# Railway
npm install -g @railway/cli
railway login
railway new
railway up

# הגדר env vars דרך ה-dashboard
# שנה GOOGLE_REDIRECT_URI ל: https://your-backend.railway.app/api/auth/google/callback
# שנה FRONTEND_URL ל: https://your-frontend.vercel.app
```

### Frontend — Vercel

```bash
npm install -g vercel
cd frontend
vercel

# הגדר env var: NEXT_PUBLIC_API_URL=https://your-backend.railway.app
```

### אחרי פריסה

1. עדכן ב-Google Cloud Console את ה-Redirect URI ל-URL החדש
2. עדכן את `.env` עם ה-URLs החדשים
3. הרץ `npx prisma db push` על ה-DB החדש

---

## מבנה הפרויקט

```
ai-office-worker/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma          # מודל ה-DB
│   └── src/
│       ├── index.js               # נקודת כניסה
│       ├── middleware/
│       │   └── auth.js            # JWT authentication
│       ├── routes/
│       │   ├── auth.js            # Google OAuth
│       │   ├── documents.js       # CRUD מסמכים
│       │   ├── dashboard.js       # סטטיסטיקות
│       │   └── scan.js            # הפעלת סריקה
│       ├── services/
│       │   ├── googleAuth.js      # OAuth client factory
│       │   ├── gmail.js           # סריקת Gmail
│       │   ├── aiExtractor.js     # חילוץ נתונים עם AI
│       │   ├── googleDrive.js     # שמירה ב-Drive
│       │   ├── googleSheets.js    # כתיבה ל-Sheets
│       │   ├── emailProcessor.js  # Pipeline ראשי
│       │   └── emailSummary.js    # שליחת סיכום יומי
│       ├── jobs/
│       │   └── scheduler.js       # Cron jobs
│       └── utils/
│           └── logger.js          # Winston logger
└── frontend/
    └── src/
        ├── app/
        │   ├── page.js            # דף נחיתה + הרשמה
        │   ├── auth/callback/     # OAuth callback
        │   └── dashboard/
        │       ├── page.js        # מסך הבית
        │       ├── documents/     # רשימת מסמכים + פרטי מסמך
        │       └── settings/      # הגדרות + לוג
        └── lib/
            ├── api.js             # Axios client
            └── constants.js       # תוויות וצבעים
```

---

## API Endpoints

| Method | URL | תיאור |
|--------|-----|-------|
| GET | `/api/health` | בריאות השרת |
| GET | `/api/auth/google` | URL להתחברות עם Google |
| GET | `/api/auth/google/callback` | Callback מ-Google |
| GET | `/api/auth/me` | פרטי משתמש מחובר |
| GET | `/api/dashboard/stats` | סטטיסטיקות לדאשבורד |
| GET | `/api/documents` | רשימת מסמכים עם פילטרים |
| GET | `/api/documents/:id` | פרטי מסמך |
| PATCH | `/api/documents/:id/status` | עדכון סטטוס |
| POST | `/api/scan/now` | הפעלת סריקה ידנית |
| GET | `/api/scan/logs` | לוג פעילות |

---

## הגנות ב-MVP

- ✅ **אין כפילויות**: כל מייל נשמר פעם אחת (לפי Gmail Message ID)
- ✅ **לא מוחקים**: אף פעם לא נמחק מייל או קובץ
- ✅ **הפרדת לקוחות**: כל לקוח רואה רק את המסמכים שלו
- ✅ **סטטוס NEEDS_REVIEW**: כאשר רמת ביטחון AI נמוכה מ-60%
- ✅ **לוג מלא**: כל פעולה נרשמת בטבלת `logs`
- ✅ **Token refresh**: הטוקנים של Google מתרעננים אוטומטית

---

## פיצ'רים לגרסה הבאה

- [ ] WhatsApp Business API (סיכום יומי + קבלת חשבוניות)
- [ ] תזכורות תשלום אוטומטיות
- [ ] חיפוש חכם ("כמה שילמתי לבזק השנה?")
- [ ] תחזית תזרים מזומנים
- [ ] זיהוי חיובים חריגים
- [ ] Dashboard גרפי
- [ ] Stripe / כרטיס אשראי לסאאס בתשלום

---

## שאלות נפוצות

**ש: האם המערכת קוראת תוכן של מיילים?**  
כן, כדי לזהות חשבוניות. הנתונים לא נמכרים ולא עוזבים את השרת שלך.

**ש: מה קורה אם ה-AI לא בטוח?**  
המסמך מקבל סטטוס "דורש בדיקה" ותקבל התראה.

**ש: מה קורה אם הסריקה נכשלת?**  
נרשמת שגיאה ב-log. המסמך לא ייעלם — הוא פשוט לא יוקלט.
