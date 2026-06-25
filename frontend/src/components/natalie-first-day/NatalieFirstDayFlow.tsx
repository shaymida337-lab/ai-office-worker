"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CalendarDays,
  CheckSquare,
  FileScan,
  HardDrive,
  Mail,
  MessageCircle,
  UserRound,
  Wallet,
} from "lucide-react";
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
  clearFirstDayData,
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
  ONBOARDING_EXIT_TRANSITION_STEPS,
  ONBOARDING_HELP_OPTIONS,
  ONBOARDING_INTEGRATIONS,
  ONBOARDING_PREP_STEPS,
  ONBOARDING_SUMMARY_AREAS,
  ONBOARDING_TEAM_SIZE_OPTIONS,
} from "./onboardingContent";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { OnboardingDebugToolbar } from "./OnboardingDebugToolbar";

const PREP_ITEM_MS = 4000;
const EXIT_ITEM_MS = 560;

const HELP_ICONS = {
  documents: FileScan,
  tasks: CheckSquare,
  calendar: CalendarDays,
  clients: UserRound,
  suppliers: Building2,
  payments: Wallet,
  chat: MessageCircle,
} as const;

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
  const [prepAnimationDone, setPrepAnimationDone] = useState(false);
  const [prepSaveOk, setPrepSaveOk] = useState(false);
  const [exitDestination, setExitDestination] = useState<string | null>(null);
  const [exitTransitionDone, setExitTransitionDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const prepStartedRef = useRef(false);

  const handlePrepAnimationComplete = useCallback(() => setPrepAnimationDone(true), []);
  const handleExitTransitionComplete = useCallback(() => setExitTransitionDone(true), []);

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

  const goBack = useCallback(() => {
    if (step <= 1) return;
    if (step === 5 || step === 6) {
      prepStartedRef.current = false;
      setPrepAnimationDone(false);
      setPrepSaveOk(false);
    }
    goToStep((step - 1) as OnboardingStepId);
  }, [goToStep, step]);

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
      setPrepAnimationDone(false);
      setPrepSaveOk(false);
      return;
    }
    if (prepStartedRef.current) return;
    prepStartedRef.current = true;

    void finishOnboarding().then((ok) => setPrepSaveOk(ok));
  }, [finishOnboarding, step]);

  useEffect(() => {
    if (step !== 5 || !prepAnimationDone || !prepSaveOk) return;
    const timeout = window.setTimeout(() => goToStep(6), 400);
    return () => window.clearTimeout(timeout);
  }, [goToStep, prepAnimationDone, prepSaveOk, step]);

  useEffect(() => {
    if (!exitDestination || !exitTransitionDone) return;
    router.push(exitDestination);
  }, [exitDestination, exitTransitionDone, router]);

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

  const handleActionSelect = (href: string) => {
    setExitDestination(href);
    setExitTransitionDone(false);
  };

  const debugGoToStep = useCallback(
    (target: OnboardingStepId) => {
      prepStartedRef.current = false;
      setPrepAnimationDone(false);
      setPrepSaveOk(false);
      setExitDestination(null);
      setExitTransitionDone(false);
      setError("");
      goToStep(target);
    },
    [goToStep]
  );

  const debugReset = useCallback(() => {
    clearOnboardingProgress();
    clearFirstDayData();
  }, []);

  const debugRestart = useCallback(() => {
    debugReset();
    prepStartedRef.current = false;
    setPrepAnimationDone(false);
    setPrepSaveOk(false);
    setExitDestination(null);
    setExitTransitionDone(false);
    setError("");
    setFirstName("");
    setBusinessName("");
    setBusinessType("service_business");
    setBusinessSize("solo");
    setHelpAreas([]);
    setStep(1);
  }, [debugReset]);

  const debugToolbar = (
    <OnboardingDebugToolbar
      currentStep={exitDestination ? 6 : step}
      onGoToStep={debugGoToStep}
      onReset={debugReset}
      onRestart={debugRestart}
    />
  );

  if (exitDestination) {
    return (
      <>
        {debugToolbar}
        <NatalieFirstDayShell step={6} hideFooter hideProgress density="compact">
        <div className="grid gap-3 text-center">
          <h2 className="text-2xl font-extrabold leading-tight text-slate-900 sm:text-3xl">
            מצוין, נטלי סיימה להכיר את העסק שלך.
            <br />
            עכשיו אני מכינה עבורך את סביבת העבודה האישית.
          </h2>
        </div>
        <OnboardingChecklist
          items={ONBOARDING_EXIT_TRANSITION_STEPS}
          itemMs={EXIT_ITEM_MS}
          onComplete={handleExitTransitionComplete}
        />
      </NatalieFirstDayShell>
      </>
    );
  }

  if (!hydrated) {
    return (
      <>
        {debugToolbar}
        <NatalieFirstDayShell step={1} hideFooter showPortrait portraitSize="large" portraitTight>
        <div className="py-4 text-center text-slate-500">טוענת את סביבת העבודה שלך...</div>
      </NatalieFirstDayShell>
      </>
    );
  }

  if (step === 1) {
    return (
      <>
        {debugToolbar}
        <NatalieFirstDayShell step={1} showPortrait portraitSize="large" portraitTight hideFooter>
        <div className="grid gap-3 text-center">
          <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl md:text-4xl">ברוך הבא לנטלי</h1>
          <NatalieFirstDayMicrocopy compact>
            אני הולכת להיות עובדת המשרד החדשה שלך.
            <br />
            לפני שנתחיל לעבוד יחד, אני רוצה להכיר את העסק שלך כדי שאוכל לעבוד בדיוק בדרך שמתאימה לך.
            <br />
            <span className="font-semibold text-slate-800">זה ייקח בערך 2 דקות.</span>
          </NatalieFirstDayMicrocopy>
        </div>
        <div className="flex justify-center pt-1">
          <NatalieFirstDayPrimaryButton onClick={() => goToStep(2)}>בואו נתחיל</NatalieFirstDayPrimaryButton>
        </div>
      </NatalieFirstDayShell>
      </>
    );
  }

  if (step === 2) {
    return (
      <>
        {debugToolbar}
        <NatalieFirstDayShell
        step={2}
        footerCentered
        onBack={goBack}
        onPrimary={() => goToStep(3)}
        primaryDisabled={!firstName.trim() || !businessName.trim()}
      >
        <div className="mb-2 grid gap-2">
          <h2 className="text-2xl font-extrabold text-slate-900">בואו נכיר את העסק שלך</h2>
          <NatalieFirstDayMicrocopy>כמה פרטים קצרים — ואוכל להתאים את העבודה שלי בדיוק אליך.</NatalieFirstDayMicrocopy>
        </div>
        <div className="grid w-full gap-4">
          <NatalieFirstDayField label="שם העסק" value={businessName} onChange={setBusinessName} placeholder="שם העסק" />
          <NatalieFirstDayField label="השם שלך" value={firstName} onChange={setFirstName} placeholder="שם מלא" />
          <NatalieFirstDaySelect
            label="סוג העסק"
            value={businessType}
            onChange={(value) => setBusinessType(normalizeBusinessTypeId(value))}
            options={businessTypes.map((type) => ({ value: type.id, label: type.label }))}
          />
          <div className="grid w-full gap-2">
            <span className="text-base font-bold text-slate-900 sm:text-lg">כמה עובדים יש?</span>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {ONBOARDING_TEAM_SIZE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setBusinessSize(option.id)}
                  className={`min-h-[3.25rem] rounded-2xl border px-3 py-3 text-center text-sm font-bold transition duration-300 hover:-translate-y-0.5 sm:text-base ${
                    businessSize === option.id
                      ? "border-blue-300 bg-blue-50 text-blue-900 shadow-sm"
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
      </>
    );
  }

  if (step === 3) {
    return (
      <>
        {debugToolbar}
        <NatalieFirstDayShell
        step={3}
        onBack={goBack}
        onPrimary={() => goToStep(4)}
        primaryDisabled={helpAreas.length === 0}
      >
        <div className="grid gap-2">
          <h2 className="text-2xl font-extrabold text-slate-900">במה תרצה שנטלי תעזור לך?</h2>
          <NatalieFirstDayMicrocopy>אפשר לבחור כמה תחומים — ואתמקד בהם מהיום הראשון.</NatalieFirstDayMicrocopy>
        </div>
        <div className="grid auto-rows-fr gap-3 sm:grid-cols-2">
          {ONBOARDING_HELP_OPTIONS.map((option) => {
            const Icon = HELP_ICONS[option.id];
            return (
              <NatalieOnboardingChoiceCard
                key={option.id}
                selected={helpAreas.includes(option.id)}
                onClick={() => toggleHelpArea(option.id)}
                icon={<Icon className="h-5 w-5" strokeWidth={2} aria-hidden />}
              >
                {option.label}
              </NatalieOnboardingChoiceCard>
            );
          })}
        </div>
      </NatalieFirstDayShell>
      </>
    );
  }

  if (step === 4) {
    return (
      <>
        {debugToolbar}
        <NatalieFirstDayShell step={4} onBack={goBack} onPrimary={() => goToStep(5)} primaryLabel="המשך">
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
      </>
    );
  }

  if (step === 5) {
    return (
      <>
        {debugToolbar}
        <NatalieFirstDayShell step={5} hideFooter onBack={goBack}>
        <div className="grid gap-2">
          <h2 className="text-2xl font-extrabold text-slate-900">נטלי מכינה את המשרד שלך</h2>
          <NatalieFirstDayMicrocopy>עוד רגע — ואתחיל לעבוד בשבילך.</NatalieFirstDayMicrocopy>
        </div>
        <OnboardingChecklist
          items={ONBOARDING_PREP_STEPS}
          itemMs={PREP_ITEM_MS}
          onComplete={handlePrepAnimationComplete}
        />
        {error && (
          <div className="grid gap-3">
            <p className="text-sm font-semibold text-red-600">{error}</p>
            <NatalieFirstDayPrimaryButton onClick={() => void finishOnboarding().then((ok) => setPrepSaveOk(ok))}>
              נסו שוב
            </NatalieFirstDayPrimaryButton>
          </div>
        )}
        {saving && !error && <p className="text-sm font-semibold text-slate-500">שומרת את ההגדרות שלך...</p>}
      </NatalieFirstDayShell>
      </>
    );
  }

  const step6Actions = (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
      {ONBOARDING_ACTION_CARDS.map((action, index) => (
        <button
          key={action.label}
          type="button"
          onClick={() => handleActionSelect(action.href)}
          className={`inline-flex min-h-[3rem] items-center justify-center rounded-2xl bg-gradient-to-l from-blue-600 to-blue-700 px-3 py-3 text-center text-sm font-bold text-white shadow-[0_12px_32px_-12px_rgba(29,91,235,0.45)] transition hover:from-blue-700 hover:to-blue-800 sm:min-h-[3.25rem] sm:px-4 sm:text-base ${
            index === ONBOARDING_ACTION_CARDS.length - 1 ? "col-span-2" : ""
          }`}
        >
          {action.label}
        </button>
      ))}
    </div>
  );

  return (
    <>
      {debugToolbar}
      <NatalieFirstDayShell
        step={6}
        showPortrait
        portraitSize="xlarge"
        portraitTight
        density="compact"
        hideFooter
        onBack={goBack}
        stickyFooter={step6Actions}
      >
      <div className="grid gap-2 text-center">
        <h2 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">
          מושלם!
          <br />
          מעכשיו אני עובדת בשבילך.
        </h2>
        <NatalieFirstDayMicrocopy compact>המשרד שלך מוכן. בחרו איך להתחיל — ואני על זה.</NatalieFirstDayMicrocopy>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5">
        {ONBOARDING_SUMMARY_AREAS.map((area, index) => (
          <div
            key={area.label}
            className={`flex min-h-[4.25rem] flex-col items-center justify-center rounded-xl border border-slate-200/90 bg-slate-50/80 px-2 py-2.5 text-center shadow-sm sm:min-h-[4.5rem] sm:rounded-2xl sm:px-3 sm:py-3 ${
              index === ONBOARDING_SUMMARY_AREAS.length - 1 ? "col-span-2 sm:col-span-1 sm:col-start-2" : ""
            }`}
          >
            <span className="text-xl sm:text-2xl" aria-hidden>
              {area.icon}
            </span>
            <span className="mt-1 text-xs font-bold text-slate-800 sm:mt-1.5 sm:text-sm">{area.label}</span>
          </div>
        ))}
      </div>
    </NatalieFirstDayShell>
    </>
  );
}
