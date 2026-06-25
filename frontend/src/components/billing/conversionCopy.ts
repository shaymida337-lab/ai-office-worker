import type { BillingPlan } from "@/lib/billing/model";

export type PlanConversionCopy = {
  name: string;
  subheadline: string;
  responsibility: string;
  outcomes: string[];
  selectLabel: string;
  selectedLabel: string;
};

export const PLAN_CONVERSION_COPY: Record<BillingPlan["id"], PlanConversionCopy> = {
  starter: {
    name: "נטלי לעסק",
    subheadline: "מורידה ממך את כל ההתעסקות במסמכים ובחשבוניות.",
    responsibility: "נטלי מסדרת את העבודה.",
    outcomes: [
      "כל החשבוניות נשמרות ומסודרות אוטומטית.",
      "כל המסמכים זמינים מכל מקום.",
      "כל ההוצאות מרוכזות במקום אחד.",
      "אפשר למצוא כל מסמך תוך שניות.",
      "רואה החשבון מקבל הכול מסודר.",
      "אפשר פשוט לשאול את נטלי ולקבל תשובה.",
    ],
    selectLabel: "זה מתאים לי",
    selectedLabel: "בחרת",
  },
  growth: {
    name: "נטלי למשרד",
    subheadline: "נטלי הופכת לעובדת המשרד של העסק שלך.",
    responsibility: "נטלי מנהלת את העבודה.",
    outcomes: [
      "נטלי מנהלת גם את היומן.",
      "יוצרת משימות לבד.",
      "עוקבת אחרי מה שעדיין לא בוצע.",
      "מזכירה לפני שדברים נשכחים.",
      "מסמכים ללא הגבלה.",
      "מורידה ממך אפילו יותר עבודה.",
    ],
    selectLabel: "זה מתאים לי",
    selectedLabel: "בחרת",
  },
};

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
