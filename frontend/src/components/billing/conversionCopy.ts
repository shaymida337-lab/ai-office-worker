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
    positioning: "העוזרת האישית שמנהלת לך את הצד המשרדי של העסק.",
    featureGroups: [
      {
        icon: "🤖",
        title: "נטלי – העוזרת האישית שלך",
        items: [
          "שיחה קולית עם נטלי",
          "קביעת פגישות ביומן",
          "ביטול והזזת פגישות",
          "תזכורות אוטומטיות ללקוחות",
          "מענה חכם בעברית",
        ],
      },
      {
        icon: "📄",
        title: "מסמכים והנהלת חשבונות",
        items: [
          "סריקת חשבוניות מהמייל",
          "סריקת חשבוניות מ-WhatsApp",
          "זיהוי ספקים אוטומטי",
          "שמירה ב-Google Drive",
          "עדכון Google Sheets",
          "מעקב אחר תשלומים",
          "דוח חודשי לרואה החשבון",
        ],
      },
      {
        icon: "📦",
        title: "שימוש",
        items: ["עד 1,000 מסמכים בחודש"],
      },
    ],
    finalLine: "כל הצד המשרדי של העסק, מנוהל בשקט.",
    selectLabel: "אני רוצה את נטלי בעסק",
    selectedLabel: "בחרתם",
  },
  growth: {
    name: "נטלי מנהלת את המשרד",
    positioning: "עובדת המשרד הדיגיטלית שמנהלת לך את כל העסק.",
    featureGroups: [
      {
        icon: "🤖",
        title: "נטלי – מנהלת את המשרד",
        items: [
          "שיחה קולית מלאה",
          "ניהול יומן מתקדם",
          "קביעת פגישות",
          "תזכורות ואישורי הגעה",
          "מענה חכם ללקוחות",
        ],
      },
      {
        icon: "📄",
        title: "מסמכים",
        items: [
          "סריקה ללא הגבלה",
          "Gmail",
          "WhatsApp",
          "Google Drive",
          "Google Sheets",
          "דוח חודשי לרואה החשבון",
        ],
      },
      {
        icon: "👥",
        title: "CRM וניהול לקוחות",
        items: [
          "כרטיס לקוח מלא",
          "ניהול לידים",
          "מעקב אחר כל לקוח",
          "משימות",
          "היסטוריית פעילות",
        ],
      },
      {
        icon: "📈",
        title: "ניהול העסק",
        items: [
          "דוחות עסקיים",
          "אוטומציות",
          "ניהול תהליכי עבודה",
          "כלי צמיחה לעסק",
        ],
      },
    ],
    finalLine: "כל מה שצריך כדי לנהל עסק במקום אחד.",
    finalLineIcon: "💙",
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
