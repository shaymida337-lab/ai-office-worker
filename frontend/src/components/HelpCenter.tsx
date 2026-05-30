"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { apiFetch, getToken } from "@/lib/api";
import { commonIssues, getAllHelpTopics, helpCategories, type AutoFixAction, type HelpTopic } from "@/data/helpTopics";

type TopicWithCategory = ReturnType<typeof getAllHelpTopics>[number];
type ChatMessage = { role: "user" | "assistant"; text: string };
type ChecklistItem = { id: string; label: string; done: boolean; href: string };
type SmartHelpTourStep = { title: string; text: string; selector?: string; label?: string };
type SmartHelpContent = {
  key: string;
  paths: string[];
  title: string;
  pagePurpose: string;
  videoUrl: string;
  videoSubtitles: string[];
  voiceText: string;
  tourSteps: SmartHelpTourStep[];
  faqs: Array<{ question: string; answer: string }>;
  nextActions: Array<{ title: string; href: string }>;
};
type SmartHelpUxDetails = {
  beginner: string;
  advanced: string;
  example: string;
  tips: string[];
  warning?: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const SUPPORT_PHONE = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? process.env.NEXT_PUBLIC_OWNER_WHATSAPP ?? "").replace(/[^\d]/g, "");

const defaultChecklist: ChecklistItem[] = [
  { id: "gmail", label: "חבר ג׳ימייל", done: false, href: "/dashboard" },
  { id: "client", label: "הוסף לקוח ראשון", done: false, href: "/dashboard/clients" },
  { id: "scan", label: "הרץ סריקה ראשונה", done: false, href: "/dashboard" },
  { id: "report", label: "צפה בדוח ראשון", done: false, href: "/dashboard/accountant" },
];

