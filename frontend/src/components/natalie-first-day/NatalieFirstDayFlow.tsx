"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, HardDrive, Mail, MessageCircle } from "lucide-react";
import { API_URL, apiFetch, getToken, type GmailStatus } from "@/lib/api";
import {
  businessTypes,
  normalizeBusinessTypeId,
  normalizeEnabledModules,
  recommendedModulesFor,
  type BusinessSizeId,
  type BusinessTypeId,
  type OrganizationSettings,
} from "@/lib/business-config";
import {
  clearOnboardingProgress,
  helpAreasToLegacyPains,
  helpAreasToMainPain,
  helpAreasToModules,
  readOnboardingProgress,
  type OnboardingHelpId,
  type OnboardingStepId,
  writeFirstDayData,
  writeOnboardingProgress,
} from "@/lib/natalie/firstDay";
import {
  NatalieFirstDayField,
  NatalieFirstDayMicrocopy,
  NatalieFirstDayPrimaryButton,
  NatalieFirstDaySelect,
  NatalieFirstDayShell,
  NatalieOnboardingChoiceCard,
} from "./NatalieFirstDayShell";
import {
  ONBOARDING_ACTION_CARDS,
  ONBOARDING_HELP_OPTIONS,
  ONBOARDING_INTEGRATIONS,
  ONBOARDING_PREP_STEPS,
  ONBOARDING_SUMMARY_AREAS,
  ONBOARDING_TEAM_SIZE_OPTIONS,
} from "./onboardingContent";

const PREP_STEP_MS = 4000;

const INTEGRATION_ICONS = {
  gmail: Mail,
  drive: HardDrive,
  calendar: CalendarDays,
  whatsapp: MessageCircle,
} as const;

function normalizeSize(value: string): BusinessSizeId {
  if (value === "solo" || value === "2_5" || value === "6_20" || value === "20_plus") return value;
  return "solo";
}

