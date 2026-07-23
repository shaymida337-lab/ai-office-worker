"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { setOrganizationSettingsCache } from "@/lib/organization/organizationSettingsStore";
import { invalidateDashboardBootstrap } from "@/lib/dashboard/dashboardBootstrapStore";
import {
  businessModules,
  businessPains,
  businessSizes,
  businessTypes,
  getBusinessProfile,
  normalizeBusinessTypeId,
  normalizeEnabledModules,
  recommendedModulesFor,
  type BusinessModuleId,
  type BusinessPainId,
  type BusinessSizeId,
  type BusinessTypeId,
  type OrganizationSettings,
} from "@/lib/business-config";

type Props = {
  initialSettings: OrganizationSettings | null;
  mode: "onboarding" | "settings";
  onSaved: (settings: OrganizationSettings) => void;
};

export function BusinessOnboardingForm({ initialSettings, mode, onSaved }: Props) {
  const [step, setStep] = useState(1);
  const [businessName, setBusinessName] = useState(initialSettings?.businessName ?? initialSettings?.name ?? "");
  const [businessType, setBusinessType] = useState<BusinessTypeId>(normalizeBusinessTypeId(initialSettings?.businessType));
  const [businessSize, setBusinessSize] = useState<BusinessSizeId | null>(initialSettings?.businessSize ?? null);
  const [mainBusinessPain, setMainBusinessPain] = useState<BusinessPainId | null>(initialSettings?.mainBusinessPain ?? null);
  const [enabledModules, setEnabledModules] = useState<BusinessModuleId[]>(
    normalizeEnabledModules(initialSettings?.enabledModules, initialSettings?.businessType)
  );
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!initialSettings) return;
    setBusinessName(initialSettings.businessName ?? initialSettings.name ?? "");
    setBusinessType(normalizeBusinessTypeId(initialSettings.businessType));
    setBusinessSize(initialSettings.businessSize);
    setMainBusinessPain(initialSettings.mainBusinessPain);
    setEnabledModules(normalizeEnabledModules(initialSettings.enabledModules, initialSettings.businessType));
  }, [initialSettings]);

  const recommendedModules = useMemo(
    () => recommendedModulesFor(businessType, businessSize, mainBusinessPain),
    [businessType, businessSize, mainBusinessPain]
  );
  const businessProfile = useMemo(() => getBusinessProfile(businessType), [businessType]);
  const visibleModules = useMemo(
    () => businessModules.filter((module) => businessProfile.modules.includes(module.id)),
    [businessProfile.modules]
  );

  function applyRecommendations(nextBusinessType = businessType, nextSize = businessSize, nextPain = mainBusinessPain) {
    setEnabledModules(recommendedModulesFor(nextBusinessType, nextSize, nextPain));
  }

  function chooseBusinessType(next: BusinessTypeId) {
    setBusinessType(next);
    applyRecommendations(next, businessSize, mainBusinessPain);
  }

  function chooseBusinessSize(next: BusinessSizeId) {
    setBusinessSize(next);
    applyRecommendations(businessType, next, mainBusinessPain);
  }

  function chooseMainPain(next: BusinessPainId) {
    setMainBusinessPain(next);
    applyRecommendations(businessType, businessSize, next);
  }

  function toggleModule(moduleId: BusinessModuleId) {
    setEnabledModules((current) =>
      current.includes(moduleId) ? current.filter((id) => id !== moduleId) : [...current, moduleId]
    );
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const next = await apiFetch<OrganizationSettings>("/api/organization/settings", {
        method: "PUT",
        body: JSON.stringify({
          businessName,
          businessType,
          businessSize,
          mainBusinessPain,
          enabledModules: enabledModules.filter((moduleId) => businessProfile.modules.includes(moduleId)),
          onboardingCompleted: true,
        }),
      });
      setOrganizationSettingsCache(next);
      invalidateDashboardBootstrap();
      setMessage(mode === "onboarding" ? "ההגדרות נשמרו. הדשבורד מוכן." : "הגדרות העסק נשמרו.");
      onSaved(next);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת ההגדרות נכשלה");
    } finally {
      setSaving(false);
    }
  }

  const canContinue = step === 1 ? Boolean(businessType) : step === 2 ? Boolean(businessSize) : Boolean(mainBusinessPain);

  return (
    <div className="grid gap-6">
      {message && <div className="rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-sm text-ink-primary">{message}</div>}

      <div className="card">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-ink-primary">שלב {step} מתוך 3</div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-hover">
              <div className="h-full rounded-full bg-[#6366F1] transition-all" style={{ width: `${(step / 3) * 100}%` }} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
          {[1, 2, 3].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setStep(item)}
              className={[
                "rounded-full border px-4 py-2 transition",
                step === item ? "border-accent-primary bg-accent-primary/20 text-white" : "border-[var(--border-subtle)] bg-surface-secondary text-ink-secondary",
              ].join(" ")}
            >
              שלב {item}
            </button>
          ))}
          </div>
        </div>

        {step === 1 && (
          <div className="grid gap-4">
            <div>
              <h2>1. איזה סוג עסק יש לך?</h2>
              <p className="text-sm text-ink-secondary">הבחירה מפעילה תבנית מודולים מומלצת, שאפשר לערוך בהמשך.</p>
            </div>
            <label>
              שם העסק
              <input value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder={initialSettings?.name ?? "שם העסק"} />
            </label>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {businessTypes.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => chooseBusinessType(type.id)}
                  className={[
                    "rounded-2xl border p-4 text-right transition",
                    businessType === type.id ? "border-accent-primary bg-accent-primary/15 text-white" : "border-[var(--border-subtle)] bg-surface-secondary text-ink-primary hover:bg-surface-hover",
                  ].join(" ")}
                >
                  <strong>{type.label}</strong>
                  <span className="mt-2 block text-xs text-ink-secondary">{type.modules.length} מודולים מומלצים</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4">
            <div>
              <h2>2. מה גודל העסק?</h2>
              <p className="text-sm text-ink-secondary">עסקים עם צוות יקבלו גם מודול צוות כברירת מחדל.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {businessSizes.map((size) => (
                <button
                  key={size.id}
                  type="button"
                  onClick={() => chooseBusinessSize(size.id)}
                  className={[
                    "rounded-2xl border p-5 text-center text-lg font-semibold transition",
                    businessSize === size.id ? "border-accent-primary bg-accent-primary/15 text-white" : "border-[var(--border-subtle)] bg-surface-secondary text-ink-primary hover:bg-surface-hover",
                  ].join(" ")}
                >
                  {size.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-4">
            <div>
              <h2>3. מה הכאב המרכזי כרגע?</h2>
              <p className="text-sm text-ink-secondary">נוסיף את המודולים שהכי רלוונטיים לבעיה המרכזית.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {businessPains.map((pain) => (
                <button
                  key={pain.id}
                  type="button"
                  onClick={() => chooseMainPain(pain.id)}
                  className={[
                    "rounded-2xl border p-4 text-right transition",
                    mainBusinessPain === pain.id ? "border-accent-primary bg-accent-primary/15 text-white" : "border-[var(--border-subtle)] bg-surface-secondary text-ink-primary hover:bg-surface-hover",
                  ].join(" ")}
                >
                  <strong>{pain.label}</strong>
                  <span className="mt-2 block text-sm text-ink-secondary">{pain.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {step > 1 && <button className="btn btn-secondary" type="button" onClick={() => setStep(step - 1)}>חזרה</button>}
          {step < 3 && <button className="btn" type="button" onClick={() => setStep(step + 1)} disabled={!canContinue}>המשך</button>}
          {step === 3 && <button className="btn" type="button" onClick={save} disabled={saving || enabledModules.length === 0 || !canContinue}>{saving ? "שומר..." : mode === "onboarding" ? "שמור והמשך לדשבורד" : "שמור הגדרות"}</button>}
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2>מודולים שיופעלו</h2>
            <p className="text-sm text-ink-secondary">מוצגים רק מודולים רלוונטיים לסוג העסק שנבחר. מודולים לא רלוונטיים מוסתרים מהפלטפורמה.</p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={() => setEnabledModules(recommendedModules)}>אפס להמלצה</button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleModules.map((module) => {
            const checked = enabledModules.includes(module.id);
            return (
              <label key={module.id} className="flex cursor-pointer flex-row items-start gap-3 rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
                <input className="mt-1 w-auto" type="checkbox" checked={checked} onChange={() => toggleModule(module.id)} />
                <span>
                  <strong className="block text-ink-primary">{module.label}</strong>
                  <span className="text-sm text-ink-secondary">{module.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {businessProfile.onboardingRecommendations?.length ? (
        <div className="card">
          <div className="mb-4">
            <h2>המלצות לפי סוג העסק</h2>
            <p className="text-sm text-ink-secondary">המערכת תתחיל עם ההגדרות שמומלצות לעסק שבחרת, ואפשר לשנות הכל בהמשך.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {businessProfile.onboardingRecommendations.map((recommendation, index) => (
              <div key={recommendation} className="rounded-2xl border border-[var(--border-subtle)] bg-surface-secondary p-4">
                <span className="badge badge-ok">המלצה {index + 1}</span>
                <p className="mt-3 text-sm">{recommendation}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