const smartHelpPages: SmartHelpContent[] = [
  {
    key: "dashboard",
    paths: ["/dashboard"],
    title: "לוח בקרה",
    pagePurpose: "הדשבורד מרכז את מצב העסק: חשבוניות, תשלומי ספקים, סריקות ג׳ימייל, דרייב, שיטס, וואטסאפ ומשימות פתוחות. זה המקום להתחיל ממנו כל יום.",
    videoUrl: "https://www.youtube.com/embed/ysz5S6PUM-U?cc_load_policy=1&hl=he",
    videoSubtitles: ["איך לקרוא את המדדים", "איך להתחיל סריקת ג׳ימייל", "איך לפתוח את מרכז הפעולות"],
    voiceText: "זהו לוח הבקרה. כאן רואים מה דורש טיפול עכשיו, מפעילים סריקות, בודקים חשבוניות ותשלומי ספקים, וממשיכים לדפים החשובים.",
    tourSteps: [
      { title: "כאן מתחילים", text: "בדוק את המדדים הראשיים ואת ההמלצה של מרכז הפעולות.", label: "לוח בקרה" },
      { title: "סריקת ג׳ימייל", text: "הכפתור מפעיל סריקה שמאתרת חשבוניות, קבלות, תשלומים ומשימות.", label: "סרוק ג׳ימייל" },
      { title: "מרכז הפעולות", text: "כאן המערכת אומרת בדיוק מה כדאי לעשות עכשיו.", label: "מה כדאי לעשות עכשיו" },
      { title: "סטטיסטיקות סריקה", text: "כאן בודקים מה נמצא, מה נשמר בדרייב ומה עודכן בשיטס.", label: "פתח סטטיסטיקות סריקה" },
    ],
    faqs: [
      { question: "מה לבדוק קודם?", answer: "התחל ממרכז הפעולות. הוא מסדר עבורך דחוף, חשוב ומומלץ." },
      { question: "למה אין נתונים?", answer: "בדרך כלל צריך לחבר ג׳ימייל ולהריץ סריקה ראשונה." },
    ],
    nextActions: [
      { title: "חבר ג׳ימייל או הפעל סריקה", href: "/dashboard/settings" },
      { title: "בדוק סטטיסטיקות סריקה", href: "/dashboard/scan-stats" },
    ],
  },
  {
    key: "crm",
    paths: ["/crm"],
    title: "ניהול לקוחות",
    pagePurpose: "עמוד ניהול הלקוחות עוזר לעקוב אחרי לידים, לקוחות, סטטוס טיפול, ערך עסקה ותהליך מכירה.",
    videoUrl: "https://www.youtube.com/embed/ysz5S6PUM-U?cc_load_policy=1&hl=he",
    videoSubtitles: ["איך להוסיף ליד", "איך לסנן לידים", "איך לעבור בין לוח שלבים לרשימה"],
    voiceText: "בעמוד ניהול הלקוחות תוכל להוסיף לידים, לסנן לפי מקור ושלב, ולעקוב אחרי תהליך המכירה.",
    tourSteps: [
      { title: "הוסף ליד", text: "כאן מוסיפים פנייה חדשה או לקוח פוטנציאלי.", label: "הוסף ליד" },
      { title: "סריקת לידים", text: "כאן מחפשים לידים חדשים מתוך ג׳ימייל.", label: "סרוק לידים מג׳ימייל" },
      { title: "תצוגות עבודה", text: "אפשר לעבור בין לוח שלבים, רשימה ותהליך מכירה.", label: "לוח שלבים" },
    ],
    faqs: [
      { question: "מתי ליד הופך ללקוח?", answer: "כאשר יש קשר עסקי פעיל או עסקה בתהליך, כדאי לעדכן את השלב שלו." },
      { question: "למה סריקת לידים לא מוצאת כלום?", answer: "צריך ג׳ימייל מחובר ומיילים רלוונטיים בתקופת הסריקה." },
    ],
    nextActions: [
      { title: "הוסף ליד ראשון", href: "/crm" },
      { title: "סרוק לידים מג׳ימייל", href: "/crm" },
    ],
  },
  {
    key: "customers",
    paths: ["/dashboard/clients"],
    title: "לקוחות",
    pagePurpose: "כאן מנהלים כרטיסי לקוחות, פרטי קשר, פעילות, חשבוניות, משימות וקישורי דרייב ושיטס לכל לקוח.",
    videoUrl: "https://www.youtube.com/embed/ysz5S6PUM-U?cc_load_policy=1&hl=he",
    videoSubtitles: ["איך להוסיף לקוח", "איך לפתוח כרטיס לקוח", "איך לבדוק סטטוס לקוח"],
    voiceText: "עמוד הלקוחות מרכז את כל הלקוחות והפעילות שלהם. פתח כרטיס לקוח כדי לראות חשבוניות, תשלומים ומשימות.",
    tourSteps: [
      { title: "הוספת לקוח", text: "התחל בהוספת לקוח עם שם, אימייל וטלפון.", label: "הוסף לקוח" },
      { title: "פתיחת כרטיס", text: "פתח כרטיס לקוח כדי לראות פעילות מפורטת.", label: "פתח כרטיס לקוח" },
    ],
    faqs: [
      { question: "האם לקוחות נוצרים אוטומטית?", answer: "כן, סריקות ג׳ימייל יכולות לזהות לקוחות פוטנציאליים, אבל כדאי לבדוק ולאשר." },
      { question: "מה רואים בכרטיס לקוח?", answer: "פרטי קשר, חשבוניות, תשלומים, משימות וקישורי עבודה." },
    ],
    nextActions: [{ title: "הוסף לקוח ראשון", href: "/dashboard/clients" }],
  },
  {
    key: "invoices",
    paths: ["/dashboard/invoices"],
    title: "חשבוניות",
    pagePurpose: "עמוד החשבוניות מציג חשבוניות וקבלות שזוהו או נשמרו, כולל סכום, סטטוס, לקוח וקישור לקובץ בדרייב.",
    videoUrl: "https://www.youtube.com/embed/ysz5S6PUM-U?cc_load_policy=1&hl=he",
    videoSubtitles: ["איך לסנן חשבוניות", "איך לבדוק סטטוס", "איך לפתוח קובץ בדרייב"],
    voiceText: "כאן בודקים חשבוניות וקבלות. השתמש בסינון כדי למצוא חשבונית, ופתח את הקובץ בדרייב כשצריך לבדוק מקור.",
    tourSteps: [
      { title: "סרוק חשבוניות", text: "מפעיל סריקה למציאת חשבוניות אצל לקוחות עם ג׳ימייל מחובר.", label: "סרוק חשבוניות" },
      { title: "סינון", text: "סנן לפי לקוח, סטטוס או מספר חשבונית.", label: "סינון וחיפוש" },
    ],
    faqs: [
      { question: "למה חשבונית לא מופיעה?", answer: "בדוק שהמייל נמצא בג׳ימייל, שג׳ימייל מחובר, ושהסריקה הסתיימה." },
      { question: "מה לעשות עם חשבונית באיחור?", answer: "פתח את החשבונית, בדוק סטטוס ותזמן פעולה מול הלקוח." },
    ],
    nextActions: [
      { title: "בדוק חשבוניות אחרונות", href: "/dashboard/invoices" },
      { title: "פתח סטטיסטיקות סריקה", href: "/dashboard/scan-stats" },
    ],
  },
  {
    key: "suppliers",
    paths: ["/payments"],
    title: "תשלומי ספקים",
    pagePurpose: "כאן עוקבים אחרי דרישות תשלום, תשלומים פתוחים, קבלות חסרות וחשבוניות ספקים שנמצאו בסריקות.",
    videoUrl: "https://www.youtube.com/embed/ysz5S6PUM-U?cc_load_policy=1&hl=he",
    videoSubtitles: ["איך לבדוק תשלום ספק", "איך לסמן שולם", "איך לצרף קבלה או חשבונית"],
    voiceText: "עמוד הספקים מציג תשלומים שצריך לטפל בהם. בדוק סכום, תאריך יעד, מסמך וחשבונית חסרה.",
    tourSteps: [
      { title: "תשלומי ספקים", text: "כאן מופיעים תשלומים שנמצאו או הוזנו.", label: "תשלומי ספקים" },
      { title: "מסמך וחשבונית", text: "פתח מסמך מקור או צרף חשבונית חסרה.", label: "פתח מסמך" },
    ],
    faqs: [
      { question: "מה זו חשבונית חסרה?", answer: "תשלום שיש לו דרישת תשלום או מסמך, אבל אין קבלה או חשבונית סופית." },
      { question: "איך סוגרים תשלום?", answer: "סמן אותו כשולם וצרף קישור לחשבונית אם חסרה." },
    ],
    nextActions: [{ title: "בדוק תשלומים פתוחים", href: "/payments" }],
  },
  {
    key: "documents",
    paths: ["/camera", "/dashboard/scan-stats"],
    title: "מסמכים, דרייב ושיטס",
    pagePurpose: "כאן בודקים שמסמכים נשמרים בדרייב, ששורות מתעדכנות בשיטס, ושסריקות יוצרות קישורים נקיים למסמכי המקור.",
    videoUrl: "https://www.youtube.com/embed/ysz5S6PUM-U?cc_load_policy=1&hl=he",
    videoSubtitles: ["איך להעלות חשבונית", "איך לבדוק שמירה בדרייב", "איך לבדוק עדכון שיטס"],
    voiceText: "מודול המסמכים עוזר לשמור קבצים בדרייב ולעדכן שיטס. בדוק סטטיסטיקות כדי לוודא שהקישורים נוצרו.",
    tourSteps: [
      { title: "צילום או העלאה", text: "אפשר לצלם או להעלות חשבונית ידנית.", label: "חשבונית" },
      { title: "סטטיסטיקות", text: "בדוק כמה קבצים נשמרו בדרייב וכמה שורות עודכנו בשיטס.", label: "סטטיסטיקות סריקה" },
    ],
    faqs: [
      { question: "איפה הקבצים נשמרים?", answer: "בדרייב של המשתמש, בתיקיות לפי ספק וסוג מסמך." },
      { question: "מתי שיטס מתעדכן?", answer: "לאחר סריקה או יצירת תשלום/משימה שמצריכים שורה בגיליון." },
    ],
    nextActions: [{ title: "פתח סטטיסטיקות סריקה", href: "/dashboard/scan-stats" }],
  },
  {
    key: "tasks",
    paths: ["/tasks"],
    title: "משימות",
    pagePurpose: "עמוד המשימות מרכז פעולות שנוצרו מסריקות, מלקוחות ומטיפול שוטף כדי ששום דבר לא ייפול בין הכיסאות.",
    videoUrl: "https://www.youtube.com/embed/ysz5S6PUM-U?cc_load_policy=1&hl=he",
    videoSubtitles: ["איך לבדוק משימות פתוחות", "איך לסמן משימה שבוצעה", "איך לזהות משימות דחופות"],
    voiceText: "כאן נמצאות המשימות הפתוחות והמשימות שבוצעו. התחל ממשימות פעילות ועדיפות גבוהה.",
    tourSteps: [
      { title: "משימות פעילות", text: "כאן רואים מה עדיין צריך טיפול.", label: "משימות פעילות" },
      { title: "משימות שבוצעו", text: "כאן אפשר לבדוק מה נסגר.", label: "משימות שבוצעו" },
    ],
    faqs: [
      { question: "מי יוצר משימות?", answer: "המערכת יכולה ליצור משימות מסריקות, ואתה יכול להוסיף ידנית." },
      { question: "איך יודעים מה דחוף?", answer: "בדוק עדיפות ותאריך יעד, וגם את מרכז הפעולות בדשבורד." },
    ],
    nextActions: [{ title: "בדוק משימות פעילות", href: "/tasks" }],
  },
  {
    key: "whatsapp",
    paths: ["/dashboard/whatsapp"],
    title: "וואטסאפ",
    pagePurpose: "מודול וואטסאפ מיועד לשיחות עסקיות, התראות, לידים ותזכורות ללקוחות.",
    videoUrl: "https://www.youtube.com/embed/ysz5S6PUM-U?cc_load_policy=1&hl=he",
    videoSubtitles: ["איך לחבר וואטסאפ", "איך לבדוק שיחות פעילות", "איך להשתמש בתבניות"],
    voiceText: "כאן מחברים ומנהלים וואטסאפ עסקי. אחרי החיבור אפשר לעקוב אחרי שיחות, לידים והתראות.",
    tourSteps: [
      { title: "סטטוס חיבור", text: "בדוק אם וואטסאפ מחובר ומוכן.", label: "וואטסאפ" },
      { title: "הגדרות", text: "פתח הגדרות כדי להגדיר מספרים ותבניות.", label: "הגדרות" },
    ],
    faqs: [
      { question: "חייבים וואטסאפ?", answer: "לא, אבל הוא משלים את המערכת עם תזכורות ושיחות לקוחות." },
      { question: "האם זה פוגע בג׳ימייל?", answer: "לא. וואטסאפ הוא מודול נפרד ולא משנה את סריקת ג׳ימייל." },
    ],
    nextActions: [{ title: "פתח הגדרות וואטסאפ", href: "/dashboard/whatsapp" }],
  },
  {
    key: "reports",
    paths: ["/reports", "/dashboard/accountant"],
    title: "דוחות",
    pagePurpose: "עמודי הדוחות מציגים תמונת מצב לרואה חשבון, תשלומים, חשבוניות וחוסרים שדורשים טיפול.",
    videoUrl: "https://www.youtube.com/embed/ysz5S6PUM-U?cc_load_policy=1&hl=he",
    videoSubtitles: ["איך לקרוא דוח", "איך למצוא חוסרים", "איך להכין חומר לרואה חשבון"],
    voiceText: "כאן בודקים דוחות וסיכומים. השתמש בדוח כדי להבין מה חסר ומה צריך לשלוח לרואה החשבון.",
    tourSteps: [
      { title: "סיכום", text: "התחל מהמספרים המרכזיים בדוח.", label: "דוחות" },
      { title: "קבצים", text: "פתח קישורי דרייב אם קיימים כדי לבדוק מקור.", label: "פתח" },
    ],
    faqs: [
      { question: "מתי הדוח מתעדכן?", answer: "לאחר סריקות ועדכון חשבוניות ותשלומים." },
      { question: "מה לשלוח לרואה חשבון?", answer: "חשבוניות, קבלות, דוח תשלומי ספקים וחוסרים פתוחים." },
    ],
    nextActions: [{ title: "בדוק דוחות", href: "/reports" }],
  },
  {
    key: "settings",
    paths: ["/dashboard/settings", "/dashboard/business-settings", "/onboarding"],
    title: "הגדרות ואונבורדינג",
    pagePurpose: "כאן מגדירים סוג עסק, מודולים, ג׳ימייל, וואטסאפ, חשבונית ירוקה, רואה חשבון והתראות.",
    videoUrl: "https://www.youtube.com/embed/ysz5S6PUM-U?cc_load_policy=1&hl=he",
    videoSubtitles: ["איך לחבר ג׳ימייל", "איך לבחור מודולים", "איך להגדיר רואה חשבון והתראות"],
    voiceText: "עמוד ההגדרות מנהל את החיבורים והמודולים. חבר ג׳ימייל קודם, ואז בדוק וואטסאפ, חשבונית ירוקה והתראות.",
    tourSteps: [
      { title: "חיבורים", text: "כאן מחברים ג׳ימייל, וואטסאפ וסושיאל.", label: "חיבורים" },
      { title: "ג׳ימייל", text: "זה החיבור החשוב לסריקת מיילים, דרייב ושיטס.", label: "חבר ג׳ימייל" },
      { title: "סוג עסק", text: "כאן מתאימים את המערכת לסוג העסק.", label: "סוג עסק" },
    ],
    faqs: [
      { question: "מה חובה להגדיר?", answer: "ג׳ימייל הוא החיבור המרכזי. שאר המודולים לפי צורך העסק." },
      { question: "אפשר לשנות סוג עסק?", answer: "כן, דרך הגדרות עסק ניתן לעדכן מודולים וסוג עסק." },
    ],
    nextActions: [
      { title: "חבר ג׳ימייל", href: "/dashboard/settings" },
      { title: "התאם מודולים", href: "/dashboard/business-settings" },
    ],
  },
];

