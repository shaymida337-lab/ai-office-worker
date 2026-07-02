import type { BusinessModuleId, BusinessPainId, BusinessSizeId, BusinessTypeId } from "@/lib/business-config";

export const FIRST_DAY_STORAGE_KEY = "natalie.firstDay";
export const ONBOARDING_PROGRESS_KEY = "natalie.onboarding.progress";
export const FIRST_DASHBOARD_VISIT_KEY = "natalie.dashboard.firstVisit";

export function markFirstDashboardVisit() {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  window.sessionStorage.setItem(FIRST_DASHBOARD_VISIT_KEY, "1");
}

export function consumeFirstDashboardVisit(): boolean {
  if (typeof window === "undefined" || !window.sessionStorage) return false;
  const pending = window.sessionStorage.getItem(FIRST_DASHBOARD_VISIT_KEY) === "1";
  if (pending) window.sessionStorage.removeItem(FIRST_DASHBOARD_VISIT_KEY);
  return pending;
}

export type FirstDayCommunication = "write" | "voice" | "both";

export type OnboardingHelpId =
  | "documents"
  | "tasks"
  | "calendar"
  | "clients"
  | "suppliers"
  | "payments"
  | "chat";

export type OnboardingStepId = 1 | 2 | 3 | 4 | 5 | 6;

export type OnboardingProgress = {
  step: OnboardingStepId;
  businessName: string;
  firstName: string;
  businessType: BusinessTypeId;
  businessSize: BusinessSizeId;
  helpAreas: OnboardingHelpId[];
};

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

const HELP_TO_PAIN: Record<OnboardingHelpId, string> = {
  documents: "לרדוף אחרי חשבוניות וקבלות",
  tasks: "להבין מה קורה בעסק בלי לחפור בנתונים",
  calendar: "להבין מה קורה בעסק בלי לחפור בנתונים",
  clients: "להבין מה קורה בעסק בלי לחפור בנתונים",
  suppliers: "לזכור תשלומים לספקים",
  payments: "לזכור תשלומים לספקים",
  chat: "להבין מה קורה בעסק בלי לחפור בנתונים",
};

const HELP_TO_MODULES: Record<OnboardingHelpId, BusinessModuleId[]> = {
  documents: ["documents", "invoices"],
  tasks: ["tasks"],
  calendar: ["meetings"],
  clients: ["crm"],
  suppliers: ["supplier_management"],
  payments: ["collections", "supplier_management"],
  chat: ["whatsapp"],
};

const HELP_TO_BUSINESS_PAIN: Record<OnboardingHelpId, BusinessPainId> = {
  documents: "documents",
  tasks: "tasks",
  calendar: "tasks",
  clients: "leads",
  suppliers: "collections",
  payments: "collections",
  chat: "whatsapp",
};

export function helpAreasToModules(helpAreas: OnboardingHelpId[]): BusinessModuleId[] {
  const modules = new Set<BusinessModuleId>();
  for (const area of helpAreas) {
    for (const moduleId of HELP_TO_MODULES[area]) {
      modules.add(moduleId);
    }
  }
  return Array.from(modules);
}

export function helpAreasToMainPain(helpAreas: OnboardingHelpId[]): BusinessPainId {
  const first = helpAreas[0];
  return first ? HELP_TO_BUSINESS_PAIN[first] : "documents";
}

export function helpAreasToLegacyPains(helpAreas: OnboardingHelpId[]): string[] {
  return Array.from(new Set(helpAreas.map((area) => HELP_TO_PAIN[area])));
}

export function isActiveOnboardingStep(step: unknown): step is 1 | 2 | 3 | 4 | 5 {
  return typeof step === "number" && Number.isInteger(step) && step >= 1 && step <= 5;
}

export type OnboardingHydrationResult =
  | { action: "none" }
  | { action: "redirect_dashboard" }
  | { action: "reset_step_1" }
  | { action: "apply"; progress: OnboardingProgress };

export function resolveOnboardingHydration(saved: OnboardingProgress | null): OnboardingHydrationResult {
  if (!saved) return { action: "none" };
  if (saved.step === 6) return { action: "redirect_dashboard" };
  if (!isActiveOnboardingStep(saved.step)) return { action: "reset_step_1" };
  return {
    action: "apply",
    progress: {
      ...saved,
      helpAreas: Array.isArray(saved.helpAreas) ? saved.helpAreas : [],
    },
  };
}

export function readOnboardingProgress(): OnboardingProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ONBOARDING_PROGRESS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OnboardingProgress;
  } catch {
    return null;
  }
}

export function writeOnboardingProgress(progress: OnboardingProgress) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ONBOARDING_PROGRESS_KEY, JSON.stringify(progress));
}

export function clearOnboardingProgress() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ONBOARDING_PROGRESS_KEY);
}

export function clearFirstDayData() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(FIRST_DAY_STORAGE_KEY);
}

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
  const stored = readFirstDayData()?.firstName?.trim() || readOnboardingProgress()?.firstName?.trim();
  if (stored) return stored;
  const fromSettings = settingsName?.trim().split(/\s+/)[0];
  return fromSettings || null;
}
