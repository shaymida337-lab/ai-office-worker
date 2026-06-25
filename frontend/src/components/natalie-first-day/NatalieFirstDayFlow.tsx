"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import {
  recommendedModulesFor,
  type BusinessPainId,
  type OrganizationSettings,
} from "@/lib/business-config";
import {
  FIRST_DAY_COMMUNICATION_OPTIONS,
  FIRST_DAY_PAIN_OPTIONS,
  type FirstDayCommunication,
  writeFirstDayData,
} from "@/lib/natalie/firstDay";
import {
  NatalieFirstDayField,
  NatalieFirstDayMicrocopy,
  NatalieFirstDayPrimaryButton,
  NatalieFirstDayShell,
} from "./NatalieFirstDayShell";

type Step =
  | "welcome"
  | "name"
  | "business"
  | "phone"
  | "pains"
  | "communication"
  | "promise"
  | "animation";

const WORK_STEPS = [
  "מתחברת למייל",
  "מחפשת מסמכים חדשים",
  "מזהה חשבוניות וקבלות",
  "מסדרת קבצים ב-Google Drive",
  "מעדכנת Google Sheets",
  "בודקת תשלומים שדורשים תשומת לב",
] as const;

function painToBusinessPain(pain: string): BusinessPainId {
  if (pain.includes("חשבוניות")) return "invoices";
  if (pain.includes("תשלומים")) return "collections";
  if (pain.includes("דרייב") || pain.includes("מסמכים")) return "documents";
  if (pain.includes("טבלאות")) return "documents";
  if (pain.includes("רואה")) return "invoices";
  return "documents";
}

