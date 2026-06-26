export const LANDING_NAV = [
  { href: "#features", label: "יכולות" },
  { href: "#how-it-works", label: "איך זה עובד" },
  { href: "#faq", label: "שאלות נפוצות" },
] as const;

export const LANDING_HERO = {
  kicker: "עובדת משרד מבוססת AI",
  headline: "נטלי — עובדת המשרד שלך",
  subtitle:
    "קוראת מיילים, סורקת חשבוניות, מנהלת משימות ומסדרת מסמכים — כדי שתוכלו להתמקד בעסק.",
  cta: "לרשימת ההמתנה",
  secondaryCta: "לראות יכולות",
  bubble: "שלום! אני נטלי — עובדת המשרד שלך",
} as const;

export const LANDING_INTEGRATIONS = [
  "Gmail",
  "Google Drive",
  "Google Sheets",
  "WhatsApp",
  "חשבוניות",
  "משימות",
] as const;

export const LANDING_FEATURES = [
  {
    title: "סריקת מיילים חכמה",
    description: "מזהה חשבוניות, בקשות ומשימות מתוך Gmail — בלי לפספס כלום.",
  },
  {
    title: "חשבוניות ומסמכים",
    description: "שומרת קבצים בדרייב, מעדכנת גיליונות ומכינה הכול לבדיקה.",
  },
  {
    title: "משימות ותזכורות",
    description: "הופכת הודעות למשימות ברורות עם מעקב עד לסיום.",
  },
  {
    title: "וואטסאפ לבעל העסק",
    description: "שולחים חשבונית או משימה — נטלי מטפלת ומעדכנת בחזרה.",
  },
  {
    title: "תשלומים לספקים",
    description: "מזהה מה לשלם ומתי — בלי תשלום אוטומטי, תמיד בשליטה שלכם.",
  },
  {
    title: "סיכום יומי",
    description: "בוקר אחד ברור: מה דחוף, מה חסר ומה כבר טופל.",
  },
] as const;

export const LANDING_FLOW_STEPS = [
  "הודעה נכנסת ב-Gmail או WhatsApp",
  "נטלי מזהה חשבונית, בקשה או משימה",
  "הקובץ נשמר ומסודר בדרייב",
  "הנתונים מתעדכנים ב-Google Sheets",
  "מקבלים עדכון קצר על מה שחשוב",
] as const;

export const LANDING_FAQ = [
  {
    question: "האם המידע שלי מאובטח?",
    answer:
      "כן. מתחברים דרך OAuth של גוגל, לא שומרים סיסמאות, וניתן לבטל גישה בכל רגע.",
  },
  {
    question: "לאילו שירותים המערכת מתחברת?",
    answer: "Gmail, Google Drive, Google Sheets ו-WhatsApp עסקי.",
  },
  {
    question: "האם צריך ידע טכני?",
    answer: "לא. ההתקנה היא בכמה קליקים — מתחברים לחשבון גוגל ובוחרים מה להפעיל.",
  },
  {
    question: "מתי המוצר יהיה זמין?",
    answer: "אנחנו פותחים גישה בהדרגה. הצטרפו לרשימת ההמתנה כדי להיות מהראשונים.",
  },
  {
    question: "האם המערכת מבצעת תשלומים אוטומטית?",
    answer: "המערכת מזהה חשבוניות ומכינה הכול, אך תשלום תמיד דורש אישור שלכם.",
  },
] as const;

export const LANDING_WAITLIST = {
  kicker: "רשימת המתנה",
  title: "היו מהראשונים לעבוד עם נטלי",
  lead: "הצטרפו לרשימת ההמתנה וקבלו גישה מוקדמת ותנאים מיוחדים להרשמה מוקדמת.",
  submit: "לרשימת ההמתנה",
  note: "בלי ספאם. אפשר לבטל בכל רגע.",
  successTitle: "נרשמתם בהצלחה!",
  tags: ["גישה מוקדמת", "תנאים מיוחדים", "ליווי בהקמה"],
} as const;
