import type { OnboardingHelpId } from "@/lib/natalie/firstDay";

export const ONBOARDING_TOTAL_STEPS = 6;

export const ONBOARDING_PREP_STEPS = [
  "מכירה את העסק שלך",
  "יוצרת סביבת עבודה",
  "מחברת את השירותים",
  "מכינה את הדשבורד",
  "מפעילה את האוטומציות הראשונות",
] as const;

export const ONBOARDING_TEAM_SIZE_OPTIONS = [
  { id: "solo", label: "רק אני" },
  { id: "2_5", label: "2–5" },
  { id: "6_20", label: "6–20" },
  { id: "20_plus", label: "20+" },
] as const;

export const ONBOARDING_HELP_OPTIONS: { id: OnboardingHelpId; label: string }[] = [
  { id: "documents", label: "סריקת מסמכים וחשבוניות" },
  { id: "tasks", label: "ניהול משימות" },
  { id: "calendar", label: "יומן ופגישות" },
  { id: "clients", label: "ניהול לקוחות" },
  { id: "suppliers", label: "ניהול ספקים" },
  { id: "payments", label: "מעקב תשלומים" },
  { id: "chat", label: "צ'אט עם נטלי" },
];

export const ONBOARDING_INTEGRATIONS = [
  {
    id: "gmail" as const,
    name: "Gmail",
    reason: "כדי שאוכל לקרוא עבורך את המיילים החדשים.",
  },
  {
    id: "drive" as const,
    name: "Google Drive",
    reason: "כדי לשמור ולסדר את המסמכים שלך במקום אחד.",
  },
  {
    id: "calendar" as const,
    name: "Google Calendar",
    reason: "כדי לנהל פגישות ולעדכן את היומן שלך.",
  },
  {
    id: "whatsapp" as const,
    name: "WhatsApp",
    reason: "כדי לעדכן אותך ולעזור בשיחות עסקיות חשובות.",
  },
];

export const ONBOARDING_SUMMARY_AREAS = [
  { icon: "📧", label: "מיילים" },
  { icon: "📅", label: "יומן" },
  { icon: "📋", label: "משימות" },
  { icon: "👥", label: "לקוחות" },
  { icon: "🏢", label: "ספקים" },
  { icon: "🧾", label: "מסמכים" },
  { icon: "💰", label: "תשלומים" },
] as const;

/** Post-onboarding exit animation — user always lands on /dashboard. */
export const ONBOARDING_EXIT_TRANSITION_STEPS = [
  "מכינה את הדשבורד שלך",
  "מחברת את השירותים",
  "מפעילה את הסריקה הראשונה",
  "מוכנה להתחיל לעבוד",
] as const;
