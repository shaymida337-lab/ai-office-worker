import type { BillingPlan } from "@/lib/billing/model";

export type PlanFeatureGroup = {
  icon: string;
  title: string;
  items: string[];
};

export type PlanConversionCopy = {
  name: string;
  positioning: string;
  featureGroups: PlanFeatureGroup[];
  finalLine: string;
  finalLineIcon?: string;
  selectLabel: string;
  selectedLabel: string;
};

export const PLAN_CONVERSION_COPY: Record<BillingPlan["id"], PlanConversionCopy> = {
  starter: {
    name: "נטלי לעסק",
    positioning: "עוזרת המשרד הדיגיטלית לעסק קטן.",
    featureGroups: [
      {
        icon: "🤖",
        title: "עוזרת משרד",
        items: [
          "שיחה עם נטלי בקול ובצ׳אט",
          "קביעת, שינוי וביטול פגישות",
          "תזכורות אוטומטיות ללקוחות",
        ],
      },
      {
        icon: "📄",
        title: "מסמכים",
        items: [
          "קריאת חשבוניות וקבלות",
          "זיהוי ספקים וסכומים",
          "תיוק אוטומטי ב-Google Drive",
          "עדכון Google Sheets",
          "מעקב אחרי תשלומים",
          "עד 1,000 מסמכים בחודש",
        ],
      },
      {
        icon: "📊",
        title: "הנהלת חשבונות",
        items: ["הכנת כל החומר לרואה החשבון בלחיצת כפתור"],
      },
    ],
    finalLine: "המסלול שמוריד ממך את כאב הראש של הניירת.",
    selectLabel: "אני רוצה את נטלי בעסק",
    selectedLabel: "בחרתם",
  },
  growth: {
    name: "נטלי מנהלת את המשרד",
    positioning: "הבחירה של רוב בעלי העסקים.",
    featureGroups: [
      {
        icon: "🤖",
        title: "עוזרת משרד",
        items: [
          "שיחה עם נטלי בקול ובצ׳אט",
          "קביעת, שינוי וביטול פגישות",
          "תזכורות אוטומטיות ללקוחות",
        ],
      },
      {
        icon: "📄",
        title: "מסמכים",
        items: [
          "קריאת חשבוניות וקבלות",
          "זיהוי ספקים וסכומים",
          "תיוק אוטומטי ב-Google Drive",
          "עדכון Google Sheets",
          "מעקב אחרי תשלומים",
          "מסמכים ללא הגבלה",
        ],
      },
      {
        icon: "📊",
        title: "הנהלת חשבונות",
        items: ["הכנת כל החומר לרואה החשבון בלחיצת כפתור"],
      },
      {
        icon: "👥",
        title: "ניהול העסק",
        items: [
          "CRM מלא לניהול לקוחות",
          "ניהול לידים מתקדם",
          "מעקב אחר כל שלב במשפך המכירות",
        ],
      },
      {
        icon: "📈",
        title: "בקרה וצמיחה",
        items: [
          "סיכום יומי חכם של העסק",
          "דוחות עסקיים ותובנות",
          "עדיפות בפיצ׳רים חדשים",
          "עדיפות בתמיכה",
        ],
      },
    ],
    finalLine: "כל מה שצריך כדי לנהל את העסק במקום אחד.",
    finalLineIcon: "💡",
    selectLabel: "אני רוצה שנטלי תנהל לי את המשרד",
    selectedLabel: "בחרתם",
  },
};

export const RELIEF_CARDS = [
  { title: "המרדף אחרי חשבוניות במייל", subtitle: "נטלי מוצאת אותן לבד.", icon: "📧" },
  { title: "הבלגן בדרייב", subtitle: "כל מסמך נשמר במקום הנכון.", icon: "📂" },
  { title: "ההקלדות ל-Google Sheets", subtitle: "הנתונים מתעדכנים אוטומטית.", icon: "📊" },
  { title: "החיפוש אחרי מסמכים", subtitle: "שואלים את נטלי ומקבלים תשובה.", icon: "🔍" },
  { title: "המעקב אחרי תשלומים", subtitle: "נטלי מזהה מה שולם ומה דורש טיפול.", icon: "💳" },
  { title: "הכנה לרואה החשבון", subtitle: "הכל נשמר מסודר ונגיש.", icon: "📋" },
] as const;

export const WORKDAY_STORY = [
  {
    phase: "בבוקר",
    text: "נטלי בודקת את המייל ומזהה מסמכים חדשים.",
  },
  {
    phase: "במהלך היום",
    text: "המסמכים נשמרים ב-Google Drive והנתונים מתעדכנים ב-Google Sheets.",
  },
  {
    phase: "כשצריך לדעת משהו",
    text: "שואלים את נטלי: \"כמה שילמתי לספק הזה החודש?\" ומקבלים תשובה.",
  },
  {
    phase: "בסוף החודש",
    text: "החומר לרואה החשבון כבר מסודר.",
  },
] as const;

export const PLANS_TRUST_ITEMS = [
  { icon: "🔒", label: "הנתונים שלך מאובטחים" },
  { icon: "📄", label: "חשבונית נשלחת אוטומטית" },
  { icon: "☁️", label: "המסמכים נשמרים בענן" },
  { icon: "🔄", label: "אפשר לבטל בכל רגע" },
  { icon: "🇮🇱", label: "תמיכה בעברית" },
] as const;

/** @deprecated Used by legacy timeline on other pages */
export const BILLING_DAY_TIMELINE = [
  { icon: "📧", text: "נטלי בודקת את המייל." },
  { icon: "📂", text: "שומרת כל מסמך במקום הנכון." },
  { icon: "📊", text: "מעדכנת את הנתונים." },
  { icon: "💳", text: "מזהה תשלומים." },
  { icon: "🔔", text: "מזכירה מה דורש טיפול." },
  { icon: "🤖", text: "עונה על כל שאלה על העסק." },
] as const;

export function getPlanDisplayName(planIdOrName: string | null | undefined): string {
  if (!planIdOrName) return "—";
  const normalized = planIdOrName.toLowerCase();
  if (normalized === "starter" || normalized.includes("starter")) return PLAN_CONVERSION_COPY.starter.name;
  if (normalized === "growth" || normalized.includes("growth")) return PLAN_CONVERSION_COPY.growth.name;
  return planIdOrName;
}

export function formatPlanPrice(priceMonthly: number): string {
  return `${priceMonthly} ₪ לחודש`;
}
