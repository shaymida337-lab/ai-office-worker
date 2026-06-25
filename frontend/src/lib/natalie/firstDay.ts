export const FIRST_DAY_STORAGE_KEY = "natalie.firstDay";

export type FirstDayCommunication = "write" | "voice" | "both";

export type FirstDayData = {
  firstName: string;
  businessName: string;
  phone: string;
  pains: string[];
  communication: FirstDayCommunication;
  completedAt: string;
  workAnimationSeen: boolean;
};

export const FIRST_DAY_PAIN_OPTIONS = [
  "לרדוף אחרי חשבוניות וקבלות",
  "לחפש מסמכים בדרייב ובמייל",
  "לעדכן טבלאות ידנית",
  "לזכור תשלומים לספקים",
  "להכין חומר לרואה החשבון",
  "להבין מה קורה בעסק בלי לחפור בנתונים",
] as const;

export const FIRST_DAY_COMMUNICATION_OPTIONS: { id: FirstDayCommunication; label: string }[] = [
  { id: "write", label: "לכתוב" },
  { id: "voice", label: "לדבר בקול" },
  { id: "both", label: "גם וגם" },
];

export function readFirstDayData(): FirstDayData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FIRST_DAY_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FirstDayData;
  } catch {
    return null;
  }
}

export function writeFirstDayData(data: FirstDayData) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FIRST_DAY_STORAGE_KEY, JSON.stringify(data));
}

export function getFirstNameForGreeting(settingsName?: string | null): string | null {
  const stored = readFirstDayData()?.firstName?.trim();
  if (stored) return stored;
  const fromSettings = settingsName?.trim().split(/\s+/)[0];
  return fromSettings || null;
}
