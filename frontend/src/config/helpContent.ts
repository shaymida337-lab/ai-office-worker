export type PageHelpButton = {
  label: string;
  explanation: string;
};

export type PageWalkthroughStep = {
  title: string;
  text: string;
  selector: string;
};

export type PageHelpContent = {
  pageKey: string;
  paths: string[];
  title: string;
  description: string;
  usedFor: string;
  steps: string[];
  buttons: PageHelpButton[];
  commonMistakes: string[];
  troubleshooting: string[];
  videoUrl?: string | null;
  voiceText: string;
  walkthroughSteps: PageWalkthroughStep[];
  supportNote: string;
};

const defaultSupportNote = "אם משהו לא ברור, לחץ על בדוק מערכת או פנה לתמיכה. תמיד אפשר לנסות שוב בלי לפגוע בנתונים.";

export const pageHelpContent: PageHelpContent[] = [
  {
    pageKey: "dashboard",
    paths: ["/dashboard"],
    title: "לוח בקרה",
    description: "בדף הזה רואים את מצב העסק ואת מצב החיבורים של המערכת.",
    usedFor: "כאן מתחילים כל יום: בודקים חיבורים, מריצים סריקות ורואים חשבוניות ותשלומים פתוחים.",
    steps: [
      "בדוק בחלק העליון ש-Gmail, Drive, Sheets, WhatsApp והמסד מחוברים.",
      "אם Gmail לא מחובר, לחץ על Connect Gmail.",
      "אם WhatsApp לא מחובר, לחץ על Connect WhatsApp.",
      "אחרי החיבור לחץ על סרוק Gmail או סרוק WhatsApp.",
      "בדוק את המדדים ואת התשלומים הפתוחים בהמשך הדף.",
    ],
    buttons: [
      { label: "סרוק Gmail", explanation: "מחפש חשבוניות חדשות במייל ומוסיף אותן למערכת." },
      { label: "סרוק WhatsApp", explanation: "בודק הודעות ומסמכים שנשלחו בווטסאפ ומנסה לזהות חשבוניות." },
      { label: "Connect Gmail", explanation: "פותח חיבור מאובטח לחשבון גוגל שלך." },
      { label: "Connect WhatsApp", explanation: "מעביר אותך למסך חיבור והגדרת WhatsApp." },
      { label: "Run System Check", explanation: "בודק שכל החיבורים עובדים: Gmail, Drive, Sheets, WhatsApp ושרת." },
    ],
    commonMistakes: [
      "להריץ סריקה לפני שחיברת Gmail.",
      "לצפות למסמכי WhatsApp לפני שהוגדר מספר WhatsApp.",
      "לסגור את הדף מיד אחרי התחלת סריקה ארוכה.",
    ],
    troubleshooting: [
      "אם Gmail לא מחובר: לחץ על Connect Gmail ואשר הרשאות.",
      "אם WhatsApp לא מחובר: לחץ על Connect WhatsApp והגדר מספר.",
      "אם Sheets נכשל: בדוק את החיבור בהגדרות והרשאות Google.",
      "אם סריקה נכשלה: לחץ Run System Check ואז נסה שוב.",
    ],
    videoUrl: null,
    voiceText: "זהו לוח הבקרה. כאן בודקים שהמערכת מחוברת, מריצים סריקות Gmail ו-WhatsApp, ורואים חשבוניות ותשלומים פתוחים. התחל מחיבור Gmail ו-WhatsApp, ואז הרץ סריקה.",
    walkthroughSteps: [
      { title: "מצב חיבורים", text: "פה רואים אם המערכת מחוברת ל-Gmail, Drive, Sheets, WhatsApp והמסד.", selector: "[data-help='system-connections']" },
      { title: "סריקת Gmail", text: "פה לוחצים כדי לחפש חשבוניות חדשות במייל.", selector: "[data-help='scan-gmail']" },
      { title: "סריקת WhatsApp", text: "פה לוחצים כדי לסרוק הודעות ומסמכים מ-WhatsApp.", selector: "[data-help='scan-whatsapp']" },
      { title: "מדדים", text: "פה רואים כמה חשבוניות, מסמכים ותשלומים פתוחים יש במערכת.", selector: "[data-help='integration-metrics']" },
    ],
    supportNote: defaultSupportNote,
  },
  {
    pageKey: "customers",
    paths: ["/dashboard/clients", "/crm"],
    title: "לקוחות",
    description: "בדף הזה מנהלים לקוחות, פרטי קשר ופעילות עסקית.",
    usedFor: "משתמשים בו כדי להוסיף לקוח, לבדוק סטטוס, לראות משימות וחשבוניות שקשורות אליו.",
    steps: ["לחץ על הוסף לקוח.", "מלא שם, אימייל וטלפון.", "שמור את הלקוח.", "פתח לקוח כדי לראות פעילות ומשימות.", "עדכן פרטים אם משהו השתנה."],
    buttons: [
      { label: "הוסף לקוח", explanation: "פותח טופס ללקוח חדש." },
      { label: "פתח לקוח", explanation: "מציג פרטים, חשבוניות ומשימות של הלקוח." },
      { label: "סרוק לקוחות", explanation: "מחפש פעילות חדשה שקשורה ללקוחות קיימים." },
    ],
    commonMistakes: ["להכניס אימייל שגוי.", "להוסיף אותו לקוח פעמיים.", "לא למלא מספר WhatsApp כשצריך הודעות."],
    troubleshooting: ["אם לקוח לא מופיע, רענן את הדף.", "אם אימייל לא נשמר, בדוק שהוא תקין.", "אם אין פעילות, הרץ סריקה מהדשבורד."],
    videoUrl: null,
    voiceText: "בדף לקוחות מוסיפים לקוחות חדשים ורואים פעילות לכל לקוח. מומלץ להתחיל מהוספת לקוח ראשון עם אימייל וטלפון.",
    walkthroughSteps: [
      { title: "רשימת לקוחות", text: "כאן מופיעים הלקוחות שלך.", selector: "main, .container" },
      { title: "הוספה", text: "חפש כפתור הוסף לקוח כדי ליצור לקוח חדש.", selector: "button, a" },
    ],
    supportNote: defaultSupportNote,
  },
  {
    pageKey: "invoices",
    paths: ["/dashboard/invoices"],
    title: "חשבוניות",
    description: "בדף הזה רואים חשבוניות שנאספו מהמייל, WhatsApp או העלאה ידנית.",
    usedFor: "בודקים סכום, לקוח, סטטוס וקישור למסמך בדרייב.",
    steps: ["בדוק שהחשבונית נכנסה.", "בדוק שהסכום והלקוח נכונים.", "פתח את המסמך בדרייב אם יש קישור.", "עדכן סטטוס אם החשבונית שולמה.", "אם חסר מסמך, הרץ סריקה מחדש."],
    buttons: [
      { label: "פתח בדרייב", explanation: "פותח את קובץ החשבונית שנשמר בדרייב." },
      { label: "סמן כשולמה", explanation: "מעדכן שהחשבונית כבר שולמה." },
      { label: "סרוק Gmail", explanation: "מחפש חשבוניות חדשות במייל." },
    ],
    commonMistakes: ["לסמן כשולם לפני בדיקת הסכום.", "להתעלם מחשבונית בלי קישור.", "לחפש חשבונית לפני שהסריקה הסתיימה."],
    troubleshooting: ["אם חשבונית חסרה, הרץ סריקה.", "אם אין קובץ בדרייב, בדוק חיבור Drive.", "אם סכום לא נכון, פתח את המסמך המקורי ובדוק ידנית."],
    videoUrl: null,
    voiceText: "בדף חשבוניות בודקים חשבוניות שנאספו אוטומטית. פתח את המסמך, בדוק סכום וסטטוס, ועדכן אם שולם.",
    walkthroughSteps: [
      { title: "טבלת חשבוניות", text: "כאן מופיעות החשבוניות שנמצאו.", selector: "table, .card, .container" },
    ],
    supportNote: defaultSupportNote,
  },
  {
    pageKey: "supplier-payments",
    paths: ["/payments"],
    title: "תשלומי ספקים",
    description: "בדף הזה מנהלים תשלומים לספקים וחשבוניות חסרות.",
    usedFor: "בודקים למי צריך לשלם, איזה מסמך חסר ומה כבר שולם.",
    steps: ["בדוק את שם הספק.", "בדוק סכום ותאריך.", "פתח מסמך אם קיים.", "סמן כשולם רק אחרי תשלום אמיתי.", "צרף חשבונית אם המערכת סימנה שחסר מסמך."],
    buttons: [
      { label: "סמן שולם", explanation: "משנה את התשלום לסטטוס שולם." },
      { label: "צרף חשבונית", explanation: "מוסיף קישור למסמך חסר." },
      { label: "הצג כפולים", explanation: "מציג חשבוניות שהמערכת חושדת שהן כפולות." },
    ],
    commonMistakes: ["לסמן שולם בלי לשלם בפועל.", "להתעלם מתשלום כפול.", "לא לצרף חשבונית חסרה."],
    troubleshooting: ["אם ספק לא נכון, בדוק את המסמך המקורי.", "אם התשלום כפול, בדוק מקור Gmail ו-WhatsApp.", "אם Sheets לא מתעדכן, הרץ בדיקת מערכת."],
    videoUrl: null,
    voiceText: "בדף תשלומי ספקים רואים מה צריך לשלם ומה חסר. בדוק סכום וספק לפני סימון כשולם.",
    walkthroughSteps: [{ title: "תשלומים", text: "כאן מופיעים תשלומי הספקים.", selector: "table, .card, .container" }],
    supportNote: defaultSupportNote,
  },
  {
    pageKey: "bank",
    paths: ["/dashboard/bank"],
    title: "התאמת בנק",
    description: "בדף הזה מעלים דוח בנק ומשווים אותו לחשבוניות ותשלומים.",
    usedFor: "משתמשים בו כדי להבין אילו תשלומים כבר ירדו ואילו עדיין פתוחים.",
    steps: ["העלה קובץ דוח בנק.", "חכה שהמערכת תקרא את התנועות.", "בדוק התאמות שהמערכת מצאה.", "אשר התאמות נכונות.", "בדוק ידנית תנועות שלא זוהו."],
    buttons: [
      { label: "העלה קובץ", explanation: "מעלה דוח בנק מהמחשב." },
      { label: "התאם", explanation: "מנסה לחבר בין תנועת בנק לחשבונית או תשלום." },
    ],
    commonMistakes: ["להעלות קובץ לא מתאים.", "לא לבדוק התאמות לפני אישור.", "למחוק תנועה לפני בדיקה."],
    troubleshooting: ["אם הקובץ לא נקרא, שמור אותו מחדש כ-CSV או Excel.", "אם אין התאמות, בדוק תאריכים וסכומים.", "אם משהו לא ברור, אל תאשר לפני בדיקה."],
    videoUrl: null,
    voiceText: "בדף התאמת בנק מעלים דוח בנק ומחברים תנועות לחשבוניות ותשלומים. תמיד בדוק התאמה לפני אישור.",
    walkthroughSteps: [{ title: "העלאת דוח", text: "כאן מתחילים בהעלאת קובץ הבנק.", selector: "input[type='file'], button, .container" }],
    supportNote: defaultSupportNote,
  },
  {
    pageKey: "tasks",
    paths: ["/tasks"],
    title: "משימות",
    description: "בדף הזה מנהלים משימות שנוצרו ידנית או מזוהות מהודעות.",
    usedFor: "מעקב אחרי דברים שצריך לעשות, תזכורות וטיפול בלקוחות.",
    steps: ["בדוק משימות פתוחות.", "פתח משימה כדי להבין מה צריך לעשות.", "עדכן סטטוס אחרי טיפול.", "הוסף משימה ידנית אם צריך.", "בדוק משימות דחופות קודם."],
    buttons: [
      { label: "הוסף משימה", explanation: "יוצר משימה חדשה." },
      { label: "סמן כבוצע", explanation: "מסמן שהמשימה טופלה." },
    ],
    commonMistakes: ["לא לעדכן סטטוס אחרי טיפול.", "ליצור אותה משימה פעמיים.", "להתעלם ממשימות דחופות."],
    troubleshooting: ["אם משימה חסרה, בדוק סריקות הודעות.", "אם סטטוס לא נשמר, רענן ונסה שוב.", "אם יש יותר מדי משימות, סנן לפי עדיפות."],
    videoUrl: null,
    voiceText: "בדף משימות רואים מה צריך לעשות. התחל ממשימות דחופות ועדכן סטטוס אחרי טיפול.",
    walkthroughSteps: [{ title: "רשימת משימות", text: "כאן מופיעות המשימות שלך.", selector: "table, .card, .container" }],
    supportNote: defaultSupportNote,
  },
  {
    pageKey: "whatsapp",
    paths: ["/dashboard/whatsapp"],
    title: "ווטסאפ",
    description: "בדף הזה מחברים WhatsApp ורואים הודעות שנכנסו למערכת.",
    usedFor: "חיבור WhatsApp עסקי, בדיקת הודעות וסריקת מסמכים שהגיעו בווטסאפ.",
    steps: ["בדוק אם WhatsApp מחובר.", "אם לא, הגדר מספר ושלח הודעת בדיקה.", "ודא שה-webhook פעיל.", "שלח מסמך ניסיון.", "חזור לדשבורד ולחץ Scan WhatsApp."],
    buttons: [
      { label: "חבר WhatsApp", explanation: "מחבר את המערכת לחשבון הווטסאפ העסקי שלך." },
      { label: "שלח בדיקה", explanation: "שולח הודעת ניסיון כדי לבדוק שהחיבור עובד." },
      { label: "Scan WhatsApp", explanation: "סורק הודעות ומסמכים שנכנסו." },
    ],
    commonMistakes: ["להגדיר מספר בלי קידומת מדינה.", "לשלוח קובץ לפני שהחיבור עובד.", "לא לבדוק שהודעת בדיקה התקבלה."],
    troubleshooting: ["אם WhatsApp לא מחובר, בדוק מספר והגדרות Twilio.", "אם מסמך לא נקלט, שלח שוב PDF ברור.", "אם אין תגובה, בדוק מערכת מהדשבורד."],
    videoUrl: null,
    voiceText: "בדף ווטסאפ מחברים את המספר העסקי ובודקים הודעות. אחרי החיבור אפשר לסרוק מסמכים שהגיעו בווטסאפ.",
    walkthroughSteps: [{ title: "חיבור WhatsApp", text: "כאן בודקים ומגדירים את חיבור הווטסאפ.", selector: ".container, main" }],
    supportNote: defaultSupportNote,
  },
  {
    pageKey: "settings",
    paths: ["/dashboard/settings", "/dashboard/business-settings"],
    title: "הגדרות",
    description: "בדף הזה מנהלים חיבורים, פרטי עסק והרשאות.",
    usedFor: "בודקים חיבור Gmail, Drive, Sheets, WhatsApp והגדרות כלליות של העסק.",
    steps: ["בדוק אילו חיבורים ירוקים.", "חבר מחדש שירות שלא עובד.", "עדכן פרטי עסק אם צריך.", "שמור שינויים.", "חזור לדשבורד והריץ בדיקת מערכת."],
    buttons: [
      { label: "חבר Gmail", explanation: "מחבר את חשבון גוגל למייל, דרייב ושיטס." },
      { label: "נתק", explanation: "מנתק חיבור קיים. השתמש בזה רק אם צריך לחבר מחדש." },
      { label: "שמור", explanation: "שומר את השינויים בדף." },
    ],
    commonMistakes: ["לנתק Gmail בלי לחבר מחדש.", "לא לשמור אחרי שינוי.", "להשתמש בחשבון גוגל לא נכון."],
    troubleshooting: ["אם חיבור נכשל, נסה להתנתק ולהתחבר מחדש.", "אם Sheets נכשל, ודא שאישרת הרשאות Google.", "אם שינוי לא נשמר, רענן ונסה שוב."],
    videoUrl: null,
    voiceText: "בדף הגדרות מחברים שירותים ומעדכנים פרטי עסק. אחרי כל שינוי חשוב לשמור ולבדוק מערכת.",
    walkthroughSteps: [{ title: "חיבורים", text: "כאן בודקים ומעדכנים את החיבורים.", selector: ".container, main" }],
    supportNote: defaultSupportNote,
  },
  {
    pageKey: "system-check",
    paths: ["/dashboard/admin-debug", "/dashboard/scan-stats", "/message-scans"],
    title: "בדיקת מערכת",
    description: "בדף הזה בודקים אם המערכת והסריקות עובדות תקין.",
    usedFor: "איתור בעיות בחיבורים, סריקות, קבצים ונתונים.",
    steps: ["בדוק אם יש כשל אדום.", "קרא את סיבת הכשל.", "חזור לדשבורד ולחץ Run System Check.", "תקן חיבור חסר.", "הרץ סריקה מחדש."],
    buttons: [
      { label: "בדוק מערכת", explanation: "בודק את כל החיבורים החשובים." },
      { label: "אמת Google Sheets", explanation: "בודק שהטבלה מקבלת נתונים." },
      { label: "נסה שוב", explanation: "מריץ פעולה מחדש אחרי תיקון." },
    ],
    commonMistakes: ["להתעלם מהודעת שגיאה.", "להריץ סריקה לפני תיקון חיבור.", "לשנות הגדרות בלי לשמור."],
    troubleshooting: ["אם Gmail נכשל, חבר מחדש.", "אם Drive נכשל, בדוק הרשאות.", "אם Database נכשל, המתן רגע ורענן."],
    videoUrl: null,
    voiceText: "בדיקת מערכת עוזרת להבין מה עובד ומה לא. קרא את סיבת הכשל ותקן את החיבור המתאים.",
    walkthroughSteps: [{ title: "תוצאות בדיקה", text: "כאן רואים את מצב המערכת והסריקות.", selector: ".container, main" }],
    supportNote: defaultSupportNote,
  },
  {
    pageKey: "missing-invoices",
    paths: ["/reports", "/dashboard/invoice-diagnostics"],
    title: "חשבוניות חסרות",
    description: "בדף הזה בודקים תשלומים שיש להם מסמך חסר או חשבונית שלא זוהתה.",
    usedFor: "איתור פערים בין תשלום, מסמך בדרייב ושורה ב-Google Sheets.",
    steps: ["בדוק איזה ספק חסר.", "פתח את מקור ההודעה אם קיים.", "מצא את החשבונית בדרייב או במייל.", "צרף קישור לחשבונית.", "הרץ בדיקת מערכת אם הפער נשאר."],
    buttons: [
      { label: "צרף חשבונית", explanation: "מוסיף קישור למסמך החסר." },
      { label: "פתח מקור", explanation: "פותח את המייל או המסמך המקורי." },
      { label: "בדוק מערכת", explanation: "בודק אם Sheets ו-Drive מחוברים." },
    ],
    commonMistakes: ["להתעלם מחשבוניות חסרות.", "לצרף קישור למסמך לא נכון.", "לסמן שולם בלי חשבונית."],
    troubleshooting: ["אם אין קישור, חפש במייל לפי ספק וסכום.", "אם המסמך לא בדרייב, בדוק חיבור Drive.", "אם הפער לא נסגר, הרץ סריקה מחדש."],
    videoUrl: null,
    voiceText: "חשבוניות חסרות הן תשלומים שאין להם מסמך מלא. בדוק ספק וסכום, מצא את החשבונית וצרף קישור.",
    walkthroughSteps: [{ title: "פערים", text: "כאן רואים מסמכים חסרים או חשודים.", selector: "table, .card, .container" }],
    supportNote: defaultSupportNote,
  },
];