const smartHelpUxDetails: Record<string, SmartHelpUxDetails> = {
  dashboard: {
    beginner: "אם זו הפעם הראשונה שלך, הסתכל רק על שלושה דברים: האם ג׳ימייל מחובר, האם יש פעולה דחופה במרכז הפעולות, והאם יש תשלום או חשבונית שמחכים לטיפול.",
    advanced: "משתמשים מנוסים יכולים לפתוח סטטיסטיקות סריקה, לבדוק כמה מסמכים נשמרו בדרייב, כמה שורות עודכנו בשיטס, ומה נשאר לבדיקה ידנית.",
    example: "דוגמה: בבוקר נכנסים לדשבורד, רואים 'חסרות 2 קבלות לספקים', לוחצים על הפעולה ומטפלים בזה לפני שמתחילים עבודה חדשה.",
    tips: ["התחל תמיד מהפעולה הדחופה ביותר.", "אם אין נתונים, סביר שצריך חיבור ג׳ימייל או סריקה ראשונה.", "בדיקה יומית של שתי דקות מספיקה לרוב העסקים."],
  },
  crm: {
    beginner: "כאן שומרים אנשים שדיברו איתך: מתעניינים, לקוחות קיימים או לקוחות שצריך לחזור אליהם.",
    advanced: "אפשר לסנן לפי מקור, שלב, שווי עסקה ותאריך כדי להבין איפה יש הזדמנויות שלא טופלו.",
    example: "דוגמה: לקוח כתב בוואטסאפ שהוא רוצה הצעת מחיר. מוסיפים אותו כליד, מסמנים שלב 'הצעת מחיר', וקובעים משימת המשך.",
    tips: ["אל תשאיר ליד בלי שלב ברור.", "הוסף הערה קצרה אחרי כל שיחה.", "לידים חמים כדאי לסמן בתגית כדי למצוא אותם מהר."],
  },
  customers: {
    beginner: "כאן נמצאת רשימת הלקוחות שלך. כל לקוח הוא כרטיס שבו אפשר לראות פרטים, מסמכים, חשבוניות ומשימות.",
    advanced: "בכרטיס לקוח אפשר לעקוב אחרי פעילות לאורך זמן ולזהות מי צריך גבייה, מסמך, פגישה או פולואפ.",
    example: "דוגמה: לקוח ביקש חשבונית. פותחים את הכרטיס שלו ובודקים אם כבר קיימת חשבונית או משימה פתוחה.",
    tips: ["הוסף אימייל וטלפון כדי שהמערכת תזהה פעילות טוב יותר.", "פתח כרטיס לקוח לפני שליחת מסמך חשוב.", "לקוח בלי פרטי קשר מלאים קשה לעקוב אחריו."],
  },
  invoices: {
    beginner: "כאן רואים חשבוניות וקבלות. המטרה היא לוודא שכל הכנסה או מסמך חשוב מופיע במקום אחד.",
    advanced: "אפשר לסנן לפי סטטוס, לקוח ומספר חשבונית כדי למצוא טעויות, מסמכים חסרים או חיובים שמחכים לטיפול.",
    example: "דוגמה: אם לקוח שואל 'שלחת לי חשבונית?', נכנסים לכאן, מחפשים לפי שם או מספר, ופותחים את הקובץ.",
    tips: ["בדוק סכום ותאריך לפני שמסתמכים על חשבונית.", "אם חשבונית לא מופיעה, נסה סריקה או בדוק סטטיסטיקות.", "קישור לדרייב הוא סימן טוב שהקובץ נשמר."],
  },
  suppliers: {
    beginner: "כאן רואים למי העסק צריך לשלם, ומה חסר כדי לסגור את התשלום בצורה מסודרת.",
    advanced: "אפשר לבדוק תשלומי ספקים לפי סטטוס, מסמך מקור, חשבונית חסרה ותאריך יעד.",
    example: "דוגמה: ספק שלח דרישת תשלום אבל אין קבלה. המערכת תציג שחסרה חשבונית ותציע לצרף קישור.",
    tips: ["אל תסמן תשלום כשולם לפני שבדקת את הסכום.", "קבלה חסרה כדאי לסגור באותו יום.", "תשלום בלי מסמך עלול ליצור בלגן מול רואה החשבון."],
    warning: "לפני סימון תשלום כשולם, ודא שבאמת שילמת ושיש לך מסמך מתאים.",
  },
  documents: {
    beginner: "כאן בודקים מסמכים: חשבוניות, קבלות, קבצים ותמונות שצריכים להישמר במקום מסודר.",
    advanced: "משתמשים מנוסים יכולים לבדוק כמה קבצים נשמרו בדרייב וכמה נתונים עודכנו בשיטס אחרי כל סריקה.",
    example: "דוגמה: צילמת קבלה של ספק. מעלים אותה, ואז בודקים שהיא נשמרה בדרייב ומקושרת לתשלום הנכון.",
    tips: ["תן לקובץ שם ברור אם אתה מעלה ידנית.", "בדוק סטטיסטיקות אחרי סריקה גדולה.", "אם אין קישור לדרייב, אל תמחק את הקובץ המקורי."],
  },
  tasks: {
    beginner: "משימה היא פעולה שצריך לעשות: לחזור ללקוח, לשלוח חשבונית, לבדוק מסמך או לסגור תשלום.",
    advanced: "אפשר לעבוד לפי עדיפות, תאריך יעד וספק/לקוח כדי לנהל יום עבודה בלי לפספס דברים.",
    example: "דוגמה: מייל מלקוח אומר 'תשלח לי הצעה'. המערכת יכולה ליצור משימה, ואתה מסמן אותה כבוצעה אחרי השליחה.",
    tips: ["התחל ממשימות דחופות.", "סגור משימה רק אחרי שבאמת טיפלת בה.", "משימה בלי תאריך יעד קל לשכוח."],
  },
  whatsapp: {
    beginner: "וואטסאפ עוזר לנהל שיחות עם לקוחות ולשלוח תזכורות בלי לחפש ידנית הודעות.",
    advanced: "אחרי חיבור אפשר לעקוב אחרי שיחות פעילות, לידים ותבניות הודעה שמקצרות עבודה חוזרת.",
    example: "דוגמה: לקוח לא שילם. אפשר לשלוח תזכורת מסודרת במקום לכתוב הודעה מחדש בכל פעם.",
    tips: ["השתמש בתבניות להודעות חוזרות.", "אל תשלח הודעה לפני שבדקת את פרטי הלקוח.", "חיבור וואטסאפ לא משנה את סריקת ג׳ימייל."],
  },
  reports: {
    beginner: "הדוחות עוזרים להבין מה מצב העסק ומה צריך להכין לרואה החשבון.",
    advanced: "אפשר להשוות הכנסות, תשלומי ספקים, חוסרים ומשימות כדי לזהות בעיות לפני סוף חודש.",
    example: "דוגמה: לפני שיחה עם רואה החשבון, נכנסים לדוחות ובודקים אם יש קבלות חסרות או תשלומים פתוחים.",
    tips: ["בדוק דוחות אחרי סריקה גדולה.", "אל תשלח דוח לפני שסגרת חוסרים חשובים.", "דוח טוב מתחיל במסמכים מסודרים."],
  },
  settings: {
    beginner: "כאן מחברים את הדברים שהמערכת צריכה: ג׳ימייל, וואטסאפ, סוג העסק והמודולים שרוצים להשתמש בהם.",
    advanced: "אפשר לשנות סוג עסק, להפעיל או להסתיר מודולים, ולנהל חיבורים שמשפיעים על סריקות, דרייב ושיטס.",
    example: "דוגמה: אם העסק הוא שיפוצים, בוחרים תבנית שיפוצים כדי לקבל שדות, מדדים והמלצות שמתאימים לפרויקטים.",
    tips: ["חבר ג׳ימייל לפני סריקה ראשונה.", "אל תשנה מודולים באמצע עבודה חשובה אם אינך בטוח.", "אפשר לחזור להגדרות ולשנות תבנית בהמשך."],
    warning: "שינוי חיבורים או ניקוי נתונים מקומיים עלול לנתק אותך זמנית. בצע זאת רק אם אתה מבין מה הפעולה עושה.",
  },
};