export function NatalieFirstDayFlow({ onComplete }: { onComplete: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [firstName, setFirstName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [pains, setPains] = useState<string[]>([]);
  const [communication, setCommunication] = useState<FirstDayCommunication>("both");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [animationIndex, setAnimationIndex] = useState(-1);
  const [animationDone, setAnimationDone] = useState(false);

  const togglePain = (pain: string) => {
    setPains((current) => {
      if (current.includes(pain)) return current.filter((p) => p !== pain);
      if (current.length >= 3) return current;
      return [...current, pain];
    });
  };

  const finishOnboarding = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      const mainPain = pains.length > 0 ? painToBusinessPain(pains[0]) : "documents";
      const businessType = "service_business" as const;
      const businessSize = "solo" as const;
      const enabledModules = recommendedModulesFor(businessType, businessSize, mainPain);

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
        phone,
        pains,
        communication,
        completedAt: new Date().toISOString(),
        workAnimationSeen: true,
      });

      onComplete();
      router.push("/dashboard?firstDay=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "שמירה נכשלה. נסו שוב.");
    } finally {
      setSaving(false);
    }
  }, [businessName, communication, firstName, onComplete, pains, phone, router]);

  useEffect(() => {
    if (step !== "animation") return;
    setAnimationIndex(0);
    setAnimationDone(false);
    let i = 0;
    const interval = window.setInterval(() => {
      i += 1;
      if (i >= WORK_STEPS.length) {
        window.clearInterval(interval);
        setAnimationDone(true);
        return;
      }
      setAnimationIndex(i);
    }, 1200);
    return () => window.clearInterval(interval);
  }, [step]);

  const promiseTasks = useMemo(
    () => [
      "לסדר את המסמכים שמגיעים מהמייל",
      "לשמור אותם במקום הנכון ב-Google Drive",
      "לעדכן את הנתונים ב-Google Sheets",
      "לעזור לך לדעת אילו תשלומים דורשים טיפול",
      "להכין את החומר בצורה מסודרת לרואה החשבון",
    ],
    []
  );

  if (step === "welcome") {
    return (
      <NatalieFirstDayShell showPortrait kicker="יום העבודה הראשון של נטלי">
        <div className="grid gap-4 text-center">
          <h1 className="text-3xl font-extrabold text-slate-900 md:text-4xl">נעים מאוד, אני נטלי.</h1>
          <p className="text-lg leading-9 text-slate-600 md:text-xl">
            אני הולכת לעזור לך להוריד מהראש את העבודה המשרדית — מסמכים, חשבוניות, תשלומים וסדר בעסק.
          </p>
          <p className="text-base font-semibold text-blue-700">זה ייקח פחות מדקה, ואז אתחיל לעבוד.</p>
        </div>
        <NatalieFirstDayPrimaryButton onClick={() => setStep("name")}>בואי נכיר את העסק</NatalieFirstDayPrimaryButton>
      </NatalieFirstDayShell>
    );
  }

  if (step === "name") {
    return (
      <NatalieFirstDayShell kicker="יום העבודה הראשון של נטלי">
        <NatalieFirstDayField label="איך קוראים לך?" value={firstName} onChange={setFirstName} placeholder="שם מלא" />
        <NatalieFirstDayMicrocopy>ככה אוכל לפנות אליך בצורה אישית.</NatalieFirstDayMicrocopy>
        <NatalieFirstDayPrimaryButton disabled={!firstName.trim()} onClick={() => setStep("business")}>
          המשך
        </NatalieFirstDayPrimaryButton>
      </NatalieFirstDayShell>
    );
  }

  if (step === "business") {
    return (
      <NatalieFirstDayShell kicker="יום העבודה הראשון של נטלי">
        <NatalieFirstDayField label="איך קוראים לעסק שלך?" value={businessName} onChange={setBusinessName} placeholder="שם העסק" />
        <NatalieFirstDayMicrocopy>מעכשיו אדבר איתך על העסק שלך, לא על "המערכת".</NatalieFirstDayMicrocopy>
        <NatalieFirstDayPrimaryButton disabled={!businessName.trim()} onClick={() => setStep("phone")}>
          המשך
        </NatalieFirstDayPrimaryButton>
      </NatalieFirstDayShell>
    );
  }

  if (step === "phone") {
    return (
      <NatalieFirstDayShell kicker="יום העבודה הראשון של נטלי">
        <NatalieFirstDayField
          label="באיזה מספר אוכל לעדכן אותך אם יהיה משהו חשוב?"
          value={phone}
          onChange={setPhone}
          placeholder="טלפון"
          type="tel"
        />
        <NatalieFirstDayMicrocopy>רק לדברים חשובים באמת. בלי רעש.</NatalieFirstDayMicrocopy>
        <NatalieFirstDayPrimaryButton onClick={() => setStep("pains")}>המשך</NatalieFirstDayPrimaryButton>
      </NatalieFirstDayShell>
    );
  }

  if (step === "pains") {
    return (
      <NatalieFirstDayShell kicker="יום העבודה הראשון של נטלי">
        <h2 className="text-2xl font-extrabold text-slate-900">מה הכי היית רוצה להפסיק לעשות לבד?</h2>
        <NatalieFirstDayMicrocopy>אפשר לבחור עד 3 דברים.</NatalieFirstDayMicrocopy>
        <div className="grid gap-3">
          {FIRST_DAY_PAIN_OPTIONS.map((pain) => {
            const selected = pains.includes(pain);
            return (
              <button
                key={pain}
                type="button"
                onClick={() => togglePain(pain)}
                className={`rounded-2xl border px-5 py-4 text-right text-base font-semibold transition ${
                  selected
                    ? "border-blue-500 bg-blue-50 text-blue-900"
                    : "border-slate-200 bg-white text-slate-800 hover:border-blue-200"
                }`}
              >
                {pain}
              </button>
            );
          })}
        </div>
        <NatalieFirstDayPrimaryButton disabled={pains.length === 0} onClick={() => setStep("communication")}>
          המשך
        </NatalieFirstDayPrimaryButton>
      </NatalieFirstDayShell>
    );
  }

  if (step === "communication") {
    return (
      <NatalieFirstDayShell kicker="יום העבודה הראשון של נטלי">
        <h2 className="text-2xl font-extrabold text-slate-900">איך הכי נוח לך לדבר עם נטלי?</h2>
        <NatalieFirstDayMicrocopy>אפשר פשוט לבקש ממני דברים כמו מעובדת משרד.</NatalieFirstDayMicrocopy>
        <div className="grid gap-3 sm:grid-cols-3">
          {FIRST_DAY_COMMUNICATION_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setCommunication(option.id)}
              className={`rounded-2xl border px-4 py-4 text-center text-base font-bold transition ${
                communication === option.id
                  ? "border-blue-500 bg-blue-50 text-blue-900"
                  : "border-slate-200 bg-white text-slate-800"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <NatalieFirstDayPrimaryButton onClick={() => setStep("promise")}>המשך</NatalieFirstDayPrimaryButton>
      </NatalieFirstDayShell>
    );
  }

  if (step === "promise") {
    return (
      <NatalieFirstDayShell showPortrait kicker="יום העבודה הראשון של נטלי">
        <div className="grid gap-4 text-right">
          <h2 className="text-2xl font-extrabold text-slate-900 md:text-3xl">מעולה, {firstName}. עכשיו אני יודעת מאיפה להתחיל.</h2>
          <p className="text-base leading-8 text-slate-600">לפי מה שסיפרת לי, המשימות הראשונות שלי יהיו:</p>
          <ul className="grid gap-2">
            {promiseTasks.map((task) => (
              <li key={task} className="flex items-start gap-2 text-base text-slate-700">
                <span className="text-blue-600">✓</span>
                <span>{task}</span>
              </li>
            ))}
          </ul>
          <blockquote className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-base font-semibold leading-8 text-slate-800">
            אני לא כאן כדי שתלמד עוד מערכת. אני כאן כדי להוריד ממך עבודה.
          </blockquote>
        </div>
        <NatalieFirstDayPrimaryButton onClick={() => setStep("animation")}>נטלי, בואי נתחיל לעבוד</NatalieFirstDayPrimaryButton>
      </NatalieFirstDayShell>
    );
  }

  return (
    <NatalieFirstDayShell kicker="יום העבודה הראשון של נטלי">
      <div className="grid gap-6 text-right">
        <h2 className="text-2xl font-extrabold text-slate-900">יום העבודה הראשון שלי מתחיל עכשיו</h2>
        <p className="text-base text-slate-600">אני מתכוננת לעבודה — זה לא אומר שכבר סיימתי, אלא שאני מוכנה להתחיל ברגע שנחבר את המייל.</p>
        <ul className="grid gap-3">
          {WORK_STEPS.map((item, index) => {
            const done = animationDone || index <= animationIndex;
            const active = index === animationIndex && !animationDone;
            return (
              <li
                key={item}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-base transition ${
                  done ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-500"
                } ${active ? "ring-2 ring-blue-200" : ""}`}
              >
                <span aria-hidden>{done ? "✓" : "○"}</span>
                <span>{item}</span>
              </li>
            );
          })}
        </ul>
        {animationDone && (
          <div className="grid gap-2 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-center">
            <p className="text-xl font-extrabold text-slate-900">סיימתי להתחיל 😊</p>
            <p className="text-base text-slate-600">בוא נראה מה כבר אפשר לסדר בשבילך.</p>
          </div>
        )}
      </div>
      {error && <p className="text-center text-sm font-semibold text-red-600">{error}</p>}
      <NatalieFirstDayPrimaryButton disabled={!animationDone || saving} onClick={() => void finishOnboarding()}>
        {saving ? "שומרת..." : "למרכז העבודה של נטלי"}
      </NatalieFirstDayPrimaryButton>
    </NatalieFirstDayShell>
  );
}