export const fallbackHelpContent: PageHelpContent = {
  pageKey: "general",
  paths: ["*"],
  title: "עזרה כללית",
  description: "כאן תקבל הסבר קצר על הדף הנוכחי ומה כדאי לעשות.",
  usedFor: "המערכת עוזרת לאסוף חשבוניות, משימות והודעות ממייל, WhatsApp, Drive ו-Sheets.",
  steps: ["קרא את הכותרת בדף.", "בדוק אם יש כפתור פעולה ראשי.", "אם יש חיבור חסר, חבר אותו קודם.", "אם יש שגיאה, לחץ על עזרה או בדוק מערכת."],
  buttons: [
    { label: "עזרה והדרכה", explanation: "פותח הסבר על הדף הנוכחי." },
    { label: "שמור", explanation: "שומר את השינויים שביצעת." },
  ],
  commonMistakes: ["ללחוץ על פעולה לפני חיבור השירותים.", "לא לקרוא הודעת שגיאה.", "לסגור דף בזמן פעולה ארוכה."],
  troubleshooting: ["רענן את הדף ונסה שוב.", "בדוק שהתחברת למערכת.", "אם יש חיבור חסר, חזור להגדרות."],
  videoUrl: null,
  voiceText: "זהו מסך במערכת עובד משרד חכם. קרא את ההסבר, בדוק מה צריך לעשות קודם, ואם משהו נכשל פתח את העזרה.",
  walkthroughSteps: [{ title: "הדף הנוכחי", text: "כאן נמצא התוכן המרכזי של הדף.", selector: "main, .container, body" }],
  supportNote: defaultSupportNote,
};

export function getHelpContentForPath(pathname: string): PageHelpContent {
  const normalized = pathname.replace(/\/$/, "") || "/";
  const exact = pageHelpContent.find((page) => page.paths.some((path) => normalized === path));
  if (exact) return exact;
  const nested = pageHelpContent.find((page) =>
    page.paths.some((path) => path !== "/" && normalized.startsWith(`${path}/`))
  );
  return nested ?? fallbackHelpContent;
}
