export type AutoFixAction = "reload" | "reconnect-gmail" | "clear-cache" | "rescan-gmail";

export type HelpTroubleshooting = {
  problem: string;
  solution: string;
  autoFix?: AutoFixAction | null;
};

export type HelpTopic = {
  id: string;
  title: string;
  shortDesc: string;
  steps?: string[];
  explanation?: string;
  videoUrl?: string | null;
  autoFix?: AutoFixAction | null;
  troubleshooting?: HelpTroubleshooting[];
  relatedTopics?: string[];
};

export type HelpCategory = {
  id: string;
  icon: string;
  title: string;
  description: string;
  color: string;
  topics: HelpTopic[];
};

export const helpCategories: HelpCategory[] = [
  {
    id: "getting-started",
    icon: "🚀",
    title: "התחלה מהירה",
    description: "הגדרה ראשונה של המערכת",
    color: "#10b981",
    topics: [
      {
        id: "first-login",
        title: "כניסה ראשונה למערכת",
        shortDesc: "איך מתחילים לעבוד",
        steps: [
          'לחץ על "התחבר עם Google"',
          "בחר את חשבון Gmail שלך",
          "אשר את ההרשאות הנדרשות",
          "תועבר אוטומטית לדשבורד",
          'לחץ "+ הוסף לקוח" להוספת לקוח ראשון',
        ],
        videoUrl: null,
        autoFix: null,
        relatedTopics: ["add-client", "connect-gmail"],
      },
      {
        id: "connect-gmail",
        title: "חיבור Gmail",
        shortDesc: "איך מחברים את תיבת המייל",
        steps: [
          'לחץ על "התחבר עם Google" בדשבורד',
          "בחר את חשבון Google הרצוי",
          "אשר גישה ל: Gmail, Drive, Sheets",
          "חזור לדשבורד",
          'לחץ "סרוק Gmail" לסריקה ראשונה',
        ],
        troubleshooting: [
          { problem: "הכפתור לא מגיב", solution: "נסה לרענן את הדף ולחץ שוב", autoFix: "reload" },
          { problem: "קיבלתי שגיאה מ-Google", solution: "וודא שאתה מחובר לחשבון Google הנכון", autoFix: null },
        ],
      },
      {
        id: "add-client",
        title: "הוספת לקוח ראשון",
        shortDesc: "איך מוסיפים לקוח חדש",
        steps: ['לחץ על "לקוחות" בתפריט', 'לחץ על "+ הוסף לקוח"', "מלא: שם, מייל, טלפון", 'לחץ "שמור"', "הלקוח יופיע ברשימה מיד"],
      },
    ],
  },
  {
    id: "gmail-issues",
    icon: "📧",
    title: "Gmail וסריקת מיילים",
    description: "בעיות עם חיבור ושליחת מיילים",
    color: "#3b82f6",
    topics: [
      {
        id: "gmail-not-scanning",
        title: "הסריקה לא עובדת",
        shortDesc: "Gmail לא סורק מיילים",
        steps: [
          "וודא שה-Gmail מחובר (כפתור ירוק)",
          'לחץ "נתק" ואז "חבר מחדש"',
          "אשר שוב את ההרשאות ב-Google",
          'לחץ "סרוק Gmail" ידנית',
          "חכה 30-60 שניות לסיום",
        ],
        autoFix: "rescan-gmail",
        troubleshooting: [
          { problem: 'כתוב "0 מיילים נמצאו"', solution: "הסריקה מחפשת 30 יום אחורה. אם אין מיילים מלקוחות בתקופה זו — זה תקין." },
          { problem: "הסריקה תקועה", solution: "רענן את הדף ונסה שוב", autoFix: "reload" },
        ],
      },
      {
        id: "gmail-permission",
        title: "שגיאת הרשאות Gmail",
        shortDesc: "Google לא נותן גישה",
        steps: [
          "פתח: myaccount.google.com",
          'לחץ "אבטחה" → "גישה של צד שלישי"',
          'מצא "AI Office Worker"',
          'לחץ "הסר גישה"',
          "חזור לאפליקציה וחבר מחדש",
        ],
        autoFix: "reconnect-gmail",
      },
    ],
  },
  {
    id: "clients",
    icon: "👥",
    title: "ניהול לקוחות",
    description: "הוספה, עריכה וניהול לקוחות",
    color: "#8b5cf6",
    topics: [
      {
        id: "client-health-score",
        title: "ציון בריאות עסקי",
        shortDesc: "מה המספר 0-100 אומר",
        explanation: `ציון בריאות עסקי מחושב לפי:
• פעילות מייל (30%) — כמה מיילים יש
• תשלומים (30%) — האם משלם בזמן
• משימות (20%) — כמה משימות פתוחות
• תדירות (20%) — כמה פעמים בחודש

🟢 71-100 = לקוח פעיל ובריא
🟡 41-70 = לקוח בינוני, שים לב
🔴 0-40 = לקוח בסיכון, פנה אליו`,
      },
      {
        id: "add-task",
        title: "הוספת משימה ללקוח",
        shortDesc: "איך מוסיפים ומנהלים משימות",
        steps: ['כנס לדף הלקוח', 'לחץ על טאב "משימות"', 'לחץ "+ הוסף משימה"', "מלא: כותרת, תיאור, תאריך, עדיפות", 'לחץ "שמור"'],
      },
    ],
  },
  {
    id: "invoices",
    icon: "🧾",
    title: "חשבוניות ותשלומים",
    description: "ניהול חשבוניות ומעקב תשלומים",
    color: "#f59e0b",
    topics: [
      {
        id: "invoice-not-found",
        title: "חשבונית לא נמצאת",
        shortDesc: "המערכת לא זיהתה חשבונית",
        steps: ["וודא שהמייל עם החשבונית בתיבת Gmail", "בדוק שהמייל לא ב-Spam", 'לחץ "סרוק Gmail" מחדש', "אם עדיין לא — הוסף חשבונית ידנית", 'לחץ "הוסף חשבונית" ומלא פרטים'],
        autoFix: "rescan-gmail",
      },
      {
        id: "update-payment-status",
        title: "עדכון סטטוס תשלום",
        shortDesc: "איך מסמנים חשבונית כשולמה",
        steps: ['כנס ל"חשבוניות" בתפריט', "מצא את החשבונית הרצויה", "לחץ על הסטטוס הנוכחי", 'בחר "שולם" מהרשימה', "הסטטוס יתעדכן מיד"],
      },
    ],
  },
  {
    id: "drive-sheets",
    icon: "📁",
    title: "Google Drive ו-Sheets",
    description: "שמירה וארגון קבצים",
    color: "#06b6d4",
    topics: [
      {
        id: "drive-not-saving",
        title: "קבצים לא נשמרים ב-Drive",
        shortDesc: "Drive לא עובד",
        steps: ['לחץ על "הגדרות" בתפריט', "בדוק שGoogle Drive מחובר (ירוק)", 'אם לא — לחץ "חבר Drive"', "אשר הרשאות", "נסה לשמור קובץ שוב"],
      },
      {
        id: "sheets-not-updating",
        title: "Sheets לא מתעדכן",
        shortDesc: "הטבלה לא מקבלת נתונים",
        steps: ['כנס לדף הלקוח', 'לחץ "סנכרן Sheets"', "פתח את Google Sheets שלך", 'חפש גיליון "AI Office Worker"', 'אם לא קיים — לחץ "צור גיליון חדש"'],
      },
    ],
  },
  {
    id: "account",
    icon: "⚙️",
    title: "חשבון והגדרות",
    description: "ניהול חשבון ומנוי",
    color: "#6b7280",
    topics: [
      {
        id: "cancel-subscription",
        title: "ביטול מנוי",
        shortDesc: "איך מבטלים את המנוי",
        steps: ['כנס ל"הגדרות"', 'לחץ על "מנוי ותשלום"', 'לחץ "בטל מנוי"', "אשר את הביטול", "המנוי יפסיק בסוף התקופה הנוכחית"],
      },
      {
        id: "change-email",
        title: "שינוי חשבון Google",
        shortDesc: "איך מחברים חשבון אחר",
        steps: ['לחץ על שמך בפינה הימנית עליונה', 'לחץ "התנתק"', 'לחץ "התחבר עם Google"', "בחר חשבון Google אחר", "אשר הרשאות"],
        autoFix: "clear-cache",
      },
    ],
  },
];

export const commonIssues = [
  "gmail-not-scanning",
  "gmail-permission",
  "invoice-not-found",
  "drive-not-saving",
];

export function getAllHelpTopics() {
  return helpCategories.flatMap((category) => category.topics.map((topic) => ({ ...topic, category })));
}