export function HelpCenter() {
  const pathname = usePathname();
  const allTopics = useMemo(() => getAllHelpTopics(), []);
  const commonTopics = useMemo(() => allTopics.filter((topic) => commonIssues.includes(topic.id)), [allTopics]);
  const pageHelp = useMemo(() => smartHelpForPath(pathname), [pathname]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [topic, setTopic] = useState<TopicWithCategory | null>(null);
  const [activeSection, setActiveSection] = useState<"page" | "library">("page");
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [tourTarget, setTourTarget] = useState<DOMRect | null>(null);
  const [completedTutorials, setCompletedTutorials] = useState<Record<string, boolean>>({});
  const [triedSolution, setTriedSolution] = useState(false);
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [question, setQuestion] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [autoFixLoading, setAutoFixLoading] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [checklist, setChecklist] = useState(defaultChecklist);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (open && getToken()) void loadChecklist();
  }, [open]);

  useEffect(() => {
    const openHelp = () => {
      setActiveSection("page");
      setOpen(true);
    };
    window.addEventListener("open-help-center", openHelp);
    return () => window.removeEventListener("open-help-center", openHelp);
  }, []);

  useEffect(() => {
    try {
      setCompletedTutorials(JSON.parse(localStorage.getItem("smartHelpProgress") ?? "{}") as Record<string, boolean>);
    } catch {
      setCompletedTutorials({});
    }
  }, []);

  useEffect(() => {
    if (tourStep === null) {
      setTourTarget(null);
      return;
    }

    const updateTarget = () => setTourTarget(findTourTarget(pageHelp.tourSteps[tourStep] ?? null));
    updateTarget();
    window.addEventListener("resize", updateTarget);
    window.addEventListener("scroll", updateTarget, true);
    return () => {
      window.removeEventListener("resize", updateTarget);
      window.removeEventListener("scroll", updateTarget, true);
    };
  }, [pageHelp, tourStep]);

  const selectedCategory = helpCategories.find((category) => category.id === categoryId) ?? null;
  const searchResults = useMemo(() => {
    if (!debouncedSearch) return [];
    const query = debouncedSearch.toLowerCase();
    return allTopics.filter((item) =>
      [item.title, item.shortDesc, item.category.title, item.explanation, ...(item.steps ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [allTopics, debouncedSearch]);

  async function loadChecklist() {
    try {
      const [gmail, clients, scan] = await Promise.all([
        apiFetch<{ connected: boolean }>("/api/integrations/gmail/status"),
        apiFetch<{ clients: unknown[] }>("/api/clients"),
        apiFetch<{ last: { status: string } | null }>("/api/automation/scan-status"),
      ]);
      setChecklist([
        { id: "gmail", label: "חבר ג׳ימייל", done: gmail.connected, href: "/dashboard" },
        { id: "client", label: "הוסף לקוח ראשון", done: clients.clients.length > 0, href: "/dashboard/clients" },
        { id: "scan", label: "הרץ סריקה ראשונה", done: Boolean(scan.last), href: "/dashboard" },
        { id: "report", label: "צפה בדוח ראשון", done: scan.last?.status === "success", href: "/dashboard/accountant" },
      ]);
    } catch {
      setChecklist(defaultChecklist);
    }
  }

  function openTopic(nextTopic: TopicWithCategory) {
    setTopic(nextTopic);
    setCategoryId(nextTopic.category.id);
    setTriedSolution(false);
    setShowWhatsApp(false);
  }

  function saveTutorialDone(pageKey = pageHelp.key) {
    setCompletedTutorials((current) => {
      const next = { ...current, [pageKey]: true };
      localStorage.setItem("smartHelpProgress", JSON.stringify(next));
      return next;
    });
  }

  function startTour() {
    setOpen(false);
    setTourStep(0);
  }

  function stopTour(done: boolean) {
    if (done) saveTutorialDone();
    setTourStep(null);
  }

  function speakPageHelp() {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(pageHelp.voiceText);
    utterance.lang = "he-IL";
    utterance.rate = 0.92;
    window.speechSynthesis.speak(utterance);
  }

  async function runAutoFix(action: AutoFixAction | null | undefined) {
    setTriedSolution(true);
    if (!action) return;
    if (action === "reload") window.location.reload();
    if (action === "clear-cache") {
      localStorage.clear();
      window.location.reload();
    }
    if (action === "reconnect-gmail") window.location.href = `${API_URL}/auth/google`;
    if (action === "rescan-gmail") {
      setAutoFixLoading(true);
      setChat((messages) => [...messages, { role: "assistant", text: "אני מנסה לפתור את זה בשבילך..." }]);
      try {
        const result = await apiFetch<{ invoicesFound: number; emailsScanned: number; clientsFound: number; labelCreated: boolean }>("/api/help/auto-fix/invoices", { method: "POST" });
        setChat((messages) => [
          ...messages,
          {
            role: "assistant",
            text: `סיימתי ניסיון טיפול. נמצאו ${result.invoicesFound} חשבוניות, נבדקו ${result.emailsScanned} מיילים ונמצאו ${result.clientsFound} לקוחות${result.labelCreated ? " · נוסף סימון בג׳ימייל לחשבוניות" : ""}.`,
          },
        ]);
      } catch (err) {
        setChat((messages) => [...messages, { role: "assistant", text: err instanceof Error ? err.message : "לא הצלחתי לפתור את זה לבד. נסה לחבר ג׳ימייל מחדש." }]);
      } finally {
        setAutoFixLoading(false);
      }
    }
  }

  async function askAi() {
    const clean = question.trim();
    if (!clean || aiLoading) return;
    setChat((messages) => [...messages, { role: "user", text: clean }]);
    setQuestion("");
    setAiLoading(true);
    try {
      const result = await apiFetch<{ answer: string }>("/api/help/ask", { method: "POST", body: JSON.stringify({ question: clean }) });
      setChat((messages) => [...messages, { role: "assistant", text: result.answer }]);
      if (result.answer.includes("לא מצאתי תשובה")) setShowWhatsApp(true);
    } catch {
      setChat((messages) => [...messages, { role: "assistant", text: "לא מצאתי תשובה, שלח לנו וואטסאפ" }]);
      setShowWhatsApp(true);
    } finally {
      setAiLoading(false);
    }
  }

  const completion = Math.round((checklist.filter((item) => item.done).length / checklist.length) * 100);

  return (
    <>
      <button className="smart-help-button" type="button" onClick={() => { setActiveSection("page"); setOpen(true); }} aria-label="עזרה והדרכה">
        <span>🎓</span>
        <strong>עזרה והדרכה</strong>
      </button>
      {tourStep !== null && (
        <GuidedTourOverlay
          content={pageHelp}
          stepIndex={tourStep}
          target={tourTarget}
          onNext={() => {
            if (tourStep >= pageHelp.tourSteps.length - 1) stopTour(true);
            else setTourStep(tourStep + 1);
          }}
          onBack={() => setTourStep(Math.max(0, tourStep - 1))}
          onClose={() => stopTour(false)}
        />
      )}
      {open && (
        <div className="help-overlay" role="dialog" aria-modal="true">
          <div className="help-modal">
            <header className="help-header">
              <div>
                <h2>מרכז עזרה והדרכה</h2>
                <p>הדרכה חכמה לפי הדף שבו אתה נמצא</p>
              </div>
              <button className="help-close" onClick={() => setOpen(false)} aria-label="סגור">×</button>
              <input className="help-search" placeholder="חפש בעיה או שאלה..." value={search} onChange={(event) => setSearch(event.target.value)} />
            </header>
            <main className="help-body">
              {topic ? (
                <TopicDetail
                  topic={topic}
                  autoFixLoading={autoFixLoading}
                  triedSolution={triedSolution}
                  showWhatsApp={showWhatsApp}
                  onBack={() => setTopic(null)}
                  onAutoFix={runAutoFix}
                  onTry={() => setTriedSolution(true)}
                  onAskAi={() => {
                    setQuestion(topic.title);
                    setTopic(null);
                  }}
                  onStillBroken={() => {
                    setTriedSolution(true);
                    setShowWhatsApp(true);
                  }}
                />
              ) : (
                <>
                  <div className="smart-help-tabs">
                    <button className={activeSection === "page" ? "active" : ""} onClick={() => setActiveSection("page")}>הדרכת הדף</button>
                    <button className={activeSection === "library" ? "active" : ""} onClick={() => setActiveSection("library")}>ספריית עזרה</button>
                  </div>
                  {debouncedSearch ? (
                    <SearchResults query={debouncedSearch} results={searchResults} onOpen={openTopic} />
                  ) : activeSection === "page" ? (
                    <SmartPageGuide
                      content={pageHelp}
                      completed={Boolean(completedTutorials[pageHelp.key])}
                      onSpeak={speakPageHelp}
                      onStartTour={startTour}
                      onRestart={() => {
                        startTour();
                      }}
                    />
                  ) : (
                    <>
                      <OnboardingChecklist completion={completion} items={checklist} />
                      <section className="help-section">
                        <h3>בעיות נפוצות</h3>
                        <div className="help-grid">
                          {commonTopics.map((item) => <TopicCard key={item.id} topic={item} onOpen={openTopic} />)}
                        </div>
                      </section>
                      <section className="help-section">
                        <h3>נושאים</h3>
                        <div className="help-grid">
                          {helpCategories.map((category) => (
                            <button className="help-category-card" key={category.id} onClick={() => setCategoryId(category.id)}>
                              <span className={categoryTone(category.id, "text")}>{category.icon}</span>
                              <strong>{category.title}</strong>
                              <small>{category.description}</small>
                            </button>
                          ))}
                        </div>
                      </section>
                      {selectedCategory && (
                        <section className="help-section">
                          <h3>{selectedCategory.icon} {selectedCategory.title}</h3>
                          <div className="help-list">
                            {selectedCategory.topics.map((item) => (
                              <button className="help-result" key={item.id} onClick={() => openTopic({ ...item, category: selectedCategory })}>
                                <strong>{item.title}</strong>
                                <small>{item.shortDesc}</small>
                              </button>
                            ))}
                          </div>
                        </section>
                      )}
                    </>
                  )}
                  <AiChat question={question} loading={aiLoading} chat={chat} showWhatsApp={showWhatsApp} onQuestionChange={setQuestion} onAsk={askAi} onBadAnswer={() => setShowWhatsApp(true)} />
                </>
              )}
            </main>
          </div>
        </div>
      )}
    </>
  );
}

function TopicCard({ topic, onOpen }: { topic: TopicWithCategory; onOpen: (topic: TopicWithCategory) => void }) {
  return (
    <button className="help-topic-card" onClick={() => onOpen(topic)}>
      <span className={`help-category-badge ${categoryTone(topic.category.id, "bg")}`}>{topic.category.icon}</span>
      <strong>{topic.title}</strong>
      <small>{topic.shortDesc}</small>
      {topic.autoFix && <span className="help-one-click">אפשר לנסות לפתור בלחיצה</span>}
    </button>
  );
}

function SmartPageGuide(props: {
  content: SmartHelpContent;
  completed: boolean;
  onSpeak: () => void;
  onStartTour: () => void;
  onRestart: () => void;
}) {
  const details = smartHelpUxDetails[props.content.key] ?? smartHelpUxDetails.dashboard;
  return (
    <div className="smart-help-page">
      <section className="help-section smart-help-hero">
        <div>
          <span className="badge badge-ok">{props.completed ? "הדרכה הושלמה" : "הדרכה זמינה"}</span>
          <h3>📖 מה הדף הזה עושה</h3>
          <p>{props.content.pagePurpose}</p>
        </div>
      </section>

      <section className="help-section smart-help-modes">
        <div>
          <h3>מצב מתחילים</h3>
          <p>{details.beginner}</p>
        </div>
        <div>
          <h3>מצב מתקדם</h3>
          <p>{details.advanced}</p>
        </div>
      </section>

      <section className="help-section smart-help-example">
        <h3>דוגמה עסקית אמיתית</h3>
        <p>{details.example}</p>
      </section>

      <section className="help-section">
        <h3>🎬 סרטון הסבר בעברית</h3>
        <div className="smart-help-video">
          <iframe title={`סרטון הדרכה - ${props.content.title}`} src={props.content.videoUrl} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
        </div>
        <div className="smart-help-subtitles">
          <strong>כתוביות בעברית:</strong>
          {props.content.videoSubtitles.map((line) => <span key={line}>{line}</span>)}
        </div>
      </section>

      <section className="help-section">
        <h3>🔊 שמע הסבר</h3>
        <p>{props.content.voiceText}</p>
        <button className="btn" onClick={props.onSpeak}>השמע הסבר בעברית</button>
      </section>

      <section className="help-section">
        <h3>🧭 סיור מודרך</h3>
        <p>הסיור יסמן את הכפתורים והאזורים החשובים בדף ויסביר מה עושים בכל שלב.</p>
        {details.warning && <div className="help-warning"><strong>שים לב:</strong> {details.warning}</div>}
        <div className="help-detail-actions">
          <button className="btn" onClick={props.onStartTour}>התחל סיור</button>
          <button className="btn btn-secondary" onClick={props.onRestart}>התחל מחדש</button>
        </div>
      </section>

      <section className="help-section">
        <h3>טיפים ליד הפעולות החשובות</h3>
        <div className="help-list">
          {details.tips.map((tip) => <div className="help-tip" key={tip}>{tip}</div>)}
        </div>
      </section>

      <section className="help-section">
        <h3>❓ שאלות נפוצות</h3>
        <div className="help-list">
          {props.content.faqs.map((faq) => (
            <details className="smart-help-faq" key={faq.question}>
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="help-section">
        <h3>📋 מה כדאי לעשות עכשיו</h3>
        <div className="help-grid">
          {props.content.nextActions.map((action) => (
            <button className="help-topic-card" key={action.title} onClick={() => { window.location.href = action.href; }}>
              <strong>{action.title}</strong>
              <small>{nextActionTip(action.title, details)}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function GuidedTourOverlay(props: {
  content: SmartHelpContent;
  stepIndex: number;
  target: DOMRect | null;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const step = props.content.tourSteps[props.stepIndex];
  const style = props.target
    ? {
        top: Math.max(12, props.target.top - 8),
        right: Math.max(12, window.innerWidth - props.target.right - 8),
        width: Math.min(props.target.width + 16, window.innerWidth - 24),
        height: props.target.height + 16,
      }
    : undefined;

  return (
    <div className="tour-layer" role="dialog" aria-modal="true">
      {props.target && <div className="tour-highlight" style={style} />}
      <div className="tour-card">
        <span className="badge badge-warn">שלב {props.stepIndex + 1} מתוך {props.content.tourSteps.length}</span>
        <h2>{step.title}</h2>
        <p>{step.text}</p>
        {!props.target && <small>לא נמצא אזור מתאים בדף הנוכחי, אבל אפשר להמשיך בסיור.</small>}
        <div className="help-detail-actions">
          <button className="btn btn-secondary" onClick={props.onClose}>סגור</button>
          <button className="btn btn-secondary" onClick={props.onBack} disabled={props.stepIndex === 0}>חזרה</button>
          <button className="btn" onClick={props.onNext}>{props.stepIndex === props.content.tourSteps.length - 1 ? "סיים סיור" : "המשך"}</button>
        </div>
      </div>
    </div>
  );
}

function SearchResults({ query, results, onOpen }: { query: string; results: TopicWithCategory[]; onOpen: (topic: TopicWithCategory) => void }) {
  return (
    <section className="help-section">
      <h3>תוצאות חיפוש</h3>
      {results.length ? (
        <div className="help-list">
          {results.map((topic) => (
            <button className="help-result" key={topic.id} onClick={() => onOpen(topic)}>
              <span className={`help-category-badge ${categoryTone(topic.category.id, "bg")}`}>{topic.category.icon} {topic.category.title}</span>
              <strong>{highlight(topic.title, query)}</strong>
              <small>{highlight(topic.shortDesc, query)}</small>
            </button>
          ))}
        </div>
      ) : (
        <div className="help-empty">לא מצאת תשובה? שאל את העוזר החכם.</div>
      )}
    </section>
  );
}

function TopicDetail(props: {
  topic: TopicWithCategory;
  autoFixLoading: boolean;
  triedSolution: boolean;
  showWhatsApp: boolean;
  onBack: () => void;
  onAutoFix: (action: AutoFixAction | null | undefined) => void;
  onTry: () => void;
  onAskAi: () => void;
  onStillBroken: () => void;
}) {
  return (
    <section className="help-detail">
      <button className="help-back" onClick={props.onBack}>חזרה</button>
      <span className={`help-category-badge ${categoryTone(props.topic.category.id, "bg")}`}>{props.topic.category.icon} {props.topic.category.title}</span>
      <h3>{props.topic.title}</h3>
      <p>{props.topic.shortDesc}</p>
      {props.topic.explanation && <pre className="help-explanation">{props.topic.explanation}</pre>}
      {props.topic.steps && (
        <div className="help-steps">
          <h4>פתרון צעד אחר צעד:</h4>
          {props.topic.autoFix && <ActionWarning action={props.topic.autoFix} />}
          {props.topic.steps.map((step, index) => (
            <div className="help-step" key={step}>
              <strong>צעד {index + 1}</strong>
              <span>{step}</span>
              {index === 0 && props.topic.autoFix && <button className="btn btn-secondary" onClick={() => props.onAutoFix(props.topic.autoFix)} disabled={props.autoFixLoading}>{props.autoFixLoading ? "מנסה לפתור..." : "נסה לפתור בשבילי"}</button>}
            </div>
          ))}
        </div>
      )}
      {props.topic.troubleshooting?.map((item) => (
        <div className="help-trouble" key={item.problem}>
          <strong>{item.problem}</strong>
          <p>{item.solution}</p>
          {item.autoFix && <ActionWarning action={item.autoFix} />}
          {item.autoFix && <button className="btn btn-secondary" onClick={() => props.onAutoFix(item.autoFix)} disabled={props.autoFixLoading}>{props.autoFixLoading ? "מנסה לפתור..." : "נסה לפתור בשבילי"}</button>}
        </div>
      ))}
      <div className="help-detail-actions">
        <button className="btn btn-secondary" onClick={props.onTry}>ניסיתי את הפתרון</button>
        <button className="btn btn-secondary" onClick={props.onAskAi}>שאל את העוזר החכם</button>
        <button className="btn" onClick={props.onStillBroken}>עדיין לא עובד</button>
      </div>
      {props.showWhatsApp && <EscalationBox topic={props.topic} triedSolution={props.triedSolution} />}
    </section>
  );
}

function AiChat(props: { question: string; loading: boolean; chat: ChatMessage[]; showWhatsApp: boolean; onQuestionChange: (value: string) => void; onAsk: () => void; onBadAnswer: () => void }) {
  return (
    <section className="help-section">
      <h3>שאל את העוזר החכם</h3>
      <div className="help-chat">
        {props.chat.map((message, index) => (
          <div className={`help-message help-message-${message.role}`} key={`${message.role}-${index}`}>
            {message.text}
            {message.role === "assistant" && <div className="help-feedback">האם זה עזר? <button>👍</button><button onClick={props.onBadAnswer}>👎</button></div>}
          </div>
        ))}
        {props.loading && <div className="help-message help-message-assistant">העוזר בודק את השאלה...</div>}
      </div>
      <div className="help-ai-row">
        <input placeholder="למשל: למה ג׳ימייל לא סורק?" value={props.question} onChange={(event) => props.onQuestionChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") props.onAsk(); }} />
        <button className="btn" onClick={props.onAsk} disabled={props.loading}>שלח</button>
      </div>
      {props.showWhatsApp && <GenericEscalationBox />}
    </section>
  );
}

function ActionWarning({ action }: { action: AutoFixAction }) {
  const warning = autoFixWarning(action);
  if (!warning) return null;
  return (
    <div className="help-warning">
      <strong>לפני שלוחצים:</strong> {warning}
    </div>
  );
}

function OnboardingChecklist({ completion, items }: { completion: number; items: ChecklistItem[] }) {
  return (
    <section className="help-section help-checklist">
      <div><h3>צ'קליסט התחלה מהירה</h3><p>{completion}% הושלם</p></div>
      <progress className="help-progress" value={completion} max={100} />
      {items.map((item) => <button key={item.id} onClick={() => { window.location.href = item.href; }}><span>{item.done ? "☑" : "☐"}</span>{item.label}</button>)}
    </section>
  );
}

function categoryTone(categoryId: string, type: "text" | "bg") {
  const tones: Record<string, { text: string; bg: string }> = {
    gmail: { text: "text-emerald-300", bg: "bg-emerald-500" },
    drive: { text: "text-blue-300", bg: "bg-blue-500" },
    whatsapp: { text: "text-violet-300", bg: "bg-violet-500" },
    invoices: { text: "text-amber-300", bg: "bg-amber-500" },
    sheets: { text: "text-cyan-300", bg: "bg-cyan-500" },
    general: { text: "text-slate-300", bg: "bg-slate-500" },
  };
  return tones[categoryId]?.[type] ?? tones.general[type];
}

function EscalationBox({ topic, triedSolution }: { topic: HelpTopic; triedSolution: boolean }) {
  const message = ["שלום! אני צריך עזרה עם עובד משרד חכם.", `הבעיה שלי: ${topic.title}`, `ניסיתי: ${triedSolution ? "עברתי על הפתרון במרכז העזרה" : "עדיין לא ניסיתי פתרון"}`, "עדיין לא עובד."].join("\n");
  const url = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(message)}`;
  return (
    <div className="help-escalation">
      <strong>עדיין לא עובד?</strong>
      <p>וואטסאפ לבעלים מופיע רק אחרי שניסית פתרון, ונשלח עם הקשר מלא.</p>
      {SUPPORT_PHONE ? <a className="btn" href={url} target="_blank" rel="noreferrer">שלח וואטסאפ</a> : <button className="btn" disabled>וואטסאפ לא הוגדר</button>}
      <small>נושא: {topic.title}</small>
    </div>
  );
}

function GenericEscalationBox() {
  const message = ["שלום! אני צריך עזרה עם עובד משרד חכם.", "הבעיה שלי: שאלתי את מרכז העזרה ולא נמצאה תשובה.", "ניסיתי: שאלתי את העוזר.", "עדיין לא עובד."].join("\n");
  const url = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(message)}`;
  return (
    <div className="help-escalation">
      <strong>לא מצאת תשובה?</strong>
      <p>אפשר לשלוח וואטסאפ עם הקשר מלא רק אחרי ניסיון פתרון עצמי.</p>
      {SUPPORT_PHONE ? <a className="btn" href={url} target="_blank" rel="noreferrer">שלח וואטסאפ</a> : <button className="btn" disabled>וואטסאפ לא הוגדר</button>}
    </div>
  );
}

function highlight(text: string, query: string) {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (!query || index === -1) return text;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>;
}

function nextActionTip(title: string, details: SmartHelpUxDetails) {
  if (title.includes("ג׳ימייל")) return "טיפ: חיבור ג׳ימייל הוא הצעד הראשון לפני סריקות ונתונים אמיתיים.";
  if (title.includes("סריקה") || title.includes("סטטיסטיקות")) return "טיפ: אחרי סריקה בדוק אם יש פריטים שמחכים לבדיקה.";
  if (title.includes("תשלומים") || title.includes("ספק")) return "טיפ: בדוק סכום וקבלה לפני סימון תשלום כשולם.";
  if (title.includes("משימות")) return "טיפ: התחל ממשימות דחופות או כאלה עם תאריך קרוב.";
  return details.tips[0] ?? "טיפ: פתח את הדף, בדוק את הכרטיס הראשון, וסיים פעולה אחת קטנה.";
}

function autoFixWarning(action: AutoFixAction) {
  if (action === "clear-cache") return "הפעולה יכולה לנתק אותך מהמערכת במחשב הזה. השתמש בה רק אם כניסה או חיבור לחשבון לא עובדים.";
  if (action === "reconnect-gmail") return "תועבר למסך Google ותצטרך לאשר שוב הרשאות. זה לא מוחק נתונים, אבל הסריקות יעבדו רק אחרי אישור.";
  if (action === "rescan-gmail") return "סריקה יכולה לקחת זמן וליצור פריטי בדיקה חדשים. אל תסגור את הדפדפן מיד אחרי ההפעלה.";
  if (action === "reload") return "רענון הדף לא מוחק נתונים, אבל שינויים שלא נשמרו בטופס עלולים להימחק.";
  return null;
}

function smartHelpForPath(pathname: string): SmartHelpContent {
  const exact = smartHelpPages.find((page) => page.paths.some((path) => pathname === path || (path !== "/dashboard" && pathname.startsWith(`${path}/`))));
  return exact ?? smartHelpPages[0];
}

function findTourTarget(step: SmartHelpTourStep | null): DOMRect | null {
  if (!step || typeof document === "undefined") return null;
  const element = step.selector
    ? document.querySelector(step.selector)
    : findElementByText(step.label ?? step.title);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  return rect;
}

function findElementByText(label: string) {
  const clean = label.trim();
  if (!clean) return null;
  const candidates = Array.from(document.querySelectorAll("button, a, h1, h2, h3, section, [role='button']"));
  return candidates.find((element) => (element.textContent ?? "").includes(clean)) ?? null;
}