export function NatalieFirstDayFlow({ onComplete }: { onComplete: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStepId>(1);
  const [firstName, setFirstName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState<BusinessTypeId>("service_business");
  const [businessSize, setBusinessSize] = useState<BusinessSizeId>("solo");
  const [helpAreas, setHelpAreas] = useState<OnboardingHelpId[]>([]);
  const [prepIndex, setPrepIndex] = useState(-1);
  const [prepDone, setPrepDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const prepStartedRef = useRef(false);

  const driveConnected = Boolean(gmailStatus?.connected && !(gmailStatus.missingDriveScopes?.length ?? 0));

  const persistProgress = useCallback(
    (nextStep: OnboardingStepId) => {
      writeOnboardingProgress({
        step: nextStep,
        businessName,
        firstName,
        businessType,
        businessSize,
        helpAreas,
      });
    },
    [businessName, businessSize, businessType, firstName, helpAreas]
  );

  const goToStep = useCallback(
    (nextStep: OnboardingStepId) => {
      setStep(nextStep);
      persistProgress(nextStep);
    },
    [persistProgress]
  );

  useEffect(() => {
    const saved = readOnboardingProgress();
    if (saved) {
      setStep(saved.step);
      setFirstName(saved.firstName);
      setBusinessName(saved.businessName);
      setBusinessType(normalizeBusinessTypeId(saved.businessType));
      setBusinessSize(normalizeSize(saved.businessSize));
      setHelpAreas(saved.helpAreas);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || step < 4) return;
    apiFetch<GmailStatus>(`/api/integrations/gmail/status?t=${Date.now()}`)
      .then(setGmailStatus)
      .catch(() => setGmailStatus(null));
    apiFetch<{ connected: boolean }>(`/api/integrations/calendar/status?t=${Date.now()}`)
      .then((status) => setCalendarConnected(status.connected))
      .catch(() => setCalendarConnected(false));
    apiFetch<{ connected?: boolean }>("/api/whatsapp/status")
      .then((status) => setWhatsappConnected(Boolean(status.connected)))
      .catch(() => setWhatsappConnected(false));
  }, [hydrated, step]);

  useEffect(() => {
    if (!hydrated) return;
    if (step === 1) return;
    persistProgress(step);
  }, [businessName, businessSize, businessType, firstName, helpAreas, hydrated, persistProgress, step]);

  const toggleHelpArea = (area: OnboardingHelpId) => {
    setHelpAreas((current) =>
      current.includes(area) ? current.filter((item) => item !== area) : [...current, area]
    );
  };

  const finishOnboarding = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      const mainPain = helpAreasToMainPain(helpAreas);
      const recommended = recommendedModulesFor(businessType, businessSize, mainPain);
      const enabledModules = normalizeEnabledModules(
        [...recommended, ...helpAreasToModules(helpAreas)],
        businessType
      );

      await apiFetch<OrganizationSettings>("/api/organization/settings", {
        method: "PUT",
        body: JSON.stringify({
          name: firstName,
          businessName,
          businessType,
          businessSize,
          mainBusinessPain: mainPain,
          enabledModules,
          onboardingCompleted: true,
        }),
      });

      writeFirstDayData({
        firstName,
        businessName,
        phone: "",
        pains: helpAreasToLegacyPains(helpAreas),
        communication: "both",
        completedAt: new Date().toISOString(),
        workAnimationSeen: true,
      });

      clearOnboardingProgress();
      onComplete();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "שמירה נכשלה. נסו שוב.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [businessName, businessSize, businessType, firstName, helpAreas, onComplete]);

  useEffect(() => {
    if (step !== 5) {
      prepStartedRef.current = false;
      return;
    }
    if (prepStartedRef.current) return;
    prepStartedRef.current = true;

    setPrepIndex(0);
    setPrepDone(false);
    let index = 0;
    const interval = window.setInterval(() => {
      index += 1;
      if (index >= ONBOARDING_PREP_STEPS.length) {
        window.clearInterval(interval);
        setPrepDone(true);
        return;
      }
      setPrepIndex(index);
    }, PREP_STEP_MS);

    void finishOnboarding();

    return () => window.clearInterval(interval);
  }, [step]);

  useEffect(() => {
    if (step !== 5 || !prepDone || saving || error) return;
    const timeout = window.setTimeout(() => goToStep(6), 600);
    return () => window.clearTimeout(timeout);
  }, [error, goToStep, prepDone, saving, step]);

  const connectGmail = () => {
    const token = getToken();
    if (!token) {
      router.push(`/login?next=${encodeURIComponent("/onboarding")}`);
      return;
    }
    window.location.href = `${API_URL}/api/integrations/gmail/connect?token=${encodeURIComponent(token)}`;
  };

  const connectCalendar = async () => {
    const token = getToken();
    if (!token) {
      router.push(`/login?next=${encodeURIComponent("/onboarding")}`);
      return;
    }
    try {
      const data = await apiFetch<{ url: string }>("/api/integrations/calendar/connect-url");
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "חיבור Google Calendar נכשל");
    }
  };

  const integrationConnected = useMemo(
    () => ({
      gmail: Boolean(gmailStatus?.connected),
      drive: driveConnected,
      calendar: calendarConnected,
      whatsapp: whatsappConnected,
    }),
    [calendarConnected, driveConnected, gmailStatus?.connected, whatsappConnected]
  );

  const handleIntegrationConnect = (id: (typeof ONBOARDING_INTEGRATIONS)[number]["id"]) => {
    setError("");
    if (id === "gmail" || id === "drive") {
      connectGmail();
      return;
    }
    if (id === "calendar") {
      void connectCalendar();
      return;
    }
    persistProgress(4);
    router.push("/dashboard/settings?tab=whatsapp");
  };

  if (!hydrated) {
    return (
      <NatalieFirstDayShell step={1} hideFooter showPortrait portraitSize="large">
        <div className="py-8 text-center text-slate-500">טוענת את סביבת העבודה שלך...</div>
      </NatalieFirstDayShell>
    );
  }

  if (step === 1) {
    return (
      <NatalieFirstDayShell step={1} showPortrait portraitSize="large" hideFooter>
        <div className="grid gap-4 text-center">
          <h1 className="text-3xl font-extrabold text-slate-900 sm:text-4xl">ברוך הבא לנטלי</h1>
          <NatalieFirstDayMicrocopy>
            אני הולכת להיות עובדת המשרד החדשה שלך.
            <br />
            לפני שנתחיל לעבוד יחד, אני רוצה להכיר את העסק שלך כדי שאוכל לעבוד בדיוק בדרך שמתאימה לך.
            <br />
            <span className="font-semibold text-slate-800">זה ייקח בערך 2 דקות.</span>
          </NatalieFirstDayMicrocopy>
        </div>
        <div className="flex justify-center pt-2">
          <NatalieFirstDayPrimaryButton onClick={() => goToStep(2)}>בואו נתחיל</NatalieFirstDayPrimaryButton>
        </div>
      </NatalieFirstDayShell>
    );
  }

  if (step === 2) {
    return (
      <NatalieFirstDayShell
        step={2}
        onBack={() => goToStep(1)}
        onPrimary={() => goToStep(3)}
        primaryDisabled={!firstName.trim() || !businessName.trim()}
      >
        <div className="grid gap-2">
          <h2 className="text-2xl font-extrabold text-slate-900">בואו נכיר את העסק שלך</h2>
          <NatalieFirstDayMicrocopy>כמה פרטים קצרים — ואוכל להתאים את העבודה שלי בדיוק אליך.</NatalieFirstDayMicrocopy>
        </div>
        <div className="grid gap-4">
          <NatalieFirstDayField label="שם העסק" value={businessName} onChange={setBusinessName} placeholder="שם העסק" />
          <NatalieFirstDayField label="השם שלך" value={firstName} onChange={setFirstName} placeholder="שם מלא" />
          <NatalieFirstDaySelect
            label="סוג העסק"
            value={businessType}
            onChange={(value) => setBusinessType(normalizeBusinessTypeId(value))}
            options={businessTypes.map((type) => ({ value: type.id, label: type.label }))}
          />
          <div className="grid gap-2">
            <span className="text-base font-bold text-slate-900 sm:text-lg">כמה עובדים יש?</span>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {ONBOARDING_TEAM_SIZE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setBusinessSize(option.id)}
                  className={`rounded-2xl border px-3 py-3 text-center text-sm font-bold transition hover:-translate-y-0.5 sm:text-base ${
                    businessSize === option.id
                      ? "border-blue-400 bg-blue-50 text-blue-900 shadow-sm"
                      : "border-slate-200 bg-white text-slate-800 hover:border-blue-200"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </NatalieFirstDayShell>
    );
  }

  if (step === 3) {
    return (
      <NatalieFirstDayShell
        step={3}
        onBack={() => goToStep(2)}
        onPrimary={() => goToStep(4)}
        primaryDisabled={helpAreas.length === 0}
      >
        <div className="grid gap-2">
          <h2 className="text-2xl font-extrabold text-slate-900">במה תרצה שנטלי תעזור לך?</h2>
          <NatalieFirstDayMicrocopy>אפשר לבחור כמה תחומים — ואתמקד בהם מהיום הראשון.</NatalieFirstDayMicrocopy>
        </div>
        <div className="grid gap-3">
          {ONBOARDING_HELP_OPTIONS.map((option) => (
            <NatalieOnboardingChoiceCard
              key={option.id}
              selected={helpAreas.includes(option.id)}
              onClick={() => toggleHelpArea(option.id)}
            >
              {option.label}
            </NatalieOnboardingChoiceCard>
          ))}
        </div>
      </NatalieFirstDayShell>
    );
  }

  if (step === 4) {
    return (
      <NatalieFirstDayShell step={4} onBack={() => goToStep(3)} onPrimary={() => goToStep(5)} primaryLabel="המשך">
        <div className="grid gap-2">
          <h2 className="text-2xl font-extrabold text-slate-900">בואו נחבר את נטלי לעבודה שלך</h2>
          <NatalieFirstDayMicrocopy>רק השירותים שכבר זמינים היום. אפשר לחבר עכשיו או אחר כך מההגדרות.</NatalieFirstDayMicrocopy>
        </div>
        <div className="grid gap-3">
          {ONBOARDING_INTEGRATIONS.map((integration) => {
            const Icon = INTEGRATION_ICONS[integration.id];
            const connected = integrationConnected[integration.id];
            return (
              <article
                key={integration.id}
                className="grid gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_8px_30px_-20px_rgba(15,23,42,0.2)] transition duration-300 hover:-translate-y-0.5 hover:border-blue-200 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      <Icon className="h-5 w-5" strokeWidth={2} aria-hidden />
                    </div>
                    <div className="min-w-0 grid gap-1">
                      <h3 className="text-base font-bold text-slate-900">{integration.name}</h3>
                      <p className="text-sm leading-6 text-slate-600">{integration.reason}</p>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                      connected ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {connected ? "מחובר" : "לא מחובר"}
                  </span>
                </div>
                {!connected && (
                  <button
                    type="button"
                    onClick={() => handleIntegrationConnect(integration.id)}
                    className="w-full rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-bold text-blue-800 transition hover:bg-blue-100"
                  >
                    חבר {integration.name}
                  </button>
                )}
              </article>
            );
          })}
        </div>
        {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
      </NatalieFirstDayShell>
    );
  }

  if (step === 5) {
    return (
      <NatalieFirstDayShell step={5} hideFooter>
        <div className="grid gap-2">
          <h2 className="text-2xl font-extrabold text-slate-900">נטלי מכינה את המשרד שלך</h2>
          <NatalieFirstDayMicrocopy>עוד רגע — ואתחיל לעבוד בשבילך.</NatalieFirstDayMicrocopy>
        </div>
        <ul className="grid gap-3">
          {ONBOARDING_PREP_STEPS.map((item, index) => {
            const done = prepDone || index <= prepIndex;
            const active = index === prepIndex && !prepDone;
            return (
              <li
                key={item}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-base transition duration-500 ${
                  done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-white text-slate-500"
                } ${active ? "ring-2 ring-blue-200" : ""}`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    done ? "bg-emerald-600 text-white" : "border border-slate-300 bg-white text-slate-400"
                  }`}
                  aria-hidden
                >
                  {done ? "✓" : index + 1}
                </span>
                <span className="min-w-0 break-words font-semibold">{item}</span>
              </li>
            );
          })}
        </ul>
        {error && (
          <div className="grid gap-3">
            <p className="text-sm font-semibold text-red-600">{error}</p>
            <NatalieFirstDayPrimaryButton onClick={() => void finishOnboarding()}>נסו שוב</NatalieFirstDayPrimaryButton>
          </div>
        )}
        {saving && !error && <p className="text-sm font-semibold text-slate-500">שומרת את ההגדרות שלך...</p>}
      </NatalieFirstDayShell>
    );
  }

  return (
    <NatalieFirstDayShell step={6} showPortrait hideFooter>
      <div className="grid gap-4 text-center">
        <h2 className="text-3xl font-extrabold text-slate-900 sm:text-4xl">
          מושלם!
          <br />
          מעכשיו אני עובדת בשבילך.
        </h2>
        <NatalieFirstDayMicrocopy>המשרד שלך מוכן. בחרו איך להתחיל — ואני על זה.</NatalieFirstDayMicrocopy>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ONBOARDING_SUMMARY_AREAS.map((area) => (
          <div
            key={area.label}
            className="flex min-h-[5.5rem] flex-col items-center justify-center rounded-2xl border border-slate-200/90 bg-slate-50/80 px-3 py-4 text-center shadow-sm"
          >
            <span className="text-2xl" aria-hidden>
              {area.icon}
            </span>
            <span className="mt-2 text-sm font-bold text-slate-800">{area.label}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {ONBOARDING_ACTION_CARDS.map((action) => (
          <Link
            key={action.label}
            href={action.href}
            className="flex min-h-[3.25rem] items-center justify-center rounded-2xl bg-gradient-to-l from-blue-600 to-blue-700 px-5 py-3.5 text-center text-sm font-bold text-white shadow-[0_12px_32px_-12px_rgba(29,91,235,0.45)] transition hover:from-blue-700 hover:to-blue-800 sm:text-base"
          >
            {action.label}
          </Link>
        ))}
      </div>
    </NatalieFirstDayShell>
  );
}
