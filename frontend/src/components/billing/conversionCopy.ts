import type { BillingPlan } from "@/lib/billing/model";

export type PlanIncludeItem = {
  text: string;
  emphasis?: boolean;
};

export type PlanConversionCopy = {
  name: string;
  positioning: string;
  includes: PlanIncludeItem[];
  finalLine: string;
  selectLabel: string;
  selectedLabel: string;
};

export const PLAN_CONVERSION_COPY: Record<BillingPlan["id"], PlanConversionCopy> = {
  starter: {
    name: "נטלי לעסק",
    positioning: "לעסק שרוצה להפסיק לרדוף אחרי חשבוניות, קבלות ומסמכים.",
    includes: [
      { text: "נטלי קוראת חשבוניות וקבלות מהמייל" },
      { text: "כל מסמך נשמר ומסודר אוטומטית ב-Google Drive" },
      { text: "Google Sheets מתעדכן עם ההוצאות והתשלומים" },
      { text: "זיהוי ספקים, סכומים ותאריכים" },
      { text: "מעקב אחרי תשלומים שדורשים טיפול" },
      { text: "חיפוש חכם בשפה טבעית" },
      { text: "עד 1,000 מסמכים בחודש" },
      { text: "תמיכה בעברית" },
    ],
    finalLine: "המסלול שמוריד ממך את כאב הראש של הניירת.",
    selectLabel: "בחרו את נטלי לעסק",
    selectedLabel: "בחרתם",
  },
  growth: {
    name: "נטלי מנהלת את המשרד",
    positioning: "לעסק שרוצה שנטלי תהיה עובדת המשרד הדיגיטלית שלו.",
    includes: [
      { text: "כל מה שבמסלול נטלי לעסק" },
      { text: "מסמכים ללא הגבלה", emphasis: true },
      { text: "ניהול יומן ופגישות" },
      { text: "יצירת משימות ותזכורות" },
      { text: "מעקב אחרי דברים פתוחים" },
      { text: "תובנות על הוצאות, ספקים ותשלומים" },
      { text: "אוטומציות מתקדמות שחוסכות עבודה ידנית" },
      { text: "גישה ראשונה לפיצ׳רים חדשים" },
    ],
    finalLine: "המסלול למי שרוצה להוריד כמה שיותר עבודה משרדית מהראש.",
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
  { icon: "🔒", label: "המידע שלך מאובטח" },
  { icon: "📄", label: "חשבונית אוטומטית" },
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
